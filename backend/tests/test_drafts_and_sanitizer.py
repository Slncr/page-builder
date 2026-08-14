from __future__ import annotations

import httpx

from app.sanitizer import sanitize_html
from tests.conftest import bootstrap_admin, create_page, create_site, page_document


async def test_optimistic_draft_conflict_returns_current_version(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = admin["accessToken"]
    site = await create_site(client, token)
    page = await create_page(client, token, site["id"])
    headers = {"Authorization": f"Bearer {token}"}

    first_document = page_document("<p>First editor</p>")
    saved = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 1, "document": first_document},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 2

    stale = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={"baseVersion": 1, "document": page_document("<p>Stale editor</p>")},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["details"] == {
        "expectedVersion": 1,
        "currentVersion": 2,
    }

    current = await client.get(f"/api/v1/pages/{page['id']}/draft", headers=headers)
    assert current.status_code == 200
    html = current.json()["document"]["blocks"][0]["children"][1]["props"]["html"]
    assert html == "<p>First editor</p>"


async def test_nh3_sanitizer_blocks_xss_in_saved_documents(
    client: httpx.AsyncClient,
) -> None:
    payload = (
        '<p onclick="steal()">Safe<script>alert(1)</script></p>'
        '<a href="javascript:alert(2)" onmouseover="steal()">link</a>'
        '<img src="https://cdn.example/image.jpg" onerror="steal()">'
    )
    cleaned = sanitize_html(payload)
    assert "script" not in cleaned.lower()
    assert "onclick" not in cleaned.lower()
    assert "onmouseover" not in cleaned.lower()
    assert "onerror" not in cleaned.lower()
    assert "javascript:" not in cleaned.lower()
    assert "Safe" in cleaned

    admin = await bootstrap_admin(client)
    token = admin["accessToken"]
    site = await create_site(client, token)
    page = await create_page(
        client,
        token,
        site["id"],
        document=page_document(payload),
    )
    draft = await client.get(
        f"/api/v1/pages/{page['id']}/draft",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert draft.status_code == 200
    stored = draft.json()["document"]["blocks"][0]["children"][1]["props"]["html"]
    assert "script" not in stored.lower()
    assert "onerror" not in stored.lower()
    assert "javascript:" not in stored.lower()
