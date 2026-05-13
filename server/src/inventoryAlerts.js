import { all } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('nemh.inventoryAlerts');

const DEFAULT_THRESHOLD_TON = 30;

function roundTon(n) {
  return Number((Number(n) || 0).toFixed(2));
}

/**
 * 实际出库+预出库口径下的出库扣减重量：有实际出库则以实际为准，否则以预出库为准。
 */
function combinedOutboundDeduction(actual, planned) {
  const a = Number(actual) || 0;
  const p = Number(planned) || 0;
  return a > 0 ? a : p;
}

function mapSummaryRow(row, basis, thresholdTon) {
  const T = roundTon(row.totalApprovedInboundWeight);
  const A = roundTon(row.actualOutboundWeight);
  const P = roundTon(row.plannedOutboundWeight);
  const deductCombined = roundTon(combinedOutboundDeduction(A, P));
  const waitingNotActuallyOutbound = roundTon(Math.max(0, T - A));
  const waitingNotPlannedOutbound = roundTon(Math.max(0, T - P));
  const remainingActualBasis = roundTon(Math.max(0, T - A));
  const remainingCombinedBasis = roundTon(Math.max(0, T - deductCombined));
  const meetsReminder = T >= thresholdTon;

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
    /** 实际+预出库规则下的出库扣减重量 */
    combinedOutboundDeductionWeight: deductCombined,
    /** 预警页按 basis 计算的剩余在库参考量 */
    remainingWeightByBasis:
      basis === 'actual' ? remainingActualBasis : remainingCombinedBasis,
    basis,
    /** 某一种类(库房+品种)累计已审核入库 ≥ 阈值时触发库房/统计提醒 */
    meetsInboundTonReminder: meetsReminder,
    remindWarehouse: meetsReminder,
    remindStatistics: meetsReminder,
  };
}

const SUMMARY_SQL = `
SELECT
  agg.warehouse_id AS warehouseId,
  w.code AS warehouseCode,
  w.name AS warehouseName,
  agg.material_id AS materialId,
  m.code AS materialCode,
  m.name AS materialName,
  agg.totalApprovedInboundWeight AS totalApprovedInboundWeight,
  COALESCE(o.actual_weight, 0) AS actualOutboundWeight,
  COALESCE(o.planned_weight, 0) AS plannedOutboundWeight
FROM (
  SELECT warehouse_id, material_id, SUM(weight) AS totalApprovedInboundWeight
  FROM inbound_orders
  WHERE audit_status = 'approved'
  GROUP BY warehouse_id, material_id
) agg
JOIN warehouses w ON w.id = agg.warehouse_id
JOIN materials m ON m.id = agg.material_id
LEFT JOIN warehouse_material_outbound o
  ON o.warehouse_id = agg.warehouse_id AND o.material_id = agg.material_id
WHERE agg.totalApprovedInboundWeight > 0
ORDER BY w.name, m.name
`;

export function registerInventoryAlertRoutes(app, db, authMiddleware) {
  /**
   * 入库汇总预警：库房+品种维度；basis 默认 combined（实际+预出库扣减规则），可选 actual。
   * onlyThirtyTonReminder=1 时仅返回累计已审核入库≥thresholdTon 的明细（默认 30 吨）。
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
        thresholdTon,
        onlyThirtyTonReminder: onlyReminder,
        /** 是否存在满阈值吨的汇总（库房与统计页可用于总提醒） */
        hasInboundTonReminder,
        items,
      });
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询入库汇总预警失败' });
    }
  });
}
