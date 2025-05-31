import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  base: '/my-form-builder/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react')) {
              return 'vendor_react';
            }
            if (id.includes('zustand')) {
              return 'vendor_zustand';
            }
            if (id.includes('firebase')) {
              return 'vendor_firebase';
            }
            if (id.includes('dnd-kit')) {
              return 'vendor_dndkit';
            }
            return 'vendor';
          }
        }
      }
    }
  }
});
