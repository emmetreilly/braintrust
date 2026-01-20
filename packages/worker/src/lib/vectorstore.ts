import type { Env } from '../types'
import { generateEmbedding, type EmbeddingResult } from './embeddings'

// Vectorize index configuration
const VECTORIZE_INDEX = 'brain-trust-messages'
const VECTORIZE_DIMENSIONS = 768 // Using Cloudflare AI default

export interface VectorMetadata {
  messageId: string
  groupId: string
  userId: string
  authorName?: string
  content: string
  createdAt: string
  type: 'message' | 'media_summary'
}

export interface SearchResult {
  id: string
  score: number
  metadata: VectorMetadata
}

/**
 * Store a message embedding in Vectorize
 */
export async function storeMessageEmbedding(
  env: Env,
  message: {
    id: string
    groupId: string
    userId: string
    authorName?: string
    content: string
    createdAt: string
    type?: 'message' | 'media_summary'
  },
  options?: {
    provider?: 'cloudflare' | 'openai'
    userId?: string
  }
): Promise<void> {
  const vectorize = (env as any).VECTORIZE

  if (!vectorize) {
    console.warn('Vectorize binding not configured, skipping embedding storage')
    return
  }

  // Generate embedding for the message content
  const embeddingResult = await generateEmbedding(env, message.content, options)

  // Prepare metadata
  const metadata: VectorMetadata = {
    messageId: message.id,
    groupId: message.groupId,
    userId: message.userId,
    authorName: message.authorName,
    content: message.content.slice(0, 1000), // Store truncated content for retrieval
    createdAt: message.createdAt,
    type: message.type || 'message',
  }

  // Normalize embedding dimensions if needed (OpenAI uses 1536, CF uses 768)
  let embedding = embeddingResult.embedding
  if (embedding.length > VECTORIZE_DIMENSIONS) {
    // Truncate to match index dimensions (simple approach)
    // In production, you might want to use dimensionality reduction
    embedding = embedding.slice(0, VECTORIZE_DIMENSIONS)
  } else if (embedding.length < VECTORIZE_DIMENSIONS) {
    // Pad with zeros (shouldn't happen with proper config)
    embedding = [...embedding, ...new Array(VECTORIZE_DIMENSIONS - embedding.length).fill(0)]
  }

  // Insert into Vectorize
  await vectorize.insert([
    {
      id: message.id,
      values: embedding,
      metadata,
    },
  ])
}

/**
 * Search for similar messages in a group
 */
export async function searchSimilarMessages(
  env: Env,
  query: string,
  groupId: string,
  options?: {
    limit?: number
    provider?: 'cloudflare' | 'openai'
    userId?: string
    minScore?: number
  }
): Promise<SearchResult[]> {
  const vectorize = (env as any).VECTORIZE

  if (!vectorize) {
    console.warn('Vectorize binding not configured, returning empty results')
    return []
  }

  const limit = options?.limit || 10
  const minScore = options?.minScore || 0.5

  // Generate embedding for the query
  const embeddingResult = await generateEmbedding(env, query, {
    provider: options?.provider,
    userId: options?.userId,
  })

  // Normalize embedding dimensions
  let queryEmbedding = embeddingResult.embedding
  if (queryEmbedding.length > VECTORIZE_DIMENSIONS) {
    queryEmbedding = queryEmbedding.slice(0, VECTORIZE_DIMENSIONS)
  } else if (queryEmbedding.length < VECTORIZE_DIMENSIONS) {
    queryEmbedding = [...queryEmbedding, ...new Array(VECTORIZE_DIMENSIONS - queryEmbedding.length).fill(0)]
  }

  // Query Vectorize with group filter
  const results = await vectorize.query(queryEmbedding, {
    topK: limit,
    filter: {
      groupId: groupId,
    },
    returnMetadata: true,
  })

  // Filter by minimum score and format results
  return results.matches
    .filter((match: any) => match.score >= minScore)
    .map((match: any) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata as VectorMetadata,
    }))
}

/**
 * Delete a message embedding from Vectorize
 */
export async function deleteMessageEmbedding(
  env: Env,
  messageId: string
): Promise<void> {
  const vectorize = (env as any).VECTORIZE

  if (!vectorize) {
    return
  }

  await vectorize.deleteByIds([messageId])
}

/**
 * Delete all embeddings for a group
 */
export async function deleteGroupEmbeddings(
  env: Env,
  groupId: string
): Promise<void> {
  const vectorize = (env as any).VECTORIZE

  if (!vectorize) {
    return
  }

  // Vectorize doesn't support bulk delete by metadata filter
  // We need to query all vectors for the group first
  // For now, this is a limitation - in production you might
  // want to track vector IDs in D1 and delete by ID
  console.warn('Bulk delete by group not fully implemented')
}

/**
 * Build RAG context from similar messages for Brain
 */
export async function buildRAGContext(
  env: Env,
  query: string,
  groupId: string,
  options?: {
    limit?: number
    provider?: 'cloudflare' | 'openai'
    userId?: string
  }
): Promise<string> {
  const results = await searchSimilarMessages(env, query, groupId, {
    limit: options?.limit || 5,
    provider: options?.provider,
    userId: options?.userId,
    minScore: 0.6, // Higher threshold for RAG context
  })

  if (results.length === 0) {
    return ''
  }

  // Format results as context for the AI
  const contextMessages = results.map((result, index) => {
    const meta = result.metadata
    const author = meta.authorName || 'Someone'
    const date = new Date(meta.createdAt).toLocaleDateString()
    return `[${index + 1}] ${author} (${date}): "${meta.content}"`
  })

  return `
Here are relevant past conversations from this group that may help you respond:

${contextMessages.join('\n\n')}

Use this context to provide more informed and personalized responses. Reference specific past discussions when relevant.
`.trim()
}

/**
 * Get conversation history for a specific topic
 */
export async function getTopicHistory(
  env: Env,
  topic: string,
  groupId: string,
  options?: {
    limit?: number
    provider?: 'cloudflare' | 'openai'
    userId?: string
  }
): Promise<SearchResult[]> {
  return searchSimilarMessages(env, topic, groupId, {
    limit: options?.limit || 20,
    provider: options?.provider,
    userId: options?.userId,
    minScore: 0.55, // Slightly lower threshold for topic exploration
  })
}

/**
 * Find messages from a specific user about a topic
 */
export async function getUserMessagesAboutTopic(
  env: Env,
  topic: string,
  groupId: string,
  targetUserId: string,
  options?: {
    limit?: number
    provider?: 'cloudflare' | 'openai'
    userId?: string
  }
): Promise<SearchResult[]> {
  // Get all similar messages first
  const allResults = await searchSimilarMessages(env, topic, groupId, {
    limit: 50, // Get more to filter
    provider: options?.provider,
    userId: options?.userId,
    minScore: 0.5,
  })

  // Filter by user
  return allResults
    .filter((result) => result.metadata.userId === targetUserId)
    .slice(0, options?.limit || 10)
}
