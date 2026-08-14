import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { can } from '../auth/capabilities.js';
import { useSession } from '../auth/SessionContext.jsx';
import {
  CONTENT_TYPES,
  SECTION_OPTIONS,
  canonicalRoutePath,
  createTemplateContent,
  defaultRoutePath,
  defaultSectionKey,
  normalizeListingMeta,
  normalizePageLayout,
} from '../content/pageTypes.js';
import { SiteSelect, useActiveSite } from '../sites/useActiveSite.jsx';
import { formatDateTime, formatStatus } from '../utils/display.js';
import { slugify } from '../utils/slugify.js';

export default function PageListPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const { sites, siteId, setSiteId, site } = useActiveSite();
  const dialog = useRef(null);
  const [pages, setPages] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [contentTypeFilter, setContentTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newPage, setNewPage] = useState({
    title: '',
    slug: '',
    routePath: '',
    contentType: 'generic',
    sectionKey: '',
    template: 'generic',
  });
  useEffect(() => {
    let active = true;
    if (!siteId) {
      setPages([]);
      setLoading(false);
      return () => { active = false; };
    }
    const timeout = setTimeout(() => {
      setLoading(true);
      api.pages.list({ search, status, contentType: contentTypeFilter, siteId })
        .then((result) => active && setPages(result.items || result))
        .catch((nextError) => active && setError(nextError.message))
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [contentTypeFilter, search, siteId, status]);

  const createPage = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setCreating(true);
    setError('');
    try {
      const slug = slugify(values.slug || values.title);
      const contentType = values.contentType || 'generic';
      const page = await api.pages.create({
        siteId,
        title: values.title,
        slug,
        contentType,
        sectionKey: values.sectionKey || defaultSectionKey(contentType),
        listingMeta: normalizeListingMeta({ menuLabel: values.title }),
        routePath: canonicalRoutePath(contentType, slug, values.routePath),
        locale: site?.defaultLocale || 'ru',
        layout: normalizePageLayout(),
        content: createTemplateContent(values.template || contentType, values.title),
      });
      dialog.current?.close();
      setNewPage({
        title: '',
        slug: '',
        routePath: '',
        contentType: 'generic',
        sectionKey: '',
        template: 'generic',
      });
      navigate(`/admin/builder/pages/${page.id}`);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="pb-resource-page">
      <header className="pb-page-header">
        <div>
          <p className="pb-kicker">КОНТЕНТ</p>
          <h1>Страницы</h1>
          <p>Создавайте, проверяйте и публикуйте все страницы в одном месте.</p>
        </div>
        {can(user, 'edit') && <button
          className="pb-primary-button"
          type="button"
          onClick={() => dialog.current?.showModal()}
        >
          <span aria-hidden="true">+</span> Новая страница
        </button>}
      </header>

      <section className="pb-panel">
        <div className="pb-list-toolbar">
          <label className="pb-search">
            <span className="pb-visually-hidden">Поиск страниц</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Поиск по заголовку или URL…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            <span className="pb-visually-hidden">Фильтр по статусу</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Все статусы</option>
              <option value="draft">Черновик</option>
              <option value="published">Опубликовано</option>
            </select>
          </label>
          <label>
            <span className="pb-visually-hidden">Фильтр по типу контента</span>
            <select
              value={contentTypeFilter}
              onChange={(event) => setContentTypeFilter(event.target.value)}
            >
              <option value="">Все типы контента</option>
              {CONTENT_TYPES.map((type) => (
                <option value={type.value} key={type.value}>{type.label}</option>
              ))}
            </select>
          </label>
          <SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} name="pageFilterSite" />
        </div>

        {error && <p className="pb-alert pb-alert--error" role="alert">{error}</p>}
        {loading ? (
          <div className="pb-empty-state" role="status">Загрузка страниц…</div>
        ) : pages.length ? (
          <div className="pb-table-scroll">
            <table className="pb-admin-table">
              <thead><tr><th scope="col">Страница</th><th scope="col">Тип</th><th scope="col">Статус</th><th scope="col">Обновлена</th><th scope="col"><span className="pb-visually-hidden">Действия</span></th></tr></thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.id}>
                    <th scope="row">
                      <Link to={`/admin/builder/pages/${page.id}`}>{page.title}</Link>
                      <small>{page.routePath || `/${page.slug}`}</small>
                    </th>
                    <td>{CONTENT_TYPES.find((type) => type.value === page.contentType)?.label || page.contentType || 'Обычная страница'}</td>
                    <td><span className={`pb-status pb-status--${page.status}`}>{formatStatus(page.status)}</span></td>
                    <td><time dateTime={page.updatedAt}>{formatDateTime(page.updatedAt)}</time></td>
                    <td><Link className="pb-icon-button" to={`/admin/builder/pages/${page.id}`} aria-label={`Редактировать «${page.title}»`}>→</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pb-empty-state">
            <strong>Страницы не найдены</strong>
            <p>{search || status !== 'all' || contentTypeFilter ? 'Измените запрос или фильтр.' : 'Для начала создайте первую страницу.'}</p>
          </div>
        )}
      </section>

      <dialog className="pb-dialog" ref={dialog}>
        <form onSubmit={createPage}>
          <header><div><p className="pb-kicker">НОВАЯ СТРАНИЦА</p><h2>Выберите отправную точку</h2></div><button type="button" className="pb-icon-button" onClick={() => dialog.current?.close()} aria-label="Закрыть">×</button></header>
          <label>
            <span>Заголовок страницы</span>
            <input
              name="title"
              required
              autoFocus
              placeholder="О нашей компании"
              value={newPage.title}
              onChange={(event) => setNewPage((current) => ({
                ...current,
                title: event.target.value,
              }))}
            />
          </label>
          <label>
            <span>Тип контента</span>
            <select
              name="contentType"
              value={newPage.contentType}
              onChange={(event) => {
                const contentType = event.target.value;
                setNewPage((current) => ({
                  ...current,
                  contentType,
                  sectionKey: defaultSectionKey(contentType),
                  template: contentType,
                }));
              }}
            >
              {CONTENT_TYPES.map((type) => (
                <option value={type.value} key={type.value}>{type.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Раздел</span>
            <select
              name="sectionKey"
              value={newPage.sectionKey}
              onChange={(event) => setNewPage((current) => ({
                ...current,
                sectionKey: event.target.value,
              }))}
            >
              {SECTION_OPTIONS.map((option) => (
                <option value={option.value} key={option.value || 'none'}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>URL-идентификатор <small>необязательно</small></span>
            <input
              name="slug"
              placeholder="o-nas"
              value={newPage.slug}
              onChange={(event) => setNewPage((current) => ({
                ...current,
                slug: event.target.value,
              }))}
            />
          </label>
          <label>
            <span>Путь страницы <small>необязательно</small></span>
            <input
              name="routePath"
              placeholder={defaultRoutePath(
                newPage.contentType,
                slugify(newPage.slug || newPage.title, 'page'),
              )}
              pattern="/.*"
              value={newPage.routePath}
              onChange={(event) => setNewPage((current) => ({
                ...current,
                routePath: event.target.value,
              }))}
            />
          </label>
          <p className="pb-inspector-help">Сайт: {site?.name || 'Нет активного сайта'}</p>
          <fieldset>
            <legend>Шаблон</legend>
            {CONTENT_TYPES.map((type) => (
              <label className="pb-choice" key={type.value}>
                <input
                  type="radio"
                  name="template"
                  value={type.value}
                  checked={newPage.template === type.value}
                  onChange={(event) => setNewPage((current) => ({
                    ...current,
                    template: event.target.value,
                  }))}
                />
                <span><strong>{type.label}</strong><small>{type.description}</small></span>
              </label>
            ))}
          </fieldset>
          <footer><button type="button" className="pb-secondary-button" onClick={() => dialog.current?.close()}>Отмена</button><button className="pb-primary-button" disabled={creating || !sites.length}>{creating ? 'Создание…' : 'Создать страницу'}</button></footer>
        </form>
      </dialog>
    </main>
  );
}
