import { all } from './db.js';

export function roundTon(n) {
  return Number((Number(n) || 0).toFixed(2));
}

export function roundMoney(n) {
  return Number((Number(n) || 0).toFixed(2));
}

/**
 * combined 口径：已实际出库 + 待完成预出库（同一出库单完成时会从预出库扣减，二者不重复累计）。
 */
export function combinedOutboundDeduction(actual, planned) {
  const a = Number(actual) || 0;
  const p = Number(planned) || 0;
  return roundTon(a + p);
}

/**
 * 已审核入库单按 FIFO，计算每条可再分配重量（已完成子行用实际，待完成用预分配）。
 */
export async function getFifoInboundAvailability(db, warehouseId, materialId) {
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

export function sumFifoAvailableWeight(fifoRows) {
  return roundTon(
    (fifoRows || []).reduce((s, r) => s + Number(r.availableWeight || 0), 0)
  );
}
