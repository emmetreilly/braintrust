/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brain: {
          cyan: '#06b6d4',
          dark: '#18181b',
          darker: '#09090b',
        },
      },
    },
  },
  plugins: [],
}
