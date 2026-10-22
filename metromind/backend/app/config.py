"""Application configuration, loaded from environment variables (see .env.example).

Nothing operational (stations, lines, fares, timings) lives here: only knobs that
control how the software behaves.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
                                      env_prefix="METROMIND_", extra="ignore")

    environment: str = Field("development", description="development | production | test")
    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'metromind.db'}"

    # Dataset source. The official DMRC portal requires a declaration form, so a
    # refresh URL is optional; administrators can always upload a GTFS ZIP instead.
    dataset_source_url: str | None = None
    dataset_source_label: str = "Delhi Open Transit Data (DMRC static GTFS)"
    dataset_source_attribution: str = (
        "Department of Transport, GNCTD / IIIT-Delhi - Delhi Open Transit Data, https://otd.delhi.gov.in/"
    )
    dataset_download_timeout_s: float = 120.0

    # Upload / archive safety limits.
    max_upload_mb: int = 100
    max_uncompressed_mb: int = 600
    max_compression_ratio: float = 200.0

    # Admin auth: a bearer token. Leave unset to disable admin actions entirely.
    admin_token: str | None = None

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    rate_limit_per_minute: int = 240

    # Graph construction.
    # Regex applied to route_long_name to derive the line a route variant belongs to
    # (DMRC names variants like "RED_Rithala to Dilshad Garden"). Group 1 = line name.
    # If it does not match, the route's short name (or id) is used as its own line.
    line_group_pattern: str = r"^\s*([^_]+)_"
    # Infer a display colour when the line name is a CSS colour word and the feed
    # leaves route_color blank. Marked as "inferred" in the API.
    infer_line_colors: bool = True

    # Routing assumptions (explicitly reported in every result that uses them).
    # The DMRC feed has no transfers.txt, so interchange time is unknown.
    default_transfer_penalty_s: int = 300
    default_min_transfer_s: int = 120
    max_alternatives: int = 5
    trace_max_events: int = 4000
    trace_frontier_preview: int = 8
    benchmark_max_repeats: int = 50
    search_timeout_s: float = 10.0

    auto_migrate: bool = True  # run Alembic migrations on startup
    frontend_dist: str | None = None  # serve a built frontend from this directory (single-container deploys)
    log_level: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
