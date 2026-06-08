/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        wa: {
          bg:          '#0B141A',
          sidebar:     '#111B21',
          header:      '#202C33',
          card:        '#2A3942',
          input:       '#2A3942',
          'bubble-in': '#1F2C34',
          'bubble-out':'#005C4B',
          green:       '#00A884',
          'green-light':'#25D366',
          text:        '#E9EDEF',
          muted:       '#8696A0',
          border:      '#2A3942',
          panel:       '#202C33',
          hover:       '#2A3942',
          active:      '#3D5465',
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
