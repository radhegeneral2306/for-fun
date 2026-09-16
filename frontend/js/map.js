/* map.js — Tab 1: Map (heatmap / visit markers over MapLibre GL JS + OpenFreeMap vector tiles). */

(function () {
  "use strict";

  let map = null;
  let popup = null;
  let layersReady = false; // sources/layers exist on the currently loaded style
  let view = "heatmap"; // 'heatmap' | 'markers'
  let loaded = false;

  let lastHeatmapPoints = [];
  let lastVisits = [];

  // Re-fit the viewport to the data only when the visible dataset genuinely
  // changed (first load of the session, filter applied, filter cleared).
  // Background refreshes — the standalone build's reverse-geocoding loop
  // calling __refreshAllTabs() every few seconds, or the desktop "Refresh
  // Data" button — must leave whatever the user panned/zoomed to alone.
  let fitOnNextLoad = true;

  const CATEGORY_COLOR = { home: "#3d5af1", work: "#17b897", other: "#e6a23c" };

  // OpenFreeMap: free forever, no API key, no usage limits, no registration
  // (donation-funded, self-hostable). Replaces raw OSM tiles (blocks embedded
  // /file:// apps), CARTO's basemaps (started requiring an API key) and Esri's
  // raster fallback. Vector tiles, so this renders through MapLibre GL, not
  // Leaflet. MapLibre derives the required attribution from the style itself.
  const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
  const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

  const HEATMAP_SOURCE = "heatmap-src";
  const HEATMAP_LAYER = "heatmap-layer";
  const MARKERS_SOURCE = "markers-src";
  const MARKERS_LAYER = "markers-layer";

  // MapLibre takes coordinates as [lng, lat]; this app's API responses, the
  // SQLite rows behind them and every other tab use [lat, lng]. Every single
  // conversion goes through this helper so the ordering lives in one place.
  function toLngLat(lat, lng) {
    return [lng, lat];
  }

  function getFilters() {
    const start = document.getElementById("map-start").value;
    const end = document.getElementById("map-end").value;
    return { start, end };
  }

  function isDarkMode() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // MapLibre GL JS v4 dropped the `maplibregl.supported()` helper that v2 had,
  // so probe for a WebGL context ourselves before constructing a Map (which
  // would otherwise throw and leave an empty container behind).
  function webglSupported() {
    try {
      const canvas = document.createElement("canvas");
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      );
    } catch (err) {
      return false;
    }
  }

  // --- GeoJSON builders ------------------------------------------------------

  // /api/map/heatmap returns { points: [[lat, lng, weight], ...] } — weight is
  // pre-normalized 0–1 for visits and a flat 1 for trip/path points.
  function heatmapGeoJSON(points) {
    return {
      type: "FeatureCollection",
      features: (points || []).map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: toLngLat(p[0], p[1]) },
        properties: { weight: typeof p[2] === "number" ? p[2] : 1 },
      })),
    };
  }

  // /api/map/visits returns visits with .lat/.lng plus the fields the popup
  // needs — those ride along as feature properties so the click handler can
  // read them straight off e.features[0].
  function visitsGeoJSON(visits) {
    return {
      type: "FeatureCollection",
      features: (visits || []).map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: toLngLat(v.lat, v.lng) },
        properties: {
          place_name: v.place_name || "Unknown place",
          category: v.category || "other",
          duration_minutes: v.duration_minutes,
          start_time: v.start_time || "",
        },
      })),
    };
  }

  // --- Layers ----------------------------------------------------------------

  function addHeatmapAndMarkerSourcesAndLayers() {
    if (!map) return;
    map.addSource(HEATMAP_SOURCE, { type: "geojson", data: heatmapGeoJSON([]) });
    map.addSource(MARKERS_SOURCE, { type: "geojson", data: visitsGeoJSON([]) });

    map.addLayer({
      id: HEATMAP_LAYER,
      type: "heatmap",
      source: HEATMAP_SOURCE,
      layout: { visibility: view === "heatmap" ? "visible" : "none" },
      paint: {
        "heatmap-weight": ["get", "weight"],
        "heatmap-intensity": 1,
        "heatmap-radius": 20,
        "heatmap-opacity": 0.8,
      },
    });

    map.addLayer({
      id: MARKERS_LAYER,
      type: "circle",
      source: MARKERS_SOURCE,
      layout: { visibility: view === "markers" ? "visible" : "none" },
      paint: {
        "circle-radius": 7,
        "circle-color": [
          "match",
          ["get", "category"],
          "home",
          CATEGORY_COLOR.home,
          "work",
          CATEGORY_COLOR.work,
          CATEGORY_COLOR.other,
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    });

    layersReady = true;
  }

  function setLayerVisibility(layerId, visible) {
    if (!map || !map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }

  function ensureMap() {
    if (map) return map;
    if (!window.maplibregl) {
      App.setPanelStatus("map-status", "The map library didn't load — check your internet connection.", true);
      return null;
    }
    if (!webglSupported()) {
      App.setPanelStatus("map-status", "Your browser doesn't support the map view (WebGL required).", true);
      return null;
    }

    map = new maplibregl.Map({
      container: "map-container",
      style: isDarkMode() ? STYLE_DARK : STYLE_LIGHT,
      // World view until data arrives. NOTE the [lng, lat] order: this is the
      // Leaflet setView([20, 0], 2) equivalent, lng 0 / lat 20 — not [20, 0].
      center: [0, 20],
      zoom: 2,
    });

    popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });

    // `style.load` fires after every full style load — the initial one here and
    // every theme switch below — and a style load throws away all custom
    // sources/layers, so this is the one and only place they get (re-)added.
    //
    // IMPORTANT: this handler must repaint from the cached lastHeatmapPoints /
    // lastVisits via renderCurrentView() and must NEVER call load() or
    // fitToPoints(). Calling load() here would re-fetch and (worse) re-fit the
    // viewport on every OS light/dark toggle, silently reintroducing the
    // "map snaps back to the fitted view" bug that fitOnNextLoad exists to fix.
    map.on("style.load", () => {
      layersReady = false;
      addHeatmapAndMarkerSourcesAndLayers();
      renderCurrentView();
    });

    // Delegated listeners live on the map, not on the style, so they survive
    // setStyle() and only need registering once. MapLibre v4 skips layers that
    // don't currently exist, so they're harmless during a style swap.
    map.on("click", MARKERS_LAYER, onMarkerClick);
    map.on("mouseenter", MARKERS_LAYER, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", MARKERS_LAYER, () => {
      map.getCanvas().style.cursor = "";
    });

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (!map) return;
        // `diff: false` is load-bearing, not a tidy-up: MapLibre's default
        // diffing path drops sources/layers that aren't in the incoming style
        // (i.e. ours) AND never fires `style.load`, so the heatmap/markers
        // would vanish for good on the first OS theme toggle. A full style
        // reload fires `style.load`, which puts them back.
        map.setStyle(isDarkMode() ? STYLE_DARK : STYLE_LIGHT, { diff: false });
      });
    }

    return map;
  }

  function onMarkerClick(e) {
    const feature = e.features && e.features[0];
    if (!feature) return;
    const props = feature.properties || {};
    const name = App.escapeHtml(props.place_name || "Unknown place");
    const cat = App.escapeHtml(props.category || "other");
    const dur = App.fmtMinutes(props.duration_minutes);
    const when = props.start_time ? App.fmtDate(props.start_time) : "";
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${name}</strong><br>` +
          `<span class="popup-category ${cat}">${cat}</span><br>` +
          `<span>${when} · ${dur}</span>`
      )
      .addTo(map);
  }

  // `points` are raw [lat, lng, ...] tuples straight from the API.
  function fitToPoints(points) {
    if (!map || !points || !points.length) return;
    const bounds = new maplibregl.LngLatBounds();
    let n = 0;
    points.forEach((p) => {
      const lat = p[0];
      const lng = p[1];
      if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) return;
      bounds.extend(toLngLat(lat, lng));
      n++;
    });
    if (!n) return;
    map.fitBounds(bounds, { padding: 30, maxZoom: 15 });
  }

  function renderCurrentView() {
    if (!map || !layersReady) return;
    const heatSrc = map.getSource(HEATMAP_SOURCE);
    const markerSrc = map.getSource(MARKERS_SOURCE);
    if (heatSrc) heatSrc.setData(heatmapGeoJSON(lastHeatmapPoints));
    if (markerSrc) markerSrc.setData(visitsGeoJSON(lastVisits));
    // Toggle visibility rather than adding/removing layers — cheaper, and it
    // keeps the sources alive across view switches.
    setLayerVisibility(HEATMAP_LAYER, view === "heatmap");
    setLayerVisibility(MARKERS_LAYER, view === "markers");
    if (view !== "markers" && popup) popup.remove();
  }

  function toggleView() {
    view = view === "heatmap" ? "markers" : "heatmap";
    const btn = document.getElementById("map-toggle-view");
    btn.textContent = view === "heatmap" ? "Show Markers" : "Show Heatmap";
    renderCurrentView();
  }

  async function load() {
    // Without a map (no WebGL) ensureMap() has already set an explanatory
    // status — don't overwrite it with a loading message.
    if (!ensureMap()) return;
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

      // Fit bounds to whichever dataset has points — works for any location on
      // earth — but only when this load was an intentional data change.
      const boundsSource = lastHeatmapPoints.length ? lastHeatmapPoints : lastVisits.map((v) => [v.lat, v.lng]);
      if (fitOnNextLoad && boundsSource.length) {
        fitToPoints(boundsSource);
        // Consumed only once a fit actually happened. A load that returned no
        // points hasn't fitted anything, so the flag stays armed — that's what
        // makes the standalone build fit after the very first import (its first
        // load runs against an empty IndexedDB, before any data exists).
        fitOnNextLoad = false;
      }
      loaded = true;
    } catch (err) {
      // fitOnNextLoad intentionally left unchanged — a failed intentional load
      // stays armed so the retry still fits.
      App.setPanelStatus("map-status", `Error: ${err.message}`, true);
      App.showToast(`Map data failed to load: ${err.message}`, true);
    }
  }

  function init() {
    document.getElementById("map-toggle-view").addEventListener("click", toggleView);
    document.getElementById("map-apply-filter").addEventListener("click", () => {
      fitOnNextLoad = true; // filter changed — the visible dataset really is different
      load();
    });
    document.getElementById("map-clear-filter").addEventListener("click", () => {
      document.getElementById("map-start").value = "";
      document.getElementById("map-end").value = "";
      fitOnNextLoad = true; // filter cleared — same deal
      load();
    });
  }

  function activate() {
    ensureMap();
    // MapLibre needs a size recalculation the first time its container becomes
    // visible (the GL canvas is sized from the container's client rect).
    setTimeout(() => map && map.resize(), 0);
    if (!loaded) load();
  }

  function refresh() {
    // Deliberately does NOT arm fitOnNextLoad: background refreshes and the
    // "Refresh Data" button both preserve the user's current pan/zoom.
    return load();
  }

  window.Tabs.map = { init, activate, refresh };
})();
