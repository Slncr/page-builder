from app.templates.catalog import load_site_templates


def walk_blocks(blocks):
    for block in blocks:
        yield block
        yield from walk_blocks([child for child in block.children if not isinstance(child, str)])


def test_site_templates_are_distinct_editorial_news_and_articles() -> None:
    templates = load_site_templates()
    slugs = {item["slug"] for item in templates}
    assert slugs == {
        "news-brief",
        "news-feature",
        "news-case",
        "news-celebration",
        "news-program",
        "article-magazine",
        "article-checklist",
        "article-kids",
        "article-triage",
        "article-minimal",
    }
    assert not slugs & {"home-clinic", "modern-medical", "promo-campaign"}
    signatures: set[tuple[str, ...]] = set()
    visual_variants: set[str] = set()
    for item in templates:
        layout = item["document"].layout
        assert layout.shell == "about"
        assert layout.show_page_title is False
        blocks = list(walk_blocks(item["document"].blocks))
        types = [block.type for block in blocks]
        assert "navbar" not in types
        assert "footer" not in types
        assert "hero" not in types
        assert types.count("heading") >= 1
        signatures.add(tuple(types))
        for block in blocks:
            if block.type == "section":
                visual_variants.add(block.props.get("styleVariant", "default"))
                assert block.props.get("containerWidth") == "full"
            if block.type == "container":
                assert block.props.get("width") != "narrow"
            urls = [block.props.get(key) for key in ("url", "href", "link") if block.props.get(key)]
            urls.extend(
                button.get("url")
                for button in block.props.get("buttons") or []
                if button.get("url")
            )
            urls.extend(
                item.get("href") for item in block.props.get("items") or [] if item.get("href")
            )
            for url in urls:
                assert "page-builder" not in url
                assert url.startswith(
                    (
                        "/doctors",
                        "/about/news",
                        "/about/articles",
                        "/services/directions",
                        "tel:",
                        "#",
                    )
                )
    assert len(signatures) >= 7
    assert len(visual_variants) >= 10
