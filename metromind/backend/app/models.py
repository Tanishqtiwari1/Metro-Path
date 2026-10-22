"""Normalized persistence schema.

Every GTFS entity is scoped to a ``DatasetVersion`` so a new import never touches the
active dataset until it has validated and been committed; rollback just re-points the
``is_active`` flag. Source identifiers (stop_id, route_id, ...) are kept verbatim.
"""

from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(200))
    source_kind: Mapped[str] = mapped_column(String(20))  # "url" | "upload" | "file"
    source_url: Mapped[str | None] = mapped_column(Text)
    source_filename: Mapped[str | None] = mapped_column(String(255))
    attribution: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|valid|failed
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    feed_version: Mapped[str | None] = mapped_column(String(100))
    service_start: Mapped[date | None] = mapped_column(Date)
    service_end: Mapped[date | None] = mapped_column(Date)
    timezone: Mapped[str | None] = mapped_column(String(64))
    report: Mapped[dict] = mapped_column(JSON, default=dict)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)

    logs: Mapped[list["ImportLog"]] = relationship(back_populates="dataset", cascade="all, delete-orphan",
                                                   order_by="ImportLog.id")


class ImportLog(Base):
    __tablename__ = "import_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("dataset_versions.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    level: Mapped[str] = mapped_column(String(10))
    message: Mapped[str] = mapped_column(Text)

    dataset: Mapped[DatasetVersion] = relationship(back_populates="logs")


class _Scoped:
    """Mixin: rows belong to one dataset version."""

    id: Mapped[int] = mapped_column(primary_key=True)

    @classmethod
    def _dataset_fk(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("dataset_versions.id", ondelete="CASCADE"), index=True)


class Agency(Base, _Scoped):
    __tablename__ = "agencies"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    agency_id: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str | None] = mapped_column(String(64))
    __table_args__ = (UniqueConstraint("dataset_id", "agency_id"),)


class Stop(Base, _Scoped):
    __tablename__ = "stops"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    stop_id: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(255))
    name_normalized: Mapped[str] = mapped_column(String(255), index=True)
    code: Mapped[str | None] = mapped_column(String(100))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    location_type: Mapped[int] = mapped_column(Integer, default=0)
    parent_station: Mapped[str | None] = mapped_column(String(100))
    wheelchair_boarding: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("dataset_id", "stop_id"),
                      Index("ix_stops_dataset_name", "dataset_id", "name_normalized"))


class Route(Base, _Scoped):
    __tablename__ = "routes"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    route_id: Mapped[str] = mapped_column(String(100))
    agency_id: Mapped[str | None] = mapped_column(String(100))
    short_name: Mapped[str | None] = mapped_column(String(255))
    long_name: Mapped[str | None] = mapped_column(String(500))
    route_type: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str | None] = mapped_column(String(6))
    text_color: Mapped[str | None] = mapped_column(String(6))
    __table_args__ = (UniqueConstraint("dataset_id", "route_id"),)


class Trip(Base, _Scoped):
    __tablename__ = "trips"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    trip_id: Mapped[str] = mapped_column(String(100))
    route_id: Mapped[str] = mapped_column(String(100))
    service_id: Mapped[str] = mapped_column(String(100))
    headsign: Mapped[str | None] = mapped_column(String(255))
    direction_id: Mapped[int | None] = mapped_column(Integer)
    shape_id: Mapped[str | None] = mapped_column(String(100))
    __table_args__ = (UniqueConstraint("dataset_id", "trip_id"),
                      Index("ix_trips_dataset_route", "dataset_id", "route_id"))


class StopTime(Base, _Scoped):
    __tablename__ = "stop_times"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    trip_id: Mapped[str] = mapped_column(String(100))
    stop_id: Mapped[str] = mapped_column(String(100))
    stop_sequence: Mapped[int] = mapped_column(Integer)
    # Seconds after midnight of the service day; may exceed 86400 (GTFS allows 25:13:01).
    arrival_s: Mapped[int | None] = mapped_column(Integer)
    departure_s: Mapped[int | None] = mapped_column(Integer)
    shape_dist_traveled: Mapped[float | None] = mapped_column(Float)
    __table_args__ = (Index("ix_stop_times_dataset_trip", "dataset_id", "trip_id", "stop_sequence"),)


class Calendar(Base, _Scoped):
    __tablename__ = "calendars"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    service_id: Mapped[str] = mapped_column(String(100))
    days: Mapped[str] = mapped_column(String(7))  # "1111100" Mon..Sun
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    __table_args__ = (UniqueConstraint("dataset_id", "service_id"),)


class CalendarDate(Base, _Scoped):
    __tablename__ = "calendar_dates"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    service_id: Mapped[str] = mapped_column(String(100))
    date: Mapped[date] = mapped_column(Date)
    exception_type: Mapped[int] = mapped_column(Integer)  # 1 added, 2 removed


class Transfer(Base, _Scoped):
    __tablename__ = "transfers"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    from_stop_id: Mapped[str] = mapped_column(String(100))
    to_stop_id: Mapped[str] = mapped_column(String(100))
    transfer_type: Mapped[int] = mapped_column(Integer, default=0)
    min_transfer_time: Mapped[int | None] = mapped_column(Integer)


class ShapePoint(Base, _Scoped):
    __tablename__ = "shape_points"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    shape_id: Mapped[str] = mapped_column(String(100))
    sequence: Mapped[int] = mapped_column(Integer)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    dist_traveled: Mapped[float | None] = mapped_column(Float)
    __table_args__ = (Index("ix_shape_points_dataset_shape", "dataset_id", "shape_id", "sequence"),)


class FareAttribute(Base, _Scoped):
    __tablename__ = "fare_attributes"
    dataset_id: Mapped[int] = _Scoped._dataset_fk()
    fare_id: Mapped[str] = mapped_column(String(100))
    price: Mapped[float] = mapped_column(Float)
    currency_type: Mapped[str] = mapped_column(String(3))


class SavedRoute(Base):
    """Favourites and history are keyed by an anonymous client id (no accounts)."""

    __tablename__ = "saved_routes"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)  # "favorite" | "history"
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("dataset_versions.id", ondelete="SET NULL"))
    origin_id: Mapped[str] = mapped_column(String(100))
    destination_id: Mapped[str] = mapped_column(String(100))
    origin_name: Mapped[str] = mapped_column(String(255))
    destination_name: Mapped[str] = mapped_column(String(255))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    label: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
