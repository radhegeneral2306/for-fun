from fastapi import APIRouter

from backend import parser, stats

router = APIRouter(tags=["data"])


@router.get("/status")
def get_status():
    return stats.build_status()


@router.post("/reload")
def reload_data():
    return parser.import_all()
