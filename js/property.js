/* ==========================================================================
   BestHouse.uz — детальная страница объекта, универсальный резолвер 7 площадок
   (Uybor, OLX, Uysot, Domtut, Etagi, Realt24, Joymee) и внешние сервисы
   ========================================================================== */
(async function () {
  'use strict';
  const { env, classify, fmt, favs, theme, platforms } = BH;
  const root = document.getElementById('detail');

  /* ---- Уведомления (Toast) ---- */
  let toastTimer;
  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---- Тема ---- */
  theme.set(theme.get());
  let detailMap = null;
  let detailBaseLayers = [];

  function updateDetailMapTiles() {
    if (!detailMap) return;
    detailBaseLayers.forEach((lyr) => detailMap.removeLayer(lyr));
    const isDark = theme.get() === 'dark';
    const names = isDark
      ? ['World_Dark_Gray_Base', 'World_Dark_Gray_Reference']
      : ['World_Light_Gray_Base', 'World_Light_Gray_Reference'];
    detailBaseLayers = names.map((n) =>
      L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${n}/MapServer/tile/{z}/{y}/{x}`, {
        attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap', maxZoom: 19, maxNativeZoom: 16
      }).addTo(detailMap)
    );
  }

  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = theme.get() === 'dark' ? 'light' : 'dark';
    theme.set(next);
    updateDetailMapTiles();
  });

  /* ---- Блок быстрого открытия любой ссылки с 7 площадок прямо на странице ---- */
  function renderQuickUrlResolverBar() {
    return `
      <div class="box quick-resolve-box">
        <div class="qr-head">
          <div>
            <b>Проверить объявление с любой площадки недвижимости</b>
            <span class="muted">Вставьте ссылку с Uybor.uz, OLX.uz, Uysot.uz, Domtut.uz, Этажи, Realt24.uz, Joymee.uz или текст из Telegram</span>
          </div>
          <div class="qr-samples">
            <button type="button" class="mini-btn qr-sample" data-val="https://uybor.uz/ru/listing/1324763">Uybor Live</button>
            <button type="button" class="mini-btn qr-sample" data-val="https://www.olx.uz/d/obyavlenie/prodaetsya-3-komnatnaya-kvartira-chilanzar-7-kvartal-72m2-4-5-etazh-81000-ID3xK9p.html">OLX.uz</button>
            <button type="button" class="mini-btn qr-sample" data-val="https://domtut.uz/nedvizhimost/kvartira-3-komn-mirabad-jk-mirabad-avenue-95m2-7-12-etazh-215000">Domtut.uz</button>
            <button type="button" class="mini-btn qr-sample" data-val="https://realt24.uz/tashkent/yunusabad-4-kvartal-2-komn-62m2-3-9-etazh-67500">Realt24.uz</button>
            <button type="button" class="mini-btn qr-sample" data-val="https://uysot.uz/novostroyki/yashnabad-parkent-2-komn-65m2-8-16-etazh-79000">Uysot.uz</button>
          </div>
        </div>
        <form class="import-form" id="quickResolveForm">
          <input type="text" class="import-input" id="quickResolveInput" placeholder="Вставьте ссылку с OLX.uz, Uybor.uz, Domtut, Uysot, Realt24, Этажи или Joymee..." />
          <button type="submit" class="btn-primary btn-sm" id="quickResolveBtn">Открыть паспорт объекта</button>
        </form>
      </div>`;
  }

  function bindQuickUrlResolver() {
    const form = document.getElementById('quickResolveForm');
    const inp = document.getElementById('quickResolveInput');
    const btn = document.getElementById('quickResolveBtn');
    if (!form || !inp) return;

    document.querySelectorAll('.qr-sample').forEach((b) => {
      b.addEventListener('click', () => {
        inp.value = b.dataset.val;
        inp.focus();
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = inp.value.trim();
      if (!val) {
        showToast('Вставьте ссылку на объявление или выберите пример');
        inp.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Загрузка...';
      try {
        const added = await BHIntegrations.importFromUrlOrText(val);
        if (added) {
          location.href = BH.buildPropertyPageUrl(added);
        } else {
          showToast('Не удалось распознать объявление');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Открыть паспорт объекта';
      }
    });
  }

  /* ---- Разрешение объекта из любого источника (ID, ?d=, ?url=, Uybor API, пул 7 площадок, OSM Nominatim) ---- */
  root.innerHTML = `<div class="not-found"><p class="muted">Загрузка данных объекта и проверка площадок...</p></div>`;
  const l = await BHIntegrations.resolveAnyListing(new URLSearchParams(location.search));

  if (!l) {
    root.innerHTML = `
      <div class="not-found">
        <h1>Объект не найден</h1>
        <p class="muted" style="margin-bottom:20px">Объявление снято с публикации или ссылка неполная. Вы можете сразу вставить прямую ссылку на объект с любой из 7 площадок ниже:</p>
        <div style="max-width:760px;margin:0 auto 20px;text-align:left">${renderQuickUrlResolverBar()}</div>
        <a class="btn-primary" style="max-width:240px;margin:16px auto" href="index.html">Вернуться к карте</a>
      </div>`;
    bindQuickUrlResolver();
    return;
  }

  // Обновляем адресную строку самодостаточной ссылкой (?id=...&src=...&d=...), чтобы копирование URL из браузера работало у любого получателя
  try {
    const shareUrl = BH.buildPropertyPageUrl(l);
    history.replaceState(null, '', shareUrl);
  } catch (_) {}

  const src = platforms[l.source] || platforms.olx;
  document.title = `${l.title} — ${fmt.usd(l.price)} (${src.name}) · BestHouse.uz`;
  const mapOpenUrl = BH.buildMapOpenUrl(l);
  const topBack = document.getElementById('topBackMap');
  if (topBack) topBack.href = mapOpenUrl;

  const a = classify.aqi(l.aqi), n = classify.noise(l.noise), ec = classify.eco(l.ecoRating);
  const near = BH.geo.nearestStations([l.lat, l.lng], 3);
  const road = BH.geo.nearestRoad([l.lat, l.lng]);
  const walkColor = (m) => (m <= 5 ? '#1fbf6a' : m <= 10 ? '#8fbf3a' : m <= 15 ? '#e8b715' : '#f08a24');
  const peak = Math.max(...Array.from({ length: 24 }, (_, h) => env.congestion(road.road, h)));
  const curHour = new Date().getHours();
  const isFav = favs.get().has(l.id);

  const crossPortalLinks = BH.buildAllPortalUrls({
    source: l.source,
    externalUrl: l.externalUrl,
    district: l.district,
    rooms: l.rooms,
    price: l.price,
    type: l.type
  });

  const externalMapLinks = BHIntegrations.buildExternalMapLinks(l);

  // Похожие объекты
  const similar = BH.listings
    .filter((x) => x.id !== l.id)
    .map((x) => ({
      item: x,
      score: (x.district === l.district ? 0 : 1200) + BH.geo.distM([l.lat, l.lng], [x.lat, x.lng]) * 0.4 + Math.abs(x.price - l.price) * 0.015
    }))
    .sort((u, v) => u.score - v.score)
    .slice(0, 3)
    .map((x) => x.item);

  root.innerHTML = `
    <nav class="crumbs">
      <a href="${mapOpenUrl}">← На карту</a><span>/</span>
      <a href="index.html">${l.district}</a><span>/</span>
      <span>Источник: <b>${src.name}</b> (${l.externalId || 'ID ' + l.id})</span>
    </nav>

    ${renderQuickUrlResolverBar()}

    <div class="detail-grid">
      <div class="detail-main">
        <div class="gallery gallery-4">
          ${l.photos.slice(0, 4).map((p, idx) => `
            <div class="gallery-item" data-idx="${idx}">
              <img src="${p}" alt="${l.title} — фото ${idx + 1}" onerror="this.onerror=null;this.src='https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg'" />
              ${idx === 0 ? `<span class="badge">${l.type}</span><span class="badge-src" style="background:${src.badgeBg};color:${src.badgeColor}">${src.name}</span>` : ''}
              ${idx === 3 ? `<span class="gallery-zoom-hint">Все ${l.photos.length} фото</span>` : ''}
            </div>
          `).join('')}
        </div>

        <div class="box">
          <div class="d-head-row">
            <div>
              <h1 class="d-title">${l.title}</h1>
              <div class="d-addr">
                ${l.complex ? `<b>${l.complex}</b> · ` : ''}${l.address}
                <span id="osmVerifiedAddr" class="osm-addr-badge" hidden></span>
              </div>
            </div>
            <div class="eco-score-badge" style="--c:${ec.color}">
              <div class="eco-score-num">${l.ecoRating}</div>
              <div class="eco-score-txt"><b>Эко-рейтинг</b><span>${ec.label}</span></div>
            </div>
          </div>

          <div class="specs">
            <div class="spec"><span>Комнат</span><b>${l.rooms}</b></div>
            <div class="spec"><span>Площадь</span><b>${l.area} м²</b></div>
            <div class="spec"><span>Этаж</span><b>${l.floor} из ${l.totalFloors}</b></div>
            <div class="spec"><span>Год постройки</span><b>${l.year}</b></div>
            <div class="spec"><span>Тип жилья</span><b>${l.type}</b></div>
            <div class="spec"><span>Ремонт</span><b>${l.renovation}</b></div>
            <div class="spec"><span>Потолки</span><b>${l.ceiling}</b></div>
            <div class="spec"><span>Материал стен</span><b>${l.material}</b></div>
            <div class="spec"><span>Парковка</span><b>${l.parking}</b></div>
            <div class="spec"><span>Цена за м²</span><b>${fmt.usd(l.pricePerM2)}</b></div>
            <div class="spec"><span>Площадка</span><b>${src.name}</b></div>
            <div class="spec"><span>Опубликовано</span><b>${l.postedDaysAgo ? l.postedDaysAgo + ' дн. назад' : 'сегодня'}</b></div>
          </div>
        </div>

        <!-- Интеграция: Сравнить и найти аналоги на всех 7 площадках Узбекистана -->
        <div class="box">
          <h2>Сравнить цены и найти аналоги на 7 площадках недвижимости</h2>
          <p class="muted" style="margin:-6px 0 12px;font-size:13px">
            Прямые переходы на поиск аналогичных объектов (${l.rooms} комн., район ${l.district}, около ${fmt.usd(l.price)}) на всех ведущих порталах Ташкента:
          </p>
          <div class="cross-portals-row">
            ${crossPortalLinks.map(({ platform, url }) => `
              <a class="cross-portal-btn ${platform.id === l.source ? 'is-origin' : ''}" href="${url}" target="_blank" rel="noopener noreferrer">
                <span class="badge-src-lg" style="background:${platform.badgeBg};color:${platform.badgeColor}">${platform.short}</span>
                <div class="cp-info">
                  <b>${platform.name} ${platform.id === l.source ? '· Источник' : ''}</b>
                  <span>${platform.id === l.source ? 'Открыть оригинал объявления' : `Искать в р-не ${l.district}`}</span>
                </div>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            `).join('')}
          </div>
        </div>

        <div class="box">
          <div class="d-sec-head">
            <h2>Экологический паспорт и окружение</h2>
            <span class="live-service-pill" id="liveAqiBadge" title="Реальный индекс качества воздуха в Ташкенте (Open-Meteo Air Quality)">
              <i class="live-dot"></i>Синхронизация AQI...
            </span>
          </div>
          <div class="eco-cards eco-cards-4">
            <div class="eco-card" style="--c:${a.color}">
              <div class="t">Качество воздуха</div>
              <div class="v" id="ecoAqiVal">AQI ${l.aqi}</div>
              <div class="l">${a.label}</div>
              <div class="gauge"><div style="width:${Math.min(100, l.aqi / 2)}%"></div></div>
              <div class="s" id="ecoPmVal">PM2.5 ≈ ${l.pm25} мкг/м³</div>
            </div>
            <div class="eco-card" style="--c:${n.color}">
              <div class="t">Уровень шума</div>
              <div class="v">${l.noise} дБ</div>
              <div class="l">${n.label} · ${classify.noisePoints(l.noise)}/10</div>
              <div class="gauge"><div style="width:${Math.min(100, ((l.noise - 35) / 45) * 100)}%"></div></div>
              <div class="s">${road.road.name}, ${road.dist} м</div>
            </div>
            <div class="eco-card" style="--c:${walkColor(l.metro.walkMin)}">
              <div class="t">До метро пешком</div>
              <div class="v" id="ecoMetroMin">${l.metro.walkMin} мин</div>
              <div class="l">${l.metro.name}</div>
              <div class="gauge"><div style="width:${Math.min(100, Math.max(10, 100 - l.metro.walkMin * 2.5))}%"></div></div>
              <div class="s" id="ecoMetroDist">${l.metro.dist} м по прямой</div>
            </div>
            <div class="eco-card" style="--c:#1fbf6a">
              <div class="t">Зелёная зона рядом</div>
              <div class="v">${l.park.walkMin} мин</div>
              <div class="l">🌳 Парк</div>
              <div class="gauge"><div style="width:${Math.min(100, Math.max(12, 100 - l.park.walkMin * 3))}%"></div></div>
              <div class="s">${l.park.name} (${l.park.dist} м)</div>
            </div>
          </div>

          <h2 style="margin-top:24px">Суточный профиль трафика: ${road.road.name}</h2>
          <div class="hour-profile">${Array.from({ length: 24 }, (_, h) => {
            const c = env.congestion(road.road, h);
            return `<i class="${h === curHour ? 'cur' : ''}" title="${String(h).padStart(2, '0')}:00 — ${classify.traffic(c).label} (${Math.round(c * 100)}%)" style="height:${(c / peak) * 100}%;background:${BH.scales.rgb(BH.scales.traffic(c))}"></i>`;
          }).join('')}</div>
          <div class="hour-profile-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>

          <div class="d-sec-head" style="margin-top:24px">
            <h2>Транспортная доступность, реальный маршрут (OSRM) и карты</h2>
            <span class="live-service-pill" id="osrmRouteStatus"><i class="live-dot"></i>Расчёт уличного маршрута...</span>
          </div>
          <div id="detailMap"></div>
          <div class="metro-list">${near.map((s, idx) => `
            <div class="metro-item">
              <span class="metro-m" style="background:${s.station.color}">M</span>
              <div class="grow">
                <b>${s.station.name}</b>
                <small id="metroSub_${idx}">${BH.metroLines.find((x) => x.id === s.station.line).name} · ${s.dist} м по прямой</small>
              </div>
              <span class="walk-pill" id="metroPill_${idx}" style="background:${walkColor(s.walkMin)}">${s.walkMin} мин пешком</span>
            </div>`).join('')}
          </div>

          <!-- Внешние картографические сервисы -->
          <div class="ext-maps-bar">
            <span class="muted" style="font-size:12px;font-weight:600">Открыть точку и панорамы в картографических сервисах:</span>
            <div class="cross-portals-row" style="margin-top:8px">
              ${externalMapLinks.map((m) => `
                <a class="cross-portal-btn" href="${m.url}" target="_blank" rel="noopener noreferrer">
                  <span class="badge-src-lg" style="background:${m.bg};color:${m.color}">${m.name.split(' ')[0]}</span>
                  <div class="cp-info">
                    <b>${m.name}</b>
                    <span>${m.sub}</span>
                  </div>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="box">
          <h2>Описание объекта</h2>
          ${l.description ? `<p class="desc" style="margin-bottom:12px;white-space:pre-line">${l.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
          <p class="desc">Продаётся ${l.rooms}-комнатная ${l.type === 'Дом' ? 'усадьба' : 'квартира'} площадью ${l.area} м² в районе ${l.district}${l.complex ? ` (${l.complex})` : ''}.
            ${l.type === 'Новостройка' ? `Современный дом ${l.year} года постройки (${l.material.toLowerCase()}), высота потолков ${l.ceiling}, отделка: ${l.renovation.toLowerCase()}.` : `Дом ${l.year} года (${l.material.toLowerCase()}), высота потолков ${l.ceiling}, ремонт: ${l.renovation.toLowerCase()}.`}
            Для жителей предусмотрена парковка: ${l.parking.toLowerCase()}.
            Ближайшая станция метро «${l.metro.name}» находится в ${l.metro.walkMin} мин пешком (${l.metro.dist} м), а до зелёной зоны «${l.park.name}» — около ${l.park.walkMin} мин.
            Комплексный экологический индекс локации составляет <b>${l.ecoRating} из 100</b>: средний AQI воздуха — ${l.aqi} (${a.label.toLowerCase()}), дневной уровень шума — ${l.noise} дБ (${n.label.toLowerCase()}).</p>
        </div>

        <div class="box">
          <div class="d-sec-head">
            <h2>Ипотечный калькулятор</h2>
            <span class="live-service-pill" id="cbuRateBadge" title="Официальный курс ЦБ РУз (cbu.uz)">Курс ЦБ РУз: 1$ = ${BH.USD_TO_UZS.toLocaleString('ru-RU')} сум</span>
          </div>
          <div class="calc-grid">
            <div class="calc-controls">
              <div class="f-group">
                <label class="f-label"><span>Первоначальный взнос</span><span class="f-value" id="calcDownLabel">30%</span></label>
                <input type="range" class="range-single" id="calcDown" min="15" max="80" step="5" value="30" />
              </div>
              <div class="f-group">
                <label class="f-label"><span>Срок кредита</span><span class="f-value" id="calcYearsLabel">10 лет</span></label>
                <input type="range" class="range-single" id="calcYears" min="1" max="20" step="1" value="10" />
              </div>
              <div class="f-group" style="margin-bottom:0">
                <label class="f-label"><span>Годовая ставка</span><span class="f-value" id="calcRateLabel">17%</span></label>
                <input type="range" class="range-single" id="calcRate" min="10" max="26" step="0.5" value="17" />
              </div>
            </div>
            <div class="calc-result">
              <div class="calc-res-item">
                <span>Ежемесячный платёж</span>
                <b class="calc-monthly" id="calcMonthlyUsd">$0</b>
                <small id="calcMonthlyUzs">≈ 0 млн сум/мес</small>
              </div>
              <div class="calc-res-row">
                <div><span>Сумма кредита</span><b id="calcLoan">$0</b></div>
                <div><span>Первый взнос</span><b id="calcDownUsd">$0</b></div>
              </div>
            </div>
          </div>
        </div>

        <div class="box">
          <h2>Похожие объекты рядом</h2>
          <div class="similar-grid">
            ${similar.map((s) => {
              const sa = classify.aqi(s.aqi), sec = classify.eco(s.ecoRating);
              const sSrc = platforms[s.source] || platforms.olx;
              return `<a class="sim-card" href="${BH.buildPropertyPageUrl(s)}">
                <div class="sim-img">
                  <img src="${s.photos[0]}" alt="${s.title}" loading="lazy" onerror="this.onerror=null;this.src='https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg'" />
                  <span class="badge sm">${s.type}</span>
                  <span class="badge-src sm" style="background:${sSrc.badgeBg};color:${sSrc.badgeColor}">${sSrc.short}</span>
                </div>
                <div class="sim-body">
                  <div class="sim-price">${fmt.usd(s.price)} <small>${fmt.usd(s.pricePerM2)}/м²</small></div>
                  <div class="sim-title">${s.rooms} комн. · ${s.area} м² · ${s.floor}/${s.totalFloors} эт.</div>
                  <div class="sim-addr">${s.address}</div>
                  <div class="card-tags">
                    <span class="tag" style="--c:${sec.color}">Эко ${s.ecoRating}</span>
                    <span class="tag" style="--c:${sa.color}">AQI ${s.aqi}</span>
                    <span class="tag" style="--c:${s.metro.color}">M ${s.metro.walkMin} мин</span>
                  </div>
                </div>
              </a>`;
            }).join('')}
          </div>
        </div>
      </div>

      <aside class="box price-box">
        <div class="aside-src-head">
          <span class="badge-src-lg" style="background:${src.badgeBg};color:${src.badgeColor}">${src.name}</span>
          <span class="muted" style="font-size:12px">${l.externalId || 'ID ' + l.id}</span>
        </div>
        <div class="big">${fmt.usd(l.price)}</div>
        <div class="uzs-sub" id="asideUzsPrice">≈ ${fmt.uzs(l.price)}</div>
        <div class="ppm">${fmt.usd(l.pricePerM2)} за м²</div>

        <button class="btn-primary" id="callBtn" type="button">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span id="callBtnText">Показать телефон</span>
        </button>

        <a class="btn-secondary btn-ext-main" href="${l.externalUrl}" target="_blank" rel="noopener noreferrer">
          <span>Открыть на ${src.name}</span>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>

        <div class="aside-actions-row">
          <button class="btn-secondary ${isFav ? 'active-fav' : ''}" id="detailFavBtn" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${isFav ? 'В избранном' : 'В избранное'}</span>
          </button>
          <button class="btn-secondary" id="shareBtn" type="button" title="Скопировать универсальную ссылку (откроется на любом устройстве)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
            <span>Поделиться</span>
          </button>
        </div>

        <a class="btn-secondary" href="${mapOpenUrl}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
          <span>Показать на карте</span>
        </a>

        <div class="aside-meta">
          <div><span>Площадка</span><b>${src.name}</b></div>
          <div><span>Район</span><b>${l.district}</b></div>
          <div><span>Координаты</span><b>${(+l.lat).toFixed(4)}, ${(+l.lng).toFixed(4)}</b></div>
          <div><span>Метро</span><b id="asideMetroInfo">${l.metro.name} (${l.metro.walkMin} мин)</b></div>
          <div><span>Эко-индекс</span><b style="color:${ec.color}">${l.ecoRating}/100 · ${ec.label}</b></div>
        </div>
      </aside>
    </div>`;

  bindQuickUrlResolver();

  /* ---- Кнопки в сайдбаре ---- */
  let phoneShown = false;
  document.getElementById('callBtn').addEventListener('click', () => {
    if (!phoneShown) {
      phoneShown = true;
      document.getElementById('callBtnText').textContent = l.phone;
      showToast('Номер телефона открыт');
    } else {
      location.href = `tel:${l.phone.replace(/[^\d+]/g, '')}`;
    }
  });

  document.getElementById('detailFavBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const added = favs.toggle(l.id);
    btn.classList.toggle('active-fav', added);
    btn.querySelector('svg').setAttribute('fill', added ? 'currentColor' : 'none');
    btn.querySelector('span').textContent = added ? 'В избранном' : 'В избранное';
    showToast(added ? 'Добавлено в избранное' : 'Удалено из избранного');
  });

  document.getElementById('shareBtn').addEventListener('click', () => {
    const shareUrl = new URL(BH.buildPropertyPageUrl(l), location.href).href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => showToast(`Универсальная ссылка (${src.name}) скопирована!`));
    } else {
      showToast('Ссылка обновлена в адресной строке — скопируйте её');
    }
  });

  /* ---- Ипотечный калькулятор ---- */
  const elDown = document.getElementById('calcDown');
  const elYears = document.getElementById('calcYears');
  const elRate = document.getElementById('calcRate');

  function updateMortgage() {
    const downPct = +elDown.value;
    const years = +elYears.value;
    const rate = +elRate.value;
    const downUsd = Math.round((l.price * downPct) / 100);
    const loan = l.price - downUsd;
    const mRate = rate / 100 / 12;
    const nMonths = years * 12;
    const monthly = mRate > 0
      ? Math.round((loan * (mRate * Math.pow(1 + mRate, nMonths))) / (Math.pow(1 + mRate, nMonths) - 1))
      : Math.round(loan / nMonths);

    document.getElementById('calcDownLabel').textContent = `${downPct}% (${fmt.short(downUsd)})`;
    document.getElementById('calcYearsLabel').textContent = `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'}`;
    document.getElementById('calcRateLabel').textContent = `${rate}%`;
    document.getElementById('calcMonthlyUsd').textContent = `${fmt.usd(monthly)} / мес`;
    document.getElementById('calcMonthlyUzs').textContent = `≈ ${fmt.uzs(monthly)} в месяц`;
    document.getElementById('calcLoan').textContent = fmt.usd(loan);
    document.getElementById('calcDownUsd').textContent = fmt.usd(downUsd);
  }
  [elDown, elYears, elRate].forEach((el) => el.addEventListener('input', updateMortgage));
  updateMortgage();

  /* ---- Мини-карта с изохронами и реальным пешеходным маршрутом OSRM ---- */
  detailMap = L.map('detailMap', { scrollWheelZoom: false }).setView([l.lat, l.lng], 15);
  updateDetailMapTiles();

  [[1200, '15 мин пешком (1.2 км)', 0.05], [800, '10 мин пешком (800 м)', 0.08], [400, '5 мин пешком (400 м)', 0.13]].forEach(([r, label, f]) => {
    L.circle([l.lat, l.lng], { radius: r, color: '#2f6bff', weight: 1.2, dashArray: r === 1200 ? '4 4' : null, fillOpacity: f })
      .bindTooltip(label, { sticky: true, className: 'bh-tooltip' }).addTo(detailMap);
  });

  BH.parks.forEach((p) => {
    L.circle(p.ll, { radius: p.r, color: '#1fbf6a', weight: 1.2, dashArray: '3 5', fillColor: '#1fbf6a', fillOpacity: 0.14 })
      .bindTooltip(`🌳 ${p.name}`, { className: 'bh-tooltip' }).addTo(detailMap);
  });

  BH.metroLines.forEach((ln) => L.polyline(ln.stations.map((s) => s.ll), { color: ln.color, weight: 4 }).addTo(detailMap));
  BH.metroStations.forEach((s) =>
    L.circleMarker(s.ll, { radius: 5, color: s.color, weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(`Метро «${s.name}»`, { className: 'bh-tooltip' }).addTo(detailMap)
  );

  const pinIcon = L.divIcon({
    className: 'pm-wrap',
    html: `<div class="pm active">
             <i class="pm-dot" style="background:${a.color}"></i>
             <i class="pm-dot" style="background:${n.color}"></i>
             <span>${fmt.short(l.price)}</span>
           </div>`,
    iconSize: null,
    iconAnchor: [0, 0],
    popupAnchor: [0, -34]
  });
  L.marker([l.lat, l.lng], { icon: pinIcon }).addTo(detailMap).bindPopup(`<b>${fmt.usd(l.price)}</b><br>${l.title}`);
  detailMap.fitBounds(L.latLng(l.lat, l.lng).toBounds(2200));

  /* ---- Подключение внешних Live-сервисов (OSRM маршрут, OSM Nominatim, ЦБ РУз, Open-Meteo AQI) ---- */
  // 1. OSRM: Реальный пешеходный маршрут по улицам Ташкента до ближайшего метро
  if (near[0]) {
    BHIntegrations.fetchOsrmWalkingRoute([l.lat, l.lng], near[0].station.ll).then((route) => {
      const statusEl = document.getElementById('osrmRouteStatus');
      if (!route) {
        if (statusEl) statusEl.innerHTML = `<i class="live-dot"></i>Изохроны доступности`;
        return;
      }
      L.polyline(route.coords, {
        color: '#2f6bff',
        weight: 4.5,
        opacity: 0.9,
        dashArray: '8 6'
      })
        .bindTooltip(`Пеший маршрут по улицам до м. «${near[0].station.name}»: ${route.distM} м (${route.walkMin} мин)`, {
          sticky: true,
          className: 'bh-tooltip'
        })
        .addTo(detailMap);

      if (statusEl) {
        statusEl.innerHTML = `<i class="live-dot"></i>OSRM маршрут до м. «${near[0].station.name}»: ${route.distM} м (${route.walkMin} мин)`;
      }
      const mMinEl = document.getElementById('ecoMetroMin');
      const mDistEl = document.getElementById('ecoMetroDist');
      const sub0 = document.getElementById('metroSub_0');
      const pill0 = document.getElementById('metroPill_0');
      const asideMetro = document.getElementById('asideMetroInfo');
      if (mMinEl) mMinEl.textContent = `${route.walkMin} мин`;
      if (mDistEl) mDistEl.textContent = `${route.distM} м по улицам (OSRM)`;
      if (sub0) sub0.textContent = `${BH.metroLines.find((x) => x.id === near[0].station.line).name} · ${route.distM} м по улицам`;
      if (pill0) {
        pill0.textContent = `${route.walkMin} мин пешком`;
        pill0.style.background = walkColor(route.walkMin);
      }
      if (asideMetro) asideMetro.textContent = `${near[0].station.name} (${route.walkMin} мин)`;
    });
  }

  // 2. OpenStreetMap Nominatim: Верификация точного адреса / махалли по координатам
  BHIntegrations.reverseGeocodeNominatim(l.lat, l.lng).then((osm) => {
    const badge = document.getElementById('osmVerifiedAddr');
    if (osm && osm.formatted && badge) {
      badge.textContent = `OSM: ${osm.formatted}${osm.postcode ? ' (' + osm.postcode + ')' : ''}`;
      badge.hidden = false;
    }
  });

  // 3. ЦБ РУз (cbu.uz): Актуальный курс доллара на сегодня
  BHIntegrations.fetchLiveCbuRate().then((cbu) => {
    if (!cbu) return;
    const badge = document.getElementById('cbuRateBadge');
    const asideUzs = document.getElementById('asideUzsPrice');
    if (badge) badge.innerHTML = `<i class="live-dot"></i>Курс ЦБ РУз (${cbu.date}): 1$ = ${cbu.rate.toLocaleString('ru-RU')} сум`;
    if (asideUzs) asideUzs.textContent = `≈ ${fmt.uzs(l.price)}`;
    updateMortgage();
  });

  // 4. Open-Meteo Air Quality: Живой мониторинг качества воздуха в Ташкенте сейчас
  BHIntegrations.fetchLiveTashkentAqi().then((liveAir) => {
    const badge = document.getElementById('liveAqiBadge');
    if (!liveAir || !badge) return;
    const cls = classify.aqi(liveAir.aqi);
    badge.innerHTML = `<i class="live-dot" style="background:${cls.color}"></i>Ташкент сейчас (Open-Meteo): AQI ${liveAir.aqi} · PM2.5 ${liveAir.pm25} мкг/м³`;
  });

  /* ---- Галерея и Лайтбокс с навигацией ---- */
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lbImg');
  const lbCounter = document.getElementById('lbCounter');
  let curPhotoIdx = 0;

  function openLightbox(idx) {
    curPhotoIdx = (idx + l.photos.length) % l.photos.length;
    lbImg.src = l.photos[curPhotoIdx];
    lbCounter.textContent = `${curPhotoIdx + 1} / ${l.photos.length}`;
    lb.classList.add('show');
  }
  function closeLightbox() {
    lb.classList.remove('show');
  }

  document.querySelectorAll('.gallery-item').forEach((item) => {
    item.addEventListener('click', () => openLightbox(+item.dataset.idx));
  });
  document.getElementById('lbClose').addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
  document.getElementById('lbPrev').addEventListener('click', (e) => { e.stopPropagation(); openLightbox(curPhotoIdx - 1); });
  document.getElementById('lbNext').addEventListener('click', (e) => { e.stopPropagation(); openLightbox(curPhotoIdx + 1); });
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });

  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('show')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') openLightbox(curPhotoIdx - 1);
    if (e.key === 'ArrowRight') openLightbox(curPhotoIdx + 1);
  });
})();
