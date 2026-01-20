import type { Env, AIProvider } from '../types'
import { decryptApiKey } from './auth'

// Embedding dimensions by provider
const EMBEDDING_DIMENSIONS = {
  cloudflare: 768,  // @cf/baai/bge-base-en-v1.5
  openai: 1536,     // text-embedding-3-small
} as const

export interface EmbeddingResult {
  embedding: number[]
  provider: string
  dimensions: number
}

/**
 * Generate embeddings using Cloudflare AI (default) or OpenAI
 */
export async function generateEmbedding(
  env: Env,
  text: string,
  options?: {
    provider?: 'cloudflare' | 'openai'
    userId?: string // For fetching user's OpenAI key
  }
): Promise<EmbeddingResult> {
  const provider = options?.provider || 'cloudflare'

  // Clean and truncate text (most embedding models have token limits)
  const cleanedText = text.trim().slice(0, 8000)

  if (provider === 'openai' && options?.userId) {
    return generateOpenAIEmbedding(env, cleanedText, options.userId)
  }

  // Default to Cloudflare AI
  return generateCloudflareEmbedding(env, cleanedText)
}

/**
 * Generate embeddings using Cloudflare AI
 * Uses @cf/baai/bge-base-en-v1.5 model (768 dimensions)
 */
async function generateCloudflareEmbedding(
  env: Env,
  text: string
): Promise<EmbeddingResult> {
  // Cloudflare AI binding - needs to be added to wrangler.toml
  const ai = (env as any).AI

  if (!ai) {
    throw new Error('Cloudflare AI binding not configured')
  }

  const response = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  })

  if (!response?.data?.[0]) {
    throw new Error('Failed to generate embedding from Cloudflare AI')
  }

  return {
    embedding: response.data[0],
    provider: 'cloudflare',
    dimensions: EMBEDDING_DIMENSIONS.cloudflare,
  }
}

/**
 * Generate embeddings using OpenAI API
 * Uses text-embedding-3-small model (1536 dimensions)
 */
async function generateOpenAIEmbedding(
  env: Env,
  text: string,
  userId: string
): Promise<EmbeddingResult> {
  // Get user's OpenAI API key
  const row = await env.DB.prepare(
    'SELECT encrypted_key FROM user_api_keys WHERE user_id = ? AND provider = ? AND is_valid = 1'
  )
    .bind(userId, 'openai')
    .first()

  if (!row?.encrypted_key) {
    // Fallback to Cloudflare if no OpenAI key
    return generateCloudflareEmbedding(env, text)
  }

  const apiKey = decryptApiKey(row.encrypted_key as string, env.JWT_SECRET)

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('OpenAI embedding error:', error)
    // Fallback to Cloudflare
    return generateCloudflareEmbedding(env, text)
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>
  }

  return {
    embedding: data.data[0].embedding,
    provider: 'openai',
    dimensions: EMBEDDING_DIMENSIONS.openai,
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddings(
  env: Env,
  texts: string[],
  options?: {
    provider?: 'cloudflare' | 'openai'
    userId?: string
  }
): Promise<EmbeddingResult[]> {
  // For now, process sequentially. Could be optimized with batching.
  const results: EmbeddingResult[] = []

  for (const text of texts) {
    const result = await generateEmbedding(env, text, options)
    results.push(result)
  }

  return results
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Prepare text for embedding - combine message content with metadata
 */
export function prepareMessageForEmbedding(message: {
  content: string
  author_name?: string
  type?: string
}): string {
  const parts: string[] = []

  if (message.author_name) {
    parts.push(`${message.author_name} said:`)
  }

  parts.push(message.content)

  return parts.join(' ')
}
