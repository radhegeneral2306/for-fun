/* app.js — shared utilities, header status, tab switching, refresh wiring.
 *
 * Exposes `window.App` with small helpers used by every tab module, and
 * `window.Tabs` — a registry each tab script (map.js, stats.js, ...) fills
 * in with { init(), activate(), refresh() }.
 */

(function () {
  "use strict";

  const toastEl = document.getElementById("toast");
  let toastTimer = null;

  function showToast(message, isError) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.toggle("is-error", !!isError);
    toastEl.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 4500);
  }

  async function apiGet(path, params) {
    let url = path;
    if (params) {
      const usp = new URLSearchParams();
      Object.keys(params).forEach((k) => {
        const v = params[k];
        if (v !== undefined && v !== null && v !== "") usp.set(k, v);
      });
      const qs = usp.toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error("Network error — is the backend running?");
    }
    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      /* no body / not JSON */
    }
    if (!res.ok) {
      const detail = (body && body.detail) || `Request failed (${res.status})`;
      throw new Error(detail);
    }
    return body;
  }

  async function apiPost(path) {
    let res;
    try {
      res = await fetch(path, { method: "POST" });
    } catch (err) {
      throw new Error("Network error — is the backend running?");
    }
    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      /* ignore */
    }
    if (!res.ok) {
      const detail = (body && body.detail) || `Request failed (${res.status})`;
      throw new Error(detail);
    }
    return body;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(isoOrDateStr) {
    if (!isoOrDateStr) return "";
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return isoOrDateStr;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function fmtDateShort(isoOrDateStr) {
    if (!isoOrDateStr) return "";
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return isoOrDateStr;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function fmtMinutes(mins) {
    if (mins === null || mins === undefined || isNaN(mins)) return "—";
    mins = Math.round(mins);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function fmtNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function setPanelStatus(elId, text, isError) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  // ---------- Motion helpers (all respect prefers-reduced-motion) ----------

  const reducedMotionMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const prefersReducedMotion = () => !!(reducedMotionMq && reducedMotionMq.matches);

  /** Animate a number counting up from 0 to `target`, writing through `render(value)`. */
  function countUp(el, target, render, opts) {
    opts = opts || {};
    const duration = opts.duration || 700;
    if (!el) return;
    const numTarget = Number(target);
    if (!isFinite(numTarget)) {
      el.textContent = render ? render(target) : String(target);
      return;
    }
    if (prefersReducedMotion()) {
      el.textContent = render ? render(numTarget) : String(numTarget);
      return;
    }
    const start = performance.now();
    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const value = numTarget * eased;
      el.textContent = render ? render(value) : String(Math.round(value));
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = render ? render(numTarget) : String(numTarget);
    }
    requestAnimationFrame(tick);
  }

  /** Stagger-reveal the rows inside `container` (matched by the CSS in .stagger-list) once it scrolls into view. */
  function revealList(container) {
    if (!container) return;
    container.classList.remove("in-view");
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      container.classList.add("in-view");
      return;
    }
    const rows = container.querySelectorAll(".ranked-row, tbody tr, .event-item");
    rows.forEach((row, i) => {
      row.style.transitionDelay = `${Math.min(i, 20) * 40}ms`;
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          container.classList.add("in-view");
          io.unobserve(container);
        }
      });
    });
    io.observe(container);
  }

  /** HTML for `n` pulsing skeleton bars, used while a section's real data is loading. */
  function skeletonRows(n, heightPx) {
    const h = heightPx || 16;
    let html = "";
    for (let i = 0; i < n; i++) {
      html += `<div class="skeleton skeleton-row" style="height:${h}px;width:${85 - (i % 3) * 12}%"></div>`;
    }
    return html;
  }

  function skeletonTiles() {
    return `
      <div class="skeleton skeleton-tile" style="grid-column:1/3;grid-row:1/3;"></div>
      <div class="skeleton skeleton-tile" style="grid-column:3;grid-row:1;"></div>
      <div class="skeleton skeleton-tile" style="grid-column:4;grid-row:1;"></div>
      <div class="skeleton skeleton-tile" style="grid-column:3/5;grid-row:2;"></div>`;
  }

  const App = {
    apiGet,
    apiPost,
    showToast,
    escapeHtml,
    fmtDate,
    fmtDateShort,
    fmtTime,
    fmtMinutes,
    fmtNumber,
    setPanelStatus,
    countUp,
    revealList,
    skeletonRows,
    skeletonTiles,
    prefersReducedMotion,
  };
  window.App = App;

  // ---------- Chart.js theming (Apple-neutral, single accent) ----------
  function themeCharts() {
    if (typeof Chart === "undefined") return;
    const styles = getComputedStyle(document.documentElement);
    const textMuted = styles.getPropertyValue("--text-muted").trim() || "#6e6e73";
    const border = styles.getPropertyValue("--border").trim() || "rgba(0,0,0,0.08)";
    Chart.defaults.color = textMuted;
    Chart.defaults.borderColor = border;
    Chart.defaults.font.family =
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    if (prefersReducedMotion()) {
      Chart.defaults.animation = false;
    }
  }
  themeCharts();
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeCharts);
  }

  // Registry that tab modules populate.
  window.Tabs = window.Tabs || {};

  const TAB_NAMES = ["map", "stats", "timeline", "insights"];
  let currentTab = "map";

  function activateTab(name) {
    if (!TAB_NAMES.includes(name)) return;
    currentTab = name;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const isTarget = panel.id === `tab-${name}`;
      if (isTarget) {
        panel.classList.add("active", "entering");
        // Force a reflow so the browser registers the "entering" (opacity:0) state
        // before we remove it, otherwise the transition would be skipped.
        void panel.offsetWidth;
        requestAnimationFrame(() => panel.classList.remove("entering"));
      } else {
        panel.classList.remove("active", "entering");
      }
    });
    const mod = window.Tabs[name];
    if (mod && typeof mod.activate === "function") {
      try {
        mod.activate();
      } catch (err) {
        console.error(`Error activating tab ${name}:`, err);
      }
    }
  }

  function renderStatus(status) {
    const statusEl = document.getElementById("status-summary");
    const emptyBanner = document.getElementById("empty-state-banner");
    if (!statusEl) return;

    if (!status || !status.loaded || !status.segment_count) {
      statusEl.textContent = "No data loaded";
      statusEl.classList.add("is-empty");
      statusEl.classList.remove("is-error");
      emptyBanner.classList.remove("hidden");
      return;
    }

    emptyBanner.classList.add("hidden");
    statusEl.classList.remove("is-empty", "is-error");

    const count = status.segment_count.toLocaleString();
    let rangeText = "";
    if (status.date_range && status.date_range.start && status.date_range.end) {
      // Drop the year from the start date only when both ends of the range fall
      // in the same calendar year ("Jun 18 – Sep 16, 2026"). For a multi-year
      // export both years have to be shown ("Dec 4, 2022 – Sep 16, 2026"),
      // otherwise a decade of history reads as a few months.
      const startYear = new Date(status.date_range.start).getFullYear();
      const endYear = new Date(status.date_range.end).getFullYear();
      const sameYear = isFinite(startYear) && isFinite(endYear) && startYear === endYear;
      const startText = sameYear
        ? App.fmtDateShort(status.date_range.start)
        : App.fmtDate(status.date_range.start);
      rangeText = ` · ${startText} – ${App.fmtDate(status.date_range.end)}`;
    }
    statusEl.textContent = `${count} segments loaded${rangeText}`;
  }

  let lastStatus = null;

  async function fetchStatus() {
    try {
      const status = await App.apiGet("/api/status");
      lastStatus = status;
      renderStatus(status);
      return status;
    } catch (err) {
      const statusEl = document.getElementById("status-summary");
      if (statusEl) {
        statusEl.textContent = `Error loading status: ${err.message}`;
        statusEl.classList.add("is-error");
      }
      App.showToast(`Could not load status: ${err.message}`, true);
      return null;
    }
  }

  App.getLastStatus = () => lastStatus;

  async function handleRefresh() {
    const btn = document.getElementById("refresh-btn");
    const icon = btn ? btn.querySelector("i") : null;
    const label = btn ? btn.querySelector("span") : null;
    if (btn) {
      btn.disabled = true;
      if (icon) icon.classList.add("spinning");
      if (label) label.textContent = "Refreshing…";
    }
    try {
      await App.apiPost("/api/reload");
      await fetchStatus();
      const mod = window.Tabs[currentTab];
      if (mod && typeof mod.refresh === "function") {
        await mod.refresh();
      }
      App.showToast("Data refreshed.");
    } catch (err) {
      App.showToast(`Refresh failed: ${err.message}`, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        if (icon) icon.classList.remove("spinning");
        if (label) label.textContent = "Refresh Data";
      }
    }
  }

  function init() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    });
    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", handleRefresh);

    Object.keys(window.Tabs).forEach((name) => {
      const mod = window.Tabs[name];
      if (mod && typeof mod.init === "function") {
        try {
          mod.init();
        } catch (err) {
          console.error(`Error initializing tab ${name}:`, err);
        }
      }
    });

    fetchStatus().then(() => {
      // Activate the default (already-visible) tab to trigger its first load.
      activateTab(currentTab);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
