/**
 * 应用日志：对齐常见 Python 格式
 *   YYYY-MM-DD HH:mm:ss,mmm - 模块名 - LEVEL - 消息
 * HTTP 访问行：对齐 Nginx combined 风格（含耗时 ms）
 *
 * 环境变量：
 *   LOG_LEVEL   — debug | info | warn | error，默认 info
 *   LOG_HTTP    — 设为 0 关闭每条 HTTP 访问日志，默认开启
 *   LOG_AUTH    — 设为 1 时在 debug 级别下对鉴权成功打一条业务日志（默认关闭，避免与 HTTP 行重复）
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
    });
    next();
  };
}
