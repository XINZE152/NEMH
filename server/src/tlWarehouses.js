import { run, get } from './db.js';
import { createLogger } from './logger.js';
import { isTlApiConfigured, tlApiGet } from './tlApiClient.js';

const log = createLogger('nemh.tlWarehouses');

const SOURCE = 'tl';

export function isTlWarehouseSyncEnabled() {
  return isTlApiConfigured();
}

export function isTlWarehouseCrudLocked() {
  return (
    isTlWarehouseSyncEnabled() && process.env.TL_ALLOW_LOCAL_WAREHOUSE_CRUD !== '1'
  );
}

/**
 * 拉取 TL 库房列表（GET /tl/get_warehouses，只读）。
 */
export async function fetchTlWarehouseList() {
  const data = await tlApiGet('/tl/get_warehouses');
  return normalizeTlWarehousePayload(data);
}

export function normalizeTlWarehousePayload(data) {
  const raw = Array.isArray(data)
    ? data
    : data?.data ?? data?.list ?? data?.warehouses ?? [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const externalId = String(
        item['仓库id'] ??
          item.warehouse_id ??
          item.warehouseId ??
          item.id ??
          ''
      ).trim();
      const name = String(
        item['仓库名'] ?? item.warehouse_name ?? item.name ?? ''
      ).trim();
      const address = String(
        item['地址'] ?? item.address ?? ''
      ).trim();

      if (!externalId || !name) return null;

      const code = `TL-${externalId}`;
      return { externalId, code, name, address };
    })
    .filter(Boolean);
}

/**
 * 将 TL 库房 upsert 到本地 warehouses（external_source=tl）。
 */
export async function syncWarehousesFromTl(db) {
  if (!isTlWarehouseSyncEnabled()) {
    return { ok: false, synced: 0, skipped: true, reason: 'not_configured' };
  }

  const items = await fetchTlWarehouseList();
  let synced = 0;

  for (const item of items) {
    const existing = await get(
      db,
      `SELECT id FROM warehouses WHERE external_source = ? AND external_id = ?`,
      [SOURCE, item.externalId]
    );
    if (existing) {
      await run(
        db,
        `UPDATE warehouses SET code = ?, name = ?, address = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [item.code, item.name, item.address || null, existing.id]
      );
    } else {
      const byCode = await get(db, 'SELECT id FROM warehouses WHERE code = ?', [
        item.code,
      ]);
      if (byCode) {
        await run(
          db,
          `UPDATE warehouses SET name = ?, address = ?, external_source = ?, external_id = ?,
             updated_at = datetime('now') WHERE id = ?`,
          [item.name, item.address || null, SOURCE, item.externalId, byCode.id]
        );
      } else {
        await run(
          db,
          `INSERT INTO warehouses (code, name, address, external_source, external_id, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [item.code, item.name, item.address || null, SOURCE, item.externalId]
        );
      }
    }
    synced += 1;
  }

  log.info(`TL 库房同步完成: ${synced} 条`);
  return { ok: true, synced, total: items.length, source: SOURCE };
}
