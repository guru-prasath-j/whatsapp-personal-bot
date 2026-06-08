import { useState } from 'react'

const palette = ['#6C3082','#1A5276','#0E6655','#7D6608','#922B21','#1F618D']

export default function Avatar({ name, src, size = 48 }) {
  const [imgError, setImgError] = useState(false)
  const letters = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const bg = palette[(name?.charCodeAt(0) || 0) % palette.length]

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setImgError(true)}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
      style={{ background: bg, width: size, height: size, fontSize: size * 0.28 }}
    >
      {letters}
    </div>
  )
}
