import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const { VITE_BASE_PATH } = loadEnv(mode, '.', 'VITE_');
  const base = VITE_BASE_PATH || '/';

  return {
    base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'fluxos-icon-v2.svg'],
      manifest: {
        id: './',
        name: 'Fluxos — Editor de processos',
        short_name: 'Fluxos',
        description: 'Crie e organize processos e subprocessos.',
        lang: 'pt-BR',
        theme_color: '#f7faf7',
        background_color: '#f7faf7',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: './pwa-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: './pwa-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: './pwa-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: './fluxos-icon-v2.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,ico,png,webmanifest}'] },
    }),
  ],
  server: { host: '0.0.0.0' },
  };
});
