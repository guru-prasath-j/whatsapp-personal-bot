import { useEffect, useState, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'
import StatusBar from './components/StatusBar.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChatView from './components/ChatView.jsx'
import EmptyState from './components/EmptyState.jsx'
import ProfilePanel from './components/ProfilePanel.jsx'

const TIME_FILTERS = [
  { label: 'All', ms: null },
  { label: '12h', ms: 12 * 60 * 60 * 1000 },
  { label: '1d',  ms: 24 * 60 * 60 * 1000 },
  { label: '7d',  ms:  7 * 24 * 60 * 60 * 1000 },
]

function App() {
  const socketRef                         = useRef(null)
  const [connected, setConnected]         = useState(false)
  const [botStatus, setBotStatus]         = useState('connecting')
  const [globalPaused, setGlobalPaused]   = useState(false)
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId]       = useState(null)
  const [showProfile, setShowProfile]     = useState(false)
  const [toasts, setToasts]               = useState([])
  const [timeFilter, setTimeFilter]       = useState(null) // null = All

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const fetchConversations = useCallback(() => {
    fetch('/api/conversations').then(r => r.json()).then(setConversations).catch(() => {})
  }, [])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('init_state', ({ status, globalPaused: gp }) => { setBotStatus(status); setGlobalPaused(gp) })
    socket.on('bot_status',           ({ status }) => setBotStatus(status))
    socket.on('conversation_updated', () => fetchConversations())
    socket.on('pause_changed',        ({ globalPaused: gp }) => setGlobalPaused(gp))
    return () => socket.disconnect()
  }, [fetchConversations])

  const selectedConv = conversations.find(c => c.id === selectedId) || null

  // Filter messages inside the open chat to the selected time window
  const filteredConv = selectedConv && timeFilter
    ? {
        ...selectedConv,
        messages: selectedConv.messages.filter(m => {
          const ts = m.ts < 1e12 ? m.ts * 1000 : m.ts
          return Date.now() - ts <= timeFilter
        })
      }
    : selectedConv

  const handleSelect = useCallback((id) => {
    setSelectedId(id)
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c))
  }, [])

  const handleSend = useCallback(async (text) => {
    if (!text.trim() || !selectedId) return
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), to: selectedId })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Send failed')
      fetchConversations()
      addToast(`Replied to ${selectedConv?.name || selectedId}`)
    } catch (e) { addToast(e.message, 'error') }
  }, [selectedId, selectedConv, fetchConversations, addToast])

  const handleGlobalPause = useCallback(async () => {
    const endpoint = globalPaused ? '/api/play' : '/api/pause'
    await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'all' }) })
    // State is updated via socket 'pause_changed' event — no local toggle needed
  }, [globalPaused])

  return (
    <div className="flex flex-col h-full bg-wa-bg">
      <StatusBar
        botStatus={botStatus}
        connected={connected}
        globalPaused={globalPaused}
        onTogglePause={handleGlobalPause}
        onOpenProfile={() => setShowProfile(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar conversations={conversations} selectedId={selectedId} onSelect={handleSelect}
          timeFilter={timeFilter} onTimeFilter={setTimeFilter} />
        <main className="flex-1 overflow-hidden">
          {filteredConv
            ? <ChatView conversation={filteredConv} onSend={handleSend}
                timeFilterLabel={TIME_FILTERS.find(f => f.ms === timeFilter)?.label} />
            : <EmptyState />}
        </main>
      </div>

      {/* Profile panel */}
      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-xl text-sm font-medium shadow-xl animate-slide-in
            ${t.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-wa-green text-white'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
