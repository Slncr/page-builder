from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import update

from alembic import command
from app.models import PublishJob
from app.schema_version import ALEMBIC_HEAD
from tests.conftest import bootstrap_admin, create_page, create_site, page_document


async def _create_content_page(
    client: httpx.AsyncClient,
    token: str,
    site_id: str,
    *,
    path: str,
    title: str,
    content_type: str = "news",
    section_key: str | None = "press",
    listing_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "siteId": site_id,
        "title": title,
        "slug": path.strip("/").replace("/", "-"),
        "routePath": path,
        "contentType": content_type,
        "listingMeta": listing_meta or {},
        "document": page_document(title),
    }
    if section_key is not None:
        payload["sectionKey"] = section_key
    response = await client.post(
        "/api/v1/pages",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _publish(
    client: httpx.AsyncClient,
    token: str,
    page_id: str,
    expected_version: int = 1,
) -> dict[str, Any]:
    response = await client.post(
        f"/api/v1/pages/{page_id}/publish",
        headers={"Authorization": f"Bearer {token}"},
        json={"expectedVersion": expected_version},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_admin_page_content_contract_defaults_patch_filters_and_detail(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)

    generic = await create_page(client, token, site["id"], path="/generic")
    assert generic["contentType"] == "generic"
    assert generic["sectionKey"] is None
    assert generic["listingMeta"] == {
        "excerpt": None,
        "coverAssetId": None,
        "publishedDisplayAt": None,
        "authorName": None,
        "authorTitle": None,
        "sortOrder": 0,
        "featured": False,
        "hiddenFromLists": False,
        "menuLabel": None,
    }

    invalid_type = await client.post(
        "/api/v1/pages",
        headers=headers,
        json={
            "siteId": site["id"],
            "title": "Invalid type",
            "slug": "invalid-type",
            "routePath": "/invalid-type",
            "contentType": "blog",
            "document": page_document(),
        },
    )
    assert invalid_type.status_code == 422

    invalid_section = await client.post(
        "/api/v1/pages",
        headers=headers,
        json={
            "siteId": site["id"],
            "title": "Invalid section",
            "slug": "invalid-section",
            "routePath": "/invalid-section",
            "sectionKey": "Press Releases",
            "document": page_document(),
        },
    )
    assert invalid_section.status_code == 422

    cover_id = str(uuid4())
    news = await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/release",
        title="Release",
        listing_meta={
            "excerpt": "Initial excerpt",
            "coverAssetId": cover_id,
            "publishedDisplayAt": "2026-08-12T10:00:00Z",
            "authorName": "Ada",
            "authorTitle": "Editor",
            "sortOrder": 7,
            "featured": True,
            "hiddenFromLists": False,
            "menuLabel": "News",
        },
    )
    patched = await client.patch(
        f"/api/v1/pages/{news['id']}",
        headers=headers,
        json={"listingMeta": {"featured": False, "menuLabel": "Latest"}},
    )
    assert patched.status_code == 200, patched.text
    patched_meta = patched.json()["listingMeta"]
    assert patched_meta["featured"] is False
    assert patched_meta["menuLabel"] == "Latest"
    assert patched_meta["excerpt"] == "Initial excerpt"
    assert patched_meta["coverAssetId"] == cover_id
    assert patched_meta["sortOrder"] == 7

    listing = await client.get(
        "/api/v1/pages",
        headers=headers,
        params={
            "siteId": site["id"],
            "contentType": "news",
            "sectionKey": "press",
            "featured": "false",
        },
    )
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] == 1
    assert listing.json()["items"][0]["id"] == news["id"]

    detail = await client.get(f"/api/v1/pages/{news['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["page"]["contentType"] == "news"
    assert detail.json()["page"]["sectionKey"] == "press"
    assert detail.json()["page"]["listingMeta"] == patched_meta

    duplicate = await client.post(f"/api/v1/pages/{news['id']}/duplicate", headers=headers)
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["contentType"] == "news"
    assert duplicate.json()["sectionKey"] == "press"
    assert duplicate.json()["listingMeta"] == patched_meta


async def test_page_layout_contract_defaults_validation_and_persistence(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    page = await create_page(client, token, site["id"], path="/layout-contract")

    draft = await client.get(f"/api/v1/pages/{page['id']}/draft", headers=headers)
    assert draft.status_code == 200
    assert draft.json()["document"]["layout"] == {
        "shell": "auto",
        "showPageTitle": False,
        "breadcrumbs": "auto",
    }

    invalid_document = page_document()
    invalid_document["layout"] = {"shell": "unsupported"}
    invalid = await client.post(
        "/api/v1/pages",
        headers=headers,
        json={
            "siteId": site["id"],
            "title": "Invalid layout",
            "slug": "invalid-layout",
            "routePath": "/invalid-layout",
            "document": invalid_document,
        },
    )
    assert invalid.status_code == 422

    expected_layout = {
        "shell": "doctors",
        "showPageTitle": True,
        "breadcrumbs": "hidden",
    }
    updated_document = page_document("Layout-aware page")
    updated_document["layout"] = expected_layout
    updated_document["blocks"][0]["children"][0]["props"]["level"] = "h2"
    saved = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 1, "document": updated_document},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["document"]["layout"] == expected_layout

    published = await client.post(
        f"/api/v1/pages/{page['id']}/publish",
        headers=headers,
        json={"expectedVersion": 2},
    )
    assert published.status_code == 200, published.text
    assert published.json()["revision"]["document"]["layout"] == expected_layout

    public = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/layout-contract"},
    )
    assert public.status_code == 200, public.text
    assert public.json()["document"]["layout"] == expected_layout


async def test_public_page_feed_filters_order_etags_and_cache_invalidation(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    priority = await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/priority",
        title="Priority",
        listing_meta={
            "excerpt": "Priority excerpt",
            "sortOrder": 1,
            "featured": True,
            "publishedDisplayAt": "2026-07-01T00:00:00Z",
        },
    )
    older = await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/older",
        title="Older",
        listing_meta={
            "excerpt": "Older excerpt",
            "sortOrder": 2,
            "featured": True,
            "publishedDisplayAt": "2026-08-01T00:00:00Z",
        },
    )
    hidden = await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/hidden",
        title="Hidden",
        listing_meta={
            "sortOrder": 0,
            "featured": True,
            "hiddenFromLists": True,
        },
    )
    article = await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/article",
        title="Article",
        content_type="article",
        listing_meta={"featured": True},
    )
    await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/draft",
        title="Draft",
        listing_meta={"featured": True},
    )
    for item in (priority, older, hidden, article):
        await _publish(client, token, item["id"])

    params = {
        "site": site["slug"],
        "contentType": "news",
        "section": "press",
        "featured": "true",
        "pathPrefix": "/news",
        "page": 1,
        "pageSize": 1,
    }
    first = await client.get("/api/v1/public/pages", params=params)
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["total"] == 2
    assert first_payload["items"][0]["id"] == priority["id"]
    assert first_payload["items"][0]["path"] == "/news/priority"
    assert first_payload["items"][0]["contentType"] == "news"
    assert first_payload["items"][0]["listingMeta"]["excerpt"] == "Priority excerpt"
    assert first_payload["items"][0]["revisionId"]
    assert first_payload["items"][0]["checksum"]
    assert first_payload["items"][0]["etag"].startswith("rev-")
    assert first.headers["etag"].strip('"') == first_payload["etag"]

    second = await client.get("/api/v1/public/pages", params={**params, "page": 2})
    assert second.status_code == 200
    assert second.json()["items"][0]["id"] == older["id"]
    not_modified = await client.get(
        "/api/v1/public/pages",
        params=params,
        headers={"If-None-Match": first.headers["etag"]},
    )
    assert not_modified.status_code == 304

    by_path = await client.get(
        "/api/v1/public/pages/by-path",
        params={"site": site["slug"], "path": "/news/priority"},
    )
    assert by_path.status_code == 200
    assert by_path.json()["page"]["contentType"] == "news"
    assert by_path.json()["page"]["sectionKey"] == "press"
    assert by_path.json()["page"]["listingMeta"]["excerpt"] == "Priority excerpt"
    assert by_path.json()["etag"] == first_payload["items"][0]["etag"]

    resolved = await client.get(
        "/api/v1/public/resolve",
        params={"site": site["slug"], "path": "/news/priority"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["contentType"] == "news"
    assert resolved.json()["sectionKey"] == "press"
    assert resolved.json()["listingMeta"]["excerpt"] == "Priority excerpt"
    assert resolved.json()["etag"] == by_path.json()["etag"]

    unpublished = await client.post(
        f"/api/v1/pages/{priority['id']}/unpublish",
        headers=headers,
    )
    assert unpublished.status_code == 200
    after_unpublish = await client.get(
        "/api/v1/public/pages",
        params=params,
        headers={"If-None-Match": first.headers["etag"]},
    )
    assert after_unpublish.status_code == 200
    assert after_unpublish.json()["total"] == 1
    assert after_unpublish.json()["items"][0]["id"] == older["id"]

    hidden_patch = await client.patch(
        f"/api/v1/pages/{older['id']}",
        headers=headers,
        json={"listingMeta": {"hiddenFromLists": True}},
    )
    assert hidden_patch.status_code == 200
    after_patch = await client.get(
        "/api/v1/public/pages",
        params=params,
        headers={"If-None-Match": after_unpublish.headers["etag"]},
    )
    assert after_patch.status_code == 200
    assert after_patch.json()["total"] == 0


async def test_schedule_job_and_rollback_invalidate_public_feed(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    page = await _create_content_page(
        client,
        token,
        site["id"],
        path="/news/scheduled",
        title="Scheduled",
        listing_meta={"excerpt": "Scheduled excerpt"},
    )
    scheduled = await client.post(
        f"/api/v1/pages/{page['id']}/schedule",
        headers=headers,
        json={
            "expectedVersion": 1,
            "runAt": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        },
    )
    assert scheduled.status_code == 200, scheduled.text
    feed_params = {"site": site["slug"], "contentType": "news"}
    empty_feed = await client.get("/api/v1/public/pages", params=feed_params)
    assert empty_feed.status_code == 200
    assert empty_feed.json()["total"] == 0

    async with app.state.database.session() as session:
        await session.execute(
            update(PublishJob)
            .where(PublishJob.id == UUID(scheduled.json()["jobId"]))
            .values(run_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    await app.state.jobs.run_once()

    published_feed = await client.get(
        "/api/v1/public/pages",
        params=feed_params,
        headers={"If-None-Match": empty_feed.headers["etag"]},
    )
    assert published_feed.status_code == 200
    assert published_feed.json()["total"] == 1
    base_revision_id = published_feed.json()["items"][0]["revisionId"]

    rescheduled = await client.post(
        f"/api/v1/pages/{page['id']}/schedule",
        headers=headers,
        json={
            "expectedVersion": 1,
            "runAt": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        },
    )
    assert rescheduled.status_code == 200
    after_schedule = await client.get(
        "/api/v1/public/pages",
        params=feed_params,
        headers={"If-None-Match": published_feed.headers["etag"]},
    )
    assert after_schedule.status_code == 200
    assert after_schedule.json()["total"] == 0

    republished = await _publish(client, token, page["id"])
    assert republished["page"]["status"] == "published"
    saved = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 1, "document": page_document("Changed")},
    )
    assert saved.status_code == 200
    await _publish(client, token, page["id"], expected_version=2)
    changed_feed = await client.get("/api/v1/public/pages", params=feed_params)
    rollback = await client.post(
        f"/api/v1/pages/{page['id']}/rollback/{base_revision_id}",
        headers=headers,
        json={"expectedVersion": 2},
    )
    assert rollback.status_code == 200, rollback.text
    after_rollback = await client.get(
        "/api/v1/public/pages",
        params=feed_params,
        headers={"If-None-Match": changed_feed.headers["etag"]},
    )
    assert after_rollback.status_code == 200
    assert after_rollback.json()["total"] == 1
    assert after_rollback.json()["items"][0]["etag"] != changed_feed.json()["items"][0]["etag"]


async def test_openapi_exposes_page_content_contract(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    operation = schema["paths"]["/api/v1/public/pages"]["get"]
    assert {parameter["name"] for parameter in operation["parameters"]} >= {
        "site",
        "contentType",
        "section",
        "featured",
        "pathPrefix",
        "page",
        "pageSize",
    }
    assert "304" in operation["responses"]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/PublicPageListOut"
    )
    assert schema["paths"]["/api/v1/public/pages/by-path"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/PublicPageDetailOut")
    assert schema["paths"]["/api/v1/public/resolve"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/PublicResolveOut")

    components = schema["components"]["schemas"]
    assert components["PageContentType"]["enum"] == [
        "generic",
        "news",
        "article",
        "service",
    ]
    for model_name in ("PageCreate", "PagePatch", "PageOut"):
        assert {
            "contentType",
            "sectionKey",
            "listingMeta",
        } <= components[model_name]["properties"].keys()
    assert components["ListingMeta"]["properties"].keys() >= {
        "excerpt",
        "coverAssetId",
        "publishedDisplayAt",
        "authorName",
        "authorTitle",
        "sortOrder",
        "featured",
        "hiddenFromLists",
        "menuLabel",
    }
    for document_schema in ("PageDocument-Input", "PageDocument-Output"):
        assert components[document_schema]["properties"]["layout"]["$ref"].endswith("/PageLayout")
    page_layout = components["PageLayout"]
    assert page_layout["additionalProperties"] is False
    assert page_layout["properties"]["shell"] == {
        "type": "string",
        "enum": [
            "auto",
            "plain",
            "home",
            "about",
            "services",
            "labs",
            "doctors",
            "branches",
        ],
        "title": "Shell",
        "default": "auto",
    }
    assert page_layout["properties"]["showPageTitle"]["type"] == "boolean"
    assert page_layout["properties"]["showPageTitle"]["default"] is False
    assert page_layout["properties"]["breadcrumbs"]["enum"] == ["auto", "hidden"]
    assert page_layout["properties"]["breadcrumbs"]["default"] == "auto"
    assert components["DraftUpdate"]["properties"]["document"]["$ref"].endswith(
        "/PageDocument-Input"
    )
    assert components["DraftOut"]["properties"]["document"]["$ref"].endswith("/PageDocument-Output")
    assert components["PublicPageDetailOut"]["properties"]["document"]["$ref"].endswith(
        "/PageDocument-Output"
    )


def test_0005_migration_round_trip(tmp_path: Path, monkeypatch: Any) -> None:
    database_path = tmp_path / "migration.sqlite3"
    monkeypatch.setenv("PB_DATABASE_URL", f"sqlite+aiosqlite:///{database_path}")
    backend_root = Path(__file__).parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))

    command.upgrade(config, "head")
    with sqlite3.connect(database_path) as connection:
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        columns = {row[1] for row in connection.execute("PRAGMA table_info('pages')").fetchall()}
    assert revision == (ALEMBIC_HEAD,)
    assert {"content_type", "section_key", "listing_meta"} <= columns

    command.downgrade(config, "0004_russian_locale")
    with sqlite3.connect(database_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info('pages')").fetchall()}
    assert not {"content_type", "section_key", "listing_meta"} & columns

    command.upgrade(config, "head")
    with sqlite3.connect(database_path) as connection:
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        columns = {row[1] for row in connection.execute("PRAGMA table_info('pages')").fetchall()}
        indexes = {row[1] for row in connection.execute("PRAGMA index_list('pages')").fetchall()}
    assert revision == (ALEMBIC_HEAD,)
    assert {"content_type", "section_key", "listing_meta"} <= columns
    assert {"ix_pages_content_type", "ix_pages_section_key"} <= indexes
