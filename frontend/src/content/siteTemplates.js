import { createBlock } from '../registry/index.js';
import { LISTING_META_DEFAULTS, normalizeListingMeta, normalizePageLayout } from './pageTypes.js';

const ABOUT_LAYOUT = Object.freeze({
  shell: 'about',
  showPageTitle: false,
  breadcrumbs: 'auto',
});

export const SITE_PATHS = Object.freeze({
  doctors: '/doctors',
  news: '/about/news',
  articles: '/about/articles',
  directions: '/services/directions',
});

function node(id, type, props = {}, children = []) {
  return { id, type, props, children };
}

function section(id, styleVariant, backgroundColor, children, options = {}) {
  const backgroundType = String(backgroundColor).includes('gradient(') ? 'gradient' : 'color';
  const requestedWidth = options.width || 'wide';
  const contentWidth = requestedWidth === 'narrow' ? 'wide' : requestedWidth;
  return node(id, 'section', {
    styleVariant,
    backgroundType,
    backgroundColor,
    foreground: options.foreground || '#172033',
    containerWidth: 'full',
    paddingTop: options.paddingTop ?? 48,
    paddingBottom: options.paddingBottom ?? 48,
  }, [
    container(`${id}-container`, children, { width: contentWidth, align: 'center' }),
  ]);
}

function container(id, children, options = {}) {
  return node(id, 'container', {
    width: options.width || 'wide',
    align: options.align || 'center',
  }, children);
}

function asColumnChild(child, index, prefix) {
  if (child.type === 'container') {
    return {
      ...child,
      props: { ...child.props, width: 'full' },
    };
  }
  return container(`${prefix}-col-${index}`, [child], { width: 'full' });
}

function columns(id, children, options = {}) {
  return node(id, 'columns', {
    layout: children.length,
    ratio: options.ratio || 'equal',
    gap: options.gap || 'large',
    alignItems: options.alignItems || 'stretch',
    stackOnMobile: true,
  }, children.map((child, index) => asColumnChild(child, index, id)));
}

function pageCover(id, ratio = '4/3') {
  return node(id, 'image', {
    assetId: '',
    usePageCover: true,
    alt: '',
    decorative: true,
    caption: '',
    width: '100%',
    align: 'left',
    borderRadius: 24,
    lazyLoad: false,
    focalPoint: '50% 50%',
    fit: 'cover',
    ratio,
  });
}

function editorialMeta(id, label) {
  return node(id, 'text', {
    html: `<p><strong>${label}</strong></p>`,
    align: 'left',
    variant: 'eyebrow',
  });
}

function heading(id, text, level = 'h2', align = 'left') {
  return node(id, 'heading', { text, level, align });
}

function text(id, html, align = 'left') {
  return node(id, 'text', {
    html,
    align,
    variant: id.endsWith('-lead') ? 'lead' : 'default',
  });
}

function list(id, items, style = 'checks') {
  return node(id, 'list', {
    style,
    items: items.map((item) => ({ text: item })),
  });
}

function card(id, title, html, options = {}) {
  return node(id, 'card', {
    image: '',
    imageAlt: '',
    title,
    text: html,
    link: options.link || '',
    button: options.button || '',
    elevated: options.elevated ?? true,
  });
}

function quote(id, value, author, layout = 'large') {
  return node(id, 'quote', {
    text: value,
    author,
    sourceUrl: '',
    layout,
  });
}

function cta(id, title, description, options = {}) {
  return node(id, 'cta', {
    title,
    text: description,
    buttons: options.buttons || [
      { label: 'Записаться на приём', url: SITE_PATHS.doctors, variant: 'primary' },
    ],
    background: options.background || '#2563eb',
    layout: options.layout || 'split',
  });
}

function ctaSection(id, title, description, options = {}) {
  return section(`${id}-section`, options.styleVariant || 'default', options.sectionBackground || '#ffffff', [
    cta(id, title, description, options),
  ], {
    width: 'wide',
    paddingTop: options.paddingTop ?? 16,
    paddingBottom: options.paddingBottom ?? 40,
  });
}

function faq(id, items) {
  return node(id, 'faq', {
    schemaMarkup: true,
    items: items.map(([question, answer]) => ({
      question,
      answer: `<p>${answer}</p>`,
    })),
  });
}

function related(id, contentType) {
  const isNews = contentType === 'news';
  return section(`${id}-section`, 'editorial-related', '#f8fafc', [
    heading(`${id}-heading`, isNews ? 'Другие новости' : 'Другие статьи'),
    node(id, 'pageList', {
      sourceType: 'manual',
      source: '',
      limit: 3,
      sort: 'newest',
      cardTemplate: 'image',
      items: [
        {
          title: isNews ? 'Новость клиники' : 'Материал врача',
          description: 'Краткое описание связанного материала.',
          href: isNews ? SITE_PATHS.news : SITE_PATHS.articles,
        },
        {
          title: isNews ? 'Важное объявление' : 'Полезная статья',
          description: 'Замените карточку на актуальную публикацию.',
          href: isNews ? SITE_PATHS.news : SITE_PATHS.articles,
        },
        {
          title: isNews ? 'Событие ЕвроДон' : 'Советы специалиста',
          description: 'Замените карточку на актуальную публикацию.',
          href: isNews ? SITE_PATHS.news : SITE_PATHS.articles,
        },
      ],
    }),
  ], { width: 'wide', paddingTop: 32, paddingBottom: 32 });
}

function buildContent(specs) {
  const byId = {};
  const childrenByParent = {};

  function visit(spec, parentId = null) {
    const block = createBlock(spec.type, {
      id: spec.id,
      parentId,
      props: spec.props,
    });
    byId[block.id] = block;
    childrenByParent[block.id] = (spec.children || []).map((child) => {
      visit(child, block.id);
      return child.id;
    });
  }

  specs.forEach((spec) => visit(spec));
  return {
    byId,
    rootOrder: specs.map(({ id }) => id),
    childrenByParent,
  };
}

function collectTypes(specs) {
  return specs.flatMap((spec) => [spec.type, ...collectTypes(spec.children || [])]);
}

function template({
  id,
  name,
  pageTitle,
  description,
  category,
  contentType,
  listingMeta,
  preview,
  blocks,
}) {
  return {
    id,
    slug: id,
    name,
    description,
    category,
    contentType,
    sectionKey: contentType === 'news' ? 'news' : 'articles',
    layout: normalizePageLayout(ABOUT_LAYOUT),
    listingMeta: normalizeListingMeta({
      ...LISTING_META_DEFAULTS,
      ...listingMeta,
    }),
    pageMeta: {
      title: pageTitle,
      seoTitle: `${pageTitle} — ЕвроДон`,
      metaDescription: listingMeta.excerpt,
      robots: 'index,follow',
    },
    preview,
    content: buildContent(blocks),
    types: collectTypes(blocks),
  };
}

const phoneButtons = [
  { label: '8 (863) 309-05-06', url: 'tel:+78633090506', variant: 'primary' },
  { label: 'Записаться на приём', url: SITE_PATHS.doctors, variant: 'secondary' },
];

export const SITE_TEMPLATE_CATEGORIES = [
  { id: 'news', label: 'Новости' },
  { id: 'articles', label: 'Статьи' },
];

export const SITE_TEMPLATES = [
  template({
    id: 'news-brief',
    name: 'Оперативная новость',
    pageTitle: 'Филиал продолжает работу: важное для пациентов',
    description: 'Компактная новость с акцентной плашкой: факт, изменение режима и контакты.',
    category: 'news',
    contentType: 'news',
    listingMeta: {
      excerpt: 'Что изменилось для пациентов и как сейчас попасть в клинику.',
    },
    preview: { layout: 'brief', tone: 'red' },
    blocks: [
      section('brief-head', 'news-brief', '#fff7ed', [
        editorialMeta('brief-meta', 'НОВОСТИ · 18 АВГУСТА 2026'),
        heading('brief-h1', 'Филиал продолжает работу: важное для пациентов', 'h1'),
        text(
          'brief-lead',
          '<p><strong>Коротко:</strong> клиника принимает в обычном режиме, но временно изменён вход для пациентов.</p>',
        ),
      ], { width: 'wide', paddingTop: 44, paddingBottom: 44 }),
      section('brief-body', 'default', '#ffffff', [
        text(
          'brief-copy',
          '<p>Сразу сообщите, что произошло, какой филиал затронут и по какому адресу. Первый абзац отвечает на вопрос «что случилось» без рекламного вступления.</p><p>Дальше объясните, как клиника работает сейчас: где временный вход, переносится ли запись, сколько займут работы. Если есть неудобства — извинитесь и поблагодарите за понимание.</p><p>Закончите конкретным действием: по вопросам записи и посещения клиники звоните по телефону 8 (863) 309-05-06.</p>',
        ),
        node('brief-divider', 'divider', {
          style: 'solid',
          thickness: 1,
          color: '#fed7aa',
          margin: 20,
        }),
        cta('brief-cta', 'Нужна помощь с записью?', 'Администратор уточнит маршрут и время приёма.', {
          buttons: phoneButtons,
          background: '#ea580c',
        }),
      ], { width: 'wide', paddingTop: 16, paddingBottom: 24 }),
    ],
  }),

  template({
    id: 'news-feature',
    name: 'Запуск услуги',
    pageTitle: 'В клинике открылся новый кабинет',
    description: 'Редакционная обложка в две колонки, карточка с ключевыми фактами и подробности запуска.',
    category: 'news',
    contentType: 'news',
    listingMeta: {
      excerpt: 'Новая медицинская услуга: кому она нужна, как проходит и как записаться.',
    },
    preview: { layout: 'split', tone: 'cyan' },
    blocks: [
      section('feature-head', 'news-feature', '#ecfeff', [
        columns('feature-head-columns', [
          container('feature-head-copy', [
            editorialMeta('feature-meta', 'НОВАЯ УСЛУГА · 18 АВГУСТА 2026'),
            heading('feature-h1', 'В клинике открылся новый кабинет', 'h1'),
            text(
              'feature-lead',
              '<p>Теперь пройти консультацию и процедуру можно всей семьёй в филиале рядом с домом.</p>',
            ),
          ]),
          container('feature-head-cover', [
            pageCover('feature-cover', '4/3'),
          ], { width: 'full' }),
        ], { ratio: 'content-aside', alignItems: 'center' }),
      ], { width: 'wide', paddingTop: 48, paddingBottom: 48 }),
      section('feature-body', 'editorial-panel', '#f8fafc', [
        columns('feature-body-columns', [
          container('feature-main', [
            heading('feature-why', 'Зачем открыли кабинет'),
            text(
              'feature-copy',
              '<p>Объясните медицинскую задачу: какую проблему закрывает услуга, для кого она особенно актуальна и почему пациентам раньше приходилось ехать в другой район.</p><p>Опишите процедуру простыми словами: как проходит, нужна ли подготовка, сколько визитов и какие возрастные ограничения.</p><p>Завершите практической информацией: адрес филиала, график и способ записи.</p>',
            ),
          ], { width: 'full' }),
          container('feature-facts', [
            card(
              'feature-card',
              'Коротко об услуге',
              '<p><strong>Для кого:</strong> взрослые и дети</p><p><strong>Где:</strong> Евродон-Вересаева</p><p><strong>Запись:</strong> ежедневно</p>',
              { elevated: false },
            ),
          ], { width: 'full' }),
        ], { ratio: 'content-aside' }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 36 }),
      ctaSection('feature-cta', 'Записаться на новую услугу', 'Уточним подготовку и подберём удобное время.', {
        buttons: phoneButtons,
        background: '#0284c7',
      }),
      related('feature-related', 'news'),
    ],
  }),

  template({
    id: 'news-case',
    name: 'История пациента',
    pageTitle: 'Как врач увидел то, что другие пропустили',
    description: 'Тёмная журнальная обложка, клиническая история и наглядный маршрут лечения.',
    category: 'news',
    contentType: 'news',
    listingMeta: {
      excerpt: 'Реальная клиническая история: жалобы, точная диагностика и результат лечения.',
    },
    preview: { layout: 'case', tone: 'navy' },
    blocks: [
      section('case-head', 'news-case', '#0f172a', [
        columns('case-head-columns', [
          container('case-cover-wrap', [
            pageCover('case-cover', '4/3'),
          ], { width: 'full' }),
          container('case-head-copy', [
            editorialMeta('case-meta', 'ИСТОРИЯ ПАЦИЕНТА · ТРАВМАТОЛОГИЯ'),
            heading('case-h1', 'Как врач увидел то, что другие пропустили', 'h1'),
            text(
              'case-lead',
              '<p>Пациентка пришла с усиливающимся отёком после перелома. Повторное обследование полностью изменило план лечения.</p>',
            ),
          ], { width: 'full' }),
        ], { ratio: 'cover-copy', alignItems: 'center' }),
      ], { foreground: '#ffffff', width: 'wide', paddingTop: 52, paddingBottom: 52 }),
      section('case-story', 'default', '#ffffff', [
        heading('case-start', 'С чего всё началось'),
        text(
          'case-copy',
          '<p>Опишите жалобы, предыдущую помощь и причину повторного обращения. Обязательно назовите врача, должность и филиал — это центральный герой материала.</p><p>Расскажите, что показало обследование и чем было опасно продолжать прежнее лечение. Медицинский термин сразу объясните простыми словами.</p>',
        ),
        quote(
          'case-quote',
          'Новые симптомы после травмы нельзя игнорировать: усиление боли, отёк или онемение — повод для повторного осмотра.',
          'Имя Фамилия, травматолог-ортопед',
          'large',
        ),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 20 }),
      section('case-steps', 'editorial-panel', '#f1f5f9', [
        heading('case-steps-h', 'Маршрут лечения'),
        node('case-features', 'featureList', {
          title: '',
          iconStyle: 'number',
          columns: 3,
          items: [
            { title: 'Повторная диагностика', text: 'Осмотр и исследование показали истинную причину.', icon: '1' },
            { title: 'Новый план', text: 'Врач изменил фиксацию и подобрал терапию.', icon: '2' },
            { title: 'Восстановление', text: 'ЛФК и контроль постепенно вернули функцию.', icon: '3' },
          ],
        }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 36 }),
      ctaSection('case-cta', 'Нужна консультация после травмы?', 'Профильный врач оценит состояние и назначит диагностику.', {
        buttons: phoneButtons,
        background: '#1d4ed8',
      }),
      related('case-related', 'news'),
    ],
  }),

  template({
    id: 'news-celebration',
    name: 'Награда и событие',
    pageTitle: 'Пациенты выбрали ЕвроДон',
    description: 'Праздничная центрированная обложка, крупные показатели и цитата команды.',
    category: 'news',
    contentType: 'news',
    listingMeta: {
      excerpt: 'Клинику отметили в независимом рейтинге по отзывам пациентов.',
      featured: true,
    },
    preview: { layout: 'celebration', tone: 'violet' },
    blocks: [
      section(
        'award-head',
        'news-celebration',
        'linear-gradient(135deg, #3730a3, #6366f1 55%, #0ea5e9)',
        [
          editorialMeta('award-meta', 'НАГРАДА · ВЫБОР ПАЦИЕНТОВ'),
          heading('award-h1', 'Пациенты выбрали ЕвроДон', 'h1', 'center'),
          text(
            'award-lead',
            '<p>Клиника стала победителем независимого рейтинга в номинации «Медицинские центры».</p>',
            'center',
          ),
          node('award-stats', 'stats', {
            items: [
              { value: '22 000+', label: 'номинантов рейтинга' },
              { value: '7', label: 'стран-участниц' },
              { value: '2026', label: 'год награды' },
            ],
          }),
        ],
        { foreground: '#ffffff', width: 'wide', paddingTop: 64, paddingBottom: 64 },
      ),
      section('award-body', 'default', '#ffffff', [
        text(
          'award-copy',
          '<p>Первый абзац — точный факт: название премии, номинация и кто формирует рейтинг. Не называйте себя «лучшими», если этого нет в формулировке организатора.</p><p>Дальше дайте масштаб: сколько участников, городов или стран. Объясните, что пациенты чаще всего отмечали в отзывах — врачей, сервис, филиалы, лабораторию и удобство записи.</p>',
        ),
        quote(
          'award-quote',
          'Спасибо пациентам за доверие, а команде — за ежедневную работу, из которой складывается это признание.',
          'Команда клиники ЕвроДон',
        ),
        cta('award-cta', 'Продолжаем работать для вас', 'Записаться к врачу можно онлайн или по телефону.', {
          buttons: phoneButtons,
          background: '#4f46e5',
          layout: 'center',
        }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 24 }),
      related('award-related', 'news'),
    ],
  }),

  template({
    id: 'news-program',
    name: 'Программа или чекап',
    pageTitle: 'В клинике снова доступна программа обследования',
    description: 'Зелёная продуктовая обложка, состав программы, кому подходит и заметная запись.',
    category: 'news',
    contentType: 'news',
    listingMeta: {
      excerpt: 'Готовая программа обследования: кому подходит и что входит.',
    },
    preview: { layout: 'program', tone: 'green' },
    blocks: [
      section('program-head', 'news-program', '#ecfdf5', [
        columns('program-head-columns', [
          container('program-head-copy', [
            editorialMeta('program-meta', 'ПРОГРАММА ЗДОРОВЬЯ · СНОВА ДОСТУПНА'),
            heading('program-h1', 'Комплексное обследование за один маршрут', 'h1'),
            text(
              'program-lead',
              '<p>По просьбе пациентов мы вернули программу, которая объединяет консультации, анализы и диагностику.</p>',
            ),
            node('program-button', 'button', {
              label: 'Посмотреть программу',
              url: SITE_PATHS.directions,
              target: '_self',
              variant: 'primary',
              size: 'large',
              icon: '→',
              fullWidth: false,
            }),
          ]),
          container('program-cover-wrap', [
            pageCover('program-cover', '1/1'),
          ], { width: 'full' }),
        ], { ratio: 'content-aside', alignItems: 'center' }),
      ], { width: 'wide', paddingTop: 52, paddingBottom: 52 }),
      section('program-details', 'editorial-panel', '#f8fafc', [
        columns('program-details-columns', [
          container('program-description', [
            heading('program-for', 'Кому подходит'),
            text(
              'program-copy',
              '<p>Укажите возраст, основные задачи и ситуации, когда программа особенно полезна. Объясните, сколько визитов занимает маршрут и как пациент получает результаты.</p><p>Не дублируйте полный прайс — оставьте ссылку на страницу программы.</p>',
            ),
          ], { width: 'full' }),
          container('program-includes-wrap', [
            heading('program-includes-h', 'Что входит', 'h3'),
            list('program-includes', [
              'Консультация профильного врача',
              'Лабораторные исследования',
              'Инструментальная диагностика',
              'Итоговое заключение',
            ]),
          ], { width: 'full' }),
        ], { ratio: 'content-aside' }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 36 }),
      ctaSection('program-cta', 'Подобрать программу', 'Администратор уточнит цель и предложит подходящий пакет.', {
        buttons: phoneButtons,
        background: '#059669',
      }),
      related('program-related', 'news'),
    ],
  }),

  template({
    id: 'article-magazine',
    name: 'Экспертный лонгрид',
    pageTitle: 'Уплотнение в груди: когда срочно обращаться к маммологу',
    description: 'Журнальная обложка, авторская цитата, основная колонка и закреплённая памятка.',
    category: 'articles',
    contentType: 'article',
    listingMeta: {
      excerpt: 'Почему уплотнение нельзя оценить самостоятельно и какие обследования назначает маммолог.',
      authorName: 'Марина Манвелян',
      authorTitle: 'Онколог-маммолог',
    },
    preview: { layout: 'magazine', tone: 'blue' },
    blocks: [
      section('magazine-head', 'article-magazine', '#eff6ff', [
        columns('magazine-head-columns', [
          container('magazine-cover-wrap', [
            pageCover('magazine-cover', '4/3'),
          ], { width: 'full' }),
          container('magazine-head-copy', [
            editorialMeta('magazine-meta', 'ЗДОРОВЬЕ · МАММОЛОГИЯ · 12 МИНУТ ЧТЕНИЯ'),
            heading('magazine-h1', 'Уплотнение в груди: когда срочно обращаться к маммологу', 'h1'),
            text(
              'magazine-lead',
              '<p>Не каждое образование связано с онкологией. Но определить его характер без обследования невозможно.</p><p><strong>Марина Манвелян</strong><br>Онколог-маммолог ЕвроДон-Вавилова</p>',
            ),
          ], { width: 'full' }),
        ], { ratio: 'cover-copy', alignItems: 'center' }),
      ], { width: 'wide', paddingTop: 48, paddingBottom: 48 }),
      section('magazine-content', 'editorial-panel', '#f8fafc', [
        columns('magazine-content-columns', [
          container('magazine-main', [
            text(
              'magazine-intro',
              '<p>Обнаружить уплотнение может женщина любого возраста. Такая находка вызывает тревогу, однако многие изменения оказываются доброкачественными и успешно поддаются наблюдению или лечению.</p>',
            ),
            quote(
              'magazine-quote',
              'Главное правило — не откладывать визит и не пытаться поставить диагноз самостоятельно.',
              'Марина Манвелян, онколог-маммолог',
            ),
            heading('magazine-causes-h', 'Почему появляются уплотнения'),
            list('magazine-causes', [
              'Гормональные изменения и мастопатия',
              'Кисты молочной железы',
              'Фиброаденомы',
              'Воспалительные процессы и последствия травм',
            ], 'numbers'),
            heading('magazine-diagnostics-h', 'Какие обследования назначает врач'),
            text(
              'magazine-diagnostics',
              '<p>До 40 лет основным методом обычно становится УЗИ. При необходимости врач назначает биопсию и анализы на гормоны. Тактика зависит от возраста, жалоб и результатов осмотра.</p>',
            ),
            heading('magazine-prevention-h', 'Как снизить риск осложнений'),
            text(
              'magazine-prevention',
              '<p>Ежегодно посещайте врача, проводите самообследование и не откладывайте диагностику при новых симптомах.</p>',
            ),
          ], { width: 'full' }),
          container('magazine-aside', [
            heading('magazine-aside-h', 'Обратитесь быстрее, если', 'h3'),
            list('magazine-red-flags', [
              'Уплотнение быстро растёт',
              'Изменилась форма груди или соска',
              'Есть кровянистые выделения',
              'Увеличились лимфоузлы',
            ]),
            node('magazine-aside-button', 'button', {
              label: 'Найти маммолога',
              url: SITE_PATHS.doctors,
              target: '_self',
              variant: 'primary',
              size: 'medium',
              icon: '',
              fullWidth: true,
            }),
          ], { width: 'full' }),
        ], { ratio: 'content-aside', alignItems: 'start' }),
      ], { width: 'wide', paddingTop: 40, paddingBottom: 40 }),
      section('magazine-faq-section', 'default', '#ffffff', [
        heading('magazine-faq-h', 'Ответы на частые вопросы'),
        faq('magazine-faq', [
          ['Всегда ли уплотнение означает рак?', 'Нет. Большинство находок доброкачественные, но отличить их без обследования нельзя.'],
          ['Можно ли сначала понаблюдать?', 'Новый симптом лучше показать врачу, особенно если он растёт или меняется.'],
          ['Нужно ли направление?', 'Для записи к маммологу направление не требуется.'],
        ]),
        cta('magazine-cta', 'Записаться к маммологу', 'Подберём врача, филиал и удобное время.', {
          background: '#2563eb',
        }),
      ], { width: 'wide', paddingTop: 32, paddingBottom: 24 }),
      related('magazine-related', 'article'),
    ],
  }),

  template({
    id: 'article-checklist',
    name: 'Чек-лист обследований',
    pageTitle: 'Подготовка к беременности: какие обследования пройти',
    description: 'Тёплая карточная структура: сроки, четыре шага, списки анализов и FAQ.',
    category: 'articles',
    contentType: 'article',
    listingMeta: {
      excerpt: 'Какие обследования пройти заранее, с чего начать и когда обратиться быстрее.',
      authorName: 'Евгения Аствацатурьян',
      authorTitle: 'Акушер-гинеколог',
    },
    preview: { layout: 'checklist', tone: 'amber' },
    blocks: [
      section('checklist-head', 'article-checklist', '#fffbeb', [
        editorialMeta('checklist-meta', 'ЧЕК-ЛИСТ · ПОДГОТОВКА · 10 МИНУТ ЧТЕНИЯ'),
        heading('checklist-h1', 'Подготовка к беременности: какие обследования пройти', 'h1'),
        text(
          'checklist-lead',
          '<p>Начать подготовку лучше за 3–6 месяцев. За это время можно скорректировать дефициты и снизить риски для мамы и ребёнка.</p>',
        ),
      ], { width: 'wide', paddingTop: 52, paddingBottom: 52 }),
      section('checklist-steps-section', 'default', '#ffffff', [
        node('checklist-steps', 'featureList', {
          title: 'Маршрут подготовки',
          iconStyle: 'number',
          columns: 4,
          items: [
            { title: 'Гинеколог', text: 'Анамнез и персональный список обследований.', icon: '1' },
            { title: 'Анализы', text: 'Кровь, моча, инфекции и дефициты.', icon: '2' },
            { title: 'Диагностика', text: 'УЗИ и обследования по показаниям.', icon: '3' },
            { title: 'План', text: 'Рекомендации для обоих партнёров.', icon: '4' },
          ],
        }),
      ], { width: 'wide', paddingTop: 32, paddingBottom: 24 }),
      section('checklist-content', 'editorial-panel', '#fffbeb', [
        columns('checklist-content-columns', [
          container('checklist-main', [
            heading('checklist-labs-h', 'Базовые анализы'),
            list('checklist-labs', [
              'Общий анализ крови и мочи',
              'Биохимия, ферритин и витамин D',
              'ТТГ и другие гормоны по показаниям',
              'Инфекции и иммунитет к краснухе',
            ]),
            heading('checklist-doctors-h', 'Каких специалистов пройти'),
            text(
              'checklist-doctors',
              '<p>Начните с акушера-гинеколога. Затем — терапевт, стоматолог и узкие специалисты при хронических заболеваниях или жалобах.</p>',
            ),
          ], { width: 'full' }),
          container('checklist-aside', [
            heading('checklist-aside-h', 'Перед визитом', 'h3'),
            list('checklist-aside-list', [
              'Соберите выписки и результаты прошлых исследований',
              'Запишите лекарства и добавки',
              'Подготовьте вопросы врачу',
            ], 'bullets'),
          ], { width: 'full' }),
        ], { ratio: 'content-aside' }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 36 }),
      section('checklist-faq-section', 'default', '#ffffff', [
        faq('checklist-faq', [
          ['Можно ли сдать всё в один день?', 'Часть исследований — да, но некоторые требуют подготовки и разных дней цикла.'],
          ['Нужно ли обследование партнёру?', 'Часто да. Персональный список определит врач после беседы.'],
        ]),
        cta('checklist-cta', 'Составить персональный план', 'Запишитесь к акушеру-гинекологу.', {
          background: '#d97706',
        }),
      ], { width: 'wide', paddingTop: 24, paddingBottom: 24 }),
      related('checklist-related', 'article'),
    ],
  }),

  template({
    id: 'article-kids',
    name: 'Для родителей',
    pageTitle: 'Боль в животе у ребёнка: причины и что делать родителям',
    description: 'Мягкая семейная верстка: обложка, частые причины, домашняя помощь и красные флаги.',
    category: 'articles',
    contentType: 'article',
    listingMeta: {
      excerpt: 'Как помочь ребёнку дома и в каких случаях нужен врач сегодня.',
      authorName: 'Имя Фамилия',
      authorTitle: 'Педиатр',
    },
    preview: { layout: 'kids', tone: 'mint' },
    blocks: [
      section('kids-head', 'article-kids', '#ecfdf5', [
        columns('kids-head-columns', [
          container('kids-head-copy', [
            editorialMeta('kids-meta', 'ДЕТСКОЕ ЗДОРОВЬЕ · ПАМЯТКА РОДИТЕЛЯМ'),
            heading('kids-h1', 'Боль в животе у ребёнка: причины и что делать родителям', 'h1'),
            text(
              'kids-lead',
              '<p>Чаще всего причина неопасна, но возраст ребёнка и сопутствующие симптомы меняют тактику.</p>',
            ),
          ]),
          container('kids-cover-wrap', [
            pageCover('kids-cover', '1/1'),
          ], { width: 'full' }),
        ], { ratio: 'content-aside', alignItems: 'center' }),
      ], { width: 'wide', paddingTop: 52, paddingBottom: 52 }),
      section('kids-causes-section', 'default', '#ffffff', [
        node('kids-causes', 'featureList', {
          title: 'Частые причины',
          iconStyle: 'custom',
          columns: 3,
          items: [
            { title: 'Питание', text: 'Переедание, непривычная пища или запор.', icon: '●' },
            { title: 'Инфекция', text: 'Боль вместе с температурой или рвотой.', icon: '●' },
            { title: 'Стресс', text: 'Переживания могут проявляться телесно.', icon: '●' },
          ],
        }),
      ], { width: 'wide', paddingTop: 32, paddingBottom: 24 }),
      section('kids-actions', 'editorial-panel', '#f0fdf4', [
        columns('kids-actions-columns', [
          container('kids-home', [
            heading('kids-home-h', 'Что можно сделать дома'),
            list('kids-home-list', [
              'Предлагать воду небольшими порциями',
              'Не заставлять есть',
              'Следить за температурой и активностью',
              'Не давать лекарства без назначения',
            ]),
          ], { width: 'full' }),
          container('kids-urgent', [
            heading('kids-urgent-h', 'К врачу сегодня', 'h3'),
            list('kids-urgent-list', [
              'Боль усиливается или мешает спать',
              'Повторная рвота или отказ от питья',
              'Ребёнок вялый, есть кровь или высокая температура',
            ], 'bullets'),
          ], { width: 'full' }),
        ], { ratio: 'equal' }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 36 }),
      section('kids-faq-section', 'default', '#ffffff', [
        quote(
          'kids-quote',
          'Если поведение ребёнка заметно отличается от обычного, лучше показать его врачу, даже когда список симптомов кажется «неполным».',
          'Имя Фамилия, педиатр',
          'compact',
        ),
        faq('kids-faq', [
          ['Можно ли дать обезболивающее?', 'Оно может смазать картину. При сильной боли сначала свяжитесь с врачом.'],
          ['Нужен педиатр или узкий специалист?', 'Начните с педиатра — он определит дальнейший маршрут.'],
        ]),
        cta('kids-cta', 'Записать ребёнка к педиатру', 'Выберите филиал и удобный слот.', {
          background: '#059669',
        }),
      ], { width: 'wide', paddingTop: 28, paddingBottom: 24 }),
      related('kids-related', 'article'),
    ],
  }),

  template({
    id: 'article-triage',
    name: 'Симптом и красные флаги',
    pageTitle: 'Почему болит живот: причины и когда срочно к врачу',
    description: 'Контрастная клиническая верстка: срочность, две сценарные карточки и диагностика.',
    category: 'articles',
    contentType: 'article',
    listingMeta: {
      excerpt: 'Какие причины встречаются чаще и когда боль нельзя терпеть.',
      authorName: 'Имя Фамилия',
      authorTitle: 'Гастроэнтеролог',
    },
    preview: { layout: 'triage', tone: 'rose' },
    blocks: [
      section('triage-head', 'article-triage', '#fef2f2', [
        editorialMeta('triage-meta', 'СИМПТОМЫ · ГАСТРОЭНТЕРОЛОГИЯ · ВАЖНО'),
        heading('triage-h1', 'Почему болит живот: причины и когда срочно к врачу', 'h1'),
        text(
          'triage-lead',
          '<p>Причины бывают безобидными и опасными. Ориентируйтесь не только на силу боли, но и на сопутствующие симптомы.</p>',
        ),
      ], { width: 'wide', paddingTop: 48, paddingBottom: 48 }),
      section('triage-cards-section', 'default', '#ffffff', [
        columns('triage-cards', [
          card(
            'triage-observe',
            'Можно записаться планово',
            '<p>Дискомфорт умеренный, не усиливается, нет температуры и рвоты, общее состояние обычное.</p>',
            { elevated: false },
          ),
          card(
            'triage-urgent',
            'Нужен врач сегодня',
            '<p>Резкая или нарастающая боль, высокая температура, повторная рвота, кровь, выраженная слабость.</p>',
            { elevated: true },
          ),
        ], { gap: 'medium' }),
      ], { width: 'wide', paddingTop: 28, paddingBottom: 20 }),
      section('triage-content', 'editorial-panel', '#fff7ed', [
        columns('triage-content-columns', [
          container('triage-main', [
            heading('triage-causes-h', 'Частые причины'),
            list('triage-causes', [
              'Переедание, непривычная пища и нарушение моторики',
              'Гастрит, желчный пузырь или поджелудочная железа',
              'Кишечная инфекция',
              'Состояния, требующие осмотра хирурга',
            ], 'numbers'),
            heading('triage-diagnostics-h', 'Что назначает врач'),
            text(
              'triage-diagnostics',
              '<p>После осмотра могут понадобиться анализы крови, УЗИ брюшной полости, эндоскопия или консультация хирурга. Не сдавайте большой набор исследований заранее.</p>',
            ),
          ], { width: 'full' }),
          container('triage-aside', [
            heading('triage-aside-h', 'Не делайте до осмотра', 'h3'),
            list('triage-dont', [
              'Не грейте живот',
              'Не принимайте обезболивающее курсом',
              'Не откладывайте визит при ухудшении',
            ], 'bullets'),
          ], { width: 'full' }),
        ], { ratio: 'content-aside' }),
      ], { width: 'wide', paddingTop: 36, paddingBottom: 36 }),
      section('triage-faq-section', 'default', '#ffffff', [
        faq('triage-faq', [
          ['Можно ли выпить обезболивающее?', 'При сильной боли оно может скрыть важные симптомы. Лучше сначала связаться с врачом.'],
          ['К какому врачу записаться?', 'Начните с терапевта или гастроэнтеролога; при острой боли — с неотложной помощи.'],
        ]),
        cta('triage-cta', 'Не откладывайте диагностику', 'Подберём профильного врача и ближайший филиал.', {
          background: '#dc2626',
        }),
      ], { width: 'wide', paddingTop: 24, paddingBottom: 24 }),
      related('triage-related', 'article'),
    ],
  }),

  template({
    id: 'article-minimal',
    name: 'Редакционная колонка',
    pageTitle: 'Современная медицина в Ростове-на-Дону',
    description: 'Широкая газетная колонка с контейнерами: крупная типографика, цитата, список и блок записи.',
    category: 'articles',
    contentType: 'article',
    listingMeta: {
      excerpt: 'Как выбрать клинику, пройти диагностику и не потеряться между специалистами.',
      authorName: 'Редакция ЕвроДон',
      authorTitle: '',
    },
    preview: { layout: 'minimal', tone: 'ink' },
    blocks: [
      section('minimal-head', 'article-minimal', '#ffffff', [
        editorialMeta('minimal-meta', 'РЕДАКЦИОННАЯ КОЛОНКА · 7 МИНУТ ЧТЕНИЯ'),
        heading('minimal-h1', 'Современная медицина в Ростове-на-Дону', 'h1'),
        text(
          'minimal-lead',
          '<p>Медицинская помощь становится удобнее, когда консультации, диагностика и анализы объединены в один понятный маршрут.</p>',
        ),
      ], { width: 'wide', paddingTop: 52, paddingBottom: 44 }),
      section('minimal-body', 'editorial-panel', '#f8fafc', [
        columns('minimal-body-columns', [
          container('minimal-main', [
            text(
              'minimal-intro',
              '<p>Выбор клиники начинается не с рекламного обещания, а с простых вопросов: есть ли врачи нужного профиля, можно ли пройти исследования на месте и как быстро пациент получает результат.</p>',
            ),
            heading('minimal-system-h', 'Медицина как единая система'),
            text(
              'minimal-system',
              '<p>Когда лаборатория, диагностика и специалисты работают вместе, врачу проще видеть полную картину, а пациенту не приходится самостоятельно собирать маршрут по разным учреждениям.</p>',
            ),
            quote(
              'minimal-quote',
              'Хороший медицинский сервис — это не только оборудование, но и понятность каждого следующего шага.',
              'Редакция ЕвроДон',
              'compact',
            ),
            heading('minimal-choice-h', 'На что смотреть при выборе клиники'),
            list('minimal-choice', [
              'Квалификация врачей и доступность расписания',
              'Диагностика и лаборатория на месте',
              'Прозрачный прайс',
              'Филиал рядом с домом',
            ], 'bullets'),
            heading('minimal-start-h', 'С чего начать'),
            text(
              'minimal-start',
              '<p>Если вы не знаете, какой специалист нужен, запишитесь к терапевту. Он оценит жалобы и составит маршрут без лишних исследований.</p>',
            ),
          ], { width: 'full' }),
          container('minimal-aside', [
            cta('minimal-cta', 'Найти врача', 'Выберите направление, филиал и время онлайн.', {
              background: '#172033',
              layout: 'stacked',
            }),
          ], { width: 'full' }),
        ], { ratio: 'content-aside', alignItems: 'start' }),
      ], { width: 'wide', paddingTop: 28, paddingBottom: 36 }),
      related('minimal-related', 'article'),
    ],
  }),
];

export function getSiteTemplates(category = '') {
  if (!category) return SITE_TEMPLATES;
  return SITE_TEMPLATES.filter((item) => item.category === category);
}

export function getSiteTemplate(id) {
  return SITE_TEMPLATES.find((item) => item.id === id) || null;
}
