import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // The port comes from the environment so the harness can hand out a free
    // one. Nothing calls back into this server — no OAuth redirect, no webhook,
    // no pinned CORS origin — so there is no reason to demand a fixed port,
    // and `strictPort` would turn "already in use" into a hard failure.
    port: Number(process.env.PORT) || 5178,
  },
  build: { target: 'es2022', sourcemap: true },
})
