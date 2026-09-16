/* stats.js — Tab 2: Stats summary (cards, category doughnut, top cities). */

(function () {
  "use strict";

  let loaded = false;
  let chart = null;

  const CATEGORY_COLOR = { home: "#3d5af1", work: "#17b897", other: "#e6a23c" };

  function renderCardsSkeleton() {
    document.getElementById("stats-cards").innerHTML = App.skeletonTiles();
  }

  function renderCards(summary) {
    const el = document.getElementById("stats-cards");
    el.innerHTML = `
      <div class="stat-tile hero">
        <i class="ph ph-path stat-icon" aria-hidden="true"></i>
        <div>
          <div class="stat-value" id="stat-distance">0 km</div>
          <div class="stat-label">Total distance</div>
        </div>
      </div>
      <div class="stat-tile tile-c">
        <i class="ph ph-map-pin stat-icon" aria-hidden="true"></i>
        <div class="stat-value" id="stat-places">0</div>
        <div class="stat-label">Places visited</div>
      </div>
      <div class="stat-tile tile-d">
        <i class="ph ph-car stat-icon" aria-hidden="true"></i>
        <div class="stat-value" id="stat-trips">0</div>
        <div class="stat-label">Total trips</div>
      </div>
      <div class="stat-tile tile-e">
        <div>
          <div class="stat-value" id="stat-days">0</div>
          <div class="stat-label">Days covered</div>
        </div>
        <i class="ph ph-calendar-check stat-icon" aria-hidden="true" style="margin-bottom:0;font-size:26px;"></i>
      </div>`;

    App.countUp(document.getElementById("stat-distance"), summary.total_distance_km || 0, (v) => `${App.fmtNumber(v)} km`);
    App.countUp(document.getElementById("stat-places"), summary.total_places_visited || 0, (v) => App.fmtNumber(Math.round(v)));
    App.countUp(document.getElementById("stat-trips"), summary.total_trips || 0, (v) => App.fmtNumber(Math.round(v)));
    App.countUp(document.getElementById("stat-days"), summary.days_covered || 0, (v) => App.fmtNumber(Math.round(v)));
  }

  function renderCategoryChart(categoryMinutes) {
    const canvas = document.getElementById("category-chart");
    const entries = Object.entries(categoryMinutes || {});
    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (!entries.length) return;

    const labels = entries.map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
    const hours = entries.map(([, mins]) => Math.round((mins / 60) * 10) / 10);
    const colors = entries.map(([k]) => CATEGORY_COLOR[k] || "#9aa0b4");

    chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: hours, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.formattedValue} hrs`,
            },
          },
        },
      },
    });
  }

  function renderTopCities(cities) {
    const el = document.getElementById("top-cities-list");
    if (!cities || !cities.length) {
      el.innerHTML = '<p class="muted">No city data available yet.</p>';
      return;
    }
    const max = Math.max(...cities.map((c) => c.visits || 0), 1);
    el.innerHTML = cities
      .map(
        (c, i) => `
      <div class="ranked-row">
        <span class="rank">${i + 1}</span>
        <span class="ranked-name">${App.escapeHtml(c.name)}</span>
        <span class="bar-bg"><span class="bar-fill" style="width:${((c.visits || 0) / max) * 100}%"></span></span>
        <span class="ranked-meta">${App.fmtNumber(c.visits)} visits · ${App.fmtMinutes(c.minutes)}</span>
      </div>`
      )
      .join("");
    App.revealList(el);
  }

  async function load() {
    App.setPanelStatus("stats-status", "Loading stats…");
    renderCardsSkeleton();
    document.getElementById("top-cities-list").innerHTML = App.skeletonRows(4, 18);
    try {
      const summary = await App.apiGet("/api/stats/summary");
      App.setPanelStatus("stats-status", "");
      renderCards(summary);
      renderCategoryChart(summary.category_minutes);
      renderTopCities(summary.top_cities);
      loaded = true;
    } catch (err) {
      App.setPanelStatus("stats-status", `Error: ${err.message}`, true);
      App.showToast(`Stats failed to load: ${err.message}`, true);
      document.getElementById("stats-cards").innerHTML = "";
    }
  }

  function init() {}

  function activate() {
    if (!loaded) load();
  }

  function refresh() {
    return load();
  }

  window.Tabs.stats = { init, activate, refresh };
})();
