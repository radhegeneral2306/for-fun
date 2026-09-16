import datetime as dt

from fastapi import APIRouter, HTTPException

from backend import stats

router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("/months")
def get_months():
    return {"months": stats.timeline_months()}


@router.get("/month/{year}/{month}")
def get_month_days(year: int, month: int):
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")
    return {"days": stats.timeline_month_days(year, month)}


@router.get("/day/{date}")
def get_day_events(date: str):
    try:
        dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format")
    return {"date": date, "events": stats.timeline_day_events(date)}
