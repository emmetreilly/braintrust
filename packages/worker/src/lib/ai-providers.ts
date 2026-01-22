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

// Response when no API key is configured
function getNoApiKeyResponse(): string {
  return `**Brain needs an API key to work!**

To enable Brain's AI features:
1. Go to **Settings** (gear icon in the sidebar)
2. Click **Workspace Settings**
3. Under **Brain AI**, click **Add Key**
4. Paste your Claude API key (starts with \`sk-ant-\`)

Get a key at: https://console.anthropic.com/settings/keys

Once configured, Brain can read documents, answer questions, summarize content, and more!`
}

// Main function to call AI with fallback
export async function callAI(
  provider: AIProvider,
  apiKey: string | null,
  systemPrompt: string,
  messages: AIMessage[],
  maxTokens: number = 1024
): Promise<AIResponse> {
  // If no API key, return helpful message about how to configure it
  if (!apiKey) {
    return {
      content: getNoApiKeyResponse(),
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

DOCUMENT ACCESS:
- You CAN read and analyze any documents shared in the chat - they're included in your context above
- When users ask about a shared document (PDF, file, etc.), reference its actual content
- You can answer questions about documents, summarize them, compare them, etc.

MESSAGE ATTRIBUTION:
- Chat history messages show who said them in [Name]: format
- The LAST message in each conversation is the current user asking you a question - always address your response to THAT person
- IMPORTANT: Do not confuse the person asking you a question with other people mentioned in the chat history
- When the current user asks "what did [Name] say about X?", search the chat history for [Name]'s messages
- When referencing other people, be specific (e.g., "Ben mentioned earlier..." not "you mentioned...")

WHEN YOU DON'T HAVE ENOUGH CONTEXT:
- If someone asks about a specific deal, document, meeting, or topic you don't have info on, PROACTIVELY suggest they upload relevant files
- Say something like: "I don't have context on that yet. You can upload the document/transcript/notes using the + button and I'll be able to help!"
- Or: "I don't see anything about [topic] in my context. Drop in the relevant file and I can dig into it for you."
- This is Brain Trust - a shared AI workspace. The more context they upload, the more helpful you become.
- Don't just say "I don't know" - guide them to share context so you CAN help.

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

WHEN YOU DON'T HAVE ENOUGH CONTEXT:
- If they ask about something you don't have info on, suggest they upload the relevant file using the + button
- Say something like: "I'd need to see that document to help. Click the + button to upload it and I can dig in!"
- This private thread lets them upload files for focused, 1:1 analysis
- Don't just say "I don't know" - guide them to share context so you CAN help.

Be helpful and conversational. This is a safe space for the user to ask anything.`
}
