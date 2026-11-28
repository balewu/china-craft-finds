// China Craft Finds — GitHub Pages + Supabase.
// 只使用 anon / publishable key。不要把 service_role 写进这个文件。
const SUPABASE_URL = "https://zsrezhqfiqguvikyomuv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QbLGurjjxRzDnnJmKxzdKA_RrBCwgRd";

const hasConfig = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_") && !SUPABASE_ANON_KEY.includes("YOUR_");
const db = hasConfig && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null;

const $ = (id) => document.getElementById(id);
const CART_KEY = "ccf-bag";
const STATUSES = ["pending_review", "awaiting_payment", "paid", "arrived", "shipped", "cancelled"];
const STATUS_LABEL = {
  pending_review: "Pending review",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  arrived: "Arrived",
  purchased: "Arrived",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

let products = [];
let productsLoaded = false;
let cart = [];
let currentSession = null;
let iAmAdmin = false;
let activeParent = "All";
let activeChild = "All";
let pickerProductId = null;
let adminTab = "orders";
let adminOrders = [];
let adminProducts = [];
let adminParent = "All";
let adminChild = "All";
let resumeCheckout = false;
const authMode = {};

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
function safeText(value) {
  return String(value ?? "")
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}
const imageOrFallback = (url) => url || "https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=900&q=80";

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function compareName(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base", numeric: true });
}

function labelKey(label) {
  const match = String(label || "").trim().match(/^(\d+)(.*)$/);
  if (!match) return [1e15, String(label || "").toLowerCase()];
  return [Number(match[1]), match[2].toLowerCase()];
}

function compareLabel(a, b) {
  const ka = labelKey(a);
  const kb = labelKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] < kb[1]) return -1;
  if (ka[1] > kb[1]) return 1;
  return 0;
}

function tokens(text) {
  return String(text || "").split(/[\s,，、;；]+/).map((part) => part.trim()).filter(Boolean);
}

function cartTotal() {
  return cart.reduce((sum, line) => sum + line.sku.price_cents * line.quantity, 0);
}

function sortedCartLines() {
  return cart.slice().sort((a, b) => compareName(a.product.name, b.product.name) || compareLabel(a.sku.label_no, b.sku.label_no));
}

function groupByName(lines, nameOf) {
  const groups = [];
  for (const line of lines) {
    const name = nameOf(line);
    const last = groups[groups.length - 1];
    if (!last || last.name !== name) groups.push({ name, lines: [line] });
    else last.lines.push(line);
  }
  return groups;
}

function sortOrderItems(items) {
  return (items || []).slice().sort((a, b) => compareName(a.product_name, b.product_name) || compareLabel(a.label_no || a.sku_code, b.label_no || b.sku_code));
}

function pieceCount(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function formatWhen(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function findSku(skuId) {
  for (const product of products) {
    const sku = product.skus.find((item) => item.id === skuId);
    if (sku) return { product, sku };
  }
  return null;
}

function findSkuLoose(skuId, productName, label) {
  if (skuId) {
    const hit = findSku(skuId);
    if (hit) return hit;
  }
  const product = products.find((item) => item.name === productName);
  if (!product) return null;
  const sku = product.skus.find((item) => String(item.label_no).toLowerCase() === String(label || "").toLowerCase());
  return sku ? { product, sku } : null;
}

function persistCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart.map((line) => ({ skuId: line.sku.id, quantity: line.quantity }))));
}

function restoreCart() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { raw = []; }
  cart = [];
  for (const item of raw) {
    const found = findSku(item.skuId);
    const quantity = Number(item.quantity);
    if (found && quantity > 0) cart.push({ product: found.product, sku: found.sku, quantity: Math.min(50, quantity) });
  }
  persistCart();
}

function addSku(product, sku, qty) {
  const add = Math.min(50, Math.max(1, qty || 1));
  const line = cart.find((item) => item.sku.id === sku.id);
  if (line) line.quantity = Math.min(50, line.quantity + add);
  else cart.push({ product, sku, quantity: add });
  persistCart();
  renderCart();
}

function parentName(product) {
  return product.parent_category || "General";
}

function latestProducts() {
  return products.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 6);
}

function visibleProducts() {
  const query = ($("search").value || "").trim().toLowerCase();
  return products.filter((product) => {
    if (activeParent !== "All" && parentName(product) !== activeParent) return false;
    if (activeChild !== "All" && product.category !== activeChild) return false;
    const blob = `${product.name} ${product.description || ""} ${product.category} ${parentName(product)}`.toLowerCase();
    return blob.includes(query);
  }).sort((a, b) => compareName(a.name, b.name));
}

function serviceFeeCents(kinds, pieces, stores, checks) {
  if (kinds <= 0) return 0;
  const half = Math.max(40,
    24 * Math.max(stores, 0)
    + 5 * Math.max(0, kinds - Math.max(stores, 0))
    + Math.min(20, Math.max(0, pieces - kinds))
    + 16 * Math.max(checks, 0)
  );
  return Math.floor((half * 2 + 12) / 13) * 50;
}

function shopOf(product) {
  const row = Array.isArray(product?.product_sourcing) ? product.product_sourcing[0] : product?.product_sourcing;
  return {
    source_shop: row?.source_shop || product?.source_shop || "",
    needs_verify: !!(row ? row.needs_verify : product?.needs_verify),
  };
}

let quotedFee = 0;
let feeState = "ready";
let feeRequest = 0;

function paintFee(subtotal) {
  const feeText = feeState === "missing" ? "—" : feeState === "loading" ? "…" : money(quotedFee);
  const grandText = feeState === "ready" ? money(subtotal + quotedFee) : feeText === "…" ? "…" : "—";
  for (const ids of [
    ["cart-subtotal", "cart-fee", "cart-grand"],
    ["checkout-subtotal", "checkout-fee", "checkout-grand"],
  ]) {
    const sub = $(ids[0]);
    const fee = $(ids[1]);
    const grand = $(ids[2]);
    if (sub) sub.textContent = money(subtotal);
    if (fee) fee.textContent = feeText;
    if (grand) grand.textContent = grandText;
  }
}

function demoFee(lines) {
  const shops = new Set();
  let checks = 0;
  let pieces = 0;
  for (const line of lines) {
    const name = String(line.product.source_shop || "").trim().toLowerCase();
    shops.add(name || ("product:" + line.product.id));
    if (line.product.needs_verify) checks += 1;
    pieces += line.quantity;
  }
  return serviceFeeCents(lines.length, pieces, shops.size, checks);
}

async function refreshFee() {
  const lines = sortedCartLines();
  const subtotal = cartTotal();
  const request = ++feeRequest;
  if (!lines.length) {
    quotedFee = 0;
    feeState = "ready";
    paintFee(0);
    return;
  }
  if (!db) {
    quotedFee = demoFee(lines);
    feeState = "ready";
    paintFee(subtotal);
    return;
  }
  feeState = "loading";
  paintFee(subtotal);
  const { data, error } = await db.rpc("quote_service_fee", {
    p_items: lines.map((line) => ({ sku_id: line.sku.id, quantity: line.quantity })),
  });
  if (request !== feeRequest) return;
  if (error) {
    quotedFee = 0;
    feeState = "missing";
  } else {
    quotedFee = Number(data) || 0;
    feeState = "ready";
  }
  paintFee(cartTotal());
}

function priceText(cents) {
  return Number(cents) > 0 ? money(cents) : "To be quoted";
}

function priceRange(product) {
  const prices = product.skus.map((sku) => Number(sku.price_cents) || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= 0) return "To be quoted";
  if (min === max) return money(min);
  return `${money(min)} – ${money(max)}`;
}

function thumbButton(url, label) {
  const shown = imageOrFallback(url);
  return `<button type="button" class="thumb-button" data-action="zoom" data-src="${safeText(url || shown)}" aria-label="${safeText(label || "View full image")}"><img src="${safeText(shown)}" alt=""></button>`;
}

function cardHtml(product) {
  return `<article class="product-card">
    <div class="product-image">
      ${thumbButton(product.image_url, product.name)}
      <span class="product-tag">${safeText(product.category)}</span>
    </div>
    <div class="product-info">
      <span class="product-category">${safeText(parentName(product))} · ${safeText(product.category)}</span>
      <h3><button type="button" class="text-button" data-action="pick" data-id="${safeText(product.id)}">${safeText(product.name)}</button></h3>
      <div class="product-bottom"><span class="product-price">${priceRange(product)}</span><button type="button" class="add-button" data-action="pick" data-id="${safeText(product.id)}">View</button></div>
    </div>
  </article>`;
}

function renderHome() {
  if (!productsLoaded) return;
  const list = latestProducts();
  $("home-grid").innerHTML = list.length
    ? list.map(cardHtml).join("")
    : '<div class="loading-state">New finds will appear here.</div>';
}

function renderShop() {
  if (!productsLoaded) return;
  const parents = ["All", ...new Set(products.map(parentName))].sort((a, b) => (a === "All" ? -1 : b === "All" ? 1 : compareName(a, b)));
  $("categories").innerHTML = parents.map((name) => `<button type="button" class="category-chip ${activeParent === name ? "selected" : ""}" data-action="parent" data-value="${safeText(name)}">${name === "All" ? "All finds" : safeText(name)}</button>`).join("");
  const childWrap = $("subcategories");
  if (activeParent === "All") {
    childWrap.classList.add("hidden");
    childWrap.innerHTML = "";
  } else {
    const children = ["All", ...new Set(products.filter((product) => parentName(product) === activeParent).map((product) => product.category))].sort((a, b) => (a === "All" ? -1 : b === "All" ? 1 : compareName(a, b)));
    childWrap.classList.remove("hidden");
    childWrap.innerHTML = children.map((name) => `<button type="button" class="category-chip ${activeChild === name ? "selected" : ""}" data-action="child" data-value="${safeText(name)}">${name === "All" ? "All in this group" : safeText(name)}</button>`).join("");
  }
  const list = visibleProducts();
  $("product-grid").innerHTML = list.map(cardHtml).join("");
  $("empty-products").classList.toggle("hidden", list.length > 0);
}

function renderCart() {
  const lines = sortedCartLines();
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  $("cart-count").textContent = String(count);
  $("drawer-count").textContent = `(${count})`;
  if (!lines.length) {
    $("cart-lines").innerHTML = '<p class="muted">Your bag is waiting for a little something.</p>';
  } else {
  const groups = groupByName(lines, (line) => line.product.name);
  $("cart-lines").innerHTML = groups.map((group) => {
    const nos = group.lines.map((line) => line.sku.label_no).join(", ");
    const rows = group.lines.map((line) => `<div class="cart-line">
      ${thumbButton(line.sku.image_url || line.product.image_url, line.sku.variant_name)}
      <div>
        <h4>#${safeText(line.sku.label_no)} ${safeText(line.sku.variant_name)}</h4>
        <p>${priceText(line.sku.price_cents)}</p>
        <div class="qty-controls">
          <button type="button" data-action="qty-dec" data-sku="${safeText(line.sku.id)}" aria-label="Decrease">−</button>
          <span>${line.quantity}</span>
          <button type="button" data-action="qty-inc" data-sku="${safeText(line.sku.id)}" aria-label="Increase">+</button>
        </div>
      </div>
      <button type="button" class="remove-line" data-action="remove-line" data-sku="${safeText(line.sku.id)}">Remove</button>
    </div>`).join("");
    return `<section class="bag-group"><h3>${safeText(group.name)}</h3><p class="nos">${safeText(nos)}</p>${rows}</section>`;
  }).join("");
  }
  refreshFee();
}

function openCart() {
  renderCart();
  $("drawer-backdrop").classList.remove("hidden");
  $("cart-drawer").classList.add("open");
  $("cart-drawer").setAttribute("aria-hidden", "false");
}

function closeCart() {
  $("drawer-backdrop").classList.add("hidden");
  $("cart-drawer").classList.remove("open");
  $("cart-drawer").setAttribute("aria-hidden", "true");
}

function openPicker(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  pickerProductId = productId;
  $("picker-title").textContent = product.name;
  $("detail-kicker").textContent = `${parentName(product)} · ${product.category}`;
  $("detail-price").textContent = priceRange(product);
  $("detail-description").textContent = product.description || "A little find for your next creative project.";
  const src = imageOrFallback(product.image_url);
  $("detail-image").src = src;
  $("detail-image").alt = product.name;
  $("detail-zoom").dataset.src = product.image_url || src;
  $("picker-input").value = "";
  $("picker-error").classList.add("hidden");
  paintChips();
  loadDetailReviews(product);
  $("picker").classList.remove("hidden");
}

function closePicker() {
  $("picker").classList.add("hidden");
  pickerProductId = null;
}

function paintChips() {
  const product = products.find((item) => item.id === pickerProductId);
  if (!product) return;
  const chosen = new Set(tokens($("picker-input").value).map((token) => token.toLowerCase()));
  const skus = product.skus.slice().sort((a, b) => compareLabel(a.label_no, b.label_no));
  $("picker-available").innerHTML = skus.map((sku) => {
    const on = chosen.has(String(sku.label_no).toLowerCase());
    return `<div class="sku-row ${on ? "on" : ""}">
      ${thumbButton(sku.image_url || product.image_url, sku.variant_name)}
      <button type="button" class="sku-main" data-action="chip" data-label="${safeText(sku.label_no)}">
        <strong>#${safeText(sku.label_no)}</strong>
        <span>${safeText(sku.variant_name)}</span>
        <em>${priceText(sku.price_cents)}</em>
      </button>
    </div>`;
  }).join("");
}

function openZoom(src) {
  if (!src) return;
  $("zoom-img").src = src;
  $("lightbox").classList.remove("hidden");
}

function closeZoom() {
  $("lightbox").classList.add("hidden");
  $("zoom-img").removeAttribute("src");
}

async function loadDetailReviews(product) {
  const box = $("detail-reviews");
  if (!box) return;
  const wanted = product.id;
  if (!db) {
    box.innerHTML = '<p class="muted">No shared notes for this piece yet.</p>';
    return;
  }
  box.innerHTML = '<p class="muted">Looking for notes…</p>';
  const { data, error } = await db.rpc("list_public_reviews");
  if (pickerProductId !== wanted) return;
  if (error) {
    box.innerHTML = '<p class="muted">Notes will show here after the new database script has been run.</p>';
    return;
  }
  const rows = (data || []).filter((row) => row.is_product && (row.product_id === product.id || row.product_name === product.name));
  box.innerHTML = rows.length ? rows.map(pieceNote).join("") : '<p class="muted">No shared notes for this piece yet.</p>';
}

function addTypedNumbers(event) {
  event.preventDefault();
  const product = products.find((item) => item.id === pickerProductId);
  const error = $("picker-error");
  if (!product) return;
  const wanted = tokens($("picker-input").value);
  if (!wanted.length) {
    error.textContent = "Type the numbers, separated by spaces. For example: 4 5 7 9";
    error.classList.remove("hidden");
    return;
  }
  const missing = [];
  const added = [];
  for (const token of wanted) {
    const sku = product.skus.find((item) => String(item.label_no).toLowerCase() === token.toLowerCase());
    if (!sku) missing.push(token);
    else {
      addSku(product, sku, 1);
      added.push(sku.label_no);
    }
  }
  if (!added.length) {
    error.textContent = `None of those numbers are on this piece: ${missing.join(", ")}`;
    error.classList.remove("hidden");
    return;
  }
  if (missing.length) {
    $("picker-input").value = missing.join(" ");
    paintChips();
    error.textContent = `Added ${added.join(", ")}. Still not found: ${missing.join(", ")}`;
    error.classList.remove("hidden");
    toast("Added the numbers I could find");
    return;
  }
  closePicker();
  toast("Added to your bag");
}

function openCheckout() {
  if (!cart.length) {
    toast("Add an item to your bag first");
    return;
  }
  closeCart();
  $("order-success").classList.add("hidden");
  $("order-error").classList.add("hidden");
  const authed = !!currentSession;
  $("checkout-auth").classList.toggle("hidden", authed);
  $("checkout-form-wrap").classList.toggle("hidden", !authed);
  $("checkout-kicker").textContent = "Almost there";
  $("checkout-title").textContent = "Send your request";
  $("checkout-subtotal").textContent = money(cartTotal());
  paintFee(cartTotal());
  if (authed) {
    const form = $("order-form");
    if (!form.elements.email.value) form.elements.email.value = currentSession.user.email || "";
  }
  $("checkout-modal").classList.remove("hidden");
}

function closeCheckout() {
  $("checkout-modal").classList.add("hidden");
}

async function submitOrder(event) {
  event.preventDefault();
  const errorEl = $("order-error");
  errorEl.classList.add("hidden");
  if (!db) {
    errorEl.textContent = "This preview is not connected yet.";
    errorEl.classList.remove("hidden");
    return;
  }
  if (!currentSession) return openCheckout();
  if (!cart.length) return;
  const form = event.target;
  const data = new FormData(form);
  const button = $("submit-order");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const { data: result, error } = await db.rpc("submit_order_request", {
      p_customer: {
        full_name: String(data.get("full_name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        country: String(data.get("country") || "").trim(),
        region: String(data.get("region") || "").trim(),
        city: String(data.get("city") || "").trim(),
        postal_code: String(data.get("postal_code") || "").trim(),
        address: String(data.get("address") || "").trim(),
        notes: String(data.get("notes") || "").trim(),
      },
      p_items: sortedCartLines().map((line) => ({ sku_id: line.sku.id, quantity: line.quantity })),
    });
    if (error) throw error;
    cart = [];
    persistCart();
    renderCart();
    form.reset();
    $("checkout-form-wrap").classList.add("hidden");
    $("checkout-auth").classList.add("hidden");
    $("order-success").classList.remove("hidden");
    $("checkout-kicker").textContent = "Request sent";
    $("checkout-title").textContent = "Thank you for choosing me.";
    $("success-number").textContent = result.order_number;
    $("view-order-link").href = `#order/${encodeURIComponent(result.order_number)}`;
  } catch (err) {
    console.error(err);
    errorEl.textContent = err.message || "Something went wrong. Please try again.";
    errorEl.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Submit order request";
  }
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw || raw.includes("access_token") || raw.includes("error=") || raw.startsWith("order") && raw.includes("access_token")) return { name: "home" };
  const parts = raw.split("/").filter(Boolean);
  const name = parts[0] || "home";
  if (name === "order" && parts[1]) return { name: "order", id: decodeURIComponent(parts.slice(1).join("/")) };
  if (["home", "shop", "guide", "feedback", "account", "admin"].includes(name)) return { name };
  return { name: "home" };
}

function showView(name) {
  for (const view of ["home", "shop", "guide", "feedback", "account", "order"]) {
    $("view-" + view).classList.toggle("hidden", view !== name);
  }
}

function applyRoute() {
  const route = parseRoute();
  closeCheckout();
  closePicker();
  closeCart();
  closeZoom();
  const titles = {
    home: "China Craft Finds — Handmade discoveries from China",
    shop: "Shop — China Craft Finds",
    guide: "Before you buy — China Craft Finds",
    feedback: "Feedback — China Craft Finds",
    account: "Account — China Craft Finds",
    order: "Order — China Craft Finds",
    admin: "Admin — China Craft Finds",
  };
  document.title = titles[route.name] || titles.home;
  if (route.name === "admin") {
    $("admin-page").classList.remove("hidden");
    paintAdmin();
    return;
  }
  $("admin-page").classList.add("hidden");
  showView(route.name);
  if (route.name === "home") renderHome();
  if (route.name === "shop") renderShop();
  if (route.name === "feedback") paintFeedback();
  if (route.name === "account") paintAccount();
  if (route.name === "order") paintOrder(route.id);
  window.scrollTo(0, 0);
}

async function refreshSession() {
  if (!db) {
    currentSession = null;
    iAmAdmin = false;
    updateAuthLink();
    return;
  }
  const { data } = await db.auth.getSession();
  currentSession = data.session;
  iAmAdmin = false;
  if (currentSession) {
    const { data: row } = await db.from("admin_users").select("user_id").eq("user_id", currentSession.user.id).maybeSingle();
    iAmAdmin = !!row;
  }
  updateAuthLink();
}

function updateAuthLink() {
  $("account-link").textContent = currentSession ? "Account" : "Sign in";
}

function formError(form, message) {
  const el = form.querySelector(".form-error");
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function toggleAuth(form) {
  authMode[form.id] = authMode[form.id] === "register" ? "signin" : "register";
  const register = authMode[form.id] === "register";
  form.querySelector(".auth-title").textContent = register ? "Create your account." : "Welcome back.";
  form.querySelector('[type="submit"]').textContent = register ? "Register" : "Sign in";
  form.querySelector("[data-action=toggle-auth]").textContent = register ? "Already registered? Sign in" : "Need an account? Register";
  formError(form, "");
}

async function onAuthSubmit(event) {
  event.preventDefault();
  const form = event.target;
  formError(form, "");
  if (!db) return formError(form, "Supabase is not connected in app.js.");
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  const mode = authMode[form.id] || "signin";
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    if (mode === "register") {
      const { data: signed, error } = await db.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (!signed.session) {
        formError(form, "Check your email and confirm the address, then sign in. To skip that step, turn off Confirm email under Authentication → Sign In / Providers → Email.");
        return;
      }
      toast("Account created");
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast("Signed in");
    }
    await refreshSession();
  } catch (err) {
    formError(form, err.message || "Could not sign in.");
  } finally {
    button.disabled = false;
  }
}

async function signOut() {
  if (db) await db.auth.signOut();
  currentSession = null;
  iAmAdmin = false;
  updateAuthLink();
  toast("Signed out");
  if (parseRoute().name === "admin" || parseRoute().name === "account") applyRoute();
}

function paintAccount() {
  const signedIn = !!currentSession;
  $("account-out").classList.toggle("hidden", signedIn);
  $("account-in").classList.toggle("hidden", !signedIn);
  if (!signedIn) return;
  $("account-email").textContent = currentSession.user.email || "";
  loadMyOrders();
}

async function loadMyOrders() {
  const box = $("account-orders");
  const errorEl = $("account-error");
  errorEl.classList.add("hidden");
  if (!db || !currentSession) return;
  box.innerHTML = '<p class="muted">Loading your orders…</p>';
  let { data, error } = await db.from("orders")
    .select("id,order_number,created_at,total_cents,service_fee_cents,status,order_items(quantity)")
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: false });
  if (error && /service_fee_cents/.test(error.message || "")) {
    const again = await db.from("orders")
      .select("id,order_number,created_at,total_cents,status,order_items(quantity)")
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: false });
    data = (again.data || []).map((order) => ({ ...order, service_fee_cents: 0 }));
    error = again.error;
  }
  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
    box.innerHTML = "";
    return;
  }
  if (!data.length) {
    box.innerHTML = '<p class="empty-note">No requests yet. When you send one, it will live here.</p>';
    return;
  }
  box.innerHTML = data.map((order) => `<article class="record">
    <div class="record-top">
      <div>
        <p class="eyebrow">${safeText(formatWhen(order.created_at))}</p>
        <h3>${safeText(order.order_number)}</h3>
      </div>
      <span class="status-pill">${safeText(STATUS_LABEL[order.status] || order.status)}</span>
    </div>
    <dl class="stat-row">
      <div><dt>Pieces</dt><dd>${pieceCount(order.order_items)}</dd></div>
      <div><dt>Item subtotal</dt><dd>${money(order.total_cents)}</dd></div>
      <div><dt>Service fee</dt><dd>${money(order.service_fee_cents || 0)}</dd></div>
      <div><dt>Status</dt><dd>${safeText(STATUS_LABEL[order.status] || order.status)}</dd></div>
    </dl>
    <div class="row-actions">
      <a class="secondary-button" href="#order/${encodeURIComponent(order.order_number)}">View order</a>
      ${order.status === "pending_review" ? `<button type="button" class="secondary-button" data-action="cancel-order" data-number="${safeText(order.order_number)}">Cancel request</button>` : ""}
    </div>
  </article>`).join("");
}

async function cancelOrder(orderNumber) {
  if (!confirm("Cancel this request? You can only do this while it is still pending review.")) return;
  const { error } = await db.rpc("cancel_my_order", { p_order_number: orderNumber });
  if (error) {
    toast(error.message);
    return;
  }
  toast("Request cancelled");
  if (parseRoute().name === "account") loadMyOrders();
  if (parseRoute().name === "order") paintOrder(orderNumber);
}

function addressBlock(order) {
  return `${safeText(order.full_name)}<br>${safeText(order.address)}<br>${safeText(order.city)}${order.region ? ", " + safeText(order.region) : ""} ${safeText(order.postal_code)}<br>${safeText(order.country)}<br>${safeText(order.phone)} · ${safeText(order.email)}`;
}

function itemsHtml(items, canReorder, reviewCtx) {
  const sorted = sortOrderItems(items);
  const groups = groupByName(sorted, (item) => item.product_name);
  return groups.map((group) => {
    const nos = group.lines.map((item) => item.label_no || item.sku_code).join(", ");
    const rows = group.lines.map((item) => `<div class="item-block">
      <div class="item-row">
        ${thumbButton(item.image_url, item.variant_name)}
        <div>
          <strong>#${safeText(item.label_no || item.sku_code)}</strong> ${safeText(item.variant_name)}
          <p class="muted">${safeText(item.sku_code)} · × ${item.quantity} · ${money(item.line_total_cents)}</p>
        </div>
        ${canReorder ? `<button type="button" class="secondary-button" data-action="reorder" data-sku="${safeText(item.sku_id || "")}" data-product="${safeText(item.product_name)}" data-label="${safeText(item.label_no || item.sku_code)}">Add to bag</button>` : ""}
      </div>
      ${itemReviewHtml(item, reviewCtx)}
    </div>`).join("");
    return `<h3 class="group-name">${safeText(group.name)}</h3><p class="nos">${safeText(nos)}</p>${rows}`;
  }).join("");
}

function itemReviewHtml(item, ctx) {
  if (!ctx || !ctx.enabled) return "";
  const existing = (ctx.reviews || []).find((review) => review.order_item_id === item.id);
  if (existing) {
    return `<p class="review-mine">Your note: ${safeText(existing.body)}${existing.is_public ? " · shared" : " · only you can see this until I share it"}</p>`;
  }
  return `<form class="order-form review-form" data-number="${safeText(ctx.orderNumber)}" data-item="${safeText(item.id)}">
    <label>A note about this piece<textarea name="body" required minlength="2" maxlength="1000" rows="2" placeholder="How did this one work for you?"></textarea></label>
    <button class="secondary-button" type="submit">Send this note</button>
    <p class="form-error hidden"></p>
  </form>`;
}

function orderReviewHtml(order, reviews) {
  if (order.status !== "shipped") return "";
  const existing = (reviews || []).find((review) => !review.order_item_id);
  if (existing) {
    return `<section class="review-block"><h3 class="group-name">Your note on this order</h3><p class="review-mine">${safeText(existing.body)}${existing.is_public ? " · shared" : " · only you can see this until I share it"}</p></section>`;
  }
  return `<form class="order-form review-form" data-number="${safeText(order.order_number)}">
    <h3 class="group-name">A note about this order</h3>
    <p class="muted">Your name is not shown. I will read it first, and only share it if you are comfortable with that — I decide what appears on the feedback page.</p>
    <label>Your note<textarea name="body" required minlength="2" maxlength="1000" rows="3" placeholder="How did the order go?"></textarea></label>
    <button class="secondary-button" type="submit">Send order note</button>
    <p class="form-error hidden"></p>
  </form>`;
}

function statusNote(order) {
  if (order.status === "arrived" && order.address_confirmed) return "Address confirmed. Postage is below — if it says pending calculation, I am still weighing the parcel.";
  const notes = {
    pending_review: "I have not reviewed this yet. You can still cancel it.",
    awaiting_payment: "I have checked the goods. Please pay the amount I send you for the items. Shipping is later.",
    paid: "Payment for the goods is in. I will buy them and wait until they reach me.",
    arrived: "The goods are with me. Please confirm your address so I can measure postage. If it stays unconfirmed, I will not pack the parcel or continue.",
    shipped: "The parcel has been posted. I send it within five days after postage is paid. Customs and the carrier take their own time after that.",
    cancelled: "This request was cancelled.",
  };
  return notes[order.status] || "";
}

async function paintOrder(orderNumber) {
  const root = $("order-root");
  if (!currentSession) {
    root.innerHTML = `<div class="page-narrow"><p class="eyebrow">YOUR ORDER</p><h2 class="auth-title">Please sign in.</h2><p class="muted">Order details stay with the account that sent the request.</p><p><a class="primary-button" href="#account">Sign in or register</a></p></div>`;
    return;
  }
  root.innerHTML = '<p class="muted">Opening this order…</p>';
  let { data, error } = await db.from("orders").select("*, order_items(*), reviews(id,order_item_id,body,is_public,product_name,label_no,variant_name,image_url)").eq("order_number", orderNumber).maybeSingle();
  if (error && /review|relationship|schema cache/i.test(error.message || "")) {
    const again = await db.from("orders").select("*, order_items(*)").eq("order_number", orderNumber).maybeSingle();
    data = again.data;
    error = again.error;
    if (data) data.reviews = [];
  }
  if (error || !data) {
    root.innerHTML = `<div class="page-narrow"><h2 class="auth-title">This order is not available.</h2><p class="muted">${safeText(error?.message || "Sign in with the account that placed it.")}</p></div>`;
    return;
  }
  const mine = data.user_id === currentSession.user.id;
  const showPostage = data.address_confirmed || data.status === "shipped";
  const postage = data.shipping_cents === null || data.shipping_cents === undefined ? "Pending calculation" : money(data.shipping_cents);
  const confirmForm = mine && data.status === "arrived" && !data.address_confirmed
    ? `<form id="confirm-address-form" class="order-form" data-number="${safeText(data.order_number)}">
        <div class="warn">Please confirm this address. If it stays unconfirmed, I will not pack the parcel or continue with postage. You can correct it before confirming. ♡</div>
        <div class="form-grid">
          <label>Full name *<input name="full_name" required value="${safeText(data.full_name)}"></label>
          <label>Email *<input name="email" type="email" required value="${safeText(data.email)}"></label>
          <label>Phone *<input name="phone" required value="${safeText(data.phone)}"></label>
        </div>
        <label>Country / region *<input name="country" required value="${safeText(data.country)}"></label>
        <label>State / province<input name="region" value="${safeText(data.region || "")}"></label>
        <label>Street address *<textarea name="address" required rows="3">${safeText(data.address)}</textarea></label>
        <div class="form-grid">
          <label>City *<input name="city" required value="${safeText(data.city || "")}"></label>
          <label>ZIP / postal code *<input name="postal_code" required value="${safeText(data.postal_code)}"></label>
        </div>
        <button class="primary-button" type="submit">Confirm this address</button>
        <p class="form-error hidden"></p>
      </form>`
    : `<div class="address-card">${addressBlock(data)}${data.address_confirmed ? '<p class="muted">Address confirmed.</p>' : ""}</div>`;
  const reviews = data.reviews || [];
  const reviewCtx = mine && data.status === "shipped" ? { enabled: true, orderNumber: data.order_number, reviews } : null;
  root.innerHTML = `<div class="page-narrow">
    <p class="eyebrow">ORDER ${safeText(formatWhen(data.created_at))}</p>
    <div class="record-top"><h2 class="auth-title">${safeText(data.order_number)}</h2><span class="status-pill">${safeText(STATUS_LABEL[data.status] || data.status)}</span></div>
    <p class="status-note">${safeText(statusNote(data))}</p>
    ${data.status === "shipped" ? `<p class="tracking">Tracking number: <strong>${safeText(data.tracking_number || "Not added yet")}</strong></p>` : ""}
    ${mine ? orderReviewHtml(data, reviews) : ""}
    <h3 class="group-name">Deliver to</h3>
    ${confirmForm}
    ${showPostage ? `<div class="subtotal-row postage-row"><span>Postage</span><strong>${postage}</strong></div>` : ""}
    <div class="subtotal-row"><span>Item subtotal</span><strong>${money(data.total_cents)}</strong></div>
    <div class="subtotal-row"><span>Service fee</span><strong>${money(data.service_fee_cents || 0)}</strong></div>
    <div class="subtotal-row grand"><span>Goods total</span><strong>${money(Number(data.total_cents || 0) + Number(data.service_fee_cents || 0))}</strong></div>
    ${data.notes ? `<p class="muted">Note: ${safeText(data.notes)}</p>` : ""}
    ${itemsHtml(data.order_items, mine, reviewCtx)}
    <div class="row-actions">
      <a class="secondary-button" href="#shop">Back to the shop</a>
      ${mine && data.status === "pending_review" ? `<button type="button" class="secondary-button" data-action="cancel-order" data-number="${safeText(data.order_number)}">Cancel request</button>` : ""}
    </div>
  </div>`;
}

async function confirmAddress(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  formError(form, "");
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await db.rpc("confirm_order_address", {
      p_order_number: form.dataset.number,
      p_address: {
        full_name: String(data.get("full_name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        country: String(data.get("country") || "").trim(),
        region: String(data.get("region") || "").trim(),
        city: String(data.get("city") || "").trim(),
        postal_code: String(data.get("postal_code") || "").trim(),
        address: String(data.get("address") || "").trim(),
      },
    });
    if (error) throw error;
    toast("Address confirmed");
    paintOrder(form.dataset.number);
  } catch (err) {
    formError(form, err.message || "Could not confirm the address.");
    button.disabled = false;
  }
}

function reorder(button) {
  const found = findSkuLoose(button.dataset.sku, button.dataset.product, button.dataset.label);
  if (!found) {
    toast("That variation is no longer in the shop.");
    return;
  }
  addSku(found.product, found.sku, 1);
  toast("Added to your bag");
}

async function loadShop() {
  if (!db) {
    products = demoProducts();
    productsLoaded = true;
    restoreCart();
    renderCart();
    renderHome();
    if (parseRoute().name === "shop") renderShop();
    toast("Preview mode: connect Supabase before taking real requests");
    return;
  }
  let { data, error } = await db.from("products")
    .select("id,name,description,category,parent_category,image_url,created_at,skus(id,sku_code,label_no,variant_name,price_cents,image_url,active)")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error && /label_no|parent_category|column/.test(error.message || "")) {
    const legacy = await db.from("products")
      .select("id,name,description,category,image_url,created_at,skus(id,sku_code,variant_name,price_cents,active)")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (!legacy.error) {
      data = (legacy.data || []).map((product) => ({
        ...product,
        parent_category: "General",
        skus: (product.skus || []).map((sku) => ({ ...sku, label_no: sku.sku_code, image_url: null })),
      }));
      error = null;
    }
  }
  if (error) {
    console.error(error);
    const message = `${error.message} If you just updated the site, run the new supabase.sql in the Supabase SQL editor, then refresh.`;
    $("home-grid").innerHTML = `<div class="loading-state">${safeText(message)}</div>`;
    $("product-grid").innerHTML = `<div class="loading-state">${safeText(message)}</div>`;
    return;
  }
  products = (data || []).map((product) => ({
    ...product,
    skus: (product.skus || []).filter((sku) => sku.active !== false),
  })).filter((product) => product.skus.length);
  productsLoaded = true;
  restoreCart();
  renderCart();
  renderHome();
  if (parseRoute().name === "shop") renderShop();
}

function paintAdmin() {
  const guest = !currentSession;
  const denied = !!currentSession && !iAmAdmin;
  const ok = !!currentSession && iAmAdmin;
  $("admin-guest").classList.toggle("hidden", !guest);
  $("admin-denied").classList.toggle("hidden", !denied);
  $("admin-dashboard").classList.toggle("hidden", !ok);
  $("admin-logout").classList.toggle("hidden", guest);
  if (denied) $("admin-denied-email").textContent = currentSession.user.email || "";
  if (ok) loadAdminTab();
}

function switchAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll(".admin-tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("admin-orders").classList.toggle("hidden", tab !== "orders");
  $("admin-products").classList.toggle("hidden", tab !== "products");
  $("admin-reviews").classList.toggle("hidden", tab !== "reviews");
  $("admin-alerts").classList.toggle("hidden", tab !== "alerts");
  $("product-editor").classList.add("hidden");
  $("admin-order-detail").classList.add("hidden");
  $("orders-list").classList.remove("hidden");
  loadAdminTab();
}

function loadAdminTab() {
  if (adminTab === "orders") loadAdminOrders();
  else if (adminTab === "products") loadAdminProducts();
  else if (adminTab === "reviews") loadAdminReviews();
  else loadSettings();
}

async function loadAdminOrders() {
  const { data, error } = await db.from("orders")
    .select("id,order_number,created_at,full_name,email,phone,country,region,city,postal_code,address,notes,total_cents,shipping_cents,status,tracking_number,address_confirmed,user_id,order_items(id,sku_id,product_name,sku_code,label_no,variant_name,image_url,quantity,unit_price_cents,line_total_cents)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    $("orders-list").textContent = error.message;
    return;
  }
  adminOrders = data || [];
  if (!adminOrders.length) {
    $("orders-list").innerHTML = '<p class="muted">No order requests yet.</p>';
    return;
  }
  $("orders-list").innerHTML = adminOrders.map((order) => `<article class="record">
    <div class="record-top">
      <div>
        <p class="eyebrow">${safeText(formatWhen(order.created_at))}</p>
        <h3>${safeText(order.order_number)}</h3>
        <p class="muted">${safeText(order.full_name)} · ${safeText(order.email)} · ${safeText(order.city || "")}, ${safeText(order.country)}</p>
      </div>
      <span class="status-pill">${safeText(STATUS_LABEL[order.status] || order.status)}</span>
    </div>
    <p class="nos">${safeText(sortOrderItems(order.order_items).map((item) => `${item.product_name} ${item.label_no || item.sku_code}`).join(" · "))}</p>
    <div class="record-top">
      <strong>${money(order.total_cents)} + ${money(order.service_fee_cents || 0)} fee</strong>
      <button type="button" class="secondary-button" data-action="open-admin-order" data-id="${safeText(order.id)}">Open</button>
      <button type="button" class="secondary-button danger" data-action="delete-order" data-id="${safeText(order.id)}">Delete</button>
    </div>
  </article>`).join("");
}

function openAdminOrder(id) {
  const order = adminOrders.find((item) => item.id === id);
  if (!order) return;
  $("orders-list").classList.add("hidden");
  const detail = $("admin-order-detail");
  detail.classList.remove("hidden");
  const postage = order.shipping_cents === null || order.shipping_cents === undefined ? "" : (order.shipping_cents / 100).toFixed(2);
  detail.innerHTML = `<div class="modal-head"><div><p class="eyebrow">${safeText(formatWhen(order.created_at))}</p><h2>${safeText(order.order_number)}</h2></div><button type="button" class="icon-button" data-action="back-admin-orders" aria-label="Back">×</button></div>
    <p class="muted">${order.address_confirmed ? "The customer has confirmed this address." : "The customer has not confirmed this address yet."}</p>
    <p class="muted">Item subtotal ${money(order.total_cents)} · Service fee ${money(order.service_fee_cents || 0)} · Goods total ${money(Number(order.total_cents || 0) + Number(order.service_fee_cents || 0))}. Postage is separate.</p>
    ${itemsHtml(order.order_items, false)}
    <form id="admin-order-form" class="order-form" data-id="${safeText(order.id)}">
      <div class="form-grid">
        <label>Status<select name="status" class="status-select">${STATUSES.map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${STATUS_LABEL[status]}</option>`).join("")}</select></label>
        <label>Tracking number<input name="tracking_number" value="${safeText(order.tracking_number || "")}" placeholder="Required when shipped"></label>
        <label>Postage in USD<input name="shipping" inputmode="decimal" value="${postage}" placeholder="Leave blank until weighed"></label>
        <label class="check-label"><input type="checkbox" name="address_confirmed" ${order.address_confirmed ? "checked" : ""}> Address confirmed</label>
        <label>Full name<input name="full_name" required value="${safeText(order.full_name)}"></label>
        <label>Email<input name="email" type="email" required value="${safeText(order.email)}"></label>
        <label>Phone<input name="phone" required value="${safeText(order.phone)}"></label>
        <label>Country<input name="country" required value="${safeText(order.country)}"></label>
        <label>State / province<input name="region" value="${safeText(order.region || "")}"></label>
      </div>
      <label>Street address<textarea name="address" required rows="3">${safeText(order.address)}</textarea></label>
      <div class="form-grid">
        <label>City<input name="city" required value="${safeText(order.city || "")}"></label>
        <label>Postal code<input name="postal_code" required value="${safeText(order.postal_code)}"></label>
      </div>
      <label>Notes<textarea name="notes" rows="2">${safeText(order.notes || "")}</textarea></label>
      <p class="fine-print">Marking shipped needs a tracking number. Leave postage blank until you have weighed the parcel — after the customer confirms the address, they see “Pending calculation” until you fill this in.</p>
      <button class="primary-button" type="submit">Save order</button>
      <button class="secondary-button danger" type="button" data-action="delete-order" data-id="${safeText(order.id)}">Delete this order</button>
      <p class="form-error hidden"></p>
    </form>`;
}

async function saveAdminOrder(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  formError(form, "");
  const status = String(data.get("status"));
  const tracking = String(data.get("tracking_number") || "").trim();
  if (status === "shipped" && tracking.length < 3) {
    formError(form, "Add the tracking number before marking this as shipped.");
    return;
  }
  const shippingRaw = String(data.get("shipping") || "").trim();
  let shipping_cents = null;
  if (shippingRaw !== "") {
    const amount = Number(shippingRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      formError(form, "Postage must be a positive number, or left blank.");
      return;
    }
    shipping_cents = Math.round(amount * 100);
  }
  const existing = adminOrders.find((order) => order.id === form.dataset.id);
  const confirmed = data.get("address_confirmed") === "on";
  const payload = {
    status,
    tracking_number: tracking || null,
    shipping_cents,
    address_confirmed: confirmed,
    address_confirmed_at: confirmed ? (existing?.address_confirmed_at || new Date().toISOString()) : null,
    full_name: String(data.get("full_name") || "").trim(),
    email: String(data.get("email") || "").trim(),
    phone: String(data.get("phone") || "").trim(),
    country: String(data.get("country") || "").trim(),
    region: String(data.get("region") || "").trim(),
    city: String(data.get("city") || "").trim(),
    postal_code: String(data.get("postal_code") || "").trim(),
    address: String(data.get("address") || "").trim(),
    notes: String(data.get("notes") || "").trim(),
  };
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const { error } = await db.from("orders").update(payload).eq("id", form.dataset.id);
  button.disabled = false;
  if (error) {
    formError(form, error.message);
    return;
  }
  toast("Order saved");
  await loadAdminOrders();
  openAdminOrder(form.dataset.id);
}

async function loadAdminProducts() {
  let { data, error } = await db.from("products")
    .select("id,name,description,category,parent_category,image_url,active,created_at,skus(id,sku_code,label_no,variant_name,price_cents,image_url,active),product_sourcing(source_shop,needs_verify)")
    .order("created_at", { ascending: false });
  if (error && /product_sourcing|relationship|schema cache/i.test(error.message || "")) {
    const again = await db.from("products")
      .select("id,name,description,category,parent_category,image_url,active,created_at,skus(id,sku_code,label_no,variant_name,price_cents,image_url,active)")
      .order("created_at", { ascending: false });
    data = again.data;
    error = again.error;
  }
  if (error) {
    $("admin-products-list").textContent = error.message;
    return;
  }
  adminProducts = data || [];
  renderAdminCatalogue();
}

function renderAdminCatalogue() {
  const parents = ["All", ...new Set(adminProducts.map((product) => product.parent_category || "General"))].sort((a, b) => (a === "All" ? -1 : b === "All" ? 1 : compareName(a, b)));
  $("admin-categories").innerHTML = parents.map((name) => `<button type="button" class="category-chip ${adminParent === name ? "selected" : ""}" data-action="admin-parent" data-value="${safeText(name)}">${name === "All" ? "All groups" : safeText(name)}</button>`).join("");
  const childWrap = $("admin-subcategories");
  if (adminParent === "All") {
    childWrap.classList.add("hidden");
    childWrap.innerHTML = "";
  } else {
    const children = ["All", ...new Set(adminProducts.filter((product) => (product.parent_category || "General") === adminParent).map((product) => product.category))].sort((a, b) => (a === "All" ? -1 : b === "All" ? 1 : compareName(a, b)));
    childWrap.classList.remove("hidden");
    childWrap.innerHTML = children.map((name) => `<button type="button" class="category-chip ${adminChild === name ? "selected" : ""}" data-action="admin-child" data-value="${safeText(name)}">${name === "All" ? "All in this group" : safeText(name)}</button>`).join("");
  }
  const query = ($("admin-search").value || "").trim().toLowerCase();
  const list = adminProducts.filter((product) => {
    if (adminParent !== "All" && (product.parent_category || "General") !== adminParent) return false;
    if (adminChild !== "All" && product.category !== adminChild) return false;
    if (!query) return true;
    const skuText = (product.skus || []).map((sku) => `${sku.label_no} ${sku.sku_code} ${sku.variant_name}`).join(" ");
    const shop = shopOf(product);
    return `${product.name} ${product.description || ""} ${product.category} ${product.parent_category || ""} ${shop.source_shop} ${skuText}`.toLowerCase().includes(query);
  });
  $("admin-products-list").innerHTML = list.length ? `<table><thead><tr><th></th><th>Product</th><th>Categories</th><th>Shop</th><th>Numbers</th><th></th></tr></thead><tbody>${list.map((product) => {
    const shop = shopOf(product);
    return `<tr>
    <td class="admin-thumb">${thumbButton(product.image_url, product.name)}</td>
    <td><strong>${safeText(product.name)}</strong><br><small>${product.active ? "Visible" : "Hidden"}</small></td>
    <td>${safeText(product.parent_category || "General")} / ${safeText(product.category)}</td>
    <td>${safeText(shop.source_shop || "—")}${shop.needs_verify ? "<br><small>Check video</small>" : ""}</td>
    <td>${(product.skus || []).filter((sku) => sku.active !== false).sort((a, b) => compareLabel(a.label_no, b.label_no)).map((sku) => `#${safeText(sku.label_no)} · ${safeText(sku.sku_code)} · ${priceText(sku.price_cents)}`).join("<br>")}</td>
    <td class="row-actions">
      <button type="button" class="admin-action" data-action="edit-product" data-id="${safeText(product.id)}">Edit</button>
      <button type="button" class="admin-action danger-text" data-action="delete-product" data-id="${safeText(product.id)}" data-name="${safeText(product.name)}">Delete</button>
    </td>
  </tr>`;
  }).join("")}</tbody></table>` : '<p class="muted">No products in this corner.</p>';
}

function skuLines(product) {
  return (product?.skus || []).filter((sku) => sku.active !== false).sort((a, b) => compareLabel(a.label_no, b.label_no)).map((sku) => {
    const price = (sku.price_cents / 100).toFixed(2);
    const base = `${sku.label_no} | ${sku.sku_code} | ${sku.variant_name} | ${price}`;
    return sku.image_url ? `${base} | ${sku.image_url}` : base;
  }).join("\n");
}

function showProductEditor(product) {
  $("admin-products").classList.add("hidden");
  $("product-editor").classList.remove("hidden");
  $("product-editor-title").textContent = product ? "Edit product" : "Add a product";
  const form = $("product-form");
  form.reset();
  formError(form, "");
  form.elements.product_id.value = product?.id || "";
  form.elements.active.checked = product ? product.active !== false : true;
  if (!product) return;
  form.elements.name.value = product.name || "";
  form.elements.description.value = product.description || "";
  form.elements.parent_category.value = product.parent_category || "General";
  form.elements.category.value = product.category || "";
  form.elements.image_url.value = product.image_url || "";
  form.elements.skus.value = skuLines(product);
  const shop = shopOf(product);
  form.elements.source_shop.value = shop.source_shop;
  form.elements.needs_verify.checked = shop.needs_verify;
}

function parseSkuText(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 4 || parts.length > 5) return { error: `Check this line: ${line}` };
    const [label, sku, variant, price, image] = parts;
    const dollars = Number(price);
    if (!label || !sku || !variant || !Number.isFinite(dollars) || dollars < 0) return { error: `Check this line: ${line}` };
    rows.push({
      label_no: label,
      sku_code: sku,
      variant_name: variant,
      price_cents: Math.round(dollars * 100),
      image_url: image || null,
      active: true,
    });
  }
  if (!rows.length) return { error: "Add at least one variation." };
  const labels = new Set();
  const codes = new Set();
  for (const row of rows) {
    const labelKey = row.label_no.toLowerCase();
    const codeKey = row.sku_code.toLowerCase();
    if (labels.has(labelKey)) return { error: `Duplicate number: ${row.label_no}` };
    if (codes.has(codeKey)) return { error: `Duplicate SKU code: ${row.sku_code}` };
    labels.add(labelKey);
    codes.add(codeKey);
  }
  return { rows };
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.target;
  formError(form, "");
  const data = new FormData(form);
  const parsed = parseSkuText(data.get("skus"));
  if (parsed.error) return formError(form, parsed.error);
  const payload = {
    name: String(data.get("name") || "").trim(),
    description: String(data.get("description") || "").trim(),
    parent_category: String(data.get("parent_category") || "").trim(),
    category: String(data.get("category") || "").trim(),
    image_url: String(data.get("image_url") || "").trim() || null,
    active: data.get("active") === "on",
  };
  if (!payload.parent_category || !payload.category) return formError(form, "Add both a main category and a subcategory.");
  let productId = String(data.get("product_id") || "");
  if (productId) {
    const { error } = await db.from("products").update(payload).eq("id", productId);
    if (error) return formError(form, error.message);
  } else {
    const { data: created, error } = await db.from("products").insert(payload).select("id").single();
    if (error) return formError(form, error.message);
    productId = created.id;
  }
  const { data: existing, error: existingError } = await db.from("skus").select("id,sku_code").eq("product_id", productId);
  if (existingError) return formError(form, existingError.message);
  const keep = new Set(parsed.rows.map((row) => row.sku_code));
  for (const row of parsed.rows) {
    const found = (existing || []).find((sku) => sku.sku_code === row.sku_code);
    if (found) {
      const { error } = await db.from("skus").update(row).eq("id", found.id);
      if (error) return formError(form, error.message);
    } else {
      const { error } = await db.from("skus").insert({ ...row, product_id: productId });
      if (error) return formError(form, error.message);
    }
  }
  const hide = (existing || []).filter((sku) => !keep.has(sku.sku_code)).map((sku) => sku.id);
  if (hide.length) {
    const { error } = await db.from("skus").update({ active: false }).in("id", hide);
    if (error) return formError(form, error.message);
  }
  const { error: shopError } = await db.from("product_sourcing").upsert({
    product_id: productId,
    source_shop: String(data.get("source_shop") || "").trim(),
    needs_verify: data.get("needs_verify") === "on",
  });
  if (shopError) return formError(form, shopError.message + " Run the new supabase.sql if this mentions product_sourcing.");
  toast("Product saved");
  $("product-editor").classList.add("hidden");
  $("admin-products").classList.remove("hidden");
  loadAdminProducts();
  loadShop();
}

async function loadSettings() {
  const { data, error } = await db.from("shop_settings").select("notify_email,webhook_url").eq("id", 1).maybeSingle();
  if (error) {
    formError($("settings-form"), error.message);
    return;
  }
  $("settings-email").value = data?.notify_email || "";
  $("settings-webhook").value = data?.webhook_url || "";
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.target;
  formError(form, "");
  const notify_email = $("settings-email").value.trim();
  const webhook_url = $("settings-webhook").value.trim();
  if (webhook_url && !/^https:\/\/\S+$/.test(webhook_url)) return formError(form, "Webhook must start with https://");
  const { error } = await db.from("shop_settings").update({ notify_email, webhook_url }).eq("id", 1);
  if (error) return formError(form, error.message);
  toast("Alert settings saved");
}

async function sendTestAlert() {
  const { error } = await db.rpc("send_test_alert");
  if (error) toast(error.message);
  else toast("Test sent. Check your inbox, including spam. The first FormSubmit mail may only ask you to confirm.");
}

function demoProducts() {
  const stamp = (days) => new Date(Date.now() - days * 86400000).toISOString();
  return [
    { id: "demo-a", name: "Petal mold sheet", description: "Type the shape numbers — for example 4 5 7 9.", parent_category: "Molds", category: "Floral molds", source_shop: "Petal studio", needs_verify: true, image_url: "https://images.unsplash.com/photo-1493106641515-6b5631de4bb9?auto=format&fit=crop&w=900&q=80", created_at: stamp(0), skus: ["4", "5", "7", "9", "17"].map((n) => ({ id: "demo-a-" + n, sku_code: "PETAL-" + n, label_no: n, variant_name: "Shape " + n, price_cents: 480 + Number(n), image_url: null, active: true })) },
    { id: "demo-b", name: "Clay texture stamps", description: "A second product, so the bag can group by name.", parent_category: "Clay tools", category: "Texture stamps", source_shop: "Clay room", needs_verify: false, image_url: "https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=900&q=80", created_at: stamp(1), skus: ["1", "2", "6", "10", "17"].map((n) => ({ id: "demo-b-" + n, sku_code: "STAMP-" + n, label_no: n, variant_name: "Stamp " + n, price_cents: 640, image_url: null, active: true })) },
    { id: "demo-c", name: "Resin craft tool kit", description: "A handy starter selection.", parent_category: "Tools", category: "Resin tools", source_shop: "Clay room", needs_verify: false, image_url: "https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=900&q=80", created_at: stamp(2), skus: [{ id: "demo-c-1", sku_code: "TOOL-SET", label_no: "1", variant_name: "Basic kit", price_cents: 1290, image_url: null, active: true }] },
  ];
}

function pieceNote(row) {
  return `<article class="record note-card">
    <div class="note-piece">
      ${thumbButton(row.image_url, row.variant_name || row.product_name)}
      <div>
        <h3>${safeText(row.product_name || "A piece")}</h3>
        <p class="nos">#${safeText(row.label_no || "")} ${safeText(row.variant_name || "")}</p>
      </div>
    </div>
    <p>${safeText(row.body)}</p>
    <p class="muted">${safeText(formatWhen(row.created_at))} · from a customer</p>
  </article>`;
}

function orderNote(row) {
  return `<article class="record note-card">
    <p>${safeText(row.body)}</p>
    <p class="muted">${safeText(formatWhen(row.created_at))} · from a customer</p>
  </article>`;
}

async function paintFeedback() {
  const root = $("feedback-root");
  if (!db) {
    root.innerHTML = '<p class="empty-note">Notes will appear here once the shop is connected.</p>';
    return;
  }
  root.innerHTML = '<p class="muted">Gathering notes…</p>';
  const { data, error } = await db.rpc("list_public_reviews");
  if (error) {
    root.innerHTML = `<p class="form-error">${safeText(error.message)} Run the new supabase.sql in the Supabase SQL editor, then refresh.</p>`;
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    root.innerHTML = '<p class="empty-note">No shared notes yet.</p>';
    return;
  }
  const orders = rows.filter((row) => !row.is_product);
  const pieces = rows.filter((row) => row.is_product);
  const block = (title, html) => `<section class="note-section"><h2>${title}</h2>${html || '<p class="muted">None shared yet.</p>'}</section>`;
  root.innerHTML = block("About the orders", orders.map(orderNote).join("")) + block("About the pieces", pieces.map(pieceNote).join(""));
}

async function submitReview(event) {
  event.preventDefault();
  const form = event.target;
  formError(form, "");
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await db.rpc("submit_review", {
      p_order_number: form.dataset.number,
      p_item_id: form.dataset.item || null,
      p_body: String(new FormData(form).get("body") || "").trim(),
    });
    if (error) throw error;
    toast("Note saved. Only you can see it until I choose to share it.");
    paintOrder(form.dataset.number);
  } catch (err) {
    formError(form, err.message || "Could not save that note.");
    button.disabled = false;
  }
}

async function loadAdminReviews() {
  const box = $("admin-reviews-list");
  const { data, error } = await db.from("reviews")
    .select("id,body,is_public,created_at,product_name,label_no,variant_name,image_url,order_item_id")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    box.textContent = error.message;
    return;
  }
  if (!data?.length) {
    box.innerHTML = '<p class="muted">No notes yet.</p>';
    return;
  }
  box.innerHTML = data.map((row) => `<article class="record note-card">
    <div class="record-top">
      <p class="eyebrow">${row.order_item_id ? "Piece" : "Order"} · ${safeText(formatWhen(row.created_at))}</p>
      <span class="status-pill">${row.is_public ? "Shared" : "Private"}</span>
    </div>
    ${row.order_item_id ? `<div class="note-piece">${thumbButton(row.image_url, row.variant_name)}<div><h3>${safeText(row.product_name)}</h3><p class="nos">#${safeText(row.label_no)} ${safeText(row.variant_name)}</p></div></div>` : ""}
    <p>${safeText(row.body)}</p>
    <div class="row-actions">
      <button type="button" class="secondary-button" data-action="toggle-review" data-id="${safeText(row.id)}" data-public="${row.is_public ? "1" : "0"}">${row.is_public ? "Hide" : "Share"}</button>
      <button type="button" class="secondary-button danger" data-action="delete-review" data-id="${safeText(row.id)}">Delete</button>
    </div>
  </article>`).join("");
}

async function deleteAdminOrder(order) {
  const label = STATUS_LABEL[order.status] || order.status;
  if (!confirm(`Delete this order?\n\n${order.order_number}\nStatus: ${label}\n\nThis cannot be undone.`)) return;
  const { error } = await db.from("orders").delete().eq("id", order.id);
  if (error) {
    toast(error.message);
    return;
  }
  toast("Order deleted");
  $("admin-order-detail").classList.add("hidden");
  $("orders-list").classList.remove("hidden");
  loadAdminOrders();
}

async function deleteAdminProduct(id, name) {
  if (!confirm(`Delete this product?\n\n${name}\n\nIts numbers will be removed. This cannot be undone.`)) return;
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) {
    toast(error.message);
    return;
  }
  toast("Product deleted");
  loadAdminProducts();
  loadShop();
}

async function toggleReview(id, makePublic) {
  const { error } = await db.from("reviews").update({ is_public: makePublic }).eq("id", id);
  if (error) toast(error.message);
  else {
    toast(makePublic ? "This note is now shared" : "This note is hidden");
    loadAdminReviews();
  }
}

async function deleteReview(id) {
  if (!confirm("Delete this note?\n\nThis cannot be undone.")) return;
  const { error } = await db.from("reviews").delete().eq("id", id);
  if (error) toast(error.message);
  else {
    toast("Note deleted");
    loadAdminReviews();
  }
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "open-cart") openCart();
  else if (action === "close-cart") closeCart();
  else if (action === "close-checkout") closeCheckout();
  else if (action === "go-checkout") openCheckout();
  else if (action === "pick") openPicker(button.dataset.id);
  else if (action === "chip") {
    const input = $("picker-input");
    const list = tokens(input.value);
    const key = button.dataset.label.toLowerCase();
    const index = list.findIndex((token) => token.toLowerCase() === key);
    if (index >= 0) list.splice(index, 1);
    else list.push(button.dataset.label);
    input.value = list.join(" ");
    paintChips();
  } else if (action === "qty-dec" || action === "qty-inc") {
    const line = cart.find((item) => item.sku.id === button.dataset.sku);
    if (!line) return;
    line.quantity += action === "qty-inc" ? 1 : -1;
    if (line.quantity < 1) cart = cart.filter((item) => item.sku.id !== button.dataset.sku);
    else if (line.quantity > 50) line.quantity = 50;
    persistCart();
    renderCart();
  } else if (action === "remove-line") {
    cart = cart.filter((item) => item.sku.id !== button.dataset.sku);
    persistCart();
    renderCart();
  } else if (action === "parent") {
    activeParent = button.dataset.value;
    activeChild = "All";
    renderShop();
  } else if (action === "child") {
    activeChild = button.dataset.value;
    renderShop();
  } else if (action === "admin-parent") {
    adminParent = button.dataset.value;
    adminChild = "All";
    renderAdminCatalogue();
  } else if (action === "admin-child") {
    adminChild = button.dataset.value;
    renderAdminCatalogue();
  } else if (action === "delete-product") deleteAdminProduct(button.dataset.id, button.dataset.name);
  else if (action === "delete-order") {
    const order = adminOrders.find((item) => item.id === button.dataset.id);
    if (order) deleteAdminOrder(order);
  } else if (action === "toggle-review") toggleReview(button.dataset.id, button.dataset.public !== "1");
  else if (action === "delete-review") deleteReview(button.dataset.id);
  else if (action === "toggle-auth") toggleAuth(button.closest("form"));
  else if (action === "need-auth") {
    resumeCheckout = true;
    closeCheckout();
    location.hash = "account";
  } else if (action === "cancel-order") cancelOrder(button.dataset.number);
  else if (action === "reorder") reorder(button);
  else if (action === "close-picker") closePicker();
  else if (action === "zoom") openZoom(button.dataset.src);
  else if (action === "close-zoom") closeZoom();
  else if (action === "admin-tab") switchAdminTab(button.dataset.tab);
  else if (action === "edit-product") showProductEditor(adminProducts.find((product) => product.id === button.dataset.id));
  else if (action === "add-product") showProductEditor(null);
  else if (action === "cancel-editor") {
    $("product-editor").classList.add("hidden");
    $("admin-products").classList.remove("hidden");
  } else if (action === "open-admin-order") openAdminOrder(button.dataset.id);
  else if (action === "back-admin-orders") {
    $("admin-order-detail").classList.add("hidden");
    $("orders-list").classList.remove("hidden");
  } else if (action === "logout") signOut();
  else if (action === "test-alert") sendTestAlert();
}

function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "picker-form") addTypedNumbers(event);
  else if (form.id === "order-form") submitOrder(event);
  else if (form.classList.contains("auth-form")) onAuthSubmit(event);
  else if (form.id === "confirm-address-form") confirmAddress(event);
  else if (form.id === "product-form") saveProduct(event);
  else if (form.id === "admin-order-form") saveAdminOrder(event);
  else if (form.id === "settings-form") saveSettings(event);
  else if (form.classList.contains("review-form")) submitReview(event);
}

function init() {
  $("year").textContent = String(new Date().getFullYear());
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  $("search").addEventListener("input", renderShop);
  $("admin-search").addEventListener("input", () => {
    if (adminProducts.length || adminTab === "products") renderAdminCatalogue();
  });
  $("picker-input").addEventListener("input", paintChips);
  window.addEventListener("hashchange", applyRoute);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("lightbox").classList.contains("hidden")) return closeZoom();
    if (!$("picker").classList.contains("hidden")) return closePicker();
    if (!$("checkout-modal").classList.contains("hidden")) return closeCheckout();
    closeCart();
  });
  const boot = () => {
    loadShop();
    applyRoute();
  };
  if (!db) {
    if (hasConfig && !window.supabase) toast("The shop library did not load. Check your connection and refresh.");
    boot();
    return;
  }
  db.auth.onAuthStateChange((event) => {
    refreshSession().then(() => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && resumeCheckout && currentSession) {
        resumeCheckout = false;
        openCheckout();
        return;
      }
      const route = parseRoute();
      if (route.name === "account" || route.name === "admin" || route.name === "order") applyRoute();
    });
  });
  refreshSession().then(boot);
}

document.addEventListener("DOMContentLoaded", init);
