// server.js — Express REST API over the SQLite database.
// Highlights worth pointing at in an interview:
//   * Every query is parameterized (no string-built SQL) -> injection-safe.
//   * Passwords are bcrypt-hashed; auth is session-cookie based.
//   * Business rules are enforced server-side (you cannot ship more than is
//     on hand), inside a transaction so stock + ledger stay consistent.

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ---- auth helpers ---------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

// ---- auth routes ----------------------------------------------------
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });

  const user = db
    .prepare("SELECT user_id, username, password_hash, role FROM users WHERE username = ?")
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "Invalid credentials" });

  req.session.user = { id: user.user_id, username: user.username, role: user.role };
  res.json(req.session.user);
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => res.json(req.session.user));

// ---- data routes (all require auth) ---------------------------------
app.get("/api/warehouses", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM warehouses ORDER BY warehouse_id").all());
});

// products joined with current stock + a computed low-stock flag
app.get("/api/products", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.product_id, p.sku, p.name, p.category, p.reorder_level, p.unit_price,
              COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
              COALESCE(s.qty_on_hand, 0) < p.reorder_level AS low_stock,
              s.warehouse_id
       FROM products p
       LEFT JOIN stock s ON s.product_id = p.product_id
       ORDER BY p.sku`
    )
    .all();
  res.json(rows);
});

// dashboard summary numbers
app.get("/api/summary", requireAuth, (req, res) => {
  const summary = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM products) AS total_products,
         (SELECT COALESCE(SUM(qty_on_hand),0) FROM stock) AS total_units,
         (SELECT COALESCE(SUM(s.qty_on_hand * p.unit_price),0)
            FROM stock s JOIN products p ON p.product_id = s.product_id) AS inventory_value,
         (SELECT COUNT(*) FROM stock s JOIN products p ON p.product_id = s.product_id
            WHERE s.qty_on_hand < p.reorder_level) AS low_stock_count,
         (SELECT COUNT(*) FROM stock_movements WHERE date(moved_at) = date('now')) AS movements_today`
    )
    .get();
  res.json(summary);
});

app.get("/api/movements", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.movement_id, p.sku, p.name, m.movement_type, m.qty, m.moved_at, m.moved_by
       FROM stock_movements m JOIN products p ON p.product_id = m.product_id
       ORDER BY m.movement_id DESC LIMIT 15`
    )
    .all();
  res.json(rows);
});

// receive or ship stock — the core write operation
function applyMovement(type) {
  return (req, res) => {
    const { product_id, warehouse_id, qty } = req.body || {};
    const q = Number(qty);
    if (!product_id || !warehouse_id || !Number.isInteger(q) || q <= 0)
      return res.status(400).json({ error: "product_id, warehouse_id and a positive integer qty are required" });

    try {
      const tx = db.transaction(() => {
        const row = db
          .prepare("SELECT qty_on_hand FROM stock WHERE warehouse_id = ? AND product_id = ?")
          .get(warehouse_id, product_id);
        const current = row ? row.qty_on_hand : 0;

        if (type === "SHIP" && current < q)
          throw new Error(`Insufficient stock: have ${current}, need ${q}`);

        const newQty = type === "RECEIVE" ? current + q : current - q;

        if (row) {
          db.prepare("UPDATE stock SET qty_on_hand = ? WHERE warehouse_id = ? AND product_id = ?")
            .run(newQty, warehouse_id, product_id);
        } else {
          db.prepare("INSERT INTO stock (warehouse_id, product_id, qty_on_hand) VALUES (?, ?, ?)")
            .run(warehouse_id, product_id, newQty);
        }

        db.prepare(
          "INSERT INTO stock_movements (warehouse_id, product_id, movement_type, qty, moved_by) VALUES (?, ?, ?, ?, ?)"
        ).run(warehouse_id, product_id, type, q, req.session.user.username);
      });
      tx();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}

app.post("/api/stock/receive", requireAuth, applyMovement("RECEIVE"));
app.post("/api/stock/ship", requireAuth, applyMovement("SHIP"));

// add a new product (admin only)
app.post("/api/products", requireAuth, (req, res) => {
  if (req.session.user.role !== "admin")
    return res.status(403).json({ error: "Admin only" });
  const { sku, name, category, reorder_level, unit_price } = req.body || {};
  if (!sku || !name || !category)
    return res.status(400).json({ error: "sku, name and category are required" });
  try {
    const info = db
      .prepare("INSERT INTO products (sku, name, category, reorder_level, unit_price) VALUES (?, ?, ?, ?, ?)")
      .run(sku, name, category, Number(reorder_level) || 10, Number(unit_price) || 0);
    res.json({ ok: true, product_id: Number(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: e.message.includes("UNIQUE") ? "SKU already exists" : e.message });
  }
});

app.listen(PORT, () => console.log(`Inventory dashboard running at http://localhost:${PORT}`));
