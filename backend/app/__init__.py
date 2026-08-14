"""Construktor page-builder backend."""

from typing import Any


def create_app(*args: Any, **kwargs: Any) -> Any:
    from app.main import create_app as factory

    return factory(*args, **kwargs)


__all__ = ["create_app"]
