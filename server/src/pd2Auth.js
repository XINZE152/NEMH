import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { get, run } from './db.js';
import {
  createAdminToken,
  hashPassword,
  normalizeUserRole,
  verifyPassword,
} from './auth.js';
import { enrichUserWithRoleLabel } from './roleLabels.js';
import { createLogger } from './logger.js';

const log = createLogger('nemh.pd2Auth');

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

export function isPd2AuthEnabled() {
  return process.env.PD2_AUTH_ENABLED === '1';
}

function pd2JwtSecret() {
  return (
    process.env.PD2_JWT_SECRET?.trim() ||
    'change_this_to_a_strong_random_secret'
  );
}

function mysqlConfig() {
  return {
    host: process.env.PD2_MYSQL_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.PD2_MYSQL_PORT) || 3306,
    user: process.env.PD2_MYSQL_USER?.trim() || 'root',
    password: process.env.PD2_MYSQL_PASSWORD ?? '',
    database: process.env.PD2_MYSQL_DATABASE?.trim() || 'PD_max',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 4,
  };
}

export function isPd2MysqlEnabled() {
  return (
    process.env.PD2_AUTH_ENABLED === '1' ||
    Boolean(process.env.PD2_MYSQL_HOST?.trim())
  );
}

export function getPd2Pool() {
  if (!pool) {
    pool = mysql.createPool(mysqlConfig());
  }
  return pool;
}

function getPool() {
  return getPd2Pool();
}

/** P2 role → P3 role；admin 映射为 statistics，其余默认 warehouse */
export function mapPd2RoleToNemh(pd2Role) {
  const code = String(pd2Role || '').trim().toLowerCase();
  if (code === 'admin') return 'statistics';
  return 'warehouse';
}

async function fetchPd2UserByUsername(username) {
  const [rows] = await getPool().query(
    `SELECT id, username, hashed_password, role, is_active
     FROM users WHERE username = ? LIMIT 1`,
    [username.trim()]
  );
  return rows[0] || null;
}

async function fetchPd2UserById(userId) {
  const [rows] = await getPool().query(
    `SELECT id, username, role, is_active
     FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function verifyPd2Password(plain, hashed) {
  if (!hashed) return false;
  try {
    return verifyPassword(plain, hashed);
  } catch {
    return false;
  }
}

export function verifyPd2AccessToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token.trim(), pd2JwtSecret(), {
      algorithms: ['HS256'],
    });
  } catch {
    return null;
  }
}

async function syncShadowUser(db, pd2User) {
  const nemhRole = normalizeUserRole(mapPd2RoleToNemh(pd2User.role));
  const pd2Id = Number(pd2User.id);

  let row = await get(
    db,
    'SELECT id, username, role FROM users WHERE pd2_user_id = ?',
    [pd2Id]
  );
  if (!row) {
    row = await get(
      db,
      'SELECT id, username, role, pd2_user_id FROM users WHERE username = ?',
      [pd2User.username]
    );
  }

  if (row) {
    await run(
      db,
      `UPDATE users SET username = ?, role = ?, pd2_user_id = ?, source = 'pd2',
         updated_at = datetime('now') WHERE id = ?`,
      [pd2User.username, nemhRole, pd2Id, row.id]
    );
    return { id: row.id, username: pd2User.username, role: nemhRole };
  }

  const placeholderHash = hashPassword('__pd2_sso_no_local_password__');
  const result = await run(
    db,
    `INSERT INTO users (username, password_hash, role, pd2_user_id, source, updated_at)
     VALUES (?, ?, ?, ?, 'pd2', datetime('now'))`,
    [pd2User.username, placeholderHash, nemhRole, pd2Id]
  );
  return {
    id: result.lastID,
    username: pd2User.username,
    role: nemhRole,
  };
}

function buildLoginResult(localUser) {
  const role = normalizeUserRole(localUser.role);
  return {
    ok: true,
    token: createAdminToken(localUser.id, localUser.username, role),
    user: enrichUserWithRoleLabel({
      id: localUser.id,
      username: localUser.username,
      role,
    }),
  };
}

export async function loginWithPd2Password(db, username, password) {
  const row = await fetchPd2UserByUsername(username);
  if (!row || !row.is_active) return { ok: false };
  if (!verifyPd2Password(password, row.hashed_password)) return { ok: false };

  const localUser = await syncShadowUser(db, row);
  log.info(
    `PD2 密码登录成功: ${localUser.username} (pd2_id=${row.id}, nemh_id=${localUser.id})`
  );
  return buildLoginResult(localUser);
}

export async function loginWithPd2Token(db, pd2Token) {
  const payload = verifyPd2AccessToken(pd2Token);
  if (!payload) return { ok: false, code: 'INVALID_PD2_TOKEN' };

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId < 1) {
    return { ok: false, code: 'INVALID_PD2_TOKEN_SUB' };
  }

  const row = await fetchPd2UserById(userId);
  if (!row || !row.is_active) {
    return { ok: false, code: 'PD2_USER_INACTIVE' };
  }
  if (
    payload.username &&
    String(payload.username) !== String(row.username)
  ) {
    return { ok: false, code: 'PD2_TOKEN_USER_MISMATCH' };
  }

  const localUser = await syncShadowUser(db, row);
  log.info(
    `PD2 SSO 成功: ${localUser.username} (pd2_id=${row.id}, nemh_id=${localUser.id})`
  );
  return buildLoginResult(localUser);
}

export function pd2UserManagementBlockedResponse() {
  return {
    error: '用户请在 Project2（供应链系统）中管理',
    code: 'PD2_USER_MANAGEMENT_DISABLED',
  };
}
