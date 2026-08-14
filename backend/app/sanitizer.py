from __future__ import annotations

from typing import Any

import nh3

from app.registry import BlockRegistry, registry
from app.schemas import Block, PageDocument

ALLOWED_TAGS = {
    "a",
    "b",
    "blockquote",
    "br",
    "caption",
    "code",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
}
ALLOWED_ATTRIBUTES = {
    "a": {"href", "target", "title"},
    "img": {"src", "alt", "width", "height", "loading"},
    "th": {"scope", "colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    "h1": {"id"},
    "h2": {"id"},
    "h3": {"id"},
    "h4": {"id"},
    "h5": {"id"},
    "h6": {"id"},
}
URL_SCHEMES = {"http", "https", "mailto", "tel"}
RICH_VALUE_KEYS = {"answer", "body", "content", "description", "html", "richText"}


def sanitize_html(value: str) -> str:
    return nh3.clean(
        value,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=URL_SCHEMES,
        clean_content_tags={"script", "style", "iframe", "object", "embed"},
        link_rel="noopener noreferrer",
    )


def _sanitize_nested(value: Any, key: str | None = None) -> Any:
    if isinstance(value, str) and key in RICH_VALUE_KEYS:
        return sanitize_html(value)
    if isinstance(value, list):
        return [_sanitize_nested(item) for item in value]
    if isinstance(value, dict):
        return {item_key: _sanitize_nested(item, item_key) for item_key, item in value.items()}
    return value


def _sanitize_block(block: Block, block_registry: BlockRegistry) -> Block:
    definition = block_registry.get(block.type)
    props = _sanitize_nested(block.props)
    if definition:
        for field in definition.html_fields:
            if isinstance(props.get(field), str):
                props[field] = sanitize_html(props[field])
    children = [
        _sanitize_block(item, block_registry) if isinstance(item, Block) else item
        for item in block.children
    ]
    slots = {
        name: [
            _sanitize_block(item, block_registry) if isinstance(item, Block) else item
            for item in items
        ]
        for name, items in block.slots.items()
    }
    return block.model_copy(update={"props": props, "children": children, "slots": slots})


def sanitize_document(
    document: PageDocument,
    block_registry: BlockRegistry = registry,
) -> PageDocument:
    return document.model_copy(
        update={
            "blocks": [_sanitize_block(block, block_registry) for block in document.blocks],
            "settings": _sanitize_nested(document.settings),
        }
    )
