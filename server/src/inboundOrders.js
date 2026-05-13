import { run, all, get } from './db.js';
import { requireStatisticsRole, requireWarehouseRole } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('nemh.inboundOrders');

function parsePositiveNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.trim()) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeInboundAt(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 与「最新定价」比较：元/吨，保留两位小数比较 */
function unitPricesMatch(entered, latest) {
  const a = Number(Number(entered).toFixed(2));
  const b = Number(Number(latest).toFixed(2));
  return a === b;
}

function roundMoney(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function generateInboundOrderNo() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `RK-${year}${month}${day}-${random}`;
}

function isUniqueConstraint(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT' ||
      String(err.message || '').includes('UNIQUE'))
  );
}

async function getLatestPurchaseUnitPrice(db, materialId) {
  const row = await get(
    db,
    `SELECT unit_price AS unitPrice
     FROM purchase_prices
     WHERE material_id = ?
     ORDER BY datetime(entered_at) DESC, id DESC
     LIMIT 1`,
    [materialId]
  );
  return row?.unitPrice ?? null;
}

const INBOUND_ROW_SQL = `SELECT io.id,
        io.order_no AS orderNo,
        io.warehouse_id AS warehouseId,
        wh.code AS warehouseCode,
        wh.name AS warehouseName,
        io.material_id AS materialId,
        m.code AS materialCode,
        m.name AS materialName,
        io.weight,
        io.unit_price AS unitPrice,
        io.total_amount AS totalAmount,
        io.photo,
        io.inbound_at AS inboundAt,
        io.audit_status AS auditStatus,
        io.reviewed_by AS reviewedBy,
        ur.username AS reviewerUsername,
        io.reviewed_at AS reviewedAt,
        io.reject_reason AS rejectReason,
        io.created_by AS createdBy,
        uc.username AS creatorUsername,
        io.created_at AS createdAt,
        io.updated_at AS updatedAt,
        (SELECT sp.unit_price FROM sale_prices sp
         WHERE sp.material_id = io.material_id
         ORDER BY datetime(sp.published_at) DESC, sp.id DESC
         LIMIT 1) AS latestUnifiedQuote
 FROM inbound_orders io
 JOIN warehouses wh ON wh.id = io.warehouse_id
 JOIN materials m ON m.id = io.material_id
 JOIN users uc ON uc.id = io.created_by
 LEFT JOIN users ur ON ur.id = io.reviewed_by`;

/** 统计部审核入库：审核状态展示文案（数据库存储 pending / approved / rejected） */
function auditStatusText(status) {
  if (status === 'approved') return '已审核待出库';
  if (status === 'rejected') return '审核驳回';
  if (status === 'pending') return '待审核';
  return String(status || '').trim() || '待审核';
}

function mapInboundRow(row) {
  if (!row) return null;
  const text = auditStatusText(row.auditStatus);
  return {
    ...row,
    /** 入库的品种（与 materials.name 一致） */
    varietyName: row.materialName,
    /** 价格（元/吨，与 unitPrice 一致） */
    price: row.unitPrice,
    /** 入库单照片 */
    inboundPhoto: row.photo,
    /** 入库时间 */
    inboundTime: row.inboundAt,
    auditStatusText: text,
  };
}

async function fetchInboundRow(db, id) {
  const row = await get(db, `${INBOUND_ROW_SQL} WHERE io.id = ?`, [id]);
  return mapInboundRow(row);
}

export function registerInboundOrderRoutes(app, db, authMiddleware) {
  app.get('/api/admin/inbound-orders', authMiddleware, async (req, res) => {
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
      const auditStatus =
        typeof req.query.auditStatus === 'string'
          ? req.query.auditStatus.trim()
          : '';

      const whereParts = [];
      const params = [];
      if (materialId && Number.isInteger(materialId) && materialId > 0) {
        whereParts.push('io.material_id = ?');
        params.push(materialId);
      }
      if (
        auditStatus === 'pending' ||
        auditStatus === 'approved' ||
        auditStatus === 'rejected'
      ) {
        whereParts.push('io.audit_status = ?');
        params.push(auditStatus);
      }
      const whereClause = whereParts.length
        ? ` WHERE ${whereParts.join(' AND ')}`
        : '';

      const totalRow = await get(
        db,
        `SELECT COUNT(*) AS c FROM inbound_orders io${whereClause}`,
        params
      );
      const total = Number(totalRow?.c ?? 0);

      const rows = await all(
        db,
        `${INBOUND_ROW_SQL}${whereClause}
         ORDER BY datetime(io.inbound_at) DESC, io.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      res.json({
        orders: rows.map(mapInboundRow),
        total,
        page,
        pageSize,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询入库单失败' });
    }
  });

  app.get('/api/admin/inbound-orders/:id', authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const row = await fetchInboundRow(db, id);
      if (!row) return res.status(404).json({ error: '入库单不存在' });
      const latestPurchaseUnitPrice = await getLatestPurchaseUnitPrice(
        db,
        row.materialId
      );
      res.json({
        ...row,
        latestPurchaseUnitPrice,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询入库单详情失败' });
    }
  });

  app.post(
    '/api/admin/inbound-orders',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const body = req.body || {};
      const materialId = Number(body.materialId ?? body.material_id);
      const weight = parsePositiveNumber(body.weight);
      const unitPrice = parsePositiveNumber(
        body.unitPrice ?? body.unit_price ?? body.price
      );
      const photo =
        typeof body.photo === 'string'
          ? body.photo.trim()
          : typeof body.inboundPhoto === 'string'
            ? body.inboundPhoto.trim()
            : '';
      const inboundAt =
        normalizeInboundAt(body.inboundAt ?? body.inbound_at ?? body.inboundTime) ||
        new Date().toISOString();

      let orderNo =
        typeof body.orderNo === 'string'
          ? body.orderNo.trim()
          : typeof body.order_no === 'string'
            ? body.order_no.trim()
            : '';
      if (!orderNo) {
        for (let i = 0; i < 8; i++) {
          const candidate = generateInboundOrderNo();
          const exists = await get(
            db,
            'SELECT 1 AS x FROM inbound_orders WHERE order_no = ?',
            [candidate]
          );
          if (!exists) {
            orderNo = candidate;
            break;
          }
        }
        if (!orderNo) {
          return res.status(500).json({ error: '生成入库单号失败，请重试' });
        }
      }

      if (!Number.isInteger(materialId) || materialId < 1) {
        return res.status(400).json({ error: '请选择品种' });
      }
      if (weight === null) {
        return res.status(400).json({ error: '重量须为大于 0 的数字' });
      }
      if (unitPrice === null) {
        return res.status(400).json({ error: '单价须为大于 0 的数字' });
      }
      if (!photo) {
        return res.status(400).json({ error: '请填写入库单照片地址' });
      }

      const material = await get(db, 'SELECT id FROM materials WHERE id = ?', [
        materialId,
      ]);
      if (!material) {
        return res.status(400).json({ error: '品种不存在' });
      }

      const warehouseId = Number(body.warehouseId ?? body.warehouse_id ?? 1);
      if (!Number.isInteger(warehouseId) || warehouseId < 1) {
        return res.status(400).json({ error: '无效库房' });
      }
      const warehouse = await get(db, 'SELECT id FROM warehouses WHERE id = ?', [
        warehouseId,
      ]);
      if (!warehouse) {
        return res.status(400).json({ error: '库房不存在' });
      }

      const latestPurchase = await getLatestPurchaseUnitPrice(db, materialId);
      if (latestPurchase === null || latestPurchase === undefined) {
        return res
          .status(400)
          .json({ error: '该品种暂无收货定价，无法提交入库' });
      }
      if (!unitPricesMatch(unitPrice, latestPurchase)) {
        return res.status(400).json({
          error: '录入单价必须与当前品种最新收货定价一致，请核对后重试',
          latestPurchaseUnitPrice: Number(Number(latestPurchase).toFixed(2)),
        });
      }

      const totalAmount = roundMoney(weight * unitPrice);

      const result = await run(
        db,
        `INSERT INTO inbound_orders (
           order_no, warehouse_id, material_id, weight, unit_price, total_amount,
           photo, inbound_at, audit_status,
           created_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
        [
          orderNo,
          warehouseId,
          materialId,
          weight,
          unitPrice,
          totalAmount,
          photo,
          inboundAt,
          req.admin.id,
        ]
      );

      res.status(201).json(await fetchInboundRow(db, result.lastID));
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '入库单号已存在' });
      }
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '创建入库单失败' });
    }
  }
  );

  app.put(
    '/api/admin/inbound-orders/:id/approve',
    authMiddleware,
    requireStatisticsRole,
    async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const existing = await get(db, 'SELECT * FROM inbound_orders WHERE id = ?', [
        id,
      ]);
      if (!existing) return res.status(404).json({ error: '入库单不存在' });
      if (existing.audit_status !== 'pending') {
        return res.status(400).json({ error: '仅待审核状态的入库单可审核通过' });
      }

      /** 审核通过后 audit_status 仍为 approved，对外展示为「已审核待出库」 */
      await run(
        db,
        `UPDATE inbound_orders SET
           audit_status = 'approved',
           reviewed_by = ?,
           reviewed_at = datetime('now'),
           reject_reason = NULL,
           updated_at = datetime('now')
         WHERE id = ?`,
        [req.admin.id, id]
      );

      res.json(await fetchInboundRow(db, id));
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '审核入库单失败' });
    }
  }
  );

  app.put(
    '/api/admin/inbound-orders/:id/reject',
    authMiddleware,
    requireStatisticsRole,
    async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const existing = await get(db, 'SELECT * FROM inbound_orders WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: '入库单不存在' });
      if (existing.audit_status !== 'pending') {
        return res.status(400).json({ error: '仅待审核状态的入库单可驳回' });
      }
      const linked = await get(
        db,
        'SELECT 1 AS x FROM outbound_fifo_lines WHERE inbound_order_id = ? LIMIT 1',
        [id]
      );
      if (linked) {
        return res.status(400).json({ error: '已存在出库子单关联，不可驳回' });
      }
      const body = req.body || {};
      let rejectReason = null;
      const raw =
        body.rejectReason ?? body.reject_reason ?? body.reason;
      if (typeof raw === 'string') {
        const s = raw.trim().slice(0, 500);
        rejectReason = s || null;
      }
      await run(
        db,
        `UPDATE inbound_orders SET
           audit_status = 'rejected',
           reviewed_by = ?,
           reviewed_at = datetime('now'),
           reject_reason = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
        [req.admin.id, rejectReason, id]
      );
      res.json(await fetchInboundRow(db, id));
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '驳回入库单失败' });
    }
  }
  );
}
