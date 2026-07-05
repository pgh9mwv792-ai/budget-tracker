import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Split the Supabase client into its own vendor chunk: it's needed at
        // startup (auth) but changes rarely, so isolating it keeps the app
        // entry chunk small and lets browsers cache it across deploys.
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase'
        },
      },
    },
  },
})
