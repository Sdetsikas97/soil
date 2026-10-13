/* Soil Spectral Library Atlas — static GIS web app (Leaflet). Data built by scripts/build_data.py */
(() => {
  'use strict';

  // ---------- constants ----------
  const ALIAS = { 'United States': 'United States of America', 'DR Congo': 'Dem. Rep. Congo' };
  const atlasName = c => ALIAS[c] || c;
  const MAPPED = ['National', 'Sub-national', 'Multi-country'];
  const SCALES = [
    { key: 'National', label: 'National', v: '--nat' },
    { key: 'Sub-national', label: 'Sub-national', v: '--sub' },
    { key: 'Multi-country', label: 'Multi-country', v: '--mul' },
    { key: 'Global', label: 'Global', v: '--muted' },
    { key: 'Continental / regional', label: 'Continental', v: '--muted' },
  ];
  const SPECS = [
    { key: 'vis-NIR', v: '--s-visnir' }, { key: 'NIR', v: '--s-nir' }, { key: 'MIR', v: '--s-mir' },
    { key: 'LWIR / thermal', v: '--s-lwir' }, { key: 'Not recorded', v: '--s-na' },
  ];
  const SCALE_FILL = { 'National': '--nat', 'Sub-national only': '--sub', 'Multi-country only': '--mul' };
  const COUNT_BINS = [[1, '--seq1', '1'], [2, '--seq2', '2'], [3, '--seq3', '3–4'], [5, '--seq4', '5+']];

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => n == null ? '—' : n.toLocaleString('en-GB');
  const $ = s => document.querySelector(s);
  const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

  // ---------- state ----------
  const state = {
    scales: new Set(SCALES.map(s => s.key)),
    specs: new Set(SPECS.map(s => s.key)),
    continent: '', minSamples: 0, introOnly: false,
    mode: 'scale', showPoints: true, showChoro: true, opacity: 0.8,
    selected: null, // {type:'country'|'library', id}
  };
  let LIBS = [], PAPERS = [], WORLD = null, META = {};
  let map, countryLayer, pointLayer, legendCtl, baseLayers;
  const markers = new Map();
  const papersByRow = new Map();

  // ---------- data ----------
  Promise.all(['data/libraries.json', 'data/papers.json', 'data/countries.geojson', 'data/meta.json']
    .map(u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })))
    .then(([l, p, w, m]) => { LIBS = l; PAPERS = p; WORLD = w; META = m; p.forEach(x => papersByRow.set(x.row, x)); init(); })
    .catch(err => {
      document.querySelector('main').innerHTML = `<p style="padding:24px">Could not load the atlas data (${esc(err.message)}). If you opened index.html directly from disk, serve the folder instead, for example with <code>python -m http.server</code>.</p>`;
    });

  // ---------- filtering ----------
  const libOk = l =>
    l.papers.length > 0 &&
    state.scales.has(l.scale) &&
    l.spectral_tags.some(t => state.specs.has(t)) &&
    (!state.continent || (l.continent || '').includes(state.continent)) &&
    (!state.minSamples || (l.samples || 0) >= state.minSamples) &&
    (!state.introOnly || l.intro_in_review);
  const filtered = () => LIBS.filter(libOk);

  function coverage(libs) {
    const cov = new Map();
    libs.filter(l => MAPPED.includes(l.scale)).forEach(l => l.countries.forEach(c => {
      const k = atlasName(c); if (!cov.has(k)) cov.set(k, []); cov.get(k).push(l);
    }));
    const out = new Map();
    cov.forEach((ls, k) => {
      const best = ls.some(l => l.scale === 'National') ? 'National' : ls.some(l => l.scale === 'Sub-national') ? 'Sub-national only' : 'Multi-country only';
      out.set(k, { libs: ls, best, n: ls.length });
    });
    return out;
  }

  // ---------- init ----------
  function init() {
    buildFilters();
    buildMap();
    buildSearch();
    buildTabs();
    $('#about-meta').textContent = `Built ${META.built} from ${META.source}: ${META.papers} papers screened, ${META.papers_included} included, ${META.libraries} distinct libraries covering ${META.countries} countries.`;
    update();
    routeFromHash();
  }

  function chip(group, key, label, colorVar, shape) {
    const id = `${group}-${key.replace(/\W+/g, '_')}`;
    return `<label class="chip" for="${id}"><input type="checkbox" id="${id}" data-group="${group}" value="${esc(key)}" checked><span class="${shape}" style="background:var(${colorVar})"></span>${esc(label)}</label>`;
  }

  function buildFilters() {
    $('#f-scale').innerHTML = SCALES.map(s => chip('scale', s.key, s.label, s.v, 'sq')).join('');
    $('#f-spec').innerHTML = SPECS.map(s => chip('spec', s.key, s.key, s.v, 'dot')).join('');
    document.querySelectorAll('.chip input').forEach(i => i.addEventListener('change', () => {
      const set = i.dataset.group === 'scale' ? state.scales : state.specs;
      i.checked ? set.add(i.value) : set.delete(i.value); update();
    }));
    const conts = [...new Set(LIBS.flatMap(l => (l.continent || '').split('/').map(s => s.trim())).filter(Boolean))].sort();
    $('#f-cont').insertAdjacentHTML('beforeend', conts.map(c => `<option>${esc(c)}</option>`).join(''));
    $('#f-cont').onchange = e => { state.continent = e.target.value; update(); };
    $('#f-min').onchange = e => { state.minSamples = +e.target.value; update(); };
    $('#f-intro').onchange = e => { state.introOnly = e.target.checked; update(); };
    $('#f-reset').onclick = () => {
      document.querySelectorAll('.chip input').forEach(i => { i.checked = true; });
      SCALES.forEach(s => state.scales.add(s.key)); SPECS.forEach(s => state.specs.add(s.key));
      $('#f-cont').value = ''; $('#f-min').value = '0'; $('#f-intro').checked = false;
      Object.assign(state, { continent: '', minSamples: 0, introOnly: false }); update();
    };
    document.querySelectorAll('input[name="mode"]').forEach(r => r.onchange = () => { state.mode = r.value; update(); });
    $('#l-points').onchange = e => { state.showPoints = e.target.checked; e.target.checked ? pointLayer.addTo(map) : pointLayer.remove(); };
    $('#l-choro').onchange = e => { state.showChoro = e.target.checked; e.target.checked ? countryLayer.addTo(map) : countryLayer.remove(); };
    $('#l-opacity').oninput = e => { state.opacity = +e.target.value; styleCountries(); };
    document.querySelectorAll('[data-export]').forEach(b => b.onclick = () => exportData(b.dataset.export));
  }

  // ---------- map ----------
  function buildMap() {
    map = L.map('map', { worldCopyJump: true, minZoom: 1, maxZoom: 12, zoomSnap: 0.5, preferCanvas: false }).setView([25, 10], 2);
    const carto = 'https://{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{r}.png';
    const cartoAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    baseLayers = {
      'Light (CARTO Positron)': L.tileLayer(carto, { style: 'light_nolabels', attribution: cartoAttr, subdomains: 'abcd', maxZoom: 19 }),
      'Dark (CARTO Dark Matter)': L.tileLayer(carto, { style: 'dark_nolabels', attribution: cartoAttr, subdomains: 'abcd', maxZoom: 19 }),
      'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }),
      'Satellite (Esri World Imagery)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community', maxZoom: 18 }),
      'None (boundaries only)': L.layerGroup(),
    };
    (dark() ? baseLayers['Dark (CARTO Dark Matter)'] : baseLayers['Light (CARTO Positron)']).addTo(map);
    const labels = L.tileLayer(carto, { style: dark() ? 'dark_only_labels' : 'light_only_labels', attribution: cartoAttr, subdomains: 'abcd', pane: 'labels', maxZoom: 19 });
    map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
    map.createPane('libs'); map.getPane('libs').style.zIndex = 460;

    countryLayer = L.geoJSON(WORLD, {
      style: () => ({ weight: 0.6, color: css('--surface'), fillOpacity: state.opacity }),
      onEachFeature: (f, layer) => {
        layer.on({
          mouseover: e => { if (cov.has(f.properties.name)) e.target.setStyle({ weight: 2, color: css('--fg') }); },
          mouseout: e => countryLayer.resetStyle(e.target) && styleOne(e.target),
          click: () => select({ type: 'country', id: f.properties.name }),
        });
        layer.bindTooltip(() => {
          const c = cov.get(f.properties.name);
          return c ? `<b>${esc(f.properties.name)}</b><br>${c.best} · ${c.n} librar${c.n > 1 ? 'ies' : 'y'}` : esc(f.properties.name);
        }, { sticky: true, direction: 'top', offset: [0, -6] });
      },
    }).addTo(map);
    pointLayer = L.layerGroup().addTo(map);
    labels.addTo(map);

    L.control.layers(baseLayers, { 'Country shading': countryLayer, 'Library locations': pointLayer, 'Place labels': labels }, { position: 'topright', collapsed: true }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
    map.on('overlayadd overlayremove', e => {
      if (e.layer === countryLayer) $('#l-choro').checked = e.type === 'overlayadd';
      if (e.layer === pointLayer) $('#l-points').checked = e.type === 'overlayadd';
    });

    const Home = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const d = L.DomUtil.create('div', 'leaflet-bar');
        d.innerHTML = '<a href="#" class="home-btn" title="Zoom to all libraries" role="button" aria-label="Zoom to all libraries">⌂</a>';
        L.DomEvent.on(d.firstChild, 'click', e => { L.DomEvent.preventDefault(e); fitAll(); });
        L.DomEvent.disableClickPropagation(d);
        return d;
      },
    });
    new Home().addTo(map);
    legendCtl = L.control({ position: 'bottomright' });
    legendCtl.onAdd = () => L.DomUtil.create('div', 'legend');
    legendCtl.addTo(map);

    const co = $('#coords');
    map.on('mousemove', e => { const w = e.latlng.wrap(); co.textContent = `${w.lat.toFixed(3)}°, ${w.lng.toFixed(3)}°`; });
    map.on('mouseout', () => { co.textContent = ''; });
    map.on('zoomend', placeMarkers);
  }

  let cov = new Map();
  function fillFor(name) {
    const c = cov.get(name);
    if (!c) return css('--none');
    if (state.mode === 'scale') return css(SCALE_FILL[c.best]);
    const bin = [...COUNT_BINS].reverse().find(b => c.n >= b[0]);
    return css(bin[1]);
  }
  function styleOne(layer) {
    const name = layer.feature.properties.name;
    const sel = state.selected?.type === 'country' && state.selected.id === name;
    layer.setStyle({
      fillColor: fillFor(name), fillOpacity: cov.has(name) ? state.opacity : state.opacity * 0.55,
      color: sel ? css('--fg') : css('--surface'), weight: sel ? 2.2 : 0.6,
    });
    if (sel) layer.bringToFront();
  }
  function styleCountries() { countryLayer.eachLayer(styleOne); }

  function specColor(l) {
    if (l.spectral_tags.length > 1) return css('--s-multi');
    return css(SPECS.find(s => s.key === l.spectral_tags[0])?.v || '--s-na');
  }
  const radius = l => l.samples ? 4 + 2.6 * Math.log10(l.samples) : 5;

  function drawPoints(libs) {
    pointLayer.clearLayers(); markers.clear();
    libs.filter(l => l.point).forEach(l => {
      const m = L.circleMarker([l.point[1], l.point[0]], {
        pane: 'libs', radius: radius(l), color: css('--surface'), weight: 1.2,
        fillColor: specColor(l), fillOpacity: l.samples ? 0.9 : 0.35,
      });
      m.bindTooltip(`<b>${esc(l.name)}</b><br>${esc(l.scale)} · ${l.samples ? fmt(l.samples) + ' samples' : 'size not recorded'}<br>${esc(l.spectral_tags.join(', '))}`, { direction: 'top', offset: [0, -4] });
      m.on('click', e => { L.DomEvent.stopPropagation(e); select({ type: 'library', id: l.id }); });
      m._lib = l; markers.set(l.id, m); pointLayer.addLayer(m);
    });
    placeMarkers();
  }

  // spread markers that share a location into a small ring (pixel space, recomputed on zoom)
  function placeMarkers() {
    const groups = new Map();
    markers.forEach(m => { const k = m._lib.point.join(','); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
    groups.forEach(ms => {
      const base = map.latLngToLayerPoint([ms[0]._lib.point[1], ms[0]._lib.point[0]]);
      if (ms.length === 1) { ms[0].setLatLng(map.layerPointToLatLng(base)); return; }
      const r = 10 + ms.length * 3.2;
      ms.sort((a, b) => (b._lib.samples || 0) - (a._lib.samples || 0)).forEach((m, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / ms.length;
        m.setLatLng(map.layerPointToLatLng(base.add([r * Math.cos(a), r * Math.sin(a)])));
      });
    });
  }

  function drawLegend(libs) {
    const el = legendCtl.getContainer();
    let h = '';
    if (state.showChoro) {
      h += `<h4>${state.mode === 'scale' ? 'Highest library scale' : 'Libraries per country'}</h4>`;
      h += state.mode === 'scale'
        ? Object.entries(SCALE_FILL).map(([k, v]) => `<div class="it"><span class="sq" style="background:var(${v})"></span>${k}</div>`).join('')
        : COUNT_BINS.map(b => `<div class="it"><span class="sq" style="background:var(${b[1]})"></span>${b[2]}</div>`).join('');
      h += `<div class="it"><span class="sq" style="background:var(--none)"></span>None in inventory</div>`;
    }
    if (state.showPoints) {
      h += `${h ? '<div class="gap"></div>' : ''}<h4>Library points</h4>`;
      h += SPECS.filter(s => s.key !== 'Not recorded').map(s => `<div class="it"><span class="dot" style="background:var(${s.v})"></span>${s.key}</div>`).join('');
      h += `<div class="it"><span class="dot" style="background:var(--s-multi)"></span>Several ranges</div>`;
      h += `<div class="it"><span class="dot" style="background:var(--s-na);opacity:.5"></span>Range or size not recorded</div>`;
      h += `<div class="hint" style="font-size:11px;margin-top:2px">Size ∝ log(samples)</div>`;
    }
    const prev = el.querySelector('details');
    const open = prev ? prev.open : innerWidth > 820;
    el.innerHTML = h ? `<details ${open ? 'open' : ''}><summary>Legend</summary>${h}</details>` : '';
    el.hidden = !h;
    L.DomEvent.disableClickPropagation(el);
  }

  function fitAll() {
    const pts = filtered().filter(l => l.point).map(l => [l.point[1], l.point[0]]);
    pts.length ? map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 5 }) : map.setView([25, 10], 2);
  }

  // ---------- update ----------
  function update() {
    const libs = filtered();
    cov = coverage(libs);
    styleCountries();
    drawPoints(libs);
    drawLegend(libs);
    const nat = [...cov.values()].filter(c => c.best === 'National').length;
    $('#stats').innerHTML = [
      [libs.length, 'libraries'], [cov.size, 'countries'], [nat, 'with a national library'],
      [libs.filter(l => !MAPPED.includes(l.scale)).length, 'global or continental'],
    ].map(([n, t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('');
    const glob = libs.filter(l => !MAPPED.includes(l.scale));
    $('#glob-n').textContent = glob.length;
    $('#glob').innerHTML = glob.map(libButton).join('') || '<li class="hint">None match the filters.</li>';
    bindLibButtons($('#glob'));
    renderLibTable(libs);
    if (state.selected) renderDetails();
  }

  // ---------- details ----------
  const scaleVar = s => (SCALES.find(x => x.key === s) || {}).v || '--muted';
  function libButton(l) {
    return `<li><button class="lib-btn" data-lib="${esc(l.id)}"><span class="sq" style="background:var(${scaleVar(l.scale)})"></span><span><span class="nm">${esc(l.name)}</span><small>${esc(l.scale)} · ${l.samples ? fmt(l.samples) + ' samples' : 'size not recorded'} · ${esc(l.spectral_tags.join(', '))}</small></span></button></li>`;
  }
  function bindLibButtons(root) { root.querySelectorAll('[data-lib]').forEach(b => b.onclick = () => select({ type: 'library', id: b.dataset.lib }, true)); }

  function select(sel, fly) {
    state.selected = sel;
    styleCountries();
    renderDetails();
    if (fly) {
      if (sel.type === 'library') {
        const l = LIBS.find(x => x.id === sel.id);
        if (l?.point) map.flyTo([l.point[1], l.point[0]], Math.max(map.getZoom(), l.scale === 'Sub-national' ? 5 : 4), { duration: 0.8 });
      } else {
        let lyr; countryLayer.eachLayer(x => { if (x.feature.properties.name === sel.id) lyr = x; });
        if (lyr) map.flyToBounds(lyr.getBounds(), { maxZoom: 5, duration: 0.8 });
      }
    }
    markers.forEach((m, id) => m.setStyle({ color: sel.type === 'library' && id === sel.id ? css('--fg') : css('--surface'), weight: sel.type === 'library' && id === sel.id ? 2.5 : 1.2 }));
    const m = markers.get(sel.id); if (m) m.bringToFront();
    history.replaceState(null, '', `#map/${sel.type}/${encodeURIComponent(sel.id)}`);
  }

  function renderDetails() {
    const el = $('#details'), s = state.selected;
    if (!s) { el.innerHTML = '<p class="hint">Click a country or a library point to see its details.</p>'; return; }
    if (s.type === 'country') {
      const all = LIBS.filter(l => l.papers.length && MAPPED.includes(l.scale) && l.countries.some(c => atlasName(c) === s.id));
      const shown = all.filter(libOk);
      const c = cov.get(s.id);
      el.innerHTML = `<div><div class="k">Country</div><h2>${esc(s.id)}</h2></div>
        ${c ? `<p class="hint">${c.best} · ${c.n} librar${c.n > 1 ? 'ies' : 'y'} match the filters${all.length > shown.length ? ` (${all.length - shown.length} hidden by filters)` : ''}.</p>` :
        all.length ? `<p class="hint">${all.length} librar${all.length > 1 ? 'ies' : 'y'} here, all hidden by the current filters.</p>` : '<p class="hint">No soil spectral library in the inventory. Global libraries may still hold samples from here.</p>'}
        <ul>${shown.map(libButton).join('')}</ul>
        <button class="btn" type="button" id="d-clear">Clear selection</button>`;
      bindLibButtons(el);
    } else {
      const l = LIBS.find(x => x.id === s.id);
      if (!l) { el.innerHTML = ''; return; }
      const ps = l.papers.map(r => papersByRow.get(r)).filter(Boolean)
        .sort((a, b) => ['Introduces', 'Extends / updates', 'Methods for', 'Uses'].indexOf(a.role) - ['Introduces', 'Extends / updates', 'Methods for', 'Uses'].indexOf(b.role) || String(a.year).localeCompare(String(b.year)));
      el.innerHTML = `<div><div class="k">${esc(l.id)} · ${esc(l.scale)}</div><h2>${esc(l.name)}</h2></div>
        <dl>
          <dt>Countries</dt><dd>${l.countries.length ? l.countries.map(c => `<a href="#" data-country="${esc(atlasName(c))}">${esc(c)}</a>`).join(', ') : esc(l.continent || '—')}</dd>
          <dt>Spectral</dt><dd>${l.spectral_tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}${l.spectral ? `<br><small>${esc(l.spectral)}</small>` : ''}</dd>
          <dt>Size</dt><dd>${esc(l.size_text || 'Not recorded')}</dd>
          <dt>Data</dt><dd>${esc(l.availability || 'Not recorded')}</dd>
          <dt>Introduced</dt><dd>${l.intro_ref ? esc(l.intro_ref) : '<em>Introducing paper not in the review</em>'}</dd>
          ${l.point ? `<dt>Location</dt><dd>${l.point[1].toFixed(2)}°, ${l.point[0].toFixed(2)}° <small>(${l.point_source === 'study region' ? 'approx. study region' : l.countries.length > 1 ? 'mean of member-country centroids' : 'country centroid'})</small></dd>` : ''}
        </dl>
        ${l.notes ? `<p class="warn">${esc(l.notes)}</p>` : ''}
        <div><div class="k" style="margin-bottom:6px">Papers in the review · ${ps.length}</div>
        <ul>${ps.map(paperLi).join('')}</ul></div>
        <button class="btn" type="button" id="d-clear">Clear selection</button>`;
      el.querySelectorAll('[data-country]').forEach(a => a.onclick = e => { e.preventDefault(); select({ type: 'country', id: a.dataset.country }, true); });
    }
    $('#d-clear').onclick = () => { state.selected = null; styleCountries(); markers.forEach(m => m.setStyle({ color: css('--surface'), weight: 1.2 })); renderDetails(); history.replaceState(null, '', '#map'); };
  }
  function paperLi(p) {
    const t = p.doi ? `<a href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title);
    return `<li class="paper"><span><span class="tag">${esc(p.role || '—')}</span>${esc(p.ref)}</span><small>${t}</small></li>`;
  }

  // ---------- search ----------
  function buildSearch() {
    const countries = [...new Set(LIBS.filter(l => l.papers.length).flatMap(l => l.countries))].sort();
    const opts = [...countries.map(c => ({ v: c, t: 'country', id: atlasName(c) })), ...LIBS.filter(l => l.papers.length).map(l => ({ v: l.name, t: 'library', id: l.id }))];
    $('#q-list').innerHTML = opts.map(o => `<option value="${esc(o.v)}">${o.t === 'country' ? 'Country' : 'Library'}</option>`).join('');
    const go = () => {
      const v = $('#q').value.trim().toLowerCase(); if (!v) return;
      const hit = opts.find(o => o.v.toLowerCase() === v) || opts.find(o => o.v.toLowerCase().includes(v)) ||
        (() => { const l = LIBS.find(x => x.id.toLowerCase() === v); return l && { t: 'library', id: l.id }; })();
      if (!hit) return;
      showView('map');
      select({ type: hit.t, id: hit.id }, true);
    };
    $('#q').addEventListener('change', go);
    $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  // ---------- tabs / routing ----------
  function buildTabs() {
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { showView(b.dataset.view); history.replaceState(null, '', '#' + b.dataset.view); });
    window.addEventListener('hashchange', routeFromHash);
  }
  function showView(v) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
    document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
    if (v === 'map') setTimeout(() => map.invalidateSize(), 0);
    if (v === 'papers' && !$('#pap-table tbody').children.length) renderPapers();
  }
  function routeFromHash() {
    const [v, t, id] = location.hash.replace(/^#/, '').split('/');
    if (['map', 'libraries', 'papers', 'about'].includes(v)) showView(v); else showView('map');
    if (v === 'map' && t && id) select({ type: t, id: decodeURIComponent(id) }, true);
  }

  // ---------- tables ----------
  function sortable(table, cols, rows, onRow) {
    let key = table.dataset.sort || null, dir = +(table.dataset.dir || 1);
    const thead = table.tHead, tbody = table.tBodies[0];
    thead.innerHTML = '<tr>' + cols.map(c => `<th data-k="${c.k}" ${c.k === key ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.t}</th>`).join('') + '</tr>';
    const sorted = key ? [...rows].sort((a, b) => {
      const c = cols.find(x => x.k === key), va = c.sv ? c.sv(a) : a[key], vb = c.sv ? c.sv(b) : b[key];
      return (va == null) - (vb == null) || (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    }) : rows;
    tbody.innerHTML = sorted.map(r => `<tr class="${onRow ? 'clickable' : ''}" data-id="${esc(r.id ?? r.row)}">${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r) : esc(r[c.k] ?? '—')}</td>`).join('')}</tr>`).join('');
    thead.querySelectorAll('th').forEach(th => th.onclick = () => {
      dir = th.dataset.k === key ? -dir : 1; key = th.dataset.k; table.dataset.sort = key; table.dataset.dir = dir;
      sortable(table, cols, rows, onRow);
    });
    if (onRow) tbody.querySelectorAll('tr').forEach(tr => tr.onclick = e => { if (e.target.closest('a')) return; onRow(tr.dataset.id); });
  }

  function renderLibTable(libs) {
    $('#lib-n').textContent = `${libs.length} of ${LIBS.filter(l => l.papers.length).length}`;
    sortable($('#lib-table'), [
      { k: 'name', t: 'Library' },
      { k: 'scale', t: 'Scale' },
      { k: 'countries', t: 'Countries', f: l => esc(l.countries.join(', ') || '—'), sv: l => l.countries.join(',') || null },
      { k: 'spectral_tags', t: 'Spectral', f: l => l.spectral_tags.map(t => `<span class="tag">${esc(t)}</span>`).join(''), sv: l => l.spectral_tags.join(',') },
      { k: 'samples', t: 'Samples', num: true, f: l => fmt(l.samples) },
      { k: 'papers', t: 'Papers', num: true, f: l => l.papers.length, sv: l => l.papers.length },
      { k: 'intro_ref', t: 'Introduced by', f: l => l.intro_ref ? esc(l.intro_ref) : '<span class="hint">not in review</span>' },
    ], libs, id => { showView('map'); select({ type: 'library', id }, true); });
  }

  function renderPapers() {
    const decs = [...new Set(PAPERS.map(p => p.decision))], roles = [...new Set(PAPERS.map(p => p.role).filter(Boolean))];
    if ($('#p-dec').options.length === 1) {
      $('#p-dec').insertAdjacentHTML('beforeend', decs.map(d => `<option>${esc(d)}</option>`).join(''));
      $('#p-role').insertAdjacentHTML('beforeend', roles.map(d => `<option>${esc(d)}</option>`).join(''));
      ['#p-dec', '#p-role'].forEach(s => $(s).onchange = renderPapers);
      $('#p-q').oninput = renderPapers;
    }
    const d = $('#p-dec').value, r = $('#p-role').value, q = $('#p-q').value.trim().toLowerCase();
    const libName = id => LIBS.find(l => l.id === id)?.name || id;
    const rows = PAPERS.filter(p => (!d || p.decision === d) && (!r || p.role === r) &&
      (!q || [p.authors, p.title, p.year, ...p.libraries, ...p.libraries.map(libName)].join(' ').toLowerCase().includes(q)));
    $('#pap-n').textContent = `${rows.length} of ${PAPERS.length}`;
    const pill = dd => `<span class="pill ${dd === 'Include' ? 'inc' : dd === 'Check' ? 'chk' : 'exc'}">${esc(dd)}</span>`;
    sortable($('#pap-table'), [
      { k: 'row', t: 'Row', num: true },
      { k: 'ref', t: 'Reference' },
      { k: 'title', t: 'Title', f: p => p.doi ? `<a href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title) },
      { k: 'decision', t: 'Decision', f: p => pill(p.decision) },
      { k: 'role', t: 'Role' },
      { k: 'libraries', t: 'Library', f: p => p.libraries.map(id => `<a href="#map/library/${encodeURIComponent(id)}">${esc(id)}</a>`).join(', ') || '—', sv: p => p.libraries.join(',') || null },
      { k: 'note', t: 'Notes', f: p => `<span class="hint">${esc(p.note || '')}</span>` },
    ], rows);
  }

  // ---------- export ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const libProps = l => ({
    id: l.id, name: l.name, scale: l.scale, countries: l.countries.join('; '), continent: l.continent,
    spectral: l.spectral_tags.join('; '), samples: l.samples, data_availability: l.availability,
    introducing_paper: l.intro_ref, papers_in_review: l.papers.length, location_source: l.point_source,
  });
  function exportData(kind) {
    const libs = filtered(), stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'libs-geojson') {
      const fc = { type: 'FeatureCollection', features: libs.map(l => ({ type: 'Feature', properties: libProps(l), geometry: l.point ? { type: 'Point', coordinates: l.point } : null })) };
      download(`ssl_libraries_${stamp}.geojson`, JSON.stringify(fc, null, 1), 'application/geo+json');
    } else if (kind === 'countries-geojson') {
      const c = coverage(libs);
      const fc = { type: 'FeatureCollection', features: WORLD.features.map(f => {
        const x = c.get(f.properties.name);
        return { type: 'Feature', geometry: f.geometry, properties: { name: f.properties.name, iso_n3: f.properties.iso_n3, n_libraries: x ? x.n : 0, highest_scale: x ? x.best : 'None', library_ids: x ? x.libs.map(l => l.id).join(';') : '' } };
      }) };
      download(`ssl_countries_${stamp}.geojson`, JSON.stringify(fc), 'application/geo+json');
    } else {
      const rows = libs.map(l => ({ ...libProps(l), lon: l.point?.[0] ?? '', lat: l.point?.[1] ?? '' }));
      const keys = Object.keys(rows[0] || libProps(LIBS[0]));
      const q = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      download(`ssl_libraries_${stamp}.csv`, [keys.join(','), ...rows.map(r => keys.map(k => q(r[k])).join(','))].join('\n'), 'text/csv');
    }
  }
})();
