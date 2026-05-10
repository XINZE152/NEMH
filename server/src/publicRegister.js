import { run, get } from './db.js';
import { hashPassword } from './auth.js';

const USERNAME_MAX = 64;

function isUniqueConstraint(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT' ||
      String(err.message || '').includes('UNIQUE'))
  );
}

function trimUsername(s) {
  return String(s || '').trim();
}

/** 无需登录：自助注册为库房角色（不可注册为统计部） */
export function registerPublicRegisterRoute(app, db) {
  app.post('/api/register', async (req, res) => {
    if (process.env.DISABLE_PUBLIC_REGISTER === '1') {
      return res.status(403).json({ error: '已关闭自助注册' });
    }
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || !trimUsername(username)) {
        return res.status(400).json({ error: '用户名必填且不能为空' });
      }
      const u = trimUsername(username);
      if (u.length > USERNAME_MAX) {
        return res.status(400).json({ error: `用户名最长 ${USERNAME_MAX} 个字符` });
      }
      if (typeof password !== 'string' || password.length < 4) {
        return res.status(400).json({ error: '密码至少 4 位' });
      }
      const hash = hashPassword(password);
      const result = await run(
        db,
        `INSERT INTO users (username, password_hash, role, updated_at)
         VALUES (?, ?, 'warehouse', datetime('now'))`,
        [u, hash]
      );
      const row = await get(
        db,
        'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
        [result.lastID]
      );
      res.status(201).json(row);
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '用户名已存在' });
      }
      console.error(e);
      res.status(500).json({ error: '注册失败' });
    }
  });
}
