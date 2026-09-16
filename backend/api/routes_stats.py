from typing import Optional

from fastapi import APIRouter, Query

from backend import stats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/summary")
def get_summary(start: Optional[str] = Query(None), end: Optional[str] = Query(None)):
    return stats.stats_summary(start, end)
