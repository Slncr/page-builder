from __future__ import annotations

from app.registry import registry
from app.schemas import PageDocument


def test_registry_contains_every_mandatory_non_mis_block_and_validates_props() -> None:
    expected = {
        "section",
        "container",
        "columns",
        "spacer",
        "divider",
        "heading",
        "text",
        "quote",
        "image",
        "gallery",
        "video",
        "file",
        "button",
        "cta",
        "card",
        "featureList",
        "accordion",
        "tabs",
        "table",
        "list",
        "form",
        "embed",
        "html",
        "map",
        "faq",
        "breadcrumbs",
        "pageList",
        "navbar",
        "hero",
        "stats",
        "testimonials",
        "pricing",
        "footer",
    }
    assert set(registry.block_types) == expected
    assert "misEntity" not in registry.block_types

    document = PageDocument.model_validate(
        {
            "schemaVersion": "1.0",
            "pageMeta": {},
            "blocks": [
                {
                    "id": "bad-heading",
                    "type": "heading",
                    "version": "1.0",
                    "props": {"text": "Title", "level": "h7"},
                }
            ],
        }
    )
    issues = registry.validate(document)
    assert any(issue.code == "invalid_block_props" for issue in issues)
