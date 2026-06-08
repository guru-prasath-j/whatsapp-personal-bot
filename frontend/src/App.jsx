import { useEffect, useState, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'
import StatusBar from './components/StatusBar.jsx'
import Sidebar from './components/Sidebar.jsx'
import ChatView from './components/ChatView.jsx'
import EmptyState from './components/EmptyState.jsx'

function App() {
  const socketRef = useRef(null)
  const [connected, setConnected]       = useState(false)
  const [botStatus, setBotStatus]       = useState('connecting')
  const [globalPaused, setGlobalPaused] = useState(false)
  const [pending, setPending]           = useState([])
  const [conversations, setConversations] = useState({}) // { contactId: messages[] }
  const [selectedId, setSelectedId]     = useState(null)
  const [sending, setSending]           = useState(false)
  const [toasts, setToasts]             = useState([])

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const fetchConversations = useCallback(() => {
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => {
        const map = {}
        data.forEach(c => { map[c.id] = c.messages })
        setConversations(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('init_state', ({ status, globalPaused: gp, pending: p }) => {
      setBotStatus(status)
      setGlobalPaused(gp)
      setPending(p || [])
    })

    socket.on('bot_status', ({ status }) => setBotStatus(status))

    socket.on('new_pending', (msg) => {
      setPending(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
      setSelectedId(msg.id)
      fetchConversations()
    })

    socket.on('reply_sent', ({ messageId }) => {
      setPending(prev => prev.filter(m => m.id !== messageId))
      setSelectedId(prev => prev === messageId ? null : prev)
      fetchConversations()
    })

    socket.on('message_dismissed', ({ messageId }) => {
      setPending(prev => prev.filter(m => m.id !== messageId))
      setSelectedId(prev => prev === messageId ? null : prev)
    })

    socket.on('suggestions_updated', ({ messageId, suggestions }) => {
      setPending(prev => prev.map(m => m.id === messageId ? { ...m, suggestions } : m))
    })

    socket.on('pause_changed', ({ globalPaused: gp }) => setGlobalPaused(gp))

    return () => socket.disconnect()
  }, [fetchConversations])

  const selectedMessage = pending.find(m => m.id === selectedId) || null

  const handleSend = useCallback(async (text) => {
    if (!selectedMessage || !text.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: selectedMessage.id,
          text:      text.trim(),
          to:        selectedMessage.chatId
        })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Send failed')
      addToast(`Replied to ${selectedMessage.name}`)
    } catch (e) {
      addToast(e.message, 'error')
    } finally {
      setSending(false)
    }
  }, [selectedMessage, sending, addToast])

  const handleDismiss = useCallback(async (id) => {
    await fetch('/api/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: id })
    })
  }, [])

  const handleRegenerate = useCallback(async (id) => {
    await fetch('/api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: id })
    })
  }, [])

  const handleGlobalPause = useCallback(async () => {
    const endpoint = globalPaused ? '/api/play' : '/api/pause'
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'all' })
    })
    setGlobalPaused(p => !p)
  }, [globalPaused])

  return (
    <div className="flex flex-col h-full bg-wa-bg">
      <StatusBar
        botStatus={botStatus}
        connected={connected}
        pendingCount={pending.length}
        globalPaused={globalPaused}
        onTogglePause={handleGlobalPause}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          pending={pending}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <main className="flex-1 overflow-hidden">
          {selectedMessage ? (
            <ChatView
              message={selectedMessage}
              history={conversations[selectedMessage.from] || []}
              onSend={handleSend}
              onDismiss={handleDismiss}
              onRegenerate={handleRegenerate}
              sending={sending}
            />
          ) : (
            <EmptyState pendingCount={pending.length} />
          )}
        </main>
      </div>

      <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
        {toasts.map(t => (
          <div key={t.id} className={`
            px-4 py-3 rounded-xl text-sm font-medium shadow-xl animate-slide-in
            ${t.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-wa-green text-white'}
          `}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
