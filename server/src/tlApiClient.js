import { createLogger } from './logger.js';

const log = createLogger('nemh.tlApiClient');

/** @type {{ token: string | null, expiresAt: number }} */
let cached = { token: null, expiresAt: 0 };

function baseUrl() {
  return process.env.TL_API_BASE_URL?.trim().replace(/\/$/, '') || '';
}

function requestTimeoutMs() {
  const n = Number(process.env.TL_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

function tokenRefreshMarginSec() {
  const n = Number(process.env.TL_API_TOKEN_REFRESH_MARGIN);
  return Number.isFinite(n) && n >= 0 ? n : 300;
}

function expiresAtFromJwt(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return 0;
    const payload = JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8'
      )
    );
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    /* ignore */
  }
  return 0;
}

export function isTlApiConfigured() {
  return Boolean(baseUrl() && process.env.TL_API_USERNAME?.trim());
}

/**
 * TL 比价系统登录（POST /auth/login）。仅用于获取 token，不对 TL 写业务数据。
 * 环境变量：TL_API_BASE_URL、TL_API_USERNAME、TL_API_PASSWORD
 */
export async function getTlToken() {
  if (!isTlApiConfigured()) {
    throw new Error('未配置 TL_API_BASE_URL 或 TL_API_USERNAME');
  }

  const marginMs = tokenRefreshMarginSec() * 1000;
  if (cached.token && Date.now() < cached.expiresAt - marginMs) {
    return cached.token;
  }

  const username = process.env.TL_API_USERNAME.trim();
  const password = process.env.TL_API_PASSWORD ?? '';

  const res = await fetch(`${baseUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const detail = data?.detail ?? data?.msg ?? text.slice(0, 200);
    throw new Error(`TL 登录失败 HTTP ${res.status}: ${detail}`);
  }

  const token =
    typeof data?.token === 'string'
      ? data.token
      : typeof data?.access_token === 'string'
        ? data.access_token
        : '';
  if (!token) {
    throw new Error('TL 登录响应中无 token');
  }

  const jwtExp = expiresAtFromJwt(token);
  cached = {
    token,
    expiresAt: jwtExp > Date.now() ? jwtExp : Date.now() + 7 * 24 * 3600 * 1000,
  };
  log.info('TL API token 已刷新');
  return cached.token;
}

/**
 * 对 TL 发起 GET（禁止其它 method）。
 * @param {string} apiPath 如 /tl/get_warehouses
 * @param {Record<string, string | number | undefined>} [query]
 */
export async function tlApiGet(apiPath, query = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (!path.startsWith('/tl/') && path !== '/auth/permissions/me') {
    throw new Error(`TL 只读路径不允许: ${path}`);
  }

  const token = await getTlToken();
  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const detail = data?.detail ?? data?.msg ?? text.slice(0, 200);
    throw new Error(`TL GET ${path} → HTTP ${res.status}: ${detail}`);
  }

  return data;
}
