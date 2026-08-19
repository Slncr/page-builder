import { useEffect, useMemo, useState } from 'react';
import {
  linkProps,
  resolveAsset,
  safeMediaUrl,
  sanitizeHtml,
} from './sanitize.js';

const cleanColor = (value, fallback) => (
  /^(#[\da-f]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\)|[a-z]+)$/i.test(value || '')
    ? value
    : fallback
);

const cleanBackground = (value, type) => (
  type === 'gradient'
  && /^(linear|radial)-gradient\([#\w\s(),.%+-]+\)$/i.test(value || '')
    ? value
    : cleanColor(value, '#ffffff')
);

const classToken = (value, fallback = 'default') => (
  /^[a-z0-9-]+$/i.test(value || '') ? value : fallback
);

function Action({
  label,
  href,
  url,
  target,
  variant = 'primary',
  size = 'medium',
  icon,
  fullWidth = false,
  newTab = false,
  adapters,
  block,
}) {
  if (!label) return null;
  const externalWindow = newTab || target === '_blank';
  return (
    <a
      className={`pb-button pb-button--${variant} pb-button--${size}${fullWidth ? ' pb-button--full' : ''}`}
      {...linkProps(
        href || url,
        adapters.linkResolver,
        { block, purpose: 'action' },
        externalWindow,
      )}
    >
      {icon && <span aria-hidden="true">{icon}</span>}{label}
    </a>
  );
}

function Section({ block, children, adapters }) {
  const { props } = block;
  if (props.visibility === false) return null;
  const styleVariant = classToken(props.styleVariant);
  const image = props.backgroundType === 'image'
    ? resolveAsset(props.backgroundImage, adapters.assetResolver, {
      block,
      purpose: 'section-background',
    })
    : '';
  const background = props.backgroundType === 'none'
    ? 'transparent'
    : cleanBackground(props.backgroundColor || props.background, props.backgroundType);
  return (
    <section
      id={props.anchorId || props.anchor || undefined}
      className={`pb-section pb-section--${styleVariant} pb-width--${props.containerWidth || props.maxWidth || 'default'}${image ? ' pb-section--image' : ''}`}
      data-pb-variant={styleVariant}
      style={{
        '--pb-section-bg': background,
        '--pb-section-fg': cleanColor(props.foreground, '#172033'),
        '--pb-section-image': image ? `url("${image.replaceAll('"', '%22')}")` : undefined,
        '--pb-section-padding-top': `${Math.max(0, Number(props.paddingTop) || 0)}px`,
        '--pb-section-padding-bottom': `${Math.max(0, Number(props.paddingBottom) || 0)}px`,
      }}
    >
      <div className="pb-section__inner">{children}</div>
    </section>
  );
}

function Container({ block, children }) {
  return (
    <div className={`pb-container pb-container--${block.props.width} pb-align--${block.props.align}`}>
      {children}
    </div>
  );
}

function Columns({ block, children }) {
  const columns = Number(block.props.layout || block.props.columns) || 2;
  const ratio = classToken(block.props.ratio, 'equal');
  return (
    <div
      className={`pb-columns pb-columns--${columns} pb-columns--ratio-${ratio} pb-gap--${block.props.gap}${block.props.stackOnMobile !== false ? ' pb-stack--mobile' : ''}`}
      style={{ alignItems: block.props.alignItems || undefined }}
    >
      {children}
    </div>
  );
}

function Card({ block, adapters }) {
  const source = resolveAsset(block.props.image, adapters.assetResolver, {
    block,
    purpose: 'card-image',
  });
  return (
    <article className={`pb-content-card${block.props.elevated ? ' pb-card--elevated' : ''}`}>
      {source && <img src={source} alt={block.props.imageAlt || ''} loading="lazy" />}
      <div>
        <h3>{block.props.title}</h3>
        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.props.text) }} />
        <Action label={block.props.button} url={block.props.link} adapters={adapters} block={block} />
      </div>
    </article>
  );
}

function Heading({ block }) {
  const level = Math.min(
    6,
    Math.max(1, Number(String(block.props.level).replace(/\D/g, '')) || 2),
  );
  const Tag = `h${level}`;
  return (
    <Tag
      id={block.props.anchorId || undefined}
      className={`pb-heading pb-align--${block.props.align}`}
    >
      {block.props.text}
    </Tag>
  );
}

function RichText({ block }) {
  const variant = classToken(block.props.variant, 'default');
  return (
    <div
      className={`pb-richtext pb-richtext--${variant} pb-align--${block.props.align}`}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.props.html) }}
    />
  );
}

function ImageBlock({ block, document, adapters }) {
  const pageCoverAssetId = block.props.usePageCover
    ? document?.listingMeta?.coverAssetId
    : '';
  const source = safeMediaUrl(block.props.src)
    || resolveAsset(block.props.assetId || pageCoverAssetId, adapters.assetResolver, {
      block,
      purpose: block.props.usePageCover ? 'page-cover' : 'image',
    });
  if (!source) {
    return block.props.usePageCover
      ? <div className="pb-cover-placeholder">Добавьте обложку в настройках страницы</div>
      : <div className="pb-placeholder">Выберите изображение</div>;
  }
  const media = (
    <img
      src={source}
      alt={block.props.decorative ? '' : (block.props.alt || '')}
      loading={block.props.lazyLoad === false || block.props.loading === 'eager' ? 'eager' : 'lazy'}
      style={{
        aspectRatio: block.props.ratio === 'auto' ? undefined : block.props.ratio,
        borderRadius: block.props.borderRadius
          ? `${Number(block.props.borderRadius)}px`
          : undefined,
        objectPosition: block.props.focalPoint || undefined,
      }}
      className={`pb-image__media pb-fit--${block.props.fit || 'cover'}`}
    />
  );
  return (
    <figure
      className={`pb-image pb-align--${block.props.align || 'left'}`}
      style={{ maxWidth: block.props.width || undefined }}
    >
      {block.props.link
        ? <a {...linkProps(block.props.link, adapters.linkResolver, { block, purpose: 'image-link' })}>{media}</a>
        : media}
      {block.props.caption && <figcaption>{block.props.caption}</figcaption>}
    </figure>
  );
}

function Hero({ block, adapters }) {
  const props = block.props;
  const image = resolveAsset(props.backgroundImage, adapters.assetResolver, {
    block,
    purpose: 'hero-background',
  });
  return (
    <section
      className={`pb-hero pb-align--${props.align}${image ? ' pb-hero--image' : ''}`}
      style={image ? { '--pb-hero-image': `url("${image.replaceAll('"', '%22')}")` } : undefined}
    >
      <div className="pb-hero__content">
        {props.eyebrow && <p className="pb-eyebrow">{props.eyebrow}</p>}
        <h1>{props.title}</h1>
        <div
          className="pb-hero__body"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(props.body) }}
        />
        <div className="pb-actions">
          <Action label={props.primaryLabel} href={props.primaryHref} adapters={adapters} block={block} />
          <Action
            label={props.secondaryLabel}
            href={props.secondaryHref}
            variant="secondary"
            adapters={adapters}
            block={block}
          />
        </div>
      </div>
    </section>
  );
}

function Features({ block }) {
  const columns = Number(block.props.columns) || 3;
  const iconStyle = block.props.iconStyle || 'number';
  return (
    <section className="pb-feature-section">
      {block.props.title && <h2>{block.props.title}</h2>}
      <div className={`pb-feature-grid pb-feature-grid--${columns}`}>
        {(block.props.items || []).map((item, index) => (
          <article className="pb-feature" key={`${item.title}-${index}`}>
            <span className="pb-feature__index" aria-hidden="true">
              {iconStyle === 'custom'
                ? item.icon
                : iconStyle === 'check'
                  ? '✓'
                  : String(index + 1).padStart(2, '0')}
            </span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Quote({ block, adapters }) {
  const quote = block.props.text || block.props.quote;
  return (
    <figure className={`pb-quote pb-quote--${block.props.layout || 'default'}`}>
      <blockquote>{quote}</blockquote>
      {(block.props.author || block.props.role || block.props.sourceUrl) && (
        <figcaption>
          {block.props.author && <strong>{block.props.author}</strong>}
          {block.props.role && <span>{block.props.role}</span>}
          {block.props.sourceUrl && (
            <a {...linkProps(block.props.sourceUrl, adapters.linkResolver, { block, purpose: 'quote-source' })}>
              Источник
            </a>
          )}
        </figcaption>
      )}
    </figure>
  );
}

function List({ block }) {
  const style = block.props.style || (block.props.ordered ? 'numbers' : 'bullets');
  const Tag = style === 'numbers' ? 'ol' : 'ul';
  return (
    <Tag className={`pb-list pb-list--${style}`}>
      {(block.props.items || []).map((item, index) => <li key={index}>{item.text}</li>)}
    </Tag>
  );
}

function Table({ block }) {
  const headers = block.props.headerRow || block.props.headers || [];
  return (
    <div
      className="pb-table-wrap"
      tabIndex="0"
      role="region"
      aria-label={block.props.caption || 'Таблица данных'}
    >
      <table className="pb-table">
        <caption>{block.props.caption}</caption>
        <thead>
          <tr>
            {headers.map((header, index) => <th scope="col" key={index}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {(block.props.rows || []).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((_, columnIndex) => (
                columnIndex === 0
                  ? <th scope="row" key={columnIndex}>{row[columnIndex] || ''}</th>
                  : <td key={columnIndex}>{row[columnIndex] || ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stats({ block }) {
  return (
    <dl className="pb-stats">
      {(block.props.items || []).map((item, index) => (
        <div key={`${item.label}-${index}`}>
          <dd>{item.value}</dd>
          <dt>{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function Testimonials({ block }) {
  return (
    <section className="pb-testimonials">
      {block.props.title && <h2>{block.props.title}</h2>}
      <div className="pb-testimonials__grid">
        {(block.props.items || []).map((item, index) => (
          <figure key={`${item.name}-${index}`}>
            <blockquote>“{item.quote}”</blockquote>
            <figcaption><strong>{item.name}</strong><span>{item.role}</span></figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Pricing({ block, adapters }) {
  return (
    <section className="pb-pricing">
      {block.props.title && <h2>{block.props.title}</h2>}
      <div className="pb-pricing__grid">
        {(block.props.plans || []).map((plan, index) => (
          <article key={`${plan.name}-${index}`}>
            <h3>{plan.name}</h3>
            <p className="pb-pricing__price">{plan.price}</p>
            <p>{plan.description}</p>
            <ul>
              {String(plan.features || '').split(',').filter(Boolean).map(
                (feature) => <li key={feature}>{feature.trim()}</li>,
              )}
            </ul>
            <Action label={plan.cta} href={plan.href} adapters={adapters} block={block} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Cta({ block, adapters }) {
  const { props } = block;
  const actions = props.buttons?.length
    ? props.buttons
    : [{ label: props.label, url: props.href }];
  return (
    <aside
      className={`pb-cta pb-cta--${props.tone || 'brand'} pb-cta-layout--${props.layout || 'split'}`}
      style={props.background ? { background: cleanColor(props.background, undefined) } : undefined}
    >
      <div><h2>{props.title}</h2><p>{props.text}</p></div>
      <div className="pb-actions">
        {actions.map((action, index) => (
          <Action
            key={`${action.label}-${index}`}
            {...action}
            adapters={adapters}
            block={block}
          />
        ))}
      </div>
    </aside>
  );
}

function FileDownload({ block, adapters }) {
  const source = safeMediaUrl(block.props.url)
    || resolveAsset(block.props.assetId, adapters.assetResolver, {
      block,
      purpose: 'file',
    });
  if (!source) return <div className="pb-placeholder">Выберите файл для скачивания</div>;
  return (
    <a className="pb-download" href={source}>
      <span aria-hidden="true">⇩</span>
      <strong>{block.props.label}</strong>
      {(block.props.showType || block.props.showSize) && (
        <small>
          {[block.props.showType && block.props.fileType, block.props.showSize && block.props.size]
            .filter(Boolean)
            .join(' · ')}
        </small>
      )}
    </a>
  );
}

function allowlistedEmbed(value, provider) {
  const source = safeMediaUrl(value);
  if (!source) return '';
  try {
    const host = new URL(source).hostname.toLowerCase();
    const youtube = ['youtube.com', 'www.youtube.com', 'www.youtube-nocookie.com', 'youtu.be'];
    const vimeo = ['player.vimeo.com', 'vimeo.com'];
    const googleMaps = ['www.google.com', 'maps.google.com'];
    const yandexMaps = ['yandex.com', 'yandex.ru'];
    const allowedByProvider = {
      youtube,
      vimeo,
      google_maps: googleMaps,
      yandex_maps: yandexMaps,
    }[provider] || [...youtube, ...vimeo, ...googleMaps, ...yandexMaps];
    return allowedByProvider.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
      ? source
      : '';
  } catch {
    return '';
  }
}

function Embed({ block }) {
  const source = allowlistedEmbed(block.props.url || block.props.src, block.props.provider);
  if (!source) {
    return (
      <div className="pb-placeholder">
        Добавьте URL, соответствующий выбранному источнику ({block.props.provider || 'любой'})
      </div>
    );
  }
  return (
    <iframe
      className="pb-embed"
      src={source}
      title={block.props.title || 'Встроенный контент'}
      height={Math.min(1000, Math.max(160, Number(block.props.height) || 420))}
      loading="lazy"
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

function MapBlock({ block }) {
  const query = block.props.coordinates || block.props.address;
  if (!query) return <div className="pb-placeholder">Добавьте адрес или координаты</div>;
  const zoom = Math.min(20, Math.max(1, Number(block.props.zoom) || 14));
  const source = block.props.provider === 'yandex'
    ? `https://yandex.com/map-widget/v1/?text=${encodeURIComponent(query)}&z=${zoom}`
    : `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${zoom}&output=embed`;
  return (
    <iframe
      className="pb-map"
      src={source}
      title={block.props.address ? `Карта: ${block.props.address}` : 'Карта местоположения'}
      height={Math.min(1000, Math.max(160, Number(block.props.height) || 420))}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
}

function Breadcrumbs({ block, document, adapters }) {
  const path = document?.routePath || document?.path || '/';
  const automatic = path.split('/').filter(Boolean).map((part, index, parts) => ({
    label: index === parts.length - 1 && document?.title
      ? document.title
      : decodeURIComponent(part).replaceAll('-', ' '),
    href: `/${parts.slice(0, index + 1).join('/')}`,
  }));
  const breadcrumbItems = block.props.source === 'auto'
    ? [{ label: 'Главная', href: '/' }, ...automatic]
    : (block.props.items || []);
  return (
    <nav className="pb-breadcrumbs" aria-label="Хлебные крошки">
      <ol>
        {breadcrumbItems.map((item, index, items) => (
          <li key={`${item.label}-${index}`}>
            {index === items.length - 1 || !item.href
              ? <span aria-current="page">{item.label}</span>
              : (
                <a {...linkProps(item.href, adapters.linkResolver, {
                  block,
                  purpose: 'breadcrumb',
                })}
                >
                  {item.label}
                </a>
              )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PageList({ block, document, adapters }) {
  const props = block.props;
  const limit = Number(props.limit) || 6;
  const manualItems = useMemo(
    () => (props.items || []).slice(0, limit),
    [props.items, limit],
  );
  const [items, setItems] = useState(props.sourceType === 'manual' ? manualItems : null);
  const [error, setError] = useState('');
  const pageContentType = document?.contentType || '';
  const pageSectionKey = document?.sectionKey || '';

  useEffect(() => {
    if (props.sourceType === 'manual') {
      setItems(manualItems);
      return undefined;
    }
    let active = true;
    adapters.pageFeedResolver?.({
      sourceType: props.sourceType,
      source: props.source,
      sort: props.sort,
      limit,
      items: manualItems,
      contentType: pageContentType,
      sectionKey: pageSectionKey,
    }).then((feed) => {
      if (!active) return;
      const nextItems = (feed?.items || []).slice(0, limit);
      setItems(nextItems.length ? nextItems : manualItems);
      setError('');
    }).catch((nextError) => {
      if (!active) return;
      setItems(manualItems);
      setError(nextError.message || 'Не удалось загрузить список страниц.');
    });
    return () => { active = false; };
  }, [
    adapters.pageFeedResolver,
    limit,
    manualItems,
    pageContentType,
    pageSectionKey,
    props.sort,
    props.source,
    props.sourceType,
  ]);

  if (items === null) {
    return <div className="pb-placeholder">Загрузка списка страниц…</div>;
  }

  return (
    <>
      {error && <p className="pb-form__status pb-form__status--error" role="status">{error}</p>}
      <div className={`pb-page-list pb-page-list--${props.cardTemplate || 'default'}`}>
        {items.map((item, index) => {
          const cover = item.coverAssetId
            ? resolveAsset(item.coverAssetId, adapters.assetResolver, {
              block,
              purpose: 'page-list-cover',
            })
            : '';
          return (
            <article key={`${item.title}-${index}`}>
              {cover && props.cardTemplate === 'image' && (
                <img src={cover} alt="" loading="lazy" className="pb-page-list__cover" />
              )}
              <h3>
                <a {...linkProps(item.href, adapters.linkResolver, { block, purpose: 'page-list' })}>
                  {item.title}
                </a>
              </h3>
              {item.description && <p>{item.description}</p>}
            </article>
          );
        })}
      </div>
    </>
  );
}

function Navbar({ block, adapters }) {
  const props = block.props;
  return (
    <nav className="pb-navbar" aria-label="Основная навигация">
      <a
        className="pb-navbar__brand"
        {...linkProps(props.homeHref, adapters.linkResolver, {
          block,
          purpose: 'brand',
          fallback: '/',
        })}
      >
        {props.brand}
      </a>
      <ul>
        {(props.links || []).map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <a {...linkProps(item.href, adapters.linkResolver, { block, purpose: 'navigation' })}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      <Action label={props.ctaLabel} href={props.ctaHref} adapters={adapters} block={block} />
    </nav>
  );
}

function Footer({ block, adapters }) {
  const props = block.props;
  return (
    <footer className="pb-footer">
      <div><strong>{props.brand}</strong><p>{props.text}</p></div>
      <nav aria-label="Навигация в подвале">
        {(props.links || []).map((item, index) => (
          <a
            {...linkProps(item.href, adapters.linkResolver, {
              block,
              purpose: 'footer-navigation',
            })}
            key={`${item.label}-${index}`}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <small>{props.copyright}</small>
    </footer>
  );
}

export function StaticBlock({ block, children, document, adapters }) {
  switch (block.type) {
    case 'section': return <Section block={block} adapters={adapters}>{children}</Section>;
    case 'container': return <Container block={block}>{children}</Container>;
    case 'columns': return <Columns block={block}>{children}</Columns>;
    case 'card': return <Card block={block} adapters={adapters} />;
    case 'heading': return <Heading block={block} />;
    case 'richText': return <RichText block={block} />;
    case 'text': return <RichText block={block} />;
    case 'image': return <ImageBlock block={block} document={document} adapters={adapters} />;
    case 'button': return <Action {...block.props} adapters={adapters} block={block} />;
    case 'hero': return <Hero block={block} adapters={adapters} />;
    case 'features': return <Features block={block} />;
    case 'featureList': return <Features block={block} />;
    case 'file': return <FileDownload block={block} adapters={adapters} />;
    case 'quote': return <Quote block={block} adapters={adapters} />;
    case 'list': return <List block={block} />;
    case 'divider': return (
      <hr
        className={`pb-divider pb-divider--${block.props.style}`}
        style={{
          '--pb-divider-thickness': `${block.props.thickness || 1}px`,
          '--pb-divider-color': cleanColor(block.props.color, '#dce2ea'),
          '--pb-divider-margin': `${block.props.margin || 0}px`,
        }}
      />
    );
    case 'spacer': return (
      <div
        className="pb-spacer"
        style={{
          '--pb-spacer-height': `${block.props.height || 0}px`,
          '--pb-spacer-tablet': `${block.props.heightTablet ?? block.props.height ?? 0}px`,
          '--pb-spacer-mobile': `${block.props.heightMobile ?? block.props.height ?? 0}px`,
        }}
        aria-hidden="true"
      />
    );
    case 'table': return <Table block={block} />;
    case 'stats': return <Stats block={block} />;
    case 'testimonials': return <Testimonials block={block} />;
    case 'pricing': return <Pricing block={block} adapters={adapters} />;
    case 'cta': return <Cta block={block} adapters={adapters} />;
    case 'embed': return <Embed block={block} />;
    case 'html': return (
      <div
        className="pb-html"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.props.html) }}
      />
    );
    case 'map': return <MapBlock block={block} />;
    case 'breadcrumbs': return (
      <Breadcrumbs block={block} document={document} adapters={adapters} />
    );
    case 'pageList': return <PageList block={block} document={document} adapters={adapters} />;
    case 'navbar': return <Navbar block={block} adapters={adapters} />;
    case 'footer': return <Footer block={block} adapters={adapters} />;
    default: return (
      <div className="pb-placeholder">Неподдерживаемый блок: {block.type}</div>
    );
  }
}
