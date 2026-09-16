from typing import Optional

from fastapi import APIRouter, Query

from backend import geocode, stats

router = APIRouter(tags=["insights"])


@router.get("/insights/top-places")
def get_top_places(limit: int = Query(20, ge=1, le=500)):
    return {"places": stats.top_places(limit)}


@router.get("/insights/transport-modes")
def get_transport_modes(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return {"modes": stats.transport_modes(start, end)}


@router.get("/insights/year-in-review/{year}")
def get_year_in_review(year: int):
    return stats.year_in_review(year)


@router.get("/geocode/status")
def get_geocode_status():
    return geocode.geocode_status()


@router.post("/geocode/refresh")
def post_geocode_refresh():
    return geocode.online_refresh()
