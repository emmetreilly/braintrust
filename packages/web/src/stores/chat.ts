import { create } from 'zustand'
import type { Message, Group, GroupMember, Document, DocumentTag } from '../types'

export interface ThreadMessage {
  id?: string
  role: 'user' | 'brain'
  content: string
}

export interface AttachedFile {
  id: string
  name: string
}

export interface BrainTab {
  id: string
  name: string
  documentId?: string
  documentName?: string
  messages: ThreadMessage[]
}

interface ChatState {
  // Current channel
  groupId: string | null
  group: Group | null
  members: GroupMember[]
  onlineUsers: string[]

  // Team chat messages
  messages: Message[]

  // Documents (channel files)
  documents: Document[]
  allTags: DocumentTag[]
  selectedDocument: { id: string; name: string } | null

  // Brain thread (persistent AI conversation)
  brainMessages: ThreadMessage[]
  brainLoading: boolean
  brainDocumentContext: { id: string; name: string } | null

  // Brain tabs (VS Code-like multiple conversations)
  brainTabs: BrainTab[]
  activeBrainTabId: string

  // UI state
  isLoading: boolean

  // Expanded message modal
  expandedMessage: Message | null

  // Web embed in Brain panel
  embeddedUrl: string | null

  // Drag-drop feedback
  activeDragType: string | null

  // Brain input prefill (from drag/follow-up)
  brainInputPrefill: string | null

  // Panel visibility
  showMediaLibrary: boolean

  // Actions
  setGroupId: (groupId: string | null) => void
  setGroup: (group: Group | null) => void
  setMembers: (members: GroupMember[]) => void
  setOnlineUsers: (users: string[]) => void

  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  deleteMessage: (id: string) => void
  addReaction: (messageId: string, reaction: NonNullable<Message['reactions']>[0]) => void

  setDocuments: (docs: Document[]) => void
  setAllTags: (tags: DocumentTag[]) => void
  setSelectedDocument: (doc: { id: string; name: string } | null) => void

  setBrainMessages: (messages: ThreadMessage[]) => void
  addBrainMessage: (message: ThreadMessage) => void
  setBrainLoading: (loading: boolean) => void
  setBrainDocumentContext: (ctx: { id: string; name: string } | null) => void

  // Brain tab actions
  addBrainTab: (name: string, documentId?: string, documentName?: string) => void
  closeBrainTab: (tabId: string) => void
  setActiveBrainTab: (tabId: string) => void
  updateActiveTabMessages: (messages: ThreadMessage[]) => void

  setIsLoading: (loading: boolean) => void

  // UI actions
  setExpandedMessage: (message: Message | null) => void
  setEmbeddedUrl: (url: string | null) => void
  setActiveDragType: (type: string | null) => void
  setBrainInputPrefill: (prefill: string | null) => void
  setShowMediaLibrary: (show: boolean) => void
  toggleMediaLibrary: () => void

  // Reset when changing channels
  reset: () => void
}

const DEFAULT_TAB_ID = 'general'

const initialState = {
  groupId: null,
  group: null,
  members: [],
  onlineUsers: [],
  messages: [],
  documents: [],
  allTags: [],
  selectedDocument: null,
  brainMessages: [],
  brainLoading: false,
  brainDocumentContext: null,
  brainTabs: [{
    id: DEFAULT_TAB_ID,
    name: 'General',
    messages: [],
  }] as BrainTab[],
  activeBrainTabId: DEFAULT_TAB_ID,
  isLoading: false,
  expandedMessage: null,
  embeddedUrl: null,
  activeDragType: null,
  brainInputPrefill: null,
  showMediaLibrary: true,
}

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  setGroupId: (groupId) => set({ groupId }),
  setGroup: (group) => set({ group }),
  setMembers: (members) => set({ members }),
  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => {
    // Avoid duplicates
    if (state.messages.some(m => m.id === message.id)) {
      return state
    }
    return { messages: [...state.messages, message] }
  }),
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
  })),
  deleteMessage: (id) => set((state) => ({
    messages: state.messages.filter(m => m.id !== id)
  })),
  addReaction: (messageId, reaction) => set((state) => ({
    messages: state.messages.map(m =>
      m.id === messageId
        ? { ...m, reactions: [...(m.reactions || []), reaction] }
        : m
    )
  })),

  setDocuments: (documents) => set({ documents }),
  setAllTags: (allTags) => set({ allTags }),
  setSelectedDocument: (selectedDocument) => set({ selectedDocument }),

  setBrainMessages: (brainMessages) => set({ brainMessages }),
  addBrainMessage: (message) => set((state) => ({
    brainMessages: [...state.brainMessages, message]
  })),
  setBrainLoading: (brainLoading) => set({ brainLoading }),
  setBrainDocumentContext: (brainDocumentContext) => set({ brainDocumentContext }),

  // Brain tab actions
  addBrainTab: (name, documentId, documentName) => set((state) => {
    const newTabId = `tab-${Date.now()}`
    const newTab: BrainTab = {
      id: newTabId,
      name,
      documentId,
      documentName,
      messages: documentName
        ? [{ role: 'brain', content: `Context loaded: ${documentName}. What would you like to know?` }]
        : [],
    }
    return {
      brainTabs: [...state.brainTabs, newTab],
      activeBrainTabId: newTabId,
      brainMessages: newTab.messages,
      brainDocumentContext: documentId && documentName ? { id: documentId, name: documentName } : null,
    }
  }),

  closeBrainTab: (tabId) => set((state) => {
    // Cannot close the last tab
    if (state.brainTabs.length <= 1) return state

    const newTabs = state.brainTabs.filter(t => t.id !== tabId)
    const wasActive = state.activeBrainTabId === tabId
    const newActiveId = wasActive ? newTabs[newTabs.length - 1].id : state.activeBrainTabId
    const activeTab = newTabs.find(t => t.id === newActiveId)

    return {
      brainTabs: newTabs,
      activeBrainTabId: newActiveId,
      brainMessages: activeTab?.messages || [],
      brainDocumentContext: activeTab?.documentId && activeTab?.documentName
        ? { id: activeTab.documentId, name: activeTab.documentName }
        : null,
    }
  }),

  setActiveBrainTab: (tabId) => set((state) => {
    // Save current tab messages first
    const updatedTabs = state.brainTabs.map(t =>
      t.id === state.activeBrainTabId
        ? { ...t, messages: state.brainMessages }
        : t
    )
    const newActiveTab = updatedTabs.find(t => t.id === tabId)

    return {
      brainTabs: updatedTabs,
      activeBrainTabId: tabId,
      brainMessages: newActiveTab?.messages || [],
      brainDocumentContext: newActiveTab?.documentId && newActiveTab?.documentName
        ? { id: newActiveTab.documentId, name: newActiveTab.documentName }
        : null,
    }
  }),

  updateActiveTabMessages: (messages) => set((state) => ({
    brainTabs: state.brainTabs.map(t =>
      t.id === state.activeBrainTabId
        ? { ...t, messages }
        : t
    ),
    brainMessages: messages,
  })),

  setIsLoading: (isLoading) => set({ isLoading }),

  // UI actions
  setExpandedMessage: (expandedMessage) => set({ expandedMessage }),
  setEmbeddedUrl: (embeddedUrl) => set({ embeddedUrl }),
  setActiveDragType: (activeDragType) => set({ activeDragType }),
  setBrainInputPrefill: (brainInputPrefill) => set({ brainInputPrefill }),
  setShowMediaLibrary: (showMediaLibrary) => set({ showMediaLibrary }),
  toggleMediaLibrary: () => set((state) => ({ showMediaLibrary: !state.showMediaLibrary })),

  reset: () => set(initialState),
}))
