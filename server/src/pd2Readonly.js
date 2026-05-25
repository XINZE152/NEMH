import { getPd2Pool, isPd2MysqlEnabled } from './pd2Auth.js';
import { createLogger } from './logger.js';

const log = createLogger('nemh.pd2Readonly');

const DEFAULT_LOOKBACK_DAYS = 180;

/**
 * PD2 送货历史：按库房全称取近 N 天条数最多的大区经理。
 * @returns {Promise<Map<string, string>>} warehouse name -> regional_manager
 */
export async function fetchRegionalManagerMapFromPd2(lookbackDays = DEFAULT_LOOKBACK_DAYS) {
  if (!isPd2MysqlEnabled()) {
    throw new Error('未配置 PD2 MySQL（PD2_AUTH_ENABLED 或 PD2_MYSQL_HOST）');
  }
  const days = Math.max(1, Math.min(730, Number(lookbackDays) || DEFAULT_LOOKBACK_DAYS));
  const pool = getPd2Pool();
  const [rows] = await pool.query(
    `SELECT warehouse, regional_manager, cnt, last_date
     FROM (
       SELECT warehouse,
              regional_manager,
              COUNT(*) AS cnt,
              MAX(delivery_date) AS last_date
       FROM pd_ip_delivery_records
       WHERE delivery_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY warehouse, regional_manager
     ) t
     ORDER BY warehouse ASC, cnt DESC, last_date DESC`,
    [days]
  );

  const map = new Map();
  for (const row of rows) {
    const wh = String(row.warehouse || '').trim();
    const rm = String(row.regional_manager || '').trim();
    if (!wh || !rm) continue;
    if (!map.has(wh)) map.set(wh, rm);
  }
  log.info(`PD2 大区经理映射: ${map.size} 个库房（近 ${days} 天送货历史）`);
  return map;
}

/**
 * 库房运费（元/吨）：优先金利冶炼厂 freight_rates，否则 dict_warehouses.freight_amount。
 */
export async function fetchPd2FreightPerTon(pd2WarehouseId, asOfDate) {
  if (!isPd2MysqlEnabled() || !pd2WarehouseId) return null;
  const pool = getPd2Pool();
  const dateStr =
    asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate).slice(0, 10))
      ? String(asOfDate).slice(0, 10)
      : null;

  const [factories] = await pool.query(
    `SELECT id FROM dict_factories
     WHERE is_active = 1 AND name LIKE '%金利%'
     ORDER BY id ASC LIMIT 1`
  );
  const factoryId = factories[0]?.id;
  if (factoryId && dateStr) {
    const [fr] = await pool.query(
      `SELECT price_per_ton AS pricePerTon
       FROM freight_rates
       WHERE factory_id = ? AND warehouse_id = ?
         AND effective_date <= ?
       ORDER BY effective_date DESC, id DESC
       LIMIT 1`,
      [factoryId, pd2WarehouseId, dateStr]
    );
    if (fr[0]?.pricePerTon != null) {
      return Number(fr[0].pricePerTon);
    }
  }

  const [wh] = await pool.query(
    `SELECT freight_amount AS freightAmount
     FROM dict_warehouses WHERE id = ? AND is_active = 1 LIMIT 1`,
    [pd2WarehouseId]
  );
  const fa = wh[0]?.freightAmount;
  return fa != null ? Number(fa) : null;
}

/**
 * 对标参考价：pd_warehouse_spread_configs.warehouse_price 或省份对标价。
 */
export async function fetchPd2BenchmarkReference(pd2WarehouseId, asOfDate) {
  if (!isPd2MysqlEnabled() || !pd2WarehouseId) return null;
  const pool = getPd2Pool();
  const dateStr =
    asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate).slice(0, 10))
      ? String(asOfDate).slice(0, 10)
      : null;

  const [spread] = await pool.query(
    `SELECT warehouse_price AS warehousePrice
     FROM pd_warehouse_spread_configs
     WHERE warehouse_id = ? LIMIT 1`,
    [pd2WarehouseId]
  );
  if (spread[0]?.warehousePrice != null) {
    return Number(spread[0].warehousePrice);
  }

  if (!dateStr) return null;
  const [whRow] = await pool.query(
    `SELECT province FROM dict_warehouses WHERE id = ? LIMIT 1`,
    [pd2WarehouseId]
  );
  const province = String(whRow[0]?.province || '').trim();
  if (!province) return null;

  const [bench] = await pool.query(
    `SELECT benchmark_price AS benchmarkPrice
     FROM pd_province_benchmark_prices
     WHERE province = ? AND price_date <= ?
     ORDER BY price_date DESC, id DESC
     LIMIT 1`,
    [province, dateStr]
  );
  return bench[0]?.benchmarkPrice != null ? Number(bench[0].benchmarkPrice) : null;
}
