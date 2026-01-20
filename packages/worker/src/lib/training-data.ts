import type { Env } from '../types'

export interface TrainingExample {
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
}

export interface TrainingJob {
  id: string
  groupId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  provider: 'together' | 'openai'
  modelId?: string
  trainingFileId?: string
  messageCount: number
  error?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export interface TrainingConfig {
  systemPrompt: string
  minConversationLength: number
  maxExamples: number
  includeReactions: boolean
  filterLowQuality: boolean
}

const DEFAULT_CONFIG: TrainingConfig = {
  systemPrompt: `You are Brain, an AI member of a group chat. You're witty, helpful, and have been learning from this group's conversations. Match their vibe, reference past discussions when relevant, and be conversational rather than formal.`,
  minConversationLength: 2,
  maxExamples: 500,
  includeReactions: true,
  filterLowQuality: true,
}

/**
 * Get conversation threads from group messages
 * Groups sequential messages and Brain responses into training pairs
 */
async function getConversationThreads(
  env: Env,
  groupId: string,
  options?: { limit?: number; since?: Date }
): Promise<Array<{
  userMessages: Array<{ content: string; userName: string }>
  brainResponse: string
  reactions: number
}>> {
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : ''
  const sinceClause = options?.since
    ? `AND m.created_at >= '${options.since.toISOString()}'`
    : ''

  // Get all messages with Brain responses
  const rows = await env.DB.prepare(`
    SELECT
      m.id,
      m.user_id,
      u.name as user_name,
      m.content,
      m.type,
      m.created_at,
      (SELECT COUNT(*) FROM reactions r WHERE r.message_id = m.id) as reaction_count
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ?
      ${sinceClause}
    ORDER BY m.created_at ASC
    ${limitClause}
  `).bind(groupId).all()

  const messages = rows.results || []
  const threads: Array<{
    userMessages: Array<{ content: string; userName: string }>
    brainResponse: string
    reactions: number
  }> = []

  let currentUserMessages: Array<{ content: string; userName: string }> = []

  for (const msg of messages as any[]) {
    if (msg.type === 'brain_response') {
      // Found a Brain response - this completes a thread
      if (currentUserMessages.length > 0) {
        threads.push({
          userMessages: [...currentUserMessages],
          brainResponse: msg.content,
          reactions: msg.reaction_count || 0,
        })
      }
      currentUserMessages = []
    } else if (msg.type === 'text') {
      // Add to current user messages
      currentUserMessages.push({
        content: msg.content,
        userName: msg.user_name || 'User',
      })
    }
  }

  return threads
}

/**
 * Filter low quality training examples
 */
function filterLowQuality(threads: Array<{
  userMessages: Array<{ content: string; userName: string }>
  brainResponse: string
  reactions: number
}>): Array<typeof threads[0]> {
  return threads.filter((thread) => {
    // Filter out very short exchanges
    if (thread.brainResponse.length < 20) return false

    // Filter out single-word user messages
    const hasSubstantialInput = thread.userMessages.some(
      (m) => m.content.split(' ').length >= 3
    )
    if (!hasSubstantialInput) return false

    // Filter out responses that are just errors or default messages
    const lowerResponse = thread.brainResponse.toLowerCase()
    if (lowerResponse.includes('error') || lowerResponse.includes('unable to')) {
      return false
    }

    return true
  })
}

/**
 * Convert threads to OpenAI/Together training format
 */
function convertToTrainingFormat(
  threads: Array<{
    userMessages: Array<{ content: string; userName: string }>
    brainResponse: string
    reactions: number
  }>,
  config: TrainingConfig
): TrainingExample[] {
  return threads.map((thread) => {
    // Combine user messages with attribution
    const userContent = thread.userMessages
      .map((m) => `[${m.userName}]: ${m.content}`)
      .join('\n')

    return {
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userContent },
        { role: 'assistant', content: thread.brainResponse },
      ],
    }
  })
}

/**
 * Export training data as JSONL
 */
export async function exportTrainingData(
  env: Env,
  groupId: string,
  options?: {
    config?: Partial<TrainingConfig>
    since?: Date
  }
): Promise<{
  jsonl: string
  exampleCount: number
  stats: {
    totalThreads: number
    filteredThreads: number
    avgResponseLength: number
  }
}> {
  const config: TrainingConfig = { ...DEFAULT_CONFIG, ...options?.config }

  // Get conversation threads
  let threads = await getConversationThreads(env, groupId, {
    since: options?.since,
  })

  const totalThreads = threads.length

  // Filter threads by minimum conversation length
  threads = threads.filter(
    (t) => t.userMessages.length >= config.minConversationLength
  )

  // Filter low quality if enabled
  if (config.filterLowQuality) {
    threads = filterLowQuality(threads)
  }

  // Sort by reactions if including them (higher quality training data first)
  if (config.includeReactions) {
    threads.sort((a, b) => b.reactions - a.reactions)
  }

  // Limit to max examples
  threads = threads.slice(0, config.maxExamples)

  // Convert to training format
  const examples = convertToTrainingFormat(threads, config)

  // Calculate stats
  const avgResponseLength =
    threads.length > 0
      ? threads.reduce((sum, t) => sum + t.brainResponse.length, 0) / threads.length
      : 0

  // Convert to JSONL
  const jsonl = examples.map((ex) => JSON.stringify(ex)).join('\n')

  return {
    jsonl,
    exampleCount: examples.length,
    stats: {
      totalThreads,
      filteredThreads: threads.length,
      avgResponseLength: Math.round(avgResponseLength),
    },
  }
}

/**
 * Upload training file to Together.ai
 */
export async function uploadToTogether(
  apiKey: string,
  jsonl: string,
  fileName: string
): Promise<string> {
  const formData = new FormData()
  formData.append(
    'file',
    new Blob([jsonl], { type: 'application/jsonl' }),
    fileName
  )
  formData.append('purpose', 'fine-tune')

  const response = await fetch('https://api.together.xyz/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Together file upload failed: ${error}`)
  }

  const data = (await response.json()) as { id: string }
  return data.id
}

/**
 * Start fine-tuning job on Together.ai
 */
export async function startTogetherTraining(
  apiKey: string,
  fileId: string,
  options?: {
    baseModel?: string
    suffix?: string
    epochs?: number
  }
): Promise<{ jobId: string; modelId: string }> {
  const response = await fetch('https://api.together.xyz/v1/fine-tunes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      training_file: fileId,
      model: options?.baseModel || 'mistralai/Mistral-7B-Instruct-v0.2',
      suffix: options?.suffix || 'brain-trust',
      n_epochs: options?.epochs || 3,
      learning_rate: 1e-5,
      batch_size: 4,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Together training failed: ${error}`)
  }

  const data = (await response.json()) as { id: string; output_name: string }
  return {
    jobId: data.id,
    modelId: data.output_name,
  }
}

/**
 * Check Together.ai training job status
 */
export async function checkTogetherJobStatus(
  apiKey: string,
  jobId: string
): Promise<{
  status: 'pending' | 'running' | 'completed' | 'failed'
  modelId?: string
  error?: string
}> {
  const response = await fetch(`https://api.together.xyz/v1/fine-tunes/${jobId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to check job status')
  }

  const data = (await response.json()) as {
    status: string
    output_name?: string
    error?: string
  }

  return {
    status: data.status as any,
    modelId: data.output_name,
    error: data.error,
  }
}

/**
 * Upload training file to OpenAI
 */
export async function uploadToOpenAI(
  apiKey: string,
  jsonl: string,
  fileName: string
): Promise<string> {
  const formData = new FormData()
  formData.append(
    'file',
    new Blob([jsonl], { type: 'application/jsonl' }),
    fileName
  )
  formData.append('purpose', 'fine-tune')

  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI file upload failed: ${error}`)
  }

  const data = (await response.json()) as { id: string }
  return data.id
}

/**
 * Start fine-tuning job on OpenAI
 */
export async function startOpenAITraining(
  apiKey: string,
  fileId: string,
  options?: {
    baseModel?: string
    suffix?: string
    epochs?: number
  }
): Promise<{ jobId: string }> {
  const response = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      training_file: fileId,
      model: options?.baseModel || 'gpt-4o-mini-2024-07-18',
      suffix: options?.suffix || 'brain-trust',
      hyperparameters: {
        n_epochs: options?.epochs || 3,
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI training failed: ${error}`)
  }

  const data = (await response.json()) as { id: string }
  return { jobId: data.id }
}

/**
 * Check OpenAI training job status
 */
export async function checkOpenAIJobStatus(
  apiKey: string,
  jobId: string
): Promise<{
  status: 'validating_files' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  modelId?: string
  error?: string
}> {
  const response = await fetch(
    `https://api.openai.com/v1/fine_tuning/jobs/${jobId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error('Failed to check job status')
  }

  const data = (await response.json()) as {
    status: string
    fine_tuned_model?: string
    error?: { message: string }
  }

  return {
    status: data.status as any,
    modelId: data.fine_tuned_model,
    error: data.error?.message,
  }
}

/**
 * Create a training job record
 */
export async function createTrainingJob(
  env: Env,
  groupId: string,
  provider: 'together' | 'openai',
  messageCount: number
): Promise<string> {
  const id = crypto.randomUUID()

  await env.DB.prepare(`
    INSERT INTO training_jobs (id, group_id, status, provider, message_count)
    VALUES (?, ?, 'pending', ?, ?)
  `).bind(id, groupId, provider, messageCount).run()

  return id
}

/**
 * Update training job status
 */
export async function updateTrainingJob(
  env: Env,
  jobId: string,
  updates: {
    status?: string
    modelId?: string
    trainingFileId?: string
    error?: string
    startedAt?: string
    completedAt?: string
  }
): Promise<void> {
  const setClauses: string[] = []
  const values: any[] = []

  if (updates.status) {
    setClauses.push('status = ?')
    values.push(updates.status)
  }
  if (updates.modelId) {
    setClauses.push('model_id = ?')
    values.push(updates.modelId)
  }
  if (updates.trainingFileId) {
    setClauses.push('training_file_id = ?')
    values.push(updates.trainingFileId)
  }
  if (updates.error) {
    setClauses.push('error = ?')
    values.push(updates.error)
  }
  if (updates.startedAt) {
    setClauses.push('started_at = ?')
    values.push(updates.startedAt)
  }
  if (updates.completedAt) {
    setClauses.push('completed_at = ?')
    values.push(updates.completedAt)
  }

  if (setClauses.length === 0) return

  values.push(jobId)

  await env.DB.prepare(
    `UPDATE training_jobs SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...values).run()
}

/**
 * Get latest completed model for a group
 */
export async function getGroupModel(
  env: Env,
  groupId: string
): Promise<{ modelId: string; provider: string } | null> {
  const row = await env.DB.prepare(`
    SELECT model_id, provider
    FROM training_jobs
    WHERE group_id = ? AND status = 'completed' AND model_id IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 1
  `).bind(groupId).first()

  if (!row?.model_id) return null

  return {
    modelId: row.model_id as string,
    provider: row.provider as string,
  }
}
