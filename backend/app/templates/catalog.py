"""Built-in page templates for integrated clinic sites."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.registry import registry
from app.schemas import PageDocument

_CATALOG_PATH = Path(__file__).with_name("site_templates.json")

LEGACY_SITE_TEMPLATE_SLUGS = frozenset(
    {
        "home-clinic",
        "modern-medical",
        "promo-campaign",
        "news-announcement",
        "news-new-service",
        "news-patient-case",
        "news-award",
        "news-holiday",
        "article-expert",
        "article-pediatric",
        "article-symptom",
        "article-short",
    }
)


def load_site_templates() -> list[dict[str, Any]]:
    raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    validated: list[dict[str, Any]] = []
    for item in raw:
        document = PageDocument.model_validate(item["document"])
        issues = registry.validate(document, actor_role="Admin")
        if issues:
            messages = "; ".join(issue.message for issue in issues[:3])
            raise ValueError(f"Template '{item['slug']}' failed validation: {messages}")
        validated.append({**item, "document": document})
    return validated
