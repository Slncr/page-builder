from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

from app.models import Role
from app.schemas import Block, PageDocument, ValidationIssue


def json_schema_error_message(error: ValidationError) -> str:
    validator = error.validator
    if validator == "required":
        required = error.validator_value if isinstance(error.validator_value, list) else []
        instance = error.instance if isinstance(error.instance, dict) else {}
        missing = next((name for name in required if name not in instance), None)
        return (
            f"Обязательное поле '{missing}' не заполнено"
            if missing
            else "Не заполнено обязательное поле"
        )
    if validator == "additionalProperties":
        return "Объект содержит неподдерживаемые поля"
    if validator == "type":
        type_names = {
            "array": "списком",
            "boolean": "логическим значением",
            "integer": "целым числом",
            "null": "пустым значением",
            "number": "числом",
            "object": "объектом",
            "string": "строкой",
        }
        expected = error.validator_value
        if isinstance(expected, list):
            translated = ", ".join(type_names.get(str(item), str(item)) for item in expected)
            return f"Значение должно иметь один из типов: {translated}"
        return f"Значение должно быть {type_names.get(str(expected), str(expected))}"
    if validator == "enum":
        return "Указано неподдерживаемое значение"
    if validator == "format":
        if error.validator_value == "uuid":
            return "Значение должно быть корректным UUID"
        return "Значение имеет некорректный формат"
    if validator == "minLength":
        return f"Длина строки должна быть не меньше {error.validator_value} символов"
    if validator == "maxLength":
        return f"Длина строки должна быть не больше {error.validator_value} символов"
    if validator == "minItems":
        return f"Количество элементов должно быть не меньше {error.validator_value}"
    if validator == "maxItems":
        return f"Количество элементов должно быть не больше {error.validator_value}"
    if validator == "minimum":
        return f"Значение должно быть не меньше {error.validator_value}"
    if validator == "maximum":
        return f"Значение должно быть не больше {error.validator_value}"
    if validator in {"oneOf", "anyOf"}:
        return "Значение не соответствует ни одному из допустимых вариантов"
    return "Значение не соответствует схеме блока"


@dataclass(frozen=True)
class BlockDefinition:
    type: str
    title: str
    category: str
    description: str
    schema: dict[str, Any]
    current_version: str = "1.0"
    html_fields: tuple[str, ...] = ()
    admin_only: bool = False
    can_have_children: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "title": self.title,
            "category": self.category,
            "description": self.description,
            "currentVersion": self.current_version,
            "versions": {
                self.current_version: {
                    "schema": self.schema,
                    "sanitizer": {"htmlFields": list(self.html_fields)},
                }
            },
            "ui": {
                "adminOnly": self.admin_only,
                "canHaveChildren": self.can_have_children,
            },
        }


def _schema(
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": True,
        "properties": properties or {},
        "required": required or [],
    }


DEFINITIONS = (
    BlockDefinition(
        "section",
        "Раздел",
        "layout",
        "Раздел верхнего уровня страницы",
        _schema(
            {
                "anchorId": {"type": "string"},
                "backgroundType": {
                    "enum": ["none", "color", "image", "gradient"],
                },
                "containerWidth": {"enum": ["default", "narrow", "wide", "full"]},
            }
        ),
        can_have_children=True,
    ),
    BlockDefinition(
        "container",
        "Контейнер",
        "layout",
        "Контейнер с настраиваемой шириной",
        _schema(
            {
                "width": {"enum": ["narrow", "default", "wide", "full"]},
                "align": {"enum": ["left", "center", "right"]},
            }
        ),
        can_have_children=True,
    ),
    BlockDefinition(
        "columns",
        "Колонки",
        "layout",
        "Адаптивная сетка колонок",
        _schema(
            {
                "layout": {"oneOf": [{"type": "integer"}, {"type": "string"}]},
                "stackOnMobile": {"type": "boolean"},
            },
            ["layout"],
        ),
        can_have_children=True,
    ),
    BlockDefinition(
        "spacer",
        "Отступ",
        "layout",
        "Адаптивный вертикальный отступ",
        _schema({"height": {"type": ["integer", "number", "string"]}}, ["height"]),
    ),
    BlockDefinition(
        "divider",
        "Разделитель",
        "layout",
        "Визуальный разделитель",
        _schema({"style": {"enum": ["solid", "dashed", "dotted"]}}, ["style"]),
    ),
    BlockDefinition(
        "heading",
        "Заголовок",
        "typography",
        "Семантический заголовок",
        _schema(
            {
                "text": {"type": "string", "minLength": 1},
                "level": {"enum": ["h1", "h2", "h3", "h4", "h5", "h6"]},
            },
            ["text", "level"],
        ),
    ),
    BlockDefinition(
        "text",
        "Форматированный текст",
        "typography",
        "Безопасный форматированный текст",
        _schema({"html": {"type": "string"}}, ["html"]),
        html_fields=("html",),
    ),
    BlockDefinition(
        "quote",
        "Цитата",
        "typography",
        "Цитата с указанием авторства",
        _schema({"text": {"type": "string", "minLength": 1}}, ["text"]),
        html_fields=("text",),
    ),
    BlockDefinition(
        "image",
        "Изображение",
        "media",
        "Изображение из медиатеки",
        _schema(
            {
                "assetId": {"type": "string", "format": "uuid"},
                "alt": {"type": "string"},
                "decorative": {"type": "boolean"},
            },
            ["assetId"],
        ),
    ),
    BlockDefinition(
        "gallery",
        "Галерея",
        "media",
        "Адаптивная галерея изображений",
        _schema({"assets": {"type": "array", "minItems": 1}}, ["assets"]),
    ),
    BlockDefinition(
        "video",
        "Видео",
        "media",
        "Видеоплеер с разрешёнными источниками",
        _schema(
            {
                "provider": {"enum": ["youtube", "vimeo", "file", "custom"]},
                "videoUrl": {"type": "string"},
            },
            ["provider", "videoUrl"],
        ),
    ),
    BlockDefinition(
        "file",
        "Файл",
        "media",
        "Файл для скачивания из медиатеки",
        _schema(
            {
                "assetId": {"type": "string", "format": "uuid"},
                "label": {"type": "string", "minLength": 1},
            },
            ["assetId", "label"],
        ),
    ),
    BlockDefinition(
        "button",
        "Кнопка",
        "actions",
        "Кнопка призыва к действию",
        _schema(
            {
                "label": {"type": "string", "minLength": 1},
                "url": {"type": "string", "minLength": 1},
            },
            ["label", "url"],
        ),
    ),
    BlockDefinition(
        "cta",
        "Призыв к действию",
        "actions",
        "Раздел с призывом к действию",
        _schema({"title": {"type": "string"}, "buttons": {"type": "array"}}, ["title"]),
        html_fields=("text",),
    ),
    BlockDefinition(
        "card",
        "Карточка",
        "content",
        "Переиспользуемая карточка контента",
        _schema({"title": {"type": "string", "minLength": 1}}, ["title"]),
        html_fields=("text",),
    ),
    BlockDefinition(
        "featureList",
        "Список преимуществ",
        "content",
        "Сетка преимуществ",
        _schema({"items": {"type": "array", "minItems": 1}}, ["items"]),
    ),
    BlockDefinition(
        "accordion",
        "Аккордеон",
        "content",
        "Доступный раскрывающийся список",
        _schema({"items": {"type": "array", "minItems": 1}}, ["items"]),
    ),
    BlockDefinition(
        "tabs",
        "Вкладки",
        "content",
        "Доступный контент с вкладками",
        _schema({"tabs": {"type": "array", "minItems": 1}}, ["tabs"]),
    ),
    BlockDefinition(
        "table",
        "Таблица",
        "content",
        "Доступная простая таблица данных",
        _schema({"rows": {"type": "array", "minItems": 1}}, ["rows"]),
    ),
    BlockDefinition(
        "list",
        "Список",
        "content",
        "Структурированный список",
        _schema(
            {
                "items": {"type": "array", "minItems": 1},
                "style": {"enum": ["bullets", "numbers", "checks"]},
            },
            ["items", "style"],
        ),
    ),
    BlockDefinition(
        "form",
        "Форма",
        "forms",
        "Настраиваемая форма сбора заявок",
        _schema(
            {
                "formId": {"type": "string", "format": "uuid"},
                "fields": {"type": "array"},
                "submitLabel": {"type": "string"},
            }
        ),
    ),
    BlockDefinition(
        "embed",
        "Встраиваемый блок",
        "special",
        "Внешний контент из разрешённых источников",
        _schema(
            {
                "provider": {
                    "enum": ["youtube", "vimeo", "google_maps", "yandex_maps"],
                },
                "url": {"type": "string"},
            },
            ["provider", "url"],
        ),
    ),
    BlockDefinition(
        "html",
        "Пользовательский HTML",
        "special",
        "Безопасный пользовательский HTML для администраторов",
        _schema({"html": {"type": "string"}}, ["html"]),
        html_fields=("html",),
        admin_only=True,
    ),
    BlockDefinition(
        "map",
        "Карта",
        "special",
        "Карта от разрешённого поставщика",
        _schema(
            {
                "provider": {"enum": ["google", "yandex"]},
                "address": {"type": "string"},
            },
            ["provider"],
        ),
    ),
    BlockDefinition(
        "faq",
        "Частые вопросы",
        "special",
        "Частые вопросы с необязательной микроразметкой",
        _schema({"items": {"type": "array", "minItems": 1}}, ["items"]),
    ),
    BlockDefinition(
        "breadcrumbs",
        "Хлебные крошки",
        "special",
        "Автоматические или ручные хлебные крошки",
        _schema({"source": {"enum": ["auto", "manual"]}}, ["source"]),
    ),
    BlockDefinition(
        "pageList",
        "Список страниц",
        "special",
        "Динамический список страниц конструктора",
        _schema(
            {
                "sourceType": {"enum": ["folder", "tag", "manual"]},
                "limit": {"type": "integer", "minimum": 1},
            },
            ["sourceType"],
        ),
    ),
)


class BlockRegistry:
    registry_version = "1.0.0"
    document_schema_versions = ("1.0",)
    max_nesting_depth = 5

    def __init__(self) -> None:
        self._definitions = {definition.type: definition for definition in DEFINITIONS}

    @property
    def block_types(self) -> tuple[str, ...]:
        return tuple(self._definitions)

    def get(self, block_type: str) -> BlockDefinition | None:
        return self._definitions.get(block_type)

    def manifest(self) -> dict[str, Any]:
        return {
            "registryVersion": self.registry_version,
            "documentSchemaVersions": list(self.document_schema_versions),
            "blocks": [definition.as_dict() for definition in DEFINITIONS],
        }

    def validate(
        self,
        document: PageDocument,
        *,
        actor_role: str | None = None,
        prepublish: bool = False,
    ) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if document.schema_version not in self.document_schema_versions:
            issues.append(
                ValidationIssue(
                    path="schemaVersion",
                    code="unsupported_schema_version",
                    message=f"Схема документа {document.schema_version} не поддерживается",
                )
            )

        h1_count = 0

        def visit(block: Block, path: str, depth: int) -> None:
            nonlocal h1_count
            definition = self.get(block.type)
            if definition is None:
                issues.append(
                    ValidationIssue(
                        path=f"{path}.type",
                        code="unknown_block",
                        message=f"Тип блока '{block.type}' не зарегистрирован",
                    )
                )
                return
            if block.version != definition.current_version:
                issues.append(
                    ValidationIssue(
                        path=f"{path}.version",
                        code="unsupported_block_version",
                        message=(
                            f"Версия {block.version} блока '{block.type}' не поддерживается; "
                            f"используйте версию {definition.current_version}"
                        ),
                    )
                )
            if definition.admin_only and actor_role and actor_role != Role.ADMIN.value:
                issues.append(
                    ValidationIssue(
                        path=path,
                        code="admin_only_block",
                        message=(
                            f"Блок типа '{block.type}' может редактировать только администратор"
                        ),
                    )
                )
            validator = Draft202012Validator(
                definition.schema,
                format_checker=FormatChecker(),
            )
            for error in sorted(
                validator.iter_errors(block.props),
                key=lambda item: list(item.absolute_path),
            ):
                suffix = "".join(
                    f"[{part}]" if isinstance(part, int) else f".{part}"
                    for part in error.absolute_path
                )
                issues.append(
                    ValidationIssue(
                        path=f"{path}.props{suffix}",
                        code="invalid_block_props",
                        message=json_schema_error_message(error),
                    )
                )
            if depth > self.max_nesting_depth:
                issues.append(
                    ValidationIssue(
                        path=path,
                        code="max_nesting",
                        message=(
                            f"Глубина вложенности блоков не может превышать "
                            f"{self.max_nesting_depth} уровней"
                        ),
                    )
                )
            nested = [item for item in block.children if isinstance(item, Block)]
            for slot in block.slots.values():
                nested.extend(item for item in slot if isinstance(item, Block))
            if nested and not definition.can_have_children:
                issues.append(
                    ValidationIssue(
                        path=path,
                        code="children_not_allowed",
                        message=f"Блок типа '{block.type}' не может содержать дочерние блоки",
                    )
                )
            for index, child in enumerate(nested):
                visit(child, f"{path}.children[{index}]", depth + 1)

            if block.type == "heading" and block.props.get("level") == "h1":
                h1_count += 1
            if block.type == "image" and not (
                block.props.get("decorative") is True or str(block.props.get("alt", "")).strip()
            ):
                issues.append(
                    ValidationIssue(
                        path=f"{path}.props.alt",
                        code="missing_alt",
                        message=(
                            "Для содержательного изображения нужен альтернативный текст "
                            "или признак decorative=true"
                        ),
                    )
                )
            if (
                block.type == "video"
                and block.props.get("autoplay")
                and not block.props.get("muted")
            ):
                issues.append(
                    ValidationIssue(
                        path=f"{path}.props.muted",
                        code="unsafe_autoplay",
                        message="Видео с автозапуском должно быть без звука",
                    )
                )
            if block.type == "form" and not (
                block.props.get("formId") or block.props.get("fields")
            ):
                issues.append(
                    ValidationIssue(
                        path=f"{path}.props",
                        code="empty_form",
                        message="Форме нужен formId или хотя бы одно настроенное поле",
                    )
                )

        for index, block in enumerate(document.blocks):
            visit(block, f"blocks[{index}]", 1)

        if prepublish:
            if not document.blocks:
                issues.append(
                    ValidationIssue(
                        path="blocks",
                        code="empty_page",
                        message="Для публикации страница должна содержать хотя бы один блок",
                    )
                )
            expected_h1_count = 0 if document.layout.show_page_title else 1
            if h1_count != expected_h1_count:
                requirement = (
                    "не должна содержать H1, потому что его выводит оболочка сайта"
                    if document.layout.show_page_title
                    else "должна содержать ровно один заголовок H1"
                )
                issues.append(
                    ValidationIssue(
                        path="blocks",
                        code="invalid_h1_count",
                        message=(
                            f"Для публикации страница {requirement}; "
                            f"найдено: {h1_count}"
                        ),
                    )
                )
            if not document.page_meta.meta_description:
                issues.append(
                    ValidationIssue(
                        path="pageMeta.metaDescription",
                        code="missing_meta_description",
                        message="Перед публикацией необходимо заполнить метаописание",
                    )
                )
        return issues


registry = BlockRegistry()
