import type { AIProvider } from '../types'

interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AIResponse {
  content: string
  provider: AIProvider
}

// Claude (Anthropic) API
async function callClaude(
  apiKey: string,
  systemPrompt: string,
  messages: AIMessage[],
  maxTokens: number = 1024
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${error}`)
  }

  const data = await response.json() as { content: Array<{ type: string; text: string }> }
  return data.content[0]?.text || ''
}

// OpenAI API
async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  messages: AIMessage[],
  maxTokens: number = 1024
): Promise<string> {
  const allMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ]

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages: allMessages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${error}`)
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices[0]?.message?.content || ''
}

// Google Gemini API
async function callGemini(
  apiKey: string,
  systemPrompt: string,
  messages: AIMessage[],
  maxTokens: number = 1024
): Promise<string> {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
        },
      }),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error: ${error}`)
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }
  return data.candidates[0]?.content?.parts[0]?.text || ''
}

// Mock responses for development without API keys
function getMockResponse(message: string): string {
  const responses = [
    "That's an interesting point! Based on what the group has discussed before, I think there's more to explore here.",
    "Let me think about that... I've noticed the group tends to engage a lot with topics like this.",
    "Great question! From what I've learned about this group, here's my take on it.",
    "I've been following the conversation and I think this connects to something you all discussed earlier.",
    "Hmm, that's worth digging into. The group seems to have diverse perspectives on this kind of thing.",
  ]

  // Simple hash to get consistent responses for same messages
  const hash = message.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0)
    return a & a
  }, 0)

  return responses[Math.abs(hash) % responses.length]
}

// Main function to call AI with fallback
export async function callAI(
  provider: AIProvider,
  apiKey: string | null,
  systemPrompt: string,
  messages: AIMessage[],
  maxTokens: number = 1024
): Promise<AIResponse> {
  // If no API key, return mock response
  if (!apiKey) {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    return {
      content: getMockResponse(lastUserMessage?.content || ''),
      provider: 'claude', // Default mock provider
    }
  }

  try {
    let content: string

    switch (provider) {
      case 'claude':
        content = await callClaude(apiKey, systemPrompt, messages, maxTokens)
        break
      case 'openai':
        content = await callOpenAI(apiKey, systemPrompt, messages, maxTokens)
        break
      case 'gemini':
        content = await callGemini(apiKey, systemPrompt, messages, maxTokens)
        break
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }

    return { content, provider }
  } catch (error) {
    console.error(`AI provider ${provider} failed:`, error)
    throw error
  }
}

// System prompts
export function getBrainSystemPrompt(groupContext: {
  groupName: string
  interests: string[]
  recentTopics: string[]
  ragContext?: string
}): string {
  let prompt = `You are Brain, an AI member of a group chat called "${groupContext.groupName}".

You have been observing and learning from this group's conversations. Here's what you know:

GROUP INTERESTS: ${JSON.stringify(groupContext.interests)}
RECENT TOPICS: ${JSON.stringify(groupContext.recentTopics)}`

  // Add RAG context if available
  if (groupContext.ragContext) {
    prompt += `

MEMORY - RELEVANT PAST CONVERSATIONS:
${groupContext.ragContext}`
  }

  prompt += `

Your role:
- Be helpful, witty, and match the group's vibe
- When asked to explain something, be clear and concise
- When fact-checking, be accurate and cite sources if possible
- When recommending content, base it on the group's known interests
- When catching someone up, summarize key points from recent messages
- Keep responses relatively short unless asked for detail
- Use casual language that fits a group chat
- You can use emojis sparingly
- If you have relevant memory of past conversations, reference them naturally (e.g., "I remember when you discussed...")
- Use your memory to give more personalized, contextual responses

Remember: You're part of the group, not an outside assistant. Be conversational.`

  return prompt
}

export function getPrivateSystemPrompt(userContext: {
  userName: string
  contextMessage?: string
}): string {
  return `You are Brain, having a private 1:1 conversation with ${userContext.userName}.

This conversation is private - only ${userContext.userName} can see it.

Context from the group chat: ${userContext.contextMessage || 'No specific context'}

In private threads you can:
- Go deeper on topics without boring the group
- Help draft replies for the group chat
- Give opinions you might not share publicly
- Search through chat history
- Provide more detailed explanations

Be helpful and conversational. This is a safe space for the user to ask anything.`
}
