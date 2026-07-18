// QFM concept store — catalog-driven cards + shared cart + mock checkout.
// Prices come ONLY from the live catalog the office saves on /qfm/config —
// there is deliberately NO baked-in fallback catalog: showing build-time
// prices when the relay was slow/down is how "phantom price changes"
// happened. If the live catalog can't load, the shop says so and offers
// Retry instead of showing stale numbers. Demo only: no payments.
const CART_KEY = 'qfmCart.v1';
const RELAY = 'https://dlerhetal.pythonanywhere.com/qfm-api';
const ZONES = [["Las Cruces / Mesilla", 35], ["Do\u00f1a Ana", 45], ["El Paso", 75], ["Deming", 85], ["Truth or Consequences", 95], ["Elephant Butte", 95]];
const SAMPLE_SHIP = 14.95;
const LANE_BADGE = {SHIP: ['badge-ship', 'Ships Nationwide'],
                    LOCAL: ['badge-local', 'Local Delivery / Pickup'],
                    PICKUP: ['badge-pickup', 'Yard Pickup']};

let CATALOG = null;              // live catalog only — never a baked copy
let catalogState = 'loading';    // 'loading' | 'ready' | 'failed'
let PRODUCTS = {};
function rebuildProducts(){
  PRODUCTS = {};
  if (!CATALOG) return;
  CATALOG.products.forEach(function(p){ PRODUCTS[p.id] = p; });
}

let cart = {};
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch (e) { cart = {}; }

function saveCart(){ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function money(x){ return '$' + x.toFixed(2).replace(/\.00$/,''); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// cart items snapshot name/lane at add time so edits/hides on the config page
// never orphan a cart row
function itemName(i){ return i.name || (PRODUCTS[i.id] ? PRODUCTS[i.id].name : 'Item'); }
function itemLane(i){ return i.lane || (PRODUCTS[i.id] ? PRODUCTS[i.id].lane : 'LOCAL'); }

/* ------------------------------------------------ catalog-driven shop page */
function cardHTML(p){
  const badge = LANE_BADGE[p.lane] || LANE_BADGE.LOCAL;
  let buy;
  if (p.variants && p.variants.length){
    const opts = p.variants.map(function(v){
      return '<option value="' + v[1] + '">' + esc(v[0]) + ' — ' + money(v[1]) + '</option>';
    }).join('');
    buy = '<select class="variant" id="var-' + esc(p.id) + '">' + opts + '</select>';
  } else {
    buy = '<div class="price">' + money(p.price) + ' <span class="unit">' + esc(p.unit || 'each') + '</span></div>';
  }
  const src = (p.img && p.img.indexOf('data:') === 0) ? p.img : esc(p.img || '');
  return '<article class="card">' +
    '<div class="card-img"><img src="' + src + '" alt="' + esc(p.name) + '" loading="lazy">' +
    '<span class="badge ' + badge[0] + '">' + badge[1] + '</span></div>' +
    '<div class="card-body"><h3>' + esc(p.name) + '</h3><p>' + esc(p.desc || '') + '</p>' +
    '<div class="card-buy">' + buy +
    '<button class="add" onclick="addToCart(\'' + esc(p.id) + '\')">Add to Cart</button></div></div></article>';
}

function renderShop(){
  const root = document.getElementById('catalogRoot');
  if (!root) return;                       // not on the shop page
  const nav = document.getElementById('subnavLinks');
  if (!CATALOG){
    if (nav) nav.innerHTML = '';
    root.innerHTML = catalogState === 'failed'
      ? '<div class="wrap" style="text-align:center;padding:60px 20px">' +
        '<p style="font-size:17px;margin-bottom:14px">Current prices are unavailable right now.</p>' +
        '<p style="color:#7a6f63;margin-bottom:18px">Check the connection, then try again — we never guess at prices.</p>' +
        '<button class="btn" onclick="fetchLiveCatalog()">Retry</button></div>'
      : '<div class="wrap" style="text-align:center;padding:60px 20px;color:#7a6f63">' +
        '<p style="font-size:17px">Loading current prices…</p></div>';
    return;
  }
  let navHtml = '', html = '';
  (CATALOG.sections || []).forEach(function(s){
    const items = CATALOG.products.filter(function(p){ return p.sec === s.key && p.show !== false; });
    if (!items.length) return;             // empty/hidden section: no header, no nav link
    navHtml += '<a href="#' + esc(s.key) + '">' + esc(s.title) + '</a>';
    html += '<section class="collection" id="' + esc(s.key) + '">' +
      '<div class="wrap"><h2>' + esc(s.title) + '</h2><p class="blurb">' + esc(s.blurb || '') + '</p>' +
      '<div class="grid">' + items.map(cardHTML).join('') + '</div></div></section>';
  });
  if (nav) nav.innerHTML = navHtml;
  root.innerHTML = html;
  if (location.hash){
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView();
  }
}

function fetchLiveCatalog(){
  catalogState = 'loading';
  renderShop();
  fetch(RELAY + '/catalog', {cache: 'no-store'})
    .then(function(r){ if (!r.ok) throw 0; return r.json(); })
    .then(function(j){
      if (!(j && j.products && j.products.length)) throw 0;
      CATALOG = j; catalogState = 'ready';
      rebuildProducts(); renderShop(); renderCart();
    })
    .catch(function(){
      CATALOG = null; catalogState = 'failed';
      renderShop();   // shows the unavailable + Retry state, never stale prices
    });
}

function addToCart(id){
  const p = PRODUCTS[id];
  if (!p) return;
  const hasVar = p.variants && p.variants.length;
  let price = hasVar ? p.variants[0][1] : p.price, varLabel = '';
  const sel = document.getElementById('var-' + id);
  if (hasVar && sel){
    price = parseFloat(sel.value);
    varLabel = sel.options[sel.selectedIndex].text.split(' — ')[0];
  }
  const key = id + '|' + varLabel;
  if (!cart[key]) cart[key] = {id: id, qty: 0, price: price, varLabel: varLabel, name: p.name, lane: p.lane};
  cart[key].qty++;
  saveCart(); renderCart(); toggleCart(true);
}
function bump(key, d){
  cart[key].qty += d;
  if (cart[key].qty <= 0) delete cart[key];
  saveCart(); renderCart();
}

function computeTotals(method, zoneFee){
  const items = Object.values(cart);
  const sub = items.reduce((s,i) => s + i.price*i.qty, 0);
  const hasShip = items.some(i => itemLane(i) === 'SHIP');
  const hasLocal = items.some(i => itemLane(i) !== 'SHIP');
  const shipFee = hasShip ? SAMPLE_SHIP : 0;
  const localFee = (hasLocal && method === 'delivery') ? zoneFee : 0;
  return {sub: sub, shipFee: shipFee, localFee: localFee, grand: sub + shipFee + localFee,
          n: items.reduce((s,i) => s + i.qty, 0), hasShip: hasShip, hasLocal: hasLocal};
}
function drawerMethod(){
  const m = document.querySelector('input[name="method"]:checked');
  return m ? m.value : 'pickup';
}
function drawerZoneFee(){ return parseFloat(document.getElementById('zone').value); }

function renderCart(){
  const box = document.getElementById('cartItems');
  const fulfill = document.getElementById('fulfill');
  const totals = document.getElementById('totals');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const entries = Object.entries(cart);
  const t = computeTotals(drawerMethod(), drawerZoneFee());
  document.getElementById('cartCount').textContent = t.n;
  if (!entries.length){
    box.innerHTML = '<div class="empty">Your cart is empty — add something from the yard.</div>';
    fulfill.style.display = totals.style.display = checkoutBtn.style.display = 'none';
    return;
  }
  const ship = entries.filter(function(e){ return itemLane(e[1]) === 'SHIP'; });
  const local = entries.filter(function(e){ return itemLane(e[1]) !== 'SHIP'; });
  const row = function(e){
    const key = e[0], i = e[1];
    return '<div class="ci"><div><div class="nm">' + esc(itemName(i)) + (i.varLabel ? ' — ' + esc(i.varLabel) : '') + '</div>' +
      '<div class="ln">' + money(i.price) + ' each</div></div>' +
      '<div class="qty"><button onclick="bump(\'' + key + '\',-1)">−</button>' + i.qty +
      '<button onclick="bump(\'' + key + '\',1)">+</button></div>' +
      '<div class="amt">' + money(i.price * i.qty) + '</div></div>';
  };
  let html = '';
  if (ship.length) html += '<div class="group-h">Ships to you</div>' + ship.map(row).join('');
  if (local.length) html += '<div class="group-h">Local delivery / pickup</div>' + local.map(row).join('');
  box.innerHTML = html;

  fulfill.style.display = t.hasLocal ? 'block' : 'none';
  let lines = '<div class="row"><span>Subtotal</span><span>' + money(t.sub) + '</span></div>';
  if (t.hasShip) lines += '<div class="row"><span>Shipping (sample rate)</span><span>' + money(t.shipFee) + '</span></div>';
  if (t.hasLocal) lines += (drawerMethod() === 'delivery')
    ? '<div class="row"><span>Local delivery (sample zone fee)</span><span>' + money(t.localFee) + '</span></div>'
    : '<div class="row"><span>Yard pickup</span><span>Free</span></div>';
  lines += '<div class="row grand"><span>Total</span><span>' + money(t.grand) + '</span></div>';
  totals.style.display = 'block';
  totals.innerHTML = lines;
  checkoutBtn.style.display = 'block';
}

function toggleCart(open){
  document.getElementById('drawer').classList.toggle('open', open);
  document.getElementById('overlay').classList.toggle('open', open);
}

/* ------------------------------------------------ mock Shopify checkout */
function ckMethod(){
  const m = document.querySelector('input[name="ckmethod"]:checked');
  return m ? m.value : 'pickup';
}
function ckZoneFee(){ return parseFloat(document.getElementById('ckzone').value); }
function ckZoneName(){
  const s = document.getElementById('ckzone');
  return s.options[s.selectedIndex].text.split(' — ')[0];
}

function openCheckout(){
  toggleCart(false);
  // carry the drawer's fulfillment choice into checkout
  const dm = drawerMethod();
  const r = document.querySelector('input[name="ckmethod"][value="' + dm + '"]');
  if (r) r.checked = true;
  document.getElementById('ckzone').value = document.getElementById('zone').value;
  document.getElementById('ckMain').style.display = '';
  document.getElementById('ckConfirm').style.display = 'none';
  renderCheckout();
  document.getElementById('checkout').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCheckout(){
  document.getElementById('checkout').classList.remove('open');
  document.body.style.overflow = '';
}

function summaryHTML(t){
  const entries = Object.entries(cart);
  let html = entries.map(function(e){
    const i = e[1];
    return '<div class="row"><span>' + i.qty + ' × ' + esc(itemName(i)) + (i.varLabel ? ' — ' + esc(i.varLabel) : '') +
      '</span><span>' + money(i.price * i.qty) + '</span></div>';
  }).join('');
  html += '<div class="row sep"><span>Subtotal</span><span>' + money(t.sub) + '</span></div>';
  if (t.hasShip) html += '<div class="row"><span>Shipping (sample rate)</span><span>' + money(t.shipFee) + '</span></div>';
  if (t.hasLocal) html += (ckMethod() === 'delivery')
    ? '<div class="row"><span>Delivery — ' + ckZoneName() + '</span><span>' + money(t.localFee) + '</span></div>'
    : '<div class="row"><span>Yard pickup</span><span>Free</span></div>';
  html += '<div class="row grand"><span>Total</span><span>' + money(t.grand) + '</span></div>';
  return html;
}

function renderCheckout(){
  const t = computeTotals(ckMethod(), ckZoneFee());
  document.getElementById('ckLocal').style.display = t.hasLocal ? '' : 'none';
  document.getElementById('ckShip').style.display = t.hasShip ? '' : 'none';
  document.getElementById('ckPickup').style.display = (t.hasLocal && ckMethod() === 'pickup') ? '' : 'none';
  document.getElementById('ckAddr').style.display = (t.hasLocal && ckMethod() === 'delivery') ? '' : 'none';
  document.getElementById('ckSummary').innerHTML = '<h4>Order summary</h4>' + summaryHTML(t);
}

function placeOrder(){
  const btn = document.getElementById('placeBtn');
  btn.disabled = true; btn.textContent = 'Processing…';
  setTimeout(function(){
    btn.disabled = false; btn.textContent = 'Place order';
    const t = computeTotals(ckMethod(), ckZoneFee());
    document.getElementById('ordNum').textContent = 'QFM-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('confirmSummary').innerHTML = summaryHTML(t);
    document.getElementById('ckMain').style.display = 'none';
    document.getElementById('ckConfirm').style.display = '';
  }, 900);
}
function finishDemo(){
  cart = {}; saveCart(); renderCart(); closeCheckout();
}

renderShop();
renderCart();
fetchLiveCatalog();
