import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 部署到子路径（如 https://redspiderbc.cn/project3/）时构建命令示例：
//   INVENTORY_BASE=/project3/ npm run build
const INVENTORY_BASE = process.env.INVENTORY_BASE || '/';

/** 始终带尾部 /，用于拼接 script src */
function baseWithSlash() {
  if (INVENTORY_BASE === '/') return '/';
  return INVENTORY_BASE.endsWith('/') ? INVENTORY_BASE : `${INVENTORY_BASE}/`;
}

/** 与 window.__API_BASE__ 一致：无尾斜杠；根路径时为 '' */
function apiBaseString() {
  if (INVENTORY_BASE === '/') return '';
  return INVENTORY_BASE.replace(/\/$/, '');
}

/**
 * 生产构建：注入 __API_BASE__；把 /inventory-api.js、/app.js 改为带 base 的 URL；
 * 将根目录 inventory-api.js、app.js 复制到 dist/（否则子路径下 404）。
 */
function inventoryProductionPlugin() {
  const basePath = baseWithSlash();
  const apiBase = apiBaseString();

  return {
    name: 'nemh-inventory-production',
    apply: 'build',
    transformIndexHtml(html) {
      let out = html.replace(
        /window\.__API_BASE__\s*=\s*''\s*;/,
        apiBase ? `window.__API_BASE__ = '${apiBase}';` : `window.__API_BASE__ = '';`
      );
      out = out.replace(/src="\/inventory-api\.js"/, `src="${basePath}inventory-api.js"`);
      out = out.replace(/src="\/app\.js"/, `src="${basePath}app.js"`);
      return out;
    },
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(dist)) return;
      for (const f of ['inventory-api.js', 'app.js']) {
        const from = path.resolve(__dirname, f);
        const to = path.join(dist, f);
        if (fs.existsSync(from)) {
          fs.copyFileSync(from, to);
        }
      }
    },
  };
}

export default defineConfig({
  base: INVENTORY_BASE,
  plugins: [inventoryProductionPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/docs': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/openapi.json': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
});
