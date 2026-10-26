import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@supabase/')) return 'supabase'
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react-vendor'
        },
      },
    },
  },
})
