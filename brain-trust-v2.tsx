# Brain Trust: Smart Group Chats

"Your group chat, but it remembers everything and gets smarter over time."

I want to build an intelligent group chat web app. This will be a mobile-friendly web app (PWA) deployed on Cloudflare Pages with Cloudflare Workers for the backend. Keep everything simple and use Cloudflare's ecosystem so I don't have to configure separate infrastructure.

================================================================================
WHAT THIS APP DOES
================================================================================

Brain Trust is a group chat where an AI called "Brain" is a native member. As friends chat and share media, Brain listens, learns, and gets smarter — recommending content, answering questions, fact-checking, and surfacing insights based on the group's collective taste.

================================================================================
CORE FEATURES TO BUILD
================================================================================

1. GROUP CHAT
   - Real-time messaging (text, images, links)
   - Rich media embeds: tweets, articles, YouTube links render nicely
   - Tap any media to expand and view in-app
   - Reactions on messages
   - Shows who is online

2. BRAIN (AI MEMBER)
   - Always present in every group
   - Responds when someone types @brain
   - Can do:
     - Catch up: "What did I miss?"
     - Explain: "What is a claims table?"
     - Fact check: "Is that true?"
     - Find similar: "More like this?"
     - Recommend: "What should I read?"
     - Summarize: "TLDR this article"
   - Uses Claude API (Sonnet model)

3. PRIVATE THREADS
   - Tap any message or Brain response to open a private 1:1 thread with Brain
   - Only that user can see it
   - For going deeper, getting help drafting replies, asking things privately

4. LEARNING ENGINE
   - Brain indexes every message and link shared
   - Builds a taste profile for the group (what topics come up, what gets reactions)
   - Gets smarter over time
   - Store embeddings for semantic search

5. RECOMMENDATION ENGINE
   - Brain proactively suggests content based on group interests
   - Pull from news APIs, academic sources (Semantic Scholar, arXiv, PubMed)
   - "Brain found this and thought of you guys"

6. ONBOARDING
   - Sign up with email (keep it simple for MVP)
   - Select initial interests when joining
   - Create or join a group via invite link

================================================================================
TECH STACK (CLOUDFLARE ECOSYSTEM)
================================================================================

FRONTEND:
- React with Vite
- Tailwind CSS for styling
- Mobile-first responsive design (works great on phones)
- Deploy to Cloudflare Pages

BACKEND:
- Cloudflare Workers for API endpoints
- Cloudflare Durable Objects for real-time chat state
- Cloudflare D1 (SQLite) for database
- Cloudflare R2 for file/image storage

AI LAYER:
- Claude API (claude-sonnet-4-20250514) for Brain responses
- Cloudflare Vectorize for embeddings storage
- Or use Cloudflare AI for embeddings if simpler

AUTH:
- Simple email + password for MVP
- Can upgrade to magic link later

================================================================================
DATABASE SCHEMA (D1 - schema.sql)
================================================================================

-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  interests TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Groups table
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Group members junction table
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  media_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Reactions table
CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(message_id, user_id, emoji)
);

-- Private threads table
CREATE TABLE private_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  context_message_id TEXT,
  context_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Private messages table
CREATE TABLE private_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES private_threads(id)
);

-- Taste profiles table
CREATE TABLE taste_profiles (
  group_id TEXT PRIMARY KEY,
  topics TEXT DEFAULT '{}',
  engagement_data TEXT DEFAULT '{}',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Indexes for performance
CREATE INDEX idx_messages_group ON messages(group_id, created_at);
CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE INDEX idx_reactions_message ON reactions(message_id);
CREATE INDEX idx_private_messages_thread ON private_messages(thread_id, created_at);

================================================================================
API ENDPOINTS (CLOUDFLARE WORKERS)
================================================================================

AUTH:
  POST /api/auth/signup      - Create account
  POST /api/auth/login       - Login, returns JWT
  GET  /api/auth/me          - Get current user from JWT

GROUPS:
  POST /api/groups           - Create new group
  GET  /api/groups           - List user's groups
  GET  /api/groups/:id       - Get group info
  POST /api/groups/join/:code - Join group via invite code
  GET  /api/groups/:id/members - List group members

MESSAGES:
  GET  /api/groups/:id/messages - Get messages (paginated)
  POST /api/groups/:id/messages - Send message
  POST /api/messages/:id/reactions - Add/remove reaction

BRAIN:
  POST /api/brain/respond    - Handle @brain mention (calls Claude)
  POST /api/brain/private    - Private thread message (calls Claude)
  GET  /api/brain/recommendations/:group_id - Get recommendations

MEDIA:
  POST /api/media/upload     - Upload image to R2
  POST /api/media/unfurl     - Get link preview metadata

WEBSOCKET:
  GET  /api/ws/:group_id     - Connect to real-time chat

================================================================================
DURABLE OBJECT: ChatRoom.js
================================================================================

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      await this.handleSession(server, url);
      
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }
    
    return new Response("Expected WebSocket", { status: 400 });
  }

  async handleSession(webSocket, url) {
    webSocket.accept();
    
    const userId = url.searchParams.get("userId");
    const sessionId = crypto.randomUUID();
    
    this.sessions.set(sessionId, { webSocket, userId });
    
    // Broadcast user joined
    this.broadcast({
      type: "presence",
      action: "joined",
      userId,
      online: this.getOnlineUsers()
    }, sessionId);

    webSocket.addEventListener("message", async (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "message") {
        // Broadcast message to all clients
        this.broadcast({
          type: "message",
          message: data.message
        });
        
        // Check for @brain mention
        if (data.message.content.toLowerCase().includes("@brain")) {
          await this.handleBrainMention(data.message);
        }
      }
      
      if (data.type === "reaction") {
        this.broadcast({
          type: "reaction",
          messageId: data.messageId,
          reaction: data.reaction
        });
      }
      
      if (data.type === "typing") {
        this.broadcast({
          type: "typing",
          userId: data.userId
        }, sessionId);
      }
    });

    webSocket.addEventListener("close", () => {
      this.sessions.delete(sessionId);
      this.broadcast({
        type: "presence",
        action: "left",
        userId,
        online: this.getOnlineUsers()
      });
    });
  }

  broadcast(message, excludeSession = null) {
    const payload = JSON.stringify(message);
    for (const [id, session] of this.sessions) {
      if (id !== excludeSession) {
        try {
          session.webSocket.send(payload);
        } catch (e) {
          this.sessions.delete(id);
        }
      }
    }
  }

  getOnlineUsers() {
    return [...new Set([...this.sessions.values()].map(s => s.userId))];
  }

  async handleBrainMention(message) {
    // Call Claude API and broadcast response
    const response = await fetch(`${this.env.WORKER_URL}/api/brain/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: message.group_id,
        messageId: message.id,
        content: message.content
      })
    });
    
    const brainResponse = await response.json();
    
    this.broadcast({
      type: "message",
      message: brainResponse.message
    });
  }
}

================================================================================
CLAUDE INTEGRATION: claude.js
================================================================================

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

export async function callClaude(env, systemPrompt, messages, options = {}) {
  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: options.model || "claude-sonnet-4-20250514",
      max_tokens: options.maxTokens || 1024,
      system: systemPrompt,
      messages: messages
    })
  });

  const data = await response.json();
  return data.content[0].text;
}

export function getBrainSystemPrompt(groupContext) {
  return `You are Brain, an AI member of a group chat called "${groupContext.groupName}". 

You have been observing and learning from this group's conversations. Here's what you know:

GROUP INTERESTS: ${JSON.stringify(groupContext.interests)}
RECENT TOPICS: ${JSON.stringify(groupContext.recentTopics)}
MEMBER PERSONALITIES: ${JSON.stringify(groupContext.memberProfiles)}

Your role:
- Be helpful, witty, and match the group's vibe
- When asked to explain something, be clear and concise
- When fact-checking, be accurate and cite sources if possible
- When recommending content, base it on the group's known interests
- When catching someone up, summarize key points from recent messages
- Keep responses relatively short unless asked for detail
- Use casual language that fits a group chat
- You can use emojis sparingly

Remember: You're part of the group, not an outside assistant. Be conversational.`;
}

export function getPrivateSystemPrompt(userContext) {
  return `You are Brain, having a private 1:1 conversation with ${userContext.userName}.

This conversation is private - only ${userContext.userName} can see it.

Context from the group chat: ${userContext.contextMessage || "No specific context"}

In private threads you can:
- Go deeper on topics without boring the group
- Help draft replies for the group chat
- Give opinions you might not share publicly  
- Search through chat history
- Provide more detailed explanations

Be helpful and conversational. This is a safe space for the user to ask anything.`;
}

================================================================================
LINK UNFURLING: unfurl.js
================================================================================

export async function unfurlLink(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BrainTrust/1.0)"
      }
    });
    
    const html = await response.text();
    
    // Parse meta tags
    const getMetaContent = (property) => {
      const match = html.match(
        new RegExp(`<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i")
      ) || html.match(
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, "i")
      );
      return match ? match[1] : null;
    };
    
    const title = getMetaContent("og:title") || 
                  getMetaContent("twitter:title") ||
                  html.match(/<title>([^<]+)<\/title>/i)?.[1] || 
                  url;
    
    const description = getMetaContent("og:description") || 
                        getMetaContent("twitter:description") ||
                        getMetaContent("description");
    
    const image = getMetaContent("og:image") || 
                  getMetaContent("twitter:image");
    
    const siteName = getMetaContent("og:site_name") || 
                     new URL(url).hostname.replace("www.", "");
    
    // Detect content type
    let type = "link";
    if (url.includes("twitter.com") || url.includes("x.com")) type = "tweet";
    else if (url.includes("youtube.com") || url.includes("youtu.be")) type = "video";
    else if (url.includes("tiktok.com")) type = "tiktok";
    else if (url.includes("instagram.com")) type = "instagram";
    else if (url.includes("open.spotify.com")) type = "spotify";
    
    return {
      url,
      type,
      title: decodeHTMLEntities(title),
      description: description ? decodeHTMLEntities(description) : null,
      image,
      siteName
    };
  } catch (error) {
    return {
      url,
      type: "link",
      title: url,
      description: null,
      image: null,
      siteName: new URL(url).hostname
    };
  }
}

function decodeHTMLEntities(text) {
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'"
  };
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m => entities[m]);
}

================================================================================
FRONTEND: Main Chat Component (Chat.jsx)
================================================================================

import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuth } from "../hooks/useAuth";
import MessageBubble from "../components/Chat/MessageBubble";
import MediaCard from "../components/Chat/MediaCard";
import BrainResponse from "../components/Chat/BrainResponse";
import ChatInput from "../components/Chat/ChatInput";
import QuickActions from "../components/Chat/QuickActions";
import PrivateThread from "../components/PrivateThread/PrivateThread";
import MediaViewer from "../components/MediaViewer/MediaViewer";

export default function Chat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [privateThread, setPrivateThread] = useState(null);
  const [expandedMedia, setExpandedMedia] = useState(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  const { sendMessage, lastMessage, isConnected } = useWebSocket(groupId, user.id);

  // Load initial messages
  useEffect(() => {
    loadMessages();
    loadMembers();
  }, [groupId]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      if (lastMessage.type === "message") {
        setMessages(prev => [...prev, lastMessage.message]);
      } else if (lastMessage.type === "presence") {
        setOnlineUsers(lastMessage.online);
      } else if (lastMessage.type === "reaction") {
        setMessages(prev => prev.map(msg => 
          msg.id === lastMessage.messageId 
            ? { ...msg, reactions: [...(msg.reactions || []), lastMessage.reaction] }
            : msg
        ));
      }
    }
  }, [lastMessage]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadMessages = async () => {
    const res = await fetch(`/api/groups/${groupId}/messages`);
    const data = await res.json();
    setMessages(data.messages);
  };

  const loadMembers = async () => {
    const res = await fetch(`/api/groups/${groupId}/members`);
    const data = await res.json();
    setMembers(data.members);
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const message = {
      id: crypto.randomUUID(),
      group_id: groupId,
      user_id: user.id,
      type: "text",
      content: input,
      created_at: new Date().toISOString(),
      author: user
    };

    // Optimistically add message
    setMessages(prev => [...prev, message]);
    setInput("");

    // Send via WebSocket
    sendMessage({ type: "message", message });

    // Also persist to database
    await fetch(`/api/groups/${groupId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input, type: "text" })
    });
  };

  const handleQuickAction = (action) => {
    const prompts = {
      catchup: "@brain catch me up on what I missed",
      factcheck: "@brain fact check the last claim",
      similar: "@brain find similar content",
      private: null
    };

    if (action === "private") {
      setPrivateThread({ context: null });
    } else {
      setInput(prompts[action]);
    }
  };

  const handleMessageTap = (message) => {
    if (message.type === "brain_response") {
      setPrivateThread({ context: message.content });
    }
  };

  const handleMediaTap = (message) => {
    if (message.media_data) {
      setExpandedMedia(message);
    }
  };

  const getMember = (userId) => members.find(m => m.id === userId) || {};

  if (privateThread) {
    return (
      <PrivateThread
        groupId={groupId}
        context={privateThread.context}
        onClose={() => setPrivateThread(null)}
      />
    );
  }

  if (expandedMedia) {
    return (
      <MediaViewer
        message={expandedMedia}
        onClose={() => setExpandedMedia(null)}
        onAskBrain={() => {
          setExpandedMedia(null);
          setPrivateThread({ context: expandedMedia.media_data });
        }}
      />
    );
  }

  return (
    <div className="bg-black min-h-screen text-white max-w-md mx-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🧠</div>
            <div>
              <h1 className="font-semibold">Brain Trust</h1>
              <div className="text-xs text-green-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                Encrypted · {onlineUsers.length} online
              </div>
            </div>
          </div>
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((member) => (
              <div
                key={member.id}
                className={`w-8 h-8 rounded-full bg-${member.color || 'zinc'}-500 border-2 border-black flex items-center justify-center text-xs font-medium relative`}
              >
                {member.name?.charAt(0)}
                {onlineUsers.includes(member.id) && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-black"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.map((msg, i) => {
          const author = getMember(msg.user_id);
          const prevMsg = messages[i - 1];
          const samePerson = prevMsg && prevMsg.user_id === msg.user_id;
          const isMe = msg.user_id === user.id;
          const isBrain = msg.type === "brain_response";

          return (
            <div key={msg.id}>
              {!samePerson && !isMe && (
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-6 h-6 rounded-full bg-${author.color || 'zinc'}-500 flex items-center justify-center text-xs`}>
                    {isBrain ? "🧠" : author.name?.charAt(0)}
                  </div>
                  <span className="text-xs text-zinc-500">{isBrain ? "Brain" : author.name}</span>
                </div>
              )}

              <div className={`${!isMe ? "ml-8" : "flex justify-end"}`}>
                {msg.type === "text" && (
                  <MessageBubble
                    message={msg}
                    isMe={isMe}
                    onTap={() => handleMessageTap(msg)}
                    reactions={msg.reactions}
                  />
                )}

                {msg.type === "brain_response" && (
                  <BrainResponse
                    message={msg}
                    onTap={() => handleMessageTap(msg)}
                  />
                )}

                {msg.media_data && (
                  <MediaCard
                    media={JSON.parse(msg.media_data)}
                    onTap={() => handleMediaTap(msg)}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      <QuickActions onAction={handleQuickAction} />

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onMediaUpload={() => {/* TODO */}}
      />
    </div>
  );
}

================================================================================
FRONTEND: Message Components
================================================================================

// MessageBubble.jsx
export default function MessageBubble({ message, isMe, onTap, reactions }) {
  return (
    <div
      className={`rounded-2xl px-4 py-2.5 max-w-xs cursor-pointer ${
        isMe 
          ? "bg-cyan-600 rounded-br-sm" 
          : "bg-zinc-900 rounded-bl-sm"
      }`}
      onClick={onTap}
    >
      <p className="text-sm">{message.content}</p>
      {reactions && reactions.length > 0 && (
        <div className="flex gap-0.5 mt-1.5 -mb-1">
          {reactions.map((r, j) => (
            <span key={j} className="text-sm">{r.emoji}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// BrainResponse.jsx
export default function BrainResponse({ message, onTap }) {
  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 rounded-bl-sm max-w-xs cursor-pointer"
      onClick={onTap}
    >
      <p className="text-sm whitespace-pre-line">{message.content}</p>
      <div className="text-xs text-zinc-600 mt-2 flex items-center gap-1">
        <span>💭</span> Tap to go deeper
      </div>
    </div>
  );
}

// MediaCard.jsx
export default function MediaCard({ media, onTap }) {
  if (media.type === "tweet") {
    return (
      <div 
        className="bg-zinc-900 rounded-2xl p-3 border border-zinc-800 cursor-pointer max-w-xs"
        onClick={onTap}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-zinc-700 rounded-full"></div>
          <span className="text-sm font-medium">{media.siteName}</span>
          <span className="text-xs text-zinc-500">· 𝕏</span>
        </div>
        <p className="text-sm">{media.title}</p>
        <div className="text-xs text-zinc-600 mt-2">Tap to expand</div>
      </div>
    );
  }

  return (
    <div 
      className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 cursor-pointer max-w-xs"
      onClick={onTap}
    >
      {media.image && (
        <img src={media.image} alt="" className="w-full h-32 object-cover" />
      )}
      <div className="p-3">
        <div className="text-xs text-zinc-500 mb-1">{media.siteName}</div>
        <p className="text-sm font-medium">{media.title}</p>
        {media.description && (
          <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{media.description}</p>
        )}
      </div>
    </div>
  );
}

// ChatInput.jsx
export default function ChatInput({ value, onChange, onSend, onMediaUpload }) {
  return (
    <div className="p-4 border-t border-zinc-800">
      <div className="flex gap-2">
        <button 
          onClick={onMediaUpload}
          className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center text-xl"
        >
          +
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="Message or @brain..."
          className="flex-1 bg-zinc-900 rounded-full px-4 py-3 text-sm focus:outline-none"
        />
        <button
          onClick={onSend}
          className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center font-bold"
        >
          ↑
        </button>
      </div>
    </div>
  );
}

// QuickActions.jsx
export default function QuickActions({ onAction }) {
  const actions = [
    { id: "catchup", label: "🧠 Catch up" },
    { id: "factcheck", label: "✓ Fact check" },
    { id: "similar", label: "🔍 Similar" },
    { id: "private", label: "💭 Private" }
  ];

  return (
    <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-zinc-900">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.id)}
          className="text-xs bg-zinc-900 px-3 py-2 rounded-full whitespace-nowrap"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

================================================================================
FRONTEND: Private Thread Component
================================================================================

// PrivateThread.jsx
import { useState, useEffect } from "react";

export default function PrivateThread({ groupId, context, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: "brain",
      content: "Private thread — only you can see this. I can go deeper on anything, fact-check, help draft a reply, or find related stuff."
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const quickPrompts = [
    "Explain more",
    "Draft a reply",
    "Search history",
    "Find related"
  ];

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/brain/private", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          context,
          message: input,
          history: messages
        })
      });

      const data = await res.json();
      setMessages(prev => [...prev, { role: "brain", content: data.response }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: "brain", content: "Sorry, something went wrong." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-zinc-950 min-h-screen text-white max-w-md mx-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
        <button onClick={onClose} className="text-zinc-400">←</button>
        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">🧠</div>
        <div>
          <div className="font-medium text-sm">Private thread</div>
          <div className="text-xs text-green-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            End-to-end encrypted · Only you
          </div>
        </div>
      </div>

      {/* Context */}
      {context && (
        <div className="p-3 bg-zinc-900/50 border-b border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">Context</div>
          <div className="text-sm text-zinc-400 line-clamp-2">
            {typeof context === "string" ? context : JSON.stringify(context)}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "brain" && (
              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm shrink-0">🧠</div>
            )}
            <div className={`max-w-xs rounded-2xl px-4 py-3 ${
              msg.role === "user" 
                ? "bg-cyan-600 rounded-br-sm" 
                : "bg-zinc-900 rounded-bl-sm"
            }`}>
              <p className="text-sm whitespace-pre-line">{msg.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm">🧠</div>
            <div className="bg-zinc-900 rounded-2xl px-4 py-3 rounded-bl-sm">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{animationDelay: "0.1s"}}></div>
                <div className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{animationDelay: "0.2s"}}></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto border-t border-zinc-900">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => setInput(prompt)}
            className="text-xs bg-zinc-900 px-3 py-2 rounded-full whitespace-nowrap"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask Brain privately..."
            className="flex-1 bg-zinc-900 rounded-full px-4 py-3 text-sm focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={isLoading}
            className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center font-bold disabled:opacity-50"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

================================================================================
FRONTEND: WebSocket Hook
================================================================================

// useWebSocket.js
import { useState, useEffect, useRef, useCallback } from "react";

export function useWebSocket(groupId, userId) {
  const [lastMessage, setLastMessage] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/${groupId}?userId=${userId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastMessage(data);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [groupId, userId]);

  const sendMessage = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { sendMessage, lastMessage, isConnected };
}

================================================================================
WRANGLER CONFIG (wrangler.toml)
================================================================================

name = "brain-trust-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
WORKER_URL = "https://brain-trust-worker.YOUR_SUBDOMAIN.workers.dev"

[[d1_databases]]
binding = "DB"
database_name = "brain-trust-db"
database_id = "YOUR_DATABASE_ID"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "brain-trust-media"

[[durable_objects.bindings]]
name = "CHAT_ROOMS"
class_name = "ChatRoom"

[[migrations]]
tag = "v1"
new_classes = ["ChatRoom"]

[env.production]
vars = { ENVIRONMENT = "production" }

================================================================================
ENVIRONMENT VARIABLES
================================================================================

Required secrets (set via wrangler secret put):
- CLAUDE_API_KEY: Your Anthropic API key
- JWT_SECRET: Random string for signing auth tokens
- NEWS_API_KEY: (Optional) For recommendations

================================================================================
FILE STRUCTURE
================================================================================

brain-trust/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   │   ├── MessageBubble.jsx
│   │   │   │   ├── BrainResponse.jsx
│   │   │   │   ├── MediaCard.jsx
│   │   │   │   ├── ChatInput.jsx
│   │   │   │   └── QuickActions.jsx
│   │   │   ├── PrivateThread/
│   │   │   │   └── PrivateThread.jsx
│   │   │   └── MediaViewer/
│   │   │       └── MediaViewer.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Groups.jsx
│   │   │   ├── Chat.jsx
│   │   │   └── Onboarding.jsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.js
│   │   │   └── useAuth.js
│   │   ├── lib/
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── tailwind.config.js
│   ├── vite.config.js
│   └── package.json
├── worker/
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── groups.js
│   │   │   ├── messages.js
│   │   │   └── brain.js
│   │   ├── durable-objects/
│   │   │   └── ChatRoom.js
│   │   └── lib/
│   │       ├── claude.js
│   │       └── unfurl.js
│   ├── schema.sql
│   └── wrangler.toml
└── README.md

================================================================================
MVP BUILD ORDER
================================================================================

PHASE 1: Foundation (Week 1-2)
1. Set up Vite + React + Tailwind project
2. Set up Cloudflare Pages deployment
3. Create Cloudflare Worker with D1 database
4. Run schema.sql to create tables
5. Implement basic auth (signup, login, JWT)
6. Create/join groups functionality

PHASE 2: Chat (Week 2-3)
1. Build main chat UI (Chat.jsx)
2. Implement ChatRoom Durable Object
3. Set up WebSocket connections
4. Send and receive messages
5. Add reactions
6. Basic link unfurling

PHASE 3: Brain (Week 3-4)
1. Integrate Claude API (claude.js)
2. Detect @brain mentions in ChatRoom
3. Generate contextual responses
4. Style Brain messages differently
5. Add quick action buttons

PHASE 4: Private Threads (Week 4)
1. Build private thread UI
2. Create private_threads and private_messages tables
3. Pass context to Claude for private conversations
4. Add quick prompts

PHASE 5: Learning & Polish (Week 5-6)
1. Track message topics and engagement
2. Build basic taste profile
3. Add presence indicators
4. Image upload to R2
5. PWA manifest
6. Testing and bug fixes

================================================================================
START BUILDING
================================================================================

Begin with Phase 1:
1. Create the frontend/ directory and run: npm create vite@latest . -- --template react
2. Install dependencies: npm install react-router-dom
3. Install Tailwind: npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p
4. Create the worker/ directory and run: npm create cloudflare@latest
5. Set up D1: wrangler d1 create brain-trust-db
6. Run schema: wrangler d1 execute brain-trust-db --file=schema.sql

Then build the auth routes and basic UI. Once you can create accounts and groups, move to Phase 2.
