from __future__ import annotations

import httpx

from tests.conftest import bootstrap_admin, create_page, create_site, page_document


def _published_text(payload: dict[str, object]) -> str:
    document = payload["document"]
    return document["blocks"][0]["children"][1]["props"]["html"]


async def test_publish_rollback_and_public_etag_route(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    token = admin["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    page = await create_page(
        client,
        token,
        site["id"],
        path="/release",
        document=page_document("<p>Version one</p>"),
    )

    first_publish = await client.post(
        f"/api/v1/pages/{page['id']}/publish",
        headers=headers,
        json={"expectedVersion": 1, "message": "First release"},
    )
    assert first_publish.status_code == 200, first_publish.text
    first_revision = first_publish.json()["revision"]
    assert first_revision["kind"] == "published"

    resolver = await client.get("/api/v1/public/route", params={"path": "/release"})
    assert resolver.status_code == 200
    assert resolver.json()["mode"] == "builder"
    assert resolver.json()["pageId"] == page["id"]

    public = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/release"},
    )
    assert public.status_code == 200, public.text
    assert _published_text(public.json()) == "<p>Version one</p>"
    etag = public.headers["etag"]
    not_modified = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/release"},
        headers={"If-None-Match": etag},
    )
    assert not_modified.status_code == 304

    save_second = await client.patch(
        f"/api/v1/pages/{page['id']}/draft",
        headers=headers,
        json={
            "baseVersion": 1,
            "document": page_document("<p>Version two</p>"),
        },
    )
    assert save_second.status_code == 200
    saved_page = await client.get(f"/api/v1/pages/{page['id']}", headers=headers)
    assert saved_page.status_code == 200
    assert saved_page.json()["page"]["status"] == "published"
    still_published = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/release"},
    )
    assert still_published.status_code == 200
    assert _published_text(still_published.json()) == "<p>Version one</p>"
    second_publish = await client.post(
        f"/api/v1/pages/{page['id']}/publish",
        headers=headers,
        json={"expectedVersion": 2, "message": "Second release"},
    )
    assert second_publish.status_code == 200, second_publish.text
    assert second_publish.json()["revision"]["id"] != first_revision["id"]

    rollback = await client.post(
        f"/api/v1/pages/{page['id']}/rollback/{first_revision['id']}",
        headers=headers,
        json={"expectedVersion": 2, "message": "Rollback"},
    )
    assert rollback.status_code == 200, rollback.text
    rolled_revision = rollback.json()["revision"]
    assert rolled_revision["kind"] == "rollback"
    assert rolled_revision["id"] not in {
        first_revision["id"],
        second_publish.json()["revision"]["id"],
    }
    assert rolled_revision["sourceRevisionId"] == first_revision["id"]

    rolled_public = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/release"},
    )
    assert rolled_public.status_code == 200
    assert _published_text(rolled_public.json()) == "<p>Version one</p>"
    assert rolled_public.headers["etag"] != etag

    unpublish = await client.post(
        f"/api/v1/pages/{page['id']}/unpublish",
        headers=headers,
    )
    assert unpublish.status_code == 200
    missing = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/release"},
    )
    assert missing.status_code == 404
    fallback = await client.get("/api/v1/public/route", params={"path": "/release"})
    assert fallback.json()["mode"] == "not_found"
