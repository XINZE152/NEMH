import { all } from './db.js';

function roundTon(n) {
  return Number((Number(n) || 0).toFixed(2));
}

/**
 * 按入库单维度：待审核 / 待出库 / 出库中 / 部分已出库 / 全部已出库
 * （审核驳回的入库单不出现在报表 SQL 中）
 */
export function computeInboundInventoryStatus(auditStatus, inboundWeight, plannedSum, actualSum) {
  const w = roundTon(inboundWeight);
  const p = roundTon(plannedSum);
  const a = roundTon(actualSum);

  if (auditStatus === 'pending') {
    return {
      key: 'pending_audit',
      label: '待审核',
    };
  }
  if (auditStatus !== 'approved') {
    return { key: 'pending_audit', label: '待审核' };
  }

  if (a >= w - 0.001) {
    return { key: 'fully_outbound', label: '全部已出库' };
  }
  if (a > 0.001) {
    return { key: 'partial_outbound', label: '部分已出库' };
  }
  if (p > 0.001) {
    return { key: 'outbounding', label: '出库中' };
  }
  return { key: 'pending_outbound', label: '待出库' };
}

const INVENTORY_STATUS_KEYS = new Set([
  'pending_audit',
  'pending_outbound',
  'outbounding',
  'partial_outbound',
  'fully_outbound',
]);

export function registerWarehouseStockReportRoutes(app, db, authMiddleware) {
  /**
   * 库房库存报表：库房、入库单、品种、入库重量、库存状态、出库单号、出库子单号、出库重量。
   * 一行对应一个出库子单（outbound_fifo_lines）；无子单时一行仅入库信息。
   * query: warehouseId, materialId, inventoryStatus（key）, page, pageSize
   */
  app.get(
    '/api/admin/inventory/warehouse-stock-report',
    authMiddleware,
    async (req, res) => {
      try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const pageSize = Math.min(
          200,
          Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20)
        );

        const warehouseId = req.query.warehouseId
          ? Number(req.query.warehouseId)
          : null;
        const materialId = req.query.materialId
          ? Number(req.query.materialId)
          : null;
        const invFilter =
          typeof req.query.inventoryStatus === 'string'
            ? req.query.inventoryStatus.trim()
            : typeof req.query.inventory_status === 'string'
              ? req.query.inventory_status.trim()
              : '';
        if (invFilter && !INVENTORY_STATUS_KEYS.has(invFilter)) {
          return res.status(400).json({
            error:
              'inventoryStatus 须为 pending_audit | pending_outbound | outbounding | partial_outbound | fully_outbound',
          });
        }

        const whereIo = [`io.audit_status != 'rejected'`];
        const ioParams = [];
        if (warehouseId && Number.isInteger(warehouseId) && warehouseId > 0) {
          whereIo.push('io.warehouse_id = ?');
          ioParams.push(warehouseId);
        }
        if (materialId && Number.isInteger(materialId) && materialId > 0) {
          whereIo.push('io.material_id = ?');
          ioParams.push(materialId);
        }
        const ioWhereSql = whereIo.length ? `WHERE ${whereIo.join(' AND ')}` : '';

        const inbounds = await all(
          db,
          `SELECT io.id AS inboundOrderId,
                  io.order_no AS inboundOrderNo,
                  io.audit_status AS auditStatus,
                  io.weight AS inboundWeight,
                  io.warehouse_id AS warehouseId,
                  wh.code AS warehouseCode,
                  wh.name AS warehouseName,
                  io.material_id AS materialId,
                  m.code AS materialCode,
                  m.name AS materialName
           FROM inbound_orders io
           JOIN warehouses wh ON wh.id = io.warehouse_id
           JOIN materials m ON m.id = io.material_id
           ${ioWhereSql}
           ORDER BY datetime(io.inbound_at) ASC, io.id ASC`,
          ioParams
        );

        const inboundIds = inbounds.map((r) => r.inboundOrderId);
        let aggMap = new Map();
        let fifoRows = [];
        if (inboundIds.length) {
          const placeholders = inboundIds.map(() => '?').join(',');
          const aggRows = await all(
            db,
            `SELECT l.inbound_order_id AS inboundOrderId,
                    SUM(l.planned_weight) AS plannedSum,
                    SUM(CASE WHEN o.status = 'completed'
                        THEN COALESCE(l.actual_weight, 0)
                        ELSE 0 END) AS actualSum
             FROM outbound_fifo_lines l
             JOIN outbound_orders o ON o.id = l.outbound_order_id
             WHERE l.inbound_order_id IN (${placeholders})
             GROUP BY l.inbound_order_id`,
            inboundIds
          );
          aggMap = new Map(
            aggRows.map((r) => [
              r.inboundOrderId,
              {
                plannedSum: roundTon(r.plannedSum),
                actualSum: roundTon(r.actualSum),
              },
            ])
          );

          fifoRows = await all(
            db,
            `SELECT l.id AS fifoLineId,
                    l.inbound_order_id AS inboundOrderId,
                    l.sub_order_no AS subOrderNo,
                    l.planned_weight AS plannedWeight,
                    l.actual_weight AS actualWeight,
                    l.line_no AS lineNo,
                    o.id AS outboundOrderId,
                    o.order_no AS outboundOrderNo,
                    o.status AS outboundStatus
             FROM outbound_fifo_lines l
             JOIN outbound_orders o ON o.id = l.outbound_order_id
             JOIN inbound_orders io ON io.id = l.inbound_order_id
             ${ioWhereSql}
             ORDER BY l.inbound_order_id ASC, o.id ASC, l.line_no ASC`,
            ioParams
          );
        }

        const fifoByInbound = new Map();
        for (const fr of fifoRows) {
          const k = fr.inboundOrderId;
          if (!fifoByInbound.has(k)) fifoByInbound.set(k, []);
          fifoByInbound.get(k).push(fr);
        }

        const flatRows = [];
        for (const io of inbounds) {
          const agg = aggMap.get(io.inboundOrderId) || {
            plannedSum: 0,
            actualSum: 0,
          };
          const st = computeInboundInventoryStatus(
            io.auditStatus,
            io.inboundWeight,
            agg.plannedSum,
            agg.actualSum
          );
          const lines = fifoByInbound.get(io.inboundOrderId) || [];
          const base = {
            warehouse: {
              id: io.warehouseId,
              code: io.warehouseCode,
              name: io.warehouseName,
            },
            inboundOrderNo: io.inboundOrderNo,
            inboundOrderId: io.inboundOrderId,
            material: {
              id: io.materialId,
              code: io.materialCode,
              name: io.materialName,
            },
            inboundWeight: roundTon(io.inboundWeight),
            inventoryStatus: st.key,
            inventoryStatusLabel: st.label,
          };

          if (!lines.length) {
            flatRows.push({
              ...base,
              outboundOrderNo: null,
              outboundOrderId: null,
              subOrderNo: null,
              fifoLineId: null,
              /** 本行出库重量：已完成取实际，未完成取预出库；无子单为空 */
              outboundWeight: null,
            });
          } else {
            for (const ln of lines) {
              const ow =
                ln.outboundStatus === 'completed'
                  ? roundTon(ln.actualWeight ?? 0)
                  : roundTon(ln.plannedWeight);
              flatRows.push({
                ...base,
                outboundOrderNo: ln.outboundOrderNo,
                outboundOrderId: ln.outboundOrderId,
                subOrderNo: ln.subOrderNo || `${ln.outboundOrderNo}-S${String(ln.lineNo).padStart(3, '0')}`,
                fifoLineId: ln.fifoLineId,
                outboundWeight: ow,
              });
            }
          }
        }

        const filtered = invFilter
          ? flatRows.filter((r) => r.inventoryStatus === invFilter)
          : flatRows;
        const total = filtered.length;
        const offset = (page - 1) * pageSize;
        const pageRows = filtered.slice(offset, offset + pageSize);

        res.json({
          rows: pageRows,
          total,
          page,
          pageSize,
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: '查询库房库存报表失败' });
      }
    }
  );
}
