/* ==========================================================================
   BestHouse.uz — Интеграция с Uybor.uz (Live API), OLX.uz, Uysot.uz,
   Domtut.uz, Etagi.com, Realt24.uz и Joymee.uz
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Маппинг ID районов Uybor.uz → районы Ташкента ---------- */
  const UYBOR_DISTRICTS = {
    196: 'Мирзо-Улугбек',
    197: 'Юнусабад',
    198: 'Шайхантахур',
    199: 'Алмазар',
    434: 'Алмазар',
    200: 'Яшнабад',
    433: 'Яшнабад',
    201: 'Яшнабад', // Бектемир -> ближайший сектор
    202: 'Чиланзар',
    203: 'Учтепа',
    204: 'Мирабад',
    205: 'Яккасарай',
    206: 'Сергели'
  };

  const UYBOR_REPAIR = {
    evro: 'Евроремонт',
    avtorskiy: 'Дизайнерский',
    kosmeticheskiy: 'Косметический',
    sredniy: 'Косметический',
    bez_remonta: 'Без ремонта',
    chernovaya: 'Предчистовая',
    predchistovaya: 'Предчистовая',
    trebuet_remonta: 'Требует ремонта'
  };

  const UYBOR_FOUNDATION = {
    kirpich: 'Кирпич',
    panel: 'Панель',
    monolit: 'Монолит-кирпич',
    blok: 'Блочный',
    derevo: 'Кирпич'
  };

  /* ---------- Преобразование реального объекта из API Uybor.uz ---------- */
  function convertUyborApiItem(raw) {
    if (!raw || !raw.id) return null;
    const lat = parseFloat(raw.lat);
    const lng = parseFloat(raw.lng);
    // Проверяем, что координаты находятся в пределах Ташкента и области
    if (!lat || !lng || lat < 41.15 || lat > 41.48 || lng < 69.10 || lng > 69.48) return null;

    const usdPrice = raw.prices && raw.prices.usd
      ? Math.round(raw.prices.usd)
      : raw.priceCurrency === 'usd'
        ? Math.round(raw.price)
        : Math.round((raw.price || 0) / BH.USD_TO_UZS);

    if (!usdPrice || usdPrice < 12000 || usdPrice > 2500000) return null;

    const isHouse = raw.categoryId === 8;
    const isNew = !isHouse && !!raw.isNewBuilding;
    const type = isHouse ? 'Дом' : isNew ? 'Новостройка' : 'Вторичка';

    let rooms = parseInt(raw.room, 10);
    if (!rooms || isNaN(rooms)) rooms = raw.room === 'freeLayout' ? 3 : 2;
    rooms = Math.max(1, Math.min(8, rooms));

    const area = Math.max(18, Math.round(parseFloat(raw.square) || rooms * 28));
    const totalFloors = Math.max(1, parseInt(raw.floorTotal, 10) || (isHouse ? 2 : 9));
    const floor = Math.min(totalFloors, Math.max(1, parseInt(raw.floor, 10) || (isHouse ? 1 : 4)));

    const district = UYBOR_DISTRICTS[raw.districtId] || BH.inferDistrictByCoords(lat, lng);
    const rawAddr = (raw.address || '').trim();
    const address = rawAddr
      ? (rawAddr.toLowerCase().includes(district.toLowerCase()) ? rawAddr : `${district}, ${rawAddr}`)
      : `${district} район`;

    const mediaUrls = Array.isArray(raw.media)
      ? raw.media.map((m) => m && m.url).filter(Boolean).slice(0, 8)
      : [];
    const fallbackPhotos = [
      'https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg',
      'https://api.uybor.uz/api/v1/media/n/17940619591254106.jpg',
      'https://api.uybor.uz/api/v1/media/n/17940614577647176.jpeg',
      'https://api.uybor.uz/api/v1/media/n/17940599922385227.jpg'
    ];
    const photos = mediaUrls.length >= 4
      ? mediaUrls
      : [...mediaUrls, ...fallbackPhotos].slice(0, 4);

    const createdDate = raw.createdAt ? new Date(raw.createdAt) : new Date();
    const daysAgo = Math.max(0, Math.min(60, Math.floor((Date.now() - createdDate.getTime()) / 86400000)));

    return {
      id: 1000000 + Number(raw.id),
      uyborId: raw.id,
      source: 'uybor',
      externalId: `UYBOR-${raw.id}`,
      externalUrl: `https://uybor.uz/ru/listing/${raw.id}`,
      isLiveApi: true,
      lat,
      lng,
      type,
      title: `${rooms}-комн. ${isHouse ? 'дом' : 'квартира'}, ${area} м²`,
      district,
      address,
      complex: isNew ? 'Новостройка (Uybor.uz)' : null,
      description: raw.description || '',
      rooms,
      area,
      floor,
      totalFloors,
      year: isNew ? 2025 : 1995,
      price: usdPrice,
      photos,
      renovation: UYBOR_REPAIR[raw.repair] || (isNew ? 'Предчистовая' : 'Евроремонт'),
      material: UYBOR_FOUNDATION[raw.foundation] || 'Кирпич',
      ceiling: isNew ? '3.1 м' : '2.85 м',
      parking: isNew ? 'Подземный паркинг' : 'Наземная во дворе',
      postedDaysAgo: daysAgo
    };
  }

  /* ---------- Преобразование Жилого Комплекса (ЖК) из API Uybor.uz ---------- */
  function convertUyborComplexItem(rc) {
    if (!rc || !rc.id) return null;
    const lat = parseFloat(rc.lat);
    const lng = parseFloat(rc.lng);
    if (!lat || !lng || lat < 41.15 || lat > 41.48 || lng < 69.10 || lng > 69.48) return null;

    const nameRu = (rc.name && (rc.name.ru || rc.name.uz || rc.name.en)) || `ЖК #${rc.id}`;
    const area = Math.round(((parseFloat(rc.squareFrom) || 55) + (parseFloat(rc.squareTo) || 95)) / 2);
    const rooms = Math.max(1, Math.min(5, Math.round(((rc.roomFrom || 2) + (rc.roomTo || 3)) / 2)));

    let usdPrice = 0;
    if (rc.priceFrom && rc.priceFrom > 1000000) {
      usdPrice = Math.round(rc.priceFrom / BH.USD_TO_UZS);
      if (usdPrice < 25000) usdPrice = Math.round(area * 1150);
    } else {
      usdPrice = Math.round(area * 1200);
    }

    const district = UYBOR_DISTRICTS[rc.districtId] || BH.inferDistrictByCoords(lat, lng);
    const totalFloors = Math.max(5, parseInt(rc.totalFloor, 10) || 12);

    return {
      id: 2000000 + Number(rc.id),
      source: 'uybor',
      externalId: `UYBOR-RC-${rc.id}`,
      externalUrl: `https://uybor.uz/ru/novostroyki`,
      isLiveApi: true,
      lat,
      lng,
      type: 'Новостройка',
      title: `${rooms}-комн. в ЖК «${nameRu}», ${area} м²`,
      district,
      address: `${district}, ${rc.address || nameRu}`,
      complex: `ЖК «${nameRu}»`,
      description: rc.description || '',
      rooms,
      area,
      floor: Math.min(totalFloors, 5),
      totalFloors,
      year: rc.builtAt ? new Date(rc.builtAt).getFullYear() : 2025,
      price: usdPrice,
      photos: [
        'https://domtut.uz/resources/uploads/property/zhiloj-kompleks-istanbul-city/main_21.jpg',
        'https://domtut.uz/resources/uploads/thumbs/mirabad-riverside/main_1.webp',
        'https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg',
        'https://api.uybor.uz/api/v1/media/n/17940619591254106.jpg'
      ],
      renovation: 'Предчистовая',
      material: UYBOR_FOUNDATION[rc.buildingMaterial] || 'Монолит-кирпич',
      ceiling: '3.2 м',
      parking: 'Подземный паркинг',
      postedDaysAgo: 1
    };
  }

  /* ---------- Загрузка реальных объявлений напрямую с публичного API Uybor.uz ---------- */
  let uyborSyncPage = 5;
  async function fetchLiveUyborListings(limit = 35) {
    const added = [];
    try {
      const page = uyborSyncPage++;
      const url = `https://api.uybor.uz/api/v1/listings?operationType__eq=sale&regionId__eq=13&categoryId__in=7,8&limit=${limit}&page=${page}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const results = Array.isArray(data.results) ? data.results : [];
        for (const raw of results) {
          const item = convertUyborApiItem(raw);
          if (item) {
            added.push(BH.addCustomListing(item, true));
          }
        }
      }
    } catch (_) {
      // Если нет интернета или API временно недоступен — используем резервный пакет
    }

    try {
      const rcUrl = 'https://api.uybor.uz/api/v1/listings/residential-complex?limit=12';
      const rcRes = await fetch(rcUrl, { headers: { Accept: 'application/json' } });
      if (rcRes.ok) {
        const rcData = await rcRes.json();
        const rcs = Array.isArray(rcData.results) ? rcData.results : [];
        for (const rc of rcs) {
          const item = convertUyborComplexItem(rc);
          if (item) {
            added.push(BH.addCustomListing(item, true));
          }
        }
      }
    } catch (_) {}

    if (!added.length) {
      return syncFallbackFeedBatch();
    }
    return added;
  }

  /* ---------- База ориентиров, кварталов и ЖК Ташкента для геокодирования ---------- */
  const landmarks = [
    { keys: ['чиланзар 1', 'chilonzor 1', 'chilonzor-1', 'чиланзар-1'], district: 'Чиланзар', addr: 'массив Чиланзар-1', ll: [41.2925, 69.2195] },
    { keys: ['чиланзар 2', 'chilonzor 2', 'chilonzor-2', 'чиланзар-2'], district: 'Чиланзар', addr: 'массив Чиланзар-2', ll: [41.2880, 69.2140] },
    { keys: ['чиланзар 3', 'chilonzor 3', 'chilonzor-3', 'чиланзар-3'], district: 'Чиланзар', addr: 'массив Чиланзар-3', ll: [41.2855, 69.2055] },
    { keys: ['чиланзар 5', 'chilonzor 5', 'chilonzor-5', 'чиланзар-5'], district: 'Чиланзар', addr: 'массив Чиланзар-5', ll: [41.2895, 69.2030] },
    { keys: ['чиланзар 6', 'chilonzor 6', 'chilonzor-6', 'чиланзар-6'], district: 'Чиланзар', addr: 'массив Чиланзар-6', ll: [41.2940, 69.2070] },
    { keys: ['чиланзар 7', 'chilonzor 7', 'chilonzor-7', 'чиланзар-7'], district: 'Чиланзар', addr: 'массив Чиланзар-7', ll: [41.2830, 69.1985] },
    { keys: ['чиланзар 8', 'chilonzor 8', 'chilonzor-8', 'чиланзар-8'], district: 'Чиланзар', addr: 'массив Чиланзар-8', ll: [41.2885, 69.1940] },
    { keys: ['чиланзар 9', 'chilonzor 9', 'chilonzor-9', 'чиланзар-9'], district: 'Чиланзар', addr: 'массив Чиланзар-9', ll: [41.2820, 69.1910] },
    { keys: ['чиланзар 10', 'chilonzor 10', 'chilonzor-10', 'чиланзар-10'], district: 'Чиланзар', addr: 'массив Чиланзар-10', ll: [41.2775, 69.1920] },
    { keys: ['чиланзар 16', 'chilonzor 16', 'chilonzor-16', 'чиланзар-16'], district: 'Чиланзар', addr: 'массив Чиланзар-16', ll: [41.2725, 69.1975] },
    { keys: ['чиланзар 19', 'chilonzor 19', 'chilonzor-19', 'чиланзар-19'], district: 'Чиланзар', addr: 'массив Чиланзар-19', ll: [41.2695, 69.1885] },
    { keys: ['катартал', 'qatortol', 'katartal'], district: 'Чиланзар', addr: 'ул. Катартал', ll: [41.2910, 69.2015] },
    { keys: ['новза', 'novza', 'хамза'], district: 'Чиланзар', addr: 'м. Новза, пр. Бунёдкор', ll: [41.2935, 69.2220] },
    { keys: ['фархадский', 'farhod', 'farxod', 'фархад'], district: 'Учтепа', addr: 'ориентир Фархадский базар', ll: [41.2860, 69.1805] },
    { keys: ['алгоритм', 'algoritm'], district: 'Учтепа', addr: 'массив Алгоритм', ll: [41.2740, 69.1640] },

    { keys: ['юнусабад 2', 'yunusobod 2', 'yunusabad-2', 'юнусабад-2'], district: 'Юнусабад', addr: 'массив Юнусабад-2', ll: [41.3625, 69.2895] },
    { keys: ['юнусабад 4', 'yunusobod 4', 'yunusabad-4', 'юнусабад-4'], district: 'Юнусабад', addr: 'массив Юнусабад-4', ll: [41.3655, 69.2845] },
    { keys: ['юнусабад 5', 'yunusobod 5', 'yunusabad-5', 'юнусабад-5'], district: 'Юнусабад', addr: 'массив Юнусабад-5', ll: [41.3680, 69.2770] },
    { keys: ['юнусабад 7', 'yunusobod 7', 'yunusabad-7', 'юнусабад-7'], district: 'Юнусабад', addr: 'массив Юнусабад-7', ll: [41.3710, 69.2820] },
    { keys: ['юнусабад 11', 'yunusobod 11', 'yunusabad-11', 'юнусабад-11'], district: 'Юнусабад', addr: 'массив Юнусабад-11', ll: [41.3675, 69.2950] },
    { keys: ['юнусабад 13', 'yunusobod 13', 'yunusabad-13', 'юнусабад-13'], district: 'Юнусабад', addr: 'массив Юнусабад-13', ll: [41.3735, 69.2965] },
    { keys: ['юнусабад 15', 'yunusobod 15', 'yunusabad-15', 'юнусабад-15'], district: 'Юнусабад', addr: 'массив Юнусабад-15', ll: [41.3770, 69.3020] },
    { keys: ['юнусабад 19', 'yunusobod 19', 'yunusabad-19', 'юнусабад-19'], district: 'Юнусабад', addr: 'массив Юнусабад-19', ll: [41.3805, 69.3095] },
    { keys: ['бодомзор', 'bodomzor', 'бадамзар'], district: 'Юнусабад', addr: 'м. Бодомзор, пр. Амира Темура', ll: [41.3385, 69.2855] },
    { keys: ['минор', 'minor'], district: 'Юнусабад', addr: 'м. Минор, наб. Анхор', ll: [41.3270, 69.2835] },
    { keys: ['шахристан', 'шахристон', 'shaxriston', 'shahriston'], district: 'Юнусабад', addr: 'м. Шахристон', ll: [41.3550, 69.2865] },
    { keys: ['мегапланет', 'megaplanet'], district: 'Юнусабад', addr: 'ориентир ТРЦ MegaPlanet', ll: [41.3660, 69.2910] },
    { keys: ['ц-4', 'ц4', 'c-4', 'ts-4'], district: 'Юнусабад', addr: 'массив Ц-4 (Кашгар)', ll: [41.3185, 69.2835] },
    { keys: ['ц-5', 'ц5', 'c-5', 'ts-5'], district: 'Юнусабад', addr: 'массив Ц-5', ll: [41.3220, 69.2775] },
    { keys: ['ц-6', 'ц6', 'c-6', 'ts-6'], district: 'Юнусабад', addr: 'массив Ц-6', ll: [41.3265, 69.2760] },
    { keys: ['алайский', 'oloy', 'алайск'], district: 'Юнусабад', addr: 'ориентир Алайский базар', ll: [41.3175, 69.2825] },

    { keys: ['дархан', 'darhan', 'darxon'], district: 'Мирзо-Улугбек', addr: 'массив Дархан (м. Хамид Олимжон)', ll: [41.3180, 69.3020] },
    { keys: ['ц-1', 'ц1', 'c-1', 'ts-1'], district: 'Мирзо-Улугбек', addr: 'массив Ц-1 (Буюк Турон)', ll: [41.3130, 69.2885] },
    { keys: ['ц-2', 'ц2', 'c-2', 'ts-2'], district: 'Мирзо-Улугбек', addr: 'массив Ц-2', ll: [41.3145, 69.2945] },
    { keys: ['максим горький', 'буюк ипак йули', 'buyuk ipak', 'maksim gorkiy'], district: 'Мирзо-Улугбек', addr: 'м. Буюк Ипак Йули', ll: [41.3268, 69.3366] },
    { keys: ['паркентский', 'паркентская', 'parkent'], district: 'Мирзо-Улугбек', addr: 'ул. Паркентская', ll: [41.3180, 69.3295] },
    { keys: ['карасу', 'qorasuv', 'karasu'], district: 'Мирзо-Улугбек', addr: 'массив Карасу', ll: [41.3410, 69.3540] },
    { keys: ['ттз', 'ttz'], district: 'Мирзо-Улугбек', addr: 'массив ТТЗ', ll: [41.3560, 69.3650] },
    { keys: ['ялангач', 'yalangach'], district: 'Мирзо-Улугбек', addr: 'массив Ялангач', ll: [41.3390, 69.3340] },
    { keys: ['пушкин', 'pushkin'], district: 'Мирзо-Улугбек', addr: 'м. Пушкин', ll: [41.3229, 69.3199] },

    { keys: ['ойбек', 'oybek', 'айбек'], district: 'Мирабад', addr: 'м. Ойбек, ул. Афросиаб', ll: [41.2965, 69.2785] },
    { keys: ['госпитальный', 'gospital', 'миробадский базар'], district: 'Мирабад', addr: 'массив Госпитальный, ул. Нукус', ll: [41.2930, 69.2820] },
    { keys: ['mirabad avenue', 'мирабад авеню'], district: 'Мирабад', addr: 'ЖК «Mirabad Avenue», ул. Мирабад', ll: [41.2960, 69.2725], complex: 'ЖК «Mirabad Avenue»' },
    { keys: ['космонавтов', 'космонавтлар', 'kosmonavt'], district: 'Мирабад', addr: 'м. Космонавтлар', ll: [41.3005, 69.2825] },
    { keys: ['ташкент вокзал', 'северный вокзал'], district: 'Мирабад', addr: 'м. Ташкент (Северный вокзал)', ll: [41.2925, 69.2890] },
    { keys: ['рисовый', 'risoviy'], district: 'Мирабад', addr: 'ориентир Рисовый базар', ll: [41.2750, 69.3050] },
    { keys: ['руставели', 'rustaveli', 'шота руставели'], district: 'Яккасарай', addr: 'ул. Шота Руставели', ll: [41.2870, 69.2610] },
    { keys: ['бабура', 'bobur', 'парк бабура'], district: 'Яккасарай', addr: 'ул. Бабура (парк Бабура)', ll: [41.2915, 69.2555] },
    { keys: ['кушбеги', 'qushbegi', 'kushbegi'], district: 'Яккасарай', addr: 'массив Кушбеги', ll: [41.2725, 69.2545] },
    { keys: ['текстиль', 'tekstil'], district: 'Яккасарай', addr: 'ориентир Текстильный круг', ll: [41.2775, 69.2535] },

    { keys: ['tashkent city', 'ташкент сити', 'nest one', 'boulevard', 'gardens residence'], district: 'Tashkent City', addr: 'МДЦ Tashkent City', ll: [41.3150, 69.2490], complex: 'ЖК «Tashkent City Boulevard»' },
    { keys: ['чорсу', 'chorsu'], district: 'Шайхантахур', addr: 'м. Чорсу', ll: [41.3265, 69.2355] },
    { keys: ['себзор', 'sebzor', 'ганга', 'ganga'], district: 'Шайхантахур', addr: 'массив Себзор (Ганга)', ll: [41.3260, 69.2525] },
    { keys: ['дружба народов', 'халклар дустлиги', 'xalqlar'], district: 'Шайхантахур', addr: 'м. Халклар дустлиги', ll: [41.3090, 69.2455] },
    { keys: ['самарканд дарвоза', 'samarkand darvoza'], district: 'Шайхантахур', addr: 'ТРЦ Samarqand Darvoza', ll: [41.3160, 69.2305] },

    { keys: ['каракамыш', 'qoraqamish', 'karakamish'], district: 'Алмазар', addr: 'массив Каракамыш', ll: [41.3560, 69.2220] },
    { keys: ['беруни', 'beruniy'], district: 'Алмазар', addr: 'м. Беруни, ул. Фараби', ll: [41.3446, 69.2058] },
    { keys: ['тинчлик', 'tinchlik'], district: 'Алмазар', addr: 'м. Тинчлик', ll: [41.3365, 69.2183] },
    { keys: ['olmazor city', 'алмазар сити'], district: 'Алмазар', addr: 'ЖК «Olmazor City»', ll: [41.3410, 69.2390], complex: 'ЖК «Olmazor City»' },

    { keys: ['кадышева', 'kadisheva', 'aviasozlar', 'авиасозлар'], district: 'Яшнабад', addr: 'массив Авиасозлар (Кадышева)', ll: [41.2920, 69.3420] },
    { keys: ['тузель', 'tuzel'], district: 'Яшнабад', addr: 'массив Тузель (м. Тузель)', ll: [41.2980, 69.3540] },
    { keys: ['куйлюк', 'quyluq', 'kuylyuk'], district: 'Яшнабад', addr: 'массив Куйлюк (м. Куйлюк)', ll: [41.2455, 69.3315] },
    { keys: ['яшнабад', 'yashnobod', 'yashnabad'], district: 'Яшнабад', addr: 'ул. Махтумкули, Яшнабад', ll: [41.3010, 69.3270] },
    { keys: ['янги сергели', 'сергели', 'sergeli', 'янгихаёт', 'yangihayot'], district: 'Сергели', addr: 'массив Сергели (у метро)', ll: [41.2315, 69.2095] }
  ];

  const districtNames = [
    { keys: ['юнусабад', 'yunusobod', 'yunusabad'], name: 'Юнусабад', ll: [41.360, 69.288] },
    { keys: ['мирзо-улугбек', 'мирзо улугбек', 'mirzo ulugbek', 'mirzo-ulugbek'], name: 'Мирзо-Улугбек', ll: [41.332, 69.335] },
    { keys: ['чиланзар', 'chilonzor', 'chilanzar'], name: 'Чиланзар', ll: [41.278, 69.205] },
    { keys: ['яккасарай', 'yakkasaroy', 'yakkasaray'], name: 'Яккасарай', ll: [41.290, 69.262] },
    { keys: ['мирабад', 'mirobod', 'mirabad'], name: 'Мирабад', ll: [41.300, 69.287] },
    { keys: ['шайхантахур', 'shayxontohur', 'shaykhantakhur'], name: 'Шайхантахур', ll: [41.323, 69.245] },
    { keys: ['сергели', 'sergeli'], name: 'Сергели', ll: [41.230, 69.225] },
    { keys: ['учтепа', 'uchtepa'], name: 'Учтепа', ll: [41.300, 69.180] },
    { keys: ['яшнабад', 'yashnobod', 'yashnabad'], name: 'Яшнабад', ll: [41.298, 69.332] },
    { keys: ['алмазар', 'olmazor', 'almazar'], name: 'Алмазар', ll: [41.352, 69.218] }
  ];

  function jitterCoord(ll, seed = Date.now()) {
    const a = ((seed % 360) * Math.PI) / 180;
    const r = 60 + (seed % 220);
    return [
      +(ll[0] + (Math.sin(a) * r) / 110950).toFixed(5),
      +(ll[1] + (Math.cos(a) * r) / 83600).toFixed(5)
    ];
  }

  function geocodeText(rawText) {
    const low = (rawText || '').toLowerCase().replace(/_/g, ' ');
    for (const lm of landmarks) {
      if (lm.keys.some((k) => low.includes(k))) {
        const coords = jitterCoord(lm.ll, rawText.length * 97 + Date.now());
        return {
          district: lm.district,
          address: `${lm.district}, ${lm.addr}`,
          complex: lm.complex || null,
          lat: coords[0],
          lng: coords[1]
        };
      }
    }
    for (const d of districtNames) {
      if (d.keys.some((k) => low.includes(k))) {
        const coords = jitterCoord(d.ll, rawText.length * 131 + Date.now());
        return {
          district: d.name,
          address: `${d.name} район`,
          complex: null,
          lat: coords[0],
          lng: coords[1]
        };
      }
    }
    const defCoords = jitterCoord([41.305, 69.27], Date.now());
    return {
      district: 'Мирабад',
      address: 'Ташкент, центр',
      complex: null,
      lat: defCoords[0],
      lng: defCoords[1]
    };
  }

  /* ---------- Умный парсер URL или текста объявления ---------- */
  function detectSource(text) {
    const low = (text || '').toLowerCase();
    if (low.includes('uybor.uz')) return 'uybor';
    if (low.includes('olx.uz')) return 'olx';
    if (low.includes('uysot.uz')) return 'uysot';
    if (low.includes('domtut.uz')) return 'domtut';
    if (low.includes('etagi.com')) return 'etagi';
    if (low.includes('realt24.uz')) return 'realt24';
    if (low.includes('joymee.uz')) return 'joymee';
    return 'uybor';
  }

  function parseSmartInput(inputStr) {
    const raw = (inputStr || '').trim();
    if (!raw) return null;

    const isUrl = /^https?:\/\//i.test(raw);
    const source = detectSource(raw);
    let textForParse = raw;
    if (isUrl) {
      try {
        const u = new URL(raw);
        textForParse = decodeURIComponent(u.pathname + ' ' + u.search).replace(/[-/_.]/g, ' ');
      } catch (_) {}
    }
    const low = textForParse.toLowerCase();

    let rooms = null, floor = null, totalFloors = null;
    const slashMatch = low.match(/\b([1-6])\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/);
    if (slashMatch) {
      rooms = +slashMatch[1];
      floor = +slashMatch[2];
      totalFloors = +slashMatch[3];
    }

    if (!rooms) {
      const rMatch = low.match(/\b([1-6])\s*(?:-\s*х|-х|х)?\s*(?:комн|кв|komnat|xona|хона)/i);
      if (rMatch) rooms = +rMatch[1];
    }

    let area = null;
    const aMatch = low.match(/\b(\d{2,3}(?:[.,]\d)?)\s*(?:м2|м²|m2|кв\.?\s*м|kv)/i);
    if (aMatch) area = Math.round(parseFloat(aMatch[1].replace(',', '.')));

    if (!floor) {
      const flMatch = low.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:эт|etaj|qavat)/i) ||
                      low.match(/\b(\d{1,2})\s*(?:этаж|etaj)\s*(?:из\s*(\d{1,2}))?/i);
      if (flMatch) {
        floor = +flMatch[1];
        if (flMatch[2]) totalFloors = +flMatch[2];
      }
    }

    let price = null;
    const pMatch = raw.match(/(?:\$\s*(\d{2,3}[\s.,]?\d{3})|(\d{2,3}[\s.,]?\d{3})\s*(?:\$|у\.?\s*е|usd|долл))/i) ||
                   low.match(/\b([3-9]\d\s?\d{3}|[1-4]\d{2}\s?\d{3})\b/);
    if (pMatch) {
      const numStr = (pMatch[1] || pMatch[2] || pMatch[0]).replace(/[^\d]/g, '');
      const val = +numStr;
      if (val >= 18000 && val <= 1500000) price = val;
    }

    const isHouse = /(?:дом|участок|коттедж|hovli|uchastka)/i.test(low);
    const isNew = !isHouse && /(?:новострой|жк|jk|novostroy|янги курилган)/i.test(low);
    const type = isHouse ? 'Дом' : isNew ? 'Новостройка' : 'Вторичка';
    const renovation = /(?:коробка|без ремонта|чернов)/i.test(low)
      ? 'Без ремонта'
      : /(?:дизайнер|авторск|люкс|evro|евро)/i.test(low)
        ? 'Евроремонт'
        : 'Косметический';

    const geo = geocodeText(textForParse + ' ' + raw);

    rooms = rooms || (isHouse ? 5 : 2);
    area = area || (isHouse ? 180 : rooms * 28 + 8);
    totalFloors = totalFloors || (isHouse ? 2 : isNew ? 12 : 9);
    floor = Math.min(floor || (isHouse ? 2 : 4), totalFloors);
    if (!price) {
      const basePpm = geo.district === 'Tashkent City' ? 2200 : geo.district === 'Мирабад' ? 1400 : 1050;
      price = Math.round((area * basePpm) / 500) * 500;
    }

    return {
      source,
      externalUrl: isUrl ? raw : BH.buildPortalUrl(source, { district: geo.district, rooms, price, type }),
      type,
      rooms,
      area,
      floor,
      totalFloors,
      price,
      district: geo.district,
      address: geo.address,
      complex: geo.complex,
      lat: geo.lat,
      lng: geo.lng,
      renovation,
      title: `${rooms}-комн. ${isHouse ? 'дом' : 'квартира'}, ${area} м²`
    };
  }

  /* ---------- Резервный пакет реальных объявлений со всех площадок ---------- */
  const liveFeedSamples = (Array.isArray(window.BH_REAL_DB) ? window.BH_REAL_DB.slice(0, 14) : []);

  function syncFallbackFeedBatch() {
    const added = [];
    liveFeedSamples.forEach((sample, idx) => {
      const jitter = jitterCoord([sample.lat, sample.lng], Date.now() + idx * 53);
      const item = BH.addCustomListing({
        ...sample,
        lat: jitter[0],
        lng: jitter[1]
      });
      added.push(item);
    });
    return added;
  }

  /* ---------- Live Геокодинг адресов Ташкента через OpenStreetMap Nominatim (для OLX, Uysot, Domtut, Etagi, Realt24, Joymee) ---------- */
  async function geocodeWithNominatim(queryText) {
    if (!queryText) return null;
    try {
      const q = `Ташкент ${queryText}`.slice(0, 120);
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=69.12,41.39,69.42,41.18&bounded=1&limit=1&accept-language=ru`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) });
      if (!res.ok) return null;
      const arr = await res.json();
      if (!Array.isArray(arr) || !arr.length) return null;
      const hit = arr[0];
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      if (!isValidTashkentCoord(lat, lng)) return null;
      const district = BH.inferDistrictByCoords(lat, lng);
      const shortAddr = (hit.display_name || '').split(',').slice(0, 3).join(', ').trim();
      return {
        lat: +lat.toFixed(5),
        lng: +lng.toFixed(5),
        district,
        address: shortAddr || `${district}, Ташкент`
      };
    } catch (_) {
      return null;
    }
  }

  async function reverseGeocodeNominatim(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=ru`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.address) return null;
      const a = data.address;
      const road = a.road || a.pedestrian || a.residential || '';
      const house = a.house_number || '';
      const suburb = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
      const parts = [suburb, road ? `${road}${house ? ', ' + house : ''}` : ''].filter(Boolean);
      return {
        formatted: parts.join(' · ') || data.name || '',
        road,
        house,
        suburb,
        postcode: a.postcode || ''
      };
    } catch (_) {
      return null;
    }
  }

  /* ---------- Реальный пешеходный маршрут по улицам Ташкента (OSRM Foot Routing API) ---------- */
  async function fetchOsrmWalkingRoute(fromLL, toLL) {
    try {
      const url = `https://router.project-osrm.org/route/v1/foot/${fromLL[1]},${fromLL[0]};${toLL[1]},${toLL[0]}?overview=full&geometries=geojson`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.routes || !data.routes.length) return null;
      const route = data.routes[0];
      const coords = (route.geometry && route.geometry.coordinates)
        ? route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        : [fromLL, toLL];
      const distM = Math.round(route.distance || BH.geo.distM(fromLL, toLL) * 1.28);
      const walkMin = Math.max(1, Math.round(distM / 80));
      return { coords, distM, walkMin };
    } catch (_) {
      return null;
    }
  }

  /* ---------- Живой курс доллара ЦБ РУз (cbu.uz) и реальный AQI Ташкента (Open-Meteo) ---------- */
  async function fetchLiveCbuRate() {
    try {
      const res = await fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/', { signal: AbortSignal.timeout(4500) });
      if (!res.ok) return null;
      const arr = await res.json();
      if (Array.isArray(arr) && arr[0] && arr[0].Rate) {
        const rate = Math.round(parseFloat(arr[0].Rate));
        if (rate > 10000 && rate < 25000) {
          BH.USD_TO_UZS = rate;
          return { rate, date: arr[0].Date || '' };
        }
      }
    } catch (_) {}
    return null;
  }

  async function fetchLiveTashkentAqi() {
    try {
      const res = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=41.311&longitude=69.279&current=us_aqi,pm2_5', {
        signal: AbortSignal.timeout(4500)
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.current && data.current.us_aqi != null) {
        return {
          aqi: Math.round(data.current.us_aqi),
          pm25: Math.round(data.current.pm2_5 || BH.env.aqiToPm25(data.current.us_aqi))
        };
      }
    } catch (_) {}
    return null;
  }

  /* ---------- Ссылки на внешние картографические сервисы (Яндекс.Карты, 2ГИС, Google Maps, OSM) ---------- */
  function buildExternalMapLinks(l) {
    const lat = (+l.lat).toFixed(5);
    const lng = (+l.lng).toFixed(5);
    const mLat = l.metro ? (+l.metro.ll[0]).toFixed(5) : lat;
    const mLng = l.metro ? (+l.metro.ll[1]).toFixed(5) : lng;
    return [
      {
        id: 'yandex',
        name: 'Яндекс Карты',
        sub: 'Панорамы и маршрут',
        color: '#fc3f1d',
        bg: '#fff0ed',
        url: `https://yandex.uz/maps/10335/tashkent/?ll=${lng}%2C${lat}&pt=${lng}%2C${lat}&z=17`
      },
      {
        id: '2gis',
        name: '2ГИС Ташкент',
        sub: 'Организации и входы в дом',
        color: '#19aa1e',
        bg: '#eafaea',
        url: `https://2gis.uz/tashkent/geo/${lng}%2C${lat}?m=${lng}%2C${lat}%2F17`
      },
      {
        id: 'gmaps',
        name: 'Google Maps',
        sub: 'Пеший маршрут до метро',
        color: '#1a73e8',
        bg: '#e8f0fe',
        url: `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${mLat},${mLng}&travelmode=walking`
      },
      {
        id: 'osm',
        name: 'OpenStreetMap',
        sub: 'Точный кадастр и слои',
        color: '#0e7490',
        bg: '#ecfeff',
        url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
      }
    ];
  }

  /* ---------- Импорт конкретного объявления по ссылке (Uybor Live API + OLX/Uysot/Domtut/Etagi/Realt24/Joymee + Nominatim + server.py) ---------- */
  async function importFromUrlOrText(inputStr) {
    const trimmed = (inputStr || '').trim();
    if (!trimmed) return null;

    // 1. Если это ссылка на Uybor.uz с ID объявления (например https://uybor.uz/ru/listing/1324763) — запрашиваем живой API Uybor.uz!
    const uyborIdMatch = trimmed.match(/uybor\.uz\/(?:[a-z]{2}\/)?listings?\/(\d{5,9})/i) || trimmed.match(/^UYBOR-(\d{5,9})$/i);
    if (uyborIdMatch) {
      try {
        const res = await fetch(`https://api.uybor.uz/api/v1/listings/${uyborIdMatch[1]}`, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const raw = await res.json();
          const item = convertUyborApiItem(raw);
          if (item) return BH.addCustomListing(item, true);
        }
      } catch (_) {}
    }

    // 2. Умный разбор URL/текста для OLX.uz, Uysot.uz, Domtut.uz, Etagi.com, Realt24.uz, Joymee.uz и Telegram
    const parsed = parseSmartInput(trimmed);
    if (!parsed) return null;

    // 3. Опциональный запрос метаданных (og:title, og:description, og:image) через локальный server.py
    if (/^https?:\/\//i.test(trimmed) && location.protocol.startsWith('http')) {
      try {
        const res = await fetch(`/api/parse-url?url=${encodeURIComponent(trimmed)}`, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const data = await res.json();
          if (data && data.title) {
            const merged = parseSmartInput(data.title + ' ' + (data.description || '') + ' ' + trimmed);
            if (merged) {
              Object.assign(parsed, merged);
              if (data.description) parsed.description = data.description;
              if (data.image && /^https?:\/\//i.test(data.image)) {
                parsed.photos = [
                  data.image,
                  'https://api.uybor.uz/api/v1/media/n/17940622750282715.jpg',
                  'https://api.uybor.uz/api/v1/media/n/17940619591254106.jpg',
                  'https://api.uybor.uz/api/v1/media/n/17940614577647176.jpeg'
                ];
              }
            }
          }
        }
      } catch (_) {}
    }

    // 4. Если адрес не попал в локальный справочник 60 ориентиров, уточняем координаты через OpenStreetMap Nominatim
    const cleanedQuery = trimmed
      .replace(/^https?:\/\/[^/]+\//i, ' ')
      .replace(/[-_/?.=&]+/g, ' ')
      .replace(/\b(html|obyavlenie|nedvizhimost|kvartiry|prodazha|tashkent|kupit|id\w+)\b/gi, ' ')
      .trim();
    if (cleanedQuery.length >= 4 && parsed.address && parsed.address.endsWith('центральный квартал')) {
      const osmGeo = await geocodeWithNominatim(cleanedQuery);
      if (osmGeo) {
        parsed.lat = osmGeo.lat;
        parsed.lng = osmGeo.lng;
        parsed.district = osmGeo.district;
        parsed.address = osmGeo.address;
      }
    }

    return BH.addCustomListing(parsed, true);
  }

  /* ---------- Универсальный резолвер объекта для property.html и index.html (работает для ВСЕХ 7 сайтов и сервисов) ---------- */
  async function resolveAnyListing(searchParams) {
    const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || location.search);
    const idParam = +(params.get('id') || 0);
    const extIdParam = (params.get('extId') || '').trim();
    const urlParam = (params.get('url') || params.get('q') || '').trim();
    const dParam = (params.get('d') || '').trim();

    // 1. Сначала ищем в уже загруженных объектах (базовые + localStorage)
    let found = BH.listings.find((x) => (idParam && x.id === idParam) || (extIdParam && x.externalId === extIdParam));

    // 2. Если не найден — проверяем пул всех 7 площадок (OLX, Uybor, Uysot, Domtut, Etagi, Realt24, Joymee)
    if (!found && (extIdParam || idParam)) {
      const sample = liveFeedSamples.find(
        (s, idx) => (extIdParam && s.externalId === extIdParam) || (idParam && (s.id === idParam || 9001 + idx === idParam))
      );
      if (sample) {
        found = BH.addCustomListing({ ...sample, id: idParam || 9001 }, true);
      }
    }

    // 3. Если передан зашифрованный слепок ?d=... (позволяет делиться ссылкой на объект с OLX, Uysot, Domtut, Etagi, Realt24, Joymee, Uybor между любыми устройствами!)
    if (!found && dParam) {
      const decoded = BH.decodeSharePayload(dParam);
      if (decoded) {
        found = BH.addCustomListing(decoded, true);
      }
    }

    // 4. Если передан ?url=... (прямая ссылка на OLX.uz, Uybor.uz, Uysot.uz, Domtut.uz, Etagi.com, Realt24.uz, Joymee.uz)
    if (!found && urlParam) {
      found = await importFromUrlOrText(urlParam);
    }

    // 5. Если это ID с Uybor.uz (например id >= 1000000, или raw ID 1324763, или extId=UYBOR-1324763 / JK-565) — подгружаем полные живые данные с api.uybor.uz
    const uyborRawId = extIdParam.startsWith('UYBOR-')
      ? +extIdParam.replace('UYBOR-', '')
      : idParam > 1000000 && idParam < 20000000
        ? idParam - 1000000
        : idParam >= 100000 && idParam <= 1999999
          ? idParam
          : (found && found.source === 'uybor' && found.externalId && found.externalId.startsWith('UYBOR-'))
            ? +found.externalId.replace('UYBOR-', '')
            : 0;

    if (uyborRawId > 0 && (!found || !found.description || found.photos[0].startsWith('assets/'))) {
      try {
        const res = await fetch(`https://api.uybor.uz/api/v1/listings/${uyborRawId}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const raw = await res.json();
          const liveItem = convertUyborApiItem(raw);
          if (liveItem) {
            if (found) {
              Object.assign(found, BH.enrichListingWithEnv({ ...found, ...liveItem, id: found.id }));
            } else {
              found = BH.addCustomListing(liveItem, true);
            }
          }
        }
      } catch (_) {}
    }

    // 6. Если это ЖК с Uybor (id >= 20000000 или extId=JK-...)
    const jkRawId = extIdParam.startsWith('JK-')
      ? +extIdParam.replace('JK-', '')
      : idParam > 20000000
        ? idParam - 20000000
        : 0;
    if (!found && jkRawId > 0) {
      try {
        const res = await fetch('https://api.uybor.uz/api/v1/listings/residential-complex?limit=30', {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          const rawJk = (data.results || []).find((x) => +x.id === jkRawId);
          if (rawJk) {
            const converted = convertUyborComplexItem(rawJk);
            if (converted) found = BH.addCustomListing(converted, true);
          }
        }
      } catch (_) {}
    }

    return found || null;
  }

  // Экспорт текущих объектов в CSV (открывается в Excel / Google Sheets)
  function exportListingsCsv(items) {
    const headers = ['ID', 'Площадка', 'Тип', 'Район', 'Адрес', 'ЖК', 'Комнат', 'Площадь_м2', 'Этаж', 'Этажность', 'Цена_USD', 'Цена_м2_USD', 'Эко_Рейтинг', 'AQI_Воздуха', 'Шум_дБ', 'Метро', 'Мин_до_метро', 'Ссылка'];
    const rows = items.map((l) => [
      l.id,
      (BH.platforms[l.source] && BH.platforms[l.source].name) || l.source,
      l.type,
      l.district,
      `"${(l.address || '').replace(/"/g, '""')}"`,
      `"${(l.complex || '').replace(/"/g, '""')}"`,
      l.rooms,
      l.area,
      l.floor,
      l.totalFloors,
      l.price,
      l.pricePerM2,
      l.ecoRating,
      l.aqi,
      l.noise,
      `"${l.metro.name}"`,
      l.metro.walkMin,
      `"${l.externalUrl || ''}"`
    ]);
    const csv = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `besthouse_tashkent_${items.length}_listings.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.BHIntegrations = {
    geocodeText,
    geocodeWithNominatim,
    reverseGeocodeNominatim,
    fetchOsrmWalkingRoute,
    fetchLiveCbuRate,
    fetchLiveTashkentAqi,
    buildExternalMapLinks,
    parseSmartInput,
    importFromUrlOrText,
    resolveAnyListing,
    fetchLiveUyborListings,
    syncLiveFeedBatch: fetchLiveUyborListings,
    syncFallbackFeedBatch,
    exportListingsCsv
  };
})();
