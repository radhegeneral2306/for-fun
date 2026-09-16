/* timeline.js — Tab 3: Timeline (month picker + calendar grid + day detail). */

(function () {
  "use strict";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let monthsLoaded = false;
  let months = []; // [{year, month, visit_count, trip_count, distance_km}]
  let selectedYear = null;
  let selectedMonth = null;
  let selectedDate = null;

  function monthKey(y, m) {
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  function monthLabel(y, m) {
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  }

  function populateMonthSelect() {
    const select = document.getElementById("month-select");
    select.innerHTML = months
      .map((m) => `<option value="${monthKey(m.year, m.month)}">${monthLabel(m.year, m.month)}</option>`)
      .join("");
  }

  async function loadMonths() {
    App.setPanelStatus("timeline-status", "Loading months…");
    document.getElementById("calendar-grid").innerHTML = App.skeletonRows(1, 320);
    try {
      const res = await App.apiGet("/api/timeline/months");
      months = (res.months || []).slice().sort((a, b) => (a.year - b.year) || (a.month - b.month));
      monthsLoaded = true;
      if (!months.length) {
        App.setPanelStatus("timeline-status", "No timeline data available.");
        document.getElementById("month-select").innerHTML = "";
        document.getElementById("calendar-grid").innerHTML = "";
        return;
      }
      App.setPanelStatus("timeline-status", "");
      populateMonthSelect();
      const last = months[months.length - 1];
      selectedYear = last.year;
      selectedMonth = last.month;
      document.getElementById("month-select").value = monthKey(selectedYear, selectedMonth);
      await loadMonthGrid();
    } catch (err) {
      App.setPanelStatus("timeline-status", `Error: ${err.message}`, true);
      App.showToast(`Timeline months failed to load: ${err.message}`, true);
    }
  }

  function renderCalendar(days) {
    const grid = document.getElementById("calendar-grid");
    const byDate = {};
    (days || []).forEach((d) => (byDate[d.date] = d));

    const firstOfMonth = new Date(selectedYear, selectedMonth - 1, 1);
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const startOffset = firstOfMonth.getDay(); // 0=Sun

    let html = WEEKDAYS.map((w) => `<div class="cal-weekday">${w}</div>`).join("");

    for (let i = 0; i < startOffset; i++) {
      html += `<div class="cal-day empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const info = byDate[dateStr];
      const hasActivity = info && ((info.visit_count || 0) > 0 || (info.trip_count || 0) > 0);
      const isSelected = dateStr === selectedDate;
      let badges = "";
      if (info && info.visit_count) badges += `<span class="cal-badge visits">${info.visit_count}v</span>`;
      if (info && info.trip_count) badges += `<span class="cal-badge trips">${info.trip_count}t</span>`;
      html += `
        <div class="cal-day ${hasActivity ? "has-activity" : ""} ${isSelected ? "selected" : ""}" data-date="${dateStr}">
          <span class="cal-daynum">${day}</span>
          <span class="cal-badges">${badges}</span>
        </div>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll(".cal-day:not(.empty)").forEach((cell) => {
      cell.addEventListener("click", () => selectDay(cell.dataset.date));
    });
  }

  async function loadMonthGrid() {
    App.setPanelStatus("timeline-status", "Loading month…");
    document.getElementById("calendar-grid").innerHTML = App.skeletonRows(1, 320);
    try {
      const res = await App.apiGet(`/api/timeline/month/${selectedYear}/${selectedMonth}`);
      App.setPanelStatus("timeline-status", "");
      renderCalendar(res.days || []);
    } catch (err) {
      App.setPanelStatus("timeline-status", `Error: ${err.message}`, true);
      App.showToast(`Month data failed to load: ${err.message}`, true);
    }
  }

  const EVENT_ICON = { visit: "ph-map-pin", trip: "ph-car" };

  function renderDayEvents(date, events) {
    const el = document.getElementById("day-detail");
    if (!events || !events.length) {
      el.innerHTML = `<h4>${App.fmtDate(date)}</h4><p class="muted">No events recorded for this day.</p>`;
      return;
    }
    const rows = events
      .map((ev) => {
        const iconClass = EVENT_ICON[ev.type] || "ph-dot";
        const time = `${App.fmtTime(ev.start_time)} – ${App.fmtTime(ev.end_time)}`;
        let title, extra;
        if (ev.type === "visit") {
          title = App.escapeHtml(ev.place_name || "Unknown place");
          const cat = ev.category ? ` · ${App.escapeHtml(ev.category)}` : "";
          extra = `${time}${cat}`;
        } else {
          title = App.escapeHtml(ev.mode || "Trip");
          const dist = ev.distance_km !== undefined ? ` · ${App.fmtNumber(ev.distance_km)} km` : "";
          extra = `${time}${dist}`;
        }
        return `
        <div class="event-item">
          <div class="event-icon"><i class="ph ${iconClass}" aria-hidden="true"></i></div>
          <div class="event-body">
            <div class="event-title">${title}</div>
            <div class="event-extra">${extra}</div>
          </div>
        </div>`;
      })
      .join("");
    el.innerHTML = `<h4>${App.fmtDate(date)}</h4>${rows}`;
    App.revealList(el);
  }

  async function selectDay(dateStr) {
    selectedDate = dateStr;
    document.querySelectorAll(".cal-day").forEach((c) => c.classList.toggle("selected", c.dataset.date === dateStr));
    const el = document.getElementById("day-detail");
    el.innerHTML = `<h4>${App.fmtDate(dateStr)}</h4>${App.skeletonRows(3, 40)}`;
    try {
      const res = await App.apiGet(`/api/timeline/day/${dateStr}`);
      renderDayEvents(dateStr, res.events || []);
    } catch (err) {
      el.innerHTML = `<h4>${App.fmtDate(dateStr)}</h4><p class="muted">Error loading day: ${App.escapeHtml(err.message)}</p>`;
      App.showToast(`Day data failed to load: ${err.message}`, true);
    }
  }

  function init() {
    document.getElementById("month-select").addEventListener("change", (e) => {
      const [y, m] = e.target.value.split("-").map(Number);
      selectedYear = y;
      selectedMonth = m;
      selectedDate = null;
      document.getElementById("day-detail").innerHTML = '<p class="muted">Select a day on the calendar to see events.</p>';
      loadMonthGrid();
    });
  }

  function activate() {
    if (!monthsLoaded) loadMonths();
  }

  function refresh() {
    monthsLoaded = false;
    return loadMonths();
  }

  window.Tabs.timeline = { init, activate, refresh, getMonths: () => months };
})();
