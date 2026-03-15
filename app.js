/**
 * GEOTRACK · GPS KMZ Exporter
 * app.js — Lógica principal modular (ES6+)
 *
 * Módulos:
 *  1. Logger        — sistema de log en pantalla
 *  2. GeoMath       — cálculo de distancia Haversine
 *  3. MapManager    — mapa Leaflet interactivo
 *  4. KMZExporter   — generación KML → KMZ (JSZip)
 *  5. GPSTracker    — watchPosition, almacenamiento, coordinación
 *  6. UI            — vínculos DOM → eventos
 */

'use strict';

/* ============================================================
   1. LOGGER
   ============================================================ */
const Logger = (() => {
  const area = document.getElementById('logArea');

  /**
   * Agrega una línea al log.
   * @param {string} msg   — mensaje
   * @param {'info'|'success'|'warning'|'error'} type
   */
  function log(msg, type = 'info') {
    const now = new Date();
    const ts  = now.toTimeString().slice(0, 8);

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

    // Auto-scroll al final
    area.scrollTop = area.scrollHeight;
  }

  return { log };
})();


/* ============================================================
   2. GEOMATH
   ============================================================ */
const GeoMath = (() => {
  const R = 6_371_000; // Radio de la Tierra en metros

  /**
   * Distancia Haversine entre dos puntos geográficos.
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} distancia en metros
   */
  function haversine(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat  = toRad(lat2 - lat1);
    const dLon  = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  return { haversine };
})();


/* ============================================================
   3. MAP MANAGER (Leaflet)
   ============================================================ */
const MapManager = (() => {
  let map          = null;
  let polyline     = null;
  let markers      = [];   // todos los marcadores puntuales
  let currentMarker = null; // marcador de posición actual (rojo)
  const latLngs    = [];   // array de coords para la polyline

  /**
   * Inicializa el mapa Leaflet centrado en coordenadas dadas.
   * Fallback: Jaca, Aragón, España (donde vive el usuario).
   */
  function init(lat = 42.5680, lon = -0.5524) {
    if (map) return;

    map = L.map('map', {
      center: [lat, lon],
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });

    // Tile layer OSM (se filtra con CSS a estilo oscuro)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Polyline (ruta)
    polyline = L.polyline([], {
      color: '#e8ff47',
      weight: 2.5,
      opacity: 0.85,
      dashArray: '4, 6',
    }).addTo(map);
  }

  /**
   * Agrega un punto al mapa (marcador + polyline).
   * @param {number} lat
   * @param {number} lon
   * @param {boolean} isFirst — primer punto de la sesión
   */
  function addPoint(lat, lon, isFirst = false) {
    if (!map) init(lat, lon);

    const ll = [lat, lon];
    latLngs.push(ll);
    polyline.setLatLngs(latLngs);

    // Ícono personalizado
    const iconClass = isFirst ? 'gps-marker gps-marker-first' : 'gps-marker';
    const size      = isFirst ? 10 : 8;

    const icon = L.divIcon({
      className: iconClass,
      iconSize:  [size, size],
      iconAnchor:[size / 2, size / 2],
    });

    const marker = L.marker(ll, { icon }).addTo(map);
    marker.bindPopup(
      `<b>Punto ${latLngs.length}</b><br>` +
      `Lat: ${lat.toFixed(7)}<br>` +
      `Lon: ${lon.toFixed(7)}`
    );
    markers.push(marker);
  }

  /**
   * Actualiza el marcador de posición actual (punto rojo animado).
   * @param {number} lat
   * @param {number} lon
   */
  function updateCurrentPosition(lat, lon) {
    if (!map) init(lat, lon);

    const icon = L.divIcon({
      className: 'gps-marker gps-marker-current',
      iconSize:  [14, 14],
      iconAnchor:[7, 7],
    });

    if (currentMarker) {
      currentMarker.setLatLng([lat, lon]);
    } else {
      currentMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
    }

    // Centrar el mapa en la posición actual
    map.panTo([lat, lon], { animate: true, duration: 0.8 });
  }

  /**
   * Elimina el marcador de posición actual.
   */
  function removeCurrentMarker() {
    if (currentMarker) {
      map.removeLayer(currentMarker);
      currentMarker = null;
    }
  }

  /**
   * Resetea el mapa (elimina marcadores y polyline).
   */
  function reset() {
    latLngs.length = 0;
    if (polyline) polyline.setLatLngs([]);

    markers.forEach((m) => map && map.removeLayer(m));
    markers.length = 0;

    removeCurrentMarker();
  }

  /**
   * Ajusta el zoom para mostrar toda la ruta.
   */
  function fitRoute() {
    if (map && latLngs.length > 1) {
      map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
    }
  }

  return { init, addPoint, updateCurrentPosition, removeCurrentMarker, reset, fitRoute };
})();


/* ============================================================
   4. KMZ EXPORTER
   ============================================================ */
const KMZExporter = (() => {

  /**
   * Genera un string KML válido a partir del array de puntos.
   * @param {Array<{lat, lon, alt, accuracy, timestamp}>} points
   * @param {string} name — nombre de la ruta
   * @returns {string} KML como texto
   */
  function buildKML(points, name) {
    if (points.length === 0) throw new Error('No hay puntos para exportar.');

    const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');

    // Placemarks individuales
    const placemarks = points.map((p, i) => {
      const date = new Date(p.timestamp).toISOString();
      return `
    <Placemark>
      <name>Punto ${i + 1}</name>
      <description>
        Lat: ${p.lat.toFixed(7)}
        Lon: ${p.lon.toFixed(7)}
        Precisión: ${p.accuracy ? p.accuracy.toFixed(1) + ' m' : 'N/A'}
        Hora: ${date}
      </description>
      <TimeStamp><when>${date}</when></TimeStamp>
      <Point>
        <coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},${(p.alt ?? 0).toFixed(1)}</coordinates>
      </Point>
    </Placemark>`;
    }).join('\n');

    // LineString (ruta completa)
    const lineCoords = points
      .map((p) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},${(p.alt ?? 0).toFixed(1)}`)
      .join('\n          ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapedName}</name>
    <description>Ruta GPS exportada con GEOTRACK · ${new Date().toISOString()}</description>

    <!-- Estilo de la ruta -->
    <Style id="routeStyle">
      <LineStyle>
        <color>ff47ffe8</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <fill>0</fill>
      </PolyStyle>
    </Style>

    <!-- Estilo de los puntos -->
    <Style id="pointStyle">
      <IconStyle>
        <color>ff47b4ff</color>
        <scale>0.6</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
        </Icon>
      </IconStyle>
      <LabelStyle>
        <scale>0</scale>
      </LabelStyle>
    </Style>

    <!-- Ruta (LineString) -->
    <Placemark>
      <name>${escapedName} — Ruta</name>
      <styleUrl>#routeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${lineCoords}
        </coordinates>
      </LineString>
    </Placemark>

    <!-- Puntos individuales -->
    <Folder>
      <name>Puntos GPS</name>
      ${placemarks}
    </Folder>

  </Document>
</kml>`;
  }

  /**
   * Comprime el KML en un archivo KMZ usando JSZip y lo descarga.
   * @param {Array} points
   * @param {string} fileName — sin extensión
   */
  async function exportKMZ(points, fileName) {
    if (!window.JSZip) throw new Error('JSZip no está disponible.');

    const kmlContent = buildKML(points, fileName);
    const zip        = new JSZip();

    // El archivo principal dentro del KMZ debe llamarse "doc.kml"
    zip.file('doc.kml', kmlContent);

    const blob = await zip.generateAsync({
      type:               'blob',
      compression:        'DEFLATE',
      compressionOptions: { level: 9 },
    });

    // Descarga automática
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `${fileName}.kmz`;
    link.click();

    // Limpieza
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    return points.length; // devuelve nº de puntos exportados
  }

  return { exportKMZ };
})();


/* ============================================================
   5. GPS TRACKER
   ============================================================ */
const GPSTracker = (() => {
  const MIN_DISTANCE_M = 10; // metros mínimos entre puntos

  let points        = [];   // array de coordenadas guardadas
  let watchId       = null; // ID de watchPosition
  let totalDist     = 0;    // distancia acumulada en metros
  let startTime     = null; // timestamp de inicio de sesión
  let timerInterval = null; // intervalo del cronómetro UI

  /* ── Callbacks externos (inyectados por UI) ── */
  let onPointAdded  = null;
  let onPositionUpdate = null;
  let onError       = null;

  /**
   * Inicia el seguimiento GPS.
   */
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

    // Iniciar cronómetro
    timerInterval = setInterval(_updateTimer, 1000);

    const options = {
      enableHighAccuracy: true,
      timeout:            15_000,
      maximumAge:         0,
    };

    watchId = navigator.geolocation.watchPosition(
      _onPosition,
      _onGeoError,
      options
    );

    Logger.log('Seguimiento GPS iniciado.', 'success');
  }

  /**
   * Detiene el seguimiento GPS.
   */
  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    Logger.log(`Seguimiento detenido. Total: ${points.length} pts / ${totalDist.toFixed(1)} m`, 'warning');
    MapManager.removeCurrentMarker();
  }

  /**
   * Resetea todos los datos de la sesión.
   */
  function reset() {
    stop();
    points    = [];
    totalDist = 0;
    startTime = null;
    MapManager.reset();
  }

  /**
   * Callback de posición de watchPosition.
   * @param {GeolocationPosition} position
   */
  function _onPosition(position) {
    const { latitude: lat, longitude: lon, altitude: alt, accuracy } = position.coords;
    const timestamp = position.timestamp;

    // Actualizar marcador de posición actual siempre
    MapManager.updateCurrentPosition(lat, lon);

    // Notificar actualización de posición (para UI)
    if (onPositionUpdate) {
      onPositionUpdate({ lat, lon, alt, accuracy, timestamp });
    }

    // ¿Guardamos el punto?
    if (points.length === 0) {
      // Primer punto — siempre guardar
      _savePoint({ lat, lon, alt, accuracy, timestamp }, true);
    } else {
      const last = points[points.length - 1];
      const dist = GeoMath.haversine(last.lat, last.lon, lat, lon);

      if (dist >= MIN_DISTANCE_M) {
        totalDist += dist;
        _savePoint({ lat, lon, alt, accuracy, timestamp }, false);
      }
    }
  }

  /**
   * Guarda un punto en el array y notifica.
   */
  function _savePoint(point, isFirst) {
    points.push(point);
    MapManager.addPoint(point.lat, point.lon, isFirst);

    Logger.log(
      `Punto ${points.length}: ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)} | ±${point.accuracy ? point.accuracy.toFixed(0) : '?'}m`,
      'success'
    );

    if (onPointAdded) {
      onPointAdded({
        point,
        count:     points.length,
        totalDist,
      });
    }
  }

  /**
   * Callback de error de geolocalización.
   */
  function _onGeoError(err) {
    const messages = {
      1: 'Permiso de GPS denegado por el usuario.',
      2: 'Posición no disponible (GPS sin señal).',
      3: 'Tiempo de espera agotado esperando GPS.',
    };
    const msg = messages[err.code] || `Error de GPS desconocido (código ${err.code}).`;
    Logger.log(msg, 'error');
    if (onError) onError(msg);
  }

  /**
   * Actualiza el cronómetro en la UI.
   */
  function _updateTimer() {
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    const el = document.getElementById('statDuration');
    if (el) el.textContent = `${mm}:${ss}`;
  }

  /** Getters */
  const getPoints    = () => [...points];
  const getCount     = () => points.length;
  const getTotalDist = () => totalDist;
  const isTracking   = () => watchId !== null;

  return { start, stop, reset, getPoints, getCount, getTotalDist, isTracking };
})();


/* ============================================================
   6. UI — vínculos DOM → eventos
   ============================================================ */
const UI = (() => {

  /* ── Elementos DOM ── */
  const btnStart  = document.getElementById('btnStart');
  const btnStop   = document.getElementById('btnStop');
  const btnExport = document.getElementById('btnExport');
  const fileInput = document.getElementById('fileName');

  const statPoints   = document.getElementById('statPoints');
  const statDistance = document.getElementById('statDistance');
  const statAccuracy = document.getElementById('statAccuracy');
  const lastLat      = document.getElementById('lastLat');
  const lastLon      = document.getElementById('lastLon');
  const lastAlt      = document.getElementById('lastAlt');
  const lastTime     = document.getElementById('lastTime');

  const statusPill  = document.getElementById('gpsStatusPill');
  const statusText  = document.getElementById('gpsStatusText');

  /* ── Helpers ── */
  function setStatus(active) {
    statusPill.classList.toggle('active', active);
    statusText.textContent = active ? 'ACTIVO' : 'DETENIDO';
  }

  function updateStats({ count, totalDist, point }) {
    statPoints.textContent   = count;
    statDistance.textContent = totalDist.toFixed(1);
    if (point.accuracy != null) {
      statAccuracy.textContent = point.accuracy.toFixed(0);
    }
    lastLat.textContent  = point.lat.toFixed(7);
    lastLon.textContent  = point.lon.toFixed(7);
    lastAlt.textContent  = point.alt != null ? point.alt.toFixed(1) + ' m' : '—';
    const d = new Date(point.timestamp);
    lastTime.textContent = d.toUTCString().replace('GMT', 'UTC');
  }

  function updateAccuracy(point) {
    if (point.accuracy != null) {
      statAccuracy.textContent = point.accuracy.toFixed(0);
    }
    lastLat.textContent  = point.lat.toFixed(7);
    lastLon.textContent  = point.lon.toFixed(7);
    lastAlt.textContent  = point.alt != null ? point.alt.toFixed(1) + ' m' : '—';
    const d = new Date(point.timestamp);
    lastTime.textContent = d.toUTCString().replace('GMT', 'UTC');
  }

  function setButtons(tracking) {
    btnStart.disabled  = tracking;
    btnStop.disabled   = !tracking;
    btnExport.disabled = GPSTracker.getCount() === 0;
  }

  /* ── Event: Iniciar ── */
  btnStart.addEventListener('click', () => {
    GPSTracker.start({
      onPointAdded: (data) => {
        updateStats(data);
        setButtons(true);
        btnExport.disabled = false;
      },
      onPositionUpdate: (point) => {
        updateAccuracy(point);
      },
      onError: () => {
        setStatus(false);
        setButtons(false);
      },
    });

    setStatus(true);
    setButtons(true);
    Logger.log('Esperando señal GPS…', 'info');
  });

  /* ── Event: Detener ── */
  btnStop.addEventListener('click', () => {
    GPSTracker.stop();
    setStatus(false);
    setButtons(false);
    MapManager.fitRoute();
    btnExport.disabled = GPSTracker.getCount() === 0;
    Logger.log('Seguimiento detenido.', 'warning');
  });

  /* ── Event: Exportar KMZ ── */
  btnExport.addEventListener('click', async () => {
    const points = GPSTracker.getPoints();

    if (points.length === 0) {
      Logger.log('No hay puntos para exportar.', 'error');
      return;
    }

    const rawName = fileInput.value.trim();
    const safeName = rawName
      .replace(/[^a-zA-Z0-9_\-\.áéíóúüñÁÉÍÓÚÜÑ ]/g, '_')
      .replace(/\s+/g, '_')
      || 'ruta_gps';

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

  /* ── Inicializar mapa al cargar ── */
  function init() {
    // Intentar centrar en la posición actual antes de empezar tracking
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          MapManager.init(pos.coords.latitude, pos.coords.longitude);
          Logger.log('Mapa inicializado en posición actual.', 'info');
        },
        () => {
          // Fallback: Jaca, Aragón
          MapManager.init(42.5680, -0.5524);
          Logger.log('Mapa inicializado (posición por defecto).', 'info');
        },
        { timeout: 5000 }
      );
    } else {
      MapManager.init(42.5680, -0.5524);
    }

    Logger.log('GEOTRACK listo. Presiona "Iniciar seguimiento".', 'info');
  }

  return { init };
})();


/* ============================================================
   ARRANQUE
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  UI.init();
});
