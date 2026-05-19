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

function parseAlertStatusFilter(raw) {
  if (raw == null || raw === '') return 'all';
  const s = String(raw).trim().toLowerCase();
  if (s === 'overstock' || s === 'normal' || s === 'all') return s;
  return null;
}

function mapSummaryRow(row, basis, thresholdTon) {
  const T = roundTon(row.totalApprovedInboundWeight);
  const A = roundTon(row.actualOutboundWeight);
  const U = roundTon(row.unfulfilledPlannedWeight ?? row.plannedOutboundWeight ?? 0);
  const deductCombined = roundTon(Math.min(T, combinedOutboundDeduction(A, U)));
  const deductActual = A;
  const waitingNotActuallyOutbound = roundTon(Math.max(0, T - A));
  const waitingNotPlannedOutbound = roundTon(Math.max(0, T - U));
  const remainingActualBasis = roundTon(Math.max(0, T - A));
  const remainingCombinedBasis = roundTon(Math.max(0, T - deductCombined));
  const isCombined = basis !== 'actual';
  const remainingWeightByBasis = isCombined ? remainingCombinedBasis : remainingActualBasis;

  /** 累计已审核入库达到阈值（统计提醒，与「库存囤积」预警不同） */
  const meetsInboundTonReminder = T >= thresholdTon;
  /** 可用库存严格大于阈值 → 库存囤积过多 */
  const isOverstockAlert = remainingWeightByBasis > thresholdTon;
  const overstockExcessTon = isOverstockAlert
    ? roundTon(remainingWeightByBasis - thresholdTon)
    : 0;
  const alertStatus = isOverstockAlert ? 'overstock' : 'normal';

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
    /** @deprecated 请用 unfulfilledPlannedWeight；保留兼容 */
    plannedOutboundWeight: U,
    unfulfilledPlannedWeight: U,
    preOutboundWeight: U,
    waitingNotActuallyOutboundWeight: waitingNotActuallyOutbound,
    waitingNotPlannedOutboundWeight: waitingNotPlannedOutbound,
    combinedOutboundDeductionWeight: deductCombined,
    /** 列表展示用：固定为实际出库重量 */
    deductionWeight: deductActual,
    deductionWeightDisplay: deductActual,
    deductionWeightByBasis: isCombined ? deductCombined : deductActual,
    remainingWeightByBasis,
    basis,
    alertStatus,
    isOverstockAlert,
    overstockExcessTon,
    meetsInboundTonReminder,
    remindWarehouse: meetsInboundTonReminder,
    remindStatistics: meetsInboundTonReminder,
  };
}

function buildAlertReport(items, thresholdTon) {
  let overstockCount = 0;
  let normalCount = 0;
  let totalRemainingOverstock = 0;
  let totalExcessTon = 0;
  for (const it of items) {
    if (it.isOverstockAlert) {
      overstockCount += 1;
      totalRemainingOverstock = roundTon(
        totalRemainingOverstock + Number(it.remainingWeightByBasis || 0)
      );
      totalExcessTon = roundTon(totalExcessTon + Number(it.overstockExcessTon || 0));
    } else {
      normalCount += 1;
    }
  }
  return {
    thresholdTon,
    totalItems: items.length,
    overstockCount,
    normalCount,
    totalRemainingOverstockTon: totalRemainingOverstock,
    totalExcessOverThresholdTon: totalExcessTon,
  };
}

/** 出库占用从 FIFO 子行汇总（与入库单、创建出库校验一致） */
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
  COALESCE(ob.unfulfilledPlannedWeight, 0) AS unfulfilledPlannedWeight
FROM (
  SELECT warehouse_id, material_id, SUM(weight) AS totalApprovedInboundWeight
  FROM inbound_orders
  WHERE audit_status = 'approved'
  GROUP BY warehouse_id, material_id
) agg
JOIN warehouses w ON w.id = agg.warehouse_id
JOIN materials m ON m.id = agg.material_id
LEFT JOIN (
  SELECT io.warehouse_id,
         io.material_id,
         SUM(CASE WHEN o.status = 'completed'
             THEN COALESCE(l.actual_weight, 0) ELSE 0 END) AS actualOutboundWeight,
         SUM(CASE WHEN l.planned_weight > COALESCE(l.actual_weight, 0)
             THEN l.planned_weight - COALESCE(l.actual_weight, 0)
             ELSE 0 END) AS unfulfilledPlannedWeight
  FROM outbound_fifo_lines l
  JOIN outbound_orders o ON o.id = l.outbound_order_id
  JOIN inbound_orders io ON io.id = l.inbound_order_id
  WHERE io.audit_status = 'approved'
  GROUP BY io.warehouse_id, io.material_id
) ob ON ob.warehouse_id = agg.warehouse_id AND ob.material_id = agg.material_id
WHERE agg.totalApprovedInboundWeight > 0
ORDER BY w.name, m.name
`;

export function registerInventoryAlertRoutes(app, db, authMiddleware) {
  /**
   * 入库汇总预警：库房+品种维度。
   * 囤积预警：可用库存（remainingWeightByBasis）> thresholdTon。
   * 扣减重量展示（deductionWeight）固定为实际出库；basis 仅影响可用库存计算。
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

      const alertStatusRaw =
        req.query.alertStatus ??
        req.query.alert_status ??
        req.query.warningStatus ??
        req.query.warning_status;
      const alertStatusFilter = parseAlertStatusFilter(alertStatusRaw);
      if (alertStatusRaw != null && alertStatusRaw !== '' && !alertStatusFilter) {
        return res.status(400).json({
          error: 'alertStatus 须为 overstock | normal | all',
        });
      }

      const onlyReminder =
        req.query.onlyThirtyTonReminder === '1' ||
        req.query.onlyThirtyTonReminder === 'true' ||
        req.query.only_thirty_ton_reminder === '1' ||
        req.query.only_thirty_ton_reminder === 'true';

      const includeReport =
        req.query.includeReport === '1' ||
        req.query.includeReport === 'true' ||
        req.query.include_report === '1' ||
        req.query.include_report === 'true';

      const rows = await all(db, SUMMARY_SQL, []);
      let allItems = rows.map((r) => mapSummaryRow(r, basis, thresholdTon));

      if (onlyReminder) {
        allItems = allItems.filter((it) => it.meetsInboundTonReminder);
      }

      if (alertStatusFilter === 'overstock') {
        allItems = allItems.filter((it) => it.isOverstockAlert);
      } else if (alertStatusFilter === 'normal') {
        allItems = allItems.filter((it) => !it.isOverstockAlert);
      }

      const hasInboundTonReminder = allItems.some((it) => it.meetsInboundTonReminder);
      const hasOverstockAlert = allItems.some((it) => it.isOverstockAlert);

      const payload = {
        basis,
        defaultBasis: 'combined',
        combinedRuleDescription:
          '可用库存（combined）= 总入库 − 实际出库 − 未出库预出库占用；列表「扣减重量」固定展示实际出库',
        overstockRuleDescription:
          '库存囤积过多：可用库存严格大于阈值（> thresholdTon）',
        thresholdTon,
        alertStatusFilter: alertStatusFilter || 'all',
        onlyThirtyTonReminder: onlyReminder,
        hasInboundTonReminder,
        hasOverstockAlert,
        items: allItems,
      };

      if (includeReport) {
        payload.report = buildAlertReport(allItems, thresholdTon);
      }

      res.json(payload);
    } catch (e) {
      log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
      res.status(500).json({ error: '查询入库汇总预警失败' });
    }
  });

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
           COALESCE(SUM(CASE WHEN o.status = 'completed'
             THEN COALESCE(l.actual_weight, 0) ELSE 0 END), 0) AS actualOutboundWeight,
           COALESCE(SUM(CASE WHEN l.planned_weight > COALESCE(l.actual_weight, 0)
             THEN l.planned_weight - COALESCE(l.actual_weight, 0) ELSE 0 END), 0) AS unfulfilledPlannedWeight
         FROM outbound_fifo_lines l
         JOIN outbound_orders o ON o.id = l.outbound_order_id
         JOIN inbound_orders io ON io.id = l.inbound_order_id
         WHERE io.warehouse_id = ? AND io.material_id = ? AND io.audit_status = 'approved'`,
        [warehouseId, materialId]
      );
      const A = roundTon(obRow[0]?.actualOutboundWeight);
      const U = roundTon(obRow[0]?.unfulfilledPlannedWeight);
      const combinedDeduction = roundTon(Math.min(T, combinedOutboundDeduction(A, U)));

      res.json({
        warehouse: { id: warehouseId, code: wh[0].code, name: wh[0].name },
        material: { id: materialId, code: mat[0].code, name: mat[0].name },
        availableWeight,
        totalApprovedInboundWeight: T,
        actualOutboundWeight: A,
        plannedOutboundWeight: U,
        unfulfilledPlannedWeight: U,
        preOutboundWeight: U,
        combinedOutboundDeductionWeight: combinedDeduction,
        deductionWeight: A,
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
