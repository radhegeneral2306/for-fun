/* map.js — Tab 1: Map (heatmap / visit markers over Leaflet + OSM tiles). */

(function () {
  "use strict";

  let map = null;
  let heatLayer = null;
  let markerLayer = null;
  let view = "heatmap"; // 'heatmap' | 'markers'
  let loaded = false;

  const CATEGORY_COLOR = { home: "#3d5af1", work: "#17b897", other: "#e6a23c" };

  function getFilters() {
    const start = document.getElementById("map-start").value;
    const end = document.getElementById("map-end").value;
    return { start, end };
  }

  let tileLayer = null;

  function isDarkMode() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // Raw tile.openstreetmap.org rejects most embedded/distributed apps (no
  // Referer from file:// pages reads as policy abuse) — CARTO's free basemaps
  // are the standard drop-in replacement for this exact use case and don't
  // require an API key or referrer.
  function tileUrl(dark) {
    return dark
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  }

  function applyTileLayer() {
    if (!map) return;
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(tileUrl(isDarkMode()), {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    }).addTo(map);
  }

  function ensureMap() {
    if (map) return map;
    map = L.map("map-container", { worldCopyJump: true });
    applyTileLayer();
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTileLayer);
    }
    // Reasonable default view until data arrives (world view).
    map.setView([20, 0], 2);
    return map;
  }

  function fitToPoints(points) {
    if (!points || !points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p[0], p[1]]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  function clearLayers() {
    if (heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }
    if (markerLayer) {
      map.removeLayer(markerLayer);
      markerLayer = null;
    }
  }

  function renderHeatmap(points) {
    clearLayers();
    if (!points || !points.length) return;
    heatLayer = L.heatLayer(points, { radius: 20, blur: 18, maxZoom: 14 }).addTo(map);
  }

  function renderMarkers(visits) {
    clearLayers();
    markerLayer = L.layerGroup();
    (visits || []).forEach((v) => {
      const color = CATEGORY_COLOR[v.category] || CATEGORY_COLOR.other;
      const marker = L.circleMarker([v.lat, v.lng], {
        radius: 7,
        color: "#fff",
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.9,
      });
      const name = App.escapeHtml(v.place_name || "Unknown place");
      const cat = App.escapeHtml(v.category || "other");
      const dur = App.fmtMinutes(v.duration_minutes);
      const when = v.start_time ? App.fmtDate(v.start_time) : "";
      marker.bindPopup(
        `<strong>${name}</strong><br>` +
          `<span class="popup-category ${cat}">${cat}</span><br>` +
          `<span>${when} · ${dur}</span>`
      );
      markerLayer.addLayer(marker);
    });
    markerLayer.addTo(map);
  }

  function toggleView() {
    view = view === "heatmap" ? "markers" : "heatmap";
    const btn = document.getElementById("map-toggle-view");
    btn.textContent = view === "heatmap" ? "Show Markers" : "Show Heatmap";
    renderCurrentView();
  }

  let lastHeatmapPoints = [];
  let lastVisits = [];

  function renderCurrentView() {
    if (view === "heatmap") {
      renderHeatmap(lastHeatmapPoints);
    } else {
      renderMarkers(lastVisits);
    }
  }

  async function load() {
    ensureMap();
    App.setPanelStatus("map-status", "Loading map data…");
    const filters = getFilters();
    try {
      const [heatRes, visitsRes] = await Promise.all([
        App.apiGet("/api/map/heatmap", { start: filters.start, end: filters.end }),
        App.apiGet("/api/map/visits", { start: filters.start, end: filters.end }),
      ]);
      lastHeatmapPoints = heatRes.points || [];
      lastVisits = visitsRes.visits || [];

      if (!lastHeatmapPoints.length && !lastVisits.length) {
        App.setPanelStatus("map-status", "No location data for this period.");
      } else {
        App.setPanelStatus(
          "map-status",
          `${lastVisits.length.toLocaleString()} visits · ${lastHeatmapPoints.length.toLocaleString()} points`
        );
      }

      renderCurrentView();

      // Fit bounds to whichever dataset has points — works for any location on earth.
      const boundsSource = lastHeatmapPoints.length ? lastHeatmapPoints : lastVisits.map((v) => [v.lat, v.lng]);
      if (boundsSource.length) {
        fitToPoints(boundsSource);
      }
      loaded = true;
    } catch (err) {
      App.setPanelStatus("map-status", `Error: ${err.message}`, true);
      App.showToast(`Map data failed to load: ${err.message}`, true);
    }
  }

  function init() {
    document.getElementById("map-toggle-view").addEventListener("click", toggleView);
    document.getElementById("map-apply-filter").addEventListener("click", () => load());
    document.getElementById("map-clear-filter").addEventListener("click", () => {
      document.getElementById("map-start").value = "";
      document.getElementById("map-end").value = "";
      load();
    });
  }

  function activate() {
    ensureMap();
    // Leaflet needs a size recalculation the first time its container becomes visible.
    setTimeout(() => map && map.invalidateSize(), 0);
    if (!loaded) load();
  }

  function refresh() {
    return load();
  }

  window.Tabs.map = { init, activate, refresh };
})();
