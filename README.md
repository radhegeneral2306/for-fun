# Timeline Dashboard

A local, personal dashboard for your Google Maps Timeline (location history) data. It runs entirely on your own computer — your location data never leaves your machine (map tiles and, if you turn it on, optional place-name lookups are the only things that touch the internet; see Privacy below).

## Quick Start

1. **Install Python 3.11 or newer** if you don't already have it (check with `python3 --version`).
2. **Open a terminal in this folder** and set up a virtual environment:
   ```
   python3 -m venv .venv
   source .venv/bin/activate        # on Windows: .venv\Scripts\activate
   ```
3. **Install dependencies:**
   ```
   pip install -r requirements.txt
   ```
   If the `reverse_geocoder` package fails to install with a build error, run `pip install "setuptools<60"` first, then retry — this is a known issue with that package on newer Python/setuptools versions.
4. **Export your Timeline data** from your phone: `Settings > Location > Location Services > Timeline > Export Timeline Data`. This gives you a `.json` file.
5. **Drop the exported file** into the `data/raw/` folder in this project.
6. **Run the app:**
   ```
   python run.py
   ```
   This starts a local server and opens your browser to `http://127.0.0.1:8000` automatically.

## Getting fresh data later

Re-export from your phone anytime, drop the new file into `data/raw/`, and click **Refresh Data** in the app's header. Old and new files are merged and de-duplicated automatically.

## Stopping the app

Press `Ctrl+C` in the terminal where it's running.

## Troubleshooting

- **"Address already in use" / port 8000 taken**: run with a different port: `PORT=8001 python run.py` (on Windows: `set PORT=8001 && python run.py`).
- **"python: command not found"**: try `python3 run.py` instead of `python run.py`.
- **Map/dashboard is empty**: make sure you've dropped a `.json` export into `data/raw/`, then click **Refresh Data**.
- **Map tiles or icons don't load**: this app loads its map (MapLibre GL JS/OpenFreeMap), charts (Chart.js), and icons (Phosphor) from free CDNs, so it needs normal internet access even though your data stays local.

## Privacy

- The server only binds to `127.0.0.1` (your own machine) — it's never reachable from your network or the internet.
- Place names are resolved **offline** by default (a local city database, no data sent anywhere).
- An optional, off-by-default setting (`ENABLE_ONLINE_GEOCODING` in `backend/config.py`) can use the free OpenStreetMap Nominatim service for more precise place names — turning it on does send coordinates to that external service. Leave it off unless you want that.
