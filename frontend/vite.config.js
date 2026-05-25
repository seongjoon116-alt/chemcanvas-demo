import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    // 워크스페이스 루트의 shared/ 디렉터리를 import할 수 있도록 허용
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
