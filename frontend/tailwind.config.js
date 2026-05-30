/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Space Grotesk'", "'Noto Sans JP'", "sans-serif"],
        display: ["'Bebas Neue'", "sans-serif"],
      },
      colors: {
        canvas: '#0a0a0f',
        surface: '#111118',
        surface2: '#1a1a26',
        rim: '#1e1e30',
        rim2: '#2a2a40',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
