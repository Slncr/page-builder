import { useId, useRef, useState } from 'react';
import {
  resolveAsset,
  resolveLink,
  safeMediaUrl,
  sanitizeHtml,
} from './sanitize.js';

export const INTERACTIVE_BLOCK_TYPES = new Set([
  'accordion',
  'faq',
  'tabs',
  'form',
  'gallery',
  'video',
]);

export function isInteractiveBlock(type) {
  return INTERACTIVE_BLOCK_TYPES.has(type);
}

function Accordion({ block }) {
  const baseId = useId();
  const [open, setOpen] = useState(() => new Set([
    Number.isInteger(block.props.defaultOpenIndex) ? block.props.defaultOpenIndex : 0,
  ]));
  const items = (block.props.items || []).map((item) => ({
    title: item.title || item.question,
    content: item.content || item.answer,
  }));
  const allowMultiple = block.props.allowMultiple ?? block.props.singleOpen === false;

  const toggle = (index) => {
    setOpen((current) => {
      const next = allowMultiple ? new Set(current) : new Set();
      if (current.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const accordion = (
    <div className={`pb-accordion${block.type === 'faq' ? ' pb-faq' : ''}`}>
      {items.map((item, index) => {
        const expanded = open.has(index);
        const triggerId = `${baseId}-trigger-${index}`;
        const panelId = `${baseId}-panel-${index}`;
        return (
          <section key={`${item.title}-${index}`}>
            <h3>
              <button
                id={triggerId}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(index)}
              >
                <span>{item.title}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              hidden={!expanded}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
            />
          </section>
        );
      })}
    </div>
  );
  if (block.type !== 'faq' || !block.props.schemaMarkup) return accordion;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.title,
      acceptedAnswer: {
        '@type': 'Answer',
        text: sanitizeHtml(item.content).replace(/<[^>]*>/g, ' '),
      },
    })),
  }).replaceAll('<', '\\u003c');
  return <>{accordion}<script type="application/ld+json">{structuredData}</script></>;
}

function Tabs({ block }) {
  const items = block.props.tabs || [];
  const baseId = useId();
  const [active, setActive] = useState(Number(block.props.defaultTab) || 0);
  const refs = useRef([]);

  const activate = (index) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event, index) => {
    if (event.key === 'ArrowRight') activate(index + 1);
    else if (event.key === 'ArrowLeft') activate(index - 1);
    else if (event.key === 'Home') activate(0);
    else if (event.key === 'End') activate(items.length - 1);
    else return;
    event.preventDefault();
  };

  if (!items.length) return null;
  return (
    <div className={`pb-tabs pb-tabs--${block.props.layout || 'horizontal'}`}>
      <div role="tablist" aria-label="Вкладки с контентом">
        {items.map((item, index) => (
          <button
            key={`${item.label}-${index}`}
            ref={(element) => { refs.current[index] = element; }}
            id={`${baseId}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={active === index}
            aria-controls={`${baseId}-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={index}
          id={`${baseId}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${index}`}
          tabIndex="0"
          hidden={active !== index}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
        />
      ))}
    </div>
  );
}

function FormField({ field, formId }) {
  const id = `${formId}-${field.name}`;
  if (field.type === 'hidden') {
    return <input name={field.name} type="hidden" value={field.value || ''} readOnly />;
  }
  if (field.type === 'checkbox' || field.type === 'consent') {
    return (
      <label className="pb-form__checkbox" htmlFor={id}>
        <input id={id} name={field.name} type="checkbox" required={field.required} />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label htmlFor={id}>
        <span>{field.label}{field.required && <span aria-hidden="true"> *</span>}</span>
        <textarea id={id} name={field.name} required={field.required} rows="5" />
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label htmlFor={id}>
        <span>{field.label}{field.required && <span aria-hidden="true"> *</span>}</span>
        <select id={id} name={field.name} required={field.required}>
          <option value="">Выберите вариант</option>
          {(field.options || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'radio') {
    return (
      <fieldset className="pb-form__radios">
        <legend>{field.label}{field.required && <span aria-hidden="true"> *</span>}</legend>
        {(field.options || []).map((option, index) => (
          <label key={option}>
            <input
              name={field.name}
              type="radio"
              value={option}
              required={field.required && index === 0}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  const type = field.type === 'phone'
    ? 'tel'
    : ['email', 'tel', 'number'].includes(field.type)
      ? field.type
      : 'text';
  return (
    <label htmlFor={id}>
      <span>{field.label}{field.required && <span aria-hidden="true"> *</span>}</span>
      <input
        id={id}
        name={field.name}
        type={type}
        required={field.required}
        minLength={field.minLength}
        maxLength={field.maxLength}
        pattern={field.pattern || undefined}
      />
    </label>
  );
}

function Form({ block, document, adapters }) {
  const formId = useId();
  const startedAt = useRef(new Date().toISOString());
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setStatus('submitting');
    setMessage('');
    try {
      if (!block.props.formId && !block.props.action) {
        throw new Error('Форма не подключена');
      }
      const fields = Object.fromEntries(new FormData(form));
      const website = fields.website || '';
      delete fields.website;
      const action = block.props.action
        ? resolveLink(block.props.action, adapters.linkResolver, {
          block,
          purpose: 'form-action',
        }).href
        : '';
      const result = await adapters.formSubmitter(
        { data: fields, website, startedAt: startedAt.current },
        {
          action,
          formId: block.props.formId,
          block,
          document,
        },
      );
      setStatus('success');
      setMessage(result?.message || block.props.successMessage || 'Спасибо! Ваш ответ получен.');
      form.reset();
      const redirectUrl = result?.redirectUrl
        || (block.props.successAction === 'redirect' ? block.props.redirectUrl : '');
      if (redirectUrl) {
        window.location.assign(resolveLink(redirectUrl, adapters.linkResolver, {
          block,
          purpose: 'form-redirect',
          fallback: '/',
        }).href);
      }
    } catch (error) {
      setStatus('error');
      setMessage(error.message || 'Не удалось отправить форму. Попробуйте ещё раз.');
    }
  };

  return (
    <form className="pb-form" onSubmit={submit} aria-labelledby={`${formId}-title`}>
      <div>
        <h2 id={`${formId}-title`}>{block.props.title}</h2>
        {block.props.description && <p>{block.props.description}</p>}
      </div>
      {(block.props.fields || []).map((field, index) => (
        <FormField field={field} formId={formId} key={`${field.name}-${index}`} />
      ))}
      {block.props.antispam !== false && (
        <label className="pb-form__honeypot" aria-hidden="true">
          Оставьте это поле пустым
          <input name="website" tabIndex="-1" autoComplete="off" />
        </label>
      )}
      <button
        className="pb-button pb-button--primary"
        type="submit"
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? 'Отправка…' : block.props.submitLabel}
      </button>
      <p
        className={`pb-form__status pb-form__status--${status}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
    </form>
  );
}

function Gallery({ block, adapters }) {
  const dialog = useRef(null);
  const [selected, setSelected] = useState(null);
  const images = (block.props.assets || block.props.images || [])
    .map((item) => {
      const asset = typeof item === 'string' ? { assetId: item } : item;
      return {
        ...asset,
        src: safeMediaUrl(asset.src || asset.url)
          || resolveAsset(asset.assetId, adapters.assetResolver, {
            block,
            purpose: 'gallery-image',
          }),
      };
    })
    .filter((item) => item.src);

  const open = (item) => {
    if (!block.props.lightbox) return;
    setSelected(item);
    requestAnimationFrame(() => dialog.current?.showModal());
  };

  return (
    <>
      <div className={`pb-gallery pb-gallery--${block.props.columns} pb-gap--${block.props.gap || 'medium'}`}>
        {images.map((item, index) => (
          block.props.lightbox ? (
            <button
              type="button"
              onClick={() => open(item)}
              key={`${item.src}-${index}`}
              aria-label={`Открыть изображение ${index + 1}`}
            >
              <img src={item.src} alt={item.alt || ''} loading="lazy" />
            </button>
          ) : (
            <img
              src={item.src}
              alt={item.alt || ''}
              loading="lazy"
              key={`${item.src}-${index}`}
            />
          )
        ))}
      </div>
      <dialog className="pb-lightbox" ref={dialog} onClose={() => setSelected(null)}>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="Закрыть изображение"
        >
          ×
        </button>
        {selected && <img src={selected.src} alt={selected.alt || ''} />}
      </dialog>
    </>
  );
}

function videoEmbedUrl(source) {
  try {
    const parsed = new URL(source);
    if (parsed.hostname.includes('youtube.com')) {
      return `https://www.youtube-nocookie.com/embed/${parsed.searchParams.get('v') || ''}`;
    }
    if (parsed.hostname === 'youtu.be') {
      return `https://www.youtube-nocookie.com/embed${parsed.pathname}`;
    }
    if (parsed.hostname.includes('vimeo.com')) {
      return `https://player.vimeo.com/video${parsed.pathname}`;
    }
  } catch {
    return '';
  }
  return '';
}

function Video({ block, adapters }) {
  const source = safeMediaUrl(block.props.videoUrl || block.props.src);
  const embed = videoEmbedUrl(source);
  if (!source) return <div className="pb-placeholder">Добавьте URL видео</div>;
  if (embed) {
    return (
      <iframe
        className="pb-video"
        style={{ aspectRatio: block.props.aspectRatio }}
        src={embed}
        title={block.props.title || 'Встроенное видео'}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  const autoplay = Boolean(block.props.autoplay && block.props.muted);
  const poster = safeMediaUrl(block.props.poster)
    || resolveAsset(block.props.posterAssetId, adapters.assetResolver, {
      block,
      purpose: 'video-poster',
    });
  return (
    <video
      className="pb-video"
      style={{ aspectRatio: block.props.aspectRatio }}
      src={source}
      poster={poster}
      autoPlay={autoplay}
      muted={Boolean(block.props.muted)}
      loop={Boolean(block.props.loop)}
      controls={block.props.controls !== false}
      preload="metadata"
    />
  );
}

export function InteractiveBlock({ block, document, adapters }) {
  switch (block.type) {
    case 'accordion': return <Accordion block={block} />;
    case 'faq': return <Accordion block={block} />;
    case 'tabs': return <Tabs block={block} />;
    case 'form': return <Form block={block} document={document} adapters={adapters} />;
    case 'gallery': return <Gallery block={block} adapters={adapters} />;
    case 'video': return <Video block={block} adapters={adapters} />;
    default: return null;
  }
}

export default InteractiveBlock;
