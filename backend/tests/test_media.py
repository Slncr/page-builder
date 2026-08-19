from __future__ import annotations

import io

from PIL import Image

from app.media import generate_renditions, normalize_uploaded_image, rendition_byte_budget


def _jpeg_bytes(size: tuple[int, int], *, quality: int = 95) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, "orange").save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def test_normalize_converts_to_webp_under_budget() -> None:
    result = normalize_uploaded_image(_jpeg_bytes((1200, 800)), quality=85, max_bytes=512_000)
    assert result.content_type == "image/webp"
    assert result.extension == ".webp"
    assert len(result.data) <= 512_000
    assert result.metadata["format"] == "webp"
    with Image.open(io.BytesIO(result.data)) as image:
        assert image.format == "WEBP"


def test_normalize_shrinks_oversized_uploads() -> None:
    result = normalize_uploaded_image(
        _jpeg_bytes((6000, 4000)),
        quality=85,
        max_bytes=512_000,
        max_dimension=2048,
    )
    assert len(result.data) <= 512_000
    assert max(result.width, result.height) <= 2048


def test_generate_renditions_use_webp_names() -> None:
    master = normalize_uploaded_image(_jpeg_bytes((1600, 900)), quality=85)
    items = generate_renditions(master.data, [320, 640], quality=85)
    assert [item.name for item in items] == ["320w-webp", "640w-webp"]
    for item in items:
        assert item.content_type == "image/webp"
        assert len(item.data) <= rendition_byte_budget(
            item.width,
            max_dimension=2048,
            max_bytes=512_000,
        )


def test_png_with_alpha_is_flattened_to_webp() -> None:
    image = Image.new("RGBA", (200, 100), (255, 0, 0, 128))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    result = normalize_uploaded_image(buffer.getvalue(), quality=85)
    assert result.content_type == "image/webp"
    with Image.open(io.BytesIO(result.data)) as converted:
        assert converted.mode == "RGB"
