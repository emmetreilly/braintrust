import type { Env } from '../types'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  publishedDate?: string
}

export interface SearchResponse {
  results: SearchResult[]
  query: string
  provider: 'brave' | 'serper' | 'tavily'
}

/**
 * Search the web using Brave Search API
 * Free tier: 2000 queries/month
 */
async function searchBrave(
  query: string,
  apiKey: string,
  options?: { count?: number }
): Promise<SearchResult[]> {
  const count = options?.count || 5

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', count.toString())
  url.searchParams.set('safesearch', 'moderate')

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Brave Search error: ${error}`)
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title: string
        url: string
        description: string
        page_age?: string
        meta_url?: { hostname: string }
      }>
    }
  }

  return (data.web?.results || []).map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.description,
    source: result.meta_url?.hostname || new URL(result.url).hostname,
    publishedDate: result.page_age,
  }))
}

/**
 * Search using Serper.dev API
 * Paid: $50/month for 50k queries
 */
async function searchSerper(
  query: string,
  apiKey: string,
  options?: { count?: number }
): Promise<SearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: options?.count || 5,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Serper error: ${error}`)
  }

  const data = await response.json() as {
    organic?: Array<{
      title: string
      link: string
      snippet: string
      date?: string
    }>
  }

  return (data.organic || []).map((result) => ({
    title: result.title,
    url: result.link,
    snippet: result.snippet,
    source: new URL(result.link).hostname,
    publishedDate: result.date,
  }))
}

/**
 * Search using Tavily API
 * Built for AI fact-checking
 */
async function searchTavily(
  query: string,
  apiKey: string,
  options?: { count?: number; searchDepth?: 'basic' | 'advanced' }
): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: options?.searchDepth || 'basic',
      max_results: options?.count || 5,
      include_answer: false,
      include_raw_content: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Tavily error: ${error}`)
  }

  const data = await response.json() as {
    results?: Array<{
      title: string
      url: string
      content: string
      score: number
      published_date?: string
    }>
  }

  return (data.results || []).map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content,
    source: new URL(result.url).hostname,
    publishedDate: result.published_date,
  }))
}

/**
 * Main search function that tries available providers
 */
export async function webSearch(
  env: Env,
  query: string,
  options?: {
    count?: number
    provider?: 'brave' | 'serper' | 'tavily'
  }
): Promise<SearchResponse> {
  const count = options?.count || 5

  // Try providers in order of preference
  const providers: Array<{
    name: 'brave' | 'serper' | 'tavily'
    keyName: string
    search: (query: string, apiKey: string, opts?: { count?: number }) => Promise<SearchResult[]>
  }> = [
    { name: 'brave', keyName: 'BRAVE_API_KEY', search: searchBrave },
    { name: 'serper', keyName: 'SERPER_API_KEY', search: searchSerper },
    { name: 'tavily', keyName: 'TAVILY_API_KEY', search: searchTavily },
  ]

  // If specific provider requested, try it first
  if (options?.provider) {
    const provider = providers.find(p => p.name === options.provider)
    if (provider) {
      providers.unshift(providers.splice(providers.indexOf(provider), 1)[0])
    }
  }

  let lastError: Error | null = null

  for (const provider of providers) {
    const apiKey = (env as any)[provider.keyName]

    if (!apiKey) continue

    try {
      const results = await provider.search(query, apiKey, { count })
      return {
        results,
        query,
        provider: provider.name,
      }
    } catch (error) {
      lastError = error as Error
      console.error(`${provider.name} search failed:`, error)
      // Continue to next provider
    }
  }

  // If no providers available, return empty results
  if (lastError) {
    throw lastError
  }

  throw new Error('No search API keys configured. Set BRAVE_API_KEY, SERPER_API_KEY, or TAVILY_API_KEY.')
}

/**
 * Search for authoritative sources on a topic
 * Adds site filters for more reliable results
 */
export async function searchAuthoritativeSources(
  env: Env,
  query: string,
  options?: { count?: number }
): Promise<SearchResponse> {
  // Add authoritative site filters
  const enhancedQuery = `${query} site:wikipedia.org OR site:britannica.com OR site:snopes.com OR site:reuters.com OR site:apnews.com OR site:bbc.com`

  return webSearch(env, enhancedQuery, { count: options?.count || 5 })
}

/**
 * Search for news on a topic
 */
export async function searchNews(
  env: Env,
  query: string,
  options?: { count?: number }
): Promise<SearchResponse> {
  const newsQuery = `${query} news`
  return webSearch(env, newsQuery, { count: options?.count || 5 })
}

/**
 * Search for academic/research sources
 */
export async function searchAcademic(
  env: Env,
  query: string,
  options?: { count?: number }
): Promise<SearchResponse> {
  const academicQuery = `${query} site:arxiv.org OR site:scholar.google.com OR site:ncbi.nlm.nih.gov OR site:nature.com OR site:sciencedirect.com`
  return webSearch(env, academicQuery, { count: options?.count || 5 })
}

/**
 * Get source credibility score (basic heuristic)
 */
export function getSourceCredibility(url: string): 'high' | 'medium' | 'low' {
  const hostname = new URL(url).hostname.toLowerCase()

  // High credibility sources
  const highCredibility = [
    'wikipedia.org',
    'britannica.com',
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'nytimes.com',
    'washingtonpost.com',
    'theguardian.com',
    'nature.com',
    'science.org',
    'arxiv.org',
    'ncbi.nlm.nih.gov',
    'snopes.com',
    'factcheck.org',
    'politifact.com',
    'gov',
    'edu',
  ]

  // Low credibility patterns
  const lowCredibility = [
    'blog',
    'wordpress.com',
    'medium.com',
    'substack.com',
    'reddit.com',
    'facebook.com',
    'twitter.com',
  ]

  for (const source of highCredibility) {
    if (hostname.includes(source)) return 'high'
  }

  for (const source of lowCredibility) {
    if (hostname.includes(source)) return 'low'
  }

  return 'medium'
}
