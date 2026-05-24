import { all } from './db.js';
import { createLogger } from './logger.js';
import { roundMoney, roundTon } from './inventoryStock.js';

const log = createLogger('nemh.inboundReport');

function parseDateQuery(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * 入库统计报表：按库房+品种（或仅品种）聚合已审核入库。
 */
export function registerInboundReportRoutes(app, db, authMiddleware) {
  app.get('/api/admin/reports/inbound-summary', authMiddleware, async (req, res) => {
    try {
      const startDate = parseDateQuery(req.query.startDate ?? req.query.start_date);
      const endDate = parseDateQuery(req.query.endDate ?? req.query.end_date);
      const materialIdRaw = req.query.materialId ?? req.query.material_id;
      const warehouseIdRaw = req.query.warehouseId ?? req.query.warehouse_id;
      const groupByRaw =
        typeof req.query.groupBy === 'string'
          ? req.query.groupBy.trim().toLowerCase()
          : typeof req.query.group_by === 'string'
            ? req.query.group_by.trim().toLowerCase()
            : 'warehouse_material';

      const groupBy =
        groupByRaw === 'material' ? 'material' : 'warehouse_material';

      const materialId =
        materialIdRaw != null && materialIdRaw !== ''
          ? Number(materialIdRaw)
          : null;
      const warehouseId =
        warehouseIdRaw != null && warehouseIdRaw !== ''
          ? Number(warehouseIdRaw)
          : null;

      if (materialId != null && (!Number.isInteger(materialId) || materialId < 1)) {
        return res.status(400).json({ error: 'materialId 无效' });
      }
      if (warehouseId != null && (!Number.isInteger(warehouseId) || warehouseId < 1)) {
        return res.status(400).json({ error: 'warehouseId 无效' });
      }

      const whereParts = [`io.audit_status = 'approved'`];
      const params = [];

      if (startDate) {
        whereParts.push(`date(io.inbound_at) >= date(?)`);
        params.push(startDate);
      }
      if (endDate) {
        whereParts.push(`date(io.inbound_at) <= date(?)`);
        params.push(endDate);
      }
      if (materialId) {
        whereParts.push('io.material_id = ?');
        params.push(materialId);
      }
      if (warehouseId) {
        whereParts.push('io.warehouse_id = ?');
        params.push(warehouseId);
      }

      const whereClause = whereParts.join(' AND ');

      const groupCols =
        groupBy === 'material'
          ? `io.material_id, m.code, m.name`
          : `io.warehouse_id, w.code, w.name, io.material_id, m.code, m.name`;

      const selectCols =
        groupBy === 'material'
          ? `io.material_id AS materialId,
             m.code AS materialCode,
             m.name AS materialName,
             NULL AS warehouseId,
             NULL AS warehouseCode,
             NULL AS warehouseName`
          : `io.warehouse_id AS warehouseId,
             w.code AS warehouseCode,
             w.name AS warehouseName,
             io.material_id AS materialId,
             m.code AS materialCode,
             m.name AS materialName`;

      const joinWarehouse =
        groupBy === 'material' ? '' : 'JOIN warehouses w ON w.id = io.warehouse_id';

      const rows = await all(
        db,
        `SELECT ${selectCols},
                COUNT(*) AS inboundOrderCount,
                SUM(io.weight) AS inboundWeight,
                SUM(io.total_amount) AS inboundAmount
         FROM inbound_orders io
         JOIN materials m ON m.id = io.material_id
         ${joinWarehouse}
         WHERE ${whereClause}
         GROUP BY ${groupCols}
         ORDER BY ${groupBy === 'material' ? 'm.code' : 'w.name, m.code'} ASC`,
        params
      );

      let totalOrderCount = 0;
      let totalWeight = 0;
      let totalAmount = 0;

      const items = rows.map((r) => {
        const inboundOrderCount = Number(r.inboundOrderCount) || 0;
        const inboundWeight = roundTon(r.inboundWeight);
        const inboundAmount = roundMoney(r.inboundAmount);
        totalOrderCount += inboundOrderCount;
        totalWeight = roundTon(totalWeight + inboundWeight);
        totalAmount = roundMoney(totalAmount + inboundAmount);

        const item = {
          inboundOrderCount,
          inboundWeight,
          inboundAmount,
          material: {
            id: Number(r.materialId),
            code: r.materialCode,
            name: r.materialName,
          },
        };
        if (groupBy === 'warehouse_material') {
          item.warehouse = {
            id: Number(r.warehouseId),
            code: r.warehouseCode,
            name: r.warehouseName,
          };
        }
        return item;
      });

      res.json({
        startDate: startDate || null,
        endDate: endDate || null,
        warehouseId: warehouseId || null,
        materialId: materialId || null,
        groupBy,
        /** 统计口径：已审核入库单的 inbound_at 日期 */
        inboundAtBasis: 'inbound_at',
        totals: {
          inboundOrderCount: totalOrderCount,
          inboundWeight: totalWeight,
          inboundAmount: totalAmount,
        },
        items,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询入库统计报表失败' });
    }
  });
}
