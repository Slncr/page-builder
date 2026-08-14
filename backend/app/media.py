from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError

FORMAT_CONTENT_TYPES = {
    "AVIF": "image/avif",
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
FORMAT_EXTENSIONS = {
    "AVIF": "avif",
    "JPEG": "jpg",
    "PNG": "png",
    "WEBP": "webp",
}


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


def _save(image: Image.Image, output_format: str, quality: int) -> bytes:
    output = io.BytesIO()
    prepared = image
    options: dict[str, Any] = {}
    if output_format == "JPEG":
        if prepared.mode not in {"RGB", "L"}:
            background = Image.new("RGB", prepared.size, "white")
            if prepared.mode == "RGBA":
                background.paste(prepared, mask=prepared.getchannel("A"))
            else:
                background.paste(prepared.convert("RGB"))
            prepared = background
        options = {"quality": quality, "optimize": True, "progressive": True}
    elif output_format == "PNG":
        options = {"optimize": True}
    elif output_format in {"WEBP", "AVIF"}:
        options = {"quality": quality}
    prepared.save(output, format=output_format, **options)
    return output.getvalue()


def _output_format(source_format: str | None) -> str:
    candidate = (source_format or "").upper()
    if candidate == "JPG":
        candidate = "JPEG"
    if candidate not in FORMAT_CONTENT_TYPES:
        if candidate == "GIF":
            return "PNG"
        raise AppError(415, "unsupported_image", "Формат изображения нельзя безопасно обработать")
    return candidate


def normalize_uploaded_image(data: bytes, quality: int) -> NormalizedImage:
    try:
        with Image.open(io.BytesIO(data)) as source:
            source_format = _output_format(source.format)
            animated = bool(getattr(source, "is_animated", False))
            frame_count = int(getattr(source, "n_frames", 1))
            source.seek(0)
            image = ImageOps.exif_transpose(source).copy()
            image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AppError(
            415, "invalid_image", "Не удалось безопасно декодировать изображение"
        ) from exc
    try:
        normalized = _save(image, source_format, quality)
    except (OSError, ValueError, KeyError) as exc:
        raise AppError(
            415, "unsupported_image", "Не удалось безопасно сохранить изображение"
        ) from exc
    return NormalizedImage(
        data=normalized,
        content_type=FORMAT_CONTENT_TYPES[source_format],
        extension=f".{FORMAT_EXTENSIONS[source_format]}",
        width=image.width,
        height=image.height,
        metadata={
            "format": source_format.lower(),
            "mode": image.mode,
            "animatedSource": animated,
            "sourceFrameCount": frame_count,
            "exifRemoved": True,
        },
    )


def supported_rendition_formats(source_format: str) -> list[str]:
    formats = [source_format.upper()]
    save_formats = Image.SAVE
    if "WEBP" in save_formats and "WEBP" not in formats:
        formats.append("WEBP")
    if "AVIF" in save_formats and "AVIF" not in formats:
        formats.append("AVIF")
    return [item for item in formats if item in FORMAT_CONTENT_TYPES]


def generate_renditions(
    data: bytes,
    widths: list[int],
    quality: int,
) -> list[GeneratedRendition]:
    try:
        with Image.open(io.BytesIO(data)) as source:
            source_format = _output_format(source.format)
            source.seek(0)
            image = ImageOps.exif_transpose(source).copy()
            image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise RuntimeError("не удалось декодировать изображение из хранилища") from exc
    generated: list[GeneratedRendition] = []
    for width in widths:
        height = max(1, round(image.height * width / image.width))
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        for output_format in supported_rendition_formats(source_format):
            try:
                rendition_data = _save(resized, output_format, quality)
            except (OSError, ValueError, KeyError):
                continue
            format_name = output_format.lower()
            generated.append(
                GeneratedRendition(
                    name=f"{width}w-{format_name}",
                    data=rendition_data,
                    format=format_name,
                    content_type=FORMAT_CONTENT_TYPES[output_format],
                    extension=FORMAT_EXTENSIONS[output_format],
                    width=width,
                    height=height,
                    checksum=hashlib.sha256(rendition_data).hexdigest(),
                )
            )
    if not generated:
        raise RuntimeError("нет доступного кодировщика для вариантов изображения")
    return generated
