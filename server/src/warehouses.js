import { run, all, get } from './db.js';
import { createLogger } from './logger.js';
import {
  isBaocheWarehouseCrudLocked,
  isBaocheWarehouseSyncEnabled,
  syncWarehousesFromBaoche,
} from './baocheWarehouses.js';

const log = createLogger('nemh.warehouses');

function isUniqueConstraint(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT' ||
      String(err.message || '').includes('UNIQUE'))
  );
}

function trimStr(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function mapWarehouseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address ?? '',
    externalSource: row.external_source ?? null,
    externalId: row.external_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function baocheCrudBlocked(res) {
  if (!isBaocheWarehouseCrudLocked()) return false;
  res.status(403).json({
    error:
      '已启用宝驰库房同步，本地不可增删改库房；请配置宝驰接口或设置 BAOCHI_ALLOW_LOCAL_WAREHOUSE_CRUD=1',
    code: 'BAOCHI_WAREHOUSE_READONLY',
  });
  return true;
}

export function registerWarehouseRoutes(app, db, authMiddleware) {
  app.post(
    '/api/admin/warehouses/sync-from-baoche',
    authMiddleware,
    async (req, res) => {
      try {
        if (!isBaocheWarehouseSyncEnabled()) {
          return res.status(400).json({
            error: '未配置 BAOCHI_WAREHOUSE_API_URL，无法从宝驰同步库房',
            code: 'BAOCHI_NOT_CONFIGURED',
          });
        }
        const result = await syncWarehousesFromBaoche(db);
        res.json(result);
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(502).json({
          error: e?.message || '宝驰库房同步失败',
          code: 'BAOCHI_SYNC_FAILED',
        });
      }
    }
  );

  app.get('/api/admin/warehouses', authMiddleware, async (req, res) => {
    try {
      const shouldSync =
        req.query.sync === '1' || req.query.sync === 'true';
      if (shouldSync && isBaocheWarehouseSyncEnabled()) {
        try {
          await syncWarehousesFromBaoche(db);
        } catch (e) {
          log.warn(`列表拉取前宝驰同步失败: ${e?.message || e}`);
        }
      }

      const search = trimStr(req.query.search);
      let sql = `SELECT id, code, name,
          IFNULL(address, '') AS address,
          external_source,
          external_id,
          created_at AS created_at,
          updated_at AS updated_at
        FROM warehouses`;
      const params = [];
      if (search) {
        sql += ` WHERE code LIKE ? OR name LIKE ? OR IFNULL(address, '') LIKE ?`;
        const like = `%${search.replace(/%/g, '')}%`;
        params.push(like, like, like);
      }
      sql += ` ORDER BY datetime(created_at) ASC, id ASC`;
      const rows = await all(db, sql, params);
      res.json(rows.map(mapWarehouseRow));
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询库房失败' });
    }
  });

  app.get('/api/admin/warehouses/:id', authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const row = await get(
        db,
        `SELECT id, code, name,
            IFNULL(address, '') AS address,
            external_source,
            external_id,
            created_at AS created_at,
            updated_at AS updated_at
          FROM warehouses WHERE id = ?`,
        [id]
      );
      if (!row) return res.status(404).json({ error: '库房不存在' });
      res.json(mapWarehouseRow(row));
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询库房失败' });
    }
  });

  app.post('/api/admin/warehouses', authMiddleware, async (req, res) => {
    try {
      if (baocheCrudBlocked(res)) return;
      const body = req.body || {};
      const code = trimStr(body.code);
      const name = trimStr(body.name);
      const address = trimStr(body.address);
      if (!code || !name) {
        return res.status(400).json({ error: '库房代码与名称不能为空' });
      }
      const result = await run(
        db,
        `INSERT INTO warehouses (code, name, address, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [code, name, address || null]
      );
      const row = await get(
        db,
        `SELECT id, code, name,
            IFNULL(address, '') AS address,
            external_source,
            external_id,
            created_at AS created_at,
            updated_at AS updated_at
          FROM warehouses WHERE id = ?`,
        [result.lastID]
      );
      res.status(201).json(mapWarehouseRow(row));
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '库房代码已存在' });
      }
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '创建库房失败' });
    }
  });

  app.put('/api/admin/warehouses/:id', authMiddleware, async (req, res) => {
    try {
      if (baocheCrudBlocked(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const existing = await get(db, 'SELECT id, code FROM warehouses WHERE id = ?', [
        id,
      ]);
      if (!existing) return res.status(404).json({ error: '库房不存在' });

      const body = req.body || {};
      const code =
        body.code !== undefined ? trimStr(body.code) : undefined;
      const name =
        body.name !== undefined ? trimStr(body.name) : undefined;
      const address =
        body.address !== undefined ? trimStr(body.address) : undefined;

      if (code !== undefined && !code) {
        return res.status(400).json({ error: '库房代码不能为空' });
      }
      if (name !== undefined && !name) {
        return res.status(400).json({ error: '库房名称不能为空' });
      }
      if (code === undefined && name === undefined && address === undefined) {
        const row = await get(
          db,
          `SELECT id, code, name,
              IFNULL(address, '') AS address,
              created_at AS created_at,
              updated_at AS updated_at
            FROM warehouses WHERE id = ?`,
          [id]
        );
        return res.json(mapWarehouseRow(row));
      }

      const fields = [];
      const params = [];
      if (code !== undefined) {
        fields.push('code = ?');
        params.push(code);
      }
      if (name !== undefined) {
        fields.push('name = ?');
        params.push(name);
      }
      if (address !== undefined) {
        fields.push('address = ?');
        params.push(address || null);
      }
      fields.push("updated_at = datetime('now')");
      params.push(id);
      await run(
        db,
        `UPDATE warehouses SET ${fields.join(', ')} WHERE id = ?`,
        params
      );
      const row = await get(
        db,
        `SELECT id, code, name,
            IFNULL(address, '') AS address,
            external_source,
            external_id,
            created_at AS created_at,
            updated_at AS updated_at
          FROM warehouses WHERE id = ?`,
        [id]
      );
      res.json(mapWarehouseRow(row));
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '库房代码已存在' });
      }
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '更新库房失败' });
    }
  });

  app.delete('/api/admin/warehouses/:id', authMiddleware, async (req, res) => {
    try {
      if (baocheCrudBlocked(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const existing = await get(db, 'SELECT id FROM warehouses WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: '库房不存在' });

      const totalRow = await get(db, 'SELECT COUNT(*) AS c FROM warehouses');
      if (Number(totalRow?.c ?? 0) <= 1) {
        return res.status(400).json({ error: '至少保留一个库房' });
      }

      const inboundC = await get(
        db,
        'SELECT COUNT(*) AS c FROM inbound_orders WHERE warehouse_id = ?',
        [id]
      );
      if (Number(inboundC?.c ?? 0) > 0) {
        return res
          .status(400)
          .json({ error: '该库房下仍存在入库单记录，无法删除' });
      }

      const outboundC = await get(
        db,
        'SELECT COUNT(*) AS c FROM outbound_orders WHERE warehouse_id = ?',
        [id]
      );
      if (Number(outboundC?.c ?? 0) > 0) {
        return res
          .status(400)
          .json({ error: '该库房下仍存在出库单记录，无法删除' });
      }

      await run(
        db,
        'DELETE FROM warehouse_material_outbound WHERE warehouse_id = ?',
        [id]
      );
      const result = await run(db, 'DELETE FROM warehouses WHERE id = ?', [id]);
      if (result.changes === 0) return res.status(404).json({ error: '库房不存在' });
      res.status(204).send();
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '删除库房失败' });
    }
  });
}
