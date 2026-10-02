/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs: the app works from any path, e.g. https://<user>.github.io/<repo>/.
  // Routing uses the URL hash, so every view is served by the same index.html.
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
