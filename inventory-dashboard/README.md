# Stockroom
# Inventory & Stock-Management Dashboard

A small but complete full-stack web app: a relational database, a REST API,
session-based auth, and a dashboard UI — no build step, one command to run.

It's the web front-end to the same domain modeled in the companion
[Oracle SQL projects](#relationship-to-the-oracle-projects): products,
warehouses, stock levels, and a movement ledger.

## Features

- **Login** with hashed passwords and session cookies (two seeded roles).
- **Dashboard summary**: product count, units on hand, total inventory value,
  low-stock count (the card turns amber when anything is below its reorder
  level), and movements logged today.
- **Product table** with current stock, reorder thresholds, and per-row value;
  low-stock rows are flagged.
- **Receive / ship stock** with server-side rules — you cannot ship more than
  is on hand, and every change writes a row to the movement ledger inside a
  transaction.
- **Stock-by-product bar chart** and a **recent-movements** feed.
- **Role-based access**: only `admin` can add new products.

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Database | **SQLite** via Node's built-in `node:sqlite` | A real relational DB with zero native dependencies and no build step |
| API | **Node.js + Express** | Small, standard REST server |
| Auth | **express-session** + **bcryptjs** | Hashed passwords, cookie sessions, pure-JS |
| Frontend | **Vanilla HTML / CSS / JS** | Served statically by Express — nothing to compile |

## Run it

Requires **Node.js 22.5+** (for the built-in SQLite module).

```bash
npm install
npm start
# open http://localhost:3000
```

The database (`inventory.db`) and its seed data are created automatically on
first run. Reset it anytime with `npm run seed`.

**Demo logins:** `admin / admin123` (full access) · `staff / staff123`
(everything except adding products).

## Verified API behavior

These responses were captured by running the server and calling the API:

```
GET  /api/products            (no session)   -> 401  Not logged in
POST /api/login   admin/admin123             -> {"id":1,"username":"admin","role":"admin"}
GET  /api/summary                            -> {"total_products":6,"total_units":377,
                                                 "inventory_value":3508.69,"low_stock_count":3,...}
POST /api/stock/ship   product 3, qty 9999   -> 400  {"error":"Insufficient stock: have 3, need 9999"}
POST /api/stock/receive product 3, qty 100   -> {"ok":true}
GET  /api/summary  (after 50 shipped, 100 received) -> total_units 427, low_stock_count 2
POST /api/login   admin/wrong                -> 401
POST /api/products  (as staff)               -> 403  Admin only
```

## API reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/login` | — | Start a session |
| POST | `/api/logout` | session | End the session |
| GET | `/api/me` | session | Current user |
| GET | `/api/products` | session | Products + current stock + low-stock flag |
| GET | `/api/summary` | session | Dashboard totals |
| GET | `/api/movements` | session | 15 most recent movements |
| GET | `/api/warehouses` | session | Warehouse list |
| POST | `/api/stock/receive` | session | Add stock (`{product_id, warehouse_id, qty}`) |
| POST | `/api/stock/ship` | session | Remove stock; rejects oversell |
| POST | `/api/products` | admin | Add a product |

## Security notes (worth pointing at)

- **Parameterized queries everywhere** — every value is bound with `?`
  placeholders, never string-concatenated, so user input can't be injected
  into SQL.
- **Passwords are bcrypt-hashed**, never stored or compared in plaintext.
- **Business rules are enforced on the server**, inside a transaction, so
  stock and the ledger can't drift apart even if a request fails midway.
- The session secret is read from `SESSION_SECRET` — set a real one in
  production rather than the dev default.

## Moving to PostgreSQL or Oracle

The SQL here is deliberately close to standard. To use a server database you
would swap `db.js` for a `pg` / `oracledb` connection pool and adjust a few
dialect details (identity columns, the `datetime('now')` default, and `?` vs
`$1` / `:1` placeholders). The schema, the joins, and the API stay the same.

## Relationship to the Oracle projects

The schema (warehouses, products, stock, stock_movements) is the same domain
as the companion Oracle `inventory` and `warehouse` scripts. The story:
*designed and prototyped the data model in Oracle PL/SQL, then shipped it as a
running web application.*

## Project structure

```
inventory-dashboard/
├── server.js        Express app + REST API
├── db.js            SQLite schema, seed data, transaction helper
├── public/
│   ├── index.html   Login + dashboard markup
│   ├── styles.css   Styling
│   └── app.js       Frontend logic (fetch + render)
├── package.json
└── README.md
```

## License

MIT
