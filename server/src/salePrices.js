import { run, all, get } from './db.js';
import { requireStatisticsPublish } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('nemh.salePrices');

function parsePositiveNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.trim()) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizePublishedAt(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const SALE_ROW_SQL = `SELECT sp.id,
        sp.material_id AS materialId,
        m.code AS materialCode,
        m.name AS materialName,
        sp.unit_price AS unitPrice,
        sp.published_at AS publishedAt,
        sp.created_by AS createdBy,
        u.username AS creatorUsername,
        sp.created_at AS createdAt,
        sp.updated_at AS updatedAt
 FROM sale_prices sp
 JOIN materials m ON m.id = sp.material_id
 JOIN users u ON u.id = sp.created_by`;

function mapSaleRow(row) {
  if (!row) return null;
  return {
    ...row,
    /** 发布日期（与 publishedAt 相同，ISO 8601） */
    publishDate: row.publishedAt,
    /** 对外统一市场报价（元/吨，与 unitPrice 相同） */
    quotePrice: row.unitPrice,
    material: {
      id: row.materialId,
      code: row.materialCode,
      name: row.materialName,
    },
    quoteType: 'unified_market',
  };
}

async function fetchSaleRow(db, id) {
  const row = await get(db, `${SALE_ROW_SQL} WHERE sp.id = ?`, [id]);
  return mapSaleRow(row);
}

export function registerSalePriceRoutes(app, db, authMiddleware) {
  /** 列表：统计部、库房等已登录用户均可查看对外统一市场报价 */
  async function handleSalePriceList(req, res) {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.pageSize || '10'), 10) || 10)
      );
      const offset = (page - 1) * pageSize;
      const materialId = req.query.materialId
        ? Number(req.query.materialId)
        : null;

      const whereParts = [];
      const params = [];
      if (materialId && Number.isInteger(materialId) && materialId > 0) {
        whereParts.push('sp.material_id = ?');
        params.push(materialId);
      }
      const whereClause = whereParts.length
        ? ` WHERE ${whereParts.join(' AND ')}`
        : '';

      const totalRow = await get(
        db,
        `SELECT COUNT(*) AS c FROM sale_prices sp${whereClause}`,
        params
      );
      const total = Number(totalRow?.c ?? 0);

      const rows = await all(
        db,
        `${SALE_ROW_SQL}${whereClause}
         ORDER BY datetime(sp.published_at) DESC, sp.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      res.json({
        prices: rows.map(mapSaleRow),
        total,
        page,
        pageSize,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询对外报价失败' });
    }
  }

  app.get(
    '/api/admin/sale-prices/latest/:materialId',
    authMiddleware,
    async (req, res) => {
      try {
        const materialId = Number(req.params.materialId);
        if (!Number.isInteger(materialId) || materialId < 1) {
          return res.status(400).json({ error: '无效 materialId' });
        }
        const row = await get(
          db,
          `${SALE_ROW_SQL}
           WHERE sp.material_id = ?
           ORDER BY datetime(sp.published_at) DESC, sp.id DESC
           LIMIT 1`,
          [materialId]
        );
        res.json({ latest: mapSaleRow(row) });
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(500).json({ error: '查询最新对外报价失败' });
      }
    }
  );

  app.get('/api/admin/sale-prices', authMiddleware, handleSalePriceList);

  /** 库房端查看：与列表接口数据一致，需登录（role=warehouse 即可） */
  app.get(
    '/api/warehouse/unified-market-quotes',
    authMiddleware,
    handleSalePriceList
  );

  app.get(
    '/api/warehouse/unified-market-quotes/latest/:materialId',
    authMiddleware,
    async (req, res) => {
      try {
        const materialId = Number(req.params.materialId);
        if (!Number.isInteger(materialId) || materialId < 1) {
          return res.status(400).json({ error: '无效 materialId' });
        }
        const row = await get(
          db,
          `${SALE_ROW_SQL}
           WHERE sp.material_id = ?
           ORDER BY datetime(sp.published_at) DESC, sp.id DESC
           LIMIT 1`,
          [materialId]
        );
        res.json({ latest: mapSaleRow(row) });
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(500).json({ error: '查询最新对外报价失败' });
      }
    }
  );

  app.post(
    '/api/admin/sale-prices',
    authMiddleware,
    requireStatisticsPublish,
    async (req, res) => {
      try {
        const body = req.body || {};
        const materialId = Number(body.materialId ?? body.material_id);
        const unitPrice = parsePositiveNumber(
          body.unitPrice ?? body.quotePrice ?? body.price ?? body.unit_price
        );
        const publishedAt =
          normalizePublishedAt(
            body.publishedAt ?? body.publishDate ?? body.published_at
          ) || new Date().toISOString();

        if (!Number.isInteger(materialId) || materialId < 1) {
          return res.status(400).json({ error: '请选择品种' });
        }
        if (unitPrice === null) {
          return res.status(400).json({ error: '对外报价须为大于 0 的数字' });
        }

        const material = await get(db, 'SELECT id FROM materials WHERE id = ?', [
          materialId,
        ]);
        if (!material) {
          return res.status(400).json({ error: '品种不存在' });
        }

        const result = await run(
          db,
          `INSERT INTO sale_prices (
           material_id, unit_price, published_at,
           created_by, updated_at
         ) VALUES (?, ?, ?, ?, datetime('now'))`,
          [materialId, unitPrice, publishedAt, req.admin.id]
        );

        res.status(201).json(await fetchSaleRow(db, result.lastID));
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(500).json({ error: '发布对外报价失败' });
      }
    }
  );

  app.get('/api/admin/sale-prices/:id', authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const row = await fetchSaleRow(db, id);
      if (!row) return res.status(404).json({ error: '记录不存在' });
      res.json(row);
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询对外报价失败' });
    }
  });
}
