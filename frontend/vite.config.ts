import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Local API port for dev proxy (same machine as Vite). Public ngrok solo del front → /api va al backend. */
function devApiProxyTarget(viteApiUrl: string | undefined): string {
  const raw = (viteApiUrl ?? '').trim()
  if (raw.includes('localhost') || raw.includes('127.0.0.1')) {
    try {
      const u = new URL(raw.startsWith('http') ? raw : `http://${raw}`)
      const port = u.port || '8732'
      return `http://127.0.0.1:${port}`
    } catch {
      /* use default */
    }
  }
  return 'http://127.0.0.1:8732'
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = devApiProxyTarget(env.VITE_API_URL)
  const apiProxy = {
    '/api': {
      target: apiProxyTarget,
      changeOrigin: true,
    },
  } as const

  return {
    plugins: [react()],
    server: {
      // Debe coincidir con start.bat (5892); CLI `--port` sigue teniendo prioridad.
      port: 5892,
      // Ngrok (and similar) send Host: *.ngrok-free.app; Vite 5.4+ blocks unknown hosts by default.
      host: true,
      allowedHosts: true,
      proxy: { ...apiProxy },
    },
    // Mismo proxy que dev si probás `vite preview` + ngrok al 4173.
    preview: {
      host: true,
      allowedHosts: true,
      proxy: { ...apiProxy },
    },
  }
})
