"""FastAPI app: mounts the /api routers and serves frontend/ as static
files at /. Local-only — see run.py / config.py, this never binds to
0.0.0.0.
"""
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend import config, db, parser
from backend.api import routes_data, routes_insights, routes_map, routes_stats, routes_timeline

log = logging.getLogger("timeline.main")

app = FastAPI(title="Personal Timeline Dashboard")

app.include_router(routes_data.router, prefix="/api")
app.include_router(routes_map.router, prefix="/api")
app.include_router(routes_stats.router, prefix="/api")
app.include_router(routes_timeline.router, prefix="/api")
app.include_router(routes_insights.router, prefix="/api")


@app.on_event("startup")
def on_startup():
    db.init_db()
    try:
        summary = parser.import_all()
        log.info(
            "startup import complete: %d visits, %d trips, %d path segments, %d skipped",
            summary["visit_count"], summary["trip_count"],
            summary["unclassified_path_count"], summary["skipped_count"],
        )
    except Exception:
        log.exception("startup import failed — server will still start; use POST /api/reload to retry")


# Serve the frontend last, so it never shadows /api routes. It's fine for
# frontend/ not to exist yet (a separate agent builds it in parallel) —
# in that case just skip the mount and rely on /docs for testing.
if config.FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
else:
    @app.get("/")
    def root():
        return {"message": "frontend/ not found yet — use /docs to explore the API."}
