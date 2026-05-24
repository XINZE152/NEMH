import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import { createAuthMiddleware, tryLogin, logAuthHint } from './auth.js';
import {
  createLogger,
  httpAccessLogMiddleware,
  clientErrorCaptureMiddleware,
  requestIdMiddleware,
  apiError,
  sendServerError,
} from './logger.js';
import { registerUserAdminRoutes } from './adminUsers.js';
import { registerPurchasePriceRoutes } from './purchasePrices.js';
import { registerSalePriceRoutes } from './salePrices.js';
import { registerInboundOrderRoutes } from './inboundOrders.js';
import { registerInventoryAlertRoutes } from './inventoryAlerts.js';
import { registerOutboundOrderRoutes } from './outboundOrders.js';
import { registerProfitReportRoutes } from './profitReport.js';
import { registerInboundReportRoutes } from './inboundReport.js';
import { registerWarehouseStockReportRoutes } from './inventoryWarehouseReport.js';
import { registerWarehouseRoutes } from './warehouses.js';
import { registerPublicRegisterRoute } from './publicRegister.js';

const PORT = Number(process.env.PORT) || 3001;
const app = express();
const log = createLogger('nemh.main');

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
/** 磅单等字段可能为 data URL（前端允许 ≤4MB 图片，base64 后更大），须高于默认 ~100kb */
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '12mb';
app.use(express.json({ limit: jsonBodyLimit }));
app.use(requestIdMiddleware());
app.use(clientErrorCaptureMiddleware());
app.use(httpAccessLogMiddleware());

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
    log.error(`读取 openapi.json 失败: ${e?.stack || e?.message || e}`);
    res.status(500).json({ error: '无法读取 openapi.json' });
  }
});

app.get('/docs', (_req, res) => {
  res.type('html').send(SWAGGER_UI_HTML);
});

app.post('/api/auth/sso', async (req, res) => {
  if (process.env.PD2_AUTH_ENABLED !== '1') {
    return apiError(req, res, 503, {
      error: '未启用 Project2 单点登录',
      code: 'PD2_SSO_DISABLED',
    });
  }
  const token =
    typeof req.body?.token === 'string'
      ? req.body.token.trim()
      : '';
  if (!token) {
    return apiError(req, res, 400, {
      error: '缺少 Project2 Token',
      code: 'MISSING_PD2_TOKEN',
    });
  }
  try {
    const { loginWithPd2Token } = await import('./pd2Auth.js');
    const result = await loginWithPd2Token(db, token);
    if (!result.ok) {
      return apiError(
        req,
        res,
        401,
        { error: 'Project2 登录已失效，请重新登录供应链系统', code: result.code || 'PD2_SSO_FAILED' }
      );
    }
    log.info(
      `SSO 登录成功: ${result.user.username} (id=${result.user.id}, role=${result.user.role})`
    );
    res.json({ token: result.token, user: result.user });
  } catch (e) {
    sendServerError(res, log, req, 'SSO 登录失败', e, 'PD2_SSO_FAILED');
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username ||
    !password
  ) {
    return apiError(req, res, 400, {
      error: '请输入用户名和密码',
      code: 'MISSING_CREDENTIALS',
    });
  }
  try {
    const result = await tryLogin(db, username, password);
    if (!result.ok) {
      return apiError(
        req,
        res,
        401,
        { error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' },
        { username }
      );
    }
    log.info(
      `管理员登录成功: ${result.user.username} (id=${result.user.id}, role=${result.user.role})`
    );
    res.json({ token: result.token, user: result.user });
  } catch (e) {
    sendServerError(res, log, req, '登录失败', e, 'LOGIN_FAILED');
  }
});

async function main() {
  log.info(`启动中 NODE_ENV=${process.env.NODE_ENV || 'development'} PORT=${PORT}`);
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
  registerProfitReportRoutes(app, db, authMiddleware);
  registerInboundReportRoutes(app, db, authMiddleware);
  registerWarehouseStockReportRoutes(app, db, authMiddleware);
  logAuthHint();

  /** 未匹配的 /api/*（须在错误处理中间件之前） */
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return apiError(
        req,
        res,
        404,
        { error: '接口不存在', code: 'NOT_FOUND', path: req.originalUrl },
        { path: req.originalUrl }
      );
    }
    res.status(404).type('text').send('Not found');
  });

  /** 须最后注册：JSON 解析失败、未捕获异常 */
  app.use((err, req, res, _next) => {
    if (
      err instanceof SyntaxError &&
      'body' in err &&
      (err.status === 400 || err.statusCode === 400)
    ) {
      if (!res.headersSent) {
        return apiError(
          req,
          res,
          400,
          {
            error: '请求 JSON 格式无效',
            code: 'INVALID_JSON',
            detail: err.message,
          },
          { parseError: err.message }
        );
      }
    }
    const tooLarge =
      err?.type === 'entity.too.large' ||
      err?.status === 413 ||
      err?.statusCode === 413 ||
      /entity too large|payload too large/i.test(String(err?.message || ''));
    if (tooLarge) {
      if (!res.headersSent) {
        return apiError(
          req,
          res,
          413,
          {
            error: `请求体超过服务器限制（当前 JSON 上限为 ${jsonBodyLimit}），请缩小图片或使用图片地址 URL`,
            code: 'PAYLOAD_TOO_LARGE',
          },
          { limit: jsonBodyLimit, message: err?.message || String(err) }
        );
      }
    }
    sendServerError(res, log, req, '服务器内部错误', err, 'UNHANDLED_EXCEPTION');
  });

  app.listen(PORT, () => {
    log.info(`HTTP 服务已监听 http://localhost:${PORT}`);
    log.info(`Swagger UI http://localhost:${PORT}/docs`);
    log.info(`OpenAPI JSON http://localhost:${PORT}/openapi.json`);
  });
}

main().catch((err) => {
  log.error(`进程退出: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
