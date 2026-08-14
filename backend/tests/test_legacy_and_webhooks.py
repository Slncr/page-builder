from __future__ import annotations

import httpx
import pytest
from asgi_lifespan import LifespanManager

from app.config import Settings
from app.errors import AppError
from app.importer import LegacyImporter, LegacyPage, LegacyRouteResult
from app.main import create_app
from app.schemas import PageDocument
from app.webhooks import WebhookDispatcher
from tests.conftest import bootstrap_admin, create_site, page_document


class ExampleLegacyImporter(LegacyImporter):
    async def inventory(self) -> list[dict[str, object]]:
        return [{"sourceId": "legacy-42", "path": "/old/about"}]

    async def import_page(self, source_id: str) -> LegacyPage:
        if source_id != "legacy-42":
            raise LookupError(source_id)
        return LegacyPage(
            source_id=source_id,
            source_url="https://legacy.example/old/about",
            title="Imported About",
            document=PageDocument.model_validate(page_document("Imported")),
            warnings=("Unsupported widget was omitted",),
            fingerprint="stable-fingerprint",
        )

    async def resolve(self, path: str, locale: str | None = None) -> LegacyRouteResult:
        return LegacyRouteResult(metadata={"path": path, "locale": locale})


@pytest.mark.asyncio
async def test_authenticated_legacy_inventory_and_idempotent_import(
    settings: Settings,
) -> None:
    app = create_app(settings, legacy_importer=ExampleLegacyImporter())
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            unauthorized = await client.get("/api/v1/legacy/inventory")
            assert unauthorized.status_code == 401
            admin = await bootstrap_admin(client)
            token = str(admin["accessToken"])
            site = await create_site(client, token)
            inventory = await client.get(
                "/api/v1/legacy/inventory",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert inventory.status_code == 200
            assert inventory.json()["count"] == 1
            fallback = await client.get(
                "/api/v1/public/route",
                params={"path": "/legacy-only"},
            )
            assert fallback.status_code == 200
            assert fallback.json()["mode"] == "legacy"
            request_body = {
                "sourceId": "legacy-42",
                "siteId": site["id"],
            }
            first = await client.post(
                "/api/v1/legacy/import",
                headers={"Authorization": f"Bearer {token}"},
                json=request_body,
            )
            assert first.status_code == 200, first.text
            assert first.json()["created"] is True
            assert first.json()["page"]["status"] == "imported_draft"
            assert first.json()["warnings"]
            second = await client.post(
                "/api/v1/legacy/import",
                headers={"Authorization": f"Bearer {token}"},
                json=request_body,
            )
            assert second.status_code == 200, second.text
            assert second.json()["created"] is False
            assert second.json()["updated"] is False
            assert second.json()["page"]["id"] == first.json()["page"]["id"]


@pytest.mark.asyncio
async def test_webhook_dispatcher_rejects_private_networks(settings: Settings) -> None:
    protected_settings = settings.model_copy(
        update={
            "webhook_allowed_hosts": ["127.0.0.1"],
            "webhook_allow_http": True,
        }
    )
    dispatcher = WebhookDispatcher(protected_settings)
    with pytest.raises(AppError) as error:
        await dispatcher.validate_target("http://127.0.0.1/hook")
    assert getattr(error.value, "code", None) == "unsafe_webhook_address"
