from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from sqlalchemy import text

from app.cache import ResilientCache
from app.config import Settings, get_settings
from app.db import Database
from app.errors import error_payload, register_error_handlers
from app.importer import LegacyImporter, NullLegacyImporter
from app.jobs import JobRunner
from app.routes import admin, assets, auth, content, legacy, pages, public
from app.schema_version import ALEMBIC_HEAD
from app.storage import ResilientObjectStorage
from app.webhooks import WebhookDispatcher
from app.worker import BackgroundWorker

logger = logging.getLogger(__name__)

REQUESTS = Counter(
    "page_builder_http_requests_total",
    "HTTP requests processed",
    ("method", "path", "status"),
)
REQUEST_LATENCY = Histogram(
    "page_builder_http_request_duration_seconds",
    "HTTP request latency",
    ("method", "path"),
)
READINESS = Gauge(
    "page_builder_ready",
    "Whether the application database is ready",
)


def create_app(
    settings: Settings | None = None,
    *,
    legacy_importer: LegacyImporter | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    database = Database(settings)
    cache = ResilientCache(settings)
    storage = ResilientObjectStorage(settings)
    webhooks = WebhookDispatcher(settings)
    jobs = JobRunner(database, cache, settings)
    worker = BackgroundWorker(database, storage, settings, webhooks)
    importer = legacy_importer or NullLegacyImporter()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.database = database
        app.state.cache = cache
        app.state.storage = storage
        app.state.jobs = jobs
        app.state.worker = worker
        app.state.webhooks = webhooks
        app.state.legacy_importer = importer
        app.state.legacy_adapter_available = legacy_importer is not None
        if settings.auto_create_schema:
            await database.create_all()
        await cache.initialize()
        await storage.initialize()
        if settings.scheduler_enabled:
            await jobs.start()
        if settings.worker_enabled:
            await worker.start()
        try:
            yield
        finally:
            await worker.stop()
            await jobs.stop()
            await cache.close()
            await database.dispose()

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        debug=settings.debug,
        lifespan=lifespan,
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.database = database
    app.state.cache = cache
    app.state.storage = storage
    app.state.jobs = jobs
    app.state.worker = worker
    app.state.webhooks = webhooks
    app.state.legacy_importer = importer
    app.state.legacy_adapter_available = legacy_importer is not None

    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "If-Match",
            "If-None-Match",
            "X-CSRF-Token",
        ],
        expose_headers=["ETag", "Idempotent-Replayed", "X-Request-ID"],
    )

    @app.middleware("http")
    async def observe_requests(request: Request, call_next: object) -> Response:
        started = time.perf_counter()
        request_id = request.headers.get("X-Request-ID", "")
        if not request_id or len(request_id) > 100:
            request_id = str(uuid4())
        request.state.request_id = request_id
        api_path = request.url.path
        public_paths = (
            f"{settings.api_prefix}/auth",
            f"{settings.api_prefix}/public",
            f"{settings.api_prefix}/sitemap.xml",
            f"{settings.api_prefix}/docs",
            f"{settings.api_prefix}/openapi.json",
        )
        if (
            request.method != "OPTIONS"
            and not settings.builder_enabled
            and api_path.startswith(settings.api_prefix)
            and not api_path.startswith(public_paths)
        ):
            REQUESTS.labels(request.method, "feature_disabled", "503").inc()
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content=error_payload(
                    "builder_disabled",
                    "Административная часть конструктора страниц отключена",
                ),
                headers={"X-Request-ID": request_id},
            )
        content_type = request.headers.get("Content-Type", "").lower()
        content_length = request.headers.get("Content-Length")
        if content_type.startswith("application/json") and content_length:
            try:
                oversized = int(content_length) > settings.max_json_body_bytes
            except ValueError:
                oversized = True
            if oversized:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content=error_payload(
                        "request_too_large",
                        "Тело JSON-запроса превышает допустимый размер",
                    ),
                    headers={"X-Request-ID": request_id},
                )
        try:
            response = await call_next(request)
        except Exception:
            route = request.scope.get("route")
            path = getattr(route, "path", "unmatched")
            REQUESTS.labels(request.method, path, "500").inc()
            elapsed = time.perf_counter() - started
            REQUEST_LATENCY.labels(request.method, path).observe(elapsed)
            logger.exception(
                json.dumps(
                    {
                        "event": "http_request",
                        "requestId": request_id,
                        "method": request.method,
                        "path": path,
                        "status": 500,
                        "durationMs": round(elapsed * 1000, 2),
                    }
                )
            )
            raise
        route = request.scope.get("route")
        path = getattr(route, "path", "unmatched")
        REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        elapsed = time.perf_counter() - started
        REQUEST_LATENCY.labels(request.method, path).observe(elapsed)
        response.headers["X-Request-ID"] = request_id
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Content-Security-Policy", settings.content_security_policy)
        logger.info(
            json.dumps(
                {
                    "event": "http_request",
                    "requestId": request_id,
                    "method": request.method,
                    "path": path,
                    "status": response.status_code,
                    "durationMs": round(elapsed * 1000, 2),
                }
            )
        )
        return response

    register_error_handlers(app)
    for route_module in (auth, admin, pages, assets, content, legacy, public):
        app.include_router(route_module.router, prefix=settings.api_prefix)

    @app.get("/health/live", include_in_schema=False)
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", include_in_schema=False)
    async def ready() -> Response:
        try:
            async with database.session() as session:
                await session.execute(text("SELECT 1"))
                database_revision = (
                    "auto-created"
                    if settings.auto_create_schema
                    else await session.scalar(text("SELECT version_num FROM alembic_version"))
                )
            schema_ready = (
                settings.auto_create_schema
                or not settings.readiness_require_alembic_head
                or database_revision == ALEMBIC_HEAD
            )
            if not schema_ready:
                READINESS.set(0)
                return JSONResponse(
                    {
                        "status": "not_ready",
                        "database": "ok",
                        "schema": {
                            "current": database_revision,
                            "expected": ALEMBIC_HEAD,
                            "atHead": False,
                        },
                    },
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            READINESS.set(1)
            return JSONResponse(
                {
                    "status": "ready",
                    "database": "ok",
                    "cache": "redis" if cache.redis_healthy else "local-fallback",
                    "storage": "local-fallback" if storage.using_fallback else "primary",
                    "schema": {
                        "current": database_revision,
                        "expected": ALEMBIC_HEAD,
                        "atHead": schema_ready,
                    },
                }
            )
        except Exception:
            logger.exception("readiness check failed")
            READINESS.set(0)
            return JSONResponse(
                {"status": "not_ready", "database": "unavailable"},
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()
