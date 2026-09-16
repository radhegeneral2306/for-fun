"""semanticSegments -> normalized Visit / Trip / PathSegment rows, plus the
import pipeline that scans data/raw/*.json, skips unchanged files (via the
files fingerprint table), and upserts parsed rows into sqlite.

Defensive by design: every segment is parsed inside its own try/except.
A malformed record is counted and skipped, never aborts the whole import.
"""
import datetime as dt
import hashlib
import json
import logging

from backend import config, geocode
from backend.db import db_cursor
from backend.models import FrequentPlace, PathSegment, Trip, Visit

log = logging.getLogger("timeline.parser")
logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")

MODE_DISPLAY = {
    "IN_PASSENGER_VEHICLE": "Driving",
    "IN_VEHICLE": "Driving",
    "MOTORCYCLING": "Motorcycling",
    "WALKING": "Walking",
    "CYCLING": "Cycling",
    "IN_BUS": "Transit",
    "IN_TRAIN": "Transit",
    "IN_SUBWAY": "Transit",
    "IN_TRAM": "Transit",
}

SEMANTIC_TYPE_CATEGORY = {
    "INFERRED_HOME": "home",
    "INFERRED_WORK": "work",
}


def mode_display_name(raw_type: str) -> str:
    return MODE_DISPLAY.get((raw_type or "").upper(), "Other")


def parse_latlng(s: str) -> tuple[float, float]:
    """'21.2130137°, 81.2934688°' -> (21.2130137, 81.2934688)"""
    lat_s, lng_s = s.split(",")
    lat = float(lat_s.strip().rstrip("°"))
    lng = float(lng_s.strip().rstrip("°"))
    return lat, lng


def parse_time(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s)


def _id_for(prefix: str, start_time: str, end_time: str) -> str:
    h = hashlib.sha1(f"{start_time}|{end_time}".encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{h}"


def _parse_visit(seg: dict) -> Visit:
    start_time = seg["startTime"]
    end_time = seg["endTime"]
    visit = seg["visit"]
    tc = visit["topCandidate"]
    lat, lng = parse_latlng(tc["placeLocation"]["latLng"])
    semantic_type = tc.get("semanticType", "UNKNOWN") or "UNKNOWN"
    category = SEMANTIC_TYPE_CATEGORY.get(semantic_type, "other")
    return Visit(
        id=_id_for("v", start_time, end_time),
        start_time=start_time,
        end_time=end_time,
        lat=lat,
        lng=lng,
        place_id=tc.get("placeId"),
        semantic_type=semantic_type,
        category=category,
        probability=float(tc.get("probability", visit.get("probability", 0.0)) or 0.0),
    )


def _parse_trip(seg: dict) -> Trip:
    start_time = seg["startTime"]
    end_time = seg["endTime"]
    activity = seg["activity"]
    start_lat, start_lng = parse_latlng(activity["start"]["latLng"])
    end_lat, end_lng = parse_latlng(activity["end"]["latLng"])
    tc = activity.get("topCandidate", {}) or {}
    mode_raw = tc.get("type", "UNKNOWN") or "UNKNOWN"
    return Trip(
        id=_id_for("t", start_time, end_time),
        start_time=start_time,
        end_time=end_time,
        start_lat=start_lat,
        start_lng=start_lng,
        end_lat=end_lat,
        end_lng=end_lng,
        distance_meters=float(activity.get("distanceMeters", 0.0) or 0.0),
        mode_raw=mode_raw,
        mode=mode_display_name(mode_raw),
        probability=float(activity.get("probability", tc.get("probability", 0.0)) or 0.0),
    )


def _parse_path(seg: dict) -> PathSegment:
    start_time = seg["startTime"]
    end_time = seg["endTime"]
    points = []
    for p in seg["timelinePath"]:
        lat, lng = parse_latlng(p["point"])
        points.append([lat, lng, p.get("time")])
    return PathSegment(
        id=_id_for("p", start_time, end_time),
        start_time=start_time,
        end_time=end_time,
        points=points,
    )


def parse_segments(segments: list) -> tuple[list[Visit], list[Trip], list[PathSegment], int]:
    """Returns (visits, trips, paths, skipped_count). Never raises — every
    per-segment failure is caught, logged, and counted."""
    visits, trips, paths = [], [], []
    skipped = 0
    for seg in segments:
        try:
            if "visit" in seg:
                visits.append(_parse_visit(seg))
            elif "activity" in seg:
                trips.append(_parse_trip(seg))
            elif "timelinePath" in seg:
                paths.append(_parse_path(seg))
            elif "timelineMemory" in seg:
                # Rare 4th shape (multi-day trip summary). Not needed for v1.
                skipped += 1
            else:
                skipped += 1
        except Exception as e:
            log.warning("skipping malformed segment: %s", e)
            skipped += 1
    return visits, trips, paths, skipped


def _parse_frequent_places(user_location_profile: dict) -> list[FrequentPlace]:
    out = []
    for fp in (user_location_profile or {}).get("frequentPlaces", []) or []:
        try:
            lat, lng = parse_latlng(fp["placeLocation"])
            out.append(FrequentPlace(place_id=fp.get("placeId"), lat=lat, lng=lng, label=fp.get("label")))
        except Exception as e:
            log.warning("skipping malformed frequentPlace: %s", e)
    return out


def _upsert_visits(cur, visits: list[Visit]):
    for v in visits:
        cur.execute(
            "INSERT INTO visits (id, start_time, end_time, lat, lng, place_id, semantic_type, category, probability) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET start_time=excluded.start_time, end_time=excluded.end_time, "
            "lat=excluded.lat, lng=excluded.lng, place_id=excluded.place_id, semantic_type=excluded.semantic_type, "
            "category=excluded.category, probability=excluded.probability",
            (v.id, v.start_time, v.end_time, v.lat, v.lng, v.place_id, v.semantic_type, v.category, v.probability),
        )


def _upsert_trips(cur, trips: list[Trip]):
    for t in trips:
        cur.execute(
            "INSERT INTO trips (id, start_time, end_time, start_lat, start_lng, end_lat, end_lng, "
            "distance_meters, mode_raw, mode, probability) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET start_time=excluded.start_time, end_time=excluded.end_time, "
            "start_lat=excluded.start_lat, start_lng=excluded.start_lng, end_lat=excluded.end_lat, "
            "end_lng=excluded.end_lng, distance_meters=excluded.distance_meters, mode_raw=excluded.mode_raw, "
            "mode=excluded.mode, probability=excluded.probability",
            (t.id, t.start_time, t.end_time, t.start_lat, t.start_lng, t.end_lat, t.end_lng,
             t.distance_meters, t.mode_raw, t.mode, t.probability),
        )


def _upsert_paths(cur, paths: list[PathSegment]):
    for p in paths:
        cur.execute(
            "INSERT INTO path_segments (id, start_time, end_time, points_json) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET start_time=excluded.start_time, end_time=excluded.end_time, "
            "points_json=excluded.points_json",
            (p.id, p.start_time, p.end_time, json.dumps(p.points)),
        )


def import_all() -> dict:
    """Scan data/raw/*.json. Reparse only files whose (size, mtime)
    fingerprint changed since last import; merge+dedupe everything else
    into sqlite. Returns the same summary shape as GET /api/status."""
    files = sorted(config.DATA_RAW_DIR.glob("*.json"))
    home = None
    work = None

    with db_cursor() as cur:
        known = {
            row["path"]: (row["size"], row["mtime"])
            for row in cur.execute("SELECT path, size, mtime FROM files").fetchall()
        }

    for path in files:
        stat = path.stat()
        fingerprint = (stat.st_size, stat.st_mtime)
        rel_path = str(path.relative_to(config.BASE_DIR))

        if known.get(rel_path) == fingerprint:
            log.info("unchanged, skipping reparse: %s", rel_path)
            continue

        log.info("parsing (new or changed): %s", rel_path)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            log.error("failed to read/parse %s: %s", rel_path, e)
            continue

        segments = data.get("semanticSegments", []) or []
        visits, trips, paths, skipped = parse_segments(segments)

        frequent_places = _parse_frequent_places(data.get("userLocationProfile", {}))
        for fp in frequent_places:
            if fp.label == "HOME":
                home = fp
            elif fp.label == "WORK":
                work = fp

        with db_cursor() as cur:
            _upsert_visits(cur, visits)
            _upsert_trips(cur, trips)
            _upsert_paths(cur, paths)
            cur.execute(
                "INSERT INTO files (path, size, mtime, segment_count, skipped_count, imported_at) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, "
                "segment_count=excluded.segment_count, skipped_count=excluded.skipped_count, "
                "imported_at=excluded.imported_at",
                (rel_path, stat.st_size, stat.st_mtime, len(segments), skipped,
                 dt.datetime.now(dt.timezone.utc).isoformat()),
            )

        log.info(
            "imported %s: %d visits, %d trips, %d paths, %d skipped",
            rel_path, len(visits), len(trips), len(paths), skipped,
        )

    if home is not None or work is not None:
        from backend.stats import set_home_work
        set_home_work(home, work)

    # Offline-geocode every distinct visit location so place_name is
    # populated without any extra step.
    with db_cursor() as cur:
        rows = cur.execute("SELECT DISTINCT lat, lng FROM visits").fetchall()
    geocode.ensure_geocoded([(row["lat"], row["lng"]) for row in rows])

    from backend.stats import build_status
    return build_status()
