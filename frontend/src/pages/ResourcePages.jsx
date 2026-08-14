import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isDemoMode } from '../api/client.js';
import { createBlock, getBlockDefinition } from '../registry/index.js';
import { SiteSelect, useActiveSite } from '../sites/useActiveSite.jsx';
import { formatDateTime, formatStatus } from '../utils/display.js';
import { slugify } from '../utils/slugify.js';

function Header({ kicker, title, description, action }) {
  return (
    <header className="pb-page-header">
      <div><p className="pb-kicker">{kicker}</p><h1>{title}</h1><p>{description}</p></div>
      {action}
    </header>
  );
}

function useResource(kind, query = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const queryKey = JSON.stringify(query);
  const refresh = useCallback(async () => {
    const parsedQuery = JSON.parse(queryKey);
    if (Object.hasOwn(parsedQuery, 'siteId') && !parsedQuery.siteId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await api.resources.list(kind, parsedQuery);
      setItems(result.items || result);
      setError('');
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }, [kind, queryKey]);
  useEffect(() => { refresh(); }, [refresh]);
  return { items, loading, error, refresh };
}

export function MediaPage() {
  const { sites, siteId, setSiteId } = useActiveSite();
  const { items, loading, error, refresh } = useResource('media', { siteId });
  const [adding, setAdding] = useState(false);

  const add = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setAdding(true);
    try {
      await api.resources.create('media', values);
      form.reset();
      await refresh();
    } finally {
      setAdding(false);
    }
  };

  return (
    <main className="pb-resource-page">
      <Header kicker="МАТЕРИАЛЫ" title="Медиа" description="Храните изображения и их доступные описания в одном месте." />
      <div className="pb-resource-grid">
        <form className="pb-panel pb-compact-form" onSubmit={add}>
          <h2>Загрузить медиафайл</h2>
          <SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} />
          <label><span>Файл</span><input name="file" type="file" required accept=".avif,.gif,.jpg,.jpeg,.png,.webp,.mp4,.pdf,.docx,.xlsx" /></label>
          <label><span>Альтернативный текст</span><input name="altText" /></label>
          <button className="pb-primary-button" disabled={adding || !sites.length}>{adding ? 'Загрузка…' : 'Загрузить'}</button>
        </form>
        <section className="pb-panel pb-resource-main">
          {error && <p className="pb-alert pb-alert--error">{error}</p>}
          {loading ? <div className="pb-empty-state">Загрузка медиафайлов…</div> : items.length ? (
            <ul className="pb-media-grid">
              {items.map((item) => (
                <li key={item.id}>
                  <img src={item.url} alt={item.alt || ''} />
                  <div>
                    <strong>{item.name}</strong><small>{item.alt || 'Альтернативный текст не задан'}</small>
                    <button type="button" className="pb-text-button" onClick={async () => {
                      const altText = window.prompt('Альтернативный текст', item.alt || '');
                      if (altText != null) {
                        await api.resources.update('media', item.id, { altText });
                        await refresh();
                      }
                    }}>Изменить</button>
                    {item.contentType?.startsWith('image/') && <button type="button" className="pb-text-button" onClick={() => api.resources.queueRenditions(item.id)}>Варианты</button>}
                    <button type="button" className="pb-text-button pb-text-button--danger" onClick={async () => {
                      if (window.confirm('Удалить этот файл?')) {
                        await api.resources.remove('media', item.id);
                        await refresh();
                      }
                    }}>Удалить</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="pb-empty-state"><strong>Медиатека пуста</strong><p>Загрузите файл, чтобы он появился здесь.</p></div>}
        </section>
      </div>
    </main>
  );
}

const builtInTemplates = [
  {
    id: 'campaign',
    name: 'Промо-лендинг',
    description: 'Первый экран, преимущества, отзывы и заметный призыв к действию.',
    types: ['hero', 'features', 'stats', 'testimonials', 'cta'],
  },
  {
    id: 'article',
    name: 'Статья',
    description: 'Навигация, понятная иерархия заголовков, форматированный текст и подвал.',
    types: ['navbar', 'heading', 'richText', 'quote', 'footer'],
  },
  {
    id: 'contact',
    name: 'Контактная страница',
    description: 'Вступление и доступная форма обратной связи.',
    types: ['heading', 'richText', 'form', 'footer'],
  },
];

export function TemplatesPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState('');
  const { sites, siteId, setSiteId } = useActiveSite();
  const { items, loading, error } = useResource('templates', { siteId });
  const templates = (isDemoMode && !items.length ? builtInTemplates : items).map((template) => ({
      ...template,
      description: template.document ? `Версия шаблона ${template.version}` : template.description,
      types: template.types || (template.document?.blocks || []).map((block) => block.type),
    }));
  const applyTemplate = async (template) => {
    setCreating(template.id);
    try {
      const slug = `${slugify(template.slug || template.name || template.id, 'shablon')}-${Date.now().toString(36)}`;
      let page;
      if (template.document && api.pages.createFromTemplate) {
        page = await api.pages.createFromTemplate({
          templateId: template.id,
          siteId,
          title: template.name,
          slug,
          routePath: `/${slug}`,
        });
      } else {
        const blocks = template.types.map((type) => createBlock(type));
        page = await api.pages.create({
          siteId,
          title: template.name,
          slug,
          routePath: `/${slug}`,
          content: {
            byId: Object.fromEntries(blocks.map((block) => [block.id, block])),
            rootOrder: blocks.map((block) => block.id),
            childrenByParent: Object.fromEntries(blocks.map((block) => [block.id, []])),
          },
        });
      }
      navigate(`/admin/builder/pages/${page.id}`);
    } finally {
      setCreating('');
    }
  };
  return (
    <main className="pb-resource-page">
      <Header kicker="ОТПРАВНЫЕ ТОЧКИ" title="Шаблоны" description="Начните с проверенной структуры и настройте её под себя." />
      <div className="pb-list-toolbar"><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} /></div>
      {error && <p className="pb-alert pb-alert--error">{error}</p>}
      {loading && <div className="pb-empty-state">Загрузка шаблонов…</div>}
      {!loading && !templates.length && <div className="pb-empty-state"><strong>Для этого сайта нет шаблонов</strong></div>}
      <section className="pb-template-grid">
        {templates.map((template) => (
          <article className="pb-panel pb-template-card" key={template.id}>
            <div className={`pb-template-preview pb-template-preview--${template.id}`} aria-hidden="true">
              {template.types.map((type) => <span key={type}>{getBlockDefinition(type)?.label || type}</span>)}
            </div>
            <h2>{template.name}</h2><p>{template.description}</p>
            <button className="pb-secondary-button" onClick={() => applyTemplate(template)} disabled={Boolean(creating) || !siteId}>
              {creating === template.id ? 'Создание…' : 'Использовать шаблон'}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}

export function FormsPage() {
  const { sites, siteId, setSiteId } = useActiveSite();
  const { items, loading, error, refresh } = useResource('forms', { siteId });
  const [saving, setSaving] = useState(false);
  const add = async (event) => {
    event.preventDefault();
    setSaving(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const slug = slugify(values.slug || values.name, 'forma-bez-nazvaniya');
      await api.resources.create('forms', {
        siteId: values.siteId,
        slug,
        name: values.name,
        schema: {
          fields: [
            { name: 'name', label: 'Имя', type: 'text', required: true },
            { name: 'email', label: 'Электронная почта', type: 'email', required: true },
            { name: 'message', label: 'Сообщение', type: 'textarea', required: true },
          ],
        },
        settings: { recipient: values.recipient },
      });
      event.currentTarget.reset();
      await refresh();
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="pb-resource-page">
      <Header kicker="ОБРАЩЕНИЯ" title="Формы" description="Настраивайте получателей форм и отслеживайте сбор ответов." />
      <div className="pb-resource-grid">
        <form className="pb-panel pb-compact-form" onSubmit={add}>
          <h2>Зарегистрировать форму</h2>
          <SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} />
          <label><span>Название</span><input name="name" required placeholder="Запросы отдела продаж" /></label>
          <label><span>URL-идентификатор <small>необязательно</small></span><input name="slug" placeholder="zaprosy-prodazh" /></label>
          <label><span>Почта для уведомлений</span><input name="recipient" type="email" required /></label>
          <button className="pb-primary-button" disabled={saving || !sites.length}>{saving ? 'Сохранение…' : 'Создать форму'}</button>
        </form>
        <section className="pb-panel pb-resource-main">
          {error && <p className="pb-alert pb-alert--error">{error}</p>}
          {loading ? <div className="pb-empty-state">Загрузка форм…</div> : items.length ? (
            <table className="pb-admin-table"><thead><tr><th>Название</th><th>Получатель</th><th>Ответы</th><th>Статус</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id}><th>{item.name}</th><td>{item.recipient}</td><td><button type="button" className="pb-text-button" onClick={async () => {
                const blob = await api.resources.exportSubmissions(item.id);
                const href = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = href;
                link.download = `${item.slug}-submissions.csv`;
                link.click();
                URL.revokeObjectURL(href);
              }}>Экспорт CSV</button></td><td><span className="pb-status pb-status--published">{formatStatus(item.status)}</span></td></tr>)}</tbody>
            </table>
          ) : <div className="pb-empty-state"><strong>Нет зарегистрированных форм</strong><p>Добавьте форму здесь, а затем подключите её в блоке «Форма».</p></div>}
        </section>
      </div>
    </main>
  );
}

export function RedirectsPage() {
  const { sites, siteId, setSiteId } = useActiveSite();
  const { items, loading, error, refresh } = useResource('redirects', { siteId });
  const [saving, setSaving] = useState(false);
  const add = async (event) => {
    event.preventDefault();
    setSaving(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api.resources.create('redirects', {
        siteId: values.siteId,
        sourcePath: values.from,
        destination: values.to,
        statusCode: Number(values.code),
      });
      event.currentTarget.reset();
      await refresh();
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="pb-resource-page">
      <Header kicker="МАРШРУТИЗАЦИЯ" title="Перенаправления" description="Направляйте старые и перемещённые URL на нужные страницы." />
      <div className="pb-resource-grid">
        <form className="pb-panel pb-compact-form" onSubmit={add}>
          <h2>Добавить перенаправление</h2>
          <SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} />
          <label><span>Исходный путь</span><input name="from" required placeholder="/staraya-stranitsa" pattern="/.*" /></label>
          <label><span>Назначение</span><input name="to" required placeholder="/novaya-stranitsa" /></label>
          <label><span>Тип</span><select name="code" defaultValue="301"><option value="301">301 — постоянное</option><option value="302">302 — временное</option></select></label>
          <button className="pb-primary-button" disabled={saving || !sites.length}>{saving ? 'Сохранение…' : 'Добавить'}</button>
        </form>
        <section className="pb-panel pb-resource-main">
          {error && <p className="pb-alert pb-alert--error">{error}</p>}
          {loading ? <div className="pb-empty-state">Загрузка перенаправлений…</div> : items.length ? (
            <table className="pb-admin-table"><thead><tr><th>Откуда</th><th>Куда</th><th>Тип</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id}><th><code>{item.from}</code></th><td><code>{item.to}</code></td><td>{item.code} <button type="button" className="pb-text-button pb-text-button--danger" onClick={async () => { await api.resources.remove('redirects', item.id); await refresh(); }}>Удалить</button></td></tr>)}</tbody>
            </table>
          ) : <div className="pb-empty-state"><strong>Нет перенаправлений</strong><p>Перемещённые пути появятся здесь.</p></div>}
        </section>
      </div>
    </main>
  );
}

export function AuditPage() {
  const { items, loading, error } = useResource('audit');
  const events = items.length ? items : isDemoMode ? [
    { id: 'welcome', action: 'Рабочее пространство конструктора создано', actor: 'Система', createdAt: new Date().toISOString() },
  ] : [];
  return (
    <main className="pb-resource-page">
      <Header kicker="АКТИВНОСТЬ" title="Журнал действий" description="Отслеживайте важные изменения в рабочем пространстве публикации." />
      <section className="pb-panel">
        {error && <p className="pb-alert pb-alert--error">{error}</p>}
        {loading ? <div className="pb-empty-state">Загрузка событий…</div> : (
          events.length ? <ol className="pb-audit-list">
            {events.map((event) => (
              <li key={event.id}><span aria-hidden="true">✓</span><div><strong>{event.action}</strong><small>{event.actor || event.actorId || 'Система'} · <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time></small></div></li>
            ))}
          </ol> : <div className="pb-empty-state">Событий пока нет.</div>
        )}
      </section>
    </main>
  );
}

export function SettingsPage() {
  const [status, setStatus] = useState('');
  const { sites, siteId, setSiteId } = useActiveSite();
  const { items, error, refresh } = useResource('settings', { siteId });
  const saved = items.find((item) => item.key === 'site.identity')?.value || {};
  const save = async (event) => {
    event.preventDefault();
    setStatus('Сохранение…');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api.resources.create('settings', {
        siteId: values.siteId || null,
        key: 'site.identity',
        value: {
          siteName: values.siteName,
          siteUrl: values.siteUrl,
          locale: values.locale,
          requireWarnings: values.requireWarnings === 'on',
        },
        isSecret: false,
      });
      await refresh();
      setStatus('Настройки сохранены.');
    } catch (error) {
      setStatus(error.message);
    }
  };
  return (
    <main className="pb-resource-page">
      <Header kicker="РАБОЧЕЕ ПРОСТРАНСТВО" title="Настройки" description="Задайте значения по умолчанию для новых страниц и публичного просмотра." />
      <form className="pb-panel pb-settings-form" onSubmit={save}>
        <section><h2>Данные сайта</h2><p>Используются, если на странице не указаны другие значения.</p></section>
        <SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} />
        <label><span>Название сайта</span><input name="siteName" defaultValue={saved.siteName || ''} key={`${siteId}-name-${saved.siteName}`} /></label>
        <label><span>Публичный URL сайта</span><input name="siteUrl" type="url" defaultValue={saved.siteUrl || ''} key={`${siteId}-url-${saved.siteUrl}`} /></label>
        <label><span>Язык по умолчанию</span><select name="locale" defaultValue={saved.locale || 'ru'} key={`${siteId}-locale-${saved.locale}`}><option value="ru">Русский</option><option value="en">Английский</option><option value="de">Немецкий</option><option value="fr">Французский</option></select></label>
        <label className="pb-toggle"><input name="requireWarnings" type="checkbox" defaultChecked={saved.requireWarnings !== false} key={`${siteId}-warnings-${saved.requireWarnings}`} /><span>Требовать проверку перед публикацией</span></label>
        {error && <p className="pb-alert pb-alert--error">{error}</p>}
        {items.length > 0 && <small>Сохранено настроек: {items.length}.</small>}
        <footer><span role="status">{status}</span><button className="pb-primary-button" disabled={!sites.length}>Сохранить настройки</button></footer>
      </form>
    </main>
  );
}
