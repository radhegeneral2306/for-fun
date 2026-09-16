"""Internal data shapes for parsed Timeline data.

These are plain dataclasses used between parser.py and db.py / stats.py.
API response shapes are built as plain dicts in the api/ routers, matching
the contract in api_contract.md exactly — that's intentionally not routed
through these dataclasses, to keep the on-the-wire shape obvious to read
at the call site.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Visit:
    id: str
    start_time: str  # ISO8601 string, as parsed from the export (offset preserved)
    end_time: str
    lat: float
    lng: float
    place_id: Optional[str]
    semantic_type: str  # UNKNOWN / INFERRED_HOME / INFERRED_WORK
    category: str  # home / work / other
    probability: float


@dataclass
class Trip:
    id: str
    start_time: str
    end_time: str
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    distance_meters: float
    mode_raw: str  # raw topCandidate.type, e.g. IN_PASSENGER_VEHICLE
    mode: str  # display name, e.g. "Driving"
    probability: float


@dataclass
class PathSegment:
    id: str
    start_time: str
    end_time: str
    points: list = field(default_factory=list)  # list of [lat, lng, time]


@dataclass
class FrequentPlace:
    place_id: str
    lat: float
    lng: float
    label: Optional[str]  # "HOME" / "WORK" / None
