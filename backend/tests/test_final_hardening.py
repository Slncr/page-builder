from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import update

from app.models import PublishJob
from tests.conftest import bootstrap_admin, create_page, create_site, page_document


@pytest.mark.asyncio
async def test_admin_user_management_and_trash_lifecycle(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    created_user = await client.post(
        "/api/v1/auth/register",
        headers=headers,
        json={
            "email": "managed@example.com",
            "displayName": "Managed",
            "password": "StrongPassword123",
            "role": "Viewer",
        },
    )
    assert created_user.status_code == 201
    user_id = created_user.json()["id"]
    users = await client.get("/api/v1/users", headers=headers)
    assert users.status_code == 200
    assert users.json()["total"] == 2
    changed = await client.patch(
        f"/api/v1/users/{user_id}",
        headers=headers,
        json={"role": "Editor", "isActive": False},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["role"] == "Editor"
    assert changed.json()["isActive"] is False
    last_admin = await client.patch(
        f"/api/v1/users/{admin['user']['id']}",
        headers=headers,
        json={"isActive": False},
    )
    assert last_admin.status_code == 409
    assert last_admin.json()["error"]["code"] == "last_admin"

    site = await create_site(client, token)
    page = await create_page(client, token, site["id"], path="/trash-me")
    trashed = await client.delete(f"/api/v1/pages/{page['id']}", headers=headers)
    assert trashed.status_code == 204
    trash = await client.get("/api/v1/pages/trash", headers=headers)
    assert trash.status_code == 200
    assert trash.json()["retentionDays"] == 30
    assert trash.json()["items"][0]["page"]["id"] == page["id"]
    restored = await client.post(
        f"/api/v1/pages/{page['id']}/restore",
        headers=headers,
    )
    assert restored.status_code == 200
    assert restored.json()["status"] == "draft"
    await client.delete(f"/api/v1/pages/{page['id']}", headers=headers)
    permanent = await client.delete(
        f"/api/v1/pages/{page['id']}/permanent",
        headers=headers,
    )
    assert permanent.status_code == 204


@pytest.mark.asyncio
async def test_if_match_publish_idempotency_and_batch(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    first = await create_page(client, token, site["id"], path="/first")
    second = await create_page(client, token, site["id"], path="/second")

    if_match = await client.patch(
        f"/api/v1/pages/{first['id']}/draft",
        headers={**headers, "If-Match": '"draft-1"'},
        json={"document": page_document("If-Match update")},
    )
    assert if_match.status_code == 200, if_match.text
    mismatch = await client.patch(
        f"/api/v1/pages/{first['id']}/draft",
        headers={**headers, "If-Match": '"2"'},
        json={"baseVersion": 1, "document": page_document("Mismatch")},
    )
    assert mismatch.status_code == 412

    key = "publish-request-0001"
    published = await client.post(
        f"/api/v1/pages/{first['id']}/publish",
        headers={**headers, "Idempotency-Key": key},
        json={"expectedVersion": 2},
    )
    assert published.status_code == 200, published.text
    replayed = await client.post(
        f"/api/v1/pages/{first['id']}/publish",
        headers={**headers, "Idempotency-Key": key},
        json={"expectedVersion": 2},
    )
    assert replayed.status_code == 200
    assert replayed.headers["idempotent-replayed"] == "true"
    assert replayed.json()["revision"]["id"] == published.json()["revision"]["id"]
    reused = await client.post(
        f"/api/v1/pages/{first['id']}/publish",
        headers={**headers, "Idempotency-Key": key},
        json={"expectedVersion": 2, "message": "different"},
    )
    assert reused.status_code == 409

    batch = await client.post(
        "/api/v1/pages/batch/publish",
        headers={**headers, "Idempotency-Key": "batch-request-0001"},
        json={
            "items": [
                {"pageId": second["id"], "expectedVersion": 1},
                {"pageId": first["id"], "expectedVersion": 999},
            ]
        },
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["succeeded"] == 1
    assert batch.json()["failed"] == 1


@pytest.mark.asyncio
async def test_scheduled_publish_uses_pinned_revision(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    page = await create_page(
        client,
        token,
        site["id"],
        path="/scheduled-pin",
        document=page_document("Pinned"),
    )
    scheduled = await client.post(
        f"/api/v1/pages/{page['id']}/schedule",
        headers=headers,
        json={
            "expectedVersion": 1,
            "runAt": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
        },
    )
    assert scheduled.status_code == 200, scheduled.text
    changed = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 1, "document": page_document("Newer draft")},
    )
    assert changed.status_code == 200
    async with app.state.database.session() as session:
        await session.execute(
            update(PublishJob)
            .where(PublishJob.id == UUID(scheduled.json()["jobId"]))
            .values(run_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    await app.state.jobs.run_once()
    public = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/scheduled-pin"},
    )
    assert public.status_code == 200
    assert "Pinned" in str(public.json()["document"])
    assert "Newer draft" not in str(public.json()["document"])
