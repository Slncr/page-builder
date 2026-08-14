from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

NOT_FOUND_MESSAGES = {
    "Resource": "Ресурс не найден",
    "Page": "Страница не найдена",
    "Published page": "Опубликованная страница не найдена",
    "Site": "Сайт не найден",
    "Revision": "Ревизия не найдена",
    "Folder": "Папка не найдена",
    "Template": "Шаблон не найден",
    "Preset": "Пресет не найден",
    "Form": "Форма не найдена",
    "Redirect": "Перенаправление не найдено",
    "Asset": "Медиафайл не найден",
    "Asset object": "Объект медиафайла не найден",
    "Rendition": "Вариант изображения не найден",
    "Rendition object": "Объект варианта изображения не найден",
    "Sitemap": "Карта сайта не найдена",
    "User": "Пользователь не найден",
    "Legacy source": "Источник прежней системы не найден",
}


def _validation_message(error: dict[str, Any]) -> str:
    error_type = str(error.get("type", ""))
    context = error.get("ctx")
    ctx = context if isinstance(context, dict) else {}
    messages = {
        "missing": "Поле обязательно для заполнения",
        "json_invalid": "Тело запроса содержит некорректный JSON",
        "extra_forbidden": "Неизвестное поле не допускается",
        "string_type": "Значение должно быть строкой",
        "string_unicode": "Строка должна содержать корректный текст",
        "string_pattern_mismatch": "Значение не соответствует требуемому формату",
        "int_type": "Значение должно быть целым числом",
        "int_parsing": "Значение должно быть целым числом",
        "float_type": "Значение должно быть числом",
        "float_parsing": "Значение должно быть числом",
        "bool_type": "Значение должно быть логическим",
        "bool_parsing": "Значение должно быть логическим",
        "uuid_type": "Значение должно быть корректным UUID",
        "uuid_parsing": "Значение должно быть корректным UUID",
        "datetime_type": "Значение должно быть датой и временем",
        "datetime_parsing": "Значение должно быть корректной датой и временем",
        "date_type": "Значение должно быть датой",
        "date_parsing": "Значение должно быть корректной датой",
        "list_type": "Значение должно быть списком",
        "dict_type": "Значение должно быть объектом",
        "model_type": "Значение должно быть объектом",
        "literal_error": "Указано неподдерживаемое значение",
        "enum": "Указано неподдерживаемое значение",
        "finite_number": "Значение должно быть конечным числом",
    }
    if error_type in messages:
        return messages[error_type]
    if error_type == "string_too_short":
        return f"Длина строки должна быть не меньше {ctx.get('min_length')} символов"
    if error_type == "string_too_long":
        return f"Длина строки должна быть не больше {ctx.get('max_length')} символов"
    if error_type == "too_short":
        return f"Количество элементов должно быть не меньше {ctx.get('min_length')}"
    if error_type == "too_long":
        return f"Количество элементов должно быть не больше {ctx.get('max_length')}"
    if error_type == "greater_than_equal":
        return f"Значение должно быть не меньше {ctx.get('ge')}"
    if error_type == "less_than_equal":
        return f"Значение должно быть не больше {ctx.get('le')}"
    if error_type == "greater_than":
        return f"Значение должно быть больше {ctx.get('gt')}"
    if error_type == "less_than":
        return f"Значение должно быть меньше {ctx.get('lt')}"
    if error_type == "value_error":
        custom_error = str(ctx.get("error", "")).strip()
        if custom_error and any(
            "а" <= char.lower() <= "я" or char.lower() == "ё" for char in custom_error
        ):
            return custom_error
    return "Некорректное значение"


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        details: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers


def error_payload(code: str, message: str, details: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, exc.details),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            {
                "location": list(error["loc"]),
                "message": _validation_message(error),
                "type": error["type"],
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_payload(
                "validation_error", "Проверка данных запроса не пройдена", details
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {
            400: ("bad_request", "Некорректный запрос"),
            401: ("not_authenticated", "Необходима аутентификация"),
            403: ("forbidden", "Недостаточно прав для выполнения этого действия"),
            404: ("not_found", "Маршрут API не найден"),
            405: ("method_not_allowed", "Метод запроса не поддерживается"),
            406: ("not_acceptable", "Запрошенный формат ответа не поддерживается"),
            408: ("request_timeout", "Время ожидания запроса истекло"),
            413: ("request_too_large", "Размер запроса превышает допустимый"),
            415: ("unsupported_media_type", "Тип содержимого запроса не поддерживается"),
            422: ("validation_error", "Проверка данных запроса не пройдена"),
            429: ("rate_limited", "Слишком много запросов; повторите попытку позже"),
            503: ("service_unavailable", "Сервис временно недоступен"),
        }
        code, message = codes.get(
            exc.status_code,
            ("http_error", "Не удалось выполнить HTTP-запрос"),
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(code, message),
            headers=exc.headers,
        )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(_request: Request, exc: IntegrityError) -> JSONResponse:
        logger.info("database integrity error", exc_info=exc)
        return JSONResponse(
            status_code=409,
            content=error_payload("conflict", "Ресурс конфликтует с существующими данными"),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled request error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_payload("internal_error", "Произошла непредвиденная ошибка"),
        )


def not_found(resource: str = "Resource") -> AppError:
    return AppError(
        404,
        "not_found",
        NOT_FOUND_MESSAGES.get(resource, f"{resource}: ресурс не найден"),
    )


def forbidden(message: str = "Недостаточно прав для выполнения этого действия") -> AppError:
    return AppError(403, "forbidden", message)


def conflict(message: str, details: Any = None) -> AppError:
    return AppError(409, "conflict", message, details=details)
