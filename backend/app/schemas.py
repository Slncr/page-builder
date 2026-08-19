from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

from app.models import PageContentType, PageStatus, ReviewDecision, Role

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
SECTION_KEY_PATTERN = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
USERNAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])$")


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class APIModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=to_camel,
    )


def validate_section_key(value: str | None) -> str | None:
    if value is None:
        return None
    if not SECTION_KEY_PATTERN.fullmatch(value):
        raise ValueError(
            "sectionKey может содержать только строчные латинские буквы, цифры, точки, "
            "знаки подчёркивания и дефисы"
        )
    return value


def normalize_username(value: str | None) -> str | None:
    if value is None:
        return None
    username = value.strip().lower()
    if not USERNAME_PATTERN.fullmatch(username):
        raise ValueError(
            "логин должен содержать от 3 до 64 латинских букв, цифр, точек, "
            "знаков подчёркивания или дефисов"
        )
    return username


class ListingMeta(APIModel):
    model_config = ConfigDict(
        extra="forbid",
        from_attributes=True,
        populate_by_name=True,
        alias_generator=to_camel,
    )

    excerpt: str | None = Field(default=None, max_length=2000)
    cover_asset_id: UUID | None = None
    published_display_at: datetime | None = None
    author_name: str | None = Field(default=None, max_length=200)
    author_title: str | None = Field(default=None, max_length=200)
    sort_order: int = 0
    featured: bool = False
    hidden_from_lists: bool = False
    menu_label: str | None = Field(default=None, max_length=240)


class PageMeta(APIModel):
    title: str | None = Field(default=None, max_length=240)
    seo_title: str | None = Field(default=None, alias="seoTitle", max_length=70)
    meta_description: str | None = Field(default=None, alias="metaDescription", max_length=320)
    canonical: str | None = Field(default=None, max_length=2048)
    robots: Literal["index,follow", "noindex,follow", "noindex,nofollow"] = "index,follow"
    og_title: str | None = Field(default=None, alias="ogTitle", max_length=100)
    og_description: str | None = Field(default=None, alias="ogDescription", max_length=320)
    og_image: UUID | None = Field(default=None, alias="ogImage")
    twitter_card: Literal["summary", "summary_large_image"] = Field(
        default="summary_large_image", alias="twitterCard"
    )
    sitemap_priority: float = Field(default=0.5, alias="sitemapPriority", ge=0, le=1)
    change_frequency: Literal[
        "always", "hourly", "daily", "weekly", "monthly", "yearly", "never"
    ] = Field(default="monthly", alias="changeFrequency")


class PageLayout(APIModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        alias_generator=to_camel,
    )

    shell: Literal[
        "auto",
        "plain",
        "home",
        "about",
        "services",
        "labs",
        "doctors",
        "branches",
    ] = "auto"
    show_page_title: StrictBool = False
    breadcrumbs: Literal["auto", "hidden"] = "auto"


class Block(APIModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        alias_generator=to_camel,
    )

    id: str = Field(min_length=1, max_length=100)
    type: str = Field(min_length=1, max_length=100)
    version: str = Field(default="1.0", min_length=1, max_length=20)
    props: dict[str, Any] = Field(default_factory=dict)
    children: list[Block | str] = Field(default_factory=list)
    slots: dict[str, list[Block | str]] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def migrate_data_to_props(cls, value: Any) -> Any:
        if isinstance(value, dict) and "props" not in value and "data" in value:
            value = {**value, "props": value["data"]}
            value.pop("data", None)
        return value


class PageDocument(APIModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        alias_generator=to_camel,
    )

    schema_version: str = Field(default="1.0", alias="schemaVersion", pattern=r"^\d+\.\d+$")
    page_meta: PageMeta = Field(default_factory=PageMeta, alias="pageMeta")
    layout: PageLayout = Field(default_factory=PageLayout)
    locale: str = Field(default="ru", min_length=2, max_length=20)
    blocks: list[Block] = Field(default_factory=list, max_length=500)
    assets_refs: list[UUID] = Field(default_factory=list, alias="assetsRefs")
    settings: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        if "pageMeta" not in migrated and "page_meta" not in migrated and "seo" in migrated:
            seo = migrated.pop("seo")
            migrated["pageMeta"] = {
                "seoTitle": seo.get("title"),
                "metaDescription": seo.get("description"),
                "canonical": seo.get("canonical_url"),
                "robots": "noindex,follow" if seo.get("noindex") else "index,follow",
            }
        return migrated

    @field_validator("blocks")
    @classmethod
    def unique_block_ids(cls, blocks: list[Block]) -> list[Block]:
        def walk(items: list[Block | str]) -> list[str]:
            result: list[str] = []
            for item in items:
                if isinstance(item, str):
                    continue
                result.append(item.id)
                result.extend(walk(item.children))
                for slot in item.slots.values():
                    result.extend(walk(slot))
            return result

        ids = walk(blocks)
        if len(ids) > 500:
            raise ValueError("документ страницы не может содержать более 500 блоков")
        if len(ids) != len(set(ids)):
            raise ValueError("идентификаторы блоков должны быть уникальными")
        return blocks


class RegisterRequest(APIModel):
    email: EmailStr
    username: str | None = None
    display_name: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=12, max_length=256)
    role: Role = Role.VIEWER

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str | None) -> str | None:
        return normalize_username(value)


class LoginRequest(APIModel):
    login: str = Field(
        min_length=1,
        max_length=320,
        validation_alias=AliasChoices("login", "email"),
    )
    password: str = Field(min_length=1, max_length=256)

    @field_validator("login")
    @classmethod
    def valid_login(cls, value: str) -> str:
        login = value.strip().lower()
        if not login:
            raise ValueError("укажите логин или адрес электронной почты")
        return login


class RefreshRequest(APIModel):
    refresh_token: str | None = None


class UserOut(APIModel):
    id: UUID
    email: EmailStr
    username: str | None = None
    display_name: str
    role: Role
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class UserPatch(APIModel):
    username: str | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    role: Role | None = None
    is_active: bool | None = None

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str | None) -> str | None:
        return normalize_username(value)


class TokenResponse(APIModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class SiteCreate(APIModel):
    slug: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    domains: list[str] = Field(default_factory=list, max_length=50)
    default_locale: str = Field(default="ru", min_length=2, max_length=20)

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value: str) -> str:
        value = value.lower()
        if not SLUG_PATTERN.fullmatch(value):
            raise ValueError(
                "slug может содержать только строчные латинские буквы, цифры, точки, "
                "знаки подчёркивания и дефисы"
            )
        return value


class SiteOut(APIModel):
    id: UUID
    slug: str
    name: str
    domains: list[str]
    default_locale: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class FolderCreate(APIModel):
    site_id: UUID
    parent_id: UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    sort_order: int = 0


class FolderOut(FolderCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime


class PageCreate(APIModel):
    site_id: UUID
    folder_id: UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    slug: str = Field(min_length=1, max_length=200)
    route_path: str = Field(default="/", min_length=1, max_length=1024)
    content_type: PageContentType = PageContentType.GENERIC
    section_key: str | None = Field(default=None, max_length=100)
    listing_meta: ListingMeta = Field(default_factory=ListingMeta)
    document: PageDocument = Field(default_factory=PageDocument)

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value: str) -> str:
        value = value.lower()
        if not SLUG_PATTERN.fullmatch(value):
            raise ValueError(
                "slug может содержать только строчные латинские буквы, цифры, точки, "
                "знаки подчёркивания и дефисы"
            )
        return value

    @field_validator("section_key")
    @classmethod
    def valid_section_key(cls, value: str | None) -> str | None:
        return validate_section_key(value)


class PagePatch(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    slug: str | None = Field(default=None, min_length=1, max_length=200)
    folder_id: UUID | None = None
    render_mode: Literal["legacy", "builder", "fallback_legacy"] | None = None
    content_type: PageContentType | None = None
    section_key: str | None = Field(default=None, max_length=100)
    listing_meta: ListingMeta | None = None

    @field_validator("slug")
    @classmethod
    def valid_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.lower()
        if not SLUG_PATTERN.fullmatch(value):
            raise ValueError(
                "slug может содержать только строчные латинские буквы, цифры, точки, "
                "знаки подчёркивания и дефисы"
            )
        return value

    @field_validator("section_key")
    @classmethod
    def valid_section_key(cls, value: str | None) -> str | None:
        return validate_section_key(value)


class PageOut(APIModel):
    id: UUID
    site_id: UUID
    folder_id: UUID | None
    title: str
    slug: str
    content_type: PageContentType
    section_key: str | None
    listing_meta: ListingMeta
    status: PageStatus
    render_mode: Literal["legacy", "builder", "fallback_legacy"]
    source_type: str
    review_status: ReviewDecision
    review_comment: str | None
    draft_version: int
    published_revision_id: UUID | None
    published_at: datetime | None
    locked_by: UUID | None
    locked_at: datetime | None
    source_identifier: str | None
    source_url: str | None
    import_diagnostics: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class PageListOut(APIModel):
    items: list[PageOut]
    total: int
    page: int
    page_size: int


class TrashPageOut(APIModel):
    page: PageOut
    deleted_at: datetime
    purge_at: datetime


class PageLockRequest(APIModel):
    force: bool = False


class PageLockOut(APIModel):
    page_id: UUID
    locked: bool
    locked_by: UUID | None = None
    locked_at: datetime | None = None
    expires_at: datetime | None = None
    is_owner: bool = False
    read_only: bool = False
    warning: str | None = None


class PreviewTokenOut(APIModel):
    token: str
    expires_at: datetime
    preview_url: str


class DraftOut(APIModel):
    page_id: UUID
    version: int
    document: PageDocument
    updated_at: datetime


class PageDetailOut(APIModel):
    page: PageOut
    draft: DraftOut
    route_path: str | None


class PublicPageListItem(APIModel):
    id: UUID
    site_id: UUID
    title: str
    slug: str
    content_type: PageContentType
    section_key: str | None
    listing_meta: ListingMeta
    path: str
    published_at: datetime | None
    updated_at: datetime
    revision_id: UUID
    etag: str
    checksum: str


class PublicPageListOut(APIModel):
    items: list[PublicPageListItem]
    total: int
    page: int
    page_size: int
    etag: str


class PublicPageIdentity(APIModel):
    id: UUID
    site_id: UUID
    title: str
    slug: str
    content_type: PageContentType
    section_key: str | None
    listing_meta: ListingMeta
    path: str


class PublicPageDetailOut(APIModel):
    page: PublicPageIdentity
    revision_id: UUID
    document: PageDocument
    etag: str
    checksum: str


class PublicResolveOut(APIModel):
    mode: str
    cache_ttl: int
    page_id: UUID | None = None
    revision_id: UUID | None = None
    path: str | None = None
    content_type: PageContentType | None = None
    section_key: str | None = None
    listing_meta: ListingMeta | None = None
    etag: str | None = None
    location: str | None = None
    status_code: int | None = None
    metadata: dict[str, Any] | None = None
    fallback_allowed: bool | None = None


class DraftUpdate(APIModel):
    expected_version: int | None = Field(
        default=None,
        ge=1,
        alias="baseVersion",
        validation_alias=AliasChoices("baseVersion", "expectedVersion", "expected_version"),
    )
    document: PageDocument


class RevisionOut(APIModel):
    id: UUID
    page_id: UUID
    number: int
    document: PageDocument
    checksum: str
    draft_version: int | None
    kind: str
    message: str | None
    source_revision_id: UUID | None
    created_by: UUID | None
    created_at: datetime


class RestoreRequest(APIModel):
    expected_version: int = Field(
        ge=1,
        alias="baseVersion",
        validation_alias=AliasChoices("baseVersion", "expectedVersion", "expected_version"),
    )


class ReviewRequest(APIModel):
    comment: str | None = Field(default=None, max_length=2000)


class PublishRequest(APIModel):
    route_path: str | None = Field(default=None, min_length=1, max_length=1024)
    message: str | None = Field(default=None, max_length=500)
    expected_version: int = Field(
        ge=1,
        validation_alias=AliasChoices("expectedVersion", "expected_version", "baseVersion"),
    )


class ScheduleRequest(PublishRequest):
    run_at: datetime


class PublishResult(APIModel):
    page: PageOut
    revision: RevisionOut | None = None
    job_id: UUID | None = None


class BatchPublishItem(APIModel):
    page_id: UUID
    expected_version: int = Field(ge=1)
    route_path: str | None = Field(default=None, min_length=1, max_length=1024)
    message: str | None = Field(default=None, max_length=500)


class BatchPublishRequest(APIModel):
    items: list[BatchPublishItem] = Field(min_length=1, max_length=100)


class BatchPublishItemResult(APIModel):
    page_id: UUID
    success: bool
    result: PublishResult | None = None
    error: dict[str, Any] | None = None


class BatchPublishResult(APIModel):
    items: list[BatchPublishItemResult]
    succeeded: int
    failed: int


class AssetMetadataCreate(APIModel):
    site_id: UUID
    filename: str = Field(min_length=1, max_length=512)
    object_key: str = Field(min_length=1, max_length=1024)
    content_type: str = Field(min_length=1, max_length=255)
    byte_size: int = Field(ge=0)
    checksum: str = Field(min_length=64, max_length=64)
    alt_text: str | None = Field(default=None, max_length=500)
    folder_path: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=50)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssetOut(APIModel):
    id: UUID
    site_id: UUID
    filename: str
    object_key: str
    content_type: str
    byte_size: int
    checksum: str
    width: int | None
    height: int | None
    alt_text: str | None
    folder_path: str | None
    tags: list[str]
    status: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_json")
    created_at: datetime


class AssetPatch(APIModel):
    alt_text: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] | None = None
    folder_path: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = Field(default=None, max_length=50)


class RenditionOut(APIModel):
    id: UUID
    asset_id: UUID
    name: str
    object_key: str
    format: str
    content_type: str
    byte_size: int
    checksum: str | None
    width: int | None
    height: int | None
    created_at: datetime


class TemplateCreate(APIModel):
    site_id: UUID | None = None
    slug: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=240)
    version: int = Field(default=1, ge=1)
    document: PageDocument


class TemplateOut(TemplateCreate):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TemplatePatch(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=240)
    document: PageDocument | None = None
    is_active: bool | None = None


class PageFromTemplate(APIModel):
    template_id: UUID
    site_id: UUID
    folder_id: UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    slug: str = Field(min_length=1, max_length=200)
    route_path: str = Field(min_length=1, max_length=1024)
    content_type: PageContentType = PageContentType.GENERIC
    section_key: str | None = Field(default=None, max_length=100)
    listing_meta: ListingMeta = Field(default_factory=ListingMeta)

    @field_validator("section_key")
    @classmethod
    def valid_section_key(cls, value: str | None) -> str | None:
        return validate_section_key(value)


class PresetCreate(APIModel):
    site_id: UUID
    block_type: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    data: dict[str, Any]


class PresetOut(PresetCreate):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PresetPatch(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    data: dict[str, Any] | None = None
    is_active: bool | None = None


class FormCreate(APIModel):
    site_id: UUID
    slug: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=240)
    form_schema: dict[str, Any] = Field(alias="schema")
    settings: dict[str, Any] = Field(default_factory=dict)


class FormOut(FormCreate):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime


class FormPatch(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=240)
    form_schema: dict[str, Any] | None = Field(default=None, alias="schema")
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class SubmissionCreate(APIModel):
    data: dict[str, Any]
    website: str | None = Field(default=None, max_length=200)
    started_at: datetime | None = None


class SubmissionOut(APIModel):
    id: UUID
    form_id: UUID
    data: dict[str, Any]
    status: str
    created_at: datetime


class LegacyImportRequest(APIModel):
    source_id: str | None = Field(default=None, min_length=1, max_length=500)
    site_id: UUID
    folder_id: UUID | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=200)
    route_path: str | None = Field(default=None, min_length=1, max_length=1024)


class LegacyImportOut(APIModel):
    page: PageOut
    created: bool
    updated: bool
    warnings: list[str]
    fingerprint: str


class RedirectCreate(APIModel):
    site_id: UUID
    source_path: str = Field(min_length=1, max_length=1024)
    destination: str = Field(min_length=1, max_length=2048)
    status_code: Literal[301, 302, 307, 308] = 301


class RedirectOut(RedirectCreate):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SettingUpsert(APIModel):
    site_id: UUID | None = None
    key: str = Field(min_length=1, max_length=200)
    value: dict[str, Any]
    is_secret: bool = False


class SettingOut(SettingUpsert):
    id: UUID
    created_at: datetime
    updated_at: datetime


class ValidationIssue(APIModel):
    path: str
    code: str
    message: str


class ValidationReport(APIModel):
    valid: bool
    issues: list[ValidationIssue]
