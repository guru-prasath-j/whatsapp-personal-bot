function timeAgo(ts) {
  const d = Date.now() - ts
  if (d < 60000)    return `${Math.floor(d/1000)}s`
  if (d < 3600000)  return `${Math.floor(d/60000)}m`
  if (d < 86400000) return `${Math.floor(d/3600000)}h`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function Avatar({ name, size = 10 }) {
  const letters = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const palette = ['#6C3082','#1A5276','#0E6655','#7D6608','#922B21','#1F618D']
  const bg = palette[(name?.charCodeAt(0) || 0) % palette.length]
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center text-white font-semibold text-[13px] flex-shrink-0`}
      style={{ background: bg, width: `${size*4}px`, height: `${size*4}px` }}
    >
      {letters}
    </div>
  )
}

function ContactRow({ msg, selected, onClick }) {
  return (
    <button
      onClick={() => onClick(msg.id)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-wa-border/50 ${
        selected ? 'bg-wa-active' : 'hover:bg-wa-card'
      }`}
    >
      <div className="relative">
        <Avatar name={msg.name} size={10} />
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-wa-green rounded-full border-2 border-wa-sidebar" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-wa-text text-[15px] font-medium truncate">{msg.name}</span>
          <span className="text-wa-muted text-xs flex-shrink-0 ml-2">{timeAgo(msg.ts)}</span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-wa-muted text-[13px] truncate flex-1">{msg.text}</p>
          <span className="ml-2 flex-shrink-0 bg-wa-green text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            1
          </span>
        </div>
      </div>
    </button>
  )
}

export default function Sidebar({ pending, selectedId, onSelect }) {
  return (
    <aside className="w-[300px] flex-shrink-0 bg-wa-sidebar border-r border-black/30 flex flex-col overflow-hidden">
      {/* Search bar (decorative, WhatsApp style) */}
      <div className="px-3 py-2 bg-wa-sidebar border-b border-wa-border/50">
        <div className="flex items-center gap-2 bg-wa-card rounded-lg px-3 py-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-wa-muted flex-shrink-0">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <span className="text-wa-muted text-[14px]">Search or start new chat</span>
        </div>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {pending.length > 0 ? (
          <>
            <div className="px-4 py-2 bg-wa-bg/50">
              <span className="text-wa-muted text-xs uppercase tracking-wider font-semibold">
                Awaiting Reply — {pending.length}
              </span>
            </div>
            {pending.map(msg => (
              <ContactRow
                key={msg.id}
                msg={msg}
                selected={selectedId === msg.id}
                onClick={onSelect}
              />
            ))}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <svg viewBox="0 0 24 24" className="w-12 h-12 fill-wa-muted opacity-30">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            <p className="text-wa-muted text-sm">No pending messages</p>
            <p className="text-wa-muted/60 text-xs">Incoming WhatsApp messages will appear here</p>
          </div>
        )}
      </div>
    </aside>
  )
}
