import { useState, useEffect, useRef } from 'react'
import { Send, RefreshCw, Copy, Check, Pencil, FileText, Download } from 'lucide-react'
import Avatar from './Avatar.jsx'

function fmtTime(ts) {
  if (!ts) return ''
  const t = ts < 1e12 ? ts * 1000 : ts
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatNumber(id) {
  if (!id) return ''
  const digits = id.replace(/\D/g, '')
  if (digits.length > 10) return `+${digits}`
  return id
}

const URL_RE = /(https?:\/\/[^\s<>"]+)/g

function isYouTube(url) {
  return /youtu\.be\/|youtube\.com\/(watch|shorts|embed)/.test(url)
}

function renderContent(text) {
  const parts = []
  let last = 0, m
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const url = m[0]
    const yt  = isYouTube(url)
    parts.push(
      <span key={m.index} className="inline-flex flex-col gap-0.5 max-w-full">
        <a href={url} target="_blank" rel="noreferrer"
          className={`underline break-all text-[13px] ${yt ? 'text-red-400 hover:text-red-300' : 'text-blue-300 hover:text-blue-200'}`}>
          {yt ? '▶ ' : '🔗 '}{url}
        </a>
      </span>
    )
    last = m.index + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : text
}

function Bubble({ role, content, ts, media }) {
  const isMe = role === 'assistant'
  const mediaUrl = media ? `/api/media/${media.filename}` : null
  const label    = media?.origName || media?.filename || ''
  return (
    <div className={`flex mb-1 ${isMe ? 'justify-end pr-2' : 'justify-start pl-2'}`}>
      <div className={`max-w-[70%] px-3 py-2 text-[14px] leading-relaxed text-wa-text
        ${isMe ? 'bubble-out' : 'bubble-in'}`}>

        {/* Inline image */}
        {media?.type === 'image' && (
          <a href={mediaUrl} target="_blank" rel="noreferrer" className="block mb-1">
            <img src={mediaUrl} alt={label}
              className="max-w-full max-h-60 rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"/>
          </a>
        )}

        {/* PDF attachment */}
        {media?.type === 'pdf' && (
          <a href={mediaUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 mb-1.5 px-3 py-2 rounded-lg bg-black/10 hover:bg-black/20 transition-colors group">
            <FileText size={18} className="flex-shrink-0 text-red-400"/>
            <span className="flex-1 text-[12px] truncate">{label}</span>
            <Download size={13} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"/>
          </a>
        )}

        {content && !(media && (content.startsWith('[') || content === media.origName || content === media.filename)) && <span className="break-words">{renderContent(content)}</span>}
        <span className={`block text-right text-[11px] mt-0.5 ${isMe ? 'text-white/50' : 'text-wa-muted'}`}>
          {fmtTime(ts)}
          {isMe && (
            <svg viewBox="0 0 18 18" className="inline-block w-3 h-3 ml-1 fill-white/60">
              <path d="M17.394 5.035l-.57-.444a.434.434 0 00-.609.076L8.397 15.17l-4.572-3.918a.434.434 0 00-.609.076l-.444.57a.434.434 0 00.076.609l5.44 4.658a.434.434 0 00.609-.076L17.47 5.644a.434.434 0 00-.076-.609z"/>
            </svg>
          )}
        </span>
      </div>
    </div>
  )
}

function SuggestionChip({ index, text, onSend, onLoad, busy }) {
  const [copied, setCopied] = useState(false)
  const colors   = ['border-blue-400/50 hover:border-blue-400','border-wa-green/50 hover:border-wa-green','border-purple-400/50 hover:border-purple-400']
  const labels   = ['text-blue-400','text-wa-green','text-purple-400']
  const sendBtns = ['bg-blue-600 hover:bg-blue-500','bg-[#0E6655] hover:bg-[#17A589]','bg-purple-700 hover:bg-purple-600']
  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000) }
  return (
    <div className={`bg-wa-card border border-l-2 rounded-xl p-3 flex flex-col gap-2 ${colors[index]}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${labels[index]}`}>Option {index+1}</p>
      <p className="text-wa-text text-[13px] leading-relaxed">{text}</p>
      <div className="flex gap-2">
        <button onClick={copy} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-wa-bg border border-wa-border text-wa-muted hover:text-wa-text text-xs transition-all">
          {copied ? <Check size={10} className="text-wa-green"/> : <Copy size={10}/>}
          {copied ? 'Copied' : 'Copy'}
        </button>
        {/* Load into textarea for editing before send (#8) */}
        <button onClick={()=>onLoad(text)} disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-wa-bg border border-wa-border text-wa-muted hover:text-wa-text text-xs transition-all">
          <Pencil size={10}/> Edit
        </button>
        <button onClick={()=>onSend(text)} disabled={busy}
          className={`flex items-center gap-1 px-3 py-1 rounded-lg text-white text-xs font-medium transition-all disabled:opacity-40 ${sendBtns[index]}`}>
          <Send size={10}/> Send
        </button>
      </div>
    </div>
  )
}

export default function ChatView({ conversation, onSend, timeFilterLabel }) {
  const { name, messages=[], id, profilePic, realNumber } = conversation
  const [customText, setCustomText]       = useState('')
  const [suggestions, setSuggestions]     = useState([])
  const [loadingSugg, setLoadingSugg]     = useState(false)
  const [sending, setSending]             = useState(false)
  const [editingName, setEditingName]     = useState(false)
  const [nameInput, setNameInput]         = useState('')
  // Track which suggestion was loaded for correction detection (#8)
  const [loadedSuggestion, setLoadedSuggestion] = useState(null)
  const bottomRef      = useRef(null)
  const currentIdRef   = useRef(id)
  const suggFetchingRef = useRef(false)
  const abortRef        = useRef(null) // AbortController for cancelling in-flight fetches

  useEffect(() => { currentIdRef.current = id }, [id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const fetchSuggestions = async (force = false) => {
    if (suggFetchingRef.current && !force) return  // auto-triggers skip if busy
    // Manual (force) click: cancel any in-flight auto-fetch first
    if (force && abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const forId = id
    suggFetchingRef.current = true
    setLoadingSugg(true)
    try {
      const res  = await fetch('/api/suggestions', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ contactId: forId }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (currentIdRef.current === forId) {
        setSuggestions(data.suggestions || [])
      }
    } catch (e) {
      if (e.name !== 'AbortError' && currentIdRef.current === forId) setSuggestions([])
    } finally {
      suggFetchingRef.current = false
      if (currentIdRef.current === forId) setLoadingSugg(false)
    }
  }

  // When switching contact: reset + auto-generate if last msg is from customer
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort()
    suggFetchingRef.current = false
    setCustomText(''); setEditingName(false); setLoadedSuggestion(null)
    const last = messages[messages.length - 1]
    if (last?.role === 'user') { setSuggestions([]); fetchSuggestions() }
    else setSuggestions([])
  }, [id]) // eslint-disable-line

  // When a NEW customer message arrives: auto-generate
  const lastMsg    = messages[messages.length - 1]
  const lastMsgKey = lastMsg ? `${lastMsg.role}-${lastMsg.ts}` : null
  useEffect(() => {
    if (!lastMsg || lastMsg.role !== 'user') return
    fetchSuggestions()
  }, [lastMsgKey]) // eslint-disable-line

  // Load suggestion into textarea for editing (#8)
  const loadSuggestion = (text) => {
    setCustomText(text)
    setLoadedSuggestion(text)
  }

  const handleSend = async (text) => {
    if (!text.trim() || sending) return
    setSending(true)

    // Detect correction: user edited a suggestion before sending (#8)
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    if (loadedSuggestion && text.trim() !== loadedSuggestion.trim() && lastUserMsg) {
      fetch('/api/feedback', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          question:  lastUserMsg.content,
          original:  loadedSuggestion,
          corrected: text.trim(),
        })
      }).catch(() => {})
    }

    await onSend(text)
    setSending(false)
    setCustomText(''); setSuggestions([]); setLoadedSuggestion(null)
  }

  const saveName = async () => {
    if (!nameInput.trim()) return
    await fetch('/api/rename', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ contactId: id, name: nameInput.trim() })
    })
    setEditingName(false)
  }

  const rawNumber = realNumber || id.replace(/@.*$/, "")
  const isLid = rawNumber.replace(/\D/g, "").length > 13
  const displayNumber = isLid ? null : `+${rawNumber.replace(/\D/g, "")}`
  const isUnknown = !name || name === id || /^\d{10,}$/.test(name)
  const lastIncoming = [...messages].reverse().find(m => m.role === 'user')

  return (
    <div className="h-full flex flex-col bg-wa-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-wa-header border-b border-black/30 flex-shrink-0">
        <Avatar name={name} src={profilePic} size={40}/>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') saveName(); if(e.key==='Escape') setEditingName(false) }}
                placeholder="Enter contact name…"
                className="bg-wa-card border border-wa-green/50 rounded-lg px-2 py-1 text-wa-text text-[14px] outline-none w-40"/>
              <button onClick={saveName} className="px-2 py-1 bg-wa-green text-white text-xs rounded-lg">Save</button>
              <button onClick={()=>setEditingName(false)} className="text-wa-muted text-xs hover:text-wa-text">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className={`font-semibold text-[15px] ${isUnknown ? 'text-wa-muted' : 'text-wa-text'}`}>
                {isUnknown ? displayNumber : name}
              </h2>
              <button onClick={()=>{ setNameInput(isUnknown?'':name); setEditingName(true) }}
                className="text-wa-muted hover:text-wa-text transition-colors" title="Set contact name">
                <Pencil size={12}/>
              </button>
            </div>
          )}
          {displayNumber && <p className="text-wa-muted text-[12px]">{displayNumber}</p>}
        </div>
        {timeFilterLabel && (
          <span className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-wa-green/20 text-wa-green border border-wa-green/30">
            Last {timeFilterLabel}
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat bubbles */}
        <div className="flex-1 overflow-y-auto py-4 chat-wallpaper">
          {messages.length === 0 && (
            <div className="flex justify-center mt-8">
              <span className="bg-wa-header/80 text-wa-muted text-xs px-4 py-1.5 rounded-full">No messages yet</span>
            </div>
          )}
          {messages.map((m,i) => <Bubble key={i} role={m.role} content={m.content} ts={m.ts} media={m.media}/>)}
          <div ref={bottomRef} className="h-2"/>
        </div>

        {/* Suggestions panel */}
        <div className="w-[300px] flex-shrink-0 border-l border-black/30 bg-wa-sidebar flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-wa-header border-b border-black/20">
            <h3 className="text-wa-text font-semibold text-[13px] uppercase tracking-widest">AI Suggestions</h3>
            {lastIncoming && <p className="text-wa-muted text-[11px] mt-1 truncate">Re: "{lastIncoming.content?.substring(0,40)}…"</p>}
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            <button onClick={() => fetchSuggestions(true)} disabled={loadingSugg||sending}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-wa-green hover:bg-wa-green-light text-white font-semibold text-[13px] transition-all disabled:opacity-50 shadow-lg shadow-wa-green/20">
              <RefreshCw size={14} className={loadingSugg?'animate-spin':''}/> {loadingSugg?'Generating…':'Get 3 suggestions'}
            </button>
            {suggestions.length>0
              ? suggestions.map((text,i)=><SuggestionChip key={i} index={i} text={text} onSend={handleSend} onLoad={loadSuggestion} busy={sending}/>)
              : !loadingSugg && <p className="text-wa-muted text-[12px] text-center py-4 leading-relaxed">Click above to generate 3 reply options based on your last 20 messages + business docs</p>
            }
            <div className="border-t border-wa-border pt-3 flex flex-col gap-2 mt-1">
              <p className="text-wa-muted text-[11px] uppercase tracking-wider font-semibold">Custom Reply</p>
              <textarea value={customText} onChange={e=>setCustomText(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend(customText)} }}
                placeholder="Type your message… (Enter to send)"
                rows={3} disabled={sending}
                className="w-full bg-wa-card border border-wa-border rounded-xl px-3 py-2.5 text-wa-text text-[13px] placeholder:text-wa-muted resize-none outline-none focus:border-wa-green/50 disabled:opacity-50 transition-colors"/>
              <button onClick={()=>handleSend(customText)} disabled={!customText.trim()||sending}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-wa-green hover:bg-wa-green-light text-white font-semibold text-[13px] transition-all disabled:opacity-50">
                {sending ? <RefreshCw size={14} className="animate-spin"/> : <><Send size={14}/> Send</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}