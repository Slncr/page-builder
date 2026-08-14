from __future__ import annotations

import httpx

from tests.conftest import bootstrap_admin, create_site, page_document


async def test_authentication_rbac_and_bearer_support(client: httpx.AsyncClient) -> None:
    admin = await bootstrap_admin(client)
    site = await create_site(client, admin["accessToken"])

    created = await client.post(
        "/api/v1/auth/register",
        headers={"Authorization": f"Bearer {admin['accessToken']}"},
        json={
            "email": "viewer@example.com",
            "displayName": "Viewer",
            "password": "ViewerPassword123",
            "role": "Viewer",
        },
    )
    assert created.status_code == 201
    assert created.json()["role"] == "Viewer"

    denied_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "viewer@example.com", "password": "wrong"},
    )
    assert denied_login.status_code == 401
    assert denied_login.json()["error"]["code"] == "invalid_credentials"

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "viewer@example.com", "password": "ViewerPassword123"},
    )
    assert login.status_code == 200
    viewer_token = login.json()["accessToken"]

    listing = await client.get(
        "/api/v1/pages",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert listing.status_code == 200

    forbidden = await client.post(
        "/api/v1/pages",
        headers={"Authorization": f"Bearer {viewer_token}"},
        json={
            "siteId": site["id"],
            "title": "Forbidden",
            "slug": "forbidden",
            "routePath": "/forbidden",
            "document": page_document(),
        },
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"


async def test_cookie_auth_requires_csrf_and_refresh_rotates(
    client: httpx.AsyncClient,
) -> None:
    admin = await bootstrap_admin(client)
    assert admin["accessToken"]
    csrf = client.cookies["csrf_token"]

    blocked = await client.post(
        "/api/v1/sites",
        json={"slug": "blocked", "name": "Blocked"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "csrf_failed"

    allowed = await client.post(
        "/api/v1/sites",
        headers={"X-CSRF-Token": csrf},
        json={"slug": "cookie-site", "name": "Cookie site"},
    )
    assert allowed.status_code == 201

    blocked_refresh = await client.post("/api/v1/auth/refresh", json={})
    assert blocked_refresh.status_code == 403

    refreshed = await client.post(
        "/api/v1/auth/refresh",
        headers={"X-CSRF-Token": csrf},
        json={},
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["refreshToken"] != admin["refreshToken"]
    assert client.cookies["csrf_token"] != csrf
