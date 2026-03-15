/**
 * GEOTRACK · GPS KMZ Exporter — v2 con persistencia
 * app.js — Lógica principal modular (ES6+)
 *
 * Módulos:
 *  1. Logger        — sistema de log en pantalla
 *  2. GeoMath       — cálculo de distancia Haversine
 *  3. Store         — persistencia localStorage (puntos + metadata)
 *  4. MapManager    — mapa Leaflet interactivo
 *  5. KMZExporter   — generación KML → KMZ (JSZip)
 *  6. GPSTracker    — watchPosition, almacenamiento, coordinación
 *  7. UI            — vínculos DOM → eventos, modal de recuperación
 *
 * ──────────────────────────────────────────────────────────────
 * NOTA SOBRE PERSISTENCIA EN NAVEGADOR:
 * El navegador interrumpe watchPosition al recargar la página
 * (limitación de seguridad del navegador, no evitable).
 * Lo que SÍ persiste: todos los puntos ya guardados en
 * localStorage. Al recargar, el usuario puede continuar la ruta
 * anterior o empezar una nueva.
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

/* ============================================================
   1. LOGGER
   ============================================================ */
const Logger = (() => {
  const area = document.getElementById('logArea');

  function log(msg, type = 'info') {
    const ts = new Date().toTimeString().slice(0, 8);
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = ts;
    const msgSpan = document.createElement('span');
    msgSpan.className = `log-msg ${type}`;
    msgSpan.textContent = msg;
    entry.appendChild(timeSpan);
    entry.appendChild(msgSpan);
    area.appendChild(entry);
    area.scrollTop = area.scrollHeight;
  }

  return { log };
})();


/* ============================================================
   2. GEOMATH
   ============================================================ */
const GeoMath = (() => {
  const R = 6_371_000;

  function haversine(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat  = toRad(lat2 - lat1);
    const dLon  = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return { haversine };
})();


/* ============================================================
   3. STORE — persistencia localStorage
   ============================================================ */
const Store = (() => {
  const KEY_POINTS   = 'geotrack_points';
  const KEY_META     = 'geotrack_meta';
  const KEY_FILENAME = 'geotrack_filename';

  function savePoints(points) {
    try {
      localStorage.setItem(KEY_POINTS, JSON.stringify(points));
    } catch (e) {
      Logger.log(`Aviso: almacenamiento lleno (${e.message})`, 'warning');
    }
  }

  function saveMeta(meta) {
    try { localStorage.setItem(KEY_META, JSON.stringify(meta)); } catch (_) {}
  }

  function saveFileName(name) {
    try { localStorage.setItem(KEY_FILENAME, name); } catch (_) {}
  }

  function loadPoints() {
    try {
      const raw = localStorage.getItem(KEY_POINTS);
      if (!raw) return null;
      const pts = JSON.parse(raw);
      return Array.isArray(pts) && pts.length > 0 ? pts : null;
    } catch (_) { return null; }
  }

  function loadMeta() {
    try {
      const raw = localStorage.getItem(KEY_META);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function loadFileName() {
    return localStorage.getItem(KEY_FILENAME) || null;
  }

  function clear() {
    localStorage.removeItem(KEY_POINTS);
    localStorage.removeItem(KEY_META);
  }

  function recalcDistance(points) {
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      dist += GeoMath.haversine(
        points[i-1].lat, points[i-1].lon,
        points[i].lat,   points[i].lon
      );
    }
    return dist;
  }

  return { savePoints, saveMeta, saveFileName, loadPoints, loadMeta, loadFileName, clear, recalcDistance };
})();


/* ============================================================
   4. MAP MANAGER (Leaflet)
   ============================================================ */
const MapManager = (() => {
  let map           = null;
  let polyline      = null;
  let markers       = [];
  let currentMarker = null;
  const latLngs     = [];

  function init(lat = 42.5680, lon = -0.5524) {
    if (map) return;
    map = L.map('map', { center: [lat, lon], zoom: 15 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map);
    polyline = L.polyline([], {
      color: '#e8ff47', weight: 2.5, opacity: 0.85, dashArray: '4, 6',
    }).addTo(map);
  }

  // Carga un array completo de puntos guardados en el mapa
  function loadPoints(points) {
    if (!points || points.length === 0) return;
    const first = points[0];
    if (!map) init(first.lat, first.lon);

    points.forEach((p, i) => {
      const isFirst = i === 0;
      const ll = [p.lat, p.lon];
      latLngs.push(ll);
      const size = isFirst ? 10 : 8;
      const icon = L.divIcon({
        className: isFirst ? 'gps-marker gps-marker-first' : 'gps-marker',
        iconSize: [size, size], iconAnchor: [size/2, size/2],
      });
      const marker = L.marker(ll, { icon }).addTo(map);
      marker.bindPopup(`<b>Punto ${i+1}</b><br>Lat: ${p.lat.toFixed(7)}<br>Lon: ${p.lon.toFixed(7)}`);
      markers.push(marker);
    });

    polyline.setLatLngs(latLngs);
    if (latLngs.length > 1) {
      map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
    } else {
      map.setView([first.lat, first.lon], 15);
    }
  }

  function addPoint(lat, lon, isFirst = false) {
    if (!map) init(lat, lon);
    const ll   = [lat, lon];
    latLngs.push(ll);
    polyline.setLatLngs(latLngs);
    const size = isFirst ? 10 : 8;
    const icon = L.divIcon({
      className: isFirst ? 'gps-marker gps-marker-first' : 'gps-marker',
      iconSize: [size, size], iconAnchor: [size/2, size/2],
    });
    const marker = L.marker(ll, { icon }).addTo(map);
    marker.bindPopup(`<b>Punto ${latLngs.length}</b><br>Lat: ${lat.toFixed(7)}<br>Lon: ${lon.toFixed(7)}`);
    markers.push(marker);
  }

  function updateCurrentPosition(lat, lon) {
    if (!map) init(lat, lon);
    const icon = L.divIcon({ className: 'gps-marker gps-marker-current', iconSize: [14,14], iconAnchor: [7,7] });
    if (currentMarker) {
      currentMarker.setLatLng([lat, lon]);
    } else {
      currentMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
    }
    map.panTo([lat, lon], { animate: true, duration: 0.8 });
  }

  function removeCurrentMarker() {
    if (currentMarker && map) { map.removeLayer(currentMarker); currentMarker = null; }
  }

  function reset() {
    latLngs.length = 0;
    if (polyline) polyline.setLatLngs([]);
    markers.forEach((m) => map && map.removeLayer(m));
    markers.length = 0;
    removeCurrentMarker();
  }

  function fitRoute() {
    if (map && latLngs.length > 1) map.fitBounds(polyline.getBounds(), { padding: [30,30] });
  }

  return { init, loadPoints, addPoint, updateCurrentPosition, removeCurrentMarker, reset, fitRoute };
})();


/* ============================================================
   5. KMZ EXPORTER
   ============================================================ */
const KMZExporter = (() => {

  function buildKML(points, name) {
    if (points.length === 0) throw new Error('No hay puntos para exportar.');
    const esc = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');

    const placemarks = points.map((p, i) => {
      const date = new Date(p.timestamp).toISOString();
      return `
    <Placemark>
      <name>Punto ${i + 1}</name>
      <description>Lat: ${p.lat.toFixed(7)} | Lon: ${p.lon.toFixed(7)} | Precisión: ${p.accuracy ? p.accuracy.toFixed(1)+'m' : 'N/A'} | ${date}</description>
      <TimeStamp><when>${date}</when></TimeStamp>
      <styleUrl>#pointStyle</styleUrl>
      <Point>
        <coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},${(p.alt ?? 0).toFixed(1)}</coordinates>
      </Point>
    </Placemark>`;
    }).join('\n');

    const lineCoords = points
      .map((p) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},${(p.alt ?? 0).toFixed(1)}`)
      .join('\n          ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc}</name>
    <description>Ruta GPS exportada con GEOTRACK · ${new Date().toISOString()}</description>
    <Style id="routeStyle">
      <LineStyle><color>ff47ffe8</color><width>3</width></LineStyle>
      <PolyStyle><fill>0</fill></PolyStyle>
    </Style>
    <Style id="pointStyle">
      <IconStyle>
        <color>ff47b4ff</color><scale>0.6</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0</scale></LabelStyle>
    </Style>
    <Placemark>
      <name>${esc} — Ruta</name>
      <styleUrl>#routeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${lineCoords}
        </coordinates>
      </LineString>
    </Placemark>
    <Folder>
      <name>Puntos GPS</name>
      ${placemarks}
    </Folder>
  </Document>
</kml>`;
  }

  async function exportKMZ(points, fileName) {
    if (!window.JSZip) throw new Error('JSZip no está disponible.');
    const zip  = new JSZip();
    zip.file('doc.kml', buildKML(points, fileName));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${fileName}.kmz`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return points.length;
  }

  return { exportKMZ };
})();


/* ============================================================
   6. GPS TRACKER
   ============================================================ */
const GPSTracker = (() => {
  const MIN_DIST_M = 10;
  let points = [], watchId = null, totalDist = 0;
  let startTime = null, timerInterval = null;
  let onPointAdded = null, onPositionUpdate = null, onError = null;

  // Restaura puntos desde almacenamiento (sin iniciar tracking)
  function restore(savedPoints, savedDist) {
    points    = [...savedPoints];
    totalDist = savedDist;
    MapManager.loadPoints(points);
  }

  function start(callbacks = {}) {
    if (watchId !== null) return;
    onPointAdded     = callbacks.onPointAdded     || null;
    onPositionUpdate = callbacks.onPositionUpdate || null;
    onError          = callbacks.onError          || null;

    if (!navigator.geolocation) {
      const msg = 'Geolocalización no soportada por este navegador.';
      Logger.log(msg, 'error');
      if (onError) onError(msg);
      return;
    }

    Logger.log('Solicitando permiso de GPS…', 'info');
    startTime = Date.now();
    timerInterval = setInterval(_updateTimer, 1000);

    watchId = navigator.geolocation.watchPosition(
      _onPosition, _onGeoError,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
    Logger.log('Seguimiento GPS iniciado.', 'success');
  }

  function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
    Logger.log(`Seguimiento detenido. ${points.length} pts / ${totalDist.toFixed(1)} m`, 'warning');
    MapManager.removeCurrentMarker();
    Store.saveMeta({ totalDist, savedAt: Date.now() });
  }

  function reset() {
    stop();
    points = []; totalDist = 0; startTime = null;
    Store.clear();
    MapManager.reset();
  }

  function _onPosition(position) {
    const { latitude: lat, longitude: lon, altitude: alt, accuracy } = position.coords;
    const timestamp = position.timestamp;

    MapManager.updateCurrentPosition(lat, lon);
    if (onPositionUpdate) onPositionUpdate({ lat, lon, alt, accuracy, timestamp });

    if (points.length === 0) {
      _savePoint({ lat, lon, alt, accuracy, timestamp }, true);
    } else {
      const last = points[points.length - 1];
      const dist = GeoMath.haversine(last.lat, last.lon, lat, lon);
      if (dist >= MIN_DIST_M) {
        totalDist += dist;
        _savePoint({ lat, lon, alt, accuracy, timestamp }, false);
      }
    }
  }

  function _savePoint(point, isFirst) {
    points.push(point);
    // Persistir inmediatamente tras cada punto
    Store.savePoints(points);
    Store.saveMeta({ totalDist, savedAt: Date.now() });
    MapManager.addPoint(point.lat, point.lon, isFirst);
    Logger.log(`Punto ${points.length}: ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)} | ±${point.accuracy ? point.accuracy.toFixed(0) : '?'}m`, 'success');
    if (onPointAdded) onPointAdded({ point, count: points.length, totalDist });
  }

  function _onGeoError(err) {
    const msgs = { 1: 'Permiso GPS denegado.', 2: 'Posición no disponible.', 3: 'Timeout GPS.' };
    const msg  = msgs[err.code] || `Error GPS (código ${err.code}).`;
    Logger.log(msg, 'error');
    if (onError) onError(msg);
  }

  function _updateTimer() {
    if (!startTime) return;
    const e  = Math.floor((Date.now() - startTime) / 1000);
    const mm = String(Math.floor(e / 60)).padStart(2, '0');
    const ss = String(e % 60).padStart(2, '0');
    const el = document.getElementById('statDuration');
    if (el) el.textContent = `${mm}:${ss}`;
  }

  const getPoints    = () => [...points];
  const getCount     = () => points.length;
  const getTotalDist = () => totalDist;
  const isTracking   = () => watchId !== null;

  return { restore, start, stop, reset, getPoints, getCount, getTotalDist, isTracking };
})();


/* ============================================================
   7. UI
   ============================================================ */
const UI = (() => {
  const btnStart    = document.getElementById('btnStart');
  const btnStop     = document.getElementById('btnStop');
  const btnExport   = document.getElementById('btnExport');
  const btnNewRoute = document.getElementById('btnNewRoute');
  const fileInput   = document.getElementById('fileName');

  const statPoints   = document.getElementById('statPoints');
  const statDistance = document.getElementById('statDistance');
  const statAccuracy = document.getElementById('statAccuracy');
  const lastLat      = document.getElementById('lastLat');
  const lastLon      = document.getElementById('lastLon');
  const lastAlt      = document.getElementById('lastAlt');
  const lastTime     = document.getElementById('lastTime');
  const statusPill   = document.getElementById('gpsStatusPill');
  const statusText   = document.getElementById('gpsStatusText');

  // Modal
  const modalBackdrop   = document.getElementById('modalBackdrop');
  const modalPointCount = document.getElementById('modalPointCount');
  const modalDistance   = document.getElementById('modalDistance');
  const modalLastCoord  = document.getElementById('modalLastCoord');
  const modalSavedAt    = document.getElementById('modalSavedAt');
  const modalContinue   = document.getElementById('modalContinue');
  const modalDiscard    = document.getElementById('modalDiscard');

  function setStatus(active) {
    statusPill.classList.toggle('active', active);
    statusText.textContent = active ? 'ACTIVO' : 'DETENIDO';
  }

  function refreshStats() {
    const count = GPSTracker.getCount();
    statPoints.textContent   = count;
    statDistance.textContent = GPSTracker.getTotalDist().toFixed(1);
    btnExport.disabled        = count === 0;
    btnNewRoute.style.display = count > 0 ? '' : 'none';
  }

  function updateStats({ count, totalDist, point }) {
    statPoints.textContent   = count;
    statDistance.textContent = totalDist.toFixed(1);
    if (point.accuracy != null) statAccuracy.textContent = point.accuracy.toFixed(0);
    _showCoord(point);
    btnExport.disabled        = false;
    btnNewRoute.style.display = '';
  }

  function updateAccuracy(point) {
    if (point.accuracy != null) statAccuracy.textContent = point.accuracy.toFixed(0);
    _showCoord(point);
  }

  function _showCoord(point) {
    lastLat.textContent  = point.lat.toFixed(7);
    lastLon.textContent  = point.lon.toFixed(7);
    lastAlt.textContent  = point.alt != null ? point.alt.toFixed(1) + ' m' : '—';
    lastTime.textContent = new Date(point.timestamp).toUTCString().replace('GMT', 'UTC');
  }

  function setButtons(tracking) {
    btnStart.disabled = tracking;
    btnStop.disabled  = !tracking;
  }

  // ── Modal de recuperación ──
  function showRecoveryModal(savedPoints, meta) {
    const last = savedPoints[savedPoints.length - 1];
    const dist = meta?.totalDist ?? Store.recalcDistance(savedPoints);
    modalPointCount.textContent = savedPoints.length;
    modalDistance.textContent   = dist.toFixed(1);
    modalLastCoord.textContent  = `${last.lat.toFixed(6)}, ${last.lon.toFixed(6)}`;
    modalSavedAt.textContent    = meta?.savedAt ? new Date(meta.savedAt).toLocaleString() : '—';
    modalBackdrop.classList.add('visible');
  }

  function hideModal() { modalBackdrop.classList.remove('visible'); }

  modalContinue.addEventListener('click', () => {
    hideModal();
    refreshStats();
    const pts = GPSTracker.getPoints();
    if (pts.length > 0) _showCoord(pts[pts.length - 1]);
    Logger.log(`Sesión restaurada: ${GPSTracker.getCount()} puntos. Pulsa "Iniciar" para continuar.`, 'success');
  });

  modalDiscard.addEventListener('click', () => {
    hideModal();
    GPSTracker.reset();
    refreshStats();
    statAccuracy.textContent = '—';
    lastLat.textContent = lastLon.textContent = lastAlt.textContent = lastTime.textContent = '—';
    document.getElementById('statDuration').textContent = '00:00';
    Logger.log('Sesión anterior descartada. Empezando ruta nueva.', 'warning');
  });

  // ── Botón Iniciar ──
  btnStart.addEventListener('click', () => {
    GPSTracker.start({
      onPointAdded:     (data)  => { updateStats(data); setButtons(true); },
      onPositionUpdate: (point) => updateAccuracy(point),
      onError:          ()      => { setStatus(false); setButtons(false); },
    });
    setStatus(true);
    setButtons(true);
    Logger.log('Esperando señal GPS…', 'info');
  });

  // ── Botón Detener ──
  btnStop.addEventListener('click', () => {
    GPSTracker.stop();
    setStatus(false);
    setButtons(false);
    MapManager.fitRoute();
    refreshStats();
    Logger.log('Puntos guardados en almacenamiento local.', 'info');
  });

  // ── Botón Exportar KMZ ──
  btnExport.addEventListener('click', async () => {
    const points = GPSTracker.getPoints();
    if (points.length === 0) { Logger.log('No hay puntos para exportar.', 'error'); return; }

    const rawName  = fileInput.value.trim();
    const safeName = rawName
      .replace(/[^a-zA-Z0-9_\-\.áéíóúüñÁÉÍÓÚÜÑ ]/g, '_')
      .replace(/\s+/g, '_') || 'ruta_gps';

    Store.saveFileName(safeName);
    Logger.log(`Generando KMZ con ${points.length} puntos…`, 'info');
    try {
      btnExport.disabled = true;
      const n = await KMZExporter.exportKMZ(points, safeName);
      Logger.log(`✓ Exportado: ${safeName}.kmz (${n} puntos)`, 'success');
    } catch (err) {
      Logger.log(`Error al exportar: ${err.message}`, 'error');
    } finally {
      btnExport.disabled = GPSTracker.getCount() === 0;
    }
  });

  // ── Botón Nueva Ruta ──
  btnNewRoute.addEventListener('click', () => {
    if (!confirm('¿Seguro? Se borrarán todos los puntos registrados.')) return;
    GPSTracker.reset();
    setStatus(false);
    setButtons(false);
    refreshStats();
    statAccuracy.textContent = '—';
    lastLat.textContent = lastLon.textContent = lastAlt.textContent = lastTime.textContent = '—';
    document.getElementById('statDuration').textContent = '00:00';
    Logger.log('Ruta nueva. Puntos anteriores eliminados.', 'warning');
  });

  // Persistir nombre de archivo al escribir
  fileInput.addEventListener('input', () => Store.saveFileName(fileInput.value.trim()));

  // ── Inicialización ──
  function init() {
    // Restaurar nombre de archivo
    const savedName = Store.loadFileName();
    if (savedName) fileInput.value = savedName;

    const savedPoints = Store.loadPoints();
    const savedMeta   = Store.loadMeta();

    if (savedPoints && savedPoints.length > 0) {
      const dist = savedMeta?.totalDist ?? Store.recalcDistance(savedPoints);
      GPSTracker.restore(savedPoints, dist);
      // Inicializar mapa en primer punto guardado
      const firstPt = savedPoints[0];
      MapManager.init(firstPt.lat, firstPt.lon);
      // Mostrar modal de recuperación
      showRecoveryModal(savedPoints, savedMeta ? { ...savedMeta, totalDist: dist } : null);
    } else {
      // Sin sesión guardada
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => { MapManager.init(pos.coords.latitude, pos.coords.longitude); Logger.log('Mapa inicializado.', 'info'); },
          ()    => { MapManager.init(42.5680, -0.5524); Logger.log('Mapa inicializado (posición por defecto).', 'info'); },
          { timeout: 5000 }
        );
      } else {
        MapManager.init(42.5680, -0.5524);
      }
      Logger.log('GEOTRACK listo. Presiona "Iniciar seguimiento".', 'info');
    }
  }

  return { init };
})();


/* ============================================================
   ARRANQUE
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});

/* ============================================================
   GUARDIA DE RECARGA / CIERRE
   Se activa cuando hay puntos registrados para evitar pérdida
   accidental al recargar o cerrar la pestaña.
   NOTA: Los navegadores modernos muestran su propio texto
   genérico — el mensaje personalizado es ignorado por seguridad.
   ============================================================ */
window.addEventListener('beforeunload', (e) => {
  if (GPSTracker.getCount() > 0) {
    e.preventDefault();
    e.returnValue = ''; // requerido por Chrome/Edge
    return 'Tienes una ruta GPS en curso. ¿Seguro que quieres salir?';
  }
});
