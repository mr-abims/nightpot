import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';

/**
 * The Midnight SDK ships wasm (ledger and on-chain runtime) and uses top-level
 * await. vite-plugin-wasm handles the wasm; targeting esnext lets the bundler
 * emit top-level await natively. Prover keys and ZKIR are copied into public/
 * by scripts/copy-zk-assets.mjs and fetched from this origin at proving time.
 */
export default defineConfig({
  cacheDir: './.vite',
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('onchain-runtime-v3')) return 'midnight-wasm';
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      ignoreDynamicRequires: true,
    },
  },
  plugins: [react(), tailwindcss(), wasm()],
  optimizeDeps: {
    include: ['@midnight-ntwrk/compact-runtime'],
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
    },
  },
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
    dedupe: ['@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/onchain-runtime-v3'],
  },
  server: {
    port: 5173,
    // src/witnesses.ts is shared with the Node scripts and lives one level up.
    fs: { allow: ['..'] },
  },
});
