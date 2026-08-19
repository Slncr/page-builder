import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  BREADCRUMB_MODE_OPTIONS,
  CONTENT_TYPES,
  PAGE_SHELL_OPTIONS,
  SECTION_OPTIONS,
  defaultRoutePath,
  defaultSectionKey,
} from '../content/pageTypes.js';
import { getBlockDefinition, validateBlock } from '../registry/index.js';
import { useBuilderStore } from '../store/builderStore.js';
import { slugify } from '../utils/slugify.js';
import { getPrepublishWarnings } from './prepublish.js';

const normalizeOption = (option) => (
  option && typeof option === 'object'
    ? option
    : { value: option, label: String(option) }
);

const MEDIA_REFERENCE_FIELDS = new Set([
  'assetId',
  'backgroundImage',
  'posterAssetId',
  'ogImage',
  'image',
  'coverAssetId',
]);

function MediaField({ id, label, value, onChange, references = {} }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const assets = references.assets || [];
  const selected = assets.find((asset) => asset.id === value);

  const uploadFromComputer = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !references.uploadMedia) return;
    setUploading(true);
    setError('');
    try {
      const asset = await references.uploadMedia(file);
      if (asset?.id) onChange(asset.id);
    } catch (nextError) {
      setError(nextError.message || 'Не удалось загрузить файл.');
    } finally {
      event.target.value = '';
      setUploading(false);
    }
  };

  return (
    <div className="pb-media-field">
      <label htmlFor={id}>
        <span>{label}</span>
        <select id={id} value={value || ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">Выберите медиафайл…</option>
          {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.filename || asset.name}</option>)}
        </select>
      </label>
      <label className="pb-media-field__upload">
        <span>{uploading ? 'Загрузка файла…' : 'Или загрузите с компьютера'}</span>
        <input type="file" onChange={uploadFromComputer} disabled={uploading || !references.uploadMedia} />
      </label>
      {selected?.url && (
        <div className="pb-media-field__meta">
          <small>{selected.filename || selected.name}</small>
        </div>
      )}
      {error && <p className="pb-alert pb-alert--error">{error}</p>}
    </div>
  );
}

function BasicField({ field, value, onChange, references = {}, itemContext = null }) {
  const id = `field-${field.name}`;
  const referenceName = field.referenceName || field.name;
  const fieldType = itemContext?.type || null;
  const showOptions = ['select', 'radio'].includes(fieldType);
  const showValue = ['hidden', 'text', 'textarea', 'email', 'phone', 'number', 'select', 'radio'].includes(fieldType);
  const showPattern = ['text', 'email', 'phone', 'textarea'].includes(fieldType);

  if (MEDIA_REFERENCE_FIELDS.has(referenceName) || field.type === 'image') {
    return <MediaField id={id} label={field.label} value={value} onChange={onChange} references={references} />;
  }
  if (referenceName === 'formId') {
    return (
      <label htmlFor={id}>
        <span>{field.label}</span>
        <select id={id} value={value || ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">Выберите зарегистрированную форму…</option>
          {(references.forms || []).map((form) => <option value={form.id} key={form.id}>{form.name}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'toggle') {
    return (
      <label className="pb-toggle" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.type === 'select') {
    const options = field.options.map(normalizeOption);
    return (
      <label htmlFor={id}>
        <span>{field.label}</span>
        <select id={id} value={value ?? ''} onChange={(event) => {
          const match = options.find((option) => String(option.value) === event.target.value);
          onChange(match?.value);
        }}>
          {options.map((option) => <option value={String(option.value)} key={String(option.value)}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (['richtext', 'code'].includes(field.type)) {
    return (
      <label htmlFor={id}>
        <span>{field.label}</span>
        <textarea id={id} rows={field.type === 'code' ? 9 : 5} value={value || ''} onChange={(event) => onChange(event.target.value)} spellCheck={field.type !== 'code'} />
      </label>
    );
  }
  if (field.type === 'number') {
    return (
      <label htmlFor={id}>
        <span>{field.label}</span>
        <input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          value={value ?? ''}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              onChange('');
              return;
            }
            const parsed = Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : value);
          }}
        />
      </label>
    );
  }
  if (field.name === 'options' && !showOptions) return null;
  if (field.name === 'value' && !showValue) return null;
  if (['minLength', 'maxLength', 'pattern'].includes(field.name) && !showPattern) return null;
  return (
    <label htmlFor={id}>
      <span>{field.label}{field.required && <span aria-hidden="true"> *</span>}</span>
      <div className={field.type === 'image' ? 'pb-input-with-icon' : undefined}>
        {field.type === 'image' && <span aria-hidden="true">▧</span>}
        <input
          id={id}
          type={field.type === 'url' || field.type === 'image' ? 'text' : 'text'}
          value={value || ''}
          required={field.required}
          aria-invalid={field.required && !String(value || '').trim() ? 'true' : undefined}
          placeholder={field.type === 'url' || field.type === 'image' ? 'https://… или /путь' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}

function shouldShowBlockField(block, field) {
  const props = block.props || {};
  if (block.type === 'section') {
    if (field.name === 'backgroundColor') return ['color', 'gradient'].includes(props.backgroundType);
    if (field.name === 'backgroundImage') return props.backgroundType === 'image';
    if (field.name === 'foreground') return props.backgroundType !== 'none';
  }
  if (block.type === 'form' && field.name === 'redirectUrl') {
    return props.successAction === 'redirect';
  }
  if (block.type === 'breadcrumbs' && field.name === 'items') {
    return props.source !== 'auto';
  }
  if (block.type === 'pageList') {
    if (field.name === 'source') return props.sourceType !== 'manual';
    if (field.name === 'items') return props.sourceType === 'manual';
  }
  return true;
}

function blockFieldLabel(block, field) {
  if (block.type === 'pageList' && field.name === 'source') {
    if (block.props.sourceType === 'folder') return 'Тип контента (contentType)';
    if (block.props.sourceType === 'tag') return 'Раздел (section)';
  }
  return field.label;
}

function ItemsField({ field, value = [], onChange, references }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const updateItem = (index, key, nextValue) => {
    const next = structuredClone(value);
    next[index] = { ...next[index], [key]: nextValue };
    onChange(next);
  };
  const remove = (index) => onChange(value.filter((_, current) => current !== index));
  const add = () => onChange([...value, Object.fromEntries(field.fields.map((item) => [
    item.name,
    item.type === 'toggle' ? false : '',
  ]))]);
  const supportsBulkMediaUpload = field.fields.some((item) => item.name === 'assetId')
    && typeof references.uploadMedia === 'function';

  const uploadItems = async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length || !supportsBulkMediaUpload) return;
    setUploading(true);
    setError('');
    try {
      const uploaded = [];
      for (const file of files) {
        const asset = await references.uploadMedia(file);
        uploaded.push({
          assetId: asset.id,
          alt: '',
        });
      }
      onChange([...(value || []), ...uploaded]);
    } catch (nextError) {
      setError(nextError.message || 'Не удалось загрузить файлы.');
    } finally {
      event.target.value = '';
      setUploading(false);
    }
  };

  return (
    <fieldset className="pb-items-field">
      <legend>{field.label}</legend>
      {supportsBulkMediaUpload && (
        <label className="pb-media-field__upload">
          <span>{uploading ? 'Загрузка файлов…' : 'Добавить файлы с компьютера'}</span>
          <input type="file" multiple onChange={uploadItems} disabled={uploading} />
        </label>
      )}
      {value.map((item, index) => (
        <details open={value.length < 4} key={index}>
          <summary><span>{item.title || item.label || item.name || `Элемент ${index + 1}`}</span><span>{index + 1}</span></summary>
          <div>
            {field.fields.map((itemField) => (
              <BasicField
                key={itemField.name}
                field={{ ...itemField, name: `${field.name}-${index}-${itemField.name}`, referenceName: itemField.name }}
                value={item[itemField.name]}
                onChange={(nextValue) => updateItem(index, itemField.name, nextValue)}
                references={references}
                itemContext={field.name === 'fields' ? item : null}
              />
            ))}
            <button className="pb-text-button pb-text-button--danger" type="button" onClick={() => remove(index)}>Удалить элемент</button>
          </div>
        </details>
      ))}
      <button className="pb-secondary-button pb-secondary-button--small" type="button" onClick={add}>+ Добавить элемент</button>
      {error && <p className="pb-alert pb-alert--error">{error}</p>}
    </fieldset>
  );
}

function ComplexField({ field, value, onChange, references }) {
  if (field.type === 'items') return <ItemsField field={field} value={value} onChange={onChange} references={references} />;
  if (field.type === 'stringList') {
    return <BasicField field={{ ...field, type: 'text' }} value={(value || []).join(', ')} onChange={(next) => onChange(next.split(',').map((item) => item.trim()))} />;
  }
  if (field.type === 'table') {
    return (
      <label>
        <span>{field.label} <small>одна строка на строку текста; разделяйте ячейки символом |</small></span>
        <textarea
          rows="7"
          value={(value || []).map((row) => row.join(' | ')).join('\n')}
          onChange={(event) => onChange(event.target.value.split('\n').map((row) => row.split('|').map((cell) => cell.trim())))}
        />
      </label>
    );
  }
  return <BasicField field={field} value={value} onChange={onChange} references={references} />;
}

function SeoPanel({ references }) {
  const title = useBuilderStore((state) => state.title);
  const slug = useBuilderStore((state) => state.slug);
  const seo = useBuilderStore((state) => state.seo);
  const updatePage = useBuilderStore((state) => state.updatePage);
  const serialize = useBuilderStore((state) => state.serialize);
  const selectBlock = useBuilderStore((state) => state.selectBlock);
  const warnings = getPrepublishWarnings(serialize());
  return (
    <div className="pb-inspector-form">
      <section className="pb-inspector-section">
        <h2>Вид в поиске</h2>
        <label><span>SEO-заголовок <small>{seo.title.length}/60</small></span><input value={seo.title} onChange={(event) => updatePage({ seo: { title: event.target.value } })} placeholder={title} /></label>
        <label><span>Метаописание <small>{seo.description.length}/160</small></span><textarea rows="4" value={seo.description} onChange={(event) => updatePage({ seo: { description: event.target.value } })} /></label>
        <MediaField
          id="seo-social-image"
          label="Изображение для соцсетей"
          value={seo.socialImage}
          onChange={(value) => updatePage({ seo: { socialImage: value } })}
          references={references}
        />
        <label><span>Канонический URL</span><input type="url" value={seo.canonical || ''} onChange={(event) => updatePage({ seo: { canonical: event.target.value } })} /></label>
        <label><span>Заголовок Open Graph</span><input value={seo.ogTitle || ''} onChange={(event) => updatePage({ seo: { ogTitle: event.target.value } })} /></label>
        <label><span>Описание Open Graph</span><textarea rows="3" value={seo.ogDescription || ''} onChange={(event) => updatePage({ seo: { ogDescription: event.target.value } })} /></label>
        <label><span>Карточка Twitter</span><select value={seo.twitterCard || 'summary_large_image'} onChange={(event) => updatePage({ seo: { twitterCard: event.target.value } })}><option value="summary">Краткая</option><option value="summary_large_image">С большим изображением</option></select></label>
        <label><span>Приоритет в карте сайта</span><input type="number" min="0" max="1" step="0.1" value={seo.sitemapPriority ?? 0.5} onChange={(event) => updatePage({ seo: { sitemapPriority: Number(event.target.value) } })} /></label>
        <label><span>Частота изменений</span><select value={seo.changeFrequency || 'monthly'} onChange={(event) => updatePage({ seo: { changeFrequency: event.target.value } })}>{[
          ['always', 'Всегда'],
          ['hourly', 'Ежечасно'],
          ['daily', 'Ежедневно'],
          ['weekly', 'Еженедельно'],
          ['monthly', 'Ежемесячно'],
          ['yearly', 'Ежегодно'],
          ['never', 'Никогда'],
        ].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="pb-toggle"><input type="checkbox" checked={seo.noIndex} onChange={(event) => updatePage({ seo: { noIndex: event.target.checked } })} /><span>Скрыть от поисковых систем</span></label>
        <div className="pb-serp-preview">
          <small>example.com/{slug}</small>
          <strong>{seo.title || title || 'Заголовок страницы'}</strong>
          <p>{seo.description || 'Добавьте описание, чтобы увидеть, как страница может выглядеть в результатах поиска.'}</p>
        </div>
      </section>
      <section className="pb-inspector-section">
        <h2>Проверки перед публикацией <span className="pb-count">{warnings.length}</span></h2>
        {warnings.length ? (
          <ul className="pb-warning-list">
            {warnings.map((warning, index) => (
              <li className={`is-${warning.level}`} key={`${warning.message}-${index}`}>
                <button type="button" onClick={() => warning.blockId && selectBlock(warning.blockId)}>
                  <span aria-hidden="true">{warning.level === 'error' ? '!' : 'i'}</span>{warning.message}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="pb-check-success">✓ Все проверки пройдены.</p>}
      </section>
    </div>
  );
}

function PageSettingsPanel({ references }) {
  const slug = useBuilderStore((state) => state.slug);
  const routePath = useBuilderStore((state) => state.routePath);
  const contentType = useBuilderStore((state) => state.contentType);
  const sectionKey = useBuilderStore((state) => state.sectionKey);
  const listingMeta = useBuilderStore((state) => state.listingMeta);
  const layout = useBuilderStore((state) => state.layout);
  const updatePage = useBuilderStore((state) => state.updatePage);
  const knownSection = SECTION_OPTIONS.some((option) => option.value === sectionKey);
  const selectedCover = (references.assets || []).find((asset) => asset.id === listingMeta.coverAssetId);
  const updateListingMeta = (patch) => updatePage({ listingMeta: patch });
  const updateLayout = (patch) => updatePage({ layout: patch });

  const changeContentType = (nextContentType) => {
    const previousDefaultRoute = defaultRoutePath(contentType, slug);
    const previousDefaultSection = defaultSectionKey(contentType);
    updatePage({
      contentType: nextContentType,
      routePath: routePath === previousDefaultRoute
        ? defaultRoutePath(nextContentType, slug)
        : routePath,
      sectionKey: !sectionKey || sectionKey === previousDefaultSection
        ? defaultSectionKey(nextContentType)
        : sectionKey,
    });
  };

  return (
    <div className="pb-inspector-form">
      <header className="pb-inspector-title">
        <span aria-hidden="true">⚙</span>
        <div><p>СТРАНИЦА</p><h2>Параметры публикации</h2></div>
      </header>
      <section className="pb-inspector-section">
        <h2>Оболочка сайта</h2>
        <label>
          <span>Шаблон сайта</span>
          <select
            value={layout.shell}
            onChange={(event) => updateLayout({ shell: event.target.value })}
          >
            {PAGE_SHELL_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Хлебные крошки</span>
          <select
            value={layout.breadcrumbs}
            onChange={(event) => updateLayout({ breadcrumbs: event.target.value })}
          >
            {BREADCRUMB_MODE_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="pb-toggle">
          <input
            type="checkbox"
            checked={layout.showPageTitle}
            onChange={(event) => updateLayout({ showPageTitle: event.target.checked })}
          />
          <span>Показывать заголовок в оболочке сайта</span>
        </label>
        <p className="pb-inspector-help">
          Автоматический шаблон выбирается сайтом по адресу страницы.
        </p>
      </section>
      <section className="pb-inspector-section">
        <h2>Тип и адрес</h2>
        <label>
          <span>Тип контента</span>
          <select
            value={contentType}
            onChange={(event) => changeContentType(event.target.value)}
          >
            {CONTENT_TYPES.map((type) => (
              <option value={type.value} key={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Раздел</span>
          <select
            value={sectionKey}
            onChange={(event) => updatePage({ sectionKey: event.target.value })}
          >
            {!knownSection && <option value={sectionKey}>{sectionKey}</option>}
            {SECTION_OPTIONS.map((option) => (
              <option value={option.value} key={option.value || 'none'}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Путь публикации</span>
          <input
            value={routePath}
            pattern="/.*"
            placeholder={defaultRoutePath(contentType, slug)}
            onChange={(event) => updatePage({ routePath: event.target.value })}
            onBlur={() => {
              if (!routePath) updatePage({ routePath: defaultRoutePath(contentType, slug) });
            }}
          />
        </label>
        <p className="pb-inspector-help">
          Для новостей и статей используются адреса /about/news/… и /about/articles/….
          Услуги и обычные страницы могут использовать собственный путь.
        </p>
      </section>
      <section className="pb-inspector-section">
        <h2>Отображение в списках</h2>
        <label>
          <span>Краткое описание</span>
          <textarea
            rows="4"
            value={listingMeta.excerpt}
            onChange={(event) => updateListingMeta({ excerpt: event.target.value })}
          />
        </label>
        <MediaField
          id="listing-cover"
          label="Обложка"
          value={listingMeta.coverAssetId}
          onChange={(value) => updateListingMeta({ coverAssetId: value })}
          references={references}
        />
        {selectedCover?.url && (
          <figure className="pb-cover-preview">
            <img src={selectedCover.url} alt={selectedCover.alt || ''} />
            <figcaption>{selectedCover.filename || selectedCover.name}</figcaption>
          </figure>
        )}
        <label>
          <span>Отображаемая дата публикации</span>
          <input
            type="datetime-local"
            value={listingMeta.publishedDisplayAt
              ? String(listingMeta.publishedDisplayAt).slice(0, 16)
              : ''}
            onChange={(event) => updateListingMeta({
              publishedDisplayAt: event.target.value
                ? new Date(event.target.value).toISOString()
                : '',
            })}
          />
        </label>
        <label>
          <span>Имя автора</span>
          <input
            value={listingMeta.authorName}
            onChange={(event) => updateListingMeta({ authorName: event.target.value })}
          />
        </label>
        <label>
          <span>Должность автора</span>
          <input
            value={listingMeta.authorTitle}
            onChange={(event) => updateListingMeta({ authorTitle: event.target.value })}
          />
        </label>
        <label>
          <span>Порядок сортировки</span>
          <input
            type="number"
            value={listingMeta.sortOrder}
            onChange={(event) => updateListingMeta({ sortOrder: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Название в меню</span>
          <input
            value={listingMeta.menuLabel}
            onChange={(event) => updateListingMeta({ menuLabel: event.target.value })}
          />
        </label>
        <label className="pb-toggle">
          <input
            type="checkbox"
            checked={listingMeta.featured}
            onChange={(event) => updateListingMeta({ featured: event.target.checked })}
          />
          <span>Показывать как рекомендуемый материал</span>
        </label>
        <label className="pb-toggle">
          <input
            type="checkbox"
            checked={listingMeta.hiddenFromLists}
            onChange={(event) => updateListingMeta({ hiddenFromLists: event.target.checked })}
          />
          <span>Скрыть из публичных списков</span>
        </label>
      </section>
    </div>
  );
}

export default function Inspector() {
  const [tab, setTab] = useState('content');
  const selectedId = useBuilderStore((state) => state.selectedId);
  const block = useBuilderStore((state) => state.byId[state.selectedId]);
  const byId = useBuilderStore((state) => state.byId);
  const title = useBuilderStore((state) => state.title);
  const slug = useBuilderStore((state) => state.slug);
  const contentType = useBuilderStore((state) => state.contentType);
  const routePath = useBuilderStore((state) => state.routePath);
  const updateBlock = useBuilderStore((state) => state.updateBlock);
  const updatePage = useBuilderStore((state) => state.updatePage);
  const moveBlock = useBuilderStore((state) => state.moveBlock);
  const removeBlock = useBuilderStore((state) => state.removeBlock);
  const definition = getBlockDefinition(block?.type);
  const siteId = useBuilderStore((state) => state.siteId);
  const [references, setReferences] = useState({ assets: [], forms: [] });

  const refreshReferences = async () => {
    if (!siteId) return;
    const [assets, forms] = await Promise.all([
      api.resources.list('media', { siteId, pageSize: 100 }),
      api.resources.list('forms', { siteId }),
    ]);
    setReferences({ assets: assets.items || assets, forms: forms.items || forms });
  };

  const uploadMedia = async (file) => {
    if (!siteId) throw new Error('Сначала выберите сайт для страницы.');
    const payload = new FormData();
    payload.append('siteId', siteId);
    payload.append('file', file);
    const created = await api.resources.create('media', payload);
    await refreshReferences();
    return {
      ...created,
      name: created.filename,
      alt: created.altText,
      url: created.url || `/api/v1/public/assets/${created.id}`,
    };
  };

  useEffect(() => {
    if (!siteId) return;
    let active = true;
    Promise.all([
      api.resources.list('media', { siteId, pageSize: 100 }),
      api.resources.list('forms', { siteId }),
    ]).then(([assets, forms]) => {
      if (active) setReferences({ assets: assets.items || assets, forms: forms.items || forms });
    }).catch(() => {});
    return () => { active = false; };
  }, [siteId]);
  const errors = block ? validateBlock(block) : [];
  const containers = useMemo(() => Object.values(byId).filter((item) => (
    item.id !== selectedId && getBlockDefinition(item.type)?.acceptsChildren
  )), [byId, selectedId]);

  return (
    <aside className="pb-editor-right" aria-label="Инспектор">
      <div className="pb-editor-tabs" role="tablist" aria-label="Панели инспектора">
        <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>Контент</button>
        <button type="button" role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>Настройки</button>
        <button type="button" role="tab" aria-selected={tab === 'seo'} onClick={() => setTab('seo')}>SEO и проверки</button>
      </div>
      {tab === 'seo' ? <SeoPanel references={{ ...references, siteId, uploadMedia }} /> : tab === 'settings' ? (
        <PageSettingsPanel references={{ ...references, siteId, uploadMedia }} />
      ) : block && definition ? (
        <div className="pb-inspector-form">
          <header className="pb-inspector-title">
            <span aria-hidden="true">{definition.icon}</span>
            <div><p>{definition.category}</p><h2>{definition.label}</h2></div>
          </header>
          {errors.length > 0 && <div className="pb-alert pb-alert--error">{errors.join('. ')}</div>}
          <section className="pb-inspector-section">
            {definition.schema
              .filter((field) => shouldShowBlockField(block, field))
              .map((field) => (
              <ComplexField
                key={field.name}
                field={{ ...field, label: blockFieldLabel(block, field) }}
                value={block.props[field.name]}
                onChange={(value) => updateBlock(block.id, { [field.name]: value })}
                references={{ ...references, siteId, uploadMedia }}
              />
            ))}
          </section>
          <section className="pb-inspector-section">
            <h2>Положение</h2>
            <label><span>Родительский контейнер</span>
              <select
                value={block.parentId || ''}
                onChange={(event) => moveBlock(block.id, event.target.value || null, 9999)}
              >
                <option value="">Корень страницы</option>
                {containers.map((item) => <option key={item.id} value={item.id}>{getBlockDefinition(item.type)?.label} · {item.id.slice(-6)}</option>)}
              </select>
            </label>
          </section>
          <button className="pb-danger-button" type="button" onClick={() => removeBlock(block.id)}>Удалить блок</button>
        </div>
      ) : (
        <div className="pb-inspector-form">
          <header className="pb-inspector-title"><span aria-hidden="true">⌂</span><div><p>СТРАНИЦА</p><h2>Настройки страницы</h2></div></header>
          <section className="pb-inspector-section">
            <label><span>Заголовок</span><input value={title} onChange={(event) => updatePage({ title: event.target.value })} /></label>
            <label><span>URL-идентификатор</span><div className="pb-input-prefix"><span>/</span><input value={slug} onChange={(event) => {
              const nextSlug = slugify(event.target.value, '');
              updatePage({
                slug: nextSlug,
                routePath: routePath === defaultRoutePath(contentType, slug)
                  ? defaultRoutePath(contentType, nextSlug)
                  : routePath,
              });
            }} /></div></label>
          </section>
          <p className="pb-inspector-help">Выберите блок на холсте, чтобы изменить его контент и настройки.</p>
        </div>
      )}
    </aside>
  );
}
