from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError


@dataclass(frozen=True)
class NormalizedImage:
    data: bytes
    content_type: str
    extension: str
    width: int
    height: int
    metadata: dict[str, Any]


@dataclass(frozen=True)
class GeneratedRendition:
    name: str
    data: bytes
    format: str
    content_type: str
    extension: str
    width: int
    height: int
    checksum: str


@dataclass(frozen=True)
class ImageOptimizeSettings:
    quality: int = 85
    max_bytes: int = 512_000
    max_dimension: int = 2048
    min_quality: int = 40
    min_dimension: int = 320


@dataclass(frozen=True)
class OptimizedImage:
    data: bytes
    width: int
    height: int
    quality_used: int


def _prepare_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"}:
        background = Image.new("RGB", image.size, "white")
        alpha = image.getchannel("A")
        background.paste(image, mask=alpha)
        return background
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def _encode_webp(image: Image.Image, quality: int) -> bytes:
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=quality, method=6)
    return output.getvalue()


def _fit_dimension(image: Image.Image, max_dimension: int) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_dimension:
        return image
    scale = max_dimension / longest
    return image.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS,
    )


def _decode_image(data: bytes) -> tuple[Image.Image, dict[str, Any]]:
    try:
        with Image.open(io.BytesIO(data)) as source:
            source_format = (source.format or "JPEG").upper()
            if source_format == "JPG":
                source_format = "JPEG"
            animated = bool(getattr(source, "is_animated", False))
            frame_count = int(getattr(source, "n_frames", 1))
            source.seek(0)
            image = ImageOps.exif_transpose(source).copy()
            image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AppError(
            415, "invalid_image", "Не удалось безопасно декодировать изображение"
        ) from exc
    return image, {
        "sourceFormat": source_format.lower(),
        "animatedSource": animated,
        "sourceFrameCount": frame_count,
        "exifRemoved": True,
    }


def _optimize_image(
    image: Image.Image,
    *,
    settings: ImageOptimizeSettings,
    byte_budget: int | None = None,
) -> OptimizedImage:
    budget = byte_budget if byte_budget is not None else settings.max_bytes
    current = _prepare_rgb(_fit_dimension(image, settings.max_dimension))

    for _ in range(10):
        low = settings.min_quality
        high = settings.quality
        best_data: bytes | None = None
        best_quality = settings.min_quality

        while low <= high:
            mid = (low + high) // 2
            candidate = _encode_webp(current, mid)
            if len(candidate) <= budget:
                best_data = candidate
                best_quality = mid
                low = mid + 1
            else:
                high = mid - 1

        if best_data is not None:
            return OptimizedImage(
                data=best_data,
                width=current.width,
                height=current.height,
                quality_used=best_quality,
            )

        width, height = current.size
        if max(width, height) <= settings.min_dimension:
            break
        next_width = max(settings.min_dimension, round(width * 0.85))
        next_height = max(settings.min_dimension, round(height * 0.85))
        if (next_width, next_height) == (width, height):
            break
        current = current.resize((next_width, next_height), Image.Resampling.LANCZOS)

    fallback = _encode_webp(current, settings.min_quality)
    return OptimizedImage(
        data=fallback,
        width=current.width,
        height=current.height,
        quality_used=settings.min_quality,
    )


def rendition_byte_budget(width: int, max_dimension: int, max_bytes: int) -> int:
    ratio = min(1.0, width / max(max_dimension, 1))
    return max(24_000, int(max_bytes * ratio * ratio))


def normalize_uploaded_image(
    data: bytes,
    quality: int,
    max_bytes: int = 512_000,
    max_dimension: int = 2048,
) -> NormalizedImage:
    image, source_meta = _decode_image(data)
    settings = ImageOptimizeSettings(
        quality=quality,
        max_bytes=max_bytes,
        max_dimension=max_dimension,
    )
    optimized = _optimize_image(image, settings=settings)
    return NormalizedImage(
        data=optimized.data,
        content_type="image/webp",
        extension=".webp",
        width=optimized.width,
        height=optimized.height,
        metadata={
            **source_meta,
            "format": "webp",
            "mode": "RGB",
            "optimizedBytes": len(optimized.data),
            "qualityUsed": optimized.quality_used,
            "maxBytes": max_bytes,
            "maxDimension": max_dimension,
        },
    )


def generate_renditions(
    data: bytes,
    widths: list[int],
    quality: int,
    max_bytes: int = 512_000,
    max_dimension: int = 2048,
) -> list[GeneratedRendition]:
    image, _ = _decode_image(data)
    settings = ImageOptimizeSettings(
        quality=quality,
        max_bytes=max_bytes,
        max_dimension=max_dimension,
    )
    generated: list[GeneratedRendition] = []
    for width in widths:
        target_height = max(1, round(image.height * width / image.width))
        resized = image.resize((width, target_height), Image.Resampling.LANCZOS)
        budget = rendition_byte_budget(width, max_dimension, max_bytes)
        optimized = _optimize_image(resized, settings=settings, byte_budget=budget)
        generated.append(
            GeneratedRendition(
                name=f"{width}w-webp",
                data=optimized.data,
                format="webp",
                content_type="image/webp",
                extension="webp",
                width=optimized.width,
                height=optimized.height,
                checksum=hashlib.sha256(optimized.data).hexdigest(),
            )
        )
    if not generated:
        raise RuntimeError("не удалось создать варианты изображения")
    return generated
