from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import socket
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.config import Settings
from app.errors import AppError


class WebhookDispatcher:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _host_allowed(self, host: str) -> bool:
        normalized = host.rstrip(".").lower()
        for entry in self.settings.webhook_allowed_hosts:
            allowed = entry.rstrip(".").lower()
            if allowed.startswith("*."):
                suffix = allowed[1:]
                if normalized.endswith(suffix) and normalized != suffix[1:]:
                    return True
            elif normalized == allowed:
                return True
        return False

    @staticmethod
    def _public_address(value: str) -> bool:
        address = ipaddress.ip_address(value)
        return not (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        )

    async def _validated_target(self, url: str) -> tuple[str, str, str]:
        parsed = urlsplit(url)
        allowed_schemes = {"https"}
        if self.settings.webhook_allow_http:
            allowed_schemes.add("http")
        if (
            parsed.scheme.lower() not in allowed_schemes
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise AppError(422, "unsafe_webhook_url", "URL вебхука не разрешён")
        if not self._host_allowed(parsed.hostname):
            raise AppError(
                422, "webhook_host_not_allowed", "Домен вебхука отсутствует в списке разрешённых"
            )
        default_port = 443 if parsed.scheme.lower() == "https" else 80
        if parsed.port not in {None, default_port}:
            raise AppError(422, "unsafe_webhook_url", "URL вебхука использует запрещённый порт")
        try:
            ipaddress.ip_address(parsed.hostname)
            addresses = [parsed.hostname]
        except ValueError:
            try:
                records = await asyncio.to_thread(
                    socket.getaddrinfo,
                    parsed.hostname,
                    parsed.port or default_port,
                    type=socket.SOCK_STREAM,
                )
            except OSError as exc:
                raise AppError(
                    422,
                    "webhook_dns_failed",
                    "Не удалось определить адрес домена вебхука",
                ) from exc
            addresses = list({record[4][0] for record in records})
        if not addresses or any(not self._public_address(address) for address in addresses):
            raise AppError(
                422,
                "unsafe_webhook_address",
                "Домен вебхука указывает на защищённую сеть",
            )
        return url, parsed.hostname, addresses[0]

    async def validate_target(self, url: str) -> str:
        validated_url, _hostname, _address = await self._validated_target(url)
        return validated_url

    async def deliver(self, url: str, payload: dict[str, object]) -> None:
        validated_url, hostname, address = await self._validated_target(url)
        parsed = urlsplit(validated_url)
        address_netloc = f"[{address}]" if ":" in address else address
        pinned_url = urlunsplit(
            (
                parsed.scheme,
                address_netloc,
                parsed.path or "/",
                parsed.query,
                "",
            )
        )
        body = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Host": hostname,
            "User-Agent": "Construktor-Webhook/1.0",
        }
        if self.settings.webhook_signing_secret is not None:
            signature = hmac.new(
                self.settings.webhook_signing_secret.get_secret_value().encode("utf-8"),
                body,
                hashlib.sha256,
            ).hexdigest()
            headers["X-Construktor-Signature-256"] = f"sha256={signature}"
        timeout = httpx.Timeout(self.settings.webhook_timeout_seconds)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            async with client.stream(
                "POST",
                pinned_url,
                content=body,
                headers=headers,
                extensions={"sni_hostname": hostname},
            ) as response:
                if response.status_code < 200 or response.status_code >= 300:
                    raise RuntimeError(f"вебхук вернул HTTP {response.status_code}")
