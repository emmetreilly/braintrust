import type { Env } from '../types'
import { callAI } from './ai-providers'

export interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  description?: string
  imageUrl?: string
  publishedAt?: string
  author?: string
  category?: string
}

export interface Recommendation {
  id: string
  type: 'news' | 'article' | 'paper' | 'video' | 'discussion'
  title: string
  url: string
  source: string
  description?: string
  relevanceScore: number
  reason: string
  topics: string[]
}

/**
 * Fetch top stories from Hacker News
 */
export async function fetchHackerNews(
  options?: { limit?: number; type?: 'top' | 'new' | 'best' }
): Promise<NewsItem[]> {
  const type = options?.type || 'top'
  const limit = options?.limit || 10

  // Get story IDs
  const idsResponse = await fetch(
    `https://hacker-news.firebaseio.com/v0/${type}stories.json`
  )
  const storyIds = (await idsResponse.json()) as number[]

  // Fetch story details (limit to reduce API calls)
  const stories: NewsItem[] = []

  for (const id of storyIds.slice(0, limit)) {
    const storyResponse = await fetch(
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`
    )
    const story = (await storyResponse.json()) as {
      id: number
      title: string
      url?: string
      by: string
      time: number
      score: number
      type: string
    }

    if (story && story.type === 'story' && story.url) {
      stories.push({
        id: story.id.toString(),
        title: story.title,
        url: story.url,
        source: 'Hacker News',
        author: story.by,
        publishedAt: new Date(story.time * 1000).toISOString(),
        category: 'tech',
      })
    }
  }

  return stories
}

/**
 * Fetch papers from arXiv
 */
export async function fetchArxiv(
  query: string,
  options?: { limit?: number; category?: string }
): Promise<NewsItem[]> {
  const limit = options?.limit || 10
  const category = options?.category || 'cs.AI' // Default to AI papers

  const searchQuery = query
    ? `search_query=all:${encodeURIComponent(query)}`
    : `search_query=cat:${category}`

  const url = `https://export.arxiv.org/api/query?${searchQuery}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`

  const response = await fetch(url)
  const xml = await response.text()

  // Parse XML (basic regex parsing for Workers)
  const entries: NewsItem[] = []
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)

  for (const match of entryMatches) {
    const entry = match[1]

    const idMatch = entry.match(/<id>([^<]+)<\/id>/)
    const titleMatch = entry.match(/<title>([^<]+)<\/title>/)
    const summaryMatch = entry.match(/<summary>([^<]+)<\/summary>/)
    const publishedMatch = entry.match(/<published>([^<]+)<\/published>/)
    const authorMatch = entry.match(/<author><name>([^<]+)<\/name>/)

    if (idMatch && titleMatch) {
      const arxivId = idMatch[1].split('/').pop() || ''
      entries.push({
        id: arxivId,
        title: titleMatch[1].replace(/\s+/g, ' ').trim(),
        url: idMatch[1].replace('abs', 'pdf'), // Direct to PDF
        source: 'arXiv',
        description: summaryMatch?.[1].replace(/\s+/g, ' ').trim().slice(0, 300),
        author: authorMatch?.[1],
        publishedAt: publishedMatch?.[1],
        category: 'research',
      })
    }
  }

  return entries
}

/**
 * Fetch news using NewsAPI (requires API key)
 */
export async function fetchNewsAPI(
  env: Env,
  options?: {
    query?: string
    category?: string
    country?: string
    limit?: number
  }
): Promise<NewsItem[]> {
  const apiKey = (env as any).NEWS_API_KEY
  if (!apiKey) {
    console.warn('NEWS_API_KEY not configured')
    return []
  }

  const limit = options?.limit || 10
  const params = new URLSearchParams({
    apiKey,
    pageSize: limit.toString(),
  })

  let endpoint = 'https://newsapi.org/v2/'

  if (options?.query) {
    endpoint += 'everything'
    params.set('q', options.query)
    params.set('sortBy', 'relevancy')
  } else {
    endpoint += 'top-headlines'
    params.set('country', options?.country || 'us')
    if (options?.category) {
      params.set('category', options.category)
    }
  }

  const response = await fetch(`${endpoint}?${params.toString()}`)

  if (!response.ok) {
    console.error('NewsAPI error:', await response.text())
    return []
  }

  const data = (await response.json()) as {
    articles: Array<{
      title: string
      url: string
      source: { name: string }
      description: string
      urlToImage?: string
      publishedAt: string
      author?: string
    }>
  }

  return data.articles.map((article, i) => ({
    id: `news-${i}-${Date.now()}`,
    title: article.title,
    url: article.url,
    source: article.source.name,
    description: article.description,
    imageUrl: article.urlToImage,
    publishedAt: article.publishedAt,
    author: article.author || undefined,
    category: options?.category,
  }))
}

/**
 * Fetch trending topics from Reddit
 */
export async function fetchRedditTrending(
  subreddit: string,
  options?: { limit?: number; sort?: 'hot' | 'top' | 'new' }
): Promise<NewsItem[]> {
  const limit = options?.limit || 10
  const sort = options?.sort || 'hot'

  const response = await fetch(
    `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`,
    {
      headers: {
        'User-Agent': 'BrainTrustBot/1.0',
      },
    }
  )

  if (!response.ok) {
    console.error('Reddit API error')
    return []
  }

  const data = (await response.json()) as {
    data: {
      children: Array<{
        data: {
          id: string
          title: string
          url: string
          selftext?: string
          author: string
          created_utc: number
          permalink: string
        }
      }>
    }
  }

  return data.data.children.map((post) => ({
    id: post.data.id,
    title: post.data.title,
    url: post.data.url.startsWith('http')
      ? post.data.url
      : `https://reddit.com${post.data.permalink}`,
    source: `r/${subreddit}`,
    description: post.data.selftext?.slice(0, 200),
    author: post.data.author,
    publishedAt: new Date(post.data.created_utc * 1000).toISOString(),
    category: 'discussion',
  }))
}

/**
 * Extract group interests from conversation history
 */
export async function extractGroupInterests(
  env: Env,
  groupId: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<string[]> {
  // Get recent messages
  const rows = await env.DB.prepare(`
    SELECT content FROM messages
    WHERE group_id = ? AND type = 'text'
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(groupId).all()

  const messages = (rows.results || []).map((r: any) => r.content).join('\n')

  if (messages.length < 100) {
    return []
  }

  const systemPrompt = `Analyze the group chat messages and extract the main topics and interests.
Return a JSON array of 5-10 interest/topic keywords that describe what this group talks about.
Example: ["AI", "startups", "productivity", "cooking", "travel"]
Only output valid JSON array.`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: messages.slice(0, 6000) }],
    256
  )

  try {
    const interests = JSON.parse(response.content)
    return Array.isArray(interests) ? interests : []
  } catch {
    return []
  }
}

/**
 * Score content relevance to group interests
 */
export async function scoreRelevance(
  env: Env,
  content: { title: string; description?: string },
  interests: string[],
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<{ score: number; reason: string; matchedTopics: string[] }> {
  if (interests.length === 0) {
    return { score: 0.5, reason: 'No group interests configured', matchedTopics: [] }
  }

  const systemPrompt = `You are evaluating content relevance for a group chat.
The group is interested in: ${interests.join(', ')}

Rate how relevant this content is to the group's interests.
Return JSON: {"score": 0.0-1.0, "reason": "brief explanation", "matchedTopics": ["topic1"]}
Only output valid JSON.`

  const userMessage = `Title: ${content.title}
${content.description ? `Description: ${content.description}` : ''}`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    256
  )

  try {
    const result = JSON.parse(response.content)
    return {
      score: Math.min(1, Math.max(0, result.score || 0.5)),
      reason: result.reason || 'Relevance could not be determined',
      matchedTopics: result.matchedTopics || [],
    }
  } catch {
    return { score: 0.5, reason: 'Unable to analyze', matchedTopics: [] }
  }
}

/**
 * Generate recommendations for a group
 */
export async function generateRecommendations(
  env: Env,
  groupId: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
    limit?: number
    sources?: Array<'hackernews' | 'arxiv' | 'news' | 'reddit'>
  }
): Promise<Recommendation[]> {
  const limit = options?.limit || 5
  const sources = options?.sources || ['hackernews', 'arxiv', 'news']

  // Get group interests
  const interests = await extractGroupInterests(env, groupId, options)

  if (interests.length === 0) {
    // No interests yet, return general recommendations
    const hnStories = await fetchHackerNews({ limit: 5 })
    return hnStories.map((story, i) => ({
      id: `rec-${story.id}`,
      type: 'article' as const,
      title: story.title,
      url: story.url,
      source: story.source,
      relevanceScore: 0.5,
      reason: 'Trending on Hacker News',
      topics: ['tech'],
    }))
  }

  // Fetch from multiple sources
  const allContent: NewsItem[] = []

  if (sources.includes('hackernews')) {
    const hn = await fetchHackerNews({ limit: 10 })
    allContent.push(...hn)
  }

  if (sources.includes('arxiv')) {
    // Search arxiv for top interest
    const arxiv = await fetchArxiv(interests[0], { limit: 5 })
    allContent.push(...arxiv)
  }

  if (sources.includes('news')) {
    // Search news for top interests
    for (const interest of interests.slice(0, 2)) {
      const news = await fetchNewsAPI(env, { query: interest, limit: 5 })
      allContent.push(...news)
    }
  }

  if (sources.includes('reddit')) {
    // Get from relevant subreddits based on interests
    const techSubreddits = ['technology', 'programming', 'MachineLearning']
    for (const sub of techSubreddits.slice(0, 2)) {
      const reddit = await fetchRedditTrending(sub, { limit: 5 })
      allContent.push(...reddit)
    }
  }

  // Score each piece of content
  const scoredContent: Array<NewsItem & { relevance: Awaited<ReturnType<typeof scoreRelevance>> }> = []

  for (const item of allContent.slice(0, 20)) { // Limit scoring to save API calls
    const relevance = await scoreRelevance(
      env,
      { title: item.title, description: item.description },
      interests,
      options
    )
    scoredContent.push({ ...item, relevance })
  }

  // Sort by relevance and return top results
  scoredContent.sort((a, b) => b.relevance.score - a.relevance.score)

  return scoredContent.slice(0, limit).map((item) => ({
    id: `rec-${item.id}`,
    type: item.category === 'research' ? 'paper' : item.category === 'discussion' ? 'discussion' : 'article',
    title: item.title,
    url: item.url,
    source: item.source,
    description: item.description,
    relevanceScore: item.relevance.score,
    reason: item.relevance.reason,
    topics: item.relevance.matchedTopics,
  }))
}

/**
 * Store recommendation in database
 */
export async function storeRecommendation(
  env: Env,
  groupId: string,
  recommendation: Recommendation
): Promise<string> {
  const id = crypto.randomUUID()

  await env.DB.prepare(`
    INSERT INTO recommendations
    (id, group_id, type, title, url, source, relevance_score, reason, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    id,
    groupId,
    recommendation.type,
    recommendation.title,
    recommendation.url,
    recommendation.source,
    recommendation.relevanceScore,
    recommendation.reason
  ).run()

  return id
}

/**
 * Get pending recommendations for a group
 */
export async function getPendingRecommendations(
  env: Env,
  groupId: string,
  limit: number = 5
): Promise<Recommendation[]> {
  const rows = await env.DB.prepare(`
    SELECT id, type, title, url, source, relevance_score, reason
    FROM recommendations
    WHERE group_id = ? AND status = 'pending'
    ORDER BY relevance_score DESC
    LIMIT ?
  `).bind(groupId, limit).all()

  return (rows.results || []).map((row: any) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    url: row.url,
    source: row.source,
    relevanceScore: row.relevance_score,
    reason: row.reason,
    topics: [],
  }))
}

/**
 * Mark recommendation as posted or dismissed
 */
export async function updateRecommendationStatus(
  env: Env,
  recommendationId: string,
  status: 'posted' | 'dismissed'
): Promise<void> {
  await env.DB.prepare(`
    UPDATE recommendations SET status = ? WHERE id = ?
  `).bind(status, recommendationId).run()
}

/**
 * Format recommendation for posting in chat
 */
export function formatRecommendation(rec: Recommendation): string {
  const typeEmoji = {
    news: '📰',
    article: '📄',
    paper: '📚',
    video: '🎬',
    discussion: '💬',
  }

  return `${typeEmoji[rec.type]} **Found something you might like:**

[${rec.title}](${rec.url})

_${rec.reason}_
_Source: ${rec.source}_`
}
