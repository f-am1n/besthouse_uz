/* ==========================================================================
   BestHouse.uz — демо-данные, гео-модели Ташкента и интеграция площадок
   --------------------------------------------------------------------------
   Подключены площадки недвижимости Узбекистана:
   - Uybor.uz (живой публичный API: https://api.uybor.uz/api/v1/listings)
   - OLX.uz, Uysot.uz, Domtut.uz, Tashkent.etagi.com, Realt24.uz, Joymee.uz
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Геометрия ---------- */
  const LAT0 = 41.3;
  const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180); // м на 1° долготы
  const KY = 110950;                                     // м на 1° широты
  const WALK_SPEED = 80;  // м/мин — средний темп пешехода
  const DETOUR = 1.0;     // коэффициент извилистости (1 = по прямой, согласовано с изохронами)
  const USD_TO_UZS = 12850; // курс для справочного пересчёта в сумы

  function toXY(lat, lng) { return [lng * KX, lat * KY]; }
  function distM(a, b) {
    const dx = (b[1] - a[1]) * KX, dy = (b[0] - a[0]) * KY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- Детерминированный ГПСЧ ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Площадки недвижимости Узбекистана ---------- */
  const platforms = {
    uybor: {
      id: 'uybor',
      name: 'Uybor.uz',
      short: 'Uybor',
      color: '#00a651',
      accent: '#00a651',
      badgeBg: '#00a651',
      badgeColor: '#ffffff',
      domain: 'uybor.uz',
      liveApi: true,
      desc: 'Прямая Live-интеграция с API Uybor.uz: реальные квартиры, дома и ЖК Ташкента с настоящими фото и GPS-координатами.'
    },
    olx: {
      id: 'olx',
      name: 'OLX.uz',
      short: 'OLX',
      color: '#002f34',
      accent: '#23e5db',
      badgeBg: '#002f34',
      badgeColor: '#23e5db',
      domain: 'olx.uz',
      liveApi: false,
      desc: 'Крупнейший сервис объявлений Узбекистана — вторичка, новостройки и частные дома от собственников и риэлторов.'
    },
    uysot: {
      id: 'uysot',
      name: 'Uysot.uz',
      short: 'Uysot',
      color: '#ff5a00',
      accent: '#ff5a00',
      badgeBg: '#ff5a00',
      badgeColor: '#ffffff',
      domain: 'uysot.uz',
      liveApi: false,
      desc: 'Специализированная платформа продажи квартир и новостроек в Ташкенте с проверенными ценами.'
    },
    domtut: {
      id: 'domtut',
      name: 'Domtut.uz',
      short: 'Domtut',
      color: '#2563eb',
      accent: '#2563eb',
      badgeBg: '#2563eb',
      badgeColor: '#ffffff',
      domain: 'domtut.uz',
      liveApi: false,
      desc: 'Каталог жилых комплексов, застройщиков и квартир в новостройках и на вторичном рынке Ташкента.'
    },
    etagi: {
      id: 'etagi',
      name: 'Etagi.com',
      short: 'Этажи',
      color: '#e31e24',
      accent: '#e31e24',
      badgeBg: '#e31e24',
      badgeColor: '#ffffff',
      domain: 'tashkent.etagi.com',
      liveApi: false,
      desc: 'Международное агентство недвижимости в Ташкенте: проверенные объекты и ипотечное сопровождение.'
    },
    realt24: {
      id: 'realt24',
      name: 'Realt24.uz',
      short: 'Realt24',
      color: '#0d9488',
      accent: '#0d9488',
      badgeBg: '#0d9488',
      badgeColor: '#ffffff',
      domain: 'realt24.uz',
      liveApi: false,
      desc: 'Популярная площадка продажи и аренды жилья в Ташкенте с удобным поиском по станциям метро и ориентирам.'
    },
    joymee: {
      id: 'joymee',
      name: 'Joymee.uz',
      short: 'Joymee',
      color: '#7c3aed',
      accent: '#7c3aed',
      badgeBg: '#7c3aed',
      badgeColor: '#ffffff',
      domain: 'joymee.uz',
      liveApi: false,
      desc: 'Современный сервис поиска проверенной недвижимости и жилых комплексов по всему Узбекистану.'
    }
  };

  const platformKeys = ['uybor', 'olx', 'uysot', 'domtut', 'etagi', 'realt24', 'joymee'];

  const districtSlugs = {
    'Юнусабад': { olx: 'yunusabadskiy-rayon', q: 'юнусабад', en: 'yunusabad', uyborId: 197 },
    'Мирзо-Улугбек': { olx: 'mirzo-ulugbekskiy-rayon', q: 'мирзо улугбек', en: 'mirzo-ulugbek', uyborId: 196 },
    'Чиланзар': { olx: 'chilanzarskiy-rayon', q: 'чиланзар', en: 'chilanzar', uyborId: 202 },
    'Яккасарай': { olx: 'yakkasarayskiy-rayon', q: 'яккасарай', en: 'yakkasaray', uyborId: 205 },
    'Мирабад': { olx: 'mirabadskiy-rayon', q: 'мирабад', en: 'mirabad', uyborId: 204 },
    'Шайхантахур': { olx: 'shaykhantakhurskiy-rayon', q: 'шайхантахур', en: 'shaykhantakhur', uyborId: 198 },
    'Сергели': { olx: 'sergeliyskiy-rayon', q: 'сергели', en: 'sergeli', uyborId: 206 },
    'Учтепа': { olx: 'uchtepinskiy-rayon', q: 'учтепа', en: 'uchtepa', uyborId: 203 },
    'Яшнабад': { olx: 'yashnabadskiy-rayon', q: 'яшнабад', en: 'yashnabad', uyborId: 200 },
    'Алмазар': { olx: 'almazarskiy-rayon', q: 'алмазар', en: 'almazar', uyborId: 199 },
    'Tashkent City': { olx: 'shaykhantakhurskiy-rayon', q: 'tashkent city', en: 'tashkent-city', uyborId: 198 }
  };

  // Генератор реальных поисковых URL на внешние площадки по параметрам объекта или фильтра
  function buildPortalUrl(platformId, opts = {}) {
    const district = opts.district || '';
    const rooms = opts.rooms || '';
    const priceMin = opts.priceMin || (opts.price ? Math.round(opts.price * 0.85) : '');
    const priceMax = opts.priceMax || (opts.price ? Math.round(opts.price * 1.15) : '');
    const type = opts.type || '';
    const slugInfo = districtSlugs[district] || { q: district || 'ташкент', en: 'tashkent', uyborId: '' };

    if (platformId === 'uybor') {
      const params = new URLSearchParams();
      params.set('operationType', 'sale');
      params.set('category', type === 'Дом' ? '8' : '7');
      if (slugInfo.uyborId) params.set('district', slugInfo.uyborId);
      if (rooms) params.set('rooms', rooms);
      if (priceMin) params.set('priceFrom', priceMin);
      if (priceMax) params.set('priceTo', priceMax);
      return `https://uybor.uz/ru/listings?${params.toString()}`;
    }

    if (platformId === 'olx') {
      const cat = type === 'Дом' ? 'doma/prodazha' : 'kvartiry/prodazha';
      const qPart = district ? `q-${encodeURIComponent(slugInfo.q)}/` : '';
      const params = new URLSearchParams();
      params.set('currency', 'USD');
      if (priceMin) params.set('search[filter_float_price:from]', priceMin);
      if (priceMax) params.set('search[filter_float_price:to]', priceMax);
      if (rooms && type !== 'Дом') {
        params.set('search[filter_float_number_of_rooms:from]', rooms);
        params.set('search[filter_float_number_of_rooms:to]', rooms >= 4 ? 6 : rooms);
      }
      return `https://www.olx.uz/nedvizhimost/${cat}/tashkent/${qPart}?${params.toString()}`;
    }

    if (platformId === 'uysot') {
      const roomSlug = rooms ? `${rooms}-komnatnye` : '';
      const q = encodeURIComponent(district ? `${slugInfo.q} ${rooms ? rooms + ' комн' : ''}`.trim() : 'ташкент');
      return `https://uysot.uz/ru/kvartiry/prodazha-kvartir/${roomSlug}?q=${q}`;
    }

    if (platformId === 'domtut') {
      const sub = type === 'Новостройка' ? 'novostroyki' : 'kvartiry';
      const params = new URLSearchParams();
      if (rooms) params.set('rooms', rooms);
      if (priceMax) params.set('price_to', priceMax);
      if (district) params.set('search', slugInfo.q);
      return `https://domtut.uz/nedvizhimost/${sub}?${params.toString()}`;
    }

    if (platformId === 'etagi') {
      const sub = type === 'Новостройка' ? 'zastr/jk/' : type === 'Дом' ? 'cotteges/' : 'realty/';
      const params = new URLSearchParams();
      if (rooms && type !== 'Дом') params.set('rooms[]', rooms >= 4 ? '4' : String(rooms));
      if (priceMin) params.set('price_min', priceMin);
      if (priceMax) params.set('price_max', priceMax);
      return `https://tashkent.etagi.com/${sub}?${params.toString()}`;
    }

    if (platformId === 'realt24') {
      const rSlug = rooms == 1 ? 'bir-xonali/' : rooms == 2 ? 'ikki-xonali/' : rooms == 3 ? 'uch-xonali/' : rooms >= 4 ? 'tort-xonali/' : '';
      return `https://realt24.uz/toshkent/sotib-olmoq/kvartiralar/${rSlug}`;
    }

    if (platformId === 'joymee') {
      return `https://joymee.uz/`;
    }

    return 'https://uybor.uz/ru/listings';
  }

  function buildAllPortalUrls(opts = {}) {
    return platformKeys.map((id) => ({
      platform: platforms[id],
      url: (opts.source === id && opts.externalUrl) ? opts.externalUrl : buildPortalUrl(id, opts)
    }));
  }

  /* ---------- Метро (4 линии Ташкентского метрополитена) ---------- */
  const metroLines = [
    {
      id: 'chilonzor', name: 'Чиланзарская линия', color: '#e53935',
      stations: [
        ['Буюк Ипак Йули', 41.3268, 69.3366], ['Пушкин', 41.3229, 69.3199],
        ['Хамид Олимжон', 41.3176, 69.3018], ['Амир Темур хиёбони', 41.3113, 69.2800],
        ['Мустакиллик майдони', 41.3048, 69.2709], ['Пахтакор', 41.3068, 69.2620],
        ['Халклар дустлиги', 41.3087, 69.2457], ['Миллий бог', 41.3030, 69.2300],
        ['Новза', 41.2933, 69.2215], ['Мирзо Улугбек', 41.2847, 69.2108],
        ['Чиланзар', 41.2753, 69.2042], ['Алмазар', 41.2683, 69.1955],
        ['Чоштепа', 41.2520, 69.1920], ['Узгариш', 41.2415, 69.1995],
        ['Сергели', 41.2310, 69.2090], ['Янгихаёт', 41.2215, 69.2165],
        ['Чинор', 41.2130, 69.2235]
      ]
    },
    {
      id: 'uzbekistan', name: 'Узбекистанская линия', color: '#1e88e5',
      stations: [
        ['Беруни', 41.3446, 69.2058], ['Тинчлик', 41.3365, 69.2183],
        ['Чорсу', 41.3270, 69.2345], ['Гафур Гулом', 41.3200, 69.2470],
        ['Алишер Навои', 41.3092, 69.2600], ['Узбекистан', 41.3045, 69.2735],
        ['Космонавтлар', 41.3000, 69.2830], ['Ойбек', 41.2960, 69.2790],
        ['Ташкент', 41.2925, 69.2890], ['Машинасозлар', 41.2880, 69.3070],
        ['Дустлик', 41.2850, 69.3200]
      ]
    },
    {
      id: 'yunusobod', name: 'Юнусабадская линия', color: '#43a047',
      stations: [
        ['Туркистон', 41.3712, 69.2905], ['Юнусобод', 41.3640, 69.2875],
        ['Шахристон', 41.3550, 69.2860], ['Бодомзор', 41.3380, 69.2850],
        ['Минор', 41.3270, 69.2840], ['Абдулла Кодирий', 41.3190, 69.2812],
        ['Юнус Ражабий', 41.3118, 69.2822], ['Минг Урик', 41.2985, 69.2800]
      ]
    },
    {
      id: 'ring', name: 'Кольцевая линия (Надземная)', color: '#f59e0b',
      stations: [
        ['Технопарк', 41.2860, 69.3220], ['Яшнабад', 41.2930, 69.3380],
        ['Тузель', 41.2980, 69.3540], ['Олмос', 41.2950, 69.3730],
        ['Рохат', 41.2780, 69.3720], ['Янгиобод', 41.2620, 69.3580],
        ['Куйлюк', 41.2440, 69.3320], ['Матонат', 41.2360, 69.3100],
        ['Киёт', 41.2300, 69.2920], ['Толарик', 41.2240, 69.2740],
        ['Ханабад', 41.2190, 69.2560], ['Курувчилар', 41.2160, 69.2400],
        ['Турон', 41.2140, 69.2310], ['Кипчак', 41.2120, 69.2250]
      ]
    }
  ].map((l) => ({
    ...l,
    stations: l.stations.map(([name, lat, lng], i) => ({
      id: `${l.id}-${i}`, name, ll: [lat, lng], line: l.id, color: l.color
    }))
  }));

  const metroStations = metroLines.flatMap((l) => l.stations);

  metroLines.forEach((l) => {
    l.stations.forEach((s, i) => {
      const prev = l.stations[Math.max(0, i - 1)].ll;
      const next = l.stations[Math.min(l.stations.length - 1, i + 1)].ll;
      const dx = (next[1] - prev[1]) * KX, dy = (next[0] - prev[0]) * KY;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const off = 70;
      s.entrances = [1, -1].map((sg, k) => ({
        ll: [s.ll[0] + (sg * ux * off) / KY, s.ll[1] + (sg * -uy * off) / KX],
        name: `Вход ${k + 1}`
      }));
    });
  });

  /* ---------- Магистрали ---------- */
  const roads = [
    { id: 'amir-temur', name: 'пр. Амира Темура', type: 'Проспект', load: 0.95, noiseDb: 76, lanes: 8,
      path: [[41.3113, 69.2795], [41.3270, 69.2840], [41.3450, 69.2870], [41.3650, 69.2885], [41.3820, 69.2905]] },
    { id: 'small-ring', name: 'Малая кольцевая дорога', type: 'Кольцевая', load: 0.9, noiseDb: 75, lanes: 6,
      path: [[41.3420, 69.2350], [41.3480, 69.2650], [41.3400, 69.3000], [41.3200, 69.3150], [41.2950, 69.3050],
        [41.2850, 69.2800], [41.2900, 69.2400], [41.3100, 69.2200], [41.3300, 69.2250], [41.3420, 69.2350]] },
    { id: 'big-ring', name: 'Большая кольцевая дорога', type: 'Кольцевая', load: 0.7, noiseDb: 77, lanes: 6,
      path: [[41.3850, 69.2200], [41.3900, 69.2900], [41.3700, 69.3500], [41.3300, 69.3800], [41.2800, 69.3600],
        [41.2400, 69.3200], [41.2250, 69.2600], [41.2400, 69.2000], [41.2700, 69.1600], [41.3200, 69.1600],
        [41.3600, 69.1800], [41.3850, 69.2200]] },
    { id: 'bunyodkor', name: 'пр. Бунёдкор', type: 'Проспект', load: 0.85, noiseDb: 74, lanes: 8,
      path: [[41.3030, 69.2450], [41.2900, 69.2250], [41.2750, 69.2050], [41.2600, 69.1850], [41.2450, 69.1650]] },
    { id: 'rustaveli', name: 'ул. Шота Руставели', type: 'Улица', load: 0.8, noiseDb: 71, lanes: 4,
      path: [[41.3000, 69.2700], [41.2850, 69.2600], [41.2650, 69.2450], [41.2400, 69.2300], [41.2200, 69.2200]] },
    { id: 'mustaqillik', name: 'пр. Мустакиллик / Буюк Ипак Йули', type: 'Проспект', load: 0.88, noiseDb: 74, lanes: 6,
      path: [[41.3113, 69.2800], [41.3180, 69.3000], [41.3230, 69.3200], [41.3270, 69.3400], [41.3300, 69.3700]] },
    { id: 'beruniy', name: 'ул. Фараби / пр. Беруни', type: 'Проспект', load: 0.75, noiseDb: 72, lanes: 6,
      path: [[41.3200, 69.2470], [41.3300, 69.2300], [41.3450, 69.2050], [41.3600, 69.1850]] },
    { id: 'navoi', name: 'ул. Навои', type: 'Улица', load: 0.82, noiseDb: 71, lanes: 4,
      path: [[41.3113, 69.2700], [41.3150, 69.2550], [41.3230, 69.2400], [41.3270, 69.2300]] },
    { id: 'airport', name: 'ул. Кушбеги / к аэропорту', type: 'Улица', load: 0.65, noiseDb: 70, lanes: 4,
      path: [[41.2925, 69.2890], [41.2750, 69.2850], [41.2600, 69.2820]] },
    { id: 'ulugbek', name: 'ул. Мирзо Улугбека', type: 'Улица', load: 0.7, noiseDb: 70, lanes: 4,
      path: [[41.3200, 69.3150], [41.3350, 69.3300], [41.3500, 69.3400]] },
    { id: 'qatortol', name: 'ул. Катартал', type: 'Улица', load: 0.6, noiseDb: 68, lanes: 4,
      path: [[41.3100, 69.2200], [41.2950, 69.2050], [41.2800, 69.1900], [41.2650, 69.1800]] }
  ];
  roads.forEach((r) => {
    r.segs = [];
    for (let i = 0; i < r.path.length - 1; i++) {
      const a = toXY(r.path[i][0], r.path[i][1]), b = toXY(r.path[i + 1][0], r.path[i + 1][1]);
      r.segs.push([a[0], a[1], b[0], b[1]]);
    }
  });
  function roadDist(road, x, y) {
    let m = Infinity;
    for (const s of road.segs) { const d = segDist(x, y, s[0], s[1], s[2], s[3]); if (d < m) m = d; }
    return m;
  }

  /* ---------- Автобусные маршруты ---------- */
  const busRoutes = [
    { id: 'b67', name: 'Автобус №67', color: '#8e24aa',
      path: [[41.3640, 69.2875], [41.3450, 69.2870], [41.3270, 69.2840], [41.3113, 69.2800], [41.3000, 69.2700], [41.2850, 69.2600], [41.2650, 69.2450]] },
    { id: 'b11', name: 'Автобус №11', color: '#fb8c00',
      path: [[41.3446, 69.2058], [41.3300, 69.2300], [41.3200, 69.2470], [41.3150, 69.2550], [41.3113, 69.2700], [41.3180, 69.3000], [41.3230, 69.3200]] },
    { id: 'b30', name: 'Автобус №30', color: '#00897b',
      path: [[41.2556, 69.1790], [41.2750, 69.2050], [41.2900, 69.2250], [41.3030, 69.2450], [41.3092, 69.2600], [41.3045, 69.2735], [41.2925, 69.2890], [41.2850, 69.3200]] },
    { id: 'b93', name: 'Автобус №93', color: '#6d4c41',
      path: [[41.3268, 69.3366], [41.3350, 69.3300], [41.3400, 69.3000], [41.3480, 69.2650], [41.3550, 69.2860], [41.3712, 69.2905]] }
  ];

  /* ---------- Источники и поглотители загрязнения ---------- */
  const parks = [
    { name: 'Национальный парк Алишера Навои', ll: [41.3030, 69.2330], r: 700 },
    { name: 'Ташкентский Ботанический сад', ll: [41.3440, 69.3150], r: 900 },
    { name: 'Tashkent City Park', ll: [41.3165, 69.2480], r: 450 },
    { name: 'Сквер Амира Темура', ll: [41.3113, 69.2800], r: 260 },
    { name: 'Экопарк / Парк Юнусабад', ll: [41.3600, 69.2950], r: 600 },
    { name: 'Парк Бабура и наб. Анхор', ll: [41.2990, 69.2560], r: 550 },
    { name: 'Парк Ашхабад', ll: [41.2950, 69.3020], r: 500 },
    { name: 'Японский сад', ll: [41.3375, 69.2830], r: 350 },
    { name: 'Парк Гафура Гуляма', ll: [41.2785, 69.2085], r: 480 }
  ];
  const industrial = [
    { name: 'Промзона Сергели', ll: [41.2250, 69.2150], r: 2600, v: 70 },
    { name: 'ТЭЦ / промзона Мирзо-Улугбек', ll: [41.3450, 69.3650], r: 2000, v: 45 },
    { name: 'Промзона Бектемир', ll: [41.2150, 69.3350], r: 2200, v: 55 },
    { name: 'Промзона Учтепа', ll: [41.2950, 69.1650], r: 1600, v: 30 }
  ];
  const AIRPORT = { name: 'Аэропорт Ташкент', ll: [41.2579, 69.2812] };

  /* ---------- Трафик: суточный профиль ---------- */
  function hourFactor(h) {
    const g = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
    return clamp(0.15 + 0.85 * Math.max(g(8.7, 1.2), g(18.3, 1.5)) + 0.3 * g(13.5, 2.2), 0, 1);
  }
  function congestion(road, hour) {
    const jitter = (road.id.length % 5) * 0.02;
    return clamp(road.load * hourFactor(hour) + jitter, 0.03, 1);
  }
  function cityScore(hour) {
    const avg = roads.reduce((s, r) => s + congestion(r, hour) * r.lanes, 0) / roads.reduce((s, r) => s + r.lanes, 0);
    return clamp(Math.round(1 + avg * 9.5), 1, 10);
  }
  function trafficSpeed(road, hour) {
    const free = road.type === 'Кольцевая' ? 70 : road.type === 'Проспект' ? 60 : 50;
    return Math.round(free * (1 - 0.82 * congestion(road, hour)));
  }

  /* ---------- Поля AQI / шума ---------- */
  function noiseAt(lat, lng) {
    const [x, y] = toXY(lat, lng);
    let e = Math.pow(10, 38 / 10);
    for (const r of roads) {
      const d = roadDist(r, x, y);
      if (d > 3000) continue;
      const L = r.noiseDb - 18 * Math.log10(1 + d / 20);
      e += Math.pow(10, L / 10);
    }
    const da = distM([lat, lng], AIRPORT.ll);
    e += Math.pow(10, (74 - 20 * Math.log10(1 + da / 450)) / 10);
    let L = 10 * Math.log10(e);
    for (const p of parks) {
      const d = distM([lat, lng], p.ll);
      L -= 5 * Math.exp(-((d / p.r) ** 2));
    }
    return clamp(L, 30, 85);
  }

  function aqiAt(lat, lng) {
    const [x, y] = toXY(lat, lng);
    let v = 60 + (41.31 - lat) * 330;
    for (const s of industrial) {
      const d = distM([lat, lng], s.ll);
      v += s.v * Math.exp(-((d / s.r) ** 2));
    }
    let t = 0;
    for (const r of roads) {
      const d = roadDist(r, x, y);
      if (d > 1500) continue;
      t += r.load * 32 * Math.exp(-((d / 380) ** 2));
    }
    v += Math.min(t, 55);
    for (const p of parks) {
      const d = distM([lat, lng], p.ll);
      v -= 20 * Math.exp(-((d / (p.r * 1.4)) ** 2));
    }
    return clamp(v, 15, 220);
  }

  function aqiToPm25(aqi) {
    const bp = [[0, 50, 0, 12], [51, 100, 12.1, 35.4], [101, 150, 35.5, 55.4], [151, 200, 55.5, 150.4], [201, 300, 150.5, 250.4]];
    for (const [il, ih, cl, ch] of bp) {
      if (aqi <= ih) return +(cl + ((aqi - il) * (ch - cl)) / (ih - il)).toFixed(1);
    }
    return 250;
  }

  function nearestStations(ll, n = 1) {
    return metroStations
      .map((s) => {
        const d = distM(ll, s.ll);
        return { station: s, dist: Math.round(d), walkMin: Math.max(1, Math.round((d * DETOUR) / WALK_SPEED)) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n);
  }

  function nearestRoad(ll) {
    const [x, y] = toXY(ll[0], ll[1]);
    let best = null;
    for (const r of roads) {
      const d = roadDist(r, x, y);
      if (!best || d < best.dist) best = { road: r, dist: Math.round(d) };
    }
    return best;
  }

  function nearestPark(ll) {
    let best = null;
    for (const p of parks) {
      const d = Math.max(0, Math.round(distM(ll, p.ll) - p.r * 0.4));
      if (!best || d < best.dist) {
        best = { park: p, dist: d, walkMin: Math.max(1, Math.round(d / WALK_SPEED)) };
      }
    }
    return best;
  }

  function ecoScoreAt(aqi, noise, walkMin, parkDist = 1000) {
    const airScore = clamp(100 - (aqi - 20) * 0.65, 10, 100);
    const noiseScore = clamp(100 - (noise - 36) * 2.1, 10, 100);
    const metroScore = clamp(100 - Math.max(0, walkMin - 3) * 2.4, 20, 100);
    const parkScore = clamp(100 - (parkDist / 25), 20, 100);
    return Math.round(airScore * 0.42 + noiseScore * 0.30 + metroScore * 0.16 + parkScore * 0.12);
  }

  /* ---------- Районы Ташкента ---------- */
  const districts = [
    { name: 'Юнусабад', c: [41.360, 69.288], r: 2300, ppm: 1150, w: 18 },
    { name: 'Мирзо-Улугбек', c: [41.332, 69.335], r: 2300, ppm: 1150, w: 16 },
    { name: 'Чиланзар', c: [41.278, 69.205], r: 2400, ppm: 950, w: 20 },
    { name: 'Яккасарай', c: [41.290, 69.262], r: 1300, ppm: 1350, w: 9 },
    { name: 'Мирабад', c: [41.300, 69.287], r: 1400, ppm: 1450, w: 11 },
    { name: 'Шайхантахур', c: [41.323, 69.245], r: 1800, ppm: 1050, w: 12 },
    { name: 'Сергели', c: [41.230, 69.225], r: 2300, ppm: 700, w: 12 },
    { name: 'Учтепа', c: [41.300, 69.180], r: 2000, ppm: 800, w: 10 },
    { name: 'Яшнабад', c: [41.298, 69.332], r: 2100, ppm: 900, w: 12 },
    { name: 'Алмазар', c: [41.352, 69.218], r: 2100, ppm: 850, w: 10 },
    { name: 'Tashkent City', c: [41.315, 69.249], r: 450, ppm: 2300, w: 6 }
  ];

  function inferDistrictByCoords(lat, lng) {
    let best = districts[0], minD = Infinity;
    for (const d of districts) {
      const dist = distM([lat, lng], d.c);
      if (dist < minD) { minD = dist; best = d; }
    }
    return best.name;
  }

  // Обогащение любого объекта (из API Uybor.uz, импортированного или демо) эко-индексами
  function enrichListingWithEnv(item) {
    const lat = +item.lat || 41.305;
    const lng = +item.lng || 69.27;
    const aqi = Math.round(aqiAt(lat, lng));
    const noise = Math.round(noiseAt(lat, lng));
    const near = nearestStations([lat, lng], 1)[0];
    const nearPark = nearestPark([lat, lng]);
    const ecoRating = ecoScoreAt(aqi, noise, near.walkMin, nearPark.dist);
    const area = Math.max(15, Math.round(+item.area || 60));
    const price = Math.max(10000, Math.round(+item.price || 65000));
    const rooms = Math.max(1, Math.min(8, Math.round(+item.rooms || 2)));
    const src = platforms[item.source] ? item.source : 'uybor';
    const district = item.district || inferDistrictByCoords(lat, lng);

    return {
      ...item,
      lat, lng, rooms, area, price, district,
      pricePerM2: Math.round(price / area),
      aqi, pm25: aqiToPm25(aqi), noise, ecoRating,
      source: src,
      sourceInfo: platforms[src],
      externalUrl: item.externalUrl || buildPortalUrl(src, { district, rooms, price, type: item.type }),
      metro: { name: near.station.name, line: near.station.line, color: near.station.color, dist: near.dist, walkMin: near.walkMin },
      park: { name: nearPark.park.name, dist: nearPark.dist, walkMin: nearPark.walkMin }
    };
  }

  /* ---------- Классификация и цвета ---------- */
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function makeScale(stops) {
    const s = stops.map(([v, c]) => [v, hexToRgb(c)]);
    return function (v) {
      if (v <= s[0][0]) return s[0][1];
      for (let i = 1; i < s.length; i++) {
        if (v <= s[i][0]) {
          const [v0, c0] = s[i - 1], [v1, c1] = s[i], t = (v - v0) / (v1 - v0);
          return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t));
        }
      }
      return s[s.length - 1][1];
    };
  }
  const aqiScale = makeScale([[0, '#1fbf6a'], [45, '#1fbf6a'], [70, '#f2d22e'], [100, '#f5a524'], [140, '#e5484d'], [190, '#8e3bc7']]);
  const noiseScale = makeScale([[38, '#1fbf6a'], [48, '#8fd14f'], [55, '#f2d22e'], [62, '#f5a524'], [70, '#e5484d'], [78, '#8e1d3b']]);
  const trafficScale = makeScale([[0, '#1fbf6a'], [0.35, '#9ad04c'], [0.55, '#f2d22e'], [0.72, '#f5a524'], [0.86, '#e5484d'], [1, '#8e1d3b']]);
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  function aqiClass(v) {
    if (v <= 50) return { key: 'good', label: 'Хорошее', color: '#1fbf6a' };
    if (v <= 100) return { key: 'moderate', label: 'Умеренное', color: '#e8b715' };
    if (v <= 150) return { key: 'sensitive', label: 'Для чувствит.', color: '#f08a24' };
    return { key: 'bad', label: 'Вредное', color: '#e5484d' };
  }
  function noiseClass(db) {
    if (db < 45) return { key: 'quiet', label: 'Тихо', color: '#1fbf6a', score: 1 };
    if (db < 55) return { key: 'calm', label: 'Спокойно', color: '#8fbf3a', score: 2 };
    if (db < 65) return { key: 'loud', label: 'Шумно', color: '#f08a24', score: 3 };
    return { key: 'very-loud', label: 'Очень шумно', color: '#e5484d', score: 4 };
  }
  const noisePoints = (db) => clamp(Math.round((db - 34) / 4), 1, 10);
  function trafficClass(c) {
    if (c < 0.35) return { label: 'Свободно', color: '#1fbf6a' };
    if (c < 0.55) return { label: 'Умеренно', color: '#9ad04c' };
    if (c < 0.72) return { label: 'Плотно', color: '#e8b715' };
    if (c < 0.86) return { label: 'Затруднено', color: '#f08a24' };
    return { label: 'Пробка', color: '#e5484d' };
  }
  function ecoClass(score) {
    if (score >= 78) return { label: 'Отлично', color: '#1fbf6a' };
    if (score >= 64) return { label: 'Хорошо', color: '#8fbf3a' };
    if (score >= 50) return { label: 'Средне', color: '#e8b715' };
    return { label: 'Ниже среднего', color: '#f08a24' };
  }

  /* ---------- Загрузка реальной базы квартир с площадок Узбекистана (js/real_db.js) ---------- */
  const REAL_FALLBACK_PHOTOS = [
    'https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg',
    'https://api.uybor.uz/api/v1/media/n/17940619591254106.jpg',
    'https://api.uybor.uz/api/v1/media/n/17940614577647176.jpeg',
    'https://api.uybor.uz/api/v1/media/n/17940599922385227.jpg'
  ];

  /* ---------- Пользовательские и Live-импортированные объекты (localStorage) ---------- */
  const CUSTOM_LISTINGS_KEY = 'bh_custom_listings_real_v3';
  function getCustomListings() {
    try {
      const raw = JSON.parse(localStorage.getItem(CUSTOM_LISTINGS_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((x) => x && Array.isArray(x.photos) && x.photos[0] && !String(x.photos[0]).startsWith('assets/'))
        .map(enrichListingWithEnv);
    } catch (_) {
      return [];
    }
  }
  function saveCustomListings(arr) {
    try { localStorage.setItem(CUSTOM_LISTINGS_KEY, JSON.stringify(arr.slice(0, 150))); } catch (_) {}
  }

  const baseListings = (Array.isArray(window.BH_REAL_DB) ? window.BH_REAL_DB : []).map(enrichListingWithEnv);
  const baseIds = new Set(baseListings.map((x) => x.id));
  const customStored = getCustomListings().filter((x) => !baseIds.has(x.id));
  const allListings = [...customStored, ...baseListings];

  function addCustomListing(rawItem, saveToStorage = true) {
    const existingIdx = allListings.findIndex((x) => x.id === rawItem.id || (rawItem.externalId && x.externalId === rawItem.externalId));
    if (existingIdx !== -1) {
      return allListings[existingIdx];
    }

    const maxId = allListings.reduce((m, x) => Math.max(m, +x.id || 0), 1000);
    const cleanPhotos = Array.isArray(rawItem.photos)
      ? rawItem.photos.filter((p) => p && !String(p).startsWith('assets/'))
      : [];
    const enriched = enrichListingWithEnv({
      id: rawItem.id || maxId + 1,
      lat: rawItem.lat || 41.305,
      lng: rawItem.lng || 69.27,
      source: rawItem.source || 'uybor',
      externalId: rawItem.externalId || `IMP-${Date.now().toString().slice(-6)}`,
      externalUrl: rawItem.externalUrl || '',
      type: rawItem.type || 'Вторичка',
      title: rawItem.title || `${rawItem.rooms || 2}-комн. квартира, ${rawItem.area || 62} м²`,
      district: rawItem.district || inferDistrictByCoords(rawItem.lat || 41.305, rawItem.lng || 69.27),
      address: rawItem.address || `${rawItem.district || 'Ташкент'}`,
      complex: rawItem.complex || null,
      description: rawItem.description || '',
      rooms: +rawItem.rooms || 2,
      area: +rawItem.area || 62,
      floor: +rawItem.floor || 4,
      totalFloors: +rawItem.totalFloors || 9,
      year: +rawItem.year || 2023,
      price: +rawItem.price || 68000,
      photos: cleanPhotos.length ? cleanPhotos : REAL_FALLBACK_PHOTOS,
      renovation: rawItem.renovation || 'Евроремонт',
      ceiling: rawItem.ceiling || '3.0 м',
      material: rawItem.material || 'Кирпич',
      parking: rawItem.parking || 'Наземная во дворе',
      phone: rawItem.phone || '+998 (90) 900-11-22',
      postedDaysAgo: rawItem.postedDaysAgo != null ? rawItem.postedDaysAgo : 0,
      isImported: true,
      isLiveApi: !!rawItem.isLiveApi
    });

    allListings.unshift(enriched);
    if (saveToStorage) {
      const stored = getCustomListings();
      if (!stored.some((x) => x.id === enriched.id)) {
        stored.unshift(enriched);
        saveCustomListings(stored);
      }
    }
    return enriched;
  }

  function clearCustomListings() {
    saveCustomListings([]);
    const keep = allListings.filter((x) => baseIds.has(x.id));
    allListings.length = 0;
    allListings.push(...keep);
  }

  /* ---------- Универсальная сериализация объекта в URL (для OLX, Uybor, Uysot, Domtut, Etagi, Realt24, Joymee) ---------- */
  function encodeSharePayload(l) {
    if (!l) return '';
    try {
      const minObj = {
        i: l.id,
        s: l.source || 'olx',
        ei: l.externalId || '',
        eu: l.externalUrl || '',
        t: l.type || 'Вторичка',
        r: l.rooms || 2,
        a: l.area || 60,
        f: l.floor || 4,
        tf: l.totalFloors || 9,
        y: l.year || 2022,
        p: l.price || 68000,
        d: l.district || 'Мирабад',
        ad: l.address || '',
        cx: l.complex || '',
        lt: +(+l.lat).toFixed(5),
        ln: +(+l.lng).toFixed(5),
        rv: l.renovation || 'Евроремонт',
        ph: l.phone || '+998 (90) 900-11-22',
        im: Array.isArray(l.photos) ? l.photos.slice(0, 4) : [],
        ds: (l.description || '').slice(0, 280)
      };
      const json = JSON.stringify(minObj);
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    } catch (_) {
      return '';
    }
  }

  function decodeSharePayload(token) {
    if (!token) return null;
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64 + '==='.slice((b64.length + 3) % 4);
      const json = decodeURIComponent(escape(atob(pad)));
      const m = JSON.parse(json);
      if (!m || (!m.lt && !m.p)) return null;
      return {
        id: +m.i || Date.now(),
        source: m.s || 'olx',
        externalId: m.ei || '',
        externalUrl: m.eu || '',
        type: m.t || 'Вторичка',
        rooms: +m.r || 2,
        area: +m.a || 60,
        floor: +m.f || 4,
        totalFloors: +m.tf || 9,
        year: +m.y || 2022,
        price: +m.p || 68000,
        district: m.d || inferDistrictByCoords(+m.lt || 41.305, +m.ln || 69.27),
        address: m.ad || m.d || 'Ташкент',
        complex: m.cx || null,
        lat: +m.lt || 41.305,
        lng: +m.ln || 69.27,
        renovation: m.rv || 'Евроремонт',
        phone: m.ph || '+998 (90) 900-11-22',
        photos: Array.isArray(m.im) && m.im.length ? m.im : REAL_FALLBACK_PHOTOS,
        description: m.ds || '',
        isImported: true
      };
    } catch (_) {
      return null;
    }
  }

  function buildPropertyPageUrl(l) {
    if (!l) return 'property.html';
    if (baseIds.has(+l.id)) return `property.html?id=${l.id}&src=${l.source || ''}`;
    const d = encodeSharePayload(l);
    const params = new URLSearchParams();
    params.set('id', l.id);
    if (l.source) params.set('src', l.source);
    if (l.externalId) params.set('extId', l.externalId);
    if (d) params.set('d', d);
    return `property.html?${params.toString()}`;
  }

  function buildMapOpenUrl(l) {
    if (!l) return 'index.html';
    if (baseIds.has(+l.id)) return `index.html#open=${l.id}`;
    const d = encodeSharePayload(l);
    return `index.html?d=${encodeURIComponent(d)}#open=${l.id}`;
  }

  /* ---------- Избранное (localStorage) ---------- */
  const FAV_KEY = 'bh_favorites_v1';
  function getFavs() {
    try {
      return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
    } catch (_) {
      return new Set();
    }
  }
  function toggleFav(id) {
    const s = getFavs();
    const numId = +id;
    s.has(numId) ? s.delete(numId) : s.add(numId);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(s))); } catch (_) {}
    return s.has(numId);
  }

  /* ---------- Тема (localStorage) ---------- */
  const THEME_KEY = 'bh_theme_v1';
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (_) { return 'light'; }
  }
  function setTheme(t) {
    try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
    document.documentElement.setAttribute('data-theme', t);
    document.body.classList.toggle('theme-dark', t === 'dark');
  }

  /* ---------- Экспорт ---------- */
  window.BH = {
    CENTER: [41.305, 69.27],
    WALK_SPEED, DETOUR, USD_TO_UZS,
    platforms, platformKeys, buildPortalUrl, buildAllPortalUrls,
    districts: districts.map((d) => d.name),
    districtCoords: Object.fromEntries(districts.map((d) => [d.name, d.c])),
    inferDistrictByCoords,
    metroLines, metroStations, roads, busRoutes, parks, industrial, AIRPORT,
    listings: allListings,
    addCustomListing, clearCustomListings, enrichListingWithEnv,
    encodeSharePayload, decodeSharePayload, buildPropertyPageUrl, buildMapOpenUrl,
    geo: { distM, nearestStations, nearestRoad, nearestPark },
    env: { aqiAt, noiseAt, aqiToPm25, hourFactor, congestion, cityScore, trafficSpeed, ecoScoreAt },
    scales: { aqi: aqiScale, noise: noiseScale, traffic: trafficScale, rgb },
    classify: { aqi: aqiClass, noise: noiseClass, noisePoints, traffic: trafficClass, eco: ecoClass },
    favs: { get: getFavs, toggle: toggleFav },
    theme: { get: getTheme, set: setTheme },
    fmt: {
      usd: (v) => '$' + v.toLocaleString('ru-RU').replace(/,/g, ' '),
      short: (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(v / 1000) + 'k'),
      uzs: (usd) => {
        const s = usd * USD_TO_UZS;
        if (s >= 1e9) return (s / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' млрд сум';
        return Math.round(s / 1e6).toLocaleString('ru-RU') + ' млн сум';
      }
    }
  };
})();
