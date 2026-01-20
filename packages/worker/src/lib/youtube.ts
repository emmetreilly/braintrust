import type { Env } from '../types'
import { callAI } from './ai-providers'

export interface YouTubeVideoInfo {
  videoId: string
  title: string
  channelName: string
  description: string
  duration?: string
  thumbnailUrl?: string
}

export interface YouTubeTranscript {
  text: string
  segments: TranscriptSegment[]
}

export interface TranscriptSegment {
  text: string
  start: number
  duration: number
}

export interface VideoSummary {
  summary: string
  keyPoints: string[]
  topics: string[]
  timestamps?: { time: string; description: string }[]
}

/**
 * Extract video ID from YouTube URL
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/**
 * Get YouTube video info using oEmbed (no API key needed)
 */
export async function getVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`

  const response = await fetch(oembedUrl)

  if (!response.ok) {
    throw new Error(`Failed to get video info: ${response.status}`)
  }

  const data = await response.json() as {
    title: string
    author_name: string
    thumbnail_url: string
  }

  return {
    videoId,
    title: data.title,
    channelName: data.author_name,
    description: '', // Not available from oEmbed
    thumbnailUrl: data.thumbnail_url,
  }
}

/**
 * Fetch YouTube transcript using third-party service
 * This uses the YouTube transcript API (community maintained)
 */
export async function getTranscript(videoId: string): Promise<YouTubeTranscript> {
  // Try fetching transcript from YouTube's timedtext API
  // This may not work for all videos (depends on captions availability)

  // First, try to get the video page to extract caption info
  const videoPageResponse = await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrainTrustBot/1.0)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }
  )

  if (!videoPageResponse.ok) {
    throw new Error('Failed to fetch video page')
  }

  const html = await videoPageResponse.text()

  // Extract captions data from the page
  const captionsMatch = html.match(/"captions":\s*({[^}]+playerCaptionsTracklistRenderer[^}]+})/s)

  if (!captionsMatch) {
    // Try alternative method: look for timedtext URL
    const timedtextMatch = html.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"]+/)

    if (timedtextMatch) {
      return fetchTimedText(timedtextMatch[0].replace(/\\u0026/g, '&'))
    }

    throw new Error('No captions available for this video')
  }

  // Parse caption tracks
  try {
    // Look for caption base URL
    const baseUrlMatch = html.match(/"captionTracks":\[{"baseUrl":"([^"]+)"/)

    if (baseUrlMatch) {
      const captionUrl = baseUrlMatch[1].replace(/\\u0026/g, '&')
      return fetchTimedText(captionUrl)
    }
  } catch {
    // Continue to fallback
  }

  throw new Error('Could not extract captions from video')
}

/**
 * Fetch and parse timedtext XML
 */
async function fetchTimedText(url: string): Promise<YouTubeTranscript> {
  // Add format=json3 for better parsing
  const jsonUrl = url.includes('fmt=')
    ? url.replace(/fmt=[^&]+/, 'fmt=json3')
    : url + '&fmt=json3'

  const response = await fetch(jsonUrl)

  if (!response.ok) {
    // Try XML format
    return fetchTimedTextXml(url)
  }

  const data = await response.json() as {
    events?: Array<{
      segs?: Array<{ utf8: string }>
      tStartMs?: number
      dDurationMs?: number
    }>
  }

  if (!data.events) {
    return fetchTimedTextXml(url)
  }

  const segments: TranscriptSegment[] = []
  const textParts: string[] = []

  for (const event of data.events) {
    if (event.segs) {
      const text = event.segs.map(s => s.utf8 || '').join('')
      if (text.trim()) {
        textParts.push(text)
        segments.push({
          text: text.trim(),
          start: (event.tStartMs || 0) / 1000,
          duration: (event.dDurationMs || 0) / 1000,
        })
      }
    }
  }

  return {
    text: textParts.join(' ').replace(/\s+/g, ' ').trim(),
    segments,
  }
}

/**
 * Fetch and parse timedtext XML format
 */
async function fetchTimedTextXml(url: string): Promise<YouTubeTranscript> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch captions')
  }

  const xml = await response.text()

  // Parse XML using regex (no DOM parser in Workers)
  const segments: TranscriptSegment[] = []
  const textParts: string[] = []

  const textMatches = xml.matchAll(/<text[^>]*start="([^"]*)"[^>]*dur="([^"]*)"[^>]*>([^<]*)<\/text>/g)

  for (const match of textMatches) {
    const start = parseFloat(match[1])
    const duration = parseFloat(match[2])
    const text = decodeXmlEntities(match[3]).trim()

    if (text) {
      textParts.push(text)
      segments.push({ text, start, duration })
    }
  }

  return {
    text: textParts.join(' ').replace(/\s+/g, ' ').trim(),
    segments,
  }
}

/**
 * Decode XML entities
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
}

/**
 * Format seconds to timestamp (MM:SS or HH:MM:SS)
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Summarize video transcript using AI
 */
export async function summarizeVideo(
  env: Env,
  videoInfo: YouTubeVideoInfo,
  transcript: YouTubeTranscript,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<VideoSummary> {
  const systemPrompt = `You are a video content summarizer. Summarize the following YouTube video transcript.
Return your response in this exact JSON format:
{
  "summary": "A 2-3 sentence summary of the video",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "topics": ["topic1", "topic2", "topic3"],
  "timestamps": [
    {"time": "0:00", "description": "Introduction"},
    {"time": "2:30", "description": "Main topic discussed"}
  ]
}

Only output valid JSON, nothing else.`

  const userMessage = `Video: ${videoInfo.title}
Channel: ${videoInfo.channelName}

Transcript:
${transcript.text.slice(0, 8000)}` // Limit transcript length

  const response = await callAI(
    options?.provider || 'claude',
    options?.apiKey || null,
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    1024
  )

  try {
    const parsed = JSON.parse(response.content)
    return {
      summary: parsed.summary || 'Unable to generate summary',
      keyPoints: parsed.keyPoints || [],
      topics: parsed.topics || [],
      timestamps: parsed.timestamps || [],
    }
  } catch {
    return {
      summary: response.content.slice(0, 500),
      keyPoints: [],
      topics: [],
    }
  }
}

/**
 * Full YouTube video processing pipeline
 */
export async function processYouTubeVideo(
  env: Env,
  url: string,
  options?: {
    apiKey?: string
    provider?: 'claude' | 'openai' | 'gemini'
  }
): Promise<{
  videoInfo: YouTubeVideoInfo
  transcript?: YouTubeTranscript
  summary?: VideoSummary
  error?: string
}> {
  const videoId = extractVideoId(url)

  if (!videoId) {
    throw new Error('Invalid YouTube URL')
  }

  // Get video info
  const videoInfo = await getVideoInfo(videoId)

  let transcript: YouTubeTranscript | undefined
  let summary: VideoSummary | undefined
  let error: string | undefined

  // Try to get transcript
  try {
    transcript = await getTranscript(videoId)

    // If we have transcript, generate summary
    if (transcript.text.length > 100) {
      summary = await summarizeVideo(env, videoInfo, transcript, options)
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to get transcript'
  }

  return {
    videoInfo,
    transcript,
    summary,
    error,
  }
}
