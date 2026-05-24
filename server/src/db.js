import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.js';

const log = createLogger('nemh.db');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'app.sqlite');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      const rid = result.lastInsertRowid;
      const lastID =
        rid === null || rid === undefined
          ? 0
          : typeof rid === 'bigint'
            ? Number(rid)
            : rid;
      resolve({ lastID, changes: result.changes });
    } catch (err) {
      reject(err);
    }
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(sql);
      resolve(stmt.all(...params));
    } catch (err) {
      reject(err);
    }
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(sql);
      resolve(stmt.get(...params));
    } catch (err) {
      reject(err);
    }
  });
}

export async function initDb() {
  const db = new DatabaseSync(dbPath);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'warehouse',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const userCols = await all(db, 'PRAGMA table_info(users)');
  if (!userCols.some((c) => c.name === 'pd2_user_id')) {
    await run(db, 'ALTER TABLE users ADD COLUMN pd2_user_id INTEGER');
  }
  if (!userCols.some((c) => c.name === 'source')) {
    await run(db, 'ALTER TABLE users ADD COLUMN source TEXT DEFAULT \'local\'');
  }
  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pd2_user_id
     ON users(pd2_user_id) WHERE pd2_user_id IS NOT NULL`
  );

  if (!userCols.some((c) => c.name === 'role')) {
    await run(
      db,
      `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'warehouse'`
    );
    await run(
      db,
      `UPDATE users SET role = 'statistics' WHERE id = (SELECT MIN(id) FROM users)`
    );
  }

  const userCountRow = await get(db, 'SELECT COUNT(*) AS c FROM users');
  const count = Number(userCountRow?.c ?? 0);
  if (count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await run(
      db,
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'statistics')`,
      ['admin', hash]
    );
  }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS purchase_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      unit_price REAL NOT NULL,
      entered_at TEXT NOT NULL,
      market_price_proof TEXT NOT NULL,
      receive_price_proof TEXT NOT NULL,
      description TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_purchase_prices_material ON purchase_prices(material_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_purchase_prices_entered ON purchase_prices(entered_at)'
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS sale_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      unit_price REAL NOT NULL,
      published_at TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_sale_prices_material ON sale_prices(material_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_sale_prices_published ON sale_prices(published_at)'
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  const whCols = await all(db, 'PRAGMA table_info(warehouses)');
  if (!whCols.some((c) => c.name === 'address')) {
    await run(db, 'ALTER TABLE warehouses ADD COLUMN address TEXT');
  }
  if (!whCols.some((c) => c.name === 'updated_at')) {
    await run(db, 'ALTER TABLE warehouses ADD COLUMN updated_at TEXT');
    await run(
      db,
      `UPDATE warehouses SET updated_at = datetime('now') WHERE updated_at IS NULL`
    );
  }
  const whCols2 = await all(db, 'PRAGMA table_info(warehouses)');
  if (!whCols2.some((c) => c.name === 'external_source')) {
    await run(db, 'ALTER TABLE warehouses ADD COLUMN external_source TEXT');
  }
  if (!whCols2.some((c) => c.name === 'external_id')) {
    await run(db, 'ALTER TABLE warehouses ADD COLUMN external_id TEXT');
  }
  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_external
     ON warehouses(external_source, external_id)
     WHERE external_source IS NOT NULL AND external_id IS NOT NULL`
  );
  const whCountRow = await get(db, 'SELECT COUNT(*) AS c FROM warehouses');
  if (Number(whCountRow?.c ?? 0) === 0) {
    await run(db, `INSERT INTO warehouses (code, name) VALUES ('DEF-001', '默认库房')`);
  }

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS inbound_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id),
      material_id INTEGER NOT NULL REFERENCES materials(id),
      weight REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      photo TEXT NOT NULL,
      inbound_at TEXT NOT NULL,
      audit_status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const inboundCols = await all(db, 'PRAGMA table_info(inbound_orders)');
  if (!inboundCols.some((c) => c.name === 'warehouse_id')) {
    await run(
      db,
      `ALTER TABLE inbound_orders ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1`
    );
    await run(db, 'UPDATE inbound_orders SET warehouse_id = 1 WHERE warehouse_id IS NULL');
  }
  const inboundColsAfter = await all(db, 'PRAGMA table_info(inbound_orders)');
  if (!inboundColsAfter.some((c) => c.name === 'reject_reason')) {
    await run(db, 'ALTER TABLE inbound_orders ADD COLUMN reject_reason TEXT');
  }
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_inbound_orders_material ON inbound_orders(material_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_inbound_orders_status ON inbound_orders(audit_status)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_inbound_orders_wh_mat ON inbound_orders(warehouse_id, material_id)'
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS warehouse_material_outbound (
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      material_id INTEGER NOT NULL REFERENCES materials(id),
      actual_weight REAL NOT NULL DEFAULT 0,
      planned_weight REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (warehouse_id, material_id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS outbound_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      material_id INTEGER NOT NULL REFERENCES materials(id),
      planned_weight REAL NOT NULL,
      unit_price REAL NOT NULL,
      actual_weight REAL,
      weighbridge_photo TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_outbound_orders_wh_mat ON outbound_orders(warehouse_id, material_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_outbound_orders_status ON outbound_orders(status)'
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS outbound_fifo_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outbound_order_id INTEGER NOT NULL REFERENCES outbound_orders(id),
      inbound_order_id INTEGER NOT NULL REFERENCES inbound_orders(id),
      planned_weight REAL NOT NULL,
      actual_weight REAL,
      line_no INTEGER NOT NULL,
      UNIQUE(outbound_order_id, line_no)
    )`
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_outbound_fifo_out_id ON outbound_fifo_lines(outbound_order_id)'
  );
  await run(
    db,
    'CREATE INDEX IF NOT EXISTS idx_outbound_fifo_in_id ON outbound_fifo_lines(inbound_order_id)'
  );

  const fifoCols = await all(db, 'PRAGMA table_info(outbound_fifo_lines)');
  if (!fifoCols.some((c) => c.name === 'sub_order_no')) {
    await run(db, 'ALTER TABLE outbound_fifo_lines ADD COLUMN sub_order_no TEXT');
    await run(
      db,
      `UPDATE outbound_fifo_lines SET sub_order_no =
         (SELECT order_no FROM outbound_orders o WHERE o.id = outbound_fifo_lines.outbound_order_id)
         || '-S' || printf('%03d', line_no)
       WHERE sub_order_no IS NULL`
    );
  }

  const matCount = await get(db, 'SELECT COUNT(*) AS c FROM materials');
  if (Number(matCount?.c ?? 0) === 0) {
    /** 收货定价业务当前仅两类品种：电动、新能源（编码可作定价编号展示） */
    const samples = [
      ['DD-001', '电动', '收货定价品种'],
      ['XNY-001', '新能源', '收货定价品种'],
    ];
    for (const [code, name, description] of samples) {
      await run(
        db,
        'INSERT INTO materials (code, name, description) VALUES (?, ?, ?)',
        [code, name, description]
      );
    }
  }

  /** 入库改为自动审核：历史待审核单一次性通过，便于 FIFO 出库 */
  const pendingInbound = await get(
    db,
    `SELECT COUNT(*) AS c FROM inbound_orders WHERE audit_status = 'pending'`
  );
  if (Number(pendingInbound?.c ?? 0) > 0) {
    const mig = await run(
      db,
      `UPDATE inbound_orders SET
         audit_status = 'approved',
         reviewed_at = COALESCE(reviewed_at, datetime('now')),
         updated_at = datetime('now')
       WHERE audit_status = 'pending'`
    );
    log.info(`已将 ${mig.changes} 条待审核入库单自动置为已审核`);
  }

  log.info(`SQLite 已就绪: ${dbPath}`);
  return db;
}

export { run, all, get };
