import { all } from './db.js';
import { roundTon } from './inventoryStock.js';
import { computeInboundInventoryStatus } from './inventoryWarehouseReport.js';

/** FIFO 行：已实际出库（仅 completed 子行） */
export const INBOUND_ACTUAL_SUBQUERY = `(SELECT COALESCE(SUM(
  CASE WHEN o.status = 'completed' THEN COALESCE(l.actual_weight, 0) ELSE 0 END
), 0)
FROM outbound_fifo_lines l
JOIN outbound_orders o ON o.id = l.outbound_order_id
WHERE l.inbound_order_id = io.id)`;

/** FIFO 行：预出库占用（计划 − 已实际，未完成部分） */
export const INBOUND_UNFULFILLED_SUBQUERY = `(SELECT COALESCE(SUM(
  CASE WHEN l.planned_weight > COALESCE(l.actual_weight, 0)
    THEN l.planned_weight - COALESCE(l.actual_weight, 0)
    ELSE 0 END
), 0)
FROM outbound_fifo_lines l
JOIN outbound_orders o ON o.id = l.outbound_order_id
WHERE l.inbound_order_id = io.id)`;

/** FIFO 行：计划占用合计（含已完成，用于库存状态） */
export const INBOUND_PLANNED_SUBQUERY = `(SELECT COALESCE(SUM(l.planned_weight), 0)
FROM outbound_fifo_lines l
WHERE l.inbound_order_id = io.id)`;

const INVENTORY_STATUS_KEYS = new Set([
  'pending_audit',
  'pending_outbound',
  'outbounding',
  'partial_outbound',
  'fully_outbound',
]);

/**
 * 入库单列表筛选：库存流转状态（与 warehouse-stock-report 一致）
 */
export function inboundInventoryStatusWhereClause(statusKey) {
  if (!statusKey || !INVENTORY_STATUS_KEYS.has(statusKey)) return null;
  const a = INBOUND_ACTUAL_SUBQUERY;
  const p = INBOUND_PLANNED_SUBQUERY;
  switch (statusKey) {
    case 'pending_audit':
      return `io.audit_status = 'pending'`;
    case 'pending_outbound':
      return `io.audit_status = 'approved' AND ${a} < io.weight - 0.001 AND ${p} <= 0.001`;
    case 'outbounding':
      return `io.audit_status = 'approved' AND ${a} <= 0.001 AND ${p} > 0.001 AND ${a} < io.weight - 0.001`;
    case 'partial_outbound':
      return `io.audit_status = 'approved' AND ${a} > 0.001 AND ${a} < io.weight - 0.001`;
    case 'fully_outbound':
      return `io.audit_status = 'approved' AND ${a} >= io.weight - 0.001`;
    default:
      return null;
  }
}

export { INVENTORY_STATUS_KEYS };

/**
 * 批量加载入库单 FIFO 出库占用（actual / 未出库计划 preOutbound）
 */
export async function fetchInboundFifoWeightMap(db, inboundOrderIds = null) {
  let sql = `SELECT l.inbound_order_id AS inboundOrderId,
                    SUM(CASE WHEN o.status = 'completed'
                        THEN COALESCE(l.actual_weight, 0) ELSE 0 END) AS actualOutboundWeight,
                    SUM(l.planned_weight) AS totalPlannedWeight,
                    SUM(CASE WHEN l.planned_weight > COALESCE(l.actual_weight, 0)
                        THEN l.planned_weight - COALESCE(l.actual_weight, 0)
                        ELSE 0 END) AS unfulfilledPlannedWeight
             FROM outbound_fifo_lines l
             JOIN outbound_orders o ON o.id = l.outbound_order_id`;
  const params = [];
  if (inboundOrderIds && inboundOrderIds.length) {
    const placeholders = inboundOrderIds.map(() => '?').join(',');
    sql += ` WHERE l.inbound_order_id IN (${placeholders})`;
    params.push(...inboundOrderIds);
  }
  sql += ' GROUP BY l.inbound_order_id';
  const rows = await all(db, sql, params);
  const map = new Map();
  for (const r of rows) {
    const actual = roundTon(r.actualOutboundWeight);
    const unfulfilled = roundTon(r.unfulfilledPlannedWeight);
    const totalPlanned = roundTon(r.totalPlannedWeight);
    map.set(Number(r.inboundOrderId), {
      actualOutboundWeight: actual,
      totalPlannedWeight: totalPlanned,
      unfulfilledPlannedWeight: unfulfilled,
      /** 与 unfulfilledPlannedWeight 同义：有出库计划尚未实际出库的部分 */
      preOutboundWeight: unfulfilled,
    });
  }
  return map;
}

const EMPTY_WEIGHTS = {
  actualOutboundWeight: 0,
  totalPlannedWeight: 0,
  unfulfilledPlannedWeight: 0,
  preOutboundWeight: 0,
};

/**
 * 为入库单响应附加出库占用与库存状态
 */
export function enrichInboundWithOutboundWeights(mappedRow, weightMap) {
  if (!mappedRow) return null;
  const w =
    weightMap.get(Number(mappedRow.id)) || { ...EMPTY_WEIGHTS };
  const inboundWeight = roundTon(mappedRow.weight);
  const availableWeight = roundTon(
    Math.max(0, inboundWeight - w.actualOutboundWeight - w.unfulfilledPlannedWeight)
  );
  const st = computeInboundInventoryStatus(
    mappedRow.auditStatus,
    inboundWeight,
    w.totalPlannedWeight,
    w.actualOutboundWeight
  );
  return {
    ...mappedRow,
    ...w,
    availableWeight,
    inventoryStatus: st.key,
    inventoryStatusLabel: st.label,
  };
}
