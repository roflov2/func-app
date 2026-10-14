import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // During `npm run dev`, forward API calls to the Functions host
    // (`func start` in ../api) so the SPA can be developed with HMR.
    proxy: {
      '/api': 'http://localhost:7071',
    },
  },
})
