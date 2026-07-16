// QFM concept store — catalog-driven cards + shared cart + mock checkout.
// The catalog baked below is the fallback; if the office has saved changes on
// the config page (/qfm/config), that catalog is fetched from the relay and
// re-rendered over it. Demo only: no payments, no storage beyond the cart.
const CART_KEY = 'qfmCart.v1';
const RELAY = 'https://dlerhetal.pythonanywhere.com/qfm-api';
const DEFAULT_CATALOG = {"version": 1, "sections": [{"key": "firewood", "title": "Firewood", "blurb": "Seasoned, split, and honestly measured \u2014 our cords are guaranteed full and NMDA-regulated. Cash and check discounts on firewood."}, {"key": "stone", "title": "Flagstone & Stone", "blurb": "The largest flagstone selection in southern New Mexico \u2014 around 30 varieties from across the U.S. and Mexico, priced by the pound so you buy exactly what you need."}, {"key": "pottery", "title": "Pottery", "blurb": "Over 30,000 pots on eight acres \u2014 factory-direct Vietnamese ceramic, talavera, stands and saucers. Smaller pieces ship anywhere."}, {"key": "fountains", "title": "Fountains", "blurb": "Ceramic fountains, rock bubblers and cast stone tiers \u2014 hear one running before you buy it."}, {"key": "materials", "title": "Landscape Materials", "blurb": "The hard-to-find yard: railroad ties by the grade, vigas, latillas, cedar stays, and pecan shells by the yard or by the bag."}, {"key": "decor", "title": "Yard Decor", "blurb": "Metal cacti to cement turtles \u2014 the selection changes every week."}, {"key": "softgoods", "title": "Soft Goods", "blurb": "Handwoven fiber home goods, new to the yard \u2014 baskets, placemats, napkin rings and area rugs. Smaller pieces ship anywhere in the country."}], "products": [{"id": "pinon", "sec": "firewood", "name": "Pi\u00f1on Firewood", "desc": "New Mexico pi\u00f1on \u2014 twice the hardness of regular pine, famously fragrant. Guaranteed full cords, NMDA-regulated measure.", "lane": "LOCAL", "show": true, "img": "assets/hero_pinon.jpg", "variants": [["Full Cord", 389], ["Half Cord", 215], ["Quarter Cord", 125]]}, {"id": "pecanw", "sec": "firewood", "name": "Pecan Firewood", "desc": "Cut locally in the Mesilla Valley. Slow-burning heat \u2014 mix with cedar for an easy start and great fragrance.", "lane": "LOCAL", "show": true, "img": "assets/pecan_stacks.jpg", "variants": [["Full Cord", 329], ["Half Cord", 185], ["Quarter Cord", 109]]}, {"id": "cedarw", "sec": "firewood", "name": "Cedar (Shaggy-Bark Juniper)", "desc": "Easy lighting and a great fragrance \u2014 the classic starter and everyday burn. Oak, mesquite and alligator juniper seasonally; call for availability.", "lane": "LOCAL", "show": true, "img": "assets/wood_pile.jpg", "variants": [["Full Cord", 279], ["Half Cord", 159], ["Quarter Cord", 95]]}, {"id": "apple", "sec": "firewood", "name": "Applewood Chunks & Mini Logs", "desc": "5 lb bundles of apple chunks and mini logs \u2014 the cooking wood for pork, fish, poultry and wild game.", "lane": "SHIP", "show": true, "img": "assets/pecan_stacks.jpg", "price": 14.99, "unit": "5 lb bundle"}, {"id": "flagbuff", "sec": "stone", "name": "Arizona Buff Flagstone", "desc": "Warm buff sandstone, sold by the pound. Buy one piece or the whole pallet.", "lane": "LOCAL", "show": true, "img": "assets/flag_buff.jpg", "price": 0.25, "unit": "per lb"}, {"id": "flagred", "sec": "stone", "name": "Colorado Red Flagstone", "desc": "Deep red sandstone for patios and walkways \u2014 a Southwest signature.", "lane": "LOCAL", "show": true, "img": "assets/flag_red.jpg", "price": 0.35, "unit": "per lb"}, {"id": "flagslate", "sec": "stone", "name": "Idaho Quartzite", "desc": "Cool silver-blue quartzite \u2014 exotic coloration, extremely durable.", "lane": "LOCAL", "show": true, "img": "assets/flag_slate.jpg", "price": 0.45, "unit": "per lb"}, {"id": "flagslab", "sec": "stone", "name": "Arizona Select Slabs", "desc": "Oversize select slabs for steps, benches and statement pieces.", "lane": "LOCAL", "show": true, "img": "assets/flag_slab.jpg", "price": 0.35, "unit": "per lb"}, {"id": "riverrock", "sec": "stone", "name": "River Rock", "desc": "Washed river rock by the pallet basket \u2014 borders, dry beds, accents.", "lane": "LOCAL", "show": true, "img": "assets/river_rock.jpg", "price": 189, "unit": "per pallet"}, {"id": "coronado", "sec": "stone", "name": "Coronado Stone Veneer \u2014 Overstock", "desc": "Manufactured stone veneer at roughly half retail while overstock lasts. Boxes of 100\u2013125 sq ft; smaller 12.5 and 15 sq ft boxes available.", "lane": "LOCAL", "show": true, "img": "assets/coronado.jpg", "price": 4.75, "unit": "per sq ft"}, {"id": "talavera", "sec": "pottery", "name": "Talavera Pottery", "desc": "Hand-painted color for porch and patio. Small pieces ship anywhere in the country.", "lane": "SHIP", "show": true, "img": "assets/talavera.jpg", "price": 24.99, "unit": "from"}, {"id": "glazedsm", "sec": "pottery", "name": "Glazed Pots \u2014 Small", "desc": "Vietnamese beehive-kiln pottery, built to survive any climate. Under 40 lbs \u2014 ships nationwide.", "lane": "SHIP", "show": true, "img": "assets/blue_pots.jpg", "price": 34.99, "unit": "from"}, {"id": "glazedmd", "sec": "pottery", "name": "Glazed Planters \u2014 Medium", "desc": "The porch-anchor size. Hundreds of styles and colors on the yard.", "lane": "LOCAL", "show": true, "img": "assets/red_pots.jpg", "price": 89, "unit": "from"}, {"id": "jars", "sec": "pottery", "name": "Statement Jars \u2014 Large", "desc": "Oversized jars and urns \u2014 the entryway centerpiece. Local delivery available.", "lane": "LOCAL", "show": true, "img": "assets/jars_three.jpg", "price": 249, "unit": "from"}, {"id": "scroll", "sec": "pottery", "name": "Etched & Scroll Pots", "desc": "Carved detail, rich glazes \u2014 from a selection of over 30,000 pots on eight acres.", "lane": "LOCAL", "show": true, "img": "assets/scroll_pots.jpg", "price": 119, "unit": "from"}, {"id": "fball", "sec": "fountains", "name": "Ceramic Ball Fountain", "desc": "Self-contained glazed sphere fountain \u2014 plug in, fill, done.", "lane": "LOCAL", "show": true, "img": "assets/fountain_ball.jpg", "price": 349, "unit": "each"}, {"id": "fteal", "sec": "fountains", "name": "Teal Wave Fountain", "desc": "Sculptural glazed ceramic \u2014 quiet recirculating pump included.", "lane": "LOCAL", "show": true, "img": "assets/fountain_teal.jpg", "price": 399, "unit": "each"}, {"id": "ftier", "sec": "fountains", "name": "Cast Stone 3-Tier Fountain", "desc": "Classic courtyard tiers in weatherproof cast stone.", "lane": "LOCAL", "show": true, "img": "assets/fountain_tier.jpg", "price": 499, "unit": "each"}, {"id": "ties", "sec": "materials", "name": "Used Railroad Ties", "desc": "Approx. 6\u2033\u00d78\u2033 \u00d7 8\u2032. Retaining walls, raised beds, parking stops. Bundle-of-16 discount.", "lane": "LOCAL", "show": true, "img": "assets/ties.jpg", "variants": [["Relay (nearly new)", 42], ["#1 Grade", 34], ["#2 Grade", 26], ["#3 Grade", 18]]}, {"id": "vigas", "sec": "materials", "name": "Vigas & Braided Posts", "desc": "Ponderosa pine vigas in varying diameters and lengths; carved braided posts 8\u2033 \u00d7 8\u2032.", "lane": "LOCAL", "show": true, "img": "assets/posts.jpg", "price": 89, "unit": "from"}, {"id": "latillas", "sec": "materials", "name": "Latillas", "desc": "Ponderosa latillas in 8, 12 and 16 ft lengths \u2014 coyote fences, pergola shade.", "lane": "LOCAL", "show": true, "img": "assets/latilla_bundle.jpg", "price": 6.5, "unit": "from, each"}, {"id": "stays", "sec": "materials", "name": "Cedar Stays", "desc": "South Texas cedar \u2014 #1 stays (5\u20135.5 ft) and long stays (8 ft, 10 ft) for fences that last.", "lane": "LOCAL", "show": true, "img": "assets/latilla_fence.jpg", "price": 4.25, "unit": "from, each"}, {"id": "shells", "sec": "materials", "name": "Pecan Shells \u2014 Bulk", "desc": "Mulch, surfacing, dust control, event parking. By the cubic yard; semi-load pricing available.", "lane": "LOCAL", "show": true, "img": "assets/pecan_shells.jpg", "price": 12, "unit": "per cu yd"}, {"id": "shellbag", "sec": "materials", "name": "Pecan Shells \u2014 Smoker Bag", "desc": "10 lb bag for smoking meats \u2014 the Mesilla Valley flavor, shipped to your door.", "lane": "SHIP", "show": true, "img": "assets/pecan_shells.jpg", "price": 12.99, "unit": "10 lb bag"}, {"id": "statuary", "sec": "decor", "name": "Statuary & Concrete Art", "desc": "Cement turtles, roadrunners, benches, southwestern statuary \u2014 an ever-changing selection.", "lane": "PICKUP", "show": true, "img": "assets/statuary.jpg", "price": 39, "unit": "from"}, {"id": "mflowers", "sec": "decor", "name": "Metal Flower Stakes", "desc": "Hand-made metal blooms that never need water. Ships nationwide.", "lane": "SHIP", "show": true, "img": "assets/metal_flowers.jpg", "price": 29.99, "unit": "each"}, {"id": "gazing", "sec": "decor", "name": "Gazing Balls", "desc": "Hand-blown glass color for beds and planters.", "lane": "SHIP", "show": true, "img": "assets/gazing.jpg", "price": 29.99, "unit": "each"}, {"id": "bench", "sec": "decor", "name": "Rustic Garden Benches", "desc": "Reclaimed-wood and iron benches with real patina \u2014 one-of-a-kind pieces.", "lane": "LOCAL", "show": true, "img": "assets/bench.jpg", "price": 189, "unit": "from"}, {"id": "wovenrugs", "sec": "softgoods", "name": "Handwoven Area Rugs", "desc": "Natural-fiber area rugs, woven by hand \u2014 earthy texture for any room.", "lane": "LOCAL", "show": true, "img": "assets/soft_goods.jpg", "variants": [["3x5", 89], ["5x8", 169], ["8x10", 259]]}, {"id": "wovenbaskets", "sec": "softgoods", "name": "Handwoven Baskets", "desc": "Fiber baskets for storage, plants, or the table \u2014 every one unique.", "lane": "SHIP", "show": true, "img": "assets/soft_goods.jpg", "variants": [["Small", 24], ["Medium", 39], ["Large", 59]]}, {"id": "placemats", "sec": "softgoods", "name": "Woven Placemats", "desc": "Handwoven placemats that dress the table and shrug off spills.", "lane": "SHIP", "show": true, "img": "assets/soft_goods.jpg", "price": 34, "unit": "set of 4"}, {"id": "napkinrings", "sec": "softgoods", "name": "Woven Napkin Rings", "desc": "Handwoven napkin rings \u2014 the finishing touch for the set table.", "lane": "SHIP", "show": true, "img": "assets/soft_goods.jpg", "price": 19.99, "unit": "set of 6"}]};
const ZONES = [["Las Cruces / Mesilla", 35], ["Do\u00f1a Ana", 45], ["El Paso", 75], ["Deming", 85], ["Truth or Consequences", 95], ["Elephant Butte", 95]];
const SAMPLE_SHIP = 14.95;
const LANE_BADGE = {SHIP: ['badge-ship', 'Ships Nationwide'],
                    LOCAL: ['badge-local', 'Local Delivery / Pickup'],
                    PICKUP: ['badge-pickup', 'Yard Pickup']};

let CATALOG = DEFAULT_CATALOG;
let PRODUCTS = {};
function rebuildProducts(){
  PRODUCTS = {};
  CATALOG.products.forEach(function(p){ PRODUCTS[p.id] = p; });
}
rebuildProducts();

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
  fetch(RELAY + '/catalog', {cache: 'no-store'})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (j && j.products && j.products.length){
        CATALOG = j; rebuildProducts(); renderShop(); renderCart();
      }
    })
    .catch(function(){ /* offline or nothing saved yet — baked catalog stands */ });
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
