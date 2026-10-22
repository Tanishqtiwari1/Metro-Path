"""Pydantic request/response schemas for the public API."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ObjectiveName = Literal["time", "transfers", "distance", "stops", "balanced"]
AlgorithmName = Literal["auto", "gbfs", "bfs", "dijkstra", "astar", "csa"]
SearchAlgorithm = Literal["gbfs", "bfs", "dijkstra", "astar"]
StationId = Field(min_length=1, max_length=100, pattern=r"^[\w\-.:@ ]+$")


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class ErrorResponse(BaseModel):
    error: ErrorBody


class RoutingPrefs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin: str = StationId
    destination: str = StationId
    objective: ObjectiveName = "time"
    max_transfers: int | None = Field(None, ge=0, le=10)
    transfer_penalty_s: int | None = Field(None, ge=0, le=3600,
                                           description="Assumed time per train change (feed has no transfer data).")
    w_transfer_min: float = Field(5.0, ge=0, le=120, description="Balanced objective: minutes per change.")
    w_stop_min: float = Field(0.5, ge=0, le=30, description="Balanced objective: minutes per stop.")


class PlanRequest(RoutingPrefs):
    algorithm: AlgorithmName = "auto"
    alternatives: int = Field(0, ge=0, le=10)
    depart_date: date | None = None
    depart_time: str | None = Field(None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")
    min_transfer_s: int | None = Field(None, ge=0, le=1800)
    include_trace: bool = False
    record_history: bool = True

    @model_validator(mode="after")
    def _schedule_fields(self):
        if (self.depart_date is None) != (self.depart_time is None):
            raise ValueError("depart_date and depart_time must be given together.")
        if self.algorithm == "csa" and self.depart_date is None:
            raise ValueError("The schedule-aware algorithm needs depart_date and depart_time.")
        return self


class RunRequest(RoutingPrefs):
    algorithm: SearchAlgorithm
    trace: bool = True


class CompareRequest(RoutingPrefs):
    algorithms: list[SearchAlgorithm] = Field(default_factory=lambda: ["gbfs", "bfs", "dijkstra", "astar"],
                                              min_length=1, max_length=4)
    repeats: int = Field(10, ge=1, le=200)

    @field_validator("algorithms")
    @classmethod
    def _unique(cls, v):
        return list(dict.fromkeys(v))


class ExportRequest(PlanRequest):
    format: Literal["csv", "json"] = "json"


class StationSummary(BaseModel):
    id: str
    name: str
    lat: float | None
    lon: float | None
    lines: list[str]
    interchange: bool
    routable: bool


class StationPage(BaseModel):
    items: list[StationSummary]
    total: int
    limit: int
    offset: int


class NearbyStation(StationSummary):
    distance_m: float


class SavedRouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["favorite", "history"] = "favorite"
    origin: str = StationId
    destination: str = StationId
    params: dict[str, Any] = {}
    label: str | None = Field(None, max_length=200)

    @field_validator("params")
    @classmethod
    def _small(cls, v):
        if len(str(v)) > 2000:
            raise ValueError("params too large")
        return v


class SavedRouteOut(BaseModel):
    id: int
    kind: str
    origin_id: str
    destination_id: str
    origin_name: str
    destination_name: str
    params: dict[str, Any]
    label: str | None
    created_at: datetime
    dataset_id: int | None


class DatasetOut(BaseModel):
    id: int
    label: str
    source_kind: str
    source_url: str | None
    source_filename: str | None
    attribution: str | None
    sha256: str
    status: str
    is_active: bool
    imported_at: datetime
    activated_at: datetime | None
    feed_version: str | None
    service_start: date | None
    service_end: date | None
    timezone: str | None
    stats: dict[str, Any]


class DatasetDetail(DatasetOut):
    report: dict[str, Any]
    logs: list[dict[str, Any]]


class ActivateResponse(BaseModel):
    active: DatasetOut
