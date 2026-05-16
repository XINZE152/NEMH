import { run, all, get } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('nemh.baocheWarehouses');

const SOURCE = 'baoche';

export function isBaocheWarehouseSyncEnabled() {
  return Boolean(
    typeof process.env.BAOCHI_WAREHOUSE_API_URL === 'string' &&
      process.env.BAOCHI_WAREHOUSE_API_URL.trim()
  );
}

export function isBaocheWarehouseCrudLocked() {
  return isBaocheWarehouseSyncEnabled() && process.env.BAOCHI_ALLOW_LOCAL_WAREHOUSE_CRUD !== '1';
}

/**
 * 从宝驰库房接口拉取列表。环境变量：
 * - BAOCHI_WAREHOUSE_API_URL：GET 列表完整 URL
 * - BAOCHI_WAREHOUSE_API_TOKEN：可选 Bearer Token
 * 响应支持：数组，或 { warehouses } / { data }，元素含 id/code/name/address 等字段。
 */
export async function fetchBaocheWarehouseList() {
  const url = process.env.BAOCHI_WAREHOUSE_API_URL?.trim();
  if (!url) return null;

  const headers = { Accept: 'application/json' };
  const token = process.env.BAOCHI_WAREHOUSE_API_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `宝驰库房接口 HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }
  const data = await res.json();
  return normalizeBaochePayload(data);
}

export function normalizeBaochePayload(data) {
  const raw = Array.isArray(data)
    ? data
    : data?.warehouses ?? data?.data ?? data?.list ?? [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const externalId = String(
        item.id ?? item.warehouseId ?? item.warehouse_id ?? item.code ?? ''
      ).trim();
      const code = String(
        item.code ?? item.warehouseCode ?? item.warehouse_code ?? externalId
      ).trim();
      const name = String(
        item.name ?? item.warehouseName ?? item.warehouse_name ?? code
      ).trim();
      if (!externalId || !code || !name) return null;
      return {
        externalId,
        code,
        name,
        address:
          typeof item.address === 'string'
            ? item.address.trim()
            : String(item.address ?? '').trim(),
      };
    })
    .filter(Boolean);
}

/**
 * 将宝驰库房 upsert 到本地 warehouses（external_source=baoche, external_id）。
 * 不删除本地仅有、宝驰未返回的库房，避免历史单据外键断裂。
 */
export async function syncWarehousesFromBaoche(db) {
  if (!isBaocheWarehouseSyncEnabled()) {
    return { ok: false, synced: 0, skipped: true, reason: 'not_configured' };
  }

  const items = await fetchBaocheWarehouseList();
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

  log.info(`宝驰库房同步完成: ${synced} 条`);
  return { ok: true, synced, total: items.length };
}
