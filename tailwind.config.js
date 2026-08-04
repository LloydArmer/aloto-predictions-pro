/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:     '#0f1117',
          surface:  '#181c27',
          raised:   '#1f2436',
          elevated: '#252b3b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '6px', md: '10px', lg: '14px', xl: '18px',
      },
    },
  },
  plugins: [],
}
