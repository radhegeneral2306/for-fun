from typing import Optional

from fastapi import APIRouter, Query

from backend import stats

router = APIRouter(prefix="/map", tags=["map"])


@router.get("/heatmap")
def get_heatmap(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return {"points": stats.heatmap_points(start, end)}


@router.get("/visits")
def get_visits(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    return {"visits": stats.visits_in_range(start, end, category)}
