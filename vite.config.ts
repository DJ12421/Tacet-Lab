/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import packageJson from './package.json'

const githubSha = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.GITHUB_SHA
const appVersion = githubSha ? `${packageJson.version}+${githubSha.slice(0, 7)}` : packageJson.version

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/WuWa-Optimizer/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Tacet Lab - WuWa Optimizer',
        short_name: 'Tacet Lab',
        description: 'Local-first Echo scanner and Wuthering Waves build optimizer.',
        theme_color: '#080b0d',
        background_color: '#080b0d',
        display: 'standalone',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,traineddata}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.destination === 'image' && (url.hostname === 'static.nanoka.cc' || url.hostname === 'wuwa-optimizer.com' || url.hostname === 'raw.githubusercontent.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tacet-lab-remote-artwork',
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'tacet-lab-english-ocr',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    restoreMocks: true
  }
}))
