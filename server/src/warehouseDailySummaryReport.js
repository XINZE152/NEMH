import { all, get } from './db.js';
import { createLogger } from './logger.js';
import { roundMoney, roundTon } from './inventoryStock.js';
import {
  fetchPd2BenchmarkReference,
  fetchPd2FreightPerTon,
} from './pd2Readonly.js';
import { isPd2MysqlEnabled } from './pd2Auth.js';

const log = createLogger('nemh.warehouseDailySummary');

function parseDateQuery(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function trimStr(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

async function openingStockTon(db, warehouseId, materialId, beforeDate) {
  const inRow = await get(
    db,
    `SELECT COALESCE(SUM(weight), 0) AS w
     FROM inbound_orders
     WHERE warehouse_id = ? AND material_id = ?
       AND audit_status = 'approved'
       AND date(inbound_at) < date(?)`,
    [warehouseId, materialId, beforeDate]
  );
  const outRow = await get(
    db,
    `SELECT COALESCE(SUM(l.actual_weight), 0) AS w
     FROM outbound_fifo_lines l
     JOIN outbound_orders o ON o.id = l.outbound_order_id
     JOIN inbound_orders io ON io.id = l.inbound_order_id
     WHERE io.warehouse_id = ? AND io.material_id = ?
       AND o.status = 'completed'
       AND date(o.updated_at) < date(?)`,
    [warehouseId, materialId, beforeDate]
  );
  return roundTon(Number(inRow?.w ?? 0) - Number(outRow?.w ?? 0));
}

async function loadWarehousesForReport(db, filters) {
  const { regionalManager, warehouseId, materialId } = filters;
  const params = [];
  let sql = `SELECT id, code, name,
      IFNULL(regional_manager_name, '') AS regional_manager_name,
      external_source, external_id
    FROM warehouses WHERE 1=1`;
  if (warehouseId) {
    sql += ' AND id = ?';
    params.push(warehouseId);
  }
  if (regionalManager) {
    sql += ' AND regional_manager_name = ?';
    params.push(regionalManager);
  }
  sql += ' ORDER BY regional_manager_name ASC, name ASC';
  const warehouses = await all(db, sql, params);

  if (!materialId) return warehouses;

  const whIds = warehouses.map((w) => w.id);
  if (!whIds.length) return [];
  const placeholders = whIds.map(() => '?').join(',');
  const active = await all(
    db,
    `SELECT DISTINCT warehouse_id AS warehouseId
     FROM inbound_orders
     WHERE warehouse_id IN (${placeholders}) AND material_id = ?
     UNION
     SELECT DISTINCT io.warehouse_id AS warehouseId
     FROM outbound_fifo_lines l
     JOIN outbound_orders o ON o.id = l.outbound_order_id
     JOIN inbound_orders io ON io.id = l.inbound_order_id
     WHERE io.warehouse_id IN (${placeholders}) AND o.material_id = ?`,
    [...whIds, materialId, ...whIds, materialId]
  );
  const activeSet = new Set(active.map((r) => r.warehouseId));
  return warehouses.filter((w) => activeSet.has(w.id));
}

async function materialIdsForWarehouseOnDate(db, warehouseId, reportDate, materialIdFilter) {
  if (materialIdFilter) return [materialIdFilter];
  const rows = await all(
    db,
    `SELECT DISTINCT material_id AS materialId FROM (
       SELECT material_id FROM inbound_orders
       WHERE warehouse_id = ? AND audit_status = 'approved'
         AND date(inbound_at) <= date(?)
       UNION
       SELECT o.material_id FROM outbound_orders o
       WHERE o.warehouse_id = ? AND o.status = 'completed'
         AND date(o.updated_at) <= date(?)
     )`,
    [warehouseId, reportDate, warehouseId, reportDate]
  );
  return rows.map((r) => Number(r.materialId)).filter((id) => id > 0);
}

async function buildWarehouseBlock(db, wh, reportDate, materialIdFilter, pd2Extras) {
  const materialIds = await materialIdsForWarehouseOnDate(
    db,
    wh.id,
    reportDate,
    materialIdFilter
  );
  const categories = [];

  for (const materialId of materialIds) {
    const mat = await get(
      db,
      'SELECT id, code, name FROM materials WHERE id = ?',
      [materialId]
    );
    if (!mat) continue;

    let stock = await openingStockTon(db, wh.id, materialId, reportDate);

    const inbounds = await all(
      db,
      `SELECT id, order_no AS orderNo, weight, unit_price AS unitPrice,
              total_amount AS totalAmount, inbound_at AS inboundAt
       FROM inbound_orders
       WHERE warehouse_id = ? AND material_id = ?
         AND audit_status = 'approved'
         AND date(inbound_at) = date(?)
       ORDER BY datetime(inbound_at) ASC, id ASC`,
      [wh.id, materialId, reportDate]
    );

    const outbounds = await all(
      db,
      `SELECT o.id AS outboundOrderId, o.order_no AS outboundOrderNo,
              o.unit_price AS saleUnitPrice, o.updated_at AS completedAt,
              l.actual_weight AS actualWeight, l.sub_order_no AS subOrderNo,
              io.unit_price AS fifoUnitPrice
       FROM outbound_fifo_lines l
       JOIN outbound_orders o ON o.id = l.outbound_order_id
       JOIN inbound_orders io ON io.id = l.inbound_order_id
       WHERE io.warehouse_id = ? AND o.material_id = ?
         AND o.status = 'completed'
         AND date(o.updated_at) = date(?)
       ORDER BY datetime(o.updated_at) ASC, l.id ASC`,
      [wh.id, materialId, reportDate]
    );

    const hasDayActivity = inbounds.length > 0 || outbounds.length > 0;
    if (!hasDayActivity && stock < 0.001) continue;

    const freight = pd2Extras?.freight ?? null;
    const benchmarkReference = pd2Extras?.benchmark ?? null;

    const lines = [];

    if (inbounds.length === 0 && outbounds.length === 0) {
      lines.push({
        lineType: 'balance',
        openingStockTon: stock,
        closingStockTon: stock,
        inbound: null,
        outbound: null,
      });
    } else {
      for (const ib of inbounds) {
        const netWeight = roundTon(ib.weight);
        const costUnit = roundMoney(ib.unitPrice);
        const costAmount = roundMoney(ib.totalAmount ?? netWeight * costUnit);
        stock = roundTon(stock + netWeight);
        lines.push({
          lineType: 'inbound',
          openingStockTon: roundTon(stock - netWeight),
          closingStockTon: stock,
          inbound: {
            date: String(ib.inboundAt || '').slice(0, 10),
            materialName: mat.name,
            unitPrice: costUnit,
            freight: freight != null ? roundMoney(freight) : null,
            costUnitPrice: costUnit,
            grossProfitPerTon: null,
            netWeightTon: netWeight,
            costAmount,
            orderNo: ib.orderNo,
          },
          outbound: null,
        });
      }

      for (const ob of outbounds) {
        const weight = roundTon(ob.actualWeight ?? 0);
        if (weight < 0.001) continue;
        const fifoUnit = roundMoney(ob.fifoUnitPrice ?? 0);
        const saleUnit = roundMoney(ob.saleUnitPrice ?? 0);
        const amount = roundMoney(weight * saleUnit);
        const openingBefore = stock;
        stock = roundTon(stock - weight);
        lines.push({
          lineType: 'outbound',
          openingStockTon: openingBefore,
          closingStockTon: stock,
          inbound: null,
          outbound: {
            weighbridgeDate: String(ob.completedAt || '').slice(0, 10),
            vehicleNo: null,
            materialName: mat.name,
            weightTon: weight,
            fifoUnitPrice: fifoUnit,
            amount,
            pickupUnitPrice: saleUnit,
            paymentAmount: amount,
            storageServiceFeePerTon: null,
            profitAmount:
              saleUnit > 0 && fifoUnit > 0
                ? roundMoney((saleUnit - fifoUnit) * weight)
                : null,
            subOrderNo: ob.subOrderNo,
            outboundOrderNo: ob.outboundOrderNo,
          },
        });
      }
    }

    categories.push({
      materialId: mat.id,
      materialCode: mat.code,
      materialName: mat.name,
      openingStockTon: await openingStockTon(db, wh.id, materialId, reportDate),
      closingStockTon: stock,
      benchmarkReferencePrice: benchmarkReference,
      collectiveProfitHalf: null,
      lines,
    });
  }

  return {
    warehouseId: wh.id,
    warehouseCode: wh.code,
    warehouseName: wh.name,
    regionalManager: trimStr(wh.regional_manager_name) || null,
    categories,
  };
}

export function registerWarehouseDailySummaryRoutes(app, db, authMiddleware) {
  app.get(
    '/api/admin/reports/warehouse-daily-summary',
    authMiddleware,
    async (req, res) => {
      try {
        const reportDate = parseDateQuery(
          req.query.date ?? req.query.reportDate ?? req.query.report_date
        );
        if (!reportDate) {
          return res.status(400).json({
            error: '请提供 date（YYYY-MM-DD）',
          });
        }

        const regionalManager = trimStr(
          req.query.regionalManager ?? req.query.regional_manager
        );
        const warehouseIdRaw = req.query.warehouseId ?? req.query.warehouse_id;
        const materialIdRaw = req.query.materialId ?? req.query.material_id;

        const warehouseId =
          warehouseIdRaw != null && warehouseIdRaw !== ''
            ? Number(warehouseIdRaw)
            : null;
        const materialId =
          materialIdRaw != null && materialIdRaw !== ''
            ? Number(materialIdRaw)
            : null;

        if (warehouseId != null && (!Number.isInteger(warehouseId) || warehouseId < 1)) {
          return res.status(400).json({ error: 'warehouseId 无效' });
        }
        if (materialId != null && (!Number.isInteger(materialId) || materialId < 1)) {
          return res.status(400).json({ error: 'materialId 无效' });
        }

        const warehouses = await loadWarehousesForReport(db, {
          regionalManager: regionalManager || null,
          warehouseId,
          materialId,
        });

        const pd2On = isPd2MysqlEnabled();

        const blocks = [];
        for (const wh of warehouses) {
          let pd2Extras = null;
          if (
            pd2On &&
            wh.external_source === 'tl' &&
            wh.external_id
          ) {
            const pd2Id = Number(wh.external_id);
            if (Number.isInteger(pd2Id) && pd2Id > 0) {
              try {
                const [freight, benchmark] = await Promise.all([
                  fetchPd2FreightPerTon(pd2Id, reportDate),
                  fetchPd2BenchmarkReference(pd2Id, reportDate),
                ]);
                pd2Extras = { freight, benchmark };
              } catch (e) {
                log.warn(
                  `PD2 参考数据 warehouse=${wh.id} pd2=${pd2Id}: ${e?.message || e}`
                );
              }
            }
          }

          const block = await buildWarehouseBlock(
            db,
            wh,
            reportDate,
            materialId,
            pd2Extras
          );
          if (block.categories.length > 0) {
            blocks.push(block);
          }
        }

        const filterRows = await all(
          db,
          `SELECT DISTINCT regional_manager_name AS rm FROM warehouses
           WHERE regional_manager_name IS NOT NULL AND TRIM(regional_manager_name) != ''
           ORDER BY rm ASC`
        );
        const regionalManagers = filterRows.map((r) => r.rm);

        res.json({
          date: reportDate,
          filters: {
            regionalManager: regionalManager || null,
            warehouseId: warehouseId || null,
            materialId: materialId || null,
          },
          filterOptions: {
            regionalManagers,
          },
          blocks,
        });
      } catch (e) {
        log.error(`${req.method} ${req.originalUrl}: ${e?.stack || e?.message || e}`);
        res.status(500).json({ error: '查询库房当日总计失败' });
      }
    }
  );
}
