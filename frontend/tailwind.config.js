/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        wa: {
          bg:           'rgb(var(--c-bg))',
          sidebar:      'rgb(var(--c-sidebar))',
          header:       'rgb(var(--c-header))',
          card:         'rgb(var(--c-card))',
          input:        'rgb(var(--c-input))',
          'bubble-in':  'rgb(var(--c-bubble-in))',
          'bubble-out': 'rgb(var(--c-bubble-out))',
          green:        'rgb(var(--c-accent))',
          'green-light':'rgb(var(--c-accent-light))',
          text:         'rgb(var(--c-text))',
          muted:        'rgb(var(--c-muted))',
          border:       'rgb(var(--c-border))',
          panel:        'rgb(var(--c-panel))',
          hover:        'rgb(var(--c-hover))',
          active:       'rgb(var(--c-active))',
        }
      },
      animation: {
        'slide-in':   'slideIn 0.2s ease-out',
        'fade-in':    'fadeIn 0.15s ease-out',
        'pulse-dot':  'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        slideIn:  { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        fadeIn:   { from: { opacity: 0 }, to: { opacity: 1 } },
        pulseDot: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
      }
    }
  },
  plugins: []
}
