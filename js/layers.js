/* ==========================================================================
   BestHouse.uz — фабрики слоёв карты (Leaflet)
   ========================================================================== */
(function () {
  'use strict';
  const { scales, env, classify } = BH;

  /* ------------------------------------------------------------------
     EnvGridLayer — растровый «тепловой» слой, вычисляемый на клиенте.
     Для каждого тайла считаем поле в сетке CELL×CELL пикселей, затем
     масштабируем с билинейным сглаживанием → плавный градиент.
     В продакшене можно заменить на L.tileLayer с готовыми PNG-тайлами.
     ------------------------------------------------------------------ */
  const EnvGridLayer = L.GridLayer.extend({
    options: { cell: 8, alpha: 0.52, valueFn: null, colorFn: null, pane: 'envPane', updateWhenZooming: false },

    createTile(coords) {
      const tile = L.DomUtil.create('canvas', 'env-tile');
      const size = this.getTileSize();
      tile.width = size.x; tile.height = size.y;

      const cell = this.options.cell;
      const nx = Math.ceil(size.x / cell), ny = Math.ceil(size.y / cell);
      const off = document.createElement('canvas');
      off.width = nx; off.height = ny;
      const octx = off.getContext('2d');
      const img = octx.createImageData(nx, ny);
      const a = Math.round(this.options.alpha * 255);
      const map = this._map;
      const origin = coords.scaleBy(size);

      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const ll = map.unproject(L.point(origin.x + (i + 0.5) * cell, origin.y + (j + 0.5) * cell), coords.z);
          const c = this.options.colorFn(this.options.valueFn(ll.lat, ll.lng));
          const k = (j * nx + i) * 4;
          img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = a;
        }
      }
      octx.putImageData(img, 0, 0);
      const ctx = tile.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, size.x, size.y);
      return tile;
    }
  });

  /* ------------------------------------------------------------------
     Трафик: полилинии магистралей, перекрашиваемые по часу суток
     ------------------------------------------------------------------ */
  function createTrafficLayer() {
    const group = L.layerGroup();
    const items = BH.roads.map((road) => {
      const casing = L.polyline(road.path, { pane: 'trafficPane', color: '#fff', weight: 9, opacity: 0.9, interactive: false, lineCap: 'round', lineJoin: 'round' });
      const line = L.polyline(road.path, { pane: 'trafficPane', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' });
      line.on('mouseover', () => line.setStyle({ weight: 8 }));
      line.on('mouseout', () => line.setStyle({ weight: 5 }));
      group.addLayer(casing).addLayer(line);
      return { road, line, casing };
    });

    group.setHour = function (hour) {
      items.forEach(({ road, line }) => {
        const c = env.congestion(road, hour);
        const cls = classify.traffic(c);
        line.setStyle({ color: scales.rgb(scales.traffic(c)), dashArray: c > 0.86 ? '1 0' : null });
        line.bindTooltip(
          `<div class="tt-title">${road.name}</div>
           <div class="tt-row"><i style="background:${cls.color}"></i>${cls.label} · загруженность ${Math.round(c * 100)}%</div>
           <div class="tt-row muted">Ср. скорость ≈ ${env.trafficSpeed(road, hour)} км/ч · ${road.lanes} полос · шум ${road.noiseDb} дБ</div>`,
          { sticky: true, className: 'bh-tooltip' }
        );
      });
    };
    return group;
  }

  /* ------------------------------------------------------------------
     Транспорт и парки: линии метро, станции, входы, изохроны, автобусы, парки
     ------------------------------------------------------------------ */
  function createTransitLayer() {
    const group = L.layerGroup();
    const iso = L.layerGroup();
    const entrances = L.layerGroup();
    const bus = L.layerGroup();
    const parks = L.layerGroup();
    const core = L.layerGroup();

    // Зелёные зоны и парки
    BH.parks.forEach((p) => {
      L.circle(p.ll, {
        pane: 'isoPane', radius: p.r, color: '#1fbf6a', weight: 1.5, opacity: 0.65,
        dashArray: '3 5', fillColor: '#1fbf6a', fillOpacity: 0.14
      })
        .bindTooltip(
          `<div class="tt-title">🌳 ${p.name}</div>
           <div class="tt-row muted">Зелёная зона · снижает AQI и уровень шума</div>`,
          { sticky: true, className: 'bh-tooltip' }
        )
        .addTo(parks);
    });

    // Изохроны пешей доступности: 15 → 10 → 5 мин (радиус по прямой при 80 м/мин)
    const isoDefs = [
      { min: 15, r: 1200, fill: 0.06, color: '#1e88e5' },
      { min: 10, r: 800, fill: 0.08, color: '#1e88e5' },
      { min: 5, r: 400, fill: 0.13, color: '#1e88e5' }
    ];
    BH.metroStations.forEach((s) => {
      isoDefs.forEach((d) => {
        L.circle(s.ll, {
          pane: 'isoPane', radius: d.r, color: s.color, weight: d.min === 5 ? 1.2 : 0.8, opacity: 0.42,
          dashArray: d.min === 15 ? '4 4' : null, fillColor: s.color, fillOpacity: d.fill, interactive: false
        }).addTo(iso);
      });
    });

    // Автобусы
    BH.busRoutes.forEach((r) => {
      L.polyline(r.path, { pane: 'transitPane', color: r.color, weight: 3, opacity: 0.85, dashArray: '3 7', lineCap: 'round' })
        .bindTooltip(`<div class="tt-title">🚌 ${r.name}</div><div class="tt-row muted">Интервал движения ≈ 8–12 мин</div>`, { sticky: true, className: 'bh-tooltip' })
        .addTo(bus);
    });

    // Линии метро
    BH.metroLines.forEach((l) => {
      const pts = l.stations.map((s) => s.ll);
      L.polyline(pts, { pane: 'transitPane', color: '#fff', weight: 9, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(core);
      L.polyline(pts, { pane: 'transitPane', color: l.color, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' })
        .bindTooltip(`<div class="tt-title">${l.name}</div><div class="tt-row muted">${l.stations.length} станций</div>`, { sticky: true, className: 'bh-tooltip' })
        .addTo(core);
    });

    // Станции + входы
    BH.metroStations.forEach((s) => {
      const line = BH.metroLines.find((l) => l.id === s.line);
      L.circleMarker(s.ll, { pane: 'transitPane', radius: 6, color: s.color, weight: 3, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(
          `<div class="tt-title"><span class="metro-m" style="background:${s.color}">M</span>${s.name}</div>
           <div class="tt-row muted">${line.name}</div>
           <div class="tt-row muted">5 мин ≈ 400 м · 10 мин ≈ 800 м · 15 мин ≈ 1.2 км</div>`,
          { direction: 'top', offset: [0, -6], className: 'bh-tooltip' }
        )
        .addTo(core);

      s.entrances.forEach((e) => {
        L.marker(e.ll, {
          pane: 'transitPane',
          icon: L.divIcon({ className: 'metro-entrance', html: `<span style="background:${s.color}">M</span>`, iconSize: [16, 16], iconAnchor: [8, 8] })
        })
          .bindTooltip(`${s.name} · ${e.name}`, { direction: 'top', className: 'bh-tooltip' })
          .addTo(entrances);
      });
    });

    group.addLayer(iso).addLayer(parks).addLayer(bus).addLayer(core).addLayer(entrances);
    group.sub = { iso, entrances, bus, parks, core };
    return group;
  }

  window.BHLayers = { EnvGridLayer, createTrafficLayer, createTransitLayer };
})();
