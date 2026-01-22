import type { Env } from '../types'
import { callAI } from './ai-providers'

export interface ConversationSummary {
  summary: string
  keyTopics: string[]
  highlights: SummaryHighlight[]
  participantStats: ParticipantStat[]
  messageCount: number
  periodStart: string
  periodEnd: string
}

export interface SummaryHighlight {
  type: 'discussion' | 'decision' | 'question' | 'recommendation' | 'funny'
  content: string
  timestamp?: string
}

export interface ParticipantStat {
  userId: string
  userName: string
  messageCount: number
  topTopics: string[]
}

export interface TopicSummary {
  topic: string
  summary: string
  messageCount: number
  participants: string[]
  keyPoints: string[]
}

/**
 * Get messages for a time period
 */
async function getMessagesForPeriod(
  env: Env,
  groupId: string,
  startDate: Date,
  endDate: Date
): Promise<Array<{
  id: string
  userId: string
  userName: string
  content: string
  type: string
  createdAt: string
}>> {
  const rows = await env.DB.prepare(`
    SELECT
      m.id,
      m.user_id,
      u.name as user_name,
      m.content,
      m.type,
      m.created_at
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ?
      AND m.created_at >= ?
      AND m.created_at <= ?
      AND m.type IN ('text', 'brain_response')
    ORDER BY m.created_at ASC
  `).bind(groupId, startDate.toISOString(), endDate.toISOString()).all()

  return (rows.results || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || 'Unknown',
    content: row.content,
    type: row.type,
    createdAt: row.created_at,
  }))
}

/**
 * Generate daily summary
 */
export async function generateDailySummary(
  env: Env,
  groupId: string,
  date: Date,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<ConversationSummary> {
  const startDate = new Date(date)
  startDate.setHours(0, 0, 0, 0)

  const endDate = new Date(date)
  endDate.setHours(23, 59, 59, 999)

  return generateSummary(env, groupId, startDate, endDate, 'daily', options)
}

/**
 * Generate weekly summary
 */
export async function generateWeeklySummary(
  env: Env,
  groupId: string,
  weekEndDate: Date,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<ConversationSummary> {
  const endDate = new Date(weekEndDate)
  endDate.setHours(23, 59, 59, 999)

  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 7)
  startDate.setHours(0, 0, 0, 0)

  return generateSummary(env, groupId, startDate, endDate, 'weekly', options)
}

/**
 * Generate summary for a custom period
 */
export async function generateSummary(
  env: Env,
  groupId: string,
  startDate: Date,
  endDate: Date,
  type: 'daily' | 'weekly' | 'custom',
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<ConversationSummary> {
  const messages = await getMessagesForPeriod(env, groupId, startDate, endDate)

  if (messages.length === 0) {
    return {
      summary: 'No messages during this period.',
      keyTopics: [],
      highlights: [],
      participantStats: [],
      messageCount: 0,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
    }
  }

  // Calculate participant stats
  const participantMap = new Map<string, { count: number; name: string }>()
  for (const msg of messages) {
    const existing = participantMap.get(msg.userId) || { count: 0, name: msg.userName }
    existing.count++
    participantMap.set(msg.userId, existing)
  }

  const participantStats: ParticipantStat[] = Array.from(participantMap.entries())
    .map(([userId, data]) => ({
      userId,
      userName: data.name,
      messageCount: data.count,
      topTopics: [], // Will be filled by AI
    }))
    .sort((a, b) => b.messageCount - a.messageCount)

  // Format messages for AI
  const conversationText = messages
    .map((m) => `[${m.userName}]: ${m.content}`)
    .join('\n')
    .slice(0, 12000) // Limit for token constraints

  const systemPrompt = `You are a conversation summarizer. Analyze the group chat and provide a comprehensive summary.

Return your response in this exact JSON format:
{
  "summary": "A 3-5 sentence summary of what the group discussed",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "highlights": [
    {"type": "discussion", "content": "Brief description of interesting discussion"},
    {"type": "decision", "content": "Any decisions made"},
    {"type": "question", "content": "Interesting questions raised"},
    {"type": "funny", "content": "Funny or notable moments"}
  ],
  "participantTopics": {
    "userName1": ["topic1", "topic2"],
    "userName2": ["topic3"]
  }
}

Types for highlights: discussion, decision, question, recommendation, funny

Focus on:
1. Main themes and topics discussed
2. Any decisions or conclusions reached
3. Notable or interesting exchanges
4. Questions that were raised (answered or not)

Only output valid JSON.`

  const periodLabel = type === 'daily' ? 'today' : type === 'weekly' ? 'this week' : 'this period'

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: `Summarize what this group chat discussed ${periodLabel}:\n\n${conversationText}` }],
    1500
  )

  try {
    const analysis = JSON.parse(response.content)

    // Add topics to participant stats
    const participantTopics = analysis.participantTopics || {}
    for (const stat of participantStats) {
      stat.topTopics = participantTopics[stat.userName] || []
    }

    return {
      summary: analysis.summary || 'Unable to generate summary.',
      keyTopics: analysis.keyTopics || [],
      highlights: analysis.highlights || [],
      participantStats,
      messageCount: messages.length,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
    }
  } catch {
    return {
      summary: 'Unable to analyze conversation.',
      keyTopics: [],
      highlights: [],
      participantStats,
      messageCount: messages.length,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
    }
  }
}

/**
 * Generate summary for a specific topic
 */
export async function generateTopicSummary(
  env: Env,
  groupId: string,
  topic: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
    limit?: number
  }
): Promise<TopicSummary> {
  // Get recent messages (last 7 days)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  const messages = await getMessagesForPeriod(env, groupId, startDate, endDate)

  if (messages.length === 0) {
    return {
      topic,
      summary: 'No recent conversations to analyze.',
      messageCount: 0,
      participants: [],
      keyPoints: [],
    }
  }

  const conversationText = messages
    .map((m) => `[${m.userName}]: ${m.content}`)
    .join('\n')
    .slice(0, 10000)

  const systemPrompt = `You are analyzing a group chat for discussion of a specific topic.

Find all messages related to the topic "${topic}" and summarize them.

Return your response in this exact JSON format:
{
  "relevant": true/false,
  "summary": "Summary of what was discussed about this topic",
  "participants": ["person1", "person2"],
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "messageCount": 5
}

If the topic wasn't discussed, set relevant to false and provide empty values.
Only output valid JSON.`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: `Topic to find: "${topic}"\n\nConversation:\n${conversationText}` }],
    1024
  )

  try {
    const analysis = JSON.parse(response.content)

    if (!analysis.relevant) {
      return {
        topic,
        summary: `The topic "${topic}" hasn't been discussed recently.`,
        messageCount: 0,
        participants: [],
        keyPoints: [],
      }
    }

    return {
      topic,
      summary: analysis.summary,
      messageCount: analysis.messageCount || 0,
      participants: analysis.participants || [],
      keyPoints: analysis.keyPoints || [],
    }
  } catch {
    return {
      topic,
      summary: 'Unable to analyze topic.',
      messageCount: 0,
      participants: [],
      keyPoints: [],
    }
  }
}

/**
 * Catch someone up on what they missed
 */
export async function catchUp(
  env: Env,
  groupId: string,
  userId: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
    since?: Date
  }
): Promise<string> {
  // Default to last 24 hours
  const since = options?.since || new Date(Date.now() - 24 * 60 * 60 * 1000)
  const now = new Date()

  const messages = await getMessagesForPeriod(env, groupId, since, now)

  if (messages.length === 0) {
    return "Nothing much has happened since you were gone! It's been quiet."
  }

  // Get user's name
  const userRow = await env.DB.prepare(
    'SELECT name FROM users WHERE id = ?'
  ).bind(userId).first()
  const userName = (userRow?.name as string) || 'there'

  // Filter out the user's own messages for context
  const otherMessages = messages.filter(m => m.userId !== userId)

  if (otherMessages.length === 0) {
    return "You were the only one chatting! No one else has said anything."
  }

  const conversationText = otherMessages
    .map((m) => `[${m.userName}]: ${m.content}`)
    .join('\n')
    .slice(0, 8000)

  const systemPrompt = `You are catching up a team member on what they missed. Be direct and concise.

Format your response as:

**Summary**
1-2 sentences on what the team discussed.

**Documents shared**
List any files/docs that were shared and what they contain.

**Key decisions or info**
Bullet the important things they need to know.

**Next steps**
Any action items or things to follow up on.

Keep it short. No filler words. Skip any section if nothing relevant.`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: `Catch up ${userName} on what happened in the group while they were away:\n\n${conversationText}` }],
    800
  )

  return response.content
}

/**
 * Store summary in database
 */
export async function storeSummary(
  env: Env,
  groupId: string,
  summary: ConversationSummary,
  type: 'daily' | 'weekly' | 'topic' | 'on_demand',
  topic?: string
): Promise<string> {
  const id = crypto.randomUUID()

  await env.DB.prepare(`
    INSERT INTO conversation_summaries
    (id, group_id, type, period_start, period_end, topic, summary, key_topics, message_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    groupId,
    type,
    summary.periodStart,
    summary.periodEnd,
    topic || null,
    summary.summary,
    JSON.stringify(summary.keyTopics),
    summary.messageCount
  ).run()

  return id
}

/**
 * Format summary for display
 */
export function formatSummary(summary: ConversationSummary): string {
  let formatted = `**Summary** (${summary.messageCount} messages)\n\n`
  formatted += summary.summary + '\n\n'

  if (summary.keyTopics.length > 0) {
    formatted += `**Topics:** ${summary.keyTopics.join(', ')}\n\n`
  }

  if (summary.highlights.length > 0) {
    formatted += '**Highlights:**\n'
    for (const highlight of summary.highlights) {
      formatted += `- ${highlight.content}\n`
    }
  }

  return formatted
}
