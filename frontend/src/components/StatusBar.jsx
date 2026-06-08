import { Wifi, WifiOff, PauseCircle, PlayCircle } from 'lucide-react'

const STATUS = {
  connecting:    { text: 'Connecting…',    dot: 'bg-yellow-500' },
  initializing:  { text: 'Starting…',      dot: 'bg-yellow-500' },
  authenticated: { text: 'Authenticating', dot: 'bg-blue-500'   },
  ready:         { text: 'Online',          dot: 'bg-wa-green'   },
  disconnected:  { text: 'Disconnected',    dot: 'bg-red-500'    },
  auth_failed:   { text: 'Auth Failed',     dot: 'bg-red-500'    },
}

export default function StatusBar({ botStatus, connected, pendingCount, globalPaused, onTogglePause }) {
  const s = STATUS[botStatus] || STATUS.connecting

  return (
    <header className="flex items-center justify-between px-4 py-2.5 bg-wa-header border-b border-black/30 flex-shrink-0 z-10">
      {/* Left: WhatsApp-style brand */}
      <div className="flex items-center gap-3">
        {/* WhatsApp logo area */}
        <div className="w-10 h-10 rounded-full bg-wa-green flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </div>
        <div>
          <h1 className="text-wa-text font-semibold text-[15px] leading-tight">WhatsApp AI Dashboard</h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${botStatus === 'ready' ? 'animate-pulse-dot' : ''}`} />
            <span className="text-wa-muted text-xs">{s.text}</span>
          </div>
        </div>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-3">
        {pendingCount > 0 && (
          <div className="flex items-center gap-1.5 bg-wa-green/15 border border-wa-green/30 px-3 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-wa-green animate-pulse" />
            <span className="text-wa-green text-xs font-semibold">{pendingCount} pending</span>
          </div>
        )}

        <div title={connected ? 'Dashboard live' : 'Not connected'}>
          {connected
            ? <Wifi size={16} className="text-wa-green" />
            : <WifiOff size={16} className="text-red-400" />}
        </div>

        <button
          onClick={onTogglePause}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            globalPaused
              ? 'bg-wa-green/20 text-wa-green border border-wa-green/30 hover:bg-wa-green/30'
              : 'bg-wa-card text-wa-muted border border-wa-border hover:text-wa-text'
          }`}
        >
          {globalPaused ? <><PlayCircle size={13} /> Resume</> : <><PauseCircle size={13} /> Pause All</>}
        </button>
      </div>
    </header>
  )
}
