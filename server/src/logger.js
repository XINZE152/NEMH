/**
 * 应用日志：对齐常见 Python 格式
 *   YYYY-MM-DD HH:mm:ss,mmm - 模块名 - LEVEL - 消息
 * HTTP 访问行：对齐 Nginx combined 风格（含耗时 ms）
 *
 * 环境变量：
 *   LOG_LEVEL   — debug | info | warn | error，默认 info
 *   LOG_HTTP    — 设为 0 关闭每条 HTTP 访问日志，默认开启
 *   LOG_AUTH    — 设为 1 时在 debug 级别下对鉴权成功打一条业务日志（默认关闭，避免与 HTTP 行重复）
 *   LOG_API_CLIENT_ERRORS — 设为 0 关闭 4xx 明细行（nemh.api），默认开启
 *   LOG_API_REQUEST_BODY  — 设为 0 不在 4xx 明细中打印脱敏后的 requestBody，默认开启
 *   NEMH_EXPOSE_ERROR_DETAIL — 设为 1 时，500 类 JSON 响应附带 `detail`（异常 message）；非 production 时默认附带
 */

const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel() {
  const v = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return v in LEVEL_ORDER ? v : 'info';
}

function shouldLog(level) {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel()];
}

function getPart(parts, type) {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** 上海时区，Python logging 风格时间戳 */
export function formatPyTimestamp(date = new Date()) {
  const d1 = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const y = getPart(d1, 'year');
  const mo = getPart(d1, 'month');
  const d = getPart(d1, 'day');
  const h = getPart(d1, 'hour');
  const mi = getPart(d1, 'minute');
  const s = getPart(d1, 'second');
  const fracParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    fractionalSecondDigits: 3,
  }).formatToParts(date);
  const frac = getPart(fracParts, 'fractionalSecond') || '000';
  return `${y}-${mo}-${d} ${h}:${mi}:${s},${frac}`;
}

/** Nginx access_log 方括号内时间（固定 +0800，与业务时区一致） */
export function formatNginxTime(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const day = getPart(p, 'day');
  const month = getPart(p, 'month');
  const year = getPart(p, 'year');
  const hour = getPart(p, 'hour');
  const minute = getPart(p, 'minute');
  const second = getPart(p, 'second');
  return `[${day}/${month}/${year}:${hour}:${minute}:${second} +0800]`;
}

function q(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function createLogger(name) {
  const line = (level, msg) => {
    if (!shouldLog(level)) return;
    const lvl = level.toUpperCase();
    console.log(`${formatPyTimestamp()} - ${name} - ${lvl} - ${msg}`);
  };
  return {
    error: (msg) => line('error', msg),
    warn: (msg) => line('warn', msg),
    info: (msg) => line('info', msg),
    debug: (msg) => line('debug', msg),
  };
}

const httpLogger = createLogger('nemh.http');
const apiErrorLogger = createLogger('nemh.api');

const BINARY_LOG_FIELD_RE =
  /photo|proof|image|slip|base64|password|token|authorization/i;

function shouldLogApiClientErrors() {
  return process.env.LOG_API_CLIENT_ERRORS !== '0';
}

function shouldLogApiRequestBody() {
  return process.env.LOG_API_REQUEST_BODY !== '0';
}

/** 日志中省略超长或二进制类字段，避免 api.log 被 base64 撑爆 */
export function sanitizeForApiLog(value, depth = 0) {
  if (depth > 6) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 500) {
      return `[string len=${value.length} head=${value.slice(0, 40)}…]`;
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForApiLog(v, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (BINARY_LOG_FIELD_RE.test(k) && typeof v === 'string' && v.length > 80) {
      out[k] = `[omitted len=${v.length}]`;
    } else {
      out[k] = sanitizeForApiLog(v, depth + 1);
    }
  }
  return out;
}

export function formatRequestActor(req) {
  if (!req?.admin) return 'userId=- role=-';
  return `userId=${req.admin.id} role=${req.admin.role || '-'}`;
}

export function formatRequestBodySummary(body) {
  if (body == null || typeof body !== 'object') return '';
  try {
    return JSON.stringify(sanitizeForApiLog(body));
  } catch {
    return '[body-serialize-failed]';
  }
}

/** 路由内在返回 4xx 前附加可检索的业务上下文（会写入 api.log） */
export function setApiLogContext(res, context) {
  if (!res || !context) return;
  res.locals.nemhApiLogContext = {
    ...(res.locals.nemhApiLogContext || {}),
    ...context,
  };
}

/**
 * 记录 4xx/5xx 业务错误（与 HTTP 访问行配套，便于 grep「nemh.api」）
 */
export function logApiClientError(req, statusCode, errorBody, extraContext) {
  if (!shouldLogApiClientErrors()) return;
  const body = errorBody && typeof errorBody === 'object' ? errorBody : { error: String(errorBody) };
  const parts = [
    `HTTP ${statusCode}`,
    `${req?.method || '?'}`,
    req?.originalUrl || '?',
    formatRequestActor(req),
    `bizCode=${body.code || '-'}`,
    `error=${body.error || '-'}`,
  ];
  if (body.shortfall != null) parts.push(`shortfall=${body.shortfall}`);
  if (body.availableWeight != null) parts.push(`availableWeight=${body.availableWeight}`);
  if (body.latestPurchaseUnitPrice != null) {
    parts.push(`latestPurchaseUnitPrice=${body.latestPurchaseUnitPrice}`);
  }
  const ctx = extraContext || {};
  if (Object.keys(ctx).length) {
    parts.push(`context=${JSON.stringify(sanitizeForApiLog(ctx))}`);
  }
  if (shouldLogApiRequestBody() && req?.body && Object.keys(req.body).length) {
    parts.push(`requestBody=${formatRequestBodySummary(req.body)}`);
  }
  apiErrorLogger.warn(parts.join(' '));
}

/**
 * 捕获 res.json 中的错误响应体，在访问日志之后输出明细行。
 * 须在 express.json() 之后、业务路由之前注册。
 */
export function clientErrorCaptureMiddleware() {
  return (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = function jsonWithCapture(body) {
      if (res.statusCode >= 400 && body != null && typeof body === 'object') {
        res.locals.nemhApiErrorBody = body;
      }
      return origJson(body);
    };
    next();
  };
}

/** 是否在 JSON 中向客户端返回 `detail`（便于联调；生产可关） */
export function exposeErrorDetail() {
  return (
    process.env.NEMH_EXPOSE_ERROR_DETAIL === '1' ||
    String(process.env.NODE_ENV || '').toLowerCase() !== 'production'
  );
}

/**
 * 记录并返回 500：日志含 method、URL、堆栈；响应含 error、code，可选 detail
 */
export function sendServerError(res, log, req, userFacingMessage, err, code = 'INTERNAL_ERROR') {
  const e = err || new Error('unknown');
  const msg = e?.message || String(e);
  const stack = e?.stack || '';
  const who = req?.admin?.id != null ? `userId=${req.admin.id}` : 'userId=-';
  log.error(
    `HTTP 500 ${code} ${req?.method || '?'} ${req?.originalUrl || '?'} ${who} msg=${msg}${stack ? '\n' + stack : ''}`
  );
  const body = { error: userFacingMessage, code };
  if (exposeErrorDetail()) body.detail = msg;
  if (!res.headersSent) res.status(500).json(body);
}

export function httpAccessLogMiddleware() {
  return (req, res, next) => {
    if (process.env.LOG_HTTP === '0') {
      return next();
    }
    const start = performance.now();
    res.on('finish', () => {
      const ms = Math.round(performance.now() - start);
      const xf = req.headers['x-forwarded-for'];
      const ip =
        (typeof xf === 'string' && xf.split(',')[0].trim()) ||
        req.socket?.remoteAddress ||
        '-';
      const referer = req.headers.referer || '-';
      const ua = req.headers['user-agent'] || '-';
      const len = res.getHeader('content-length');
      const lenStr = len == null ? '-' : String(len);
      const nginxT = formatNginxTime();
      const reqLine = `${req.method} ${req.originalUrl} HTTP/${req.httpVersion || '1.1'}`;
      httpLogger.info(
        `${ip} - - ${nginxT} "${q(reqLine)}" ${res.statusCode} ${lenStr} "${q(referer)}" "${q(ua)}" ${ms}ms`
      );

      const status = res.statusCode;
      if (status >= 400 && shouldLogApiClientErrors()) {
        const errBody = res.locals.nemhApiErrorBody;
        const ctx = res.locals.nemhApiLogContext;
        if (errBody) {
          logApiClientError(req, status, errBody, ctx);
        } else {
          apiErrorLogger.warn(
            `HTTP ${status} ${req.method} ${req.originalUrl} ${formatRequestActor(req)} (响应无 JSON 错误体，可能为 204/纯文本)`
          );
        }
      }
    });
    next();
  };
}
