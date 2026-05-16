import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { get } from './db.js';
import { createLogger, apiError } from './logger.js';

const log = createLogger('nemh.auth');

const JWT_SECRET =
  process.env.JWT_SECRET || 'demo-jwt-secret-change-in-production';

export const USER_ROLES = ['warehouse', 'statistics'];

export function normalizeUserRole(role) {
  if (role === 'statistics') return 'statistics';
  return 'warehouse';
}

export function logAuthHint() {
  console.log(
    '[auth] 空库自动创建 admin / admin123（statistics）：内置超级管理员，拥有统计部与库房全部 API 权限。其他 statistics 用户仅统计部接口；库房 role=warehouse：收货定价、入库、出库。自助注册：POST /api/register。JWT_SECRET 可覆盖密钥。'
  );
}

/** 内置账号 admin：在保持 DB 角色为 statistics 的前提下，放行库房与统计部两类接口（本地/内网联调用）。 */
export function isBuiltInSuperAdmin(req) {
  return req.admin?.username === 'admin';
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function createAdminToken(userId, username, role) {
  const r = normalizeUserRole(role);
  return jwt.sign(
    { sub: String(userId), username, role: r },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function tryLogin(db, username, password) {
  const row = await get(
    db,
    'SELECT id, username, password_hash, role FROM users WHERE username = ?',
    [username.trim()]
  );
  if (!row) return { ok: false };
  if (!verifyPassword(password, row.password_hash)) return { ok: false };
  const role = normalizeUserRole(row.role);
  return {
    ok: true,
    token: createAdminToken(row.id, row.username, role),
    user: { id: row.id, username: row.username, role },
  };
}

/** 鉴权：校验 Token 并从数据库加载当前用户角色（与 JWT 解耦，改角色后重新请求即可生效）。 */
export function createAuthMiddleware(db) {
  return function authMiddleware(req, res, next) {
    const raw = req.headers.authorization;
    if (!raw || !raw.startsWith('Bearer ')) {
      return apiError(req, res, 401, {
        error: '未登录或缺少 Token',
        code: 'MISSING_TOKEN',
      });
    }
    const token = raw.slice(7);
    let userId;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      userId = Number(payload.sub);
      if (!Number.isInteger(userId) || userId < 1) {
        return apiError(req, res, 401, {
          error: '登录已失效，请重新登录',
          code: 'INVALID_TOKEN_SUB',
        });
      }
    } catch (e) {
      return apiError(
        req,
        res,
        401,
        { error: '登录已失效，请重新登录', code: 'INVALID_TOKEN' },
        { jwtError: e?.message || String(e) }
      );
    }

    get(db, 'SELECT id, username, role FROM users WHERE id = ?', [userId])
      .then((row) => {
        if (!row) {
          return apiError(
            req,
            res,
            401,
            { error: '用户不存在或已删除', code: 'USER_NOT_FOUND' },
            { userId }
          );
        }
        req.admin = {
          id: row.id,
          username: row.username,
          role: normalizeUserRole(row.role),
        };
        if (process.env.LOG_AUTH === '1') {
          log.debug(
            `JWT 鉴权成功: ${row.username} (id=${row.id}, role=${req.admin.role})`
          );
        }
        next();
      })
      .catch((e) => {
        log.error(`鉴权查询用户失败: ${e?.message || e}`);
        apiError(
          req,
          res,
          500,
          { error: '鉴权失败', code: 'AUTH_DB_ERROR' },
          { message: e?.message || String(e) }
        );
      });
  };
}

/** 仅统计部：审核入库、用户管理、发布报价等（admin 超级管理员亦放行） */
export function requireStatisticsRole(req, res, next) {
  if (isBuiltInSuperAdmin(req) || req.admin?.role === 'statistics') {
    return next();
  }
  return apiError(
    req,
    res,
    403,
    { error: '仅统计部可操作', code: 'STATISTICS_ROLE_REQUIRED' },
    { role: req.admin?.role, username: req.admin?.username }
  );
}

/** 仅库房：收货定价、入库录入、出库等（admin 超级管理员亦放行） */
export function requireWarehouseRole(req, res, next) {
  if (isBuiltInSuperAdmin(req) || req.admin?.role === 'warehouse') {
    return next();
  }
  return apiError(
    req,
    res,
    403,
    { error: '仅库房可操作', code: 'WAREHOUSE_ROLE_REQUIRED' },
    { role: req.admin?.role, username: req.admin?.username }
  );
}

/** 仅统计部：发布对外统一市场报价（语义别名，与 requireStatisticsRole 一致） */
export function requireStatisticsPublish(req, res, next) {
  return requireStatisticsRole(req, res, next);
}
