import { defineConfig } from 'vite';

// 部署到子路径（如 https://redspiderbc.cn/project3/）时构建命令示例：
//   INVENTORY_BASE=/project3/ npm run build
const INVENTORY_BASE = process.env.INVENTORY_BASE || '/';

/** 生产构建且 base 非 / 时，把 __API_BASE__ 写成与 base 一致，便于 Nginx /project3/api/ 反代 */
function injectApiBaseForSubpath() {
  const base = INVENTORY_BASE;
  if (base === '/') {
    return null;
  }
  const apiBase = base.replace(/\/$/, '');
  return {
    name: 'nemh-inventory-inject-api-base',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /window\.__API_BASE__\s*=\s*''\s*;/,
        `window.__API_BASE__ = '${apiBase}';`
      );
    },
  };
}

const subpathPlugin = injectApiBaseForSubpath();

export default defineConfig({
  base: INVENTORY_BASE,
  plugins: subpathPlugin ? [subpathPlugin] : [],
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
