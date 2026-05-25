import { run, all, get } from './db.js';
import { createLogger } from './logger.js';
import { requireStatisticsRole } from './auth.js';
import { fetchRegionalManagerMapFromPd2 } from './pd2Readonly.js';
import { isPd2MysqlEnabled } from './pd2Auth.js';

const log = createLogger('nemh.warehouseRegionalManager');

function trimStr(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/**
 * 从 PD2 送货历史同步大区经理到 P3 warehouses（仅更新 name 精确匹配且非 manual）。
 */
export async function syncRegionalManagersFromPd2(db, lookbackDays = 180) {
  const managerByWarehouseName = await fetchRegionalManagerMapFromPd2(lookbackDays);
  const localRows = await all(
    db,
    `SELECT id, name, regional_manager_source AS regionalManagerSource
     FROM warehouses`
  );

  let updated = 0;
  let skippedManual = 0;
  let unmatched = 0;
  const unmatchedNames = [];

  for (const row of localRows) {
    const name = trimStr(row.name);
    if (!name) continue;
    if (row.regionalManagerSource === 'manual') {
      skippedManual += 1;
      continue;
    }
    const rm = managerByWarehouseName.get(name);
    if (!rm) {
      unmatched += 1;
      if (unmatchedNames.length < 50) unmatchedNames.push(name);
      continue;
    }
    await run(
      db,
      `UPDATE warehouses SET
         regional_manager_name = ?,
         regional_manager_source = 'pd2_delivery',
         regional_manager_synced_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
      [rm, row.id]
    );
    updated += 1;
  }

  return {
    ok: true,
    updated,
    skippedManual,
    unmatched,
    pd2WarehouseNamesWithManager: managerByWarehouseName.size,
    localWarehouses: localRows.length,
    unmatchedSample: unmatchedNames,
  };
}

export function registerWarehouseRegionalManagerRoutes(app, db, authMiddleware) {
  app.post(
    '/api/admin/warehouses/sync-regional-managers-from-pd2',
    authMiddleware,
    requireStatisticsRole,
    async (req, res) => {
      try {
        if (!isPd2MysqlEnabled()) {
          return res.status(400).json({
            error: '未配置 PD2 MySQL',
            code: 'PD2_MYSQL_NOT_CONFIGURED',
          });
        }
        const lookback =
          req.body?.lookbackDays ??
          req.query?.lookbackDays ??
          180;
        const result = await syncRegionalManagersFromPd2(db, lookback);
        res.json(result);
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(502).json({
          error: e?.message || '同步大区经理失败',
          code: 'PD2_RM_SYNC_FAILED',
        });
      }
    }
  );

  app.patch(
    '/api/admin/warehouses/:id/regional-manager',
    authMiddleware,
    requireStatisticsRole,
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) {
          return res.status(400).json({ error: '无效 id' });
        }
        const existing = await get(db, 'SELECT id FROM warehouses WHERE id = ?', [
          id,
        ]);
        if (!existing) return res.status(404).json({ error: '库房不存在' });

        const body = req.body || {};
        const name =
          body.regionalManagerName ??
          body.regional_manager_name ??
          body.name;
        const rm = trimStr(name);
        if (!rm) {
          return res.status(400).json({ error: '大区经理姓名不能为空' });
        }

        await run(
          db,
          `UPDATE warehouses SET
             regional_manager_name = ?,
             regional_manager_source = 'manual',
             regional_manager_synced_at = datetime('now'),
             updated_at = datetime('now')
           WHERE id = ?`,
          [rm, id]
        );

        const row = await get(
          db,
          `SELECT id, code, name,
              IFNULL(address, '') AS address,
              external_source, external_id,
              regional_manager_name, regional_manager_source,
              regional_manager_synced_at,
              created_at, updated_at
           FROM warehouses WHERE id = ?`,
          [id]
        );
        res.json({
          id: row.id,
          code: row.code,
          name: row.name,
          regionalManagerName: row.regional_manager_name,
          regionalManagerSource: row.regional_manager_source,
          regionalManagerSyncedAt: row.regional_manager_synced_at,
        });
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(500).json({ error: '更新大区经理失败' });
      }
    }
  );
}
