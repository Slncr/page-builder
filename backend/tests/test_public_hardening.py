from __future__ import annotations

import httpx
import pytest

from tests.conftest import bootstrap_admin, create_page, create_site, page_document


@pytest.mark.asyncio
async def test_provider_allowlist_and_sitemap_metadata(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = str(admin["accessToken"])
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    unsafe_document = page_document()
    unsafe_document["blocks"][0]["children"].append(
        {
            "id": "embed-1",
            "type": "embed",
            "version": "1.0",
            "props": {
                "provider": "youtube",
                "url": "https://attacker.example/embed",
            },
        }
    )
    unsafe = await create_page(
        client,
        token,
        site["id"],
        path="/unsafe-embed",
        document=unsafe_document,
    )
    blocked = await client.post(
        f"/api/v1/pages/{unsafe['id']}/publish",
        headers=headers,
        json={"expectedVersion": 1},
    )
    assert blocked.status_code == 422
    assert any(
        issue["code"] == "provider_url_not_allowed" for issue in blocked.json()["error"]["details"]
    )

    indexed_document = page_document()
    indexed_document["pageMeta"]["sitemapPriority"] = 0.8
    indexed_document["pageMeta"]["changeFrequency"] = "weekly"
    indexed = await create_page(
        client,
        token,
        site["id"],
        path="/indexed",
        document=indexed_document,
    )
    noindex_document = page_document()
    noindex_document["pageMeta"]["robots"] = "noindex,follow"
    noindex = await create_page(
        client,
        token,
        site["id"],
        path="/private-page",
        document=noindex_document,
    )
    for page in (indexed, noindex):
        response = await client.post(
            f"/api/v1/pages/{page['id']}/publish",
            headers=headers,
            json={"expectedVersion": 1},
        )
        assert response.status_code == 200, response.text
    sitemap = await client.get("/api/v1/sitemap.xml")
    assert sitemap.status_code == 200
    assert "/indexed" in sitemap.text
    assert "/private-page" not in sitemap.text
    assert "<changefreq>weekly</changefreq>" in sitemap.text
    assert "<priority>0.8</priority>" in sitemap.text
    assert "content-security-policy" in sitemap.headers
