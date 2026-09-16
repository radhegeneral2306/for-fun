"""Reverse geocoding: lat/lng -> "City, Country".

Offline (default): reverse_geocoder, a bundled city-level database, zero
network calls, effectively instant even for thousands of points (it does
one k-d tree lookup per batch).

Online (opt-in, see config.ENABLE_ONLINE_GEOCODING): geopy's Nominatim
client, rate-limited to ~1 req/sec per OSM's usage policy. Only ever
invoked from POST /api/geocode/refresh, never automatically.

Results are cached in the geocode_cache sqlite table, keyed by lat/lng
rounded to 2 decimal places (~1.1km grid) so that nearby points reuse a
single lookup instead of re-geocoding.
"""
import datetime as dt
import time

from backend import config
from backend.db import db_cursor

# Minimal ISO 3166-1 alpha-2 -> common English name mapping, enough to turn
# reverse_geocoder's country codes into readable names. Falls back to the
# raw code for anything not covered here.
_COUNTRY_NAMES = {
    "IN": "India", "US": "United States", "GB": "United Kingdom", "CA": "Canada",
    "AU": "Australia", "DE": "Germany", "FR": "France", "IT": "Italy", "ES": "Spain",
    "PT": "Portugal", "NL": "Netherlands", "BE": "Belgium", "CH": "Switzerland",
    "AT": "Austria", "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland",
    "IE": "Ireland", "PL": "Poland", "CZ": "Czechia", "GR": "Greece", "TR": "Turkey",
    "RU": "Russia", "UA": "Ukraine", "CN": "China", "JP": "Japan", "KR": "South Korea",
    "TW": "Taiwan", "HK": "Hong Kong", "SG": "Singapore", "MY": "Malaysia",
    "TH": "Thailand", "VN": "Vietnam", "PH": "Philippines", "ID": "Indonesia",
    "PK": "Pakistan", "BD": "Bangladesh", "LK": "Sri Lanka", "NP": "Nepal",
    "AE": "United Arab Emirates", "SA": "Saudi Arabia", "QA": "Qatar",
    "IL": "Israel", "EG": "Egypt", "ZA": "South Africa", "NG": "Nigeria",
    "KE": "Kenya", "BR": "Brazil", "AR": "Argentina", "MX": "Mexico",
    "CL": "Chile", "CO": "Colombia", "PE": "Peru", "NZ": "New Zealand",
    "HU": "Hungary", "RO": "Romania", "BG": "Bulgaria", "HR": "Croatia",
    "RS": "Serbia", "SK": "Slovakia", "SI": "Slovenia", "IS": "Iceland",
    "LU": "Luxembourg", "MT": "Malta", "CY": "Cyprus", "EE": "Estonia",
    "LV": "Latvia", "LT": "Lithuania",
}


def country_name(cc: str) -> str:
    if not cc:
        return "Unknown"
    return _COUNTRY_NAMES.get(cc.upper(), cc.upper())


def _round_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)},{round(lng, 2)}"


_rg_module = None


def _get_rg():
    """Lazy-import + first-call caching wrapper around reverse_geocoder.
    Its underlying city database (~30MB) is loaded into process memory on
    first use and reused after that."""
    global _rg_module
    if _rg_module is None:
        import reverse_geocoder as rg
        _rg_module = rg
    return _rg_module


def offline_lookup_batch(coords: list[tuple[float, float]]) -> dict[tuple[float, float], str]:
    """Reverse-geocode a batch of (lat, lng) pairs offline. Returns a dict
    mapping the *input* coordinate tuples to "City, Country" strings."""
    if not coords:
        return {}
    try:
        rg = _get_rg()
        results = rg.search(coords, mode=1)
    except Exception:
        return {}
    out = {}
    for (lat, lng), res in zip(coords, results):
        name = res.get("name") or "Unknown place"
        cc = res.get("cc", "")
        out[(lat, lng)] = f"{name}, {country_name(cc)}"
    return out


def ensure_geocoded(coords: list[tuple[float, float]]):
    """Given a list of (lat, lng), offline-geocode any that aren't already
    cached (by rounded key) and write them into geocode_cache."""
    with db_cursor() as cur:
        existing_keys = {
            row["key"] for row in cur.execute("SELECT key FROM geocode_cache").fetchall()
        }

    to_lookup = {}
    for lat, lng in coords:
        key = _round_key(lat, lng)
        if key not in existing_keys and key not in to_lookup:
            to_lookup[key] = (lat, lng)

    if not to_lookup:
        return

    resolved = offline_lookup_batch(list(to_lookup.values()))
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with db_cursor() as cur:
        for key, coord in to_lookup.items():
            name = resolved.get(coord, "Unknown place")
            cur.execute(
                "INSERT INTO geocode_cache (key, place_name, source, updated_at) VALUES (?, ?, 'offline', ?) "
                "ON CONFLICT(key) DO NOTHING",
                (key, name, now),
            )


def get_place_name(lat: float, lng: float) -> str:
    key = _round_key(lat, lng)
    with db_cursor() as cur:
        row = cur.execute("SELECT place_name FROM geocode_cache WHERE key = ?", (key,)).fetchone()
    return row["place_name"] if row else "Unknown place"


def geocode_status() -> dict:
    with db_cursor() as cur:
        distinct_points = cur.execute(
            "SELECT DISTINCT ROUND(lat, 2) AS r_lat, ROUND(lng, 2) AS r_lng FROM visits"
        ).fetchall()
        geocoded = cur.execute("SELECT COUNT(*) AS c FROM geocode_cache").fetchone()["c"]
    total = len(distinct_points)
    pending = max(total - geocoded, 0)
    return {
        "online_enabled": config.ENABLE_ONLINE_GEOCODING,
        "total_places": total,
        "geocoded": min(geocoded, total) if total else geocoded,
        "pending": pending,
    }


def online_refresh() -> dict:
    """Re-geocode every currently-cached place via Nominatim (OpenStreetMap),
    rate-limited to ~1 req/sec. Only called from POST /api/geocode/refresh,
    and only does anything when ENABLE_ONLINE_GEOCODING is True."""
    if not config.ENABLE_ONLINE_GEOCODING:
        return {"message": "Online geocoding is disabled (config.ENABLE_ONLINE_GEOCODING is False)."}

    from geopy.geocoders import Nominatim
    from geopy.extra.rate_limiter import RateLimiter

    geolocator = Nominatim(user_agent="personal-timeline-dashboard")
    reverse = RateLimiter(geolocator.reverse, min_delay_seconds=1.0)

    with db_cursor() as cur:
        rows = cur.execute("SELECT key, place_name FROM geocode_cache WHERE source = 'offline'").fetchall()

    updated = 0
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for row in rows:
        lat_s, lng_s = row["key"].split(",")
        try:
            loc = reverse((float(lat_s), float(lng_s)), language="en")
            if loc and loc.raw.get("address"):
                addr = loc.raw["address"]
                city = (
                    addr.get("city") or addr.get("town") or addr.get("village")
                    or addr.get("county") or addr.get("state") or "Unknown place"
                )
                country = addr.get("country", "")
                name = f"{city}, {country}" if country else city
                with db_cursor() as cur2:
                    cur2.execute(
                        "UPDATE geocode_cache SET place_name = ?, source = 'online', updated_at = ? WHERE key = ?",
                        (name, now, row["key"]),
                    )
                updated += 1
        except Exception:
            continue
        time.sleep(0)  # RateLimiter already enforces the delay

    return {"message": f"Online geocoding refresh complete: {updated} place(s) updated.", "updated": updated}
