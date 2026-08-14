from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.sqlite3'}",
        auto_create_schema=True,
        jwt_secret="test-secret-that-is-definitely-longer-than-thirty-two-characters",
        redis_url=None,
        local_storage_path=tmp_path / "assets",
        rendition_widths=[320],
        scheduler_enabled=False,
        trusted_hosts=["testserver"],
        cors_origins=["http://testserver"],
    )


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as test_client:
            yield test_client


async def bootstrap_admin(client: httpx.AsyncClient) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "admin@example.com",
            "displayName": "Admin",
            "password": "StrongPassword123",
            "role": "Viewer",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["role"] == "Admin"
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "StrongPassword123"},
    )
    assert login.status_code == 200, login.text
    return login.json()


async def create_site(
    client: httpx.AsyncClient,
    token: str,
    *,
    slug: str = "main",
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/sites",
        headers={"Authorization": f"Bearer {token}"},
        json={"slug": slug, "name": "Main site", "domains": ["https://example.test"]},
    )
    assert response.status_code == 201, response.text
    return response.json()


def page_document(
    text: str = "Hello", *, meta_description: str = "A useful page"
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "pageMeta": {
            "title": "Example",
            "seoTitle": "Example",
            "metaDescription": meta_description,
        },
        "layout": {},
        "locale": "ru",
        "blocks": [
            {
                "id": "section-1",
                "type": "section",
                "version": "1.0",
                "props": {},
                "children": [
                    {
                        "id": "heading-1",
                        "type": "heading",
                        "version": "1.0",
                        "props": {"text": "Example", "level": "h1"},
                    },
                    {
                        "id": "text-1",
                        "type": "text",
                        "version": "1.0",
                        "props": {"html": text},
                    },
                ],
            }
        ],
        "assetsRefs": [],
        "settings": {},
    }


async def create_page(
    client: httpx.AsyncClient,
    token: str,
    site_id: str,
    *,
    path: str = "/example",
    document: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/pages",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "siteId": site_id,
            "title": "Example",
            "slug": path.strip("/").replace("/", "-") or "home",
            "routePath": path,
            "document": document or page_document(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()
