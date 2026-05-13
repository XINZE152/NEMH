import { run, all, get } from './db.js';
import { requireWarehouseRole } from './auth.js';
import { createLogger, sendServerError } from './logger.js';

const log = createLogger('nemh.purchasePrices');

/** 400：写入 api.log，响应带 code 便于前端区分 */
function badRequest(req, res, message, code = 'VALIDATION_ERROR') {
  log.warn(
    `HTTP 400 ${req.method} ${req.originalUrl} code=${code} userId=${req.admin?.id ?? '-'}: ${message}`
  );
  return res.status(400).json({ error: message, code });
}

const PRICE_ROW_SQL = `SELECT pp.id,
        pp.material_id AS materialId,
        m.code AS materialCode,
        m.name AS materialName,
        pp.unit_price AS unitPrice,
        pp.entered_at AS enteredAt,
        pp.market_price_proof AS marketPriceProof,
        pp.receive_price_proof AS receivePriceProof,
        pp.description,
        pp.created_by AS createdBy,
        u.username AS creatorUsername,
        pp.created_at AS createdAt,
        pp.updated_at AS updatedAt
 FROM purchase_prices pp
 JOIN materials m ON m.id = pp.material_id
 JOIN users u ON u.id = pp.created_by`;

function parsePositiveNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.trim()) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeEnteredAt(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 支持 camelCase / snake_case，以及 priceDate、priceProof 等别名 */
function pickEnteredAt(body) {
  const b = body || {};
  const raw =
    b.enteredAt ?? b.entered_at ?? b.priceDate ?? b.price_date ?? b.entryTime;
  return normalizeEnteredAt(raw);
}

function pickMarketProof(body) {
  const b = body || {};
  const v =
    b.marketPriceProof ??
    b.market_price_proof ??
    b.priceProof ??
    b.price_proof ??
    b['行情价凭证'];
  return typeof v === 'string' ? v.trim() : '';
}

function pickReceiveProof(body) {
  const b = body || {};
  const v =
    b.receivePriceProof ??
    b.receive_price_proof ??
    b.selfReceivePriceProof ??
    b['收货价格凭证'];
  return typeof v === 'string' ? v.trim() : '';
}

function pickDescription(body) {
  const b = body || {};
  const v =
    b.description ?? b.priceDescription ?? b['价格说明'];
  return typeof v === 'string' ? v.trim() : '';
}

function mapPriceRow(row) {
  if (!row) return null;
  return {
    ...row,
    /** 与界面「定价编号」一致：采用品种编码 */
    pricingNo: row.materialCode,
    /** 与旧 Sequelize 字段名兼容 */
    priceProof: row.marketPriceProof,
  };
}

async function fetchPriceRow(db, id) {
  const row = await get(db, `${PRICE_ROW_SQL} WHERE pp.id = ?`, [id]);
  return mapPriceRow(row);
}

export function registerPurchasePriceRoutes(app, db, authMiddleware) {
  app.get('/api/admin/materials', authMiddleware, async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT m.id,
                m.code,
                m.name,
                m.description,
                m.created_at AS createdAt,
                (SELECT pp.unit_price FROM purchase_prices pp
                 WHERE pp.material_id = m.id
                 ORDER BY datetime(pp.entered_at) DESC, pp.id DESC
                 LIMIT 1) AS latestPurchaseUnitPrice,
                (SELECT sp.unit_price FROM sale_prices sp
                 WHERE sp.material_id = m.id
                 ORDER BY datetime(sp.published_at) DESC, sp.id DESC
                 LIMIT 1) AS latestUnifiedQuote
         FROM materials m
         ORDER BY m.id ASC`
      );
      res.json(rows);
    } catch (e) {
      sendServerError(res, log, req, '查询品种失败', e, 'MATERIALS_QUERY_FAILED');
    }
  });

  /** 某品种当前生效的收货定价单价（与入库校验规则一致：按 entered_at、id 取最新一条） */
  app.get(
    '/api/admin/purchase-prices/latest-by-material/:materialId',
    authMiddleware,
    async (req, res) => {
      try {
        const materialId = Number(req.params.materialId);
        if (!Number.isInteger(materialId) || materialId < 1) {
          return badRequest(req, res, '无效 materialId', 'INVALID_MATERIAL_ID');
        }
        const row = await get(
          db,
          `SELECT pp.id,
                  pp.material_id AS materialId,
                  pp.unit_price AS unitPrice,
                  pp.entered_at AS enteredAt
           FROM purchase_prices pp
           WHERE pp.material_id = ?
           ORDER BY datetime(pp.entered_at) DESC, pp.id DESC
           LIMIT 1`,
          [materialId]
        );
        if (!row) {
          return res.json({ latest: null });
        }
        res.json({ latest: row });
      } catch (e) {
        sendServerError(res, log, req, '查询最新收货定价失败', e, 'LATEST_PRICE_QUERY_FAILED');
      }
    }
  );

  app.get('/api/admin/purchase-prices', authMiddleware, async (req, res) => {
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
      const keyword =
        typeof req.query.keyword === 'string'
          ? req.query.keyword.trim()
          : typeof req.query.q === 'string'
            ? req.query.q.trim()
            : '';

      const whereParts = [];
      const params = [];
      if (materialId && Number.isInteger(materialId) && materialId > 0) {
        whereParts.push('pp.material_id = ?');
        params.push(materialId);
      }
      if (keyword) {
        const safeKw = keyword.replace(/[%_]/g, '');
        if (safeKw) {
          whereParts.push('(m.code LIKE ? OR m.name LIKE ?)');
          const like = `%${safeKw}%`;
          params.push(like, like);
        }
      }
      const whereClause = whereParts.length
        ? ` WHERE ${whereParts.join(' AND ')}`
        : '';

      const totalRow = await get(
        db,
        `SELECT COUNT(*) AS c FROM purchase_prices pp JOIN materials m ON m.id = pp.material_id${whereClause}`,
        params
      );
      const total = Number(totalRow?.c ?? 0);

      const rows = await all(
        db,
        `${PRICE_ROW_SQL}${whereClause}
         ORDER BY datetime(pp.entered_at) DESC, pp.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      res.json({
        prices: rows.map(mapPriceRow),
        total,
        page,
        pageSize,
      });
    } catch (e) {
      sendServerError(res, log, req, '查询收货定价失败', e, 'PRICE_LIST_QUERY_FAILED');
    }
  });

  /** 一次提交：相同录入时间、相同两类凭证下，多个「品种 + 单价」 */
  app.post(
    '/api/admin/purchase-prices/batch',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const body = req.body || {};
      const lines = Array.isArray(body.lines) ? body.lines : null;
      if (!lines || lines.length === 0) {
        return badRequest(
          req,
          res,
          'lines 不能为空，每项需包含 materialId 与 unitPrice（或 price）',
          'BATCH_LINES_EMPTY'
        );
      }

      const enteredAt =
        pickEnteredAt(body) || new Date().toISOString();
      /** 凭证可选：不传或空字符串时存空串（与前端「可不传凭证」一致） */
      const marketPriceProof = pickMarketProof(body);
      const receivePriceProof = pickReceiveProof(body);
      const description = pickDescription(body) || null;

      const createdIds = [];

      await run(db, 'BEGIN');
      try {
        for (const line of lines) {
          const materialId = Number(line.materialId ?? line.material_id);
          const unitPrice = parsePositiveNumber(
            line.unitPrice ?? line.price ?? line.unit_price
          );
          if (!Number.isInteger(materialId) || materialId < 1) {
            throw Object.assign(new Error('INVALID_MATERIAL'), { code: 400 });
          }
          if (unitPrice === null) {
            throw Object.assign(new Error('INVALID_PRICE'), { code: 400 });
          }
          const material = await get(
            db,
            'SELECT id FROM materials WHERE id = ?',
            [materialId]
          );
          if (!material) {
            throw Object.assign(new Error('MATERIAL_NOT_FOUND'), { code: 400 });
          }
          const result = await run(
            db,
            `INSERT INTO purchase_prices (
               material_id, unit_price, entered_at,
               market_price_proof, receive_price_proof, description,
               created_by, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
              materialId,
              unitPrice,
              enteredAt,
              marketPriceProof,
              receivePriceProof,
              description,
              req.admin.id,
            ]
          );
          createdIds.push(result.lastID);
        }
        await run(db, 'COMMIT');
      } catch (inner) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw inner;
      }

      const prices = [];
      for (const id of createdIds) {
        prices.push(await fetchPriceRow(db, id));
      }

      res.status(201).json({ count: prices.length, prices });
    } catch (e) {
      if (e.message === 'INVALID_MATERIAL') {
        return badRequest(req, res, '每条 line 须包含有效 materialId', 'INVALID_LINE_MATERIAL');
      }
      if (e.message === 'INVALID_PRICE') {
        return badRequest(req, res, '每条 line 的单价须为大于 0 的数字', 'INVALID_LINE_PRICE');
      }
      if (e.message === 'MATERIAL_NOT_FOUND') {
        return badRequest(req, res, '品种不存在', 'MATERIAL_NOT_FOUND');
      }
      sendServerError(res, log, req, '批量创建收货定价失败', e, 'BATCH_CREATE_FAILED');
    }
  }
  );

  app.get('/api/admin/purchase-prices/:id', authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return badRequest(req, res, '无效 id', 'INVALID_ID');
      }
      const row = await fetchPriceRow(db, id);
      if (!row) {
        log.warn(`HTTP 404 ${req.method} ${req.originalUrl} userId=${req.admin?.id ?? '-'}`);
        return res.status(404).json({ error: '记录不存在', code: 'NOT_FOUND' });
      }
      res.json(row);
    } catch (e) {
      sendServerError(res, log, req, '查询收货定价失败', e, 'PRICE_GET_FAILED');
    }
  });

  app.put(
    '/api/admin/purchase-prices/:id',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return badRequest(req, res, '无效 id', 'INVALID_ID');
      }
      const existing = await get(db, 'SELECT * FROM purchase_prices WHERE id = ?', [
        id,
      ]);
      if (!existing) {
        log.warn(`HTTP 404 PUT purchase-price id=${id} userId=${req.admin?.id ?? '-'}`);
        return res.status(404).json({ error: '记录不存在', code: 'NOT_FOUND' });
      }

      const body = req.body || {};
      let materialId = existing.material_id;
      if (body.materialId !== undefined || body.material_id !== undefined) {
        materialId = Number(body.materialId ?? body.material_id);
        if (!Number.isInteger(materialId) || materialId < 1) {
          return badRequest(req, res, '无效 materialId', 'INVALID_MATERIAL_ID');
        }
        const material = await get(db, 'SELECT id FROM materials WHERE id = ?', [
          materialId,
        ]);
        if (!material) return badRequest(req, res, '品种不存在', 'MATERIAL_NOT_FOUND');
      }

      let unitPrice = existing.unit_price;
      if (
        body.unitPrice !== undefined ||
        body.price !== undefined ||
        body.unit_price !== undefined
      ) {
        const u = parsePositiveNumber(
          body.unitPrice ?? body.price ?? body.unit_price
        );
        if (u === null) {
          return badRequest(req, res, '单价须为大于 0 的数字', 'INVALID_UNIT_PRICE');
        }
        unitPrice = u;
      }

      let enteredAt = existing.entered_at;
      const nextEntered = pickEnteredAt(body);
      if (nextEntered) enteredAt = nextEntered;

      let marketPriceProof = existing.market_price_proof;
      if (
        body.marketPriceProof !== undefined ||
        body.market_price_proof !== undefined ||
        body.priceProof !== undefined
      ) {
        marketPriceProof = pickMarketProof(body);
      }

      let receivePriceProof = existing.receive_price_proof;
      if (
        body.receivePriceProof !== undefined ||
        body.receive_price_proof !== undefined
      ) {
        receivePriceProof = pickReceiveProof(body);
      }

      let description = existing.description;
      if (body.description !== undefined || body.priceDescription !== undefined) {
        const d = pickDescription(body);
        description = d || null;
      }

      await run(
        db,
        `UPDATE purchase_prices SET
           material_id = ?,
           unit_price = ?,
           entered_at = ?,
           market_price_proof = ?,
           receive_price_proof = ?,
           description = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
        [
          materialId,
          unitPrice,
          enteredAt,
          marketPriceProof,
          receivePriceProof,
          description,
          id,
        ]
      );

      res.json(await fetchPriceRow(db, id));
    } catch (e) {
      sendServerError(res, log, req, '更新收货定价失败', e, 'PRICE_UPDATE_FAILED');
    }
  }
  );

  app.delete(
    '/api/admin/purchase-prices/:id',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return badRequest(req, res, '无效 id', 'INVALID_ID');
      }
      const result = await run(db, 'DELETE FROM purchase_prices WHERE id = ?', [id]);
      if (result.changes === 0) {
        log.warn(`HTTP 404 DELETE purchase-price id=${id} userId=${req.admin?.id ?? '-'}`);
        return res.status(404).json({ error: '记录不存在', code: 'NOT_FOUND' });
      }
      res.status(204).send();
    } catch (e) {
      sendServerError(res, log, req, '删除收货定价失败', e, 'PRICE_DELETE_FAILED');
    }
  }
  );

  app.post(
    '/api/admin/purchase-prices',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const body = req.body || {};
      const materialId = Number(body.materialId ?? body.material_id);
      const unitPrice = parsePositiveNumber(
        body.unitPrice ?? body.price ?? body.unit_price
      );
      const enteredAt =
        pickEnteredAt(body) || new Date().toISOString();
      const marketPriceProof = pickMarketProof(body);
      const receivePriceProof = pickReceiveProof(body);
      const description = pickDescription(body) || null;

      if (!Number.isInteger(materialId) || materialId < 1) {
        return badRequest(req, res, '请选择品种', 'MISSING_MATERIAL');
      }
      if (unitPrice === null) {
        return badRequest(req, res, '单价须为大于 0 的数字', 'INVALID_UNIT_PRICE');
      }

      const material = await get(db, 'SELECT id FROM materials WHERE id = ?', [
        materialId,
      ]);
      if (!material) {
        return badRequest(req, res, '品种不存在', 'MATERIAL_NOT_FOUND');
      }

      const result = await run(
        db,
        `INSERT INTO purchase_prices (
           material_id, unit_price, entered_at,
           market_price_proof, receive_price_proof, description,
           created_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          materialId,
          unitPrice,
          enteredAt,
          marketPriceProof,
          receivePriceProof,
          description,
          req.admin.id,
        ]
      );

      res.status(201).json(await fetchPriceRow(db, result.lastID));
    } catch (e) {
      sendServerError(res, log, req, '创建收货定价失败', e, 'PRICE_CREATE_FAILED');
    }
  }
  );
}
