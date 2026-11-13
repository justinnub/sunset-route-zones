(function () {
  'use strict';
  var D = window.SWW_DATA, Z = D.zips, N = Z.length;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- projection: flat map, 1000 units per degree of latitude ---------- */
  var LAT0 = 33.5, LON0 = -112.1, S = 1000, COS = Math.cos(LAT0 * Math.PI / 180), MI = S / 69.05;
  function wx(lon) { return (lon - LON0) * COS * S; }
  function wy(lat) { return (LAT0 - lat) * S; }
  function lonOf(x) { return x / (COS * S) + LON0; }
  function latOf(y) { return LAT0 - y / S; }

  var PALETTE = ['#E4572E', '#3FA7D6', '#7BC96F', '#C77DFF', '#F2C14E', '#2EC4B6', '#FF7AA2', '#8D99FF', '#F08A4B', '#B8D15A', '#C9ADA7', '#A98467'];
  var BANDS = [5, 10, 15, 20, 30, 1e9];
  var BAND_COL = ['#F7E7BF', '#E9C77C', '#C8A35F', '#A27B42', '#7A5932', '#544031'];
  var BAND_LBL = ['Under 5 mi', '5 to 10 mi', '10 to 15 mi', '15 to 20 mi', '20 to 30 mi', 'Over 30 mi'];
  var UNASSIGNED = '#6E6A62';

  /* ---------- geometry prepared once ---------- */
  var segA = [], segB = [], segD = [];
  (function () {
    var map = new Map();
    for (var i = 0; i < N; i++) {
      var z = Z[i], d = '', x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      z.wx = wx(z.x); z.wy = wy(z.y);
      for (var r = 0; r < z.p.length; r++) {
        var a = z.p[r];
        for (var k = 0; k < a.length; k += 2) {
          var X = wx(a[k] / 1e4), Y = wy(a[k + 1] / 1e4);
          d += (k ? 'L' : 'M') + X.toFixed(1) + ' ' + Y.toFixed(1);
          if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
          if (k + 3 < a.length) {
            var p = a[k] + ',' + a[k + 1], q = a[k + 2] + ',' + a[k + 3];
            if (p === q) continue;
            var key = p < q ? p + '|' + q : q + '|' + p, id = map.get(key);
            if (id === undefined) {
              map.set(key, segA.length); segA.push(i); segB.push(-1);
              segD.push('M' + X.toFixed(1) + ' ' + Y.toFixed(1) + 'L' + wx(a[k + 2] / 1e4).toFixed(1) + ' ' + wy(a[k + 3] / 1e4).toFixed(1));
            } else if (segA[id] !== i) segB[id] = i;
          }
        }
        d += 'Z';
      }
      z.d = d; z.bb = [x0, y0, x1, y1];
    }
  })();
  var zipIndex = {}; Z.forEach(function (z, i) { zipIndex[z.z] = i; });
  var ALL = [1e9, 1e9, -1e9, -1e9];
  Z.forEach(function (z) { if (z.v) { ALL[0] = Math.min(ALL[0], z.bb[0]); ALL[1] = Math.min(ALL[1], z.bb[1]); ALL[2] = Math.max(ALL[2], z.bb[2]); ALL[3] = Math.max(ALL[3], z.bb[3]); } });
  var cities = {};
  Z.forEach(function (z, i) { (cities[z.c] = cities[z.c] || []).push(i); });
  var cityNames = Object.keys(cities).sort();
  var cityColor = {}; cityNames.forEach(function (c, i) { cityColor[c] = 'hsl(' + ((i * 47) % 360) + ' 58% ' + (i % 2 ? 60 : 50) + '%)'; });

  /* ---------- state ---------- */
  var act = new Uint8Array(N), zon = new Int32Array(N), dist = new Float32Array(N);
  var st = { hub: D.hub.slice(), radius: 25, ring: false, zones: [], nextId: 1, mode: 'zone', layers: { zips: true, cities: true, roads: true, off: true, sS: true, sC: true, sL: true }, custom: [] };
  var tool = 'inspect', paintZone = 0, sel = -1, hov = -1;
  var saved = null, savedCore = '', artifactCap = null, downloadsCap = null, readOnly = false;
  var hist = [], hpos = -1;

  function hubW() { return [wx(st.hub[0]), wy(st.hub[1])]; }
  function recalcDist() { var h = hubW(); for (var i = 0; i < N; i++) dist[i] = Math.hypot(Z[i].wx - h[0], Z[i].wy - h[1]) / MI; }
  function zoneById(id) { for (var i = 0; i < st.zones.length; i++) if (st.zones[i].id === id) return st.zones[i]; return null; }

  function core() {
    var z = {};
    for (var i = 0; i < N; i++) if (act[i] || zon[i]) z[Z[i].z] = [act[i], zon[i]];
    return { hub: st.hub, radius: st.radius, ring: st.ring, zones: st.zones, nextId: st.nextId, zip: z, custom: st.custom };
  }
  function loadCore(c) {
    st.hub = c.hub.slice(); st.radius = c.radius; st.ring = !!c.ring;
    st.zones = c.zones.map(function (o) { return { id: o.id, name: o.name, color: o.color }; }); st.nextId = c.nextId;
    st.custom = (c.custom || []).map(function (o) { return { n: o.n, k: o.k, a: o.a, z: o.z, d: o.d }; });
    act.fill(0); zon.fill(0);
    Object.keys(c.zip).forEach(function (k) { var i = zipIndex[k]; if (i !== undefined) { act[i] = c.zip[k][0]; zon[i] = zoneById(c.zip[k][1]) ? c.zip[k][1] : 0; } });
    if (!zoneById(paintZone)) paintZone = st.zones.length ? st.zones[0].id : 0;
    recalcDist(); if (typeof rebuildStores === 'function') rebuildStores();
  }
  function full() { var c = core(); c.mode = st.mode; c.layers = st.layers; return c; }

  function commit() {
    var s = JSON.stringify(core());
    if (hpos >= 0 && hist[hpos] === s) return;
    hist = hist.slice(0, hpos + 1); hist.push(s); if (hist.length > 80) hist.shift(); hpos = hist.length - 1;
    persist(); syncButtons();
  }
  function undo(dir) {
    var p = hpos + dir; if (p < 0 || p >= hist.length) return;
    hpos = p; loadCore(JSON.parse(hist[p])); persist(); renderAll();
  }
  function persist() {
    try { localStorage.setItem('sww-zones-draft', JSON.stringify({ base: saved ? saved.stamp : 0, state: full() })); } catch (e) { }
  }

  /* ---------- zone builders ---------- */
  var DIRS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
  function autoZones(k) {
    var idx = []; for (var i = 0; i < N; i++) if (act[i]) idx.push(i);
    if (!idx.length) return false;
    k = Math.max(1, Math.min(k, idx.length, PALETTE.length));
    var h = hubW(), cs = [], first = idx[0];
    idx.forEach(function (i) { if (dist[i] < dist[first]) first = i; });
    cs.push([Z[first].wx, Z[first].wy]);
    while (cs.length < k) {
      var best = -1, bd = -1;
      idx.forEach(function (i) { var m = 1e18; cs.forEach(function (c) { m = Math.min(m, Math.hypot(Z[i].wx - c[0], Z[i].wy - c[1])); }); if (m > bd) { bd = m; best = i; } });
      cs.push([Z[best].wx, Z[best].wy]);
    }
    var asg = {};
    for (var it = 0; it < 40; it++) {
      var sx = cs.map(function () { return [0, 0, 0]; });
      idx.forEach(function (i) { var b = 0, m = 1e18; cs.forEach(function (c, j) { var d = Math.hypot(Z[i].wx - c[0], Z[i].wy - c[1]); if (d < m) { m = d; b = j; } }); asg[i] = b; sx[b][0] += Z[i].wx; sx[b][1] += Z[i].wy; sx[b][2]++; });
      cs = cs.map(function (c, j) { return sx[j][2] ? [sx[j][0] / sx[j][2], sx[j][1] / sx[j][2]] : c; });
    }
    var order = cs.map(function (c, j) { return j; }).sort(function (a, b) { return Math.hypot(cs[a][0] - h[0], cs[a][1] - h[1]) - Math.hypot(cs[b][0] - h[0], cs[b][1] - h[1]); });
    var used = {}, ids = {};
    st.zones = []; zon.fill(0);
    order.forEach(function (j, n) {
      var c = cs[j], dm = Math.hypot(c[0] - h[0], c[1] - h[1]) / MI, name;
      if (dm < 4.5) name = 'Central';
      else { var ang = Math.atan2(-(c[1] - h[1]), c[0] - h[0]) * 180 / Math.PI; name = DIRS[((Math.round(ang / 45) % 8) + 8) % 8]; if (dm > 22) name = 'Far ' + name; }
      used[name] = (used[name] || 0) + 1; if (used[name] > 1) name += ' ' + used[name];
      var id = st.nextId++; ids[j] = id; st.zones.push({ id: id, name: name, color: PALETTE[n % PALETTE.length] });
    });
    idx.forEach(function (i) { zon[i] = ids[asg[i]]; });
    paintZone = st.zones[0].id;
    return true;
  }
  function applyRadius(r) { for (var i = 0; i < N; i++) act[i] = dist[i] <= r ? 1 : 0; }

  /* ---------- DOM ---------- */
  var I = {
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7 17 2.5-7.5L21 11z"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.3 7a8 8 0 1011.4 0"/></svg>',
    brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.4 2.6a2 2 0 013 3L11 16l-4 1 1-4z"/><path d="M7 17c-1 3-3 4-5 4 1-1 1.500-2.500 2-4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.200 7-12a7 7 0 10-14 0c0 5.800 7 12 7 12z"/><circle cx="12" cy="10" r="2.500"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>'
  };

  $('#app').innerHTML =
    '<aside class="side">' +
      '<div class="brand"><div class="eyebrow">Sunset Wholesale West</div><h1>Valley Route Zones</h1><p>Choose which ZIP codes you deliver to and group them into color-coded route zones.</p></div>' +
      '<div class="stats"><div class="stat"><b id="s-act">0</b><span>ZIPs on</span></div><div class="stat"><b id="s-zon">0</b><span>Zones</span></div><div class="stat"><b id="s-area">0</b><span>Sq miles</span></div><div class="stat"><b id="s-far">0</b><span>Max miles</span></div></div>' +

      '<section class="sec"><h2>Coverage</h2><p class="help">Which ZIP codes are switched on. Drag the slider to grow or shrink your delivery range around the warehouse.</p>' +
        '<div class="range-head"><b id="r-val">25 mi</b><span id="r-ct"></span></div>' +
        '<input type="range" id="radius" min="2" max="60" step="0.5" value="25" aria-label="Delivery range in miles">' +
        '<div class="ticks"><span>2</span><span>15</span><span>30</span><span>45</span><span>60 mi</span></div>' +
        '<div class="row"><button class="btn sm" id="p-valley">Valley metro</button><button class="btn sm" id="p-all">Everything</button><button class="btn sm" id="p-none">Clear all</button></div>' +
        '<p class="note">The slider resets ZIPs you switched by hand. To fine-tune after, use the <b>Turn on/off</b> tool on the map.</p>' +
      '</section>' +

      '<section class="sec"><h2>Color the map by</h2><p class="help">Changes the colors only. Your zones stay as they are.</p>' +
        '<div class="seg" id="mode"><button data-m="zone">Route zone</button><button data-m="dist">Distance</button><button data-m="city">City</button></div>' +
      '</section>' +

      '<section class="sec"><h2>Route zones</h2><p class="help">A zone is a group of ZIPs one route covers. Click a zone to select it, then paint ZIPs into it on the map. Click a color or name to change it.</p>' +
        '<div class="zones" id="zones"></div>' +
        '<div class="row"><button class="btn sm" id="z-add">Add zone</button><span class="grow"></span><button class="btn sm ghost" id="z-clear">Unassign all</button></div>' +
        '<div class="row"><label for="z-k" class="note" style="color:var(--text)">Split active ZIPs into</label><input class="num" id="z-k" type="number" min="1" max="12" value="8"><span class="note" style="color:var(--text)">zones</span><span class="grow"></span><button class="btn sm gold" id="z-auto">Auto-build</button></div>' +
        '<p class="note">Auto-build groups neighboring ZIPs into compact zones and replaces the current ones. Undo brings them back.</p>' +
      '</section>' +

      '<section class="sec sec-stores"><h2>Stores</h2><p class="help">Independent smoke shops, convenience stores and liquor stores. Click a ZIP on the map to list its stores with addresses. A gold pulse marks shops listed in the last 90 days.</p>' +
        '<div class="skeys">' +
          '<label class="check"><input type="checkbox" id="l-sS"><i class="dot kS"></i>Smoke and vape shops<span id="n-S"></span></label>' +
          '<label class="check"><input type="checkbox" id="l-sC"><i class="dot kC"></i>Convenience stores<span id="n-C"></span></label>' +
          '<label class="check"><input type="checkbox" id="l-sL"><i class="dot kL"></i>Liquor stores<span id="n-L"></span></label>' +
        '</div>' +
        '<div class="row"><button class="btn gold" id="feed-open"><i class="live"></i>Play new shops feed</button><button class="btn sm" id="csv-st">Stores CSV</button></div>' +
        '<p class="note">Counts are stores inside your active ZIPs. To add a shop your team found, click its ZIP and choose Add a shop.</p>' +
      '</section>' +
      '<section class="sec"><h2>Show on map</h2>' +
        '<div class="checks">' +
          '<label class="check"><input type="checkbox" id="l-zips">ZIP numbers</label><label class="check"><input type="checkbox" id="l-cities">City names</label>' +
          '<label class="check"><input type="checkbox" id="l-roads">Freeways</label><label class="check"><input type="checkbox" id="l-ring">Range ring</label>' +
          '<label class="check"><input type="checkbox" id="l-off">Inactive ZIPs</label>' +
        '</div>' +
      '</section>' +

      '<section class="sec"><h2>Save and export</h2>' +
        '<div class="row"><span class="chip" id="dirty"><i></i><span>Up to date</span></span></div>' +
        '<div class="row"><button class="btn gold" id="save">Save for everyone</button><button class="btn gold" id="link">Copy link to this version</button><button class="btn" id="csv">Download CSV</button></div>' +
        '<div class="row"><button class="btn sm" id="copy-active">Copy active ZIP list</button><button class="btn sm ghost" id="revert">Discard my changes</button></div>' +
        '<p class="note" id="save-note">Your edits are kept in this browser as you work. Save for everyone updates the map for anyone who opens the link.</p>' +
      '</section>' +
      '<div class="foot">ZIP boundaries are US Census ZIP Code Tabulation Areas (2010). A few newer or PO-box-only ZIPs are not drawn. Distances are straight-line miles from the warehouse to the center of each ZIP, not drive miles.<span class="g-st"> Store locations &copy; OpenStreetMap contributors, a volunteer-built map that does not list every shop.</span></div>' +
    '</aside>' +

    '<main class="stage">' +
      '<svg id="map" role="img" aria-label="Map of Phoenix area ZIP codes"><g id="world"><g id="g-zips"></g><path id="e-group" class="edge"/><path id="e-group2" class="edge"/><path id="e-active" class="edge"/><g id="g-roads"></g><circle id="ring"/><path id="e-sel" class="edge"/></g><g id="g-st"></g><g id="labels"></g><circle id="pulse" r="14"/><g id="hub"><rect x="-6" y="-6" width="12" height="12" transform="rotate(45)"/><text x="12" y="4">Warehouse</text></g></svg>' +
      '<div class="bar">' +
        '<div class="glass tools" id="tools">' +
          '<button data-t="inspect" title="Click a ZIP to see its details">' + I.hand + '<span>Inspect</span></button>' +
          '<button data-t="toggle" title="Switch ZIPs on or off">' + I.power + '<span>Turn on/off</span></button>' +
          '<button data-t="paint" title="Add ZIPs to the selected zone">' + I.brush + '<span>Paint zone</span></button>' +
          '<button data-t="hub" title="Move the warehouse marker">' + I.pin + '<span>Move warehouse</span></button>' +
        '</div>' +
        '<label class="glass search">' + I.search + '<input id="q" type="search" placeholder="Find ZIP or city" autocomplete="off" aria-label="Find a ZIP code or city"></label>' +
        '<span class="spacer"></span>' +
        '<div class="glass mini"><button class="ic" id="undo" title="Undo (Ctrl+Z)" aria-label="Undo">' + I.undo + '</button><button class="ic" id="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">' + I.redo + '</button><button class="ic txt" id="fit" title="Zoom to fit the active ZIPs">Fit</button><button class="ic txt" id="guide-open" style="color:var(--gold)">Guide</button></div>' +
      '</div>' +
      '<div class="glass card" id="card"></div>' +
      '<div class="glass legend" id="legend"></div>' +
      '<div class="glass feed" id="feed"></div>' +
      '<div class="glass hint" id="hint"></div>' +
      '<div class="glass zoom"><button class="ic" id="zin" aria-label="Zoom in">+</button><button class="ic" id="zout" aria-label="Zoom out">&minus;</button></div>' +
    '</main>' +
    '<div class="glass tip" id="tip"></div>' +
    '<div class="glass toast" id="toast"><span id="toast-t"></span><button id="toast-b"></button></div>' +
    '<div class="modal" id="guide"><div class="sheet"><button class="ic x" id="guide-x" aria-label="Close guide">' + I.x + '</button><div class="eyebrow">How this map works</div><h2>Guide</h2>' +
      '<p>Every shape is one ZIP code. A ZIP is either active (you deliver there, shown in color) or inactive (dim outline). Active ZIPs can be grouped into route zones.</p>' +
      '<div class="guide">' +
        '<div><h3>Coverage slider</h3><p>Sets your delivery range in miles from the warehouse. Every ZIP whose center falls inside the dashed gold ring turns on, the rest turn off.</p></div>' +
        '<div><h3>Presets</h3><p><b>Valley metro</b> turns on the Phoenix metro cities. <b>Everything</b> turns on all ' + N + ' ZIPs within about 60 miles. <b>Clear all</b> turns everything off.</p></div>' +
        '<div><h3>Inspect tool</h3><p>Click any ZIP to open its card: city, miles from the warehouse, land area, and controls to switch it on or change its zone.</p></div>' +
        '<div><h3>Turn on/off tool</h3><p>Click a ZIP to flip it. Drag across several to switch a whole strip at once.</p></div>' +
        '<div><h3>Paint zone tool</h3><p>Pick a zone in the left panel, then click or drag over ZIPs to move them into it. Painting an inactive ZIP also turns it on.</p></div>' +
        '<div><h3>Move warehouse tool</h3><p>Click the map to place the gold diamond. All distances and the range ring are measured from there.</p></div>' +
        '<div><h3>Zones list</h3><p>Rename a zone by typing over its name. Click the color square to recolor it. The copy icon copies that zone\'s ZIP list for your routing or geofencing software.</p></div>' +
        '<div><h3>Auto-build</h3><p>Splits the active ZIPs into the number of zones you choose, keeping each zone compact. Use it as a starting point, then paint to adjust.</p></div>' +
        '<div><h3>Lines on the map</h3><p>Gold outline: the edge of your active area. Light outline: the border between two zones. Thin pale lines: approximate freeway paths for orientation. They hide when you zoom in close.</p></div>' +
        '<div><h3>Moving around</h3><p>Scroll or pinch to zoom. Drag to pan. While a paint tool is on, hold <kbd>Space</kbd> and drag to pan. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last change.</p></div>' +
        '<div class="g-st"><h3>Stores</h3><p>White dots are smoke and vape shops, dark dots are convenience stores, gold dots are liquor stores. Chains like Circle K and QuikTrip are left out. Click a ZIP to see its stores and addresses.</p></div>' +
        '<div class="g-st"><h3>New shops feed</h3><p>Plays through the most recently listed shops one by one, flying the map to each. The date is when the shop was added or last updated in OpenStreetMap, or the day your team added it.</p></div>' +
        '<div><h3>Saving</h3><p>Edits stay in your browser until you press <b>Save for everyone</b>. That publishes the map so anyone with the link sees your latest zones.</p></div>' +
        '<div><h3>Export</h3><p><b>Download CSV</b> gives one row per ZIP with city, status, zone and miles. It opens in Excel or Google Sheets.</p></div>' +
      '</div>' +
      '<div class="fine">Boundaries are 2010 Census ZIP Code Tabulation Areas, which closely follow USPS ZIPs but are not identical. Distances are straight-line, so real drive miles run longer.</div>' +
    '</div></div>';

  var svg = $('#map'), world = $('#world'), gZ = $('#g-zips'), gL = $('#labels'), gHub = $('#hub'), ring = $('#ring');
  var paths = [], zl = [];
  Z.forEach(function (z, i) {
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', z.d); p.setAttribute('class', 'zip'); p.setAttribute('data-i', i); gZ.appendChild(p); paths.push(p);
  });
  D.roads.forEach(function (r) {
    var d = ''; for (var k = 0; k < r.l.length; k += 2) d += (k ? 'L' : 'M') + wx(r.l[k] / 1e4).toFixed(1) + ' ' + wy(r.l[k + 1] / 1e4).toFixed(1);
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); p.setAttribute('class', 'road' + (r.m ? ' major' : '')); $('#g-roads').appendChild(p);
  });
  function mkText(cls, t) { var e = document.createElementNS(SVGNS, 'text'); e.setAttribute('class', cls); e.textContent = t; gL.appendChild(e); return e; }
  var rl = D.labels.map(function (l) { return { e: mkText('lr', l.t), x: wx(l.x), y: wy(l.y) }; });
  Z.forEach(function (z) { zl.push(mkText('lz', z.z)); });
  var cl = cityNames.filter(function (c) { return c !== 'Unincorporated'; }).map(function (c) {
    var sx = 0, sy = 0, sa = 0; cities[c].forEach(function (i) { var a = Math.min(Z[i].a, 60); sx += Z[i].wx * a; sy += Z[i].wy * a; sa += a; });
    return { e: mkText('lc', c), x: sx / sa, y: sy / sa, n: cities[c].length, c: c };
  });

  /* ---------- stores ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KNAME = { S: 'Smoke shop', C: 'Convenience store', L: 'Liquor store' }, KPL = { S: 'Smoke and vape shops', C: 'Convenience stores', L: 'Liquor stores' };
  var NOW = new Date(), TODAY = NOW.getFullYear() + '-' + ('0' + (NOW.getMonth() + 1)).slice(-2) + '-' + ('0' + NOW.getDate()).slice(-2);
  var CUT = new Date(NOW.getTime() - 90 * 864e5), CUTS = CUT.getFullYear() + '-' + ('0' + (CUT.getMonth() + 1)).slice(-2) + '-' + ('0' + CUT.getDate()).slice(-2);
  function fmtDate(d) { var p = d.split('-'); return MONTHS[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
  var BASE = (window.SWW_STORES || '').split('\n').filter(Boolean).map(function (l) {
    var f = l.split('|'); return { n: f[0], k: f[1], a: f[2], x: wx(+f[4]), y: wy(+f[3]), lat: f[3], lon: f[4], d: '20' + f[5], zi: zipIndex[f[6]] };
  }).filter(function (o) { return o.zi !== undefined; });
  if (!BASE.length) document.body.classList.add('nostores');
  var STORES = [], byZip = [], gS = $('#g-st'), marks = [], hovS = -1, pulse = $('#pulse'), pulseAt = null;
  function rebuildStores() {
    STORES = BASE.slice();
    st.custom.forEach(function (c, j) {
      var zi = zipIndex[c.z]; if (zi === undefined) return;
      var n = st.custom.slice(0, j).filter(function (o) { return o.z === c.z; }).length, ang = n * 2.4, r = Math.min(Z[zi].bb[2] - Z[zi].bb[0], Z[zi].bb[3] - Z[zi].bb[1]) * 0.07 * (n ? 1 : 0);
      STORES.push({ n: c.n, k: c.k, a: c.a, x: Z[zi].wx + Math.cos(ang) * r, y: Z[zi].wy + Math.sin(ang) * r, d: c.d, zi: zi, team: j });
    });
    byZip = Z.map(function () { return []; });
    STORES.forEach(function (o, i) { o.isNew = o.d >= CUTS; byZip[o.zi].push(i); });
    gS.textContent = ''; marks = STORES.map(function (o, i) {
      var g = document.createElementNS(SVGNS, 'g'); g.setAttribute('class', 'sm k' + o.k + (o.isNew ? ' new' : '')); g.setAttribute('data-s', i);
      g.innerHTML = (o.isNew ? '<circle class="halo" r="9"/>' : '') + '<circle class="pt" r="3"/>'; gS.appendChild(g); return g;
    });
  }
  function storeShown(o) { return st.layers['s' + o.k] !== false && (act[o.zi] || st.layers.off); }
  function mapsLink(o) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.lat ? o.lat + ',' + o.lon : o.n + ' ' + o.a + ' ' + Z[o.zi].c + ' AZ ' + Z[o.zi].z); }
  function storeAt(x, y) { var e = document.elementFromPoint(x, y); e = e && e.closest ? e.closest('g.sm') : null; return e ? +e.getAttribute('data-s') : -1; }

  /* ---------- view ---------- */
  var view = { k: 1, x: 0, y: 0 }, fitK = 1, raf = 0;
  function size() { var r = svg.getBoundingClientRect(); return [r.width || 800, r.height || 600]; }
  function fitTo(bb, pad) {
    var s = size(), pd = pad === undefined ? 70 : pad, w = Math.max(bb[2] - bb[0], 8), h = Math.max(bb[3] - bb[1], 8);
    var k = Math.min((s[0] - pd * 2) / w, (s[1] - pd * 2 - 30) / h);
    view.k = k; view.x = s[0] / 2 - (bb[0] + bb[2]) / 2 * k; view.y = s[1] / 2 + 12 - (bb[1] + bb[3]) / 2 * k; drawView();
    return k;
  }
  function activeBB() {
    var b = [1e9, 1e9, -1e9, -1e9], any = false;
    for (var i = 0; i < N; i++) if (act[i]) { any = true; var q = Z[i].bb; b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); }
    return any ? b : ALL;
  }
  function zoomAt(f, cx, cy) {
    var nk = Math.max(fitK * 0.45, Math.min(fitK * 45, view.k * f)); f = nk / view.k;
    view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = nk; drawView();
  }
  function drawView() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; applyView(); }); }
  function applyView() {
    var k = view.k, s = size();
    world.setAttribute('transform', 'translate(' + view.x.toFixed(2) + ' ' + view.y.toFixed(2) + ') scale(' + k.toFixed(4) + ')');
    var h = hubW(); gHub.setAttribute('transform', 'translate(' + (h[0] * k + view.x).toFixed(1) + ' ' + (h[1] * k + view.y).toFixed(1) + ')');
    var mr = Math.max(2.6, Math.min(5.2, 2.2 + (k / fitK) * 0.55));
    for (var m = 0; m < marks.length; m++) {
      var o = STORES[m], g = marks[m], on = storeShown(o), sx = o.x * k + view.x, sy = o.y * k + view.y;
      if (!on || sx < -10 || sy < -10 || sx > s[0] + 10 || sy > s[1] + 10) { g.style.display = 'none'; continue; }
      g.style.display = ''; g.setAttribute('transform', 'translate(' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ')'); g.style.opacity = act[o.zi] ? 1 : .45; g.lastChild.setAttribute('r', (m === hovS ? mr + 1.6 : mr).toFixed(1));
    }
    if (pulseAt) { pulse.style.display = ''; pulse.setAttribute('cx', (pulseAt.x * k + view.x).toFixed(1)); pulse.setAttribute('cy', (pulseAt.y * k + view.y).toFixed(1)); } else pulse.style.display = 'none';
    var boxes = [];
    function free(x, y, w, hh) { for (var i = 0; i < boxes.length; i++) { var b = boxes[i]; if (Math.abs(b[0] - x) < (b[2] + w) / 2 && Math.abs(b[1] - y) < (b[3] + hh) / 2) return false; } boxes.push([x, y, w, hh]); return true; }
    var showCity = st.layers.cities && k < fitK * 2.6;
    var showRoads = st.layers.roads && k < fitK * 3.4; $('#g-roads').style.display = showRoads ? '' : 'none';
    cl.forEach(function (c) {
      var x = c.x * k + view.x, y = c.y * k + view.y, any = st.layers.off || cities[c.c].some(function (i) { return act[i]; });
      var ok = showCity && any && x > 0 && y > 0 && x < s[0] && y < s[1] && (c.n > 1 || k > fitK * 1.25) && free(x, y, c.c.length * 9 + 14, 18);
      c.e.style.display = ok ? '' : 'none'; if (ok) { c.e.setAttribute('x', x.toFixed(1)); c.e.setAttribute('y', y.toFixed(1)); }
    });
    for (var i = 0; i < N; i++) {
      var z = Z[i], e = zl[i], x = z.wx * k + view.x, y = z.wy * k + view.y;
      var ok = st.layers.zips && (act[i] || st.layers.off) && (z.bb[2] - z.bb[0]) * k > 40 && (z.bb[3] - z.bb[1]) * k > 20 && x > 0 && y > 0 && x < s[0] && y < s[1] && free(x, y, 40, 15);
      e.style.display = ok ? '' : 'none';
      if (ok) { e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('class', act[i] ? 'lz' : 'lz off'); }
    }
    rl.forEach(function (r) {
      var x = r.x * k + view.x, y = r.y * k + view.y, ok = showRoads && x > 0 && y > 0 && x < s[0] && y < s[1] && free(x, y, 52, 14);
      r.e.style.display = ok ? '' : 'none'; if (ok) { r.e.setAttribute('x', x.toFixed(1)); r.e.setAttribute('y', y.toFixed(1)); }
    });
  }

  /* ---------- painting the map ---------- */
  function bandOf(i) { for (var b = 0; b < BANDS.length; b++) if (dist[i] < BANDS[b]) return b; return 5; }
  function groupKey(i) { if (!act[i]) return -1; return st.mode === 'zone' ? zon[i] : st.mode === 'dist' ? bandOf(i) : Z[i].c; }
  function colorOf(i) {
    if (st.mode === 'dist') return BAND_COL[bandOf(i)];
    if (st.mode === 'city') return cityColor[Z[i].c];
    var z = zoneById(zon[i]); return z ? z.color : UNASSIGNED;
  }
  function paintZip(i) {
    var p = paths[i];
    if (act[i]) { p.setAttribute('class', 'zip' + (i === hov ? ' hov' : '')); p.style.fill = colorOf(i); p.style.fillOpacity = st.mode === 'zone' && !zon[i] ? .55 : .8; }
    else { p.setAttribute('class', 'zip off' + (i === hov ? ' hov' : '')); p.style.fill = ''; p.style.fillOpacity = ''; }
  }
  var edgeRaf = 0;
  function drawEdges() { if (!edgeRaf) edgeRaf = requestAnimationFrame(function () { edgeRaf = 0; edgesNow(); }); }
  function edgesNow() {
    var g = '', a = '', keys = new Array(N);
    for (var i = 0; i < N; i++) keys[i] = groupKey(i);
    for (var s = 0; s < segA.length; s++) {
      var ka = keys[segA[s]], kb = segB[s] < 0 ? -1 : keys[segB[s]];
      if (ka === kb) continue;
      if (ka === -1 || kb === -1) a += segD[s]; else g += segD[s];
    }
    $('#e-group').setAttribute('d', g); $('#e-group2').setAttribute('d', g); $('#e-active').setAttribute('d', a);
    $('#e-sel').setAttribute('d', sel >= 0 ? Z[sel].d : '');
  }
  function paintMap() { for (var i = 0; i < N; i++) paintZip(i); drawEdges(); svg.classList.toggle('hide-off', !st.layers.off); }

  /* ---------- panel rendering ---------- */
  function counts() { var c = {}; for (var i = 0; i < N; i++) if (act[i]) c[zon[i]] = (c[zon[i]] || 0) + 1; return c; }
  function renderStats() {
    var n = 0, area = 0, far = 0;
    for (var i = 0; i < N; i++) if (act[i]) { n++; area += Z[i].a; if (dist[i] > far) far = dist[i]; }
    $('#s-act').textContent = n; $('#s-zon').textContent = st.zones.length; $('#s-area').textContent = Math.round(area).toLocaleString(); $('#s-far').textContent = n ? far.toFixed(0) : '0';
    var c = counts();
    st.zones.forEach(function (z) { var e = $('#zc-' + z.id); if (e) e.textContent = (c[z.id] || 0) + ' ZIPs'; });
    var u = $('#zc-0'); if (u) u.textContent = (c[0] || 0) + ' ZIPs';
    var sc = { S: 0, C: 0, L: 0 }; STORES.forEach(function (o) { if (act[o.zi]) sc[o.k]++; }); ['S', 'C', 'L'].forEach(function (t) { $('#n-' + t).textContent = sc[t]; });
    var inR = 0; for (var j = 0; j < N; j++) if (dist[j] <= st.radius) inR++;
    $('#r-val').textContent = (+st.radius).toFixed(st.radius % 1 ? 1 : 0) + ' mi'; $('#r-ct').textContent = inR + ' of ' + N + ' ZIPs in range';
    var sl = $('#radius'); if (document.activeElement !== sl) sl.value = st.radius; sl.style.setProperty('--fill', ((st.radius - 2) / 58 * 100) + '%');
  }
  function renderZones() {
    var h = st.zones.map(function (z) {
      return '<div class="zone' + (paintZone === z.id ? ' on' : '') + '" data-id="' + z.id + '"><input type="color" id="zcol-' + z.id + '" value="' + z.color + '" aria-label="Color for ' + esc(z.name) + '"><input type="text" id="zname-' + z.id + '" value="' + esc(z.name) + '" maxlength="28" aria-label="Zone name"><span class="ct" id="zc-' + z.id + '"></span><button class="ic" data-a="copy" title="Copy this zone\'s ZIP list" aria-label="Copy ZIP list">' + I.copy + '</button><button class="ic" data-a="del" title="Delete zone. Its ZIPs become unassigned." aria-label="Delete zone">' + I.x + '</button></div>';
    }).join('');
    h += '<div class="zone' + (paintZone === 0 ? ' on' : '') + '" data-id="0"><span class="sw" style="background:' + UNASSIGNED + '55"></span><span class="nm">Unassigned</span><span class="ct" id="zc-0"></span><span></span><span></span></div>';
    $('#zones').innerHTML = h; renderStats();
  }
  function renderLegend() {
    var h = '', i, c;
    if (st.mode === 'zone') {
      c = counts(); h = '<h3>Route zones</h3><ul>' + st.zones.map(function (z) { return '<li><i style="background:' + z.color + '"></i>' + esc(z.name) + '<span>' + (c[z.id] || 0) + '</span></li>'; }).join('') + (c[0] ? '<li><i style="background:' + UNASSIGNED + '"></i>Unassigned<span>' + c[0] + '</span></li>' : '') + '</ul>';
    } else if (st.mode === 'dist') {
      c = [0, 0, 0, 0, 0, 0]; for (i = 0; i < N; i++) if (act[i]) c[bandOf(i)]++;
      h = '<h3>Miles from warehouse</h3><ul>' + BAND_LBL.map(function (l, b) { return '<li><i style="background:' + BAND_COL[b] + '"></i>' + l + '<span>' + c[b] + '</span></li>'; }).join('') + '</ul>';
    } else {
      c = {}; for (i = 0; i < N; i++) if (act[i]) c[Z[i].c] = (c[Z[i].c] || 0) + 1;
      h = '<h3>City</h3><ul>' + Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (n) { return '<li><i style="background:' + cityColor[n] + '"></i>' + esc(n) + '<span>' + c[n] + '</span></li>'; }).join('') + '</ul>';
    }
    h += '<ul class="keys"><li class="g-st"><i class="dot kS"></i>Smoke shop</li><li class="g-st"><i class="dot kC"></i>Convenience store</li><li class="g-st"><i class="dot kL"></i>Liquor store</li><li><i style="border-top:2px solid var(--gold)"></i>Edge of active area</li>' + (st.ring ? '<li><i style="border-top:2px dashed var(--gold)"></i>Range ring</li>' : '') + '</ul>';
    $('#legend').innerHTML = h;
  }
  function renderCard() {
    var c = $('#card');
    if (sel < 0) { c.classList.remove('show'); return; }
    var z = Z[sel];
    c.innerHTML = '<button class="ic x" id="card-x" aria-label="Close">' + I.x + '</button><div><h3>' + z.z + '</h3><div class="city">' + esc(z.c) + ', AZ</div></div>' +
      '<dl><dt>From warehouse</dt><dd>' + dist[sel].toFixed(1) + ' mi</dd><dt>Land area</dt><dd>' + z.a.toLocaleString() + ' sq mi</dd><dt>Status</dt><dd>' + (act[sel] ? 'Active' : 'Inactive') + '</dd></dl>' +
      '<button class="btn' + (act[sel] ? '' : ' gold') + '" id="card-tog">' + (act[sel] ? 'Turn this ZIP off' : 'Turn this ZIP on') + '</button>' +
      '<div><label for="card-zone">Route zone</label><select id="card-zone"><option value="0">Unassigned</option>' + st.zones.map(function (o) { return '<option value="' + o.id + '"' + (zon[sel] === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select></div>';
    var ids = byZip[sel].slice().sort(function (a, b) { return STORES[a].k === STORES[b].k ? (STORES[a].n < STORES[b].n ? -1 : 1) : 'SCL'.indexOf(STORES[a].k) - 'SCL'.indexOf(STORES[b].k); }), h = '', last = '';
    ids.forEach(function (i) {
      var o = STORES[i];
      if (o.k !== last) { last = o.k; h += '<h4><i class="dot k' + o.k + '"></i>' + KPL[o.k] + '<span>' + ids.filter(function (j) { return STORES[j].k === o.k; }).length + '</span></h4>'; }
      h += '<div class="st" data-s="' + i + '"><div><b>' + esc(o.n) + '</b>' + (o.isNew ? '<em>New</em>' : '') + (o.team !== undefined ? '<em class="tm">Team</em>' : '') + '<br><span>' + (o.a ? esc(o.a) + ', ' + esc(z.c) + ', AZ ' + z.z : 'No street address listed') + '</span></div><a href="' + mapsLink(o) + '" target="_blank" rel="noopener" title="Open in Google Maps">Map</a>' + (o.team !== undefined ? '<button class="ic" data-del="' + o.team + '" title="Remove this shop" aria-label="Remove shop">' + I.x + '</button>' : '') + '</div>';
    });
    c.innerHTML += '<div class="stores"><label>Stores in this ZIP</label>' + (h || '<p class="note">No independent stores listed here yet.</p>') + '</div>' +
      '<details class="add" id="add-box"><summary class="btn sm">Add a shop in ' + z.z + '</summary><div class="addf"><input id="add-n" type="text" placeholder="Shop name" maxlength="60" aria-label="Shop name"><select id="add-k" aria-label="Shop type"><option value="S">Smoke or vape shop</option><option value="C">Convenience store</option><option value="L">Liquor store</option></select><input id="add-a" type="text" placeholder="Street address" maxlength="80" aria-label="Street address"><button class="btn gold sm" id="add-go">Add shop</button></div></details>';
    c.classList.add('show');
  }
  function renderHint() {
    var z = zoneById(paintZone), t = {
      inspect: '<b>Inspect.</b> Click a ZIP for its details. Drag to move the map, scroll to zoom.',
      toggle: '<b>Turn on/off.</b> Click or drag across ZIPs to switch them. Hold Space and drag to move the map.',
      paint: '<b>Paint zone.</b> Click or drag across ZIPs to put them in <b>' + esc(z ? z.name : 'Unassigned') + '</b>. Pick another zone in the left panel.',
      hub: '<b>Move warehouse.</b> Click the map where routes start. Distances and the range ring follow it.'
    };
    $('#hint').innerHTML = t[tool];
    [].forEach.call($('#tools').children, function (b) { b.setAttribute('aria-pressed', b.dataset.t === tool); });
    svg.setAttribute('class', 't-' + tool + (st.layers.off ? '' : ' hide-off'));
  }
  function syncButtons() {
    $('#undo').disabled = hpos <= 0; $('#redo').disabled = hpos >= hist.length - 1;
    var dirty = JSON.stringify(core()) !== savedCore, d = $('#dirty');
    d.className = 'chip' + (dirty ? ' warn' : ''); d.lastChild.textContent = dirty ? 'Unsaved changes, only in this browser' : 'Up to date with the saved map';
    $('#revert').disabled = !dirty;
    $('#save').style.display = artifactCap && !readOnly ? '' : 'none'; $('#save').disabled = !dirty;
    $('#link').style.display = window.claude ? 'none' : '';
    $('#csv').textContent = downloadsCap || !window.claude ? 'Download CSV' : 'Copy as CSV'; $('#csv-st').textContent = downloadsCap || !window.claude ? 'Stores CSV' : 'Copy stores CSV';
    $('#save-note').textContent = readOnly ? 'You are viewing a shared map. Changes you make stay in this browser and do not affect anyone else.' : artifactCap ? 'Your edits are kept in this browser as you work. Save for everyone updates the map for anyone who opens the link.' : window.claude ? 'Your edits are kept in this browser as you work.' : 'Your edits are kept in this browser as you work. Copy link to this version gives you a link that opens your exact map, zones and added shops for whoever you send it to.';
  }
  function renderAll() {
    [].forEach.call($('#mode').children, function (b) { b.setAttribute('aria-pressed', b.dataset.m === st.mode); });
    $('#l-zips').checked = st.layers.zips; $('#l-cities').checked = st.layers.cities; $('#l-roads').checked = st.layers.roads; $('#l-off').checked = st.layers.off; ['sS', 'sC', 'sL'].forEach(function (t) { $('#l-' + t).checked = st.layers[t] !== false; }); $('#l-ring').checked = st.ring;
    $('#g-roads').style.display = st.layers.roads ? '' : 'none';
    var h = hubW(); ring.setAttribute('cx', h[0]); ring.setAttribute('cy', h[1]); ring.setAttribute('r', st.radius * MI); ring.style.display = st.ring ? '' : 'none';
    renderZones(); renderLegend(); renderCard(); renderHint(); paintMap(); drawView(); syncButtons();
  }
  var softRaf = 0;
  function soft() { if (!softRaf) softRaf = requestAnimationFrame(function () { softRaf = 0; renderStats(); renderLegend(); syncButtons(); }); }

  /* ---------- feedback ---------- */
  var toastT = 0;
  function toast(msg, btn, fn) {
    $('#toast-t').textContent = msg; var b = $('#toast-b'); b.textContent = btn || ''; b.style.display = btn ? '' : 'none'; b.onclick = function () { $('#toast').classList.remove('show'); if (fn) fn(); };
    $('#toast').classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { $('#toast').classList.remove('show'); }, 4200);
  }
  function copy(text, what) {
    var done = function () { toast(what + ' copied to your clipboard.'); };
    var fb = function () { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { } t.remove(); ok ? done() : toast('Copying is blocked in this view. Open the map in a browser tab and try again.'); };
    try { navigator.clipboard.writeText(text).then(done, fb); } catch (e) { fb(); }
  }
  function csvText() {
    var rows = ['zip,city,status,zone,miles_from_warehouse'];
    for (var i = 0; i < N; i++) { var z = zoneById(zon[i]); rows.push([Z[i].z, '"' + Z[i].c + '"', act[i] ? 'active' : 'inactive', '"' + (act[i] && z ? z.name.replace(/"/g, '""') : '') + '"', dist[i].toFixed(1)].join(',')); }
    return rows.join('\n') + '\n';
  }

  function saveFile(name, text, label) {
    if (downloadsCap) { downloadsCap.save({ filename: name, data: text }).then(function () { toast(label + ' saved.'); }, function (err) { if (err && err.code === 'declined') return; copy(text, 'Download is not available here, so the ' + label + ' was'); }); return; }
    if (!window.claude) { try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast(label + ' downloaded.'); return; } catch (e) { } }
    copy(text, label);
  }
  /* ---------- share links (used when the page is hosted outside Claude) ---------- */
  function b64u(a) { var t = ''; for (var i = 0; i < a.length; i++) t += String.fromCharCode(a[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(t) { t = atob(t.replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a; }
  function pack(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'undefined') return Promise.resolve('j' + b64u(bytes));
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return 'z' + b64u(new Uint8Array(b)); });
  }
  function unpack(t) {
    var bytes = unb64u(t.slice(1));
    if (t[0] === 'j') return Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)));
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
  }

  /* ---------- pointer handling ---------- */
  var ptrs = new Map(), drag = null, space = false, pinch = null;
  function zipAt(x, y) { var e = document.elementFromPoint(x, y); return e && e.getAttribute && e.getAttribute('data-i') !== null && e.classList.contains('zip') ? +e.getAttribute('data-i') : -1; }
  function local(e) { var r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function applyTool(i) {
    if (i < 0 || !drag) return;
    if (!act[i] && !st.layers.off) return;
    if (tool === 'toggle') { if (drag.val === undefined) drag.val = act[i] ? 0 : 1; if (act[i] === drag.val) return; act[i] = drag.val; }
    else if (tool === 'paint') { if (act[i] && zon[i] === paintZone) return; act[i] = 1; zon[i] = paintZone; }
    drag.changed = true; paintZip(i); drawEdges(); soft(); drawView();
  }
  svg.addEventListener('pointerdown', function (e) {
    if (e.button > 1) return;
    try { svg.setPointerCapture(e.pointerId); } catch (x) { }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { var a = Array.from(ptrs.values()); pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) }; drag = null; return; }
    var pan = tool === 'inspect' || tool === 'hub' || space || e.button === 1;
    drag = { pan: pan, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: 0 };
    if (!pan) applyTool(zipAt(e.clientX, e.clientY));
    hideTip();
  });
  svg.addEventListener('pointermove', function (e) {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptrs.size === 2) {
      var a = Array.from(ptrs.values()), d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), r = svg.getBoundingClientRect();
      zoomAt(d / pinch.d, (a[0][0] + a[1][0]) / 2 - r.left, (a[0][1] + a[1][1]) / 2 - r.top); pinch.d = d; return;
    }
    if (drag) {
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
      if (drag.pan) { if (drag.moved > 3) { svg.classList.add('panning'); view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; drawView(); } }
      else applyTool(zipAt(e.clientX, e.clientY));
      return;
    }
    if (e.pointerType !== 'touch') {
      var si = tool === 'inspect' ? storeAt(e.clientX, e.clientY) : -1;
      if (si !== hovS) { hovS = si; drawView(); }
      if (si >= 0) { hover(-1); var o = STORES[si]; tip.innerHTML = '<b>' + esc(o.n) + '</b><br><span>' + KNAME[o.k] + ' · ' + (o.a ? esc(o.a) : 'no street address listed') + ' · ' + Z[o.zi].z + '</span>'; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
      else hover(zipAt(e.clientX, e.clientY), e);
    }
  });
  function up(e) {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    svg.classList.remove('panning');
    if (!drag) return;
    var d = drag; drag = null;
    if (d.pan && d.moved <= 3 && e.type === 'pointerup') {
      if (tool === 'hub') { var p = local(e); st.hub = [+lonOf((p[0] - view.x) / view.k).toFixed(4), +latOf((p[1] - view.y) / view.k).toFixed(4)]; recalcDist(); if (st.ring) applyRadius(st.radius); commit(); renderAll(); toast('Warehouse moved. Distances now measure from the new spot.', 'Undo', function () { undo(-1); }); }
      else if (tool === 'inspect') {
        var si = storeAt(e.clientX, e.clientY);
        if (si >= 0) { sel = STORES[si].zi; renderCard(); drawEdges(); var row = $('#card .st[data-s="' + si + '"]'); if (row) { row.classList.add('hit'); row.scrollIntoView({ block: 'nearest' }); } }
        else { var i = zipAt(e.clientX, e.clientY); sel = i === sel ? -1 : i; renderCard(); drawEdges(); }
      }
    }
    if (d.changed) { commit(); renderCard(); }
  }
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('pointerleave', function () { if (!drag) hover(-1); });
  svg.addEventListener('wheel', function (e) { e.preventDefault(); var p = local(e); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), p[0], p[1]); }, { passive: false });
  svg.addEventListener('dblclick', function (e) { var p = local(e); zoomAt(1.8, p[0], p[1]); });

  var tip = $('#tip');
  function hideTip() { tip.style.display = 'none'; }
  function hover(i, e) {
    if (i !== hov) { var o = hov; hov = i; if (o >= 0) paintZip(o); if (i >= 0) paintZip(i); }
    if (i < 0) { hideTip(); return; }
    var z = Z[i], zn = zoneById(zon[i]);
    tip.innerHTML = '<b>' + z.z + '</b> ' + esc(z.c) + '<br><span>' + dist[i].toFixed(1) + ' mi from warehouse · ' + (act[i] ? (zn ? esc(zn.name) : 'Active, unassigned') : 'Inactive') + '</span>';
    tip.style.display = 'block';
    var w = tip.offsetWidth, x = e.clientX + 14, y = e.clientY + 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 12; if (y + 50 > innerHeight) y = e.clientY - 54;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  /* ---------- controls ---------- */
  function setTool(t) { tool = t; renderHint(); }
  $('#tools').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setTool(b.dataset.t); });
  $('#mode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.m; persist(); renderAll(); });
  $('#radius').addEventListener('input', function () { st.radius = +this.value; st.ring = true; applyRadius(st.radius); $('#l-ring').checked = true; ring.style.display = ''; ring.setAttribute('r', st.radius * MI); paintMap(); soft(); drawView(); });
  $('#radius').addEventListener('change', function () { commit(); renderAll(); });
  $('#p-valley').onclick = function () { for (var i = 0; i < N; i++) act[i] = Z[i].v; st.ring = false; commit(); renderAll(); fitK = fitTo(activeBB()); };
  $('#p-all').onclick = function () { act.fill(1); st.ring = false; commit(); renderAll(); fitK = fitTo(activeBB(), 40); };
  $('#p-none').onclick = function () { act.fill(0); st.ring = false; commit(); renderAll(); toast('All ZIPs turned off.', 'Undo', function () { undo(-1); }); };
  [['l-zips', 'zips'], ['l-cities', 'cities'], ['l-roads', 'roads'], ['l-off', 'off'], ['l-sS', 'sS'], ['l-sC', 'sC'], ['l-sL', 'sL']].forEach(function (p) { $('#' + p[0]).onchange = function () { st.layers[p[1]] = this.checked; if (p[1] === 'off' && !this.checked && sel >= 0 && !act[sel]) sel = -1; persist(); renderAll(); }; });
  $('#l-ring').onchange = function () { st.ring = this.checked; commit(); renderAll(); };

  $('#zones').addEventListener('click', function (e) {
    var row = e.target.closest('.zone'); if (!row) return; var id = +row.dataset.id, a = e.target.closest('[data-a]');
    if (a && a.dataset.a === 'del') {
      st.zones = st.zones.filter(function (z) { return z.id !== id; }); for (var i = 0; i < N; i++) if (zon[i] === id) zon[i] = 0;
      if (paintZone === id) paintZone = st.zones.length ? st.zones[0].id : 0; commit(); renderAll(); toast('Zone deleted. Its ZIPs are now unassigned.', 'Undo', function () { undo(-1); }); return;
    }
    if (a && a.dataset.a === 'copy') { var l = []; for (var j = 0; j < N; j++) if (act[j] && zon[j] === id) l.push(Z[j].z); copy(l.join(', '), zoneById(id).name + ' ZIP list (' + l.length + ')'); return; }
    if (paintZone !== id || tool !== 'paint') {
      paintZone = id; tool = 'paint';
      [].forEach.call($('#zones').children, function (r) { r.classList.toggle('on', +r.dataset.id === id); }); renderHint();
    }
  });
  $('#zones').addEventListener('input', function (e) {
    var row = e.target.closest('.zone'); if (!row) return; var z = zoneById(+row.dataset.id); if (!z) return;
    if (e.target.type === 'color') { z.color = e.target.value; paintMap(); renderLegend(); }
    else { z.name = e.target.value; renderLegend(); renderHint(); }
  });
  $('#zones').addEventListener('change', function (e) { var z = zoneById(+e.target.closest('.zone').dataset.id); if (z && !z.name.trim()) { z.name = 'Zone ' + z.id; renderZones(); } commit(); renderCard(); renderLegend(); });
  $('#z-add').onclick = function () {
    if (st.zones.length >= 24) { toast('24 zones is the limit.'); return; }
    var usedC = st.zones.map(function (z) { return z.color.toUpperCase(); }), col = PALETTE.filter(function (c) { return usedC.indexOf(c) < 0; })[0] || PALETTE[st.zones.length % 12];
    var id = st.nextId++; st.zones.push({ id: id, name: 'Zone ' + (st.zones.length + 1), color: col }); paintZone = id; tool = 'paint'; commit(); renderAll();
    var n = $('#zname-' + id); n.focus(); n.select(); toast('New zone added. Name it, then drag over ZIPs on the map to fill it.');
  };
  $('#z-clear').onclick = function () { zon.fill(0); commit(); renderAll(); toast('All ZIPs unassigned. Zones are kept, just empty.', 'Undo', function () { undo(-1); }); };
  $('#z-auto').onclick = function () {
    var k = Math.max(1, Math.min(12, Math.round(+$('#z-k').value || 8))); $('#z-k').value = k;
    if (!autoZones(k)) { toast('Turn on some ZIPs first, then auto-build.'); return; }
    st.mode = 'zone'; commit(); renderAll(); toast('Built ' + st.zones.length + ' zones from the active ZIPs.', 'Undo', function () { undo(-1); });
  };

  $('#card').addEventListener('click', function (e) {
    if (e.target.closest('#card-x')) { sel = -1; renderCard(); drawEdges(); }
    else if (e.target.closest('#card-tog')) { act[sel] = act[sel] ? 0 : 1; commit(); renderAll(); }
    else if (e.target.closest('[data-del]')) { st.custom.splice(+e.target.closest('[data-del]').getAttribute('data-del'), 1); rebuildStores(); commit(); renderAll(); toast('Shop removed.', 'Undo', function () { undo(-1); }); }
    else if (e.target.closest('#add-go')) {
      var n = $('#add-n').value.trim(); if (!n) { $('#add-n').focus(); toast('Type the shop name first.'); return; }
      st.custom.push({ n: n, k: $('#add-k').value, a: $('#add-a').value.trim(), z: Z[sel].z, d: TODAY }); rebuildStores(); commit(); renderAll();
      toast(n + ' added. It will lead the new shops feed. Save for everyone to share it.');
    }
  });
  $('#card').addEventListener('change', function (e) { if (e.target.id === 'card-zone') { zon[sel] = +e.target.value; if (zon[sel]) act[sel] = 1; commit(); renderAll(); } });

  $('#q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(this.value, true); } });
  $('#q').addEventListener('input', function () { if (/^\d{5}$/.test(this.value.trim())) find(this.value, false); });
  function find(v, loud) {
    v = v.trim(); if (!v) return;
    if (/^\d{5}$/.test(v)) {
      var i = zipIndex[v]; if (i === undefined) { toast(v + ' is not on this map. It may be outside the 60 mile area or a PO-box-only ZIP.'); return; }
      sel = i; tool = 'inspect'; var b = Z[i].bb, m = Math.max(b[2] - b[0], b[3] - b[1]) * 1.6 + 30; fitTo([Z[i].wx - m, Z[i].wy - m, Z[i].wx + m, Z[i].wy + m], 20); renderAll(); return;
    }
    var lc = v.toLowerCase(), c = cityNames.filter(function (n) { return n.toLowerCase() === lc; })[0] || cityNames.filter(function (n) { return n.toLowerCase().indexOf(lc) === 0; })[0];
    if (!c) { if (loud) toast('No ZIP or city matches "' + v + '".'); return; }
    var bb = [1e9, 1e9, -1e9, -1e9]; cities[c].forEach(function (i) { var q = Z[i].bb; bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[2]); bb[3] = Math.max(bb[3], q[3]); });
    fitTo(bb, 90); toast(c + ': ' + cities[c].length + ' ZIP' + (cities[c].length > 1 ? 's' : '') + ' on this map.');
  }

  $('#undo').onclick = function () { undo(-1); }; $('#redo').onclick = function () { undo(1); };
  $('#fit').onclick = function () { fitTo(activeBB()); };
  $('#zin').onclick = function () { var s = size(); zoomAt(1.5, s[0] / 2, s[1] / 2); }; $('#zout').onclick = function () { var s = size(); zoomAt(1 / 1.5, s[0] / 2, s[1] / 2); };
  $('#guide-open').onclick = function () { $('#guide').classList.add('show'); $('#guide-x').focus(); };
  $('#guide-x').onclick = function () { $('#guide').classList.remove('show'); };
  $('#guide').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('show'); });
  window.addEventListener('keydown', function (e) {
    var typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if (e.key === 'Escape') { $('#guide').classList.remove('show'); if (feed.on) feedClose(); if (sel >= 0) { sel = -1; renderCard(); drawEdges(); } }
    if (typing) return;
    if (e.code === 'Space') { space = true; e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
  });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space') space = false; });
  window.addEventListener('resize', drawView);

  $('#copy-active').onclick = function () { var l = []; for (var i = 0; i < N; i++) if (act[i]) l.push(Z[i].z); copy(l.join(', '), 'Active ZIP list (' + l.length + ')'); };
  $('#csv').onclick = function () {
    saveFile('sunset-route-zones.csv', csvText(), 'CSV');
  };
  $('#link').onclick = function () {
    pack(full()).then(function (t) { copy(location.origin + location.pathname + '#v=' + t, 'Link to this version'); }, function () { toast('Could not build the link in this browser.'); });
  };
  $('#revert').onclick = function () { var before = hpos; loadDefaultOrSaved(); commit(); renderAll(); toast('Back to the saved map.', 'Undo', function () { if (hpos > before) undo(-1); }); };
  $('#save').onclick = function () {
    if (!artifactCap) return;
    var b = this; b.disabled = true; b.textContent = 'Saving…';
    var s = full(); s.stamp = Date.now();
    var html = window.SWW_SHELL(JSON.stringify(s).replace(/</g, '\\u003c'));
    artifactCap.publish(html).then(function () { toast('Saved. The map is reloading for everyone.'); }, function (err) {
      b.textContent = 'Save for everyone'; var c = err && err.code;
      if (c === 'conflict') return;
      if (c === 'not_writer' || c === 'not_granted' || c === 'consent_required' || c === 'not_declared' || c === 'capability_disabled') { readOnly = true; syncButtons(); toast('Only the map owner can save for everyone. Your changes stay in this browser.'); }
      else { syncButtons(); toast(c === 'rate_limited' ? 'Saving too often. Wait a minute and try again.' : 'Could not save right now. Your changes are still here, try again shortly.'); }
    });
  };

  /* ---------- new shops feed ---------- */
  var feed = { on: false, kinds: { S: true, C: false, L: false }, list: [], i: 0, play: true, timer: 0, anim: 0 };
  function feedList() { return STORES.map(function (o, i) { return i; }).filter(function (i) { return feed.kinds[STORES[i].k]; }).sort(function (a, b) { return STORES[a].d < STORES[b].d ? 1 : STORES[a].d > STORES[b].d ? -1 : (STORES[b].team || 0) - (STORES[a].team || 0); }).slice(0, 40); }
  function flyTo(x, y, k2) {
    var s = size(), pad = s[0] > 760 ? 350 : 0, cx = (s[0] - pad) / 2, cy = s[1] / 2 + 10, a = { k: view.k, x: (cx - view.x) / view.k, y: (cy - view.y) / view.k }, t0 = performance.now(), dur = 1300;
    cancelAnimationFrame(feed.anim);
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (function step(t) {
      var u = still ? 1 : Math.min(1, (t - t0) / dur), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      var dip = 1 - 0.35 * Math.sin(Math.PI * e), k = a.k * Math.pow(k2 / a.k, e) * dip, wxc = a.x + (x - a.x) * e, wyc = a.y + (y - a.y) * e;
      view.k = k; view.x = cx - wxc * k; view.y = cy - wyc * k; applyView();
      if (u < 1) feed.anim = requestAnimationFrame(step);
    })(t0);
  }
  function feedShow(n, fly) {
    if (!feed.list.length) { pulseAt = null; renderFeed(); drawView(); return; }
    feed.i = (n + feed.list.length) % feed.list.length; var o = STORES[feed.list[feed.i]];
    pulseAt = o; pulse.classList.remove('go'); void pulse.getBoundingClientRect(); pulse.classList.add('go');
    renderFeed(); if (fly !== false) flyTo(o.x, o.y, fitK * 5.5);
    clearTimeout(feed.timer); if (feed.play) feed.timer = setTimeout(function () { feedShow(feed.i + 1); }, 4200);
  }
  function renderFeed() {
    var el = $('#feed'); if (!feed.on) { el.classList.remove('show'); return; }
    var o = feed.list.length ? STORES[feed.list[feed.i]] : null, nNew = STORES.filter(function (q) { return feed.kinds[q.k] && q.isNew; }).length, z = o ? Z[o.zi] : null, zn = o ? zoneById(zon[o.zi]) : null;
    el.innerHTML = '<button class="ic x" id="feed-x" aria-label="Close feed">' + I.x + '</button><div class="eyebrow"><i class="live"></i>New shops feed</div>' +
      '<div class="fcount"><b>' + nNew + '</b><span>listed in the last 90 days<br>' + STORES.filter(function (q) { return feed.kinds[q.k]; }).length + ' on the map in total</span></div>' +
      '<div class="fk">' + ['S', 'C', 'L'].map(function (t) { return '<button data-k="' + t + '" aria-pressed="' + !!feed.kinds[t] + '"><i class="dot k' + t + '"></i>' + { S: 'Smoke', C: 'C-stores', L: 'Liquor' }[t] + '</button>'; }).join('') + '</div>' +
      (o ? '<div class="hero" key="' + feed.i + '"><div class="hk">' + KNAME[o.k] + (o.isNew ? '<em>New</em>' : '') + (o.team !== undefined ? '<em class="tm">Team</em>' : '') + '</div><h3>' + esc(o.n) + '</h3><p>' + (o.a ? esc(o.a) + '<br>' : '') + esc(z.c) + ', AZ ' + z.z + '</p>' +
        '<dl><dt>Listed</dt><dd>' + fmtDate(o.d) + '</dd><dt>From warehouse</dt><dd>' + dist[o.zi].toFixed(1) + ' mi</dd><dt>Route zone</dt><dd>' + (act[o.zi] ? (zn ? esc(zn.name) : 'Unassigned') : 'Outside coverage') + '</dd></dl>' +
        '<div class="row"><button class="btn sm" id="feed-prev">Back</button><button class="btn sm" id="feed-play">' + (feed.play ? 'Pause' : 'Play') + '</button><button class="btn sm" id="feed-next">Next</button><span class="grow"></span><a class="btn sm" href="' + mapsLink(o) + '" target="_blank" rel="noopener">Map</a></div></div>' : '<p class="note">Pick at least one store type above.</p>') +
      '<ol class="flist">' + feed.list.map(function (id, n) { var q = STORES[id]; return '<li data-n="' + n + '"' + (n === feed.i ? ' class="on"' : '') + '><i class="dot k' + q.k + '"></i><span>' + esc(q.n) + '</span><time>' + MONTHS[+q.d.slice(5, 7) - 1] + ' ' + (+q.d.slice(8)) + (q.d.slice(0, 4) !== String(NOW.getFullYear()) ? ' ’' + q.d.slice(2, 4) : '') + '</time></li>'; }).join('') + '</ol>';
    el.classList.add('show');
    var cur = $('.flist li.on', el); if (cur) $('.flist', el).scrollTop = Math.max(0, cur.offsetTop - $('.flist', el).offsetTop - 60);
  }
  function feedOpen() { feed.on = true; feed.play = true; sel = -1; renderCard(); drawEdges(); tool = 'inspect'; renderHint(); feed.list = feedList(); document.body.classList.add('feeding'); feedShow(0); if (window.innerWidth < 861) $('.stage').scrollIntoView(); }
  function feedClose() { feed.on = false; clearTimeout(feed.timer); cancelAnimationFrame(feed.anim); pulseAt = null; document.body.classList.remove('feeding'); renderFeed(); fitTo(activeBB()); }
  $('#feed-open').onclick = feedOpen;
  $('#feed').addEventListener('click', function (e) {
    var b = e.target.closest('button, li'); if (!b) return;
    if (b.id === 'feed-x') feedClose();
    else if (b.id === 'feed-next') feedShow(feed.i + 1);
    else if (b.id === 'feed-prev') feedShow(feed.i - 1);
    else if (b.id === 'feed-play') { feed.play = !feed.play; feedShow(feed.i, false); }
    else if (b.dataset.k) { feed.kinds[b.dataset.k] = !feed.kinds[b.dataset.k]; feed.list = feedList(); feedShow(0); }
    else if (b.dataset.n) feedShow(+b.dataset.n);
  });
  svg.addEventListener('pointerdown', function () { if (feed.on && feed.play) { feed.play = false; clearTimeout(feed.timer); cancelAnimationFrame(feed.anim); renderFeed(); } });
  $('#csv-st').onclick = function () {
    var rows = ['name,type,address,city,zip,zip_status,zone,date_listed,source'];
    var q = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    STORES.forEach(function (o) { var z = Z[o.zi], zn = zoneById(zon[o.zi]); rows.push([q(o.n), q(KNAME[o.k]), q(o.a), q(z.c), z.z, act[o.zi] ? 'active' : 'inactive', q(act[o.zi] && zn ? zn.name : ''), o.d, o.team !== undefined ? 'team' : 'openstreetmap'].join(',')); });
    saveFile('sunset-stores.csv', rows.join('\n') + '\n', 'Stores CSV');
  };

  /* ---------- boot ---------- */
  function loadDefaultOrSaved() {
    if (saved) { loadCore(saved); return; }
    st.hub = D.hub.slice(); st.radius = 25; st.ring = false; st.zones = []; st.nextId = 1; st.custom = []; rebuildStores();
    for (var i = 0; i < N; i++) act[i] = Z[i].v;
    recalcDist(); autoZones(8);
  }
  try { saved = JSON.parse($('#saved-state').textContent); } catch (e) { saved = null; }
  if (saved && !saved.zip) saved = null;
  loadDefaultOrSaved();
  if (saved) { if (saved.mode) st.mode = saved.mode; if (saved.layers) for (var lk in saved.layers) st.layers[lk] = saved.layers[lk]; }
  savedCore = JSON.stringify(core());
  try {
    var dr = JSON.parse(localStorage.getItem('sww-zones-draft'));
    if (dr && dr.base === (saved ? saved.stamp : 0) && dr.state && dr.state.zip) { loadCore(dr.state); if (dr.state.mode) st.mode = dr.state.mode; if (dr.state.layers) for (var lk2 in dr.state.layers) st.layers[lk2] = dr.state.layers[lk2]; }
  } catch (e) { }
  hist = [JSON.stringify(core())]; hpos = 0;
  renderAll(); fitK = fitTo(activeBB()); applyView();
  requestAnimationFrame(function () { fitK = fitTo(activeBB()); });

  if (/^#v=./.test(location.hash)) {
    unpack(location.hash.slice(3)).then(function (c) {
      if (!c || !c.zip) return;
      loadCore(c); if (c.mode) st.mode = c.mode; if (c.layers) for (var k in c.layers) st.layers[k] = c.layers[k];
      hist = [JSON.stringify(core())]; hpos = 0; renderAll(); fitK = fitTo(activeBB());
      toast('Showing the version from your link.');
    }, function () { toast('That link is damaged, so the standard map is shown.'); });
  }
  function caps() {
    if (!window.claude || typeof window.claude.use !== 'function') return false;
    window.claude.use('artifact').then(function (a) { artifactCap = a && a.publish ? a : null; syncButtons(); }, function () { });
    window.claude.use('downloads').then(function (d) { downloadsCap = d || null; syncButtons(); }, function () { });
    return true;
  }
  if (!caps()) { var tries = 0, iv = setInterval(function () { if (caps() || ++tries > 10) clearInterval(iv); }, 500); }
})();
