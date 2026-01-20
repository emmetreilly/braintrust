import type { Env } from '../types'
import { callAI } from './ai-providers'

export interface ParsedArticle {
  title: string
  content: string
  author?: string
  publishedDate?: string
  siteName: string
  description?: string
  imageUrl?: string
  wordCount: number
}

export interface ArticleSummary {
  summary: string
  keyPoints: string[]
  topics: string[]
}

/**
 * Extract readable content from a URL
 * Uses fetch + regex for basic extraction (no DOM parser in Workers)
 */
export async function parseArticle(url: string): Promise<ParsedArticle> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BrainTrustBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch article: ${response.status}`)
  }

  const html = await response.text()

  return extractArticleContent(html, url)
}

/**
 * Extract article content from HTML
 * Uses regex patterns since we don't have DOM parser in Workers
 */
function extractArticleContent(html: string, url: string): ParsedArticle {
  // Extract meta tags
  const title = extractMetaContent(html, 'og:title')
    || extractMetaContent(html, 'twitter:title')
    || extractTagContent(html, 'title')
    || 'Untitled'

  const description = extractMetaContent(html, 'og:description')
    || extractMetaContent(html, 'description')
    || extractMetaContent(html, 'twitter:description')

  const author = extractMetaContent(html, 'author')
    || extractMetaContent(html, 'article:author')

  const publishedDate = extractMetaContent(html, 'article:published_time')
    || extractMetaContent(html, 'datePublished')

  const siteName = extractMetaContent(html, 'og:site_name')
    || new URL(url).hostname.replace('www.', '')

  const imageUrl = extractMetaContent(html, 'og:image')
    || extractMetaContent(html, 'twitter:image')

  // Extract main content
  const content = extractMainContent(html)
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length

  return {
    title: cleanText(title),
    content: cleanText(content),
    author: author ? cleanText(author) : undefined,
    publishedDate,
    siteName: cleanText(siteName),
    description: description ? cleanText(description) : undefined,
    imageUrl,
    wordCount,
  }
}

/**
 * Extract content from meta tag
 */
function extractMetaContent(html: string, name: string): string | undefined {
  // Try property attribute (OG tags)
  const propertyMatch = html.match(
    new RegExp(`<meta[^>]*property=["'](?:og:)?${name}["'][^>]*content=["']([^"']*)["']`, 'i')
  )
  if (propertyMatch) return propertyMatch[1]

  // Try content before property
  const contentFirstMatch = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["'](?:og:)?${name}["']`, 'i')
  )
  if (contentFirstMatch) return contentFirstMatch[1]

  // Try name attribute
  const nameMatch = html.match(
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
  )
  if (nameMatch) return nameMatch[1]

  // Try content before name
  const contentNameMatch = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i')
  )
  if (contentNameMatch) return contentNameMatch[1]

  return undefined
}

/**
 * Extract content from a specific tag
 */
function extractTagContent(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
  return match ? match[1] : undefined
}

/**
 * Extract main article content
 * Prioritizes article, main, and content containers
 */
function extractMainContent(html: string): string {
  // Remove script and style tags
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // Try to find article content
  const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (articleMatch) {
    content = articleMatch[1]
  } else {
    // Try main tag
    const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    if (mainMatch) {
      content = mainMatch[1]
    } else {
      // Try common content divs
      const contentDivMatch = content.match(
        /<div[^>]*(?:class|id)=["'][^"']*(?:content|article|post|entry|story)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      )
      if (contentDivMatch) {
        content = contentDivMatch[1]
      }
    }
  }

  // Extract text from paragraphs
  const paragraphs: string[] = []
  const pMatches = content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)
  for (const match of pMatches) {
    const text = stripHtml(match[1]).trim()
    if (text.length > 50) { // Filter out short paragraphs
      paragraphs.push(text)
    }
  }

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n')
  }

  // Fallback: strip all HTML and return
  return stripHtml(content)
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()
}

/**
 * Summarize article content using AI
 */
export async function summarizeArticle(
  env: Env,
  article: ParsedArticle,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<ArticleSummary> {
  const systemPrompt = `You are a content summarizer. Summarize the following article concisely.
Return your response in this exact JSON format:
{
  "summary": "A 2-3 sentence summary of the article",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "topics": ["topic1", "topic2", "topic3"]
}

Only output valid JSON, nothing else.`

  const userMessage = `Title: ${article.title}
Source: ${article.siteName}
${article.author ? `Author: ${article.author}` : ''}

Content:
${article.content.slice(0, 6000)}` // Limit content length

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    1024
  )

  try {
    // Parse JSON response
    const parsed = JSON.parse(response.content)
    return {
      summary: parsed.summary || 'Unable to generate summary',
      keyPoints: parsed.keyPoints || [],
      topics: parsed.topics || [],
    }
  } catch {
    // Fallback if JSON parsing fails
    return {
      summary: response.content.slice(0, 500),
      keyPoints: [],
      topics: [],
    }
  }
}

/**
 * Detect URLs in message content
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"\[\]]+/gi
  const matches = text.match(urlRegex) || []
  return [...new Set(matches)] // Remove duplicates
}

/**
 * Determine content type from URL
 */
export function getContentType(url: string): 'article' | 'video' | 'tweet' | 'image' | 'unknown' {
  const hostname = new URL(url).hostname.toLowerCase()
  const pathname = new URL(url).pathname.toLowerCase()

  // Video platforms
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
    return 'video'
  }
  if (hostname.includes('vimeo.com')) {
    return 'video'
  }
  if (hostname.includes('tiktok.com')) {
    return 'video'
  }

  // Social media
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
    return 'tweet'
  }

  // Images
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(pathname)) {
    return 'image'
  }

  // Default to article
  return 'article'
}

/**
 * Store parsed media in database
 */
export async function storeMediaContent(
  env: Env,
  data: {
    messageId: string
    groupId: string
    url: string
    type: string
    title?: string
    content?: string
    summary?: string
  }
): Promise<string> {
  const id = crypto.randomUUID()

  await env.DB.prepare(`
    INSERT INTO media_content (id, message_id, group_id, url, type, title, content, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    data.messageId,
    data.groupId,
    data.url,
    data.type,
    data.title || null,
    data.content || null,
    data.summary || null
  ).run()

  return id
}
