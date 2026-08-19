from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="PB_",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "Конструктор страниц"
    environment: Literal["local", "test", "staging", "production"] = "local"
    debug: bool = False
    api_prefix: str = "/api/v1"
    default_locale: str = Field(default="ru", min_length=2, max_length=20)
    builder_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("PB_BUILDER_ENABLED", "FEATURE_PAGE_BUILDER"),
    )
    public_renderer_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "PB_PUBLIC_RENDERER_ENABLED",
            "FEATURE_PUBLIC_RENDERER",
        ),
    )
    media_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("PB_MEDIA_ENABLED", "FEATURE_MEDIA"),
    )
    batch_publish_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "PB_BATCH_PUBLISH_ENABLED",
            "FEATURE_BATCH_PUBLISH",
        ),
    )

    database_url: str = "postgresql+asyncpg://page_builder:page_builder@postgres:5432/page_builder"
    database_echo: bool = False
    auto_create_schema: bool = False

    jwt_secret: SecretStr = SecretStr("change-me-in-production-with-at-least-32-characters")
    jwt_issuer: str = "construktor"
    access_token_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_days: int = Field(default=30, ge=1, le=365)
    cookie_secure: bool = False
    cookie_domain: str | None = None
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    trusted_hosts: list[str] = Field(default_factory=lambda: ["*"])

    redis_url: str | None = "redis://redis:6379/0"
    cache_prefix: str = "page-builder"
    public_cache_seconds: int = Field(default=300, ge=0)

    object_storage: Literal["local", "minio"] = "local"
    local_storage_path: Path = Path("./var/assets")
    public_asset_base_url: str = "/api/v1/public/assets"
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: SecretStr = SecretStr("minioadmin")
    minio_bucket: str = "page-builder"
    minio_secure: bool = False

    max_upload_bytes: int = Field(default=25 * 1024 * 1024, ge=1024)
    max_json_body_bytes: int = Field(default=2 * 1024 * 1024, ge=1024)
    edit_lock_ttl_seconds: int = Field(default=120, ge=30, le=3600)
    preview_token_minutes: int = Field(default=15, ge=1, le=1440)
    idempotency_ttl_hours: int = Field(default=24, ge=1, le=168)
    autosave_snapshot_interval_seconds: int = Field(default=300, ge=30, le=3600)
    autosave_snapshot_retention: int = Field(default=20, ge=1, le=100)
    batch_publish_max_items: int = Field(default=25, ge=1, le=100)
    rendition_widths: list[int] = Field(default_factory=lambda: [320, 640, 1024, 1600, 2048])
    image_quality: int = Field(default=85, ge=40, le=100)
    image_max_bytes: int = Field(default=512_000, ge=32_768, le=5_242_880)
    image_max_dimension: int = Field(default=2048, ge=640, le=8192)
    scheduler_enabled: bool = False
    scheduler_interval_seconds: float = Field(default=15.0, ge=1)
    worker_enabled: bool = False
    worker_interval_seconds: float = Field(default=5.0, ge=1)
    cleanup_after_days: int = Field(default=30, ge=30)
    trash_retention_days: int = Field(default=30, ge=30, le=365)

    legacy_fallback_enabled: bool = True
    public_read_fail_closed: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "PB_PUBLIC_READ_FAIL_CLOSED",
            "PUBLIC_READ_FAIL_CLOSED",
        ),
    )
    embed_allowed_hosts: list[str] = Field(
        default_factory=lambda: [
            "youtube.com",
            "www.youtube.com",
            "youtu.be",
            "player.vimeo.com",
            "vimeo.com",
            "maps.google.com",
            "www.google.com",
            "yandex.com",
            "yandex.ru",
        ]
    )
    content_security_policy: str = (
        "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; "
        "frame-src https://www.youtube.com https://player.vimeo.com "
        "https://www.google.com https://yandex.com https://yandex.ru; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    readiness_require_alembic_head: bool = True
    form_default_min_elapsed_seconds: float = Field(default=2.0, ge=0, le=60)
    form_max_elapsed_hours: int = Field(default=24, ge=1, le=168)
    webhook_allowed_hosts: list[str] = Field(default_factory=list)
    webhook_allow_http: bool = False
    webhook_timeout_seconds: float = Field(default=5.0, ge=1, le=30)
    webhook_signing_secret: SecretStr | None = None

    @field_validator("jwt_secret")
    @classmethod
    def validate_secret(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("jwt_secret должен содержать не менее 32 символов")
        return value

    @field_validator("database_url")
    @classmethod
    def normalize_postgres_scheme(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        return value

    @field_validator("cookie_domain", mode="before")
    @classmethod
    def normalize_optional_domain(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("rendition_widths")
    @classmethod
    def validate_rendition_widths(cls, value: list[int]) -> list[int]:
        widths = sorted(set(value))
        if not widths or any(width < 64 or width > 8192 for width in widths):
            raise ValueError("rendition_widths должен содержать значения от 64 до 8192")
        return widths

    @model_validator(mode="after")
    def validate_production_security(self) -> Settings:
        if self.environment != "production":
            return self
        secret = self.jwt_secret.get_secret_value().lower()
        if "change-me" in secret or "replace-" in secret:
            raise ValueError("для production требуется непустой jwt_secret без шаблонного значения")
        if not self.cookie_secure:
            raise ValueError("для production требуется cookie_secure=true")
        if "*" in self.cors_origins:
            raise ValueError("список CORS origins для production не может содержать '*'")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
