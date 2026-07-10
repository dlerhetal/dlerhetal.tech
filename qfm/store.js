// QFM concept store — shared cart + mock checkout. Demo only: no payments, no storage beyond localStorage cart.
const CART_KEY = 'qfmCart.v1';
const PRODUCTS = {"pinon": {"name": "Pi\u00f1on Firewood", "lane": "LOCAL", "price": 389, "hasVar": true}, "pecanw": {"name": "Pecan Firewood", "lane": "LOCAL", "price": 329, "hasVar": true}, "cedarw": {"name": "Cedar (Shaggy-Bark Juniper)", "lane": "LOCAL", "price": 279, "hasVar": true}, "apple": {"name": "Applewood Chunks & Mini Logs", "lane": "SHIP", "price": 14.99, "hasVar": false}, "flagbuff": {"name": "Arizona Buff Flagstone", "lane": "LOCAL", "price": 0.25, "hasVar": false}, "flagred": {"name": "Colorado Red Flagstone", "lane": "LOCAL", "price": 0.35, "hasVar": false}, "flagslate": {"name": "Idaho Quartzite", "lane": "LOCAL", "price": 0.45, "hasVar": false}, "flagslab": {"name": "Arizona Select Slabs", "lane": "LOCAL", "price": 0.35, "hasVar": false}, "riverrock": {"name": "River Rock", "lane": "LOCAL", "price": 189, "hasVar": false}, "coronado": {"name": "Coronado Stone Veneer \u2014 Overstock", "lane": "LOCAL", "price": 4.75, "hasVar": false}, "talavera": {"name": "Talavera Pottery", "lane": "SHIP", "price": 24.99, "hasVar": false}, "glazedsm": {"name": "Glazed Pots \u2014 Small", "lane": "SHIP", "price": 34.99, "hasVar": false}, "glazedmd": {"name": "Glazed Planters \u2014 Medium", "lane": "LOCAL", "price": 89, "hasVar": false}, "jars": {"name": "Statement Jars \u2014 Large", "lane": "LOCAL", "price": 249, "hasVar": false}, "scroll": {"name": "Etched & Scroll Pots", "lane": "LOCAL", "price": 119, "hasVar": false}, "fball": {"name": "Ceramic Ball Fountain", "lane": "LOCAL", "price": 349, "hasVar": false}, "fteal": {"name": "Teal Wave Fountain", "lane": "LOCAL", "price": 399, "hasVar": false}, "ftier": {"name": "Cast Stone 3-Tier Fountain", "lane": "LOCAL", "price": 499, "hasVar": false}, "ties": {"name": "Used Railroad Ties", "lane": "LOCAL", "price": 42, "hasVar": true}, "vigas": {"name": "Vigas & Braided Posts", "lane": "LOCAL", "price": 89, "hasVar": false}, "latillas": {"name": "Latillas", "lane": "LOCAL", "price": 6.5, "hasVar": false}, "stays": {"name": "Cedar Stays", "lane": "LOCAL", "price": 4.25, "hasVar": false}, "shells": {"name": "Pecan Shells \u2014 Bulk", "lane": "LOCAL", "price": 12, "hasVar": false}, "shellbag": {"name": "Pecan Shells \u2014 Smoker Bag", "lane": "SHIP", "price": 12.99, "hasVar": false}, "statuary": {"name": "Statuary & Concrete Art", "lane": "PICKUP", "price": 39, "hasVar": false}, "mflowers": {"name": "Metal Flower Stakes", "lane": "SHIP", "price": 29.99, "hasVar": false}, "gazing": {"name": "Gazing Balls", "lane": "SHIP", "price": 29.99, "hasVar": false}, "bench": {"name": "Rustic Garden Benches", "lane": "LOCAL", "price": 189, "hasVar": false}};
const ZONES = [["Las Cruces / Mesilla", 35], ["Do\u00f1a Ana", 45], ["El Paso", 75], ["Deming", 85], ["Truth or Consequences", 95], ["Elephant Butte", 95]];
const SAMPLE_SHIP = 14.95;

let cart = {};
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch (e) { cart = {}; }

function saveCart(){ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function money(x){ return '$' + x.toFixed(2).replace(/\.00$/,''); }

function addToCart(id){
  const p = PRODUCTS[id];
  let price = p.price, varLabel = '';
  const sel = document.getElementById('var-' + id);
  if (p.hasVar && sel){
    price = parseFloat(sel.value);
    varLabel = sel.options[sel.selectedIndex].text.split(' — ')[0];
  }
  const key = id + '|' + varLabel;
  if (!cart[key]) cart[key] = {id: id, qty: 0, price: price, varLabel: varLabel};
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
  const hasShip = items.some(i => PRODUCTS[i.id].lane === 'SHIP');
  const hasLocal = items.some(i => PRODUCTS[i.id].lane !== 'SHIP');
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
  const ship = entries.filter(function(e){ return PRODUCTS[e[1].id].lane === 'SHIP'; });
  const local = entries.filter(function(e){ return PRODUCTS[e[1].id].lane !== 'SHIP'; });
  const row = function(e){
    const key = e[0], i = e[1], p = PRODUCTS[i.id];
    return '<div class="ci"><div><div class="nm">' + p.name + (i.varLabel ? ' — ' + i.varLabel : '') + '</div>' +
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
    const i = e[1], p = PRODUCTS[i.id];
    return '<div class="row"><span>' + i.qty + ' × ' + p.name + (i.varLabel ? ' — ' + i.varLabel : '') +
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

renderCart();
