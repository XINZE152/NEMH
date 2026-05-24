import { run, all, get } from './db.js';
import { hashPassword, USER_ROLES, requireStatisticsRole } from './auth.js';
import { createLogger } from './logger.js';
import { enrichUserWithRoleLabel } from './roleLabels.js';
import { isPd2AuthEnabled, pd2UserManagementBlockedResponse } from './pd2Auth.js';

const log = createLogger('nemh.adminUsers');

function parseUserRoleInput(v, fallback = 'warehouse') {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim();
  if (USER_ROLES.includes(s)) return s;
  return null;
}

function isUniqueConstraint(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT' ||
      String(err.message || '').includes('UNIQUE'))
  );
}

export function registerUserAdminRoutes(app, db, authMiddleware) {
  app.get('/api/admin/users', authMiddleware, requireStatisticsRole, async (req, res) => {
    try {
      const rows = await all(
        db,
        'SELECT id, username, role, created_at, updated_at FROM users ORDER BY id ASC'
      );
      res.json(rows.map(enrichUserWithRoleLabel));
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询用户失败' });
    }
  });

  app.post('/api/admin/users', authMiddleware, requireStatisticsRole, async (req, res) => {
    if (isPd2AuthEnabled()) {
      return res.status(403).json(pd2UserManagementBlockedResponse());
    }
    try {
      const { username, password, role: roleRaw } = req.body || {};
      if (
        typeof username !== 'string' ||
        !username.trim() ||
        typeof password !== 'string' ||
        password.length < 4
      ) {
        return res
          .status(400)
          .json({ error: '用户名必填，密码至少 4 位' });
      }
      const role = parseUserRoleInput(roleRaw, 'warehouse');
      if (role === null) {
        return res.status(400).json({
          error: `role 须为 ${USER_ROLES.join(' 或 ')}（财务部默认 warehouse）`,
        });
      }
      const hash = hashPassword(password);
      const result = await run(
        db,
        `INSERT INTO users (username, password_hash, role, updated_at) VALUES (?, ?, ?, datetime('now'))`,
        [username.trim(), hash, role]
      );
      const row = await get(
        db,
        'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
        [result.lastID]
      );
      res.status(201).json(enrichUserWithRoleLabel(row));
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '用户名已存在' });
      }
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '创建用户失败' });
    }
  });

  app.put(
    '/api/admin/users/:id',
    authMiddleware,
    requireStatisticsRole,
    async (req, res) => {
    if (isPd2AuthEnabled()) {
      return res.status(403).json(pd2UserManagementBlockedResponse());
    }
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const { username, password, role: roleRaw } = req.body || {};
      const existing = await get(db, 'SELECT id FROM users WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: '用户不存在' });

      if (
        username !== undefined &&
        (typeof username !== 'string' || !username.trim())
      ) {
        return res.status(400).json({ error: '用户名不能为空' });
      }
      if (
        password !== undefined &&
        (typeof password !== 'string' || password.length < 4)
      ) {
        return res.status(400).json({ error: '新密码至少 4 位' });
      }
      if (roleRaw !== undefined && roleRaw !== null && roleRaw !== '') {
        const parsed = parseUserRoleInput(roleRaw, 'warehouse');
        if (parsed === null) {
          return res.status(400).json({
            error: `role 须为 ${USER_ROLES.join(' 或 ')}`,
          });
        }
      }
      if (
        username === undefined &&
        password === undefined &&
        roleRaw === undefined
      ) {
        const row = await get(
          db,
          'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
          [id]
        );
        return res.json(enrichUserWithRoleLabel(row));
      }

      const fields = [];
      const params = [];
      if (username !== undefined) {
        fields.push('username = ?');
        params.push(username.trim());
      }
      if (password !== undefined) {
        fields.push('password_hash = ?');
        params.push(hashPassword(password));
      }
      if (roleRaw !== undefined) {
        const parsed = parseUserRoleInput(roleRaw, 'warehouse');
        if (parsed === null) {
          return res.status(400).json({
            error: `role 须为 ${USER_ROLES.join(' 或 ')}`,
          });
        }
        fields.push('role = ?');
        params.push(parsed);
      }
      fields.push("updated_at = datetime('now')");
      params.push(id);
      await run(
        db,
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        params
      );
      const row = await get(
        db,
        'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
        [id]
      );
      res.json(enrichUserWithRoleLabel(row));
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '用户名已存在' });
      }
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '更新用户失败' });
    }
  }
  );

  app.delete(
    '/api/admin/users/:id',
    authMiddleware,
    requireStatisticsRole,
    async (req, res) => {
    if (isPd2AuthEnabled()) {
      return res.status(403).json(pd2UserManagementBlockedResponse());
    }
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const total = await get(db, 'SELECT COUNT(*) AS c FROM users');
      if (Number(total.c) <= 1) {
        return res.status(400).json({ error: '不能删除最后一个用户' });
      }
      const existing = await get(db, 'SELECT id FROM users WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: '用户不存在' });
      const result = await run(db, 'DELETE FROM users WHERE id = ?', [id]);
      if (result.changes === 0) return res.status(404).json({ error: '用户不存在' });
      res.status(204).send();
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '删除用户失败' });
    }
  }
  );
}
