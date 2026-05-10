import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import { createAuthMiddleware, tryLogin, logAuthHint } from './auth.js';
import { registerUserAdminRoutes } from './adminUsers.js';
import { registerPurchasePriceRoutes } from './purchasePrices.js';
import { registerSalePriceRoutes } from './salePrices.js';
import { registerInboundOrderRoutes } from './inboundOrders.js';
import { registerInventoryAlertRoutes } from './inventoryAlerts.js';
import { registerOutboundOrderRoutes } from './outboundOrders.js';
import { registerWarehouseStockReportRoutes } from './inventoryWarehouseReport.js';
import { registerWarehouseRoutes } from './warehouses.js';
import { registerPublicRegisterRoute } from './publicRegister.js';

const PORT = Number(process.env.PORT) || 3001;
const app = express();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.join(__dirname, '..', 'openapi.json');

const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
  <title>新能源材料进销存 API — Swagger UI</title>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis],
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  });
};
</script>
</body>
</html>`;

app.use(cors({ origin: true }));
app.use(express.json());

let db;
let authMiddleware;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/openapi.json', (_req, res) => {
  try {
    const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
    res.type('application/json').send(raw);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '无法读取 openapi.json' });
  }
});

app.get('/docs', (_req, res) => {
  res.type('html').send(SWAGGER_UI_HTML);
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username ||
    !password
  ) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }
  try {
    const result = await tryLogin(db, username, password);
    if (!result.ok) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    res.json({ token: result.token, user: result.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '登录失败' });
  }
});

async function main() {
  db = await initDb();
  authMiddleware = createAuthMiddleware(db);
  registerPublicRegisterRoute(app, db);
  registerUserAdminRoutes(app, db, authMiddleware);
  registerWarehouseRoutes(app, db, authMiddleware);
  registerPurchasePriceRoutes(app, db, authMiddleware);
  registerSalePriceRoutes(app, db, authMiddleware);
  registerInboundOrderRoutes(app, db, authMiddleware);
  registerInventoryAlertRoutes(app, db, authMiddleware);
  registerOutboundOrderRoutes(app, db, authMiddleware);
  registerWarehouseStockReportRoutes(app, db, authMiddleware);
  logAuthHint();
  app.listen(PORT, () => {
    console.log(`API http://localhost:${PORT}`);
    console.log(`Docs (Swagger UI) http://localhost:${PORT}/docs`);
    console.log(`OpenAPI http://localhost:${PORT}/openapi.json`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
