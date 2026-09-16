/* insights.js — Tab 4: Insights (top places, transport modes, year in review). */

(function () {
  "use strict";

  let loaded = false;
  let transportChart = null;
  let yearsPopulated = false;

  function renderTopPlaces(places) {
    const el = document.getElementById("top-places-table");
    if (!places || !places.length) {
      el.innerHTML = '<p class="muted">No place data available.</p>';
      return;
    }
    const rows = places
      .map(
        (p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${App.escapeHtml(p.place_name || "Unknown place")}</td>
        <td>${App.escapeHtml(p.category || "")}</td>
        <td>${App.fmtNumber(p.visit_count)}</td>
        <td>${App.fmtMinutes(p.total_minutes)}</td>
      </tr>`
      )
      .join("");
    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>#</th><th>Place</th><th>Category</th><th>Visits</th><th>Total time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    App.revealList(el);
  }

  function renderTransportChart(modes) {
    const canvas = document.getElementById("transport-chart");
    if (transportChart) {
      transportChart.destroy();
      transportChart = null;
    }
    if (!modes || !modes.length) return;
    const labels = modes.map((m) => m.mode);
    const distances = modes.map((m) => Math.round((m.total_distance_km || 0) * 10) / 10);
    const palette = ["#3d5af1", "#17b897", "#e6a23c", "#e05260", "#9aa0b4", "#7c5cf0"];

    transportChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Distance (km)",
            data: distances,
            backgroundColor: labels.map((_, i) => palette[i % palette.length]),
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const m = modes[ctx.dataIndex];
                return `${m.trip_count} trips · ${App.fmtNumber(m.total_distance_km)} km`;
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "km" } },
        },
      },
    });
  }

  async function loadTopPlacesAndTransport() {
    document.getElementById("top-places-table").innerHTML = App.skeletonRows(6, 20);
    try {
      const [placesRes, modesRes] = await Promise.all([
        App.apiGet("/api/insights/top-places", { limit: 20 }),
        App.apiGet("/api/insights/transport-modes"),
      ]);
      renderTopPlaces(placesRes.places || []);
      renderTransportChart(modesRes.modes || []);
    } catch (err) {
      App.setPanelStatus("insights-status", `Error: ${err.message}`, true);
      App.showToast(`Insights failed to load: ${err.message}`, true);
    }
  }

  function renderYearReview(data) {
    const el = document.getElementById("year-review-content");
    if (!data) {
      el.innerHTML = '<p class="muted">No data for this year.</p>';
      return;
    }
    const mostActive = data.most_active_month
      ? `${new Date(data.most_active_month.year, data.most_active_month.month - 1, 1).toLocaleDateString(undefined, {
          month: "long",
        })} (${App.fmtNumber(data.most_active_month.trip_count)} trips)`
      : "—";
    const cities = data.cities_visited && data.cities_visited.length ? data.cities_visited.length : 0;

    el.innerHTML = `
      <div class="year-review-summary">
        <h2>${data.year} in Review</h2>
        <div class="yrs-sub">${App.fmtNumber(data.total_days_with_activity)} days on the move</div>
        <div class="yrs-grid">
          <div class="yrs-item"><div class="yrs-value" id="yrs-distance">0 km</div><div class="yrs-label">Total distance</div></div>
          <div class="yrs-item"><div class="yrs-value" id="yrs-cities">0</div><div class="yrs-label">Cities visited</div></div>
          <div class="yrs-item"><div class="yrs-value" id="yrs-places">0</div><div class="yrs-label">Places visited</div></div>
          <div class="yrs-item"><div class="yrs-value">${App.escapeHtml(mostActive)}</div><div class="yrs-label">Most active month</div></div>
          <div class="yrs-item"><div class="yrs-value">${App.escapeHtml(data.dominant_transport_mode || "—")}</div><div class="yrs-label">Dominant transport</div></div>
          <div class="yrs-item"><div class="yrs-value" id="yrs-trips">0</div><div class="yrs-label">Total trips</div></div>
        </div>
      </div>`;

    App.countUp(document.getElementById("yrs-distance"), data.total_distance_km || 0, (v) => `${App.fmtNumber(v)} km`);
    App.countUp(document.getElementById("yrs-cities"), cities, (v) => App.fmtNumber(Math.round(v)));
    App.countUp(document.getElementById("yrs-places"), data.total_places || 0, (v) => App.fmtNumber(Math.round(v)));
    App.countUp(document.getElementById("yrs-trips"), data.total_trips || 0, (v) => App.fmtNumber(Math.round(v)));
  }

  async function loadYearReview(year) {
    const el = document.getElementById("year-review-content");
    el.innerHTML = `<div class="skeleton skeleton-tile" style="height:180px;margin-top:14px;"></div>`;
    try {
      const data = await App.apiGet(`/api/insights/year-in-review/${year}`);
      renderYearReview(data);
    } catch (err) {
      el.innerHTML = `<p class="muted">Error: ${App.escapeHtml(err.message)}</p>`;
      App.showToast(`Year in review failed to load: ${err.message}`, true);
    }
  }

  function populateYearSelect() {
    const select = document.getElementById("year-select");
    let years = [];
    const timelineMod = window.Tabs.timeline;
    if (timelineMod && typeof timelineMod.getMonths === "function") {
      const months = timelineMod.getMonths();
      years = Array.from(new Set(months.map((m) => m.year))).sort((a, b) => b - a);
    }
    if (!years.length) {
      years = [new Date().getFullYear()];
    }
    select.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    yearsPopulated = true;
    return years[0];
  }

  async function ensureYearsAndLoad() {
    // Make sure timeline months are available for the year dropdown.
    try {
      if (!window.Tabs.timeline.getMonths().length) {
        await App.apiGet("/api/timeline/months").then((res) => {
          // Piggyback: timeline.js owns 'months' state, so just derive years locally if needed.
          window.__insightsMonthsFallback = res.months || [];
        });
      }
    } catch (err) {
      /* non-fatal */
    }
    const select = document.getElementById("year-select");
    let years = [];
    const timelineMod = window.Tabs.timeline;
    const months = (timelineMod && timelineMod.getMonths()) || window.__insightsMonthsFallback || [];
    if (months.length) {
      years = Array.from(new Set(months.map((m) => m.year))).sort((a, b) => b - a);
    } else {
      years = [new Date().getFullYear()];
    }
    select.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    yearsPopulated = true;
    await loadYearReview(years[0]);
  }

  async function load() {
    App.setPanelStatus("insights-status", "Loading insights…");
    await loadTopPlacesAndTransport();
    App.setPanelStatus("insights-status", "");
    await ensureYearsAndLoad();
    loaded = true;
  }

  function init() {
    document.getElementById("year-select").addEventListener("change", (e) => {
      loadYearReview(e.target.value);
    });
  }

  function activate() {
    if (!loaded) load();
  }

  function refresh() {
    return load();
  }

  window.Tabs.insights = { init, activate, refresh };
})();
