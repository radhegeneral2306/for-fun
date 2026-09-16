"""Paths, ports, and feature flags for the Timeline dashboard backend.

Everything here is read from the filesystem / environment once at import
time. There is no user-facing settings UI for v1 — flip ENABLE_ONLINE_GEOCODING
below (and restart) if you want it on.
"""
import os
from pathlib import Path

# backend/ lives directly under the repo root.
BASE_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = BASE_DIR / "data"
DATA_RAW_DIR = DATA_DIR / "raw"
DATA_CACHE_DIR = DATA_DIR / "cache"

DB_PATH = DATA_CACHE_DIR / "timeline.db"

FRONTEND_DIR = BASE_DIR / "frontend"

HOST = "127.0.0.1"  # never 0.0.0.0 — this is single-user, local-only, privacy-sensitive GPS data.
PORT = int(os.environ.get("PORT", "8000"))

# --- Geocoding ---
#
# Offline geocoding (reverse_geocoder, a bundled local city database) is
# always used by default: it's instant, needs no network access, and is
# good enough for "City, Country" labels. It has no per-lookup accuracy
# beyond city-level granularity though (e.g. it can't tell you a specific
# neighborhood/POI name, and picks the nearest city centroid which can be
# a few km off in rural areas).
#
# Online geocoding (geopy's Nominatim client, OpenStreetMap, no API key)
# gives more precise / human-friendly place names, but requires sending
# this user's exact GPS coordinates to a third-party server over the
# network — a real privacy tradeoff for what is otherwise a fully local,
# offline-capable app. It is therefore OFF by default and only ever runs
# when a human explicitly flips this flag AND calls POST /api/geocode/refresh
# — never automatically, and never on every request (rate-limited to
# ~1 req/sec per Nominatim's usage policy).
ENABLE_ONLINE_GEOCODING = False

DATA_RAW_DIR.mkdir(parents=True, exist_ok=True)
DATA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
