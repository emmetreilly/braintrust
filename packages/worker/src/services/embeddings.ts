import type { Env } from '../types'

interface EmbeddingResult {
  id: string
  success: boolean
  error?: string
}

export class EmbeddingService {
  private env: Env

  constructor(env: Env) {
    this.env = env
  }

  /**
   * Generate embeddings for unprocessed indexed items
   * Uses Cloudflare AI (no external API key needed)
   */
  async processUnembeddedItems(workspaceId: string, limit: number = 100): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = []

    // Get items without embeddings
    const items = await this.env.DB.prepare(`
      SELECT id, title, content, source, author_name, channel_name, created_at
      FROM indexed_items
      WHERE workspace_id = ? AND has_embedding = 0
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(workspaceId, limit).all<{
      id: string
      title: string | null
      content: string
      source: string
      author_name: string | null
      channel_name: string | null
      created_at: string
    }>()

    if (!items.results?.length) {
      return results
    }

    console.log(`Processing ${items.results.length} items for embeddings`)

    // Process items one at a time for Cloudflare AI
    for (const item of items.results) {
      try {
        // Build text to embed
        const parts = []
        if (item.title) parts.push(`Title: ${item.title}`)
        if (item.channel_name) parts.push(`Channel: ${item.channel_name}`)
        if (item.author_name) parts.push(`Author: ${item.author_name}`)
        parts.push(item.content.slice(0, 2000)) // Limit content for embedding
        const text = parts.join('\n')

        // Generate embedding via Cloudflare AI
        const embeddingResponse = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [text],
        }) as { data: number[][] }

        if (!embeddingResponse.data?.[0]) {
          throw new Error('Failed to generate embedding')
        }

        const embedding = embeddingResponse.data[0]

        // Store embedding in Vectorize
        if (this.env.VECTORIZE) {
          await this.env.VECTORIZE.upsert([{
            id: item.id,
            values: embedding,
            metadata: {
              workspace_id: workspaceId,
              source: item.source,
              title: item.title?.slice(0, 100) || '',
              channel_name: item.channel_name || '',
              author_name: item.author_name || '',
              created_at: item.created_at,
            },
          }])
        }

        // Mark item as having embedding
        await this.env.DB.prepare(`
          UPDATE indexed_items
          SET has_embedding = 1, embedding_updated_at = datetime('now')
          WHERE id = ?
        `).bind(item.id).run()

        results.push({ id: item.id, success: true })
      } catch (err) {
        console.error('Embedding error for item', item.id, err)
        results.push({
          id: item.id,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return results
  }

  /**
   * Generate embedding for a search query
   * Uses Cloudflare AI (no external API key needed)
   */
  async embedQuery(query: string): Promise<number[] | null> {
    try {
      const response = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: [query],
      }) as { data: number[][] }

      return response.data?.[0] || null
    } catch (err) {
      console.error('Query embedding error:', err)
      return null
    }
  }

  /**
   * Search for similar items using vector similarity
   */
  async searchSimilar(
    workspaceId: string,
    queryEmbedding: number[],
    topK: number = 20
  ): Promise<Array<{ id: string; score: number }>> {
    if (!this.env.VECTORIZE) {
      return []
    }

    try {
      const results = await this.env.VECTORIZE.query(queryEmbedding, {
        topK,
        filter: { workspace_id: workspaceId },
      })

      return results.matches?.map((m: any) => ({
        id: m.id,
        score: m.score,
      })) || []
    } catch (err) {
      console.error('Vector search error:', err)
      return []
    }
  }
}
