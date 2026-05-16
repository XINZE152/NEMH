import { all } from './db.js';
import { createLogger } from './logger.js';
import { roundMoney, roundTon } from './inventoryStock.js';

const log = createLogger('nemh.profitReport');

function parseDateQuery(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * 利润汇总：按品种聚合已完成出库；完成时间取 outbound_orders.updated_at 的日期部分。
 */
export function registerProfitReportRoutes(app, db, authMiddleware) {
  app.get('/api/admin/reports/profit-summary', authMiddleware, async (req, res) => {
    try {
      const startDate = parseDateQuery(req.query.startDate ?? req.query.start_date);
      const endDate = parseDateQuery(req.query.endDate ?? req.query.end_date);
      const materialIdRaw = req.query.materialId ?? req.query.material_id;
      const warehouseIdRaw = req.query.warehouseId ?? req.query.warehouse_id;

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

      const whereParts = [`o.status = 'completed'`];
      const params = [];

      if (startDate) {
        whereParts.push(`date(o.updated_at) >= date(?)`);
        params.push(startDate);
      }
      if (endDate) {
        whereParts.push(`date(o.updated_at) <= date(?)`);
        params.push(endDate);
      }
      if (materialId) {
        whereParts.push('o.material_id = ?');
        params.push(materialId);
      }
      if (warehouseId) {
        whereParts.push('o.warehouse_id = ?');
        params.push(warehouseId);
      }

      const whereClause = whereParts.join(' AND ');

      const revenueRows = await all(
        db,
        `SELECT o.material_id AS materialId,
                m.code AS materialCode,
                m.name AS materialName,
                SUM(o.actual_weight) AS salesWeight,
                SUM(o.actual_weight * o.unit_price) AS salesRevenue
         FROM outbound_orders o
         JOIN materials m ON m.id = o.material_id
         WHERE ${whereClause}
         GROUP BY o.material_id, m.code, m.name
         ORDER BY m.code ASC`,
        params
      );

      const costRows = await all(
        db,
        `SELECT o.material_id AS materialId,
                SUM(l.actual_weight * io.unit_price) AS salesCost
         FROM outbound_fifo_lines l
         JOIN outbound_orders o ON o.id = l.outbound_order_id
         JOIN inbound_orders io ON io.id = l.inbound_order_id
         WHERE ${whereClause}
         GROUP BY o.material_id`,
        params
      );

      const costByMaterial = new Map(
        costRows.map((r) => [Number(r.materialId), roundMoney(r.salesCost)])
      );

      let totalSalesRevenue = 0;
      let totalCost = 0;
      let totalProfit = 0;
      let totalSalesWeight = 0;

      const items = revenueRows.map((r) => {
        const mid = Number(r.materialId);
        const salesWeight = roundTon(r.salesWeight);
        const salesRevenue = roundMoney(r.salesRevenue);
        const salesCost = costByMaterial.get(mid) ?? 0;
        const salesProfit = roundMoney(salesRevenue - salesCost);
        const avgSaleUnitPrice =
          salesWeight > 0 ? roundMoney(salesRevenue / salesWeight) : null;
        const profitMarginPercent =
          salesRevenue > 0
            ? roundMoney((salesProfit / salesRevenue) * 100)
            : 0;

        totalSalesWeight = roundTon(totalSalesWeight + salesWeight);
        totalSalesRevenue = roundMoney(totalSalesRevenue + salesRevenue);
        totalCost = roundMoney(totalCost + salesCost);
        totalProfit = roundMoney(totalProfit + salesProfit);

        return {
          material: {
            id: mid,
            code: r.materialCode,
            name: r.materialName,
          },
          salesWeight,
          salesRevenue,
          salesCost,
          salesProfit,
          profitMarginPercent,
          /** 加权平均出库单价（元/吨），便于与对外报价对照 */
          avgSaleUnitPrice,
        };
      });

      res.json({
        startDate: startDate || null,
        endDate: endDate || null,
        warehouseId: warehouseId || null,
        materialId: materialId || null,
        /** 完成时间口径：出库单 status=completed 时的 updated_at 日期 */
        completedAtBasis: 'updated_at',
        totals: {
          salesWeight: totalSalesWeight,
          salesRevenue: totalSalesRevenue,
          salesCost: totalCost,
          salesProfit: totalProfit,
          profitMarginPercent:
            totalSalesRevenue > 0
              ? roundMoney((totalProfit / totalSalesRevenue) * 100)
              : 0,
        },
        items,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询利润汇总失败' });
    }
  });
}
