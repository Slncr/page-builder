import { createBlock } from '../registry/index.js';
import { slugify } from '../utils/slugify.js';

export const CONTENT_TYPES = [
  {
    value: 'generic',
    label: 'Обычная страница',
    description: 'Универсальный контент с настраиваемым адресом.',
    defaultSectionKey: '',
    defaultShell: 'plain',
  },
  {
    value: 'news',
    label: 'Новость',
    description: 'Новость для ленты и раздела «О нас».',
    defaultSectionKey: 'news',
    defaultShell: 'about',
  },
  {
    value: 'article',
    label: 'Статья',
    description: 'Авторский или редакционный материал.',
    defaultSectionKey: 'articles',
    defaultShell: 'about',
  },
  {
    value: 'service',
    label: 'Услуга',
    description: 'Страница услуги с преимуществами и призывом к действию.',
    defaultSectionKey: 'services',
    defaultShell: 'services',
  },
  {
    value: 'home',
    label: 'Главная',
    description: 'Полноценная главная страница с hero и ключевыми разделами.',
    defaultSectionKey: '',
    defaultShell: 'home',
  },
  {
    value: 'branch',
    label: 'Филиал',
    description: 'Страница филиала с контактами и картой.',
    defaultSectionKey: 'branches',
    defaultShell: 'branches',
  },
  {
    value: 'vacancy',
    label: 'Вакансия',
    description: 'Описание вакансии или раздел карьеры.',
    defaultSectionKey: 'about',
    defaultShell: 'about',
  },
];

export const CONTENT_TYPE_VALUES = CONTENT_TYPES.map(({ value }) => value);

export const SECTION_OPTIONS = [
  { value: '', label: 'Без раздела' },
  { value: 'about', label: 'О компании' },
  { value: 'news', label: 'Новости' },
  { value: 'articles', label: 'Статьи' },
  { value: 'services', label: 'Услуги' },
];

export const PAGE_SHELL_OPTIONS = [
  { value: 'auto', label: 'Автоматически по адресу страницы' },
  { value: 'plain', label: 'Простая страница' },
  { value: 'home', label: 'Главная страница' },
  { value: 'about', label: 'О компании' },
  { value: 'services', label: 'Услуги' },
  { value: 'labs', label: 'Лаборатории' },
  { value: 'doctors', label: 'Врачи' },
  { value: 'branches', label: 'Филиалы' },
];

export const BREADCRUMB_MODE_OPTIONS = [
  { value: 'auto', label: 'Показывать автоматически' },
  { value: 'hidden', label: 'Скрыть' },
];

export const PAGE_LAYOUT_DEFAULTS = Object.freeze({
  shell: 'auto',
  showPageTitle: false,
  breadcrumbs: 'auto',
});

export const LISTING_META_DEFAULTS = Object.freeze({
  excerpt: '',
  coverAssetId: '',
  publishedDisplayAt: '',
  authorName: '',
  authorTitle: '',
  sortOrder: 0,
  featured: false,
  hiddenFromLists: false,
  menuLabel: '',
});

export function normalizeContentType(value) {
  return CONTENT_TYPE_VALUES.includes(value) ? value : 'generic';
}

const BACKEND_CONTENT_TYPES = new Set(['generic', 'news', 'article', 'service']);

export function backendContentType(value) {
  const normalized = normalizeContentType(value);
  return BACKEND_CONTENT_TYPES.has(normalized) ? normalized : 'generic';
}

export function normalizePageLayout(value = {}) {
  const layout = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    shell: PAGE_SHELL_OPTIONS.some((option) => option.value === layout.shell)
      ? layout.shell
      : PAGE_LAYOUT_DEFAULTS.shell,
    showPageTitle: typeof layout.showPageTitle === 'boolean'
      ? layout.showPageTitle
      : PAGE_LAYOUT_DEFAULTS.showPageTitle,
    breadcrumbs: BREADCRUMB_MODE_OPTIONS.some(
      (option) => option.value === layout.breadcrumbs,
    )
      ? layout.breadcrumbs
      : PAGE_LAYOUT_DEFAULTS.breadcrumbs,
  };
}

export function normalizeListingMeta(value = {}) {
  return {
    ...LISTING_META_DEFAULTS,
    ...(value || {}),
    excerpt: value?.excerpt || '',
    coverAssetId: value?.coverAssetId || '',
    publishedDisplayAt: value?.publishedDisplayAt || '',
    authorName: value?.authorName || '',
    authorTitle: value?.authorTitle || '',
    sortOrder: Number(value?.sortOrder) || 0,
    featured: Boolean(value?.featured),
    hiddenFromLists: Boolean(value?.hiddenFromLists),
    menuLabel: value?.menuLabel || '',
  };
}

export function defaultSectionKey(contentType) {
  return CONTENT_TYPES.find(({ value }) => value === normalizeContentType(contentType))
    ?.defaultSectionKey || '';
}

export function defaultPageShell(contentType) {
  return CONTENT_TYPES.find(({ value }) => value === normalizeContentType(contentType))
    ?.defaultShell || PAGE_LAYOUT_DEFAULTS.shell;
}

function normalizeCustomPath(value) {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

export function canonicalRoutePath(contentType, slug, customPath = '') {
  const explicitPath = normalizeCustomPath(customPath);
  if (explicitPath) return explicitPath;
  const safeSlug = slugify(slug || '', '');
  const suffix = safeSlug ? `/${safeSlug}` : '';
  switch (normalizeContentType(contentType)) {
    case 'news':
      return `/about/news${suffix}`;
    case 'article':
      return `/about/articles${suffix}`;
    case 'service':
      return `/services${suffix}`;
    case 'home':
      return suffix || '/';
    case 'branch':
      return `/branches${suffix}`;
    case 'vacancy':
      return `/about/vacancies${suffix}`;
    default:
      return suffix || '/';
  }
}

export function defaultRoutePath(contentType, slug) {
  return canonicalRoutePath(contentType, slug);
}

function normalizeTemplate(value) {
  return CONTENT_TYPE_VALUES.includes(value) ? value : 'generic';
}

export function createTemplateContent(template, title = '') {
  const heading = title || {
    news: 'Заголовок новости',
    article: 'Заголовок статьи',
    service: 'Название услуги',
    home: 'Главная страница',
    branch: 'Название филиала',
    vacancy: 'Название вакансии',
  }[template] || 'Заголовок страницы';
  const blocksByTemplate = {
    generic: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Добавьте основной текст страницы.</p>' },
      }),
    ],
    news: [
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: {
          html: [
            '<p>Первый абзац — факт: что произошло, какой филиал, что это значит для пациентов.</p>',
            '<p>Второй — режим работы, что делать сейчас, куда обращаться.</p>',
            '<p>В конце — телефон 8 (863) 309-05-06.</p>',
          ].join(''),
        },
      }),
      createBlock('cta', {
        props: {
          title: 'Запись и вопросы',
          text: 'По телефону или онлайн — администратор подберёт время и филиал.',
          buttons: [
            { label: '8 (863) 309-05-06', url: 'tel:+78633090506', variant: 'primary' },
            { label: 'Записаться на приём', url: '/doctors', variant: 'secondary' },
          ],
          background: '#2563eb',
          layout: 'split',
        },
      }),
    ],
    article: [
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Лид: о чём материал и какую пользу получит читатель. Этот абзац попадает в карточку ленты.</p>' },
      }),
      createBlock('quote', {
        props: {
          text: 'Не откладывайте визит к врачу и не ставьте диагноз самостоятельно.',
          author: 'Имя врача, должность',
          layout: 'large',
        },
      }),
      createBlock('heading', { props: { level: 'h2', text: 'Когда нужно обратиться к врачу' } }),
      createBlock('list', {
        props: {
          style: 'checks',
          items: [
            { text: 'Симптом усиливается или не проходит' },
            { text: 'Появились красные флаги из текста выше' },
            { text: 'Есть хронические заболевания или беременность' },
          ],
        },
      }),
      createBlock('heading', { props: { level: 'h2', text: 'Какие обследования могут назначить' } }),
      createBlock('text', {
        props: { html: '<p>УЗИ, анализы, консультация узкого специалиста — что выбирает врач после осмотра.</p>' },
      }),
      createBlock('faq', {
        props: {
          items: [
            { question: 'Можно ли подождать?', answer: '<p>Если нет красных флагов — уточните срок у врача, не решайте сами.</p>' },
            { question: 'Нужно ли направление?', answer: '<p>Для записи в клинику направление обычно не требуется.</p>' },
          ],
        },
      }),
      createBlock('cta', {
        props: {
          title: 'Записаться на приём',
          text: 'Врач подберёт обследование и план лечения.',
          buttons: [
            { label: 'Записаться на приём', url: '/doctors', variant: 'primary' },
            { label: 'Назад к списку статей', url: '/about/articles', variant: 'secondary' },
          ],
          background: '#2563eb',
          layout: 'split',
        },
      }),
      createBlock('pageList', {
        props: {
          sourceType: 'tag',
          source: 'articles',
          limit: 3,
          sort: 'newest',
          cardTemplate: 'image',
        },
      }),
    ],
    service: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('hero', {
        props: {
          eyebrow: 'УСЛУГА',
          title: heading,
          body: '<p>Объясните, какую задачу решает эта услуга и кому она подходит.</p>',
          primaryLabel: 'Записаться онлайн',
          primaryHref: '/doctors',
          secondaryLabel: 'Узнать цены',
          secondaryHref: '#prices',
        },
      }),
      createBlock('text', {
        props: { html: '<p>Кратко опишите показания, подготовку и длительность процедуры.</p>' },
      }),
      createBlock('featureList', {
        props: {
          title: 'Что входит в услугу',
          columns: 3,
          iconStyle: 'check',
          items: [
            { title: 'Консультация', text: 'Первичный осмотр и план.', icon: '✓' },
            { title: 'Диагностика', text: 'Необходимые исследования.', icon: '✓' },
            { title: 'Контроль', text: 'Наблюдение и рекомендации.', icon: '✓' },
          ],
        },
      }),
      createBlock('faq'),
      createBlock('table', {
        props: {
          caption: 'Ориентировочные цены',
          headerRow: ['Услуга', 'Цена'],
          rows: [['Первичный приём', 'от 2 500 ₽'], ['Повторный приём', 'от 2 000 ₽']],
        },
      }),
      createBlock('cta', {
        props: {
          title: 'Запишитесь на приём',
          text: 'Выберите врача и удобное время онлайн.',
          buttons: [{ label: 'Онлайн-расписание', url: '/doctors', variant: 'primary' }],
          background: '#2563eb',
          layout: 'split',
        },
      }),
    ],
    home: [
      createBlock('hero', {
        props: {
          eyebrow: 'СЕТЬ КЛИНИК',
          title: heading || 'Здоровье семьи — в одном месте',
          body: '<p>Запись онлайн, диагностика, анализы и врачи всех специальностей.</p>',
          primaryLabel: 'Записаться',
          primaryHref: '/doctors',
          secondaryLabel: 'Анализы',
          secondaryHref: '/services/labs',
        },
      }),
      createBlock('stats', {
        props: {
          items: [
            { value: '30+', label: 'лет опыта' },
            { value: '350+', label: 'врачей' },
            { value: '15', label: 'филиалов' },
          ],
        },
      }),
      createBlock('tabs'),
      createBlock('pageList', {
        props: {
          sourceType: 'manual',
          limit: 6,
          cardTemplate: 'image',
          items: [{ title: 'Новость', description: 'Краткое описание', href: '/about/news' }],
        },
      }),
      createBlock('cta', {
        props: {
          title: 'Нужна консультация?',
          buttons: [{ label: 'Позвонить', url: 'tel:+78000000000', variant: 'primary' }],
          background: '#2563eb',
        },
      }),
    ],
    branch: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Адрес, график работы и контактные телефоны филиала.</p>' },
      }),
      createBlock('map', { props: { provider: 'yandex', address: 'Ростов-на-Дону', height: 420 } }),
      createBlock('button', {
        props: { label: 'Построить маршрут', url: '/branches', variant: 'primary', size: 'large' },
      }),
    ],
    vacancy: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Опишите должность, требования и условия работы.</p>' },
      }),
      createBlock('list', {
        props: {
          style: 'checks',
          items: [
            { text: 'Оформление по ТК' },
            { text: 'Обучение и наставничество' },
            { text: 'Стабильный график' },
          ],
        },
      }),
      createBlock('form'),
    ],
  };
  const blocks = blocksByTemplate[normalizeTemplate(template)];
  return {
    byId: Object.fromEntries(blocks.map((block) => [block.id, block])),
    rootOrder: blocks.map((block) => block.id),
    childrenByParent: Object.fromEntries(blocks.map((block) => [block.id, []])),
  };
}
