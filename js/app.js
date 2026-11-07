/* ==========================================================================
   BestHouse.uz — интерактивная карта недвижимости и агрегатор площадок
   ========================================================================== */
(function () {
  'use strict';
  const { listings, env, classify, fmt, favs, theme, platforms } = BH;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------------- Уведомления (Toast) ---------------- */
  let toastTimer;
  function showToast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------------- Карта ---------------- */
  const map = L.map('map', { zoomControl: false, minZoom: 10, maxZoom: 18 }).setView(BH.CENTER, 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Порядок отрисовки: тепловые поля < изохроны/парки < дороги < метро < маркеры
  [['envPane', 350], ['isoPane', 380], ['trafficPane', 410], ['transitPane', 440]].forEach(([n, z]) => {
    map.createPane(n).style.zIndex = z;
  });
  map.getPane('envPane').style.pointerEvents = 'none';

  // Подписи рисуем поверх тепловых слоёв, чтобы названия улиц оставались читаемыми
  map.createPane('labelsPane').style.zIndex = 445;
  map.getPane('labelsPane').style.pointerEvents = 'none';

  // Esri Canvas — без API-ключа и без требований к Referer (работает и с file://)
  const esri = (name, opts = {}) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap', ...opts });
  const basemaps = {
    light: L.layerGroup([esri('World_Light_Gray_Base'), esri('World_Light_Gray_Reference', { pane: 'labelsPane' })]),
    dark: L.layerGroup([esri('World_Dark_Gray_Base'), esri('World_Dark_Gray_Reference', { pane: 'labelsPane' })]),
    osm: L.layerGroup([L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 })])
  };
  let currentBaseName = 'light';
  let currentBase = basemaps.light.addTo(map);

  function setBasemap(name) {
    if (!basemaps[name]) return;
    currentBaseName = name;
    $$('#basemapSeg button').forEach((x) => x.classList.toggle('active', x.dataset.base === name));
    map.removeLayer(currentBase);
    currentBase = basemaps[name].addTo(map);
    document.body.classList.toggle('map-dark', name === 'dark');
  }

  /* ---------------- Тема оформления ---------------- */
  const initTheme = theme.get();
  theme.set(initTheme);
  if (initTheme === 'dark') setBasemap('dark');

  $('#themeToggle').addEventListener('click', () => {
    const next = theme.get() === 'dark' ? 'light' : 'dark';
    theme.set(next);
    if (next === 'dark' && currentBaseName === 'light') setBasemap('dark');
    if (next === 'light' && currentBaseName === 'dark') setBasemap('light');
  });

  /* ---------------- Слои ---------------- */
  const layers = {
    air: new BHLayers.EnvGridLayer({ valueFn: env.aqiAt, colorFn: BH.scales.aqi, alpha: 0.5 }),
    noise: new BHLayers.EnvGridLayer({ valueFn: env.noiseAt, colorFn: BH.scales.noise, alpha: 0.5 }),
    traffic: BHLayers.createTrafficLayer(),
    transit: BHLayers.createTransitLayer()
  };

  /* ---------------- Состояние ---------------- */
  const prices = listings.map((l) => l.price);
  const PRICE_MIN = Math.floor(Math.min(...prices) / 5000) * 5000;
  const PRICE_MAX = Math.ceil(Math.max(...prices) / 5000) * 5000;
  const DEFAULTS = () => ({
    query: '',
    district: '',
    sources: new Set(),
    types: new Set(),
    rooms: new Set(),
    priceMin: PRICE_MIN,
    priceMax: PRICE_MAX,
    maxAqi: 200,
    maxNoise: 80,
    maxWalk: 60,
    onlyFavs: false,
    sort: 'eco',
    onlyInView: true
  });
  let state = DEFAULTS();
  let hour = new Date().getHours();
  let markerMode = 'price'; // 'price' | 'ppm' | 'eco'
  let filtered = [];
  let listLimit = 40;
  let activeId = null;

  // Заполняем список районов
  const distSel = $('#districtSelect');
  BH.districts.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    distSel.appendChild(opt);
  });

  /* ---------------- Маркеры ---------------- */
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
    iconCreateFunction(c) {
      const ms = c.getAllChildMarkers();
      const avgAqi = ms.reduce((s, m) => s + m.listing.aqi, 0) / ms.length;
      const minPrice = Math.min(...ms.map((m) => m.listing.price));
      const n = ms.length;
      const size = n < 10 ? 44 : n < 30 ? 52 : 60;
      return L.divIcon({
        className: 'bh-cluster',
        html: `<div style="--ring:${classify.aqi(avgAqi).color}"><b>${n}</b><small>от ${fmt.short(minPrice)}</small></div>`,
        iconSize: [size, size]
      });
    }
  });

  function markerLabel(l) {
    if (markerMode === 'ppm') return `$${l.pricePerM2.toLocaleString('ru-RU')}/м²`;
    if (markerMode === 'eco') return `Эко ${l.ecoRating}`;
    return fmt.short(l.price);
  }

  function markerIcon(l, active) {
    const a = classify.aqi(l.aqi), n = classify.noise(l.noise);
    const isFav = favs.get().has(l.id);
    return L.divIcon({
      className: 'pm-wrap',
      html: `<div class="pm ${active ? 'active' : ''} ${isFav ? 'is-fav' : ''}" data-id="${l.id}">
               <i class="pm-dot" style="background:${a.color}" title="AQI ${l.aqi}"></i>
               <i class="pm-dot" style="background:${n.color}" title="${l.noise} дБ"></i>
               <span>${markerLabel(l)}</span>
               ${isFav ? '<em class="pm-heart">♥</em>' : ''}
             </div>`,
      iconSize: null,
      iconAnchor: [0, 0],
      popupAnchor: [0, -34]
    });
  }

  const markers = new Map();
  let popupJustClosedAt = 0;

  function registerListingMarker(l) {
    if (markers.has(l.id)) return markers.get(l.id);
    const m = L.marker([l.lat, l.lng], { icon: markerIcon(l, false), riseOnHover: true, title: l.title });
    m.listing = l;
    m.bindPopup(() => popupHtml(l), {
      maxWidth: 320, minWidth: 300, className: 'bh-popup',
      autoPanPaddingTopLeft: [20, 80], autoPanPaddingBottomRight: [20, 20]
    });
    m.on('popupopen', () => {
      setActive(l.id);
      syncUrlHash();
    });
    m.on('popupclose', () => {
      popupJustClosedAt = Date.now();
      if (activeId === l.id) setActive(null);
      syncUrlHash();
    });
    markers.set(l.id, m);
    return m;
  }

  listings.forEach(registerListingMarker);
  map.addLayer(cluster);

  function refreshAllMarkerIcons() {
    markers.forEach((m, id) => {
      m.setIcon(markerIcon(m.listing, id === activeId));
    });
    cluster.refreshClusters();
  }

  function setActive(id) {
    const prev = activeId;
    activeId = id;
    [prev, id].forEach((x) => {
      if (x == null) return;
      const m = markers.get(x);
      if (m) {
        m.setIcon(markerIcon(m.listing, x === id));
        m.setZIndexOffset(x === id ? 1000 : 0);
      }
    });
    $$('.card').forEach((c) => c.classList.toggle('active', +c.dataset.id === id));
  }

  /* ---------------- Поп-ап объекта ---------------- */
  function ecoCell(label, value, sub, color) {
    return `<div class="eco-cell"><span class="eco-label">${label}</span>
              <span class="eco-value"><i style="background:${color}"></i>${value}</span>
              <span class="eco-sub">${sub}</span></div>`;
  }
  function popupHtml(l) {
    const a = classify.aqi(l.aqi), n = classify.noise(l.noise), ec = classify.eco(l.ecoRating);
    const src = platforms[l.source] || platforms.olx;
    const isFav = favs.get().has(l.id);
    const walkColor = l.metro.walkMin <= 5 ? '#1fbf6a' : l.metro.walkMin <= 10 ? '#8fbf3a' : l.metro.walkMin <= 15 ? '#e8b715' : '#f08a24';
    const propUrl = BH.buildPropertyPageUrl(l);
    return `
      <article class="pop">
        <div class="pop-photo-wrap">
          <a class="pop-photo" href="${propUrl}">
            <img src="${l.photos[0]}" alt="${l.title}" loading="lazy" onerror="this.onerror=null;this.src='https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg'" />
            <span class="badge">${l.type}</span>
            <span class="badge-src" style="background:${src.badgeBg};color:${src.badgeColor}">${src.name}</span>
            <span class="badge-eco" style="background:${ec.color}" title="Комплексный эко-рейтинг локации">Эко ${l.ecoRating}/100</span>
            <span class="pop-photos-count">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-8 7"/></svg>${l.photos.length}
            </span>
          </a>
          <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${l.id}" aria-label="В избранное" title="В избранное">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </div>
        <div class="pop-body">
          <div class="pop-price">${fmt.usd(l.price)} <small>${fmt.usd(l.pricePerM2)}/м²</small></div>
          <div class="pop-uzs">≈ ${fmt.uzs(l.price)}</div>
          <div class="pop-specs">
            <span><b>${l.rooms}</b> комн.</span><span><b>${l.area}</b> м²</span>
            <span><b>${l.floor}</b>/${l.totalFloors} эт.</span>
            <span><b>${l.year}</b> г.</span>
          </div>
          <div class="pop-addr">${l.complex ? `<b>${l.complex}</b> · ` : ''}${l.address}</div>
          <div class="eco-grid">
            ${ecoCell('Воздух', `AQI ${l.aqi}`, `${a.label} · PM2.5 ${l.pm25}`, a.color)}
            ${ecoCell('Шум', `${l.noise} дБ`, `${n.label} · ${classify.noisePoints(l.noise)}/10`, n.color)}
            ${ecoCell('Метро', `${l.metro.walkMin} мин`, `<span class="metro-m sm" style="background:${l.metro.color}">M</span>${l.metro.name}`, walkColor)}
          </div>
          <div class="pop-actions">
            <a class="btn-primary" href="${propUrl}">Подробнее
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </a>
            <a class="btn-ext-portal" href="${l.externalUrl}" target="_blank" rel="noopener noreferrer" title="Открыть объявление или поиск на ${src.name}">
              <span>${src.short}</span>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>
      </article>`;
  }

  // Делегирование клика по кнопке избранного
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = +btn.dataset.fav;
    const added = favs.toggle(id);
    btn.classList.toggle('active', added);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
    showToast(added ? 'Добавлено в избранное' : 'Удалено из избранного');
    updateFavUI();
    const m = markers.get(id);
    if (m) m.setIcon(markerIcon(m.listing, id === activeId));
    if (state.onlyFavs) applyFilters();
    else renderList();
  });

  function updateFavUI() {
    const count = favs.get().size;
    const badge = $('#favCount');
    badge.textContent = count;
    badge.hidden = count === 0;
    $('#favFilterBtn').classList.toggle('active', state.onlyFavs);
  }

  $('#favFilterBtn').addEventListener('click', () => {
    if (!state.onlyFavs && favs.get().size === 0) {
      showToast('Нажмите на сердечко у любого объекта, чтобы добавить в избранное');
      return;
    }
    state.onlyFavs = !state.onlyFavs;
    updateFavUI();
    applyFilters();
  });

  /* ---------------- Экология произвольной точки ---------------- */
  const pointMarker = L.circleMarker([0, 0], {
    radius: 7, color: '#2f6bff', weight: 2.5, fillColor: '#fff', fillOpacity: 1,
    pane: 'transitPane', interactive: false
  });

  map.on('click', (e) => {
    if (Date.now() - popupJustClosedAt < 220) return;

    const ll = [e.latlng.lat, e.latlng.lng];
    const aqi = Math.round(env.aqiAt(...ll)), noise = Math.round(env.noiseAt(...ll));
    const a = classify.aqi(aqi), n = classify.noise(noise);
    const near = BH.geo.nearestStations(ll, 2);
    const nearPark = BH.geo.nearestPark(ll);
    const ecoScore = env.ecoScoreAt(aqi, noise, near[0].walkMin, nearPark.dist);
    const ec = classify.eco(ecoScore);
    const road = BH.geo.nearestRoad(ll);
    const cong = env.congestion(road.road, hour);
    const t = classify.traffic(cong);
    const walkBand = (m) => (m <= 5 ? '≤ 5 мин' : m <= 10 ? '≤ 10 мин' : m <= 15 ? '≤ 15 мин' : '> 15 мин');

    pointMarker.setLatLng(e.latlng).addTo(map);
    const pop = L.popup({ className: 'bh-popup point-popup', maxWidth: 310, minWidth: 280 })
      .setLatLng(e.latlng)
      .setContent(`
        <div class="point">
          <div class="point-head">
            <div class="point-title">Паспорт локации <small>${ll[0].toFixed(4)}, ${ll[1].toFixed(4)}</small></div>
            <div class="point-eco-pill" style="background:${ec.color}" title="Комплексный эко-рейтинг">${ecoScore}/100</div>
          </div>
          ${meter('Качество воздуха', `AQI ${aqi} · PM2.5 ${env.aqiToPm25(aqi)} мкг/м³`, a.label, a.color, aqi / 200)}
          ${meter('Уровень шума', `${noise} дБ(A) · ${classify.noisePoints(noise)}/10`, n.label, n.color, (noise - 35) / 45)}
          ${meter(`Трафик в ${String(hour).padStart(2, '0')}:00`, `${road.road.name} · ${road.dist} м`, t.label, t.color, cong)}
          <div class="point-park">
            <span>🌳 ${nearPark.park.name}</span>
            <b>${nearPark.dist < 100 ? 'в парке' : `${nearPark.dist} м (${nearPark.walkMin} мин)`}</b>
          </div>
          <div class="point-metro">
            ${near.map((s) => `<div><span class="metro-m" style="background:${s.station.color}">M</span>${s.station.name}
              <span class="muted">${s.dist} м · ${s.walkMin} мин · ${walkBand(s.walkMin)}</span></div>`).join('')}
          </div>
          <button class="btn-ghost btn-point-zoom" type="button" data-lat="${ll[0]}" data-lng="${ll[1]}">Показать объекты в этом районе</button>
        </div>`)
      .on('remove', () => pointMarker.remove())
      .openOn(map);

    setTimeout(() => {
      const zoomBtn = $('.btn-point-zoom');
      if (zoomBtn) {
        zoomBtn.onclick = () => {
          map.closePopup(pop);
          map.setView([+zoomBtn.dataset.lat, +zoomBtn.dataset.lng], 15);
        };
      }
    }, 30);
  });

  function meter(title, value, label, color, frac) {
    const p = Math.round(Math.max(0.04, Math.min(1, frac)) * 100);
    return `<div class="meter">
      <div class="meter-head"><span>${title}</span><b style="color:${color}">${label}</b></div>
      <div class="meter-bar"><div style="width:${p}%;background:${color}"></div></div>
      <div class="meter-sub">${value}</div></div>`;
  }

  /* ---------------- Фильтрация ---------------- */
  function matches(l) {
    if (state.onlyFavs && !favs.get().has(l.id)) return false;
    if (state.sources.size && !state.sources.has(l.source)) return false;
    if (state.district && l.district !== state.district) return false;
    if (state.types.size && !state.types.has(l.type)) return false;
    if (state.rooms.size && !state.rooms.has(Math.min(l.rooms, 4))) return false;
    if (l.price < state.priceMin || l.price > state.priceMax) return false;
    if (l.aqi > state.maxAqi) return false;
    if (l.noise > state.maxNoise) return false;
    if (state.maxWalk < 60 && l.metro.walkMin > state.maxWalk) return false;
    if (state.query) {
      const q = state.query.toLowerCase();
      const srcName = (platforms[l.source] && platforms[l.source].name) || '';
      const hay = `${l.address} ${l.district} ${l.complex || ''} ${l.metro.name} ${l.title} ${srcName} ${l.externalId || ''} id${l.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function updateExternalFilterLinks() {
    const bar = $('#extFilterBar');
    if (!bar) return;
    const roomsArr = Array.from(state.rooms);
    const typesArr = Array.from(state.types);
    const filterOpts = {
      district: state.district,
      rooms: roomsArr.length === 1 ? roomsArr[0] : '',
      type: typesArr.length === 1 ? typesArr[0] : '',
      priceMin: state.priceMin > PRICE_MIN ? state.priceMin : '',
      priceMax: state.priceMax < PRICE_MAX ? state.priceMax : ''
    };
    const links = BH.buildAllPortalUrls(filterOpts);
    bar.innerHTML = `<span class="ext-bar-label">Открыть фильтр на:</span>` +
      links.map(({ platform, url }) =>
        `<a class="ext-chip" href="${url}" target="_blank" rel="noopener noreferrer" title="Искать по выбранным параметрам на ${platform.name}">${platform.short} ↗</a>`
      ).join('');
  }

  function applyFilters() {
    listings.forEach(registerListingMarker);
    filtered = listings.filter(matches);
    cluster.clearLayers();
    cluster.addLayers(filtered.map((l) => markers.get(l.id)));
    listLimit = 40;
    renderList();
    renderStats();
    updateExternalFilterLinks();
  }

  const sorters = {
    eco: (a, b) => b.ecoRating - a.ecoRating,
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    ppm: (a, b) => a.pricePerM2 - b.pricePerM2,
    metro: (a, b) => a.metro.dist - b.metro.dist,
    new: (a, b) => a.postedDaysAgo - b.postedDaysAgo
  };

  function renderList() {
    const bounds = map.getBounds();
    let items = state.onlyInView ? filtered.filter((l) => bounds.contains([l.lat, l.lng])) : filtered.slice();
    items.sort(sorters[state.sort]);
    $('#resultCount').textContent = items.length;
    $('#mobileCount').textContent = items.length;
    $('#resultSub').textContent = `${plural(items.length, 'объект', 'объекта', 'объектов')}${state.onlyInView ? ' в области' : ''} · всего ${filtered.length}`;

    const box = $('#cards');
    if (!items.length) {
      const inTotal = filtered.length;
      box.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <p>${inTotal > 0 ? `В текущей области карты объектов нет (всего по фильтрам: ${inTotal}).` : 'Нет объектов по выбранным условиям.'}</p>
        <div class="empty-actions">
          ${inTotal > 0 ? `<button class="btn-ghost" id="emptyZoomOut">Показать все ${inTotal} на карте</button>` : ''}
          <button class="link-btn" id="emptyReset">Сбросить фильтры</button>
        </div>
      </div>`;
      $('#emptyReset').onclick = resetFilters;
      const zoomOutBtn = $('#emptyZoomOut');
      if (zoomOutBtn) {
        zoomOutBtn.onclick = () => {
          if (filtered.length) {
            const b = L.latLngBounds(filtered.map((x) => [x.lat, x.lng]));
            map.fitBounds(b.pad(0.15));
          }
        };
      }
      return;
    }
    box.innerHTML = items.slice(0, listLimit).map(cardHtml).join('') +
      (items.length > listLimit ? `<button class="btn-ghost more" id="moreBtn">Показать ещё ${Math.min(40, items.length - listLimit)}</button>` : '');
    const more = $('#moreBtn');
    if (more) more.onclick = () => { listLimit += 40; renderList(); };
  }

  function cardHtml(l) {
    const a = classify.aqi(l.aqi), n = classify.noise(l.noise), ec = classify.eco(l.ecoRating);
    const src = platforms[l.source] || platforms.olx;
    const isFav = favs.get().has(l.id);
    return `<article class="card ${l.id === activeId ? 'active' : ''}" data-id="${l.id}">
      <div class="card-img">
        <img src="${l.photos[0]}" alt="${l.title}" loading="lazy" onerror="this.onerror=null;this.src='https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg'" />
        <span class="badge sm">${l.type}</span>
        <span class="badge-src sm" style="background:${src.badgeBg};color:${src.badgeColor}">${src.short}</span>
        <button class="fav-btn sm ${isFav ? 'active' : ''}" data-fav="${l.id}" aria-label="В избранное" title="В избранное">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div class="card-body">
        <div class="card-price-row">
          <span class="card-price">${fmt.usd(l.price)}</span>
          <span class="card-ppm">${fmt.usd(l.pricePerM2)}/м²</span>
          <a class="card-ext-link" href="${l.externalUrl}" target="_blank" rel="noopener noreferrer" title="Открыть на ${src.name}" onclick="event.stopPropagation()">${src.short} ↗</a>
        </div>
        <div class="card-title">${l.rooms} комн. · ${l.area} м² · ${l.floor}/${l.totalFloors} эт.</div>
        <div class="card-addr">${l.complex ? `<b>${l.complex}</b> · ` : ''}${l.address}</div>
        <div class="card-tags">
          <span class="tag" style="--c:${ec.color}" title="Эко-рейтинг">Эко ${l.ecoRating}</span>
          <span class="tag" style="--c:${a.color}">AQI ${l.aqi}</span>
          <span class="tag" style="--c:${n.color}">${l.noise} дБ</span>
          <span class="tag" style="--c:${l.metro.color}">M ${l.metro.walkMin} мин</span>
        </div>
      </div>
    </article>`;
  }

  function renderStats() {
    const avgPpm = filtered.length ? Math.round(filtered.reduce((s, l) => s + l.pricePerM2, 0) / filtered.length) : 0;
    const avgAqi = filtered.length ? Math.round(filtered.reduce((s, l) => s + l.aqi, 0) / filtered.length) : 0;
    const score = env.cityScore(hour);
    $('#topStats').innerHTML = `
      <div class="stat"><span>Объектов</span><b>${filtered.length}</b></div>
      <div class="stat"><span>Ср. цена м²</span><b>${fmt.usd(avgPpm)}</b></div>
      <div class="stat"><span>Ср. AQI</span><b style="color:${classify.aqi(avgAqi).color}">${avgAqi}</b></div>
      <div class="stat"><span>Пробки ${String(hour).padStart(2, '0')}:00</span><b style="color:${scoreColor(score)}">${score} балл.</b></div>`;
  }
  const scoreColor = (s) => BH.scales.rgb(BH.scales.traffic((s - 1) / 9));
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  };

  /* ---------------- Список ↔ карта ---------------- */
  $('#cards').addEventListener('click', (e) => {
    if (e.target.closest('[data-fav]') || e.target.closest('.card-ext-link')) return;
    const card = e.target.closest('.card');
    if (!card) return;
    const m = markers.get(+card.dataset.id);
    if (!m) return;
    cluster.zoomToShowLayer(m, () => m.openPopup());
    if (window.innerWidth < 900) document.body.classList.remove('sidebar-open');
  });
  $('#cards').addEventListener('mouseover', (e) => {
    const card = e.target.closest('.card');
    $$('.pm.hover, .bh-cluster.hover').forEach((el) => el.classList.remove('hover'));
    if (!card) return;
    const m = markers.get(+card.dataset.id);
    const vis = cluster.getVisibleParent(m);
    const el = vis && vis.getElement && vis.getElement();
    if (el) (el.querySelector('.pm') || el).classList.add('hover');
  });
  $('#cards').addEventListener('mouseleave', () => $$('.pm.hover, .bh-cluster.hover').forEach((el) => el.classList.remove('hover')));

  let moveTimer;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => state.onlyInView && renderList(), 120); });

  /* ---------------- UI фильтров ---------------- */
  const pMin = $('#priceMin'), pMax = $('#priceMax');
  [pMin, pMax].forEach((el) => { el.min = PRICE_MIN; el.max = PRICE_MAX; });

  function syncUI() {
    $('#searchInput').value = state.query;
    $('#searchClear').hidden = !state.query;
    $('#districtSelect').value = state.district;
    pMin.value = state.priceMin; pMax.value = state.priceMax;
    $('#maxAqi').value = state.maxAqi; $('#maxNoise').value = state.maxNoise; $('#maxWalk').value = state.maxWalk;
    $('#sortBy').value = state.sort; $('#onlyInView').checked = state.onlyInView;
    $$('#sourceChips .chip').forEach((c) => c.classList.toggle('active', state.sources.has(c.dataset.source)));
    $$('#typeChips .chip').forEach((c) => c.classList.toggle('active', state.types.has(c.dataset.type)));
    $$('#roomChips .chip').forEach((c) => c.classList.toggle('active', state.rooms.has(+c.dataset.rooms)));
    updateFavUI();
    updateLabels();
  }
  function updateLabels() {
    $('#priceLabel').textContent = `${fmt.short(state.priceMin)} – ${fmt.short(state.priceMax)}`;
    const lo = ((state.priceMin - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
    const hi = ((state.priceMax - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
    $('#priceRange .range-fill').style.cssText = `left:${lo}%;right:${100 - hi}%`;
    pMin.style.zIndex = state.priceMin > PRICE_MIN + (PRICE_MAX - PRICE_MIN) * 0.5 ? 3 : 2;
    pMax.style.zIndex = 2;

    const a = classify.aqi(state.maxAqi), n = classify.noise(state.maxNoise);
    $('#aqiLabel').innerHTML = state.maxAqi >= 200 ? 'любой' : `≤ ${state.maxAqi} <em style="color:${a.color}">${a.label}</em>`;
    $('#noiseLabel').innerHTML = state.maxNoise >= 80 ? 'любой' : `≤ ${state.maxNoise} дБ <em style="color:${n.color}">${n.label}</em>`;
    $('#walkLabel').textContent = state.maxWalk >= 60 ? 'любое' : `≤ ${state.maxWalk} мин`;
  }

  let filterTimer;
  const debounced = () => { updateLabels(); clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 90); };

  // Поиск
  $('#searchInput').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    $('#searchClear').hidden = !state.query;
    debounced();
  });
  $('#searchClear').addEventListener('click', () => {
    state.query = '';
    $('#searchInput').value = '';
    $('#searchClear').hidden = true;
    applyFilters();
  });

  // Район
  $('#districtSelect').addEventListener('change', (e) => {
    state.district = e.target.value;
    applyFilters();
    if (state.district && filtered.length) {
      const b = L.latLngBounds(filtered.map((x) => [x.lat, x.lng]));
      map.fitBounds(b.pad(0.2), { maxZoom: 15 });
    }
  });

  pMin.addEventListener('input', () => {
    state.priceMin = Math.min(+pMin.value, state.priceMax - 5000); pMin.value = state.priceMin; debounced();
  });
  pMax.addEventListener('input', () => {
    state.priceMax = Math.max(+pMax.value, state.priceMin + 5000); pMax.value = state.priceMax; debounced();
  });
  $('#maxAqi').addEventListener('input', (e) => { state.maxAqi = +e.target.value; debounced(); });
  $('#maxNoise').addEventListener('input', (e) => { state.maxNoise = +e.target.value; debounced(); });
  $('#maxWalk').addEventListener('input', (e) => { state.maxWalk = +e.target.value; debounced(); });
  $('#sortBy').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
  $('#onlyInView').addEventListener('change', (e) => { state.onlyInView = e.target.checked; renderList(); });

  function chipToggle(container, key, parse, targetSetGetter) {
    $(container).addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      const v = parse(c.dataset[key]);
      const set = targetSetGetter();
      set.has(v) ? set.delete(v) : set.add(v);
      c.classList.toggle('active', set.has(v));
      applyFilters();
    });
  }
  chipToggle('#sourceChips', 'source', String, () => state.sources);
  chipToggle('#typeChips', 'type', String, () => state.types);
  chipToggle('#roomChips', 'rooms', Number, () => state.rooms);

  function resetFilters() { state = DEFAULTS(); syncUI(); applyFilters(); }
  $('#resetFilters').addEventListener('click', resetFilters);

  $('#collapseFilters').addEventListener('click', () => {
    $('#filtersSection').classList.toggle('collapsed');
  });

  /* ---------------- Модальное окно: Интеграции и Импорт с OLX/Uybor ---------------- */
  const portalsModal = $('#portalsModal');

  function renderPortalsStats() {
    const grid = $('#portalsStatsGrid');
    if (!grid) return;
    const keys = BH.platformKeys || ['uybor', 'olx', 'uysot', 'domtut', 'etagi', 'realt24', 'joymee'];
    grid.innerHTML = keys.map((k) => {
      const p = platforms[k];
      const items = listings.filter((l) => l.source === k);
      const avgPpm = items.length ? Math.round(items.reduce((s, x) => s + x.pricePerM2, 0) / items.length) : 0;
      const url = BH.buildPortalUrl(k, { district: state.district });
      return `
        <div class="portal-card">
          <div class="portal-card-head">
            <span class="badge-src-lg" style="background:${p.badgeBg};color:${p.badgeColor}">${p.name}</span>
            <span class="portal-status"><i class="live-dot"></i>${p.liveApi ? 'Live API' : 'Подключено'}</span>
          </div>
          <p class="portal-desc">${p.desc}</p>
          <div class="portal-metrics">
            <div><span>На карте</span><b>${items.length} объ.</b></div>
            <div><span>Ср. цена м²</span><b>${avgPpm ? fmt.usd(avgPpm) : '—'}</b></div>
          </div>
          <div class="portal-actions">
            <button class="btn-ghost btn-filter-portal" type="button" data-src="${k}">Показать на карте</button>
            <a class="btn-ghost" href="${url}" target="_blank" rel="noopener noreferrer">Сайт ↗</a>
          </div>
        </div>`;
    }).join('');

    $$('.btn-filter-portal', grid).forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = btn.dataset.src;
        state.sources.clear();
        state.sources.add(src);
        syncUI();
        applyFilters();
        closePortalsModal();
        showToast(`Фильтр: показаны объекты с ${platforms[src].name}`);
      });
    });
  }

  function openPortalsModal() {
    renderPortalsStats();
    portalsModal.classList.add('show');
    portalsModal.setAttribute('aria-hidden', 'false');
  }
  function closePortalsModal() {
    portalsModal.classList.remove('show');
    portalsModal.setAttribute('aria-hidden', 'true');
  }

  $('#openPortalsModal').addEventListener('click', openPortalsModal);
  $('#openImportInline').addEventListener('click', () => {
    openPortalsModal();
    setTimeout(() => $('#importInput').focus(), 80);
  });
  $('#closePortalsModal').addEventListener('click', closePortalsModal);
  portalsModal.addEventListener('click', (e) => {
    if (e.target === portalsModal) closePortalsModal();
  });

  // Живой предпросмотр при вводе ссылки/текста с OLX или клике по примеру
  const importInput = $('#importInput');
  const importPreview = $('#importPreview');

  function updateImportPreview() {
    const val = importInput.value.trim();
    if (!val) {
      importPreview.hidden = true;
      return;
    }
    const parsed = BHIntegrations.parseSmartInput(val);
    if (!parsed) {
      importPreview.hidden = true;
      return;
    }
    const enriched = BH.enrichListingWithEnv(parsed);
    const src = platforms[enriched.source] || platforms.olx;
    const a = classify.aqi(enriched.aqi), n = classify.noise(enriched.noise), ec = classify.eco(enriched.ecoRating);

    importPreview.hidden = false;
    importPreview.innerHTML = `
      <div class="imp-prev-card">
        <div class="imp-prev-top">
          <span class="badge-src-lg" style="background:${src.badgeBg};color:${src.badgeColor}">${src.name}</span>
          <b>${enriched.title} — ${fmt.usd(enriched.price)} <small class="muted">(${fmt.usd(enriched.pricePerM2)}/м²)</small></b>
          <span class="tag" style="--c:${ec.color}">Эко-рейтинг ${enriched.ecoRating}/100</span>
        </div>
        <div class="imp-prev-sub">
          📍 <b>${enriched.address}</b> (${enriched.lat}, ${enriched.lng}) · Этаж ${enriched.floor}/${enriched.totalFloors} · ${enriched.renovation}
        </div>
        <div class="imp-prev-eco">
          <span class="tag" style="--c:${a.color}">Воздух: AQI ${enriched.aqi} (${a.label})</span>
          <span class="tag" style="--c:${n.color}">Шум: ${enriched.noise} дБ (${n.label})</span>
          <span class="tag" style="--c:${enriched.metro.color}">Метро «${enriched.metro.name}»: ${enriched.metro.walkMin} мин</span>
          <span class="tag" style="--c:#1fbf6a">🌳 ${enriched.park.name}: ${enriched.park.walkMin} мин</span>
        </div>
      </div>`;
  }

  importInput.addEventListener('input', updateImportPreview);
  $$('.sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      importInput.value = btn.dataset.sample;
      updateImportPreview();
    });
  });

  $('#importSubmitBtn').addEventListener('click', async () => {
    const val = importInput.value.trim();
    if (!val) {
      showToast('Вставьте ссылку с OLX/Uybor или выберите один из примеров выше');
      importInput.focus();
      return;
    }
    const added = await BHIntegrations.importFromUrlOrText(val);
    if (!added) {
      showToast('Не удалось распознать параметры объявления');
      return;
    }
    registerListingMarker(added);
    state.sources.clear();
    state.district = '';
    syncUI();
    applyFilters();
    closePortalsModal();
    importInput.value = '';
    importPreview.hidden = true;

    const m = markers.get(added.id);
    if (m) {
      cluster.zoomToShowLayer(m, () => m.openPopup());
    }
    showToast(`Объект с ${platforms[added.source].name} добавлен на карту (Эко ${added.ecoRating}/100)`);
  });

  $('#syncFeedBtn').addEventListener('click', async () => {
    const btn = $('#syncFeedBtn');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span>Загрузка с api.uybor.uz...</span>`;
    try {
      const liveBatch = await BHIntegrations.fetchLiveUyborListings(35);
      const otherBatch = BHIntegrations.syncFallbackFeedBatch();
      const total = [...liveBatch, ...otherBatch];
      total.forEach(registerListingMarker);
      applyFilters();
      renderPortalsStats();
      showToast(
        liveBatch.length
          ? `Загружено ${liveBatch.length} реальных объектов с Uybor.uz Live API + ${otherBatch.length} с других площадок`
          : `Обновлено: добавлено ${total.length} новых объявлений с площадок Ташкента`
      );
    } finally {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });

  $('#exportCsvBtn').addEventListener('click', () => {
    BHIntegrations.exportListingsCsv(filtered);
    showToast(`Выгружено ${filtered.length} объектов в CSV`);
  });

  $('#clearImportsBtn').addEventListener('click', () => {
    BH.clearCustomListings();
    applyFilters();
    renderPortalsStats();
    showToast('Импортированные объекты очищены');
  });

  /* ---------------- Панель слоёв ---------------- */
  const toggles = { air: $('#lyrAir'), noise: $('#lyrNoise'), traffic: $('#lyrTraffic'), transit: $('#lyrTransit') };
  function setLayer(name, on) {
    toggles[name].checked = on;
    on ? map.addLayer(layers[name]) : map.removeLayer(layers[name]);
    $(`.layer-row[data-layer="${name}"]`).classList.toggle('on', on);
    $(`#legend${name[0].toUpperCase() + name.slice(1)}`).classList.toggle('show', on);
  }
  Object.entries(toggles).forEach(([name, el]) => {
    el.addEventListener('change', () => {
      if (el.checked && name === 'air') setLayer('noise', false);
      if (el.checked && name === 'noise') setLayer('air', false);
      setLayer(name, el.checked);
      syncUrlHash();
    });
  });

  // Подслои транспорта и парков
  const sub = layers.transit.sub;
  [['#subIso', sub.iso], ['#subParks', sub.parks], ['#subEntr', sub.entrances], ['#subBus', sub.bus]].forEach(([sel, lyr]) => {
    $(sel).addEventListener('change', (e) => (e.target.checked ? layers.transit.addLayer(lyr) : layers.transit.removeLayer(lyr)));
  });

  function updateEntrancesVisibility() {
    map.getContainer().classList.toggle('hide-entrances', map.getZoom() < 14);
  }
  map.on('zoomend', updateEntrancesVisibility);
  updateEntrancesVisibility();

  $('#metroLinesLegend').innerHTML = BH.metroLines.map((l) => `<span><i style="background:${l.color}"></i>${l.name.replace(' линия', '').replace(' (Надземная)', '')}</span>`).join('');

  // Время суток для трафика
  function setHour(h) {
    hour = h;
    $('#hourRange').value = h;
    $('#hourLabel').textContent = `${String(h).padStart(2, '0')}:00`;
    const s = env.cityScore(h);
    $('#trafficScore').innerHTML = `<b style="background:${scoreColor(s)}">${s}</b><span>${plural(s, 'балл', 'балла', 'баллов')}</span>`;
    $$('#hourChart i').forEach((b, i) => b.classList.toggle('cur', i === h));
    layers.traffic.setHour(h);
    renderStats();
  }
  $('#hourChart').innerHTML = Array.from({ length: 24 }, (_, h) => {
    const s = env.cityScore(h);
    return `<i data-h="${h}" style="height:${12 + s * 8.8}%;background:${scoreColor(s)}" title="${String(h).padStart(2, '0')}:00 — ${s} балл."></i>`;
  }).join('');
  $('#hourChart').addEventListener('click', (e) => {
    const bar = e.target.closest('i[data-h]');
    if (bar) setHour(+bar.dataset.h);
  });
  $('#hourRange').addEventListener('input', (e) => setHour(+e.target.value));
  $$('.hour-actions .mini-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    setHour(b.dataset.hour === 'now' ? new Date().getHours() : +b.dataset.hour);
  }));

  // Режим маркеров
  $('#markerModeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    markerMode = b.dataset.mode;
    $$('#markerModeSeg button').forEach((x) => x.classList.toggle('active', x === b));
    refreshAllMarkerIcons();
  });

  // Подложка
  $('#basemapSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setBasemap(b.dataset.base);
  });

  // Сворачивание панели слоёв и сайдбара (моб.)
  $('#layerPanelToggle').addEventListener('click', () => $('#layerPanel').classList.toggle('collapsed'));
  $('#toggleSidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#closeSidebar').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  $('#sidebarBackdrop').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  $('#mobileOpenList').addEventListener('click', () => document.body.classList.add('sidebar-open'));
  $('#mobileToggleLayers').addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
    $('#layerPanel').classList.toggle('collapsed');
  });

  if (window.innerWidth < 900) $('#layerPanel').classList.add('collapsed');

  L.DomEvent.disableClickPropagation($('#layerPanel'));
  L.DomEvent.disableScrollPropagation($('#layerPanel'));

  /* ---------------- Синхронизация URL Hash ---------------- */
  function syncUrlHash() {
    const on = Object.keys(toggles).filter((k) => toggles[k].checked);
    const params = new URLSearchParams();
    if (on.length) params.set('layers', on.join(','));
    if (toggles.traffic.checked) params.set('hour', hour);
    if (activeId != null) params.set('open', activeId);
    const str = params.toString();
    try { history.replaceState(null, '', str ? '#' + str : location.pathname + location.search); } catch (_) {}
  }

  /* ---------------- Старт ---------------- */
  const hash = new URLSearchParams(location.hash.slice(1));
  syncUI();
  setHour(hash.has('hour') ? +hash.get('hour') : hour);
  applyFilters();
  const startLayers = hash.has('layers') ? hash.get('layers').split(',').filter((x) => layers[x]) : ['transit'];
  startLayers.forEach((x) => setLayer(x, true));
  const searchParams = new URLSearchParams(location.search);
  const openId = hash.has('open') ? +hash.get('open') : +(searchParams.get('id') || 0);
  if (openId && markers.has(openId)) {
    const m = markers.get(openId);
    cluster.zoomToShowLayer(m, () => m.openPopup());
  } else if (openId || searchParams.has('d') || searchParams.has('url')) {
    const combined = new URLSearchParams(location.search);
    if (openId && !combined.has('id')) combined.set('id', openId);
    BHIntegrations.resolveAnyListing(combined).then((resolved) => {
      if (resolved) {
        const m = registerListingMarker(resolved);
        applyFilters();
        cluster.zoomToShowLayer(m, () => m.openPopup());
      }
    }).catch(() => {});
  }

  // Актуализация курса доллара ЦБ РУз
  BHIntegrations.fetchLiveCbuRate().catch(() => {});

  // Автоматическая подгрузка реальных объявлений с открытого API Uybor.uz при первом запуске
  if (!listings.some((x) => x.isLiveApi)) {
    BHIntegrations.fetchLiveUyborListings(24).then((liveItems) => {
      if (liveItems && liveItems.length) {
        liveItems.forEach(registerListingMarker);
        applyFilters();
        showToast(`Uybor.uz Live API: загружено ${liveItems.length} реальных объектов Ташкента`);
      }
    }).catch(() => {});
  }
})();
