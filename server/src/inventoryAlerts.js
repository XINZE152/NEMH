import { all } from './db.js';
import { createLogger } from './logger.js';
import {
  combinedOutboundDeduction,
  getFifoInboundAvailability,
  roundTon,
  sumFifoAvailableWeight,
} from './inventoryStock.js';

const log = createLogger('nemh.inventoryAlerts');

const DEFAULT_THRESHOLD_TON = 30;

function mapSummaryRow(row, basis, thresholdTon) {
  const T = roundTon(row.totalApprovedInboundWeight);
  const A = roundTon(row.actualOutboundWeight);
  const P = roundTon(row.plannedOutboundWeight);
  const deductCombined = roundTon(Math.min(T, combinedOutboundDeduction(A, P)));
  const deductActual = A;
  const waitingNotActuallyOutbound = roundTon(Math.max(0, T - A));
  const waitingNotPlannedOutbound = roundTon(Math.max(0, T - P));
  const remainingActualBasis = roundTon(Math.max(0, T - A));
  const remainingCombinedBasis = roundTon(Math.max(0, T - deductCombined));
  const meetsReminder = T >= thresholdTon;
  const isCombined = basis !== 'actual';

  return {
    warehouse: {
      id: row.warehouseId,
      code: row.warehouseCode,
      name: row.warehouseName,
    },
    material: {
      id: row.materialId,
      code: row.materialCode,
      name: row.materialName,
    },
    totalApprovedInboundWeight: T,
    actualOutboundWeight: A,
    plannedOutboundWeight: P,
    /** 待出库重量（未实际出库）= 总入库(已审核) − 已实际出库 */
    waitingNotActuallyOutboundWeight: waitingNotActuallyOutbound,
    /** 待出库重量（未预出库）= 总入库(已审核) − 预出库重量 */
    waitingNotPlannedOutboundWeight: waitingNotPlannedOutbound,
    /** combined 口径：实际出库 + 预出库（完成出库后预出库会回滚，不与实际重复） */
    combinedOutboundDeductionWeight: deductCombined,
    /** 当前 basis 下的扣减重量（actual 仅实际；combined 为实际+预出库） */
    deductionWeightByBasis: isCombined ? deductCombined : deductActual,
    /** 预警页按 basis 计算的剩余在库参考量（可用库存） */
    remainingWeightByBasis: isCombined ? remainingCombinedBasis : remainingActualBasis,
    basis,
    meetsInboundTonReminder: meetsReminder,
    remindWarehouse: meetsReminder,
    remindStatistics: meetsReminder,
  };
}

/** 出库占用重量直接从 outbound_orders 汇总，与 FIFO 行级一致，不依赖 warehouse_material_outbound 缓存表 */
const SUMMARY_SQL = `
SELECT
  agg.warehouse_id AS warehouseId,
  w.code AS warehouseCode,
  w.name AS warehouseName,
  agg.material_id AS materialId,
  m.code AS materialCode,
  m.name AS materialName,
  agg.totalApprovedInboundWeight AS totalApprovedInboundWeight,
  COALESCE(ob.actualOutboundWeight, 0) AS actualOutboundWeight,
  COALESCE(ob.plannedOutboundWeight, 0) AS plannedOutboundWeight
FROM (
  SELECT warehouse_id, material_id, SUM(weight) AS totalApprovedInboundWeight
  FROM inbound_orders
  WHERE audit_status = 'approved'
  GROUP BY warehouse_id, material_id
) agg
JOIN warehouses w ON w.id = agg.warehouse_id
JOIN materials m ON m.id = agg.material_id
LEFT JOIN (
  SELECT warehouse_id,
         material_id,
         SUM(CASE WHEN status = 'completed' THEN actual_weight ELSE 0 END) AS actualOutboundWeight,
         SUM(CASE WHEN status = 'pending' THEN planned_weight ELSE 0 END) AS plannedOutboundWeight
  FROM outbound_orders
  GROUP BY warehouse_id, material_id
) ob ON ob.warehouse_id = agg.warehouse_id AND ob.material_id = agg.material_id
WHERE agg.totalApprovedInboundWeight > 0
ORDER BY w.name, m.name
`;

export function registerInventoryAlertRoutes(app, db, authMiddleware) {
  /**
   * 入库汇总预警：库房+品种维度。
   * basis=combined：扣减=实际出库+预出库，可用=总入库−扣减；
   * basis=actual：扣减=实际出库，可用=总入库−实际出库。
   */
  app.get('/api/admin/inbound-summary-alerts', authMiddleware, async (req, res) => {
    try {
      const rawBasis =
        typeof req.query.basis === 'string' ? req.query.basis.trim().toLowerCase() : '';
      const basis = rawBasis === 'actual' ? 'actual' : 'combined';

      const thresholdRaw = req.query.thresholdTon ?? req.query.threshold_ton;
      let thresholdTon = DEFAULT_THRESHOLD_TON;
      if (thresholdRaw !== undefined && thresholdRaw !== null && thresholdRaw !== '') {
        const t = Number(thresholdRaw);
        if (!Number.isFinite(t) || t <= 0) {
          return res.status(400).json({ error: 'thresholdTon 须为正数' });
        }
        thresholdTon = t;
      }

      const onlyReminder =
        req.query.onlyThirtyTonReminder === '1' ||
        req.query.onlyThirtyTonReminder === 'true' ||
        req.query.only_thirty_ton_reminder === '1' ||
        req.query.only_thirty_ton_reminder === 'true';

      const rows = await all(db, SUMMARY_SQL, []);
      const allItems = rows.map((r) => mapSummaryRow(r, basis, thresholdTon));
      const hasInboundTonReminder = allItems.some((it) => it.meetsInboundTonReminder);
      const items = onlyReminder
        ? allItems.filter((it) => it.meetsInboundTonReminder)
        : allItems;

      res.json({
        basis,
        defaultBasis: 'combined',
        /** combined 扣减规则说明（与前端下拉文案一致） */
        combinedRuleDescription:
          '扣减重量 = 已完成实际出库重量 + 待完成预出库重量；完成出库后预出库占用回滚，不与实际重复累计',
        thresholdTon,
        onlyThirtyTonReminder: onlyReminder,
        hasInboundTonReminder,
        items,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询入库汇总预警失败' });
    }
  });

  /**
   * 库房+品种可出库库存（FIFO 行级可用量之和，与创建出库单校验一致）。
   */
  app.get('/api/admin/inventory/available-stock', authMiddleware, async (req, res) => {
    try {
      const warehouseId = Number(req.query.warehouseId ?? req.query.warehouse_id);
      const materialId = Number(req.query.materialId ?? req.query.material_id);

      if (!Number.isInteger(warehouseId) || warehouseId < 1) {
        return res.status(400).json({ error: '请提供有效的 warehouseId' });
      }
      if (!Number.isInteger(materialId) || materialId < 1) {
        return res.status(400).json({ error: '请提供有效的 materialId' });
      }

      const wh = await all(
        db,
        'SELECT id, code, name FROM warehouses WHERE id = ?',
        [warehouseId]
      );
      if (!wh.length) {
        return res.status(404).json({ error: '库房不存在' });
      }
      const mat = await all(
        db,
        'SELECT id, code, name FROM materials WHERE id = ?',
        [materialId]
      );
      if (!mat.length) {
        return res.status(404).json({ error: '品种不存在' });
      }

      const fifoRows = await getFifoInboundAvailability(db, warehouseId, materialId);
      const availableWeight = sumFifoAvailableWeight(fifoRows);

      const approvedRow = await all(
        db,
        `SELECT COALESCE(SUM(weight), 0) AS totalApprovedInboundWeight
         FROM inbound_orders
         WHERE warehouse_id = ? AND material_id = ? AND audit_status = 'approved'`,
        [warehouseId, materialId]
      );
      const T = roundTon(approvedRow[0]?.totalApprovedInboundWeight);

      const obRow = await all(
        db,
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_weight ELSE 0 END), 0) AS actualOutboundWeight,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN planned_weight ELSE 0 END), 0) AS plannedOutboundWeight
         FROM outbound_orders
         WHERE warehouse_id = ? AND material_id = ?`,
        [warehouseId, materialId]
      );
      const A = roundTon(obRow[0]?.actualOutboundWeight);
      const P = roundTon(obRow[0]?.plannedOutboundWeight);
      const combinedDeduction = roundTon(Math.min(T, combinedOutboundDeduction(A, P)));

      res.json({
        warehouse: { id: warehouseId, code: wh[0].code, name: wh[0].name },
        material: { id: materialId, code: mat[0].code, name: mat[0].name },
        /** 创建预出库时可填写的最大重量（FIFO） */
        availableWeight,
        totalApprovedInboundWeight: T,
        actualOutboundWeight: A,
        plannedOutboundWeight: P,
        combinedOutboundDeductionWeight: combinedDeduction,
        remainingByCombinedBasis: roundTon(Math.max(0, T - combinedDeduction)),
        remainingByActualBasis: roundTon(Math.max(0, T - A)),
        fifoLines: fifoRows.map((r) => ({
          inboundOrderId: r.inboundOrderId,
          inboundOrderNo: r.inboundOrderNo,
          inboundWeight: roundTon(r.inboundWeight),
          availableWeight: roundTon(r.availableWeight),
          inboundAt: r.inboundAt,
        })),
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询可出库库存失败' });
    }
  });
}
