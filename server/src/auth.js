import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { get } from './db.js';

const JWT_SECRET =
  process.env.JWT_SECRET || 'demo-jwt-secret-change-in-production';

export const USER_ROLES = ['warehouse', 'statistics'];

export function normalizeUserRole(role) {
  if (role === 'statistics') return 'statistics';
  return 'warehouse';
}

export function logAuthHint() {
  console.log(
    '[auth] 空库自动创建 admin / admin123（statistics）：审核入库、管理用户、发布对外报价。库房 role=warehouse：收货定价、入库、出库。自助注册：POST /api/register（固定库房角色）。JWT_SECRET 可覆盖密钥。'
  );
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
      return res.status(401).json({ error: '未登录或缺少 Token' });
    }
    const token = raw.slice(7);
    let userId;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      userId = Number(payload.sub);
      if (!Number.isInteger(userId) || userId < 1) {
        return res.status(401).json({ error: '登录已失效，请重新登录' });
      }
    } catch {
      return res.status(401).json({ error: '登录已失效，请重新登录' });
    }

    get(db, 'SELECT id, username, role FROM users WHERE id = ?', [userId])
      .then((row) => {
        if (!row) {
          return res.status(401).json({ error: '用户不存在或已删除' });
        }
        req.admin = {
          id: row.id,
          username: row.username,
          role: normalizeUserRole(row.role),
        };
        next();
      })
      .catch((e) => {
        console.error(e);
        res.status(500).json({ error: '鉴权失败' });
      });
  };
}

/** 仅统计部：审核入库、用户管理、发布报价等 */
export function requireStatisticsRole(req, res, next) {
  if (req.admin?.role === 'statistics') {
    return next();
  }
  return res.status(403).json({ error: '仅统计部可操作' });
}

/** 仅库房：收货定价、入库录入、出库等 */
export function requireWarehouseRole(req, res, next) {
  if (req.admin?.role === 'warehouse') {
    return next();
  }
  return res.status(403).json({ error: '仅库房可操作' });
}

/** 仅统计部：发布对外统一市场报价（语义别名，与 requireStatisticsRole 一致） */
export function requireStatisticsPublish(req, res, next) {
  return requireStatisticsRole(req, res, next);
}
