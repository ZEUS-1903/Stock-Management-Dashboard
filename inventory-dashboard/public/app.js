// app.js — talks to the REST API and renders the dashboard.
const $ = (sel) => document.querySelector(sel);
const api = (url, opts = {}) =>
  fetch(url, { headers: { "Content-Type": "application/json" }, ...opts }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  });

const money = (n) => "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let state = { products: [], warehouseId: 1, modalProduct: null };

// ---------- auth ----------
async function checkAuth() {
  try {
    const me = await api("/api/me");
    showApp(me);
  } catch {
    showLogin();
  }
}
function showLogin() {
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}
function showApp(me) {
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#who").innerHTML = `Signed in as <strong>${me.username}</strong> (${me.role})`;
  loadAll();
}

async function login() {
  $("#login-error").textContent = "";
  try {
    const me = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#username").value, password: $("#password").value }),
    });
    showApp(me);
  } catch (e) {
    $("#login-error").textContent = e.message;
  }
}
async function logout() {
  await api("/api/logout", { method: "POST" });
  showLogin();
}

// ---------- load + render ----------
async function loadAll() {
  const [summary, products, movements, warehouses] = await Promise.all([
    api("/api/summary"),
    api("/api/products"),
    api("/api/movements"),
    api("/api/warehouses"),
  ]);
  if (warehouses[0]) state.warehouseId = warehouses[0].warehouse_id;
  state.products = products;
  renderCards(summary);
  renderProducts(products);
  renderChart(products);
  renderMovements(movements);
}

function renderCards(s) {
  const cards = [
    { k: "Products", v: s.total_products },
    { k: "Units on hand", v: Number(s.total_units).toLocaleString() },
    { k: "Inventory value", v: money(s.inventory_value) },
    { k: "Low stock", v: s.low_stock_count, alert: s.low_stock_count > 0 },
    { k: "Moves today", v: s.movements_today },
  ];
  $("#cards").innerHTML = cards
    .map((c) => `<div class="card ${c.alert ? "alert" : ""}"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`)
    .join("");
}

function renderProducts(products) {
  $("#products-table tbody").innerHTML = products
    .map((p) => {
      const value = money(p.qty_on_hand * p.unit_price);
      return `<tr class="${p.low_stock ? "low" : ""}">
        <td class="sku">${p.sku}</td>
        <td>${p.name}</td>
        <td><span class="pill ${p.low_stock ? "low" : ""}">${p.category}</span></td>
        <td class="num">${p.qty_on_hand}${p.low_stock ? " ⚠" : ""}</td>
        <td class="num">${p.reorder_level}</td>
        <td class="num">${value}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" data-adjust="${p.product_id}">Adjust</button></td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("[data-adjust]").forEach((b) =>
    b.addEventListener("click", () => openModal(Number(b.dataset.adjust)))
  );
}

function renderChart(products) {
  const max = Math.max(1, ...products.map((p) => p.qty_on_hand));
  $("#chart").innerHTML = products
    .map((p) => {
      const pct = (p.qty_on_hand / max) * 100;
      return `<div class="bar-row">
        <span class="label">${p.sku}</span>
        <div class="bar-track"><div class="bar-fill ${p.low_stock ? "low" : ""}" style="width:${pct}%"></div></div>
        <span class="qty">${p.qty_on_hand}</span>
      </div>`;
    })
    .join("");
}

function renderMovements(moves) {
  if (!moves.length) {
    $("#movements").innerHTML = `<li class="muted" style="padding:1rem 1.1rem">No movements yet.</li>`;
    return;
  }
  $("#movements").innerHTML = moves
    .map(
      (m) => `<li>
        <span><span class="mv-tag ${m.movement_type}">${m.movement_type}</span> ${m.sku} ${m.name}</span>
        <span class="mv-meta">${m.qty} · ${m.moved_at} · ${m.moved_by || "—"}</span>
      </li>`
    )
    .join("");
}

// ---------- adjust modal ----------
function openModal(productId) {
  const p = state.products.find((x) => x.product_id === productId);
  state.modalProduct = p;
  $("#modal-title").textContent = `Adjust ${p.name}`;
  $("#modal-product").textContent = `${p.sku} · on hand: ${p.qty_on_hand}`;
  $("#modal-qty").value = 1;
  $("#modal-error").textContent = "";
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  state.modalProduct = null;
}
async function submitMovement(type) {
  const p = state.modalProduct;
  const qty = parseInt($("#modal-qty").value, 10);
  $("#modal-error").textContent = "";
  try {
    await api(`/api/stock/${type === "RECEIVE" ? "receive" : "ship"}`, {
      method: "POST",
      body: JSON.stringify({ product_id: p.product_id, warehouse_id: state.warehouseId, qty }),
    });
    closeModal();
    loadAll();
  } catch (e) {
    $("#modal-error").textContent = e.message;
  }
}

// ---------- wiring ----------
$("#login-btn").addEventListener("click", login);
$("#password").addEventListener("keydown", (e) => e.key === "Enter" && login());
$("#logout-btn").addEventListener("click", logout);
$("#modal-cancel").addEventListener("click", closeModal);
$("#modal-receive").addEventListener("click", () => submitMovement("RECEIVE"));
$("#modal-ship").addEventListener("click", () => submitMovement("SHIP"));
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

checkAuth();
