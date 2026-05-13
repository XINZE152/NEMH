/**
 * 從本機「進銷存頁面」目錄同步靜態 UI 到 inventory-web（對接 NEMH 後端）。
 *
 * 預設來源：e:\\frontend\\进销存页面
 * 用法（在 inventory-web 目錄）：
 *   npm run sync:ui
 * 或：
 *   INVENTORY_UI_SRC="D:/你的路徑/进销存页面" npm run sync:ui
 *
 * 行為：
 * - 複製 style.css
 * - 複製 index.html，並把末尾的單一 <script src="app.js"> 換成 NEMH 所需的
 *   __USE_BACKEND_API__ + /inventory-api.js + /app.js（與 vite 代理一致）
 * - 不覆蓋本倉庫的 app.js（進銷存頁面內的 app 多為離線版，整檔覆蓋會失去後端對接；
 *   若您有改動請用 diff 合併到本倉 inventory-web/app.js）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const destRoot = path.resolve(__dirname, '..');

const defaultSrc = path.join('e:', 'frontend', '进销存页面');
const srcRoot = process.env.INVENTORY_UI_SRC || defaultSrc;

const nemhScriptTail = `    <!-- 后端 API：Vite 开发时走代理（同域 /api）；若用 file:// 打开请改为 http://localhost:3001 -->
    <script>
      window.__USE_BACKEND_API__ = true;
      window.__API_BASE__ = '';
    </script>
    <script src="/inventory-api.js"></script>
    <script src="/app.js"></script>
</body>
</html>`;

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

if (!fs.existsSync(srcRoot)) {
  console.error('找不到來源目錄：', srcRoot);
  console.error('請設定環境變數 INVENTORY_UI_SRC 指向「进销存页面」資料夾。');
  process.exit(1);
}

const styleFrom = path.join(srcRoot, 'style.css');
const styleTo = path.join(destRoot, 'style.css');
if (fs.existsSync(styleFrom)) {
  copyFile(styleFrom, styleTo);
  console.log('已同步 style.css');
} else {
  console.warn('略過：找不到', styleFrom);
}

const indexFrom = path.join(srcRoot, 'index.html');
const indexTo = path.join(destRoot, 'index.html');
if (fs.existsSync(indexFrom)) {
  let html = fs.readFileSync(indexFrom, 'utf8');
  // 去掉常見的單 script 結尾，改為 NEMH 三腳本
  html = html.replace(
    /\r?\n\s*<!--\s*JavaScript[^]*?<script\s+src=["']app\.js["']\s*>\s*<\/script>\s*\r?\n<\/body>\s*\r?\n<\/html>\s*$/i,
    '\n' + nemhScriptTail + '\n'
  );
  if (!html.includes('inventory-api.js')) {
    console.error(
      'index.html 結尾替換失敗：請手動將 </body> 前改為與本倉 inventory-web/index.html 相同的 __USE_BACKEND_API__ + inventory-api.js + app.js 區塊。'
    );
    process.exit(1);
  }
  fs.writeFileSync(indexTo, html, 'utf8');
  console.log('已同步 index.html（已注入 NEMH 後端腳本）');
} else {
  console.warn('略過：找不到', indexFrom);
}

console.log('完成。app.js / inventory-api.js 未改動；請自行比對合併業務邏輯。');
