import { useState } from 'react'
import Avatar from './Avatar.jsx'

function timeAgo(ts) {
  if (!ts) return ''
  const t = ts < 1e12 ? ts * 1000 : ts
  const d = Date.now() - t
  if (d < 60000)    return `${Math.floor(d/1000)}s`
  if (d < 3600000)  return `${Math.floor(d/60000)}m`
  if (d < 86400000) return `${Math.floor(d/3600000)}h`
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function ConvRow({ conv, selected, onClick }) {
  const lastMsg = conv.messages?.[conv.messages.length - 1]
  const preview = lastMsg?.content?.substring(0, 45) || 'No messages yet'
  const isMe    = lastMsg?.role === 'assistant'
  return (
    <button onClick={() => onClick(conv.id)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-wa-border/40
        ${selected ? 'bg-wa-active' : 'hover:bg-wa-card'}`}>
      <Avatar name={conv.name} src={conv.profilePic} size={48} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-wa-text text-[15px] font-medium truncate">{conv.name && conv.name.replace(/\D/g,"").length > 13 ? "Unknown" : conv.name}</span>
          <span className="text-wa-muted text-[11px] flex-shrink-0 ml-2">{timeAgo(conv.lastActivity)}</span>
        </div>
        <div className="flex items-center justify-between mt-0.5 gap-2">
          <p className="text-wa-muted text-[13px] truncate flex-1">
            {isMe && <span className="text-wa-green mr-1">You: </span>}
            {preview}
          </p>
          {conv.unread > 0 && (
            <span className="flex-shrink-0 bg-wa-green text-white text-[10px] font-bold
              min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
              {conv.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

const TIME_FILTERS = [
  { label: 'All',  ms: null },
  { label: '12h',  ms: 12 * 60 * 60 * 1000 },
  { label: '1d',   ms: 24 * 60 * 60 * 1000 },
  { label: '7d',   ms:  7 * 24 * 60 * 60 * 1000 },
]

export default function Sidebar({ conversations, selectedId, onSelect, timeFilter, onTimeFilter }) {
  const [search, setSearch] = useState('')

  const now    = Date.now()
  const sorted = [...(conversations || [])]
    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
    .filter(c => !timeFilter || (now - (c.lastActivity < 1e12 ? c.lastActivity * 1000 : c.lastActivity)) <= timeFilter)
    .filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.id?.includes(search))

  return (
    <aside className="w-[320px] flex-shrink-0 bg-wa-sidebar border-r border-black/30 flex flex-col overflow-hidden">
      <div className="px-3 pt-2 pb-1 bg-wa-sidebar border-b border-wa-border/50 flex flex-col gap-2">
        {/* Search */}
        <div className="flex items-center gap-2 bg-wa-card rounded-lg px-3 py-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-wa-muted flex-shrink-0">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="flex-1 bg-transparent text-wa-text text-[14px] placeholder:text-wa-muted outline-none" />
        </div>
        {/* Time filter pills */}
        <div className="flex gap-1.5 pb-1">
          {TIME_FILTERS.map(f => (
            <button key={f.label} onClick={() => onTimeFilter(f.ms)}
              className={`flex-1 py-1 rounded-lg text-[12px] font-semibold transition-all
                ${timeFilter === f.ms
                  ? 'bg-wa-green text-white shadow-sm'
                  : 'bg-wa-card text-wa-muted hover:bg-wa-active hover:text-wa-text'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.length > 0 ? sorted.map(conv => (
          <ConvRow key={conv.id} conv={conv} selected={selectedId === conv.id} onClick={onSelect} />
        )) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <svg viewBox="0 0 24 24" className="w-12 h-12 fill-wa-muted opacity-30">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            <p className="text-wa-muted text-sm">
              {timeFilter ? `No chats in the last ${TIME_FILTERS.find(f=>f.ms===timeFilter)?.label}` : 'No conversations yet'}
            </p>
            <p className="text-wa-muted/60 text-xs">Incoming WhatsApp messages will appear here</p>
          </div>
        )}
      </div>
    </aside>
  )
}
