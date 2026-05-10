import { run, all, get } from './db.js';
import { requireWarehouseRole } from './auth.js';
import { parseWeighbridgeText } from './weighbridgeParse.js';

function parsePositiveNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.trim()) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function roundTon(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function roundMoney(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function generateOutboundOrderNo() {
  const date = new Date();
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const r = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `CK-${y}${mo}${d}-${r}`;
}

function isUniqueConstraint(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT' ||
      String(err.message || '').includes('UNIQUE'))
  );
}

/** 当日已发布的对外报价优先，否则取该品种最新一条 */
async function getDefaultOutboundUnitPrice(db, materialId) {
  const todayRow = await get(
    db,
    `SELECT unit_price AS p FROM sale_prices
     WHERE material_id = ?
       AND date(published_at) = date('now')
     ORDER BY datetime(published_at) DESC, id DESC
     LIMIT 1`,
    [materialId]
  );
  if (todayRow?.p != null && todayRow.p !== undefined) {
    return roundMoney(todayRow.p);
  }
  const latest = await get(
    db,
    `SELECT unit_price AS p FROM sale_prices
     WHERE material_id = ?
     ORDER BY datetime(published_at) DESC, id DESC
     LIMIT 1`,
    [materialId]
  );
  if (latest?.p != null && latest.p !== undefined) return roundMoney(latest.p);
  return null;
}

/**
 * 已审核入库单按先进先出，计算每条可再分配重量（扣减其他出库单已占用：已完成用实际，待完成用预分配）。
 */
async function getFifoInboundAvailability(db, warehouseId, materialId) {
  return all(
    db,
    `SELECT t.id AS inboundOrderId,
            t.order_no AS inboundOrderNo,
            t.weight AS inboundWeight,
            t.inbound_at AS inboundAt,
            t.available AS availableWeight
     FROM (
       SELECT io.id, io.order_no, io.weight, io.inbound_at,
         (io.weight - COALESCE((
           SELECT SUM(
             CASE WHEN o.status = 'completed'
               THEN COALESCE(l.actual_weight, l.planned_weight)
               ELSE l.planned_weight
             END
           )
           FROM outbound_fifo_lines l
           JOIN outbound_orders o ON o.id = l.outbound_order_id
           WHERE l.inbound_order_id = io.id
         ), 0)) AS available
       FROM inbound_orders io
       WHERE io.warehouse_id = ?
         AND io.material_id = ?
         AND io.audit_status = 'approved'
     ) t
     WHERE t.available > 0.0001
     ORDER BY datetime(t.inbound_at) ASC, t.id ASC`,
    [warehouseId, materialId]
  );
}

function buildFifoAllocations(rows, plannedTotal) {
  let rem = roundTon(plannedTotal);
  const lines = [];
  let lineNo = 0;
  for (const row of rows) {
    if (rem <= 0) break;
    const avail = roundTon(row.availableWeight);
    if (avail <= 0) continue;
    const take = roundTon(Math.min(avail, rem));
    if (take <= 0) continue;
    lineNo += 1;
    lines.push({
      inboundOrderId: row.inboundOrderId,
      plannedWeight: take,
      lineNo,
    });
    rem = roundTon(rem - take);
  }
  if (rem > 0.001) {
    return {
      ok: false,
      error: '可出库库存不足（先进先出），请减少预出库重量或先完成入库审核',
      lines: [],
      shortfall: rem,
    };
  }
  return { ok: true, lines, error: null, shortfall: 0 };
}

function distributeActualByFifoLines(dbLines, actualTotal) {
  let rem = roundTon(actualTotal);
  const updates = [];
  for (const ln of dbLines) {
    const cap = roundTon(ln.plannedWeight);
    const take = roundTon(Math.min(cap, rem));
    updates.push({ id: ln.id, inboundOrderId: ln.inboundOrderId, actualWeight: take });
    rem = roundTon(rem - take);
  }
  if (rem > 0.001) {
    return {
      ok: false,
      error: '实际出库重量超过本单预出库 FIFO 行可分配量',
    };
  }
  return { ok: true, updates };
}

const OUTBOUND_HEADER_SQL = `SELECT o.id,
       o.order_no AS orderNo,
       o.warehouse_id AS warehouseId,
       wh.code AS warehouseCode,
       wh.name AS warehouseName,
       o.material_id AS materialId,
       m.code AS materialCode,
       m.name AS materialName,
       o.planned_weight AS plannedWeight,
       o.unit_price AS unitPrice,
       o.actual_weight AS actualWeight,
       o.weighbridge_photo AS weighbridgePhoto,
       o.status,
       o.created_by AS createdBy,
       u.username AS creatorUsername,
       o.created_at AS createdAt,
       o.updated_at AS updatedAt
FROM outbound_orders o
JOIN warehouses wh ON wh.id = o.warehouse_id
JOIN materials m ON m.id = o.material_id
JOIN users u ON u.id = o.created_by`;

async function fetchFifoLines(db, outboundOrderId) {
  return all(
    db,
    `SELECT l.id,
            l.inbound_order_id AS inboundOrderId,
            io.order_no AS inboundOrderNo,
            l.planned_weight AS plannedWeight,
            l.actual_weight AS actualWeight,
            l.line_no AS lineNo,
            l.sub_order_no AS subOrderNo
     FROM outbound_fifo_lines l
     JOIN inbound_orders io ON io.id = l.inbound_order_id
     WHERE l.outbound_order_id = ?
     ORDER BY l.line_no ASC`,
    [outboundOrderId]
  );
}

async function fetchOutboundDetail(db, id) {
  const header = await get(db, `${OUTBOUND_HEADER_SQL} WHERE o.id = ?`, [id]);
  if (!header) return null;
  const fifoLines = await fetchFifoLines(db, id);
  return { ...header, fifoLines };
}

export function registerOutboundOrderRoutes(app, db, authMiddleware) {
  /** 磅单：上传图片地址 + OCR 文本后解析品种与重量建议（需配合前端 OCR 或人工粘贴文本） */
  app.post(
    '/api/admin/weighbridge-slip/parse',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const body = req.body || {};
      const imageUrl =
        typeof body.imageUrl === 'string'
          ? body.imageUrl.trim()
          : typeof body.weighbridgePhoto === 'string'
            ? body.weighbridgePhoto.trim()
            : '';
      const ocrRaw = body.ocrText ?? body.ocr_text ?? body.text;
      const ocrText = typeof ocrRaw === 'string' ? ocrRaw : '';
      const mats = await all(
        db,
        'SELECT id, code, name FROM materials ORDER BY id ASC'
      );
      const parsed = parseWeighbridgeText(ocrText, mats);
      res.json({
        imageUrl: imageUrl || null,
        ...parsed,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: '解析磅单失败' });
    }
  }
  );

  app.get('/api/admin/outbound-orders', authMiddleware, async (req, res) => {
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
      const status =
        typeof req.query.status === 'string' ? req.query.status.trim() : '';

      const whereParts = [];
      const params = [];
      if (materialId && Number.isInteger(materialId) && materialId > 0) {
        whereParts.push('o.material_id = ?');
        params.push(materialId);
      }
      if (status === 'pending' || status === 'completed') {
        whereParts.push('o.status = ?');
        params.push(status);
      }
      const whereClause = whereParts.length
        ? ` WHERE ${whereParts.join(' AND ')}`
        : '';

      const totalRow = await get(
        db,
        `SELECT COUNT(*) AS c FROM outbound_orders o${whereClause}`,
        params
      );
      const total = Number(totalRow?.c ?? 0);

      const rows = await all(
        db,
        `${OUTBOUND_HEADER_SQL}${whereClause}
         ORDER BY datetime(o.created_at) DESC, o.id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      res.json({
        orders: rows,
        total,
        page,
        pageSize,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: '查询出库单失败' });
    }
  });

  app.get('/api/admin/outbound-orders/:id', authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const row = await fetchOutboundDetail(db, id);
      if (!row) return res.status(404).json({ error: '出库单不存在' });
      const defaultQuote = await getDefaultOutboundUnitPrice(db, row.materialId);
      res.json({
        ...row,
        defaultOutboundUnitPrice: defaultQuote,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: '查询出库单详情失败' });
    }
  });

  /**
   * 创建出库单：出库单号、品种、预出库重量、出库价（默认当日对外报价）、按先进先出绑定入库行。
   */
  app.post(
    '/api/admin/outbound-orders',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const body = req.body || {};
      const warehouseId = Number(body.warehouseId ?? body.warehouse_id ?? 1);
      const materialId = Number(body.materialId ?? body.material_id);
      const plannedWeight = parsePositiveNumber(
        body.plannedWeight ?? body.planned_weight
      );
      let unitPrice = parsePositiveNumber(
        body.unitPrice ?? body.unit_price ?? body.outboundPrice
      );

      let orderNo =
        typeof body.orderNo === 'string'
          ? body.orderNo.trim()
          : typeof body.order_no === 'string'
            ? body.order_no.trim()
            : '';
      if (!orderNo) {
        for (let i = 0; i < 8; i++) {
          const candidate = generateOutboundOrderNo();
          const exists = await get(
            db,
            'SELECT 1 AS x FROM outbound_orders WHERE order_no = ?',
            [candidate]
          );
          if (!exists) {
            orderNo = candidate;
            break;
          }
        }
        if (!orderNo) {
          return res.status(500).json({ error: '生成出库单号失败，请重试' });
        }
      }

      if (!Number.isInteger(warehouseId) || warehouseId < 1) {
        return res.status(400).json({ error: '无效库房' });
      }
      if (!Number.isInteger(materialId) || materialId < 1) {
        return res.status(400).json({ error: '请选择出库品种' });
      }
      if (plannedWeight === null) {
        return res.status(400).json({ error: '预出库重量须为大于 0 的数字' });
      }

      const wh = await get(db, 'SELECT id FROM warehouses WHERE id = ?', [
        warehouseId,
      ]);
      if (!wh) return res.status(400).json({ error: '库房不存在' });
      const mat = await get(db, 'SELECT id FROM materials WHERE id = ?', [
        materialId,
      ]);
      if (!mat) return res.status(400).json({ error: '品种不存在' });

      const defaultQuote = await getDefaultOutboundUnitPrice(db, materialId);
      if (unitPrice === null) {
        if (defaultQuote === null) {
          return res.status(400).json({
            error: '请填写出库价格，或先维护该品种的对外报价',
          });
        }
        unitPrice = defaultQuote;
      }

      const fifoRows = await getFifoInboundAvailability(
        db,
        warehouseId,
        materialId
      );
      const fifo = buildFifoAllocations(fifoRows, plannedWeight);
      if (!fifo.ok) {
        return res.status(400).json({ error: fifo.error, shortfall: fifo.shortfall });
      }

      const result = await run(
        db,
        `INSERT INTO outbound_orders (
           order_no, warehouse_id, material_id, planned_weight, unit_price,
           status, created_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
        [orderNo, warehouseId, materialId, plannedWeight, unitPrice, req.admin.id]
      );
      const oid = result.lastID;

      for (const line of fifo.lines) {
        const subOrderNo = `${orderNo}-S${String(line.lineNo).padStart(3, '0')}`;
        await run(
          db,
          `INSERT INTO outbound_fifo_lines (
             outbound_order_id, inbound_order_id, planned_weight, line_no, sub_order_no
           ) VALUES (?, ?, ?, ?, ?)`,
          [oid, line.inboundOrderId, line.plannedWeight, line.lineNo, subOrderNo]
        );
      }

      await bumpWarehouseMaterialPlanned(db, warehouseId, materialId, plannedWeight);

      const detail = await fetchOutboundDetail(db, oid);
      res.status(201).json({
        ...detail,
        defaultOutboundUnitPrice: defaultQuote,
      });
    } catch (e) {
      if (isUniqueConstraint(e)) {
        return res.status(409).json({ error: '出库单号已存在' });
      }
      console.error(e);
      res.status(500).json({ error: '创建出库单失败' });
    }
  }
  );

  /**
   * 完成出库：实际出库重量、磅单图片；按先进先出顺序在行上写入实际扣减；同步汇总表实际出库量。
   */
  app.put(
    '/api/admin/outbound-orders/:id/complete',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) {
          return res.status(400).json({ error: '无效 id' });
        }
        const body = req.body || {};
        const actualWeight = parsePositiveNumber(
          body.actualWeight ?? body.actual_weight
        );
        const photo =
          typeof body.weighbridgePhoto === 'string'
            ? body.weighbridgePhoto.trim()
            : typeof body.weighbridge_photo === 'string'
              ? body.weighbridge_photo.trim()
              : typeof body.poundSlipPhoto === 'string'
                ? body.poundSlipPhoto.trim()
                : '';

        const existing = await get(db, 'SELECT * FROM outbound_orders WHERE id = ?', [
          id,
        ]);
        if (!existing) return res.status(404).json({ error: '出库单不存在' });
        if (existing.status !== 'pending') {
          return res.status(400).json({ error: '仅待完成状态的出库单可确认实际出库' });
        }
        if (actualWeight === null) {
          return res.status(400).json({ error: '实际出库重量须为大于 0 的数字' });
        }
        if (!photo) {
          return res.status(400).json({ error: '请上传磅单图片地址' });
        }

        const lines = await all(
          db,
          `SELECT id, inbound_order_id AS inboundOrderId, planned_weight AS plannedWeight, line_no
           FROM outbound_fifo_lines
           WHERE outbound_order_id = ?
           ORDER BY line_no ASC`,
          [id]
        );
        if (!lines.length) {
          return res.status(400).json({ error: '出库单缺少 FIFO 分配行' });
        }

        const dist = distributeActualByFifoLines(lines, actualWeight);
        if (!dist.ok) {
          return res.status(400).json({ error: dist.error });
        }

        for (const u of dist.updates) {
          await run(
            db,
            `UPDATE outbound_fifo_lines SET actual_weight = ? WHERE id = ?`,
            [u.actualWeight, u.id]
          );
        }

        await run(
          db,
          `UPDATE outbound_orders SET
             actual_weight = ?,
             weighbridge_photo = ?,
             status = 'completed',
             updated_at = datetime('now')
           WHERE id = ?`,
          [roundTon(actualWeight), photo, id]
        );

        await bumpWarehouseMaterialPlanned(
          db,
          existing.warehouse_id,
          existing.material_id,
          -Number(existing.planned_weight)
        );
        await bumpWarehouseMaterialActual(
          db,
          existing.warehouse_id,
          existing.material_id,
          roundTon(actualWeight)
        );

        const detail = await fetchOutboundDetail(db, id);
        res.json(detail);
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: '确认实际出库失败' });
      }
    }
  );

  app.delete(
    '/api/admin/outbound-orders/:id',
    authMiddleware,
    requireWarehouseRole,
    async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: '无效 id' });
      }
      const existing = await get(db, 'SELECT * FROM outbound_orders WHERE id = ?', [id]);
      if (!existing) return res.status(404).json({ error: '出库单不存在' });
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: '仅待完成状态的出库单可删除' });
      }

      await bumpWarehouseMaterialPlanned(
        db,
        existing.warehouse_id,
        existing.material_id,
        -Number(existing.planned_weight)
      );

      await run(db, 'DELETE FROM outbound_fifo_lines WHERE outbound_order_id = ?', [id]);
      await run(db, 'DELETE FROM outbound_orders WHERE id = ?', [id]);
      res.status(204).send();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: '删除出库单失败' });
    }
  }
  );
}

async function bumpWarehouseMaterialPlanned(db, warehouseId, materialId, delta) {
  const d = roundTon(delta);
  if (Math.abs(d) < 0.0001) return;
  await run(
    db,
    `INSERT INTO warehouse_material_outbound (warehouse_id, material_id, actual_weight, planned_weight, updated_at)
     VALUES (?, ?, 0, ?, datetime('now'))
     ON CONFLICT(warehouse_id, material_id) DO UPDATE SET
       planned_weight = MAX(0, warehouse_material_outbound.planned_weight + excluded.planned_weight),
       updated_at = datetime('now')`,
    [warehouseId, materialId, d]
  );
}

async function bumpWarehouseMaterialActual(db, warehouseId, materialId, delta) {
  const d = roundTon(delta);
  if (d <= 0) return;
  await run(
    db,
    `INSERT INTO warehouse_material_outbound (warehouse_id, material_id, actual_weight, planned_weight, updated_at)
     VALUES (?, ?, ?, 0, datetime('now'))
     ON CONFLICT(warehouse_id, material_id) DO UPDATE SET
       actual_weight = warehouse_material_outbound.actual_weight + ?,
       updated_at = datetime('now')`,
    [warehouseId, materialId, d, d]
  );
}
