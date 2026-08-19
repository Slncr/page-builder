from __future__ import annotations

from uuid import UUID

import httpx
from fastapi import FastAPI
from sqlalchemy import select

from app.config import Settings
from app.models import Route
from app.registry import registry
from app.schemas import PageDocument, SiteCreate
from tests.conftest import bootstrap_admin, create_page, create_site


def _contains_russian(value: str) -> bool:
    return any("а" <= char.lower() <= "я" or char.lower() == "ё" for char in value)


def test_russian_defaults_and_registry(monkeypatch: object) -> None:
    monkeypatch.setenv("PB_DEFAULT_LOCALE", "ru")
    assert Settings(_env_file=None).default_locale == "ru"
    assert PageDocument().locale == "ru"
    assert SiteCreate(slug="main", name="Основной сайт").default_locale == "ru"

    manifest = registry.manifest()
    assert manifest["blocks"]
    assert all(_contains_russian(block["title"]) for block in manifest["blocks"])
    assert all(_contains_russian(block["description"]) for block in manifest["blocks"])


async def test_created_content_and_api_messages_are_russian(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    admin = await bootstrap_admin(client)
    token = admin["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    assert site["defaultLocale"] == "ru"

    unsupported_locale = await client.post(
        "/api/v1/sites",
        headers=headers,
        json={"slug": "english", "name": "English", "defaultLocale": "en"},
    )
    assert unsupported_locale.status_code == 422
    assert unsupported_locale.json()["error"]["message"] == "Поддерживается только локаль 'ru'"

    document = {
        "schemaVersion": "1.0",
        "pageMeta": {},
        "locale": "en",
        "blocks": [],
    }
    page = await create_page(client, token, site["id"], document=document)
    draft = await client.get(f"/api/v1/pages/{page['id']}/draft", headers=headers)
    assert draft.status_code == 200
    assert draft.json()["document"]["locale"] == "ru"

    async with app.state.database.session() as session:
        route = await session.scalar(select(Route).where(Route.page_id == UUID(page["id"])))
    assert route is not None
    assert route.locale == "ru"

    invalid_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "неверный-пароль"},
    )
    assert invalid_login.status_code == 401
    assert (
        invalid_login.json()["error"]["message"]
        == "Неверный логин, адрес электронной почты или пароль"
    )

    invalid_request = await client.post(
        "/api/v1/sites",
        headers=headers,
        json={"slug": "Недопустимый slug", "name": "Сайт"},
    )
    assert invalid_request.status_code == 422
    error = invalid_request.json()["error"]
    assert error["message"] == "Проверка данных запроса не пройдена"
    assert all(_contains_russian(item["message"]) for item in error["details"])

    missing_route = await client.get("/api/v1/несуществующий-маршрут")
    assert missing_route.status_code == 404
    assert missing_route.json()["error"]["message"] == "Маршрут API не найден"

    report = await client.post(f"/api/v1/pages/{page['id']}/validate", headers=headers)
    assert report.status_code == 200
    issues = report.json()["issues"]
    assert issues
    assert all(_contains_russian(issue["message"]) for issue in issues)
