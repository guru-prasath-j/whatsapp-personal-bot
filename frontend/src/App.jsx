import { useEffect, useState, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'
import StatusBar from './components/StatusBar.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChatView from './components/ChatView.jsx'
import EmptyState from './components/EmptyState.jsx'
import ProfilePanel from './components/ProfilePanel.jsx'

function App() {
  const socketRef                         = useRef(null)
  const [connected, setConnected]         = useState(false)
  const [botStatus, setBotStatus]         = useState('connecting')
  const [globalPaused, setGlobalPaused]   = useState(false)
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId]       = useState(null)
  const [showProfile, setShowProfile]     = useState(false)
  const [toasts, setToasts]               = useState([])

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
    setGlobalPaused(p => !p)
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
        <Sidebar conversations={conversations} selectedId={selectedId} onSelect={handleSelect} />
        <main className="flex-1 overflow-hidden">
          {selectedConv
            ? <ChatView conversation={selectedConv} onSend={handleSend} />
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
