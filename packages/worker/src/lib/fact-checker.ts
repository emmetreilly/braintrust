import type { Env } from '../types'
import { webSearch, searchAuthoritativeSources, getSourceCredibility, type SearchResult } from './web-search'
import { callAI } from './ai-providers'

export type FactCheckVerdict = 'true' | 'false' | 'partially_true' | 'unverifiable' | 'misleading'

export interface FactCheckResult {
  claim: string
  verdict: FactCheckVerdict
  confidence: 'high' | 'medium' | 'low'
  explanation: string
  sources: FactCheckSource[]
  relatedClaims?: string[]
}

export interface FactCheckSource {
  title: string
  url: string
  snippet: string
  credibility: 'high' | 'medium' | 'low'
  relevance: number // 0-1
}

/**
 * Extract factual claims from a message
 */
export async function extractClaims(
  env: Env,
  message: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<string[]> {
  const systemPrompt = `You are a claim extractor. Identify factual claims that can be verified from the given text.
Only extract claims that:
1. Make a specific factual assertion
2. Can potentially be verified with evidence
3. Are not opinions or subjective statements

Return a JSON array of claim strings. If no verifiable claims found, return an empty array.
Example: ["The moon landing was in 1969", "Einstein was born in Germany"]

Only output valid JSON, nothing else.`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: message }],
    512
  )

  try {
    const claims = JSON.parse(response.content)
    return Array.isArray(claims) ? claims : []
  } catch {
    return []
  }
}

/**
 * Fact check a single claim
 */
export async function factCheckClaim(
  env: Env,
  claim: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<FactCheckResult> {
  // Search for information about the claim
  let searchResults: SearchResult[] = []

  try {
    // Try authoritative sources first
    const authResults = await searchAuthoritativeSources(env, claim, { count: 3 })
    searchResults = authResults.results

    // Add general search results
    const generalResults = await webSearch(env, claim, { count: 3 })
    searchResults = [...searchResults, ...generalResults.results]
  } catch (error) {
    console.error('Search failed:', error)
    // Continue without search results
  }

  // Format sources for AI
  const sourcesContext = searchResults.map((result, i) => {
    const credibility = getSourceCredibility(result.url)
    return `[${i + 1}] ${result.title}
Source: ${result.source} (credibility: ${credibility})
${result.snippet}`
  }).join('\n\n')

  // Use AI to analyze and verify
  const systemPrompt = `You are a fact checker. Analyze the claim and evidence to determine its veracity.

You must respond in this exact JSON format:
{
  "verdict": "true" | "false" | "partially_true" | "unverifiable" | "misleading",
  "confidence": "high" | "medium" | "low",
  "explanation": "Clear explanation of your verdict in 2-3 sentences",
  "sourceRelevance": [0.8, 0.6, ...] // Relevance score 0-1 for each source
}

Verdicts:
- true: The claim is accurate based on evidence
- false: The claim is inaccurate based on evidence
- partially_true: The claim contains some truth but is incomplete or has inaccuracies
- misleading: The claim is technically true but presented in a misleading way
- unverifiable: Cannot determine truth with available evidence

Be objective and base your verdict on evidence, not assumptions. Only output valid JSON.`

  const userMessage = `Claim to verify: "${claim}"

Evidence from web search:
${sourcesContext || 'No search results available'}

Analyze this claim and determine if it's true, false, partially true, misleading, or unverifiable.`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    1024
  )

  try {
    const analysis = JSON.parse(response.content)

    // Build sources with relevance scores
    const sources: FactCheckSource[] = searchResults.map((result, i) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      credibility: getSourceCredibility(result.url),
      relevance: analysis.sourceRelevance?.[i] || 0.5,
    }))

    return {
      claim,
      verdict: analysis.verdict || 'unverifiable',
      confidence: analysis.confidence || 'low',
      explanation: analysis.explanation || 'Unable to determine',
      sources,
    }
  } catch {
    return {
      claim,
      verdict: 'unverifiable',
      confidence: 'low',
      explanation: 'Unable to analyze claim with available information.',
      sources: searchResults.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        credibility: getSourceCredibility(result.url),
        relevance: 0.5,
      })),
    }
  }
}

/**
 * Fact check multiple claims in a message
 */
export async function factCheckMessage(
  env: Env,
  message: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
    maxClaims?: number
  }
): Promise<FactCheckResult[]> {
  const maxClaims = options?.maxClaims || 3

  // Extract claims from the message
  const claims = await extractClaims(env, message, options)

  if (claims.length === 0) {
    return []
  }

  // Limit number of claims to check
  const claimsToCheck = claims.slice(0, maxClaims)

  // Check each claim
  const results: FactCheckResult[] = []

  for (const claim of claimsToCheck) {
    const result = await factCheckClaim(env, claim, options)
    results.push(result)
  }

  return results
}

/**
 * Quick fact check without search (uses AI knowledge)
 */
export async function quickFactCheck(
  env: Env,
  claim: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<FactCheckResult> {
  const systemPrompt = `You are a fact checker. Analyze the claim using your knowledge.

Respond in this exact JSON format:
{
  "verdict": "true" | "false" | "partially_true" | "unverifiable" | "misleading",
  "confidence": "high" | "medium" | "low",
  "explanation": "Clear explanation in 2-3 sentences"
}

Important: Your knowledge has a cutoff date, so for recent events, mark as unverifiable.
Be conservative - if unsure, lower your confidence or mark as unverifiable.

Only output valid JSON.`

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: `Claim: "${claim}"` }],
    512
  )

  try {
    const analysis = JSON.parse(response.content)
    return {
      claim,
      verdict: analysis.verdict || 'unverifiable',
      confidence: analysis.confidence || 'low',
      explanation: analysis.explanation || 'Unable to determine',
      sources: [],
    }
  } catch {
    return {
      claim,
      verdict: 'unverifiable',
      confidence: 'low',
      explanation: 'Unable to analyze this claim.',
      sources: [],
    }
  }
}

/**
 * Format fact check result for display
 */
export function formatFactCheckResult(result: FactCheckResult): string {
  const verdictEmoji = {
    true: '✅',
    false: '❌',
    partially_true: '⚠️',
    misleading: '🟡',
    unverifiable: '❓',
  }

  const verdictLabel = {
    true: 'True',
    false: 'False',
    partially_true: 'Partially True',
    misleading: 'Misleading',
    unverifiable: 'Unverifiable',
  }

  let formatted = `${verdictEmoji[result.verdict]} **${verdictLabel[result.verdict]}** (${result.confidence} confidence)\n\n`
  formatted += `**Claim:** "${result.claim}"\n\n`
  formatted += `**Analysis:** ${result.explanation}\n\n`

  if (result.sources.length > 0) {
    formatted += `**Sources:**\n`
    for (const source of result.sources.slice(0, 3)) {
      formatted += `- [${source.title}](${source.url}) (${source.credibility} credibility)\n`
    }
  }

  return formatted
}

/**
 * Store fact check result in database
 */
export async function storeFactCheck(
  env: Env,
  groupId: string,
  messageId: string | null,
  result: FactCheckResult
): Promise<string> {
  const id = crypto.randomUUID()

  await env.DB.prepare(`
    INSERT INTO fact_checks (id, group_id, message_id, claim, verdict, explanation, sources)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    groupId,
    messageId,
    result.claim,
    result.verdict,
    result.explanation,
    JSON.stringify(result.sources.map(s => s.url))
  ).run()

  return id
}
