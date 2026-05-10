import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 匹配所有以 /api 开头的请求（与《API接口文档》一致，后端默认 3001）
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/docs': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/openapi.json': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
});
