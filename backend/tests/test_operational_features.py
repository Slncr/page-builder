from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image

from tests.conftest import bootstrap_admin, create_page, create_site, page_document


async def _create_user(
    client: httpx.AsyncClient,
    admin_token: str,
    *,
    email: str,
    role: str,
) -> str:
    password = "StrongPassword123"
    response = await client.post(
        "/api/v1/auth/register",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": email,
            "displayName": email.split("@", 1)[0],
            "password": password,
            "role": role,
        },
    )
    assert response.status_code == 201, response.text
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    return str(login.json()["accessToken"])


@pytest.mark.asyncio
async def test_edit_lock_read_only_heartbeat_and_admin_override(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    admin_token = str(admin["accessToken"])
    first_token = await _create_user(
        client,
        admin_token,
        email="first@example.com",
        role="Copywriter",
    )
    second_token = await _create_user(
        client,
        admin_token,
        email="second@example.com",
        role="Copywriter",
    )
    site = await create_site(client, admin_token)
    page = await create_page(client, admin_token, site["id"])
    page_id = page["id"]

    acquired = await client.post(
        f"/api/v1/pages/{page_id}/lock",
        headers={"Authorization": f"Bearer {first_token}"},
        json={},
    )
    assert acquired.status_code == 200, acquired.text
    assert acquired.json()["isOwner"] is True

    status_response = await client.get(
        f"/api/v1/pages/{page_id}/lock",
        headers={"Authorization": f"Bearer {second_token}"},
    )
    assert status_response.status_code == 200
    assert status_response.json()["readOnly"] is True
    blocked = await client.put(
        f"/api/v1/pages/{page_id}/draft",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"baseVersion": 1, "document": page_document("blocked")},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "page_locked"

    forced = await client.post(
        f"/api/v1/pages/{page_id}/lock",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"force": True},
    )
    assert forced.status_code == 200, forced.text
    heartbeat = await client.post(
        f"/api/v1/pages/{page_id}/lock/heartbeat",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert heartbeat.status_code == 200
    assert heartbeat.json()["isOwner"] is True


@pytest.mark.asyncio
async def test_signed_preview_token_allows_noindex_preview(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    site = await create_site(client, token)
    page = await create_page(client, token, site["id"])
    issued = await client.post(
        f"/api/v1/pages/{page['id']}/preview-token",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert issued.status_code == 200, issued.text
    preview_token = issued.json()["token"]
    client.cookies.clear()
    preview = await client.get(
        f"/api/v1/preview/pages/{page['id']}",
        params={"token": preview_token},
    )
    assert preview.status_code == 200, preview.text
    assert preview.headers["x-robots-tag"] == "noindex, nofollow"
    assert preview.headers["cache-control"] == "private, no-store"
    assert preview.json()["draftVersion"] == 1


@pytest.mark.asyncio
async def test_form_honeypot_and_elapsed_checks(client: httpx.AsyncClient) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    site = await create_site(client, token)
    created = await client.post(
        "/api/v1/forms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "siteId": site["id"],
            "slug": "contact",
            "name": "Contact",
            "schema": {
                "fields": [
                    {"name": "email", "type": "email", "required": True},
                ]
            },
            "settings": {
                "antispam": {"enabled": True, "minimumElapsedSeconds": 2},
            },
        },
    )
    assert created.status_code == 201, created.text
    form_id = created.json()["id"]
    honeypot = await client.post(
        f"/api/v1/public/forms/{form_id}/submit",
        json={
            "data": {"email": "bot@example.com"},
            "website": "https://spam.example",
            "startedAt": datetime.now(UTC).isoformat(),
        },
    )
    assert honeypot.status_code == 202
    too_fast = await client.post(
        f"/api/v1/public/forms/{form_id}/submit",
        json={
            "data": {"email": "person@example.com"},
            "startedAt": datetime.now(UTC).isoformat(),
        },
    )
    assert too_fast.status_code == 422
    accepted = await client.post(
        f"/api/v1/public/forms/{form_id}/submit",
        json={
            "data": {"email": "person@example.com"},
            "startedAt": (datetime.now(UTC) - timedelta(seconds=3)).isoformat(),
        },
    )
    assert accepted.status_code == 202, accepted.text
    submissions = await client.get(
        "/api/v1/forms/submissions",
        headers={"Authorization": f"Bearer {token}"},
        params={"formId": form_id},
    )
    assert submissions.status_code == 200
    assert submissions.json()["total"] == 1


@pytest.mark.asyncio
async def test_image_metadata_exif_removal_and_worker_renditions(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    site = await create_site(client, token)
    source = Image.new("RGB", (80, 40), "red")
    exif = Image.Exif()
    exif[0x010E] = "remove me"
    buffer = io.BytesIO()
    source.save(buffer, format="JPEG", exif=exif)
    source_bytes = buffer.getvalue()
    uploaded = await client.post(
        "/api/v1/assets/upload",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": "asset-upload-0001",
        },
        data={"siteId": site["id"], "altText": "Red rectangle"},
        files={"file": ("photo.jpg", source_bytes, "image/jpeg")},
    )
    assert uploaded.status_code == 201, uploaded.text
    asset = uploaded.json()
    assert asset["status"] == "processing"
    assert asset["width"] == 80
    replay = await client.post(
        "/api/v1/assets/upload",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": "asset-upload-0001",
        },
        data={"siteId": site["id"], "altText": "Red rectangle"},
        files={"file": ("photo.jpg", source_bytes, "image/jpeg")},
    )
    assert replay.status_code == 201
    assert replay.headers["idempotent-replayed"] == "true"
    assert replay.json()["id"] == asset["id"]
    stored = await app.state.storage.get(asset["objectKey"])
    with Image.open(io.BytesIO(stored)) as normalized:
        assert not normalized.getexif()

    await app.state.worker.run_once()
    detail = await client.get(
        f"/api/v1/assets/{asset['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert detail.status_code == 200
    assert detail.json()["status"] == "ready"
    renditions = await client.get(
        f"/api/v1/assets/{asset['id']}/renditions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert renditions.status_code == 200
    items: list[dict[str, Any]] = renditions.json()
    assert {item["width"] for item in items} == {320}
    assert "320w-jpeg" in {item["name"] for item in items}
    public = await client.get(f"/api/v1/public/assets/{asset['id']}/renditions/320w-jpeg")
    assert public.status_code == 200
    assert public.headers["cache-control"].endswith("immutable")
    replacement_buffer = io.BytesIO()
    Image.new("RGB", (100, 50), "blue").save(replacement_buffer, format="JPEG")
    replacement = await client.put(
        f"/api/v1/assets/{asset['id']}/content",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": "asset-replace-0001",
        },
        files={"file": ("replacement.jpg", replacement_buffer.getvalue(), "image/jpeg")},
    )
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["width"] == 100
    metadata = await client.patch(
        f"/api/v1/assets/{asset['id']}",
        headers={"Authorization": f"Bearer {token}"},
        json={"folderPath": "marketing/hero", "tags": ["hero", "blue", "hero"]},
    )
    assert metadata.status_code == 200
    assert metadata.json()["folderPath"] == "marketing/hero"
    assert metadata.json()["tags"] == ["blue", "hero"]
