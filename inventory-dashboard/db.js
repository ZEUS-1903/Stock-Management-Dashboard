// db.js — SQLite database layer.
// The schema mirrors the Oracle inventory/warehouse projects, adapted to
// SQLite. All access goes through better-sqlite3 with PARAMETERIZED queries
// (the ? placeholders), so user input can never be injected into SQL.

const { DatabaseSync } = require("node:sqlite"); // built into Node 22.5+
const bcrypt = require("bcryptjs");
const path = require("path");

const DB_PATH = path.join(__dirname, "inventory.db");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Mimic better-sqlite3's db.transaction(fn): returns a callable that runs fn
// inside BEGIN/COMMIT, rolling back on any error.
db.transaction = (fn) => (...args) => {
  db.exec("BEGIN");
  try {
    const r = fn(...args);
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'staff'
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      warehouse_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      location     TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      sku           TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      category      TEXT NOT NULL,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      unit_price    REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock (
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
      product_id   INTEGER NOT NULL REFERENCES products(product_id),
      qty_on_hand  INTEGER NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
      PRIMARY KEY (warehouse_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      movement_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_id  INTEGER NOT NULL,
      product_id    INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIVE','SHIP')),
      qty           INTEGER NOT NULL CHECK (qty > 0),
      moved_at      TEXT NOT NULL DEFAULT (datetime('now')),
      moved_by      TEXT
    );
  `);
}

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  if (count > 0) return; // already seeded

  const insertUser = db.prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
  );
  insertUser.run("admin", bcrypt.hashSync("admin123", 10), "admin");
  insertUser.run("staff", bcrypt.hashSync("staff123", 10), "staff");

  const wh = db.prepare("INSERT INTO warehouses (name, location) VALUES (?, ?)");
  const wid = wh.run("Main DC", "Boston").lastInsertRowid;

  const prod = db.prepare(
    "INSERT INTO products (sku, name, category, reorder_level, unit_price) VALUES (?, ?, ?, ?, ?)"
  );
  const products = [
    ["SKU-001", "Widget",        "Hardware", 20, 4.99],
    ["SKU-002", "Gadget",        "Hardware", 15, 9.99],
    ["SKU-003", "Gizmo",         "Hardware",  5, 19.99],
    ["SKU-004", "Cable, USB-C",  "Accessory", 30, 7.50],
    ["SKU-005", "eBook License", "Media",    10, 12.00],
    ["SKU-006", "Power Bank",    "Accessory", 12, 29.95],
  ];
  const startStock = [120, 8, 3, 200, 6, 40]; // some intentionally below reorder

  const setStock = db.prepare(
    "INSERT INTO stock (warehouse_id, product_id, qty_on_hand) VALUES (?, ?, ?)"
  );
  const move = db.prepare(
    "INSERT INTO stock_movements (warehouse_id, product_id, movement_type, qty, moved_by) VALUES (?, ?, 'RECEIVE', ?, 'seed')"
  );

  const tx = db.transaction(() => {
    products.forEach((p, i) => {
      const pid = prod.run(...p).lastInsertRowid;
      setStock.run(wid, pid, startStock[i]);
      move.run(wid, pid, startStock[i]);
    });
  });
  tx();
}

if (require.main === module && process.argv.includes("--reseed")) {
  db.exec("DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS stock; DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS warehouses; DROP TABLE IF EXISTS users;");
  initSchema();
  seed();
  console.log("Database reseeded at", DB_PATH);
}

initSchema();
seed();

module.exports = db;
