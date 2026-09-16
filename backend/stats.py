"""Aggregations over the parsed visits / trips / path_segments tables.

Date filters (`start`, `end`) are plain "YYYY-MM-DD" strings, inclusive,
and compared against the calendar date embedded in each row's start_time
(the first 10 characters of the ISO8601 string, i.e. the date in whatever
local offset the export recorded — Timeline exports are single-timezone-ish
in practice, and this avoids any surprise UTC-shifting of local days).
Omitting a bound means "unbounded" on that side.
"""
import datetime as dt
import json
from collections import defaultdict
from typing import Optional

from backend import geocode
from backend.db import db_cursor, get_meta, set_meta
from backend.models import FrequentPlace


def _date_of(iso_str: str) -> str:
    return iso_str[:10]


def _range_clause(column: str, start: Optional[str], end: Optional[str]) -> tuple[str, list]:
    clauses, params = [], []
    if start:
        clauses.append(f"substr({column}, 1, 10) >= ?")
        params.append(start)
    if end:
        clauses.append(f"substr({column}, 1, 10) <= ?")
        params.append(end)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


# --- home / work -----------------------------------------------------------

def set_home_work(home: Optional[FrequentPlace], work: Optional[FrequentPlace]):
    if home is not None:
        set_meta("home", json.dumps({"lat": home.lat, "lng": home.lng, "place_id": home.place_id}))
    if work is not None:
        set_meta("work", json.dumps({"lat": work.lat, "lng": work.lng, "place_id": work.place_id}))


def get_home_work() -> tuple[Optional[dict], Optional[dict]]:
    home_raw = get_meta("home")
    work_raw = get_meta("work")
    home = json.loads(home_raw) if home_raw else None
    work = json.loads(work_raw) if work_raw else None
    return home, work


# --- status / reload ---------------------------------------------------------

def build_status() -> dict:
    with db_cursor() as cur:
        files = [row["path"] for row in cur.execute("SELECT path FROM files ORDER BY path").fetchall()]
        segment_count = cur.execute("SELECT COALESCE(SUM(segment_count), 0) AS c FROM files").fetchone()["c"]
        skipped_count = cur.execute("SELECT COALESCE(SUM(skipped_count), 0) AS c FROM files").fetchone()["c"]
        visit_count = cur.execute("SELECT COUNT(*) AS c FROM visits").fetchone()["c"]
        trip_count = cur.execute("SELECT COUNT(*) AS c FROM trips").fetchone()["c"]
        path_count = cur.execute("SELECT COUNT(*) AS c FROM path_segments").fetchone()["c"]

        mins = []
        maxs = []
        for table in ("visits", "trips", "path_segments"):
            row = cur.execute(f"SELECT MIN(start_time) AS mn, MAX(end_time) AS mx FROM {table}").fetchone()
            if row["mn"]:
                mins.append(row["mn"])
            if row["mx"]:
                maxs.append(row["mx"])

    date_range = None
    if mins and maxs:
        date_range = {"start": min(mins), "end": max(maxs)}

    home, work = get_home_work()

    return {
        "loaded": segment_count > 0,
        "files": files,
        "segment_count": segment_count,
        "visit_count": visit_count,
        "trip_count": trip_count,
        "unclassified_path_count": path_count,
        "skipped_count": skipped_count,
        "date_range": date_range,
        "home": home,
        "work": work,
    }


# --- map ---------------------------------------------------------------------

def heatmap_points(start: Optional[str], end: Optional[str]) -> list:
    points = []

    where, params = _range_clause("start_time", start, end)
    with db_cursor() as cur:
        visit_rows = cur.execute(
            f"SELECT lat, lng, start_time, end_time FROM visits{where}", params
        ).fetchall()
        path_rows = cur.execute(
            f"SELECT points_json FROM path_segments{where}", params
        ).fetchall()
        trip_rows = cur.execute(
            f"SELECT start_lat, start_lng, end_lat, end_lng FROM trips{where}", params
        ).fetchall()

    durations = []
    for row in visit_rows:
        try:
            s = dt.datetime.fromisoformat(row["start_time"])
            e = dt.datetime.fromisoformat(row["end_time"])
            durations.append(max((e - s).total_seconds() / 60.0, 0.0))
        except Exception:
            durations.append(0.0)
    max_duration = max(durations) if durations else 1.0
    max_duration = max_duration or 1.0

    for row, duration in zip(visit_rows, durations):
        weight = round(duration / max_duration, 4) if max_duration else 0.0
        points.append([row["lat"], row["lng"], weight])

    for row in trip_rows:
        points.append([row["start_lat"], row["start_lng"], 1])
        points.append([row["end_lat"], row["end_lng"], 1])

    for row in path_rows:
        for pt in json.loads(row["points_json"]):
            points.append([pt[0], pt[1], 1])

    return points


def visits_in_range(start: Optional[str], end: Optional[str], category: Optional[str]) -> list:
    where, params = _range_clause("start_time", start, end)
    if category:
        where = where + (" AND " if where else " WHERE ") + "category = ?"
        params = params + [category]

    with db_cursor() as cur:
        rows = cur.execute(
            f"SELECT id, lat, lng, category, start_time, end_time FROM visits{where} ORDER BY start_time",
            params,
        ).fetchall()

    out = []
    for row in rows:
        try:
            s = dt.datetime.fromisoformat(row["start_time"])
            e = dt.datetime.fromisoformat(row["end_time"])
            duration_minutes = round(max((e - s).total_seconds() / 60.0, 0.0))
        except Exception:
            duration_minutes = 0
        out.append({
            "id": row["id"],
            "lat": row["lat"],
            "lng": row["lng"],
            "place_name": geocode.get_place_name(row["lat"], row["lng"]),
            "category": row["category"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "duration_minutes": duration_minutes,
        })
    return out


# --- stats summary -------------------------------------------------------------

def stats_summary(start: Optional[str], end: Optional[str]) -> dict:
    v_where, v_params = _range_clause("start_time", start, end)
    t_where, t_params = _range_clause("start_time", start, end)
    p_where, p_params = _range_clause("start_time", start, end)

    with db_cursor() as cur:
        visits = cur.execute(
            f"SELECT lat, lng, category, start_time, end_time FROM visits{v_where}", v_params
        ).fetchall()
        trips = cur.execute(
            f"SELECT distance_meters, start_time FROM trips{t_where}", t_params
        ).fetchall()
        paths = cur.execute(f"SELECT start_time FROM path_segments{p_where}", p_params).fetchall()

    total_distance_km = round(sum(t["distance_meters"] for t in trips) / 1000.0, 1)
    total_trips = len(trips)

    distinct_places = {(round(v["lat"], 4), round(v["lng"], 4)) for v in visits}
    total_places_visited = len(distinct_places)

    category_minutes = {"home": 0, "work": 0, "other": 0}
    city_agg = defaultdict(lambda: {"visits": 0, "minutes": 0})
    for v in visits:
        try:
            s = dt.datetime.fromisoformat(v["start_time"])
            e = dt.datetime.fromisoformat(v["end_time"])
            minutes = round(max((e - s).total_seconds() / 60.0, 0.0))
        except Exception:
            minutes = 0
        category_minutes[v["category"]] = category_minutes.get(v["category"], 0) + minutes
        place_name = geocode.get_place_name(v["lat"], v["lng"])
        city_agg[place_name]["visits"] += 1
        city_agg[place_name]["minutes"] += minutes

    top_cities = sorted(
        ({"name": name, **agg} for name, agg in city_agg.items()),
        key=lambda c: (-c["visits"], -c["minutes"]),
    )[:10]

    all_dates = [_date_of(v["start_time"]) for v in visits] + \
                [_date_of(t["start_time"]) for t in trips] + \
                [_date_of(p["start_time"]) for p in paths]
    days_covered = 0
    if all_dates:
        d_min = dt.date.fromisoformat(min(all_dates))
        d_max = dt.date.fromisoformat(max(all_dates))
        days_covered = (d_max - d_min).days + 1

    return {
        "total_distance_km": total_distance_km,
        "total_places_visited": total_places_visited,
        "total_trips": total_trips,
        "days_covered": days_covered,
        "category_minutes": category_minutes,
        "top_cities": top_cities,
    }


# --- timeline ------------------------------------------------------------------

def timeline_months() -> list:
    with db_cursor() as cur:
        visits = cur.execute("SELECT start_time FROM visits").fetchall()
        trips = cur.execute("SELECT start_time, distance_meters FROM trips").fetchall()

    agg = defaultdict(lambda: {"visit_count": 0, "trip_count": 0, "distance_km": 0.0})
    for v in visits:
        key = v["start_time"][:7]
        agg[key]["visit_count"] += 1
    for t in trips:
        key = t["start_time"][:7]
        agg[key]["trip_count"] += 1
        agg[key]["distance_km"] += t["distance_meters"] / 1000.0

    months = []
    for key in sorted(agg.keys()):
        year, month = key.split("-")
        entry = agg[key]
        months.append({
            "year": int(year),
            "month": int(month),
            "visit_count": entry["visit_count"],
            "trip_count": entry["trip_count"],
            "distance_km": round(entry["distance_km"], 1),
        })
    return months


def timeline_month_days(year: int, month: int) -> list:
    prefix = f"{year:04d}-{month:02d}"
    with db_cursor() as cur:
        visits = cur.execute(
            "SELECT start_time FROM visits WHERE substr(start_time, 1, 7) = ?", (prefix,)
        ).fetchall()
        trips = cur.execute(
            "SELECT start_time, distance_meters FROM trips WHERE substr(start_time, 1, 7) = ?", (prefix,)
        ).fetchall()

    agg = defaultdict(lambda: {"visit_count": 0, "trip_count": 0, "distance_km": 0.0})
    for v in visits:
        agg[_date_of(v["start_time"])]["visit_count"] += 1
    for t in trips:
        d = _date_of(t["start_time"])
        agg[d]["trip_count"] += 1
        agg[d]["distance_km"] += t["distance_meters"] / 1000.0

    days = []
    for date_str in sorted(agg.keys()):
        entry = agg[date_str]
        days.append({
            "date": date_str,
            "visit_count": entry["visit_count"],
            "trip_count": entry["trip_count"],
            "distance_km": round(entry["distance_km"], 1),
        })
    return days


def timeline_day_events(date_str: str) -> list:
    with db_cursor() as cur:
        visits = cur.execute(
            "SELECT * FROM visits WHERE substr(start_time, 1, 10) = ?", (date_str,)
        ).fetchall()
        trips = cur.execute(
            "SELECT * FROM trips WHERE substr(start_time, 1, 10) = ?", (date_str,)
        ).fetchall()

    events = []
    for v in visits:
        events.append({
            "type": "visit",
            "start_time": v["start_time"],
            "end_time": v["end_time"],
            "place_name": geocode.get_place_name(v["lat"], v["lng"]),
            "category": v["category"],
            "lat": v["lat"],
            "lng": v["lng"],
        })
    for t in trips:
        events.append({
            "type": "trip",
            "start_time": t["start_time"],
            "end_time": t["end_time"],
            "mode": t["mode"],
            "distance_km": round(t["distance_meters"] / 1000.0, 1),
            "path": [[t["start_lat"], t["start_lng"]], [t["end_lat"], t["end_lng"]]],
        })

    events.sort(key=lambda e: e["start_time"])
    return events


# --- insights --------------------------------------------------------------

def top_places(limit: int) -> list:
    with db_cursor() as cur:
        visits = cur.execute("SELECT lat, lng, category, start_time, end_time FROM visits").fetchall()

    agg = defaultdict(lambda: {"lat": 0.0, "lng": 0.0, "visit_count": 0, "total_minutes": 0, "categories": defaultdict(int)})
    for v in visits:
        key = (round(v["lat"], 4), round(v["lng"], 4))
        entry = agg[key]
        entry["lat"] = v["lat"]
        entry["lng"] = v["lng"]
        entry["visit_count"] += 1
        try:
            s = dt.datetime.fromisoformat(v["start_time"])
            e = dt.datetime.fromisoformat(v["end_time"])
            entry["total_minutes"] += round(max((e - s).total_seconds() / 60.0, 0.0))
        except Exception:
            pass
        entry["categories"][v["category"]] += 1

    places = []
    for entry in agg.values():
        category = max(entry["categories"].items(), key=lambda kv: kv[1])[0]
        places.append({
            "place_name": geocode.get_place_name(entry["lat"], entry["lng"]),
            "lat": entry["lat"],
            "lng": entry["lng"],
            "visit_count": entry["visit_count"],
            "total_minutes": entry["total_minutes"],
            "category": category,
        })

    places.sort(key=lambda p: -p["visit_count"])
    return places[:limit]


def transport_modes(start: Optional[str], end: Optional[str]) -> list:
    where, params = _range_clause("start_time", start, end)
    with db_cursor() as cur:
        trips = cur.execute(f"SELECT mode, distance_meters, start_time, end_time FROM trips{where}", params).fetchall()

    agg = defaultdict(lambda: {"trip_count": 0, "total_distance_km": 0.0, "total_minutes": 0})
    for t in trips:
        entry = agg[t["mode"]]
        entry["trip_count"] += 1
        entry["total_distance_km"] += t["distance_meters"] / 1000.0
        try:
            s = dt.datetime.fromisoformat(t["start_time"])
            e = dt.datetime.fromisoformat(t["end_time"])
            entry["total_minutes"] += round(max((e - s).total_seconds() / 60.0, 0.0))
        except Exception:
            pass

    modes = [
        {
            "mode": mode,
            "trip_count": entry["trip_count"],
            "total_distance_km": round(entry["total_distance_km"], 1),
            "total_minutes": entry["total_minutes"],
        }
        for mode, entry in agg.items()
    ]
    modes.sort(key=lambda m: -m["trip_count"])
    return modes


def year_in_review(year: int) -> dict:
    prefix = f"{year:04d}"
    with db_cursor() as cur:
        visits = cur.execute(
            "SELECT lat, lng, start_time FROM visits WHERE substr(start_time, 1, 4) = ?", (prefix,)
        ).fetchall()
        trips = cur.execute(
            "SELECT mode, distance_meters, start_time FROM trips WHERE substr(start_time, 1, 4) = ?", (prefix,)
        ).fetchall()
        paths = cur.execute(
            "SELECT start_time FROM path_segments WHERE substr(start_time, 1, 4) = ?", (prefix,)
        ).fetchall()

    total_distance_km = round(sum(t["distance_meters"] for t in trips) / 1000.0, 1)

    distinct_places = {(round(v["lat"], 4), round(v["lng"], 4)) for v in visits}
    total_places = len(distinct_places)

    cities = sorted({geocode.get_place_name(v["lat"], v["lng"]) for v in visits})

    month_trip_counts = defaultdict(int)
    for t in trips:
        month_trip_counts[int(t["start_time"][5:7])] += 1
    most_active_month = None
    if month_trip_counts:
        m = max(month_trip_counts.items(), key=lambda kv: kv[1])
        most_active_month = {"year": year, "month": m[0], "trip_count": m[1]}

    mode_counts = defaultdict(int)
    for t in trips:
        mode_counts[t["mode"]] += 1
    dominant_transport_mode = max(mode_counts.items(), key=lambda kv: kv[1])[0] if mode_counts else None

    active_dates = {_date_of(v["start_time"]) for v in visits} | \
                   {_date_of(t["start_time"]) for t in trips} | \
                   {_date_of(p["start_time"]) for p in paths}

    return {
        "year": year,
        "total_distance_km": total_distance_km,
        "total_places": total_places,
        "cities_visited": cities,
        "most_active_month": most_active_month,
        "dominant_transport_mode": dominant_transport_mode,
        "total_trips": len(trips),
        "total_days_with_activity": len(active_dates),
    }
