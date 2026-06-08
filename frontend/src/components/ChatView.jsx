import { useState, useEffect, useRef } from 'react'
import { Send, RefreshCw, X, Copy, Check, RotateCcw } from 'lucide-react'

const TIME_FILTERS = [
  { label: 'All', hours: null },
  { label: '1d',  hours: 24   },
  { label: '2d',  hours: 48   },
  { label: '7d',  hours: 168  },
]

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Avatar({ name }) {
  const letters = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const palette = ['#6C3082','#1A5276','#0E6655','#7D6608','#922B21','#1F618D']
  const bg = palette[(name?.charCodeAt(0) || 0) % palette.length]
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-[13px] flex-shrink-0"
      style={{ background: bg }}>
      {letters}
    </div>
  )
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setDone(true)
    setTimeout(() => setDone(false), 2000)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-wa-card hover:bg-wa-active text-wa-muted hover:text-wa-text text-xs transition-all border border-wa-border">
      {done ? <Check size={11} className="text-wa-green" /> : <Copy size={11} />}
      {done ? 'Copied' : 'Copy reply'}
    </button>
  )
}

function Bubble({ role, content, ts, contactName, highlight }) {
  const isMe = role === 'assistant'
  return (
    <div className={`flex mb-3 ${isMe ? 'justify-end pr-3' : 'justify-start pl-3'}`}>
      <div className={`max-w-[72%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        {!isMe && (
          <span className="text-[11px] text-wa-muted mb-1 ml-2">{contactName}</span>
        )}
        <div className={`px-3 py-2 text-[14px] leading-[1.5] text-wa-text ${
          highlight
            ? 'bubble-incoming-highlight'
            : isMe ? 'bubble-out' : 'bubble-in'
        }`}>
          <span>{content}</span>
          {ts && (
            <span className={`block text-right text-[11px] mt-1 ${isMe ? 'text-white/50' : 'text-wa-muted'}`}>
              {fmtTime(ts)}
              {isMe && (
                <svg viewBox="0 0 18 18" className="inline-block w-3 h-3 ml-1 fill-white/60">
                  <path d="M17.394 5.035l-.57-.444a.434.434 0 00-.609.076L8.397 15.17l-4.572-3.918a.434.434 0 00-.609.076l-.444.57a.434.434 0 00.076.609l5.44 4.658a.434.434 0 00.609-.076L17.47 5.644a.434.434 0 00-.076-.609z"/>
                  <path d="M13.24 5.035l-.571-.444a.434.434 0 00-.609.076L5.41 13.04 3.923 11.79a.434.434 0 00-.609.076l-.444.57a.434.434 0 00.076.609l2.302 1.972a.434.434 0 00.609-.076l7.458-9.297a.434.434 0 00-.076-.61z"/>
                </svg>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function OptionCard({ index, text, onSend, disabled, isSending }) {
  const styles = [
    { accent: 'border-l-blue-400',   label: 'text-blue-400',   btn: 'bg-[#1A5276] hover:bg-[#2E86C1]' },
    { accent: 'border-l-wa-green',   label: 'text-wa-green',   btn: 'bg-[#0E6655] hover:bg-[#17A589]' },
    { accent: 'border-l-purple-400', label: 'text-purple-400', btn: 'bg-[#6C3082] hover:bg-[#9B59B6]' },
  ]
  const s = styles[index] || styles[0]

  return (
    <div className={`bg-wa-card rounded-xl overflow-hidden border border-wa-border border-l-2 ${s.accent} animate-slide-in`}
      style={{ animationDelay: `${index * 80}ms` }}>
      <div className="px-4 py-3">
        <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${s.label}`}>
          Option {index + 1}
        </p>
        <p className="text-wa-text text-[14px] leading-relaxed mb-3">{text}</p>
        <div className="flex items-center gap-2">
          <CopyBtn text={text} />
          <button
            onClick={() => onSend(text)}
            disabled={disabled}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-medium ${s.btn} transition-all disabled:opacity-40`}
          >
            {isSending ? <RefreshCw size={11} className="animate-spin" /> : <><Send size={11} /> Send</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatView({ message, history, onSend, onDismiss, onRegenerate, sending }) {
  const [filter, setFilter]         = useState('2d')
  const [customText, setCustomText] = useState('')
  const [regenerating, setRegen]    = useState(false)
  const [sendingIdx, setSendingIdx] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => { setCustomText(''); setSendingIdx(null); setFilter('2d') }, [message.id])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [history, message])

  const cutoff = TIME_FILTERS.find(f => f.label === filter)?.hours
    ? Date.now() - (TIME_FILTERS.find(f => f.label === filter).hours * 3600000)
    : 0
  const shown = history.filter(m => !cutoff || (m.ts && m.ts >= cutoff))
  const visibleCount = shown.length + 1

  const copyChat = async () => {
    const lines = [...shown, { role: 'user', content: message.text, ts: message.ts }]
      .map(m => `[${fmtDateTime(m.ts)}] ${m.role === 'assistant' ? 'Me' : message.name}: ${m.content}`)
    await navigator.clipboard.writeText(lines.join('\n'))
  }

  const sendSuggestion = async (text, i) => {
    setSendingIdx(i); await onSend(text); setSendingIdx(null)
  }
  const sendCustom = async () => {
    if (!customText.trim()) return
    setSendingIdx('c'); await onSend(customText); setSendingIdx(null)
  }
  const regen = async () => { setRegen(true); await onRegenerate(message.id); setRegen(false) }

  const busy = sending || sendingIdx !== null
  const suggestions = message.suggestions || []

  return (
    <div className="h-full flex flex-col bg-wa-bg animate-fade-in overflow-hidden">

      {/* ── Contact header (WhatsApp style) ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-wa-header border-b border-black/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Avatar name={message.name} />
          <div>
            <h2 className="text-wa-text font-semibold text-[15px]">{message.name}</h2>
            <p className="text-wa-muted text-[12px]">+{message.from}</p>
          </div>
        </div>

        {/* Time filters + controls */}
        <div className="flex items-center gap-2">
          <span className="text-wa-muted text-xs">Show:</span>
          <div className="flex items-center bg-wa-card rounded-lg overflow-hidden border border-wa-border">
            {TIME_FILTERS.map(f => (
              <button key={f.label} onClick={() => setFilter(f.label)}
                className={`px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === f.label ? 'bg-wa-green text-white' : 'text-wa-muted hover:text-wa-text'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={copyChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wa-card border border-wa-border text-wa-muted hover:text-wa-text text-xs transition-all">
            <Copy size={11} /> Copy chat
          </button>
          <button onClick={() => onDismiss(message.id)}
            className="p-2 rounded-lg text-wa-muted hover:text-wa-text hover:bg-wa-card transition-colors">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Showing N messages label */}
      <div className="px-4 py-1.5 bg-wa-header/60 border-b border-black/20 flex-shrink-0">
        <p className="text-[12px]">
          <span className="text-wa-green font-medium">{message.name}</span>
          <span className="text-wa-muted">: {visibleCount} visible message{visibleCount !== 1 ? 's' : ''} ({filter} filter) · to be sent via WhatsApp</span>
        </p>
      </div>

      {/* ── Split: chat left, suggestions right ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Chat history with wallpaper */}
        <div className="flex-1 overflow-y-auto py-4 chat-wallpaper min-w-0">
          {shown.length === 0 && (
            <div className="text-center py-6">
              <span className="inline-block bg-wa-header/80 text-wa-muted text-xs px-4 py-1.5 rounded-full">
                No earlier messages in this window
              </span>
            </div>
          )}

          {/* Date chip */}
          {shown.length > 0 && (
            <div className="flex justify-center mb-3">
              <span className="bg-wa-header/80 text-wa-muted text-[11px] px-3 py-1 rounded-full">
                {filter === 'All' ? 'All messages' : `Last ${filter}`}
              </span>
            </div>
          )}

          {shown.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} ts={m.ts} contactName={message.name} />
          ))}

          {/* The pending (incoming) message — highlighted */}
          <Bubble role="user" content={message.text} ts={message.ts} contactName={message.name} highlight />
          <div ref={bottomRef} className="h-2" />
        </div>

        {/* RIGHT: AI Suggestions panel */}
        <div className="w-[310px] flex-shrink-0 border-l border-black/30 bg-wa-sidebar flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* Panel header */}
            <div className="px-4 py-3 bg-wa-header border-b border-black/20 sticky top-0 z-10">
              <h3 className="text-wa-text font-semibold text-[13px] uppercase tracking-widest">AI Suggestions</h3>
            </div>

            <div className="px-4 py-4 flex flex-col gap-4">
              {/* Context line */}
              <p className="text-wa-muted text-[12px] leading-relaxed">
                <span className="text-wa-text font-medium">{message.name}</span>: {visibleCount} visible message{visibleCount !== 1 ? 's' : ''} ({filter} filter)
                · to be sent via WhatsApp
              </p>

              {/* Direction / incoming message */}
              <div className="bg-wa-card border border-wa-border rounded-xl px-4 py-3">
                <p className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold mb-1.5">Direction</p>
                <p className="text-wa-text text-[13px] leading-relaxed line-clamp-4">{message.text}</p>
              </div>

              {/* Generate button */}
              <button onClick={regen} disabled={busy || regenerating}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-wa-green hover:bg-wa-green-light text-white font-semibold text-[14px] transition-all disabled:opacity-50 shadow-lg shadow-wa-green/20">
                <RotateCcw size={15} className={regenerating ? 'animate-spin' : ''} />
                Generate 3 replies
              </button>

              {/* Option cards */}
              {suggestions.length > 0 ? (
                suggestions.map((text, i) => (
                  <OptionCard key={i} index={i} text={text}
                    onSend={(t) => sendSuggestion(t, i)}
                    disabled={busy} isSending={sendingIdx === i} />
                ))
              ) : (
                <div className="flex items-center justify-center py-8 gap-2 text-wa-muted text-sm">
                  <RefreshCw size={14} className="animate-spin" /> Generating…
                </div>
              )}

              {/* Custom reply */}
              <div className="border-t border-wa-border pt-4 flex flex-col gap-2">
                <p className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold">Custom Reply</p>
                <textarea
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCustom() } }}
                  placeholder="Type your message… (Enter to send)"
                  rows={3}
                  disabled={busy}
                  className="w-full bg-wa-card border border-wa-border rounded-xl px-3 py-2.5 text-wa-text text-[13px] placeholder:text-wa-muted disabled:opacity-50"
                />
                <button onClick={sendCustom} disabled={!customText.trim() || busy}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-wa-card border border-wa-border text-wa-text text-[13px] font-medium hover:bg-wa-active transition-all disabled:opacity-30">
                  {sendingIdx === 'c'
                    ? <RefreshCw size={13} className="animate-spin" />
                    : <><Send size={13} /> Send custom reply</>}
                </button>
              </div>

              <div className="h-2" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
