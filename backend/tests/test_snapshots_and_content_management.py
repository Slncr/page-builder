from __future__ import annotations

import httpx
import pytest

from tests.conftest import bootstrap_admin, create_page, create_site, page_document


@pytest.mark.asyncio
async def test_autosave_revision_preview_and_stale_draft_token(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    page = await create_page(client, token, site["id"], path="/snapshots")
    saved = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 1, "document": page_document("Autosaved")},
    )
    assert saved.status_code == 200
    revisions = await client.get(
        f"/api/v1/pages/{page['id']}/revisions",
        headers=headers,
    )
    autosave = next(item for item in revisions.json() if item["kind"] == "autosave")
    assert autosave["draftVersion"] == 2
    revision_token = await client.post(
        f"/api/v1/pages/{page['id']}/revisions/{autosave['id']}/preview-token",
        headers=headers,
    )
    assert revision_token.status_code == 200
    draft_token = await client.post(
        f"/api/v1/pages/{page['id']}/preview-token",
        headers=headers,
    )
    assert draft_token.status_code == 200
    newer = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 2, "document": page_document("Newer")},
    )
    assert newer.status_code == 200
    client.cookies.clear()
    immutable_preview = await client.get(
        f"/api/v1/preview/pages/{page['id']}/revisions/{autosave['id']}",
        headers={"Authorization": f"Preview {revision_token.json()['token']}"},
    )
    assert immutable_preview.status_code == 200, immutable_preview.text
    assert "Autosaved" in str(immutable_preview.json()["document"])
    stale = await client.get(
        f"/api/v1/preview/pages/{page['id']}",
        headers={"Authorization": f"Preview {draft_token.json()['token']}"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_preview_token"


@pytest.mark.asyncio
async def test_form_template_and_preset_management(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    template = await client.post(
        "/api/v1/templates",
        headers=headers,
        json={
            "siteId": site["id"],
            "slug": "landing",
            "name": "Landing",
            "version": 1,
            "document": page_document(),
        },
    )
    assert template.status_code == 201, template.text
    patched_template = await client.patch(
        f"/api/v1/templates/{template.json()['id']}",
        headers=headers,
        json={"name": "Updated Landing"},
    )
    assert patched_template.status_code == 200
    template_preview = await client.get(
        f"/api/v1/templates/{template.json()['id']}/preview",
        headers=headers,
    )
    assert template_preview.status_code == 200
    assert template_preview.headers["x-robots-tag"] == "noindex, nofollow"

    invalid_preset = await client.post(
        "/api/v1/presets",
        headers=headers,
        json={
            "siteId": site["id"],
            "blockType": "heading",
            "name": "Invalid",
            "data": {},
        },
    )
    assert invalid_preset.status_code == 422
    preset = await client.post(
        "/api/v1/presets",
        headers=headers,
        json={
            "siteId": site["id"],
            "blockType": "heading",
            "name": "Heading",
            "data": {"text": "Heading", "level": "h2"},
        },
    )
    assert preset.status_code == 201, preset.text
    patched_preset = await client.patch(
        f"/api/v1/presets/{preset.json()['id']}",
        headers=headers,
        json={"name": "Updated Heading"},
    )
    assert patched_preset.status_code == 200
    preset_preview = await client.get(
        f"/api/v1/presets/{preset.json()['id']}/preview",
        headers=headers,
    )
    assert preset_preview.status_code == 200

    form = await client.post(
        "/api/v1/forms",
        headers=headers,
        json={
            "siteId": site["id"],
            "slug": "managed-form",
            "name": "Managed Form",
            "schema": {"fields": [{"name": "email", "type": "email"}]},
        },
    )
    assert form.status_code == 201, form.text
    patched_form = await client.patch(
        f"/api/v1/forms/{form.json()['id']}",
        headers=headers,
        json={"name": "Updated Form"},
    )
    assert patched_form.status_code == 200
    deactivated = await client.delete(
        f"/api/v1/forms/{form.json()['id']}",
        headers=headers,
    )
    assert deactivated.status_code == 204
