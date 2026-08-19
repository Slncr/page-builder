const text = (name, label, extra = {}) => ({ name, label, type: 'text', ...extra });
const richText = (name, label) => ({ name, label, type: 'richtext' });
const url = (name, label) => ({ name, label, type: 'url' });
const image = (name, label) => ({ name, label, type: 'image' });
const toggle = (name, label) => ({ name, label, type: 'toggle' });
const OPTION_LABELS = {
  none: 'Нет',
  color: 'Цвет',
  image: 'Изображение',
  gradient: 'Градиент',
  default: 'По умолчанию',
  narrow: 'Узкая',
  wide: 'Широкая',
  full: 'На всю ширину',
  left: 'Слева',
  center: 'По центру',
  right: 'Справа',
  custom: 'Настраиваемый',
  equal: 'Равные',
  'content-aside': 'Контент + боковая колонка',
  'aside-content': 'Боковая колонка + контент',
  'cover-copy': 'Обложка + заголовок',
  'editorial-masthead': 'Редакционная обложка',
  'news-brief': 'Срочная новость',
  'news-feature': 'Анонс услуги',
  'news-case': 'История пациента',
  'news-celebration': 'Награда / событие',
  'news-program': 'Программа / чекап',
  'article-magazine': 'Журнальная статья',
  'article-checklist': 'Чек-лист',
  'article-kids': 'Для родителей',
  'article-triage': 'Красные флаги',
  'article-minimal': 'Минималистичная статья',
  'editorial-panel': 'Контент с боковой колонкой',
  'editorial-related': 'Другие материалы',
  lead: 'Лид',
  eyebrow: 'Надзаголовок',
  small: 'Маленький',
  medium: 'Средний',
  large: 'Большой',
  start: 'По началу',
  end: 'По концу',
  stretch: 'Растянуть',
  cover: 'Заполнить',
  contain: 'Вместить',
  auto: 'Авто',
  _self: 'В текущей вкладке',
  _blank: 'В новой вкладке',
  primary: 'Основной',
  secondary: 'Вторичный',
  text: 'Текстовый',
  number: 'Нумерация',
  check: 'Галочки',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  file: 'Файл',
  compact: 'Компактный',
  bullets: 'Маркеры',
  numbers: 'Нумерация',
  checks: 'Галочки',
  solid: 'Сплошная',
  dashed: 'Штриховая',
  dotted: 'Пунктирная',
  horizontal: 'Горизонтально',
  vertical: 'Вертикально',
  message: 'Показать сообщение',
  redirect: 'Перенаправить',
  textarea: 'Многострочный текст',
  email: 'Электронная почта',
  phone: 'Телефон',
  radio: 'Переключатели',
  checkbox: 'Флажок',
  consent: 'Согласие',
  hidden: 'Скрытое поле',
  split: 'Разделённый',
  stacked: 'Вертикальный',
  google_maps: 'Google Карты',
  yandex_maps: 'Яндекс Карты',
  google: 'Google',
  yandex: 'Яндекс',
  manual: 'Вручную',
  folder: 'Папка',
  tag: 'Тег',
  newest: 'Сначала новые',
  oldest: 'Сначала старые',
  title: 'По заголовку',
};
const select = (name, label, options) => ({
  name,
  label,
  type: 'select',
  options: options.map((option) => {
    const value = option && typeof option === 'object' ? option.value : option;
    return {
      value,
      label: option && typeof option === 'object'
        ? option.label
        : OPTION_LABELS[String(value)] || String(value),
    };
  }),
});
const items = (name, label, fields) => ({ name, label, type: 'items', fields });

export const BLOCK_REGISTRY = {
  section: {
    label: 'Секция',
    category: 'Макет',
    icon: '▭',
    description: 'Область макета на всю ширину.',
    acceptsChildren: true,
    defaults: {
      anchorId: '',
      styleVariant: 'default',
      backgroundType: 'color',
      backgroundColor: '#ffffff',
      backgroundImage: '',
      foreground: '#172033',
      paddingTop: 64,
      paddingBottom: 64,
      containerWidth: 'wide',
      visibility: true,
    },
    schema: [
      text('anchorId', 'Идентификатор якоря'),
      select('styleVariant', 'Визуальный стиль', [
        'default',
        'editorial-masthead',
        'news-brief',
        'news-feature',
        'news-case',
        'news-celebration',
        'news-program',
        'article-magazine',
        'article-checklist',
        'article-kids',
        'article-triage',
        'article-minimal',
        'editorial-panel',
        'editorial-related',
      ]),
      select('backgroundType', 'Тип фона', ['none', 'color', 'image', 'gradient']),
      text('backgroundColor', 'Цвет фона или градиент'),
      image('backgroundImage', 'Фоновое изображение'),
      text('foreground', 'Цвет текста'),
      { name: 'paddingTop', label: 'Отступ сверху', type: 'number', min: 0, max: 240 },
      { name: 'paddingBottom', label: 'Отступ снизу', type: 'number', min: 0, max: 240 },
      select('containerWidth', 'Ширина контента', ['default', 'narrow', 'wide', 'full']),
      toggle('visibility', 'Показывать'),
    ],
  },
  container: {
    label: 'Контейнер',
    category: 'Макет',
    icon: '□',
    description: 'Ограничивает ширину и выравнивает группу блоков.',
    acceptsChildren: true,
    defaults: { width: 'default', align: 'center' },
    schema: [
      select('width', 'Ширина', ['narrow', 'default', 'wide', 'full']),
      select('align', 'Выравнивание', ['left', 'center', 'right']),
    ],
  },
  columns: {
    label: 'Колонки',
    category: 'Макет',
    icon: '▥',
    description: 'Адаптивный многоколоночный макет.',
    acceptsChildren: true,
    defaults: {
      layout: 2,
      ratio: 'equal',
      gap: 'medium',
      alignItems: 'stretch',
      stackOnMobile: true,
    },
    schema: [
      select('layout', 'Количество колонок', [1, 2, 3, 4]),
      select('ratio', 'Пропорции', ['equal', 'content-aside', 'aside-content', 'cover-copy']),
      select('gap', 'Интервал', ['small', 'medium', 'large']),
      select('alignItems', 'Выравнивание по вертикали', ['start', 'center', 'end', 'stretch']),
      toggle('stackOnMobile', 'Складывать на телефоне'),
    ],
  },
  card: {
    label: 'Карточка',
    category: 'Контент',
    icon: '▢',
    description: 'Изображение, текст и необязательное действие.',
    defaults: {
      image: '',
      imageAlt: '',
      title: 'Заголовок карточки',
      text: '<p>Кратко и понятно опишите этот элемент.</p>',
      link: '',
      button: 'Подробнее',
      elevated: false,
    },
    schema: [
      image('image', 'Изображение'),
      text('imageAlt', 'Альтернативный текст изображения'),
      text('title', 'Заголовок'),
      richText('text', 'Текст'),
      url('link', 'Адрес перехода'),
      text('button', 'Текст кнопки'),
      toggle('elevated', 'С тенью'),
    ],
  },
  heading: {
    label: 'Заголовок',
    category: 'Контент',
    icon: 'H',
    defaults: { text: 'Понятный и полезный заголовок', level: 'h2', align: 'left' },
    schema: [
      text('text', 'Текст', { required: true }),
      select('level', 'Уровень', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
      select('align', 'Выравнивание', ['left', 'center', 'right']),
    ],
  },
  richText: {
    label: 'Форматированный текст',
    category: 'Контент',
    icon: '¶',
    defaults: {
      html: '<p>Напишите что-нибудь важное.</p>',
      variant: 'default',
      align: 'left',
    },
    schema: [
      richText('html', 'Контент'),
      select('variant', 'Стиль текста', ['default', 'lead', 'eyebrow']),
      select('align', 'Выравнивание', ['left', 'center', 'right']),
    ],
  },
  text: {
    label: 'Текст',
    category: 'Типографика',
    icon: '¶',
    description: 'Безопасный форматированный текст с заголовками, ссылками, цитатами, списками и простыми таблицами.',
    defaults: {
      html: '<p>Напишите что-нибудь важное.</p>',
      variant: 'default',
      align: 'left',
    },
    schema: [
      richText('html', 'Контент'),
      select('variant', 'Стиль текста', ['default', 'lead', 'eyebrow']),
      select('align', 'Выравнивание', ['left', 'center', 'right']),
    ],
  },
  image: {
    label: 'Изображение',
    category: 'Медиа',
    icon: '▧',
    defaults: {
      assetId: '',
      usePageCover: false,
      alt: '',
      decorative: false,
      caption: '',
      link: '',
      width: '100%',
      align: 'left',
      borderRadius: 12,
      lazyLoad: true,
      focalPoint: '50% 50%',
      fit: 'cover',
      ratio: '16/9',
    },
    schema: [
      image('assetId', 'Изображение'),
      toggle('usePageCover', 'Использовать обложку страницы'),
      text('alt', 'Альтернативный текст'),
      toggle('decorative', 'Декоративное изображение'),
      text('caption', 'Подпись'),
      url('link', 'Ссылка'),
      text('width', 'Ширина'),
      select('align', 'Выравнивание', ['left', 'center', 'right']),
      { name: 'borderRadius', label: 'Скругление углов', type: 'number', min: 0, max: 100 },
      toggle('lazyLoad', 'Отложенная загрузка'),
      text('focalPoint', 'Точка фокуса'),
      select('fit', 'Заполнение', ['cover', 'contain']),
      select('ratio', 'Соотношение сторон', ['auto', '1/1', '4/3', '16/9', '21/9']),
    ],
  },
  button: {
    label: 'Кнопка',
    category: 'Контент',
    icon: '↗',
    defaults: {
      label: 'Подробнее',
      url: '/doctors',
      target: '_self',
      variant: 'primary',
      size: 'medium',
      icon: '',
      fullWidth: false,
    },
    schema: [
      text('label', 'Текст', { required: true }),
      url('url', 'Адрес перехода'),
      select('target', 'Открывать', ['_self', '_blank']),
      select('variant', 'Стиль', ['primary', 'secondary', 'text']),
      select('size', 'Размер', ['small', 'medium', 'large']),
      text('icon', 'Значок'),
      toggle('fullWidth', 'На всю ширину'),
    ],
  },
  hero: {
    label: 'Первый экран',
    category: 'Маркетинг',
    icon: '★',
    defaults: {
      eyebrow: 'ПРЕДСТАВЛЯЕМ',
      title: 'Здесь начинается запоминающаяся страница.',
      body: '<p>Понятно объясните ценность и предложите посетителям следующий шаг.</p>',
      primaryLabel: 'Начать',
      primaryHref: '#',
      secondaryLabel: '',
      secondaryHref: '',
      backgroundImage: '',
      align: 'left',
    },
    schema: [
      text('eyebrow', 'Надзаголовок'),
      text('title', 'Заголовок', { required: true }),
      richText('body', 'Описание'),
      text('primaryLabel', 'Основное действие'),
      url('primaryHref', 'Адрес основного действия'),
      text('secondaryLabel', 'Дополнительное действие'),
      url('secondaryHref', 'Адрес дополнительного действия'),
      image('backgroundImage', 'Фоновое изображение'),
      select('align', 'Выравнивание', ['left', 'center']),
    ],
  },
  features: {
    label: 'Преимущества',
    category: 'Маркетинг',
    icon: '✦',
    defaults: {
      title: 'Почему выбирают нас',
      iconStyle: 'number',
      columns: 3,
      items: [
        { title: 'Надёжность', text: 'Создано для ежедневной работы.', icon: '✓' },
        { title: 'Гибкость', text: 'Настройте под свои задачи.', icon: '✓' },
        { title: 'Удобство', text: 'Продумано для реальных людей.', icon: '✓' },
      ],
    },
    schema: [
      text('title', 'Заголовок'),
      select('iconStyle', 'Стиль значков', ['number', 'check', 'custom']),
      select('columns', 'Количество колонок', [1, 2, 3, 4]),
      items('items', 'Преимущества', [
        text('title', 'Заголовок'),
        text('text', 'Описание'),
        text('icon', 'Значок'),
      ]),
    ],
  },
  featureList: {
    label: 'Список преимуществ',
    category: 'Контент',
    icon: '✦',
    defaults: {
      iconStyle: 'number',
      columns: 3,
      items: [
        { title: 'Надёжность', text: 'Создано для ежедневной работы.', icon: '✓' },
        { title: 'Гибкость', text: 'Настройте под свои задачи.', icon: '✓' },
        { title: 'Удобство', text: 'Продумано для реальных людей.', icon: '✓' },
      ],
    },
    schema: [
      select('iconStyle', 'Стиль значков', ['number', 'check', 'custom']),
      select('columns', 'Количество колонок', [1, 2, 3, 4]),
      items('items', 'Преимущества', [
        text('title', 'Заголовок'),
        text('text', 'Описание'),
        text('icon', 'Значок'),
      ]),
    ],
  },
  gallery: {
    label: 'Галерея',
    category: 'Медиа',
    icon: '▦',
    interactive: true,
    defaults: {
      columns: 3,
      lightbox: true,
      gap: 'medium',
      assets: [],
    },
    schema: [
      select('columns', 'Количество колонок', [2, 3, 4]),
      select('gap', 'Интервал', ['small', 'medium', 'large']),
      toggle('lightbox', 'Открывать крупное изображение'),
      items('assets', 'Изображения', [
        image('assetId', 'Изображение'),
        text('alt', 'Альтернативный текст'),
      ]),
    ],
  },
  video: {
    label: 'Видео',
    category: 'Медиа',
    icon: '▶',
    interactive: true,
    defaults: {
      provider: 'youtube',
      videoUrl: '',
      title: 'Встроенное видео',
      posterAssetId: '',
      autoplay: false,
      muted: false,
      loop: false,
      controls: true,
      aspectRatio: '16/9',
    },
    schema: [
      select('provider', 'Источник', ['youtube', 'vimeo', 'file', 'custom']),
      url('videoUrl', 'URL видео'),
      text('title', 'Доступный заголовок'),
      image('posterAssetId', 'Обложка'),
      toggle('autoplay', 'Автовоспроизведение'),
      toggle('muted', 'Без звука'),
      toggle('loop', 'Повторять'),
      toggle('controls', 'Показывать элементы управления'),
      select('aspectRatio', 'Соотношение сторон', ['16/9', '4/3', '1/1']),
    ],
  },
  file: {
    label: 'Файл для скачивания',
    category: 'Медиа',
    icon: '⇩',
    defaults: {
      assetId: '',
      label: 'Скачать файл',
      showSize: true,
      showType: true,
      size: '',
      fileType: 'PDF',
    },
    schema: [
      image('assetId', 'Файл из медиатеки'),
      text('label', 'Текст ссылки'),
      toggle('showSize', 'Показывать размер файла'),
      toggle('showType', 'Показывать тип файла'),
      text('size', 'Размер файла'),
      text('fileType', 'Тип файла'),
    ],
  },
  quote: {
    label: 'Цитата',
    category: 'Контент',
    icon: '“',
    defaults: {
      text: 'Полезная мысль, выраженная ясно.',
      author: 'Автор',
      sourceUrl: '',
      layout: 'default',
    },
    schema: [
      text('text', 'Цитата', { required: true }),
      text('author', 'Автор'),
      url('sourceUrl', 'URL источника'),
      select('layout', 'Макет', ['default', 'large', 'compact']),
    ],
  },
  list: {
    label: 'Список',
    category: 'Контент',
    icon: '≡',
    defaults: { style: 'bullets', items: [{ text: 'Первый пункт' }, { text: 'Второй пункт' }] },
    schema: [
      select('style', 'Стиль', ['bullets', 'numbers', 'checks']),
      items('items', 'Пункты', [text('text', 'Текст')]),
    ],
  },
  divider: {
    label: 'Разделитель',
    category: 'Макет',
    icon: '—',
    defaults: { style: 'solid', thickness: 1, color: '#dce2ea', margin: 24 },
    schema: [
      select('style', 'Стиль', ['solid', 'dashed', 'dotted']),
      { name: 'thickness', label: 'Толщина', type: 'number', min: 1, max: 12 },
      text('color', 'Цвет'),
      { name: 'margin', label: 'Вертикальный отступ', type: 'number', min: 0, max: 160 },
    ],
  },
  spacer: {
    label: 'Отступ',
    category: 'Макет',
    icon: '↕',
    defaults: { height: 32, heightTablet: 24, heightMobile: 16 },
    schema: [
      { name: 'height', label: 'Высота на компьютере', type: 'number', min: 0, max: 240 },
      { name: 'heightTablet', label: 'Высота на планшете', type: 'number', min: 0, max: 240 },
      { name: 'heightMobile', label: 'Высота на телефоне', type: 'number', min: 0, max: 240 },
    ],
  },
  accordion: {
    label: 'Аккордеон',
    category: 'Интерактивные',
    icon: '⌄',
    interactive: true,
    defaults: {
      singleOpen: true,
      defaultOpenIndex: 0,
      items: [
        { title: 'Что сюда входит?', content: '<p>Добавьте сюда краткий ответ.</p>' },
        { title: 'Как начать?', content: '<p>Опишите здесь следующий шаг.</p>' },
      ],
    },
    schema: [
      toggle('singleOpen', 'Открывать только одну панель'),
      { name: 'defaultOpenIndex', label: 'Изначально открытая панель', type: 'number', min: -1, max: 20 },
      items('items', 'Панели', [text('title', 'Заголовок'), richText('content', 'Контент')]),
    ],
  },
  tabs: {
    label: 'Вкладки',
    category: 'Интерактивные',
    icon: '⊟',
    interactive: true,
    defaults: {
      defaultTab: 0,
      layout: 'horizontal',
      tabs: [
        { label: 'Обзор', content: '<p>Содержание обзора.</p>' },
        { label: 'Подробнее', content: '<p>Подробное содержание.</p>' },
      ],
    },
    schema: [
      { name: 'defaultTab', label: 'Вкладка по умолчанию', type: 'number', min: 0, max: 20 },
      select('layout', 'Макет', ['horizontal', 'vertical']),
      items('tabs', 'Вкладки', [text('label', 'Название'), richText('content', 'Контент')]),
    ],
  },
  form: {
    label: 'Форма',
    category: 'Интерактивные',
    icon: '✎',
    interactive: true,
    defaults: {
      formId: '',
      title: 'Свяжитесь с нами',
      description: 'Мы ответим вам в ближайшее время.',
      submitLabel: 'Отправить сообщение',
      successMessage: 'Спасибо! Ваш ответ получен.',
      successAction: 'message',
      redirectUrl: '',
      action: '',
      antispam: true,
      fields: [
        { name: 'name', label: 'Имя', type: 'text', required: true },
        { name: 'email', label: 'Электронная почта', type: 'email', required: true },
        { name: 'message', label: 'Сообщение', type: 'textarea', required: true },
      ],
    },
    schema: [
      text('formId', 'Зарегистрированная форма'),
      text('title', 'Заголовок'),
      text('description', 'Описание'),
      text('submitLabel', 'Текст кнопки отправки'),
      text('successMessage', 'Сообщение об успехе'),
      select('successAction', 'После отправки', ['message', 'redirect']),
      url('redirectUrl', 'URL перенаправления'),
      url('action', 'Адрес отправки'),
      toggle('antispam', 'Включить защиту от спама'),
      items('fields', 'Поля', [
        text('name', 'Имя'),
        text('label', 'Название'),
        select('type', 'Тип', [
          'text',
          'textarea',
          'email',
          'phone',
          { value: 'number', label: 'Число' },
          { value: 'select', label: 'Выпадающий список' },
          'radio',
          'checkbox',
          'consent',
          'hidden',
        ]),
        toggle('required', 'Обязательное'),
        text('value', 'Значение по умолчанию'),
        text('options', 'Варианты (через запятую)'),
        { name: 'minLength', label: 'Мин. длина', type: 'number', min: 0, max: 500 },
        { name: 'maxLength', label: 'Макс. длина', type: 'number', min: 1, max: 5000 },
        text('pattern', 'Шаблон (regex)'),
      ]),
    ],
  },
  table: {
    label: 'Таблица',
    category: 'Данные',
    icon: '▤',
    defaults: {
      caption: 'Таблица данных',
      headerRow: ['Элемент', 'Описание', 'Статус'],
      rows: [
        ['Пример', 'Замените эти демонстрационные данные', 'Готово'],
        ['Ещё один элемент', 'На маленьких экранах таблицу можно прокручивать', 'Готово'],
      ],
    },
    schema: [
      text('caption', 'Подпись'),
      { name: 'headerRow', label: 'Заголовки столбцов', type: 'stringList' },
      { name: 'rows', label: 'Строки', type: 'table' },
    ],
  },
  stats: {
    label: 'Показатели',
    category: 'Маркетинг',
    icon: '#',
    defaults: {
      items: [
        { value: '99%', label: 'Довольных клиентов' },
        { value: '24/7', label: 'Поддержка' },
        { value: '10 тыс.+', label: 'Созданных страниц' },
      ],
    },
    schema: [
      items('items', 'Показатели', [text('value', 'Значение'), text('label', 'Название')]),
    ],
  },
  testimonials: {
    label: 'Отзывы',
    category: 'Маркетинг',
    icon: '❝',
    defaults: {
      title: 'Что говорят клиенты',
      items: [
        { quote: 'Благодаря этому процесс публикации стал намного проще.', name: 'Алексей Морозов', role: 'Редактор' },
      ],
    },
    schema: [
      text('title', 'Заголовок'),
      items('items', 'Отзывы', [
        text('quote', 'Текст отзыва'),
        text('name', 'Имя'),
        text('role', 'Роль'),
      ]),
    ],
  },
  pricing: {
    label: 'Тарифы',
    category: 'Маркетинг',
    icon: '$',
    defaults: {
      title: 'Простые тарифы',
      plans: [
        { name: 'Стартовый', price: '1 900 ₽', description: 'Для небольших команд', features: '3 страницы,Поддержка по почте', cta: 'Выбрать стартовый', href: '#' },
        { name: 'Профессиональный', price: '4 900 ₽', description: 'Для растущих команд', features: 'Безлимитные страницы,Приоритетная поддержка', cta: 'Выбрать профессиональный', href: '#' },
      ],
    },
    schema: [
      text('title', 'Заголовок'),
      items('plans', 'Тарифы', [
        text('name', 'Название'),
        text('price', 'Цена'),
        text('description', 'Описание'),
        text('features', 'Возможности через запятую'),
        text('cta', 'Текст действия'),
        url('href', 'Адрес действия'),
      ]),
    ],
  },
  cta: {
    label: 'Призыв к действию',
    category: 'Маркетинг',
    icon: '→',
    defaults: {
      title: 'Готовы сделать следующий шаг?',
      text: 'Дайте посетителям понятную причину продолжить.',
      buttons: [{ label: 'Начать', url: '/doctors', variant: 'primary' }],
      background: '#5b45f5',
      layout: 'split',
    },
    schema: [
      text('title', 'Заголовок'),
      text('text', 'Описание'),
      items('buttons', 'Кнопки', [
        text('label', 'Текст'),
        url('url', 'Адрес перехода'),
        select('variant', 'Стиль', ['primary', 'secondary', 'text']),
      ]),
      text('background', 'Цвет фона'),
      select('layout', 'Макет', ['split', 'center', 'stacked']),
    ],
  },
  embed: {
    label: 'Встраивание',
    category: 'Расширенные',
    icon: '</>',
    defaults: { provider: 'youtube', url: '', title: 'Встроенный контент', height: 420 },
    schema: [
      select('provider', 'Источник', ['youtube', 'vimeo', 'google_maps', 'yandex_maps']),
      url('url', 'URL встраивания'),
      text('title', 'Доступный заголовок'),
      { name: 'height', label: 'Высота', type: 'number', min: 160, max: 1000 },
    ],
  },
  html: {
    label: 'Безопасный HTML',
    category: 'Расширенные',
    icon: '<>',
    defaults: { html: '<p>Пользовательский HTML очищается перед отображением.</p>' },
    schema: [{ name: 'html', label: 'HTML', type: 'code' }],
  },
  map: {
    label: 'Карта',
    category: 'Расширенные',
    icon: '⌖',
    defaults: {
      provider: 'google',
      address: '',
      coordinates: '',
      zoom: 14,
      height: 420,
    },
    schema: [
      select('provider', 'Сервис', ['google', 'yandex']),
      text('address', 'Адрес'),
      text('coordinates', 'Координаты'),
      { name: 'zoom', label: 'Масштаб', type: 'number', min: 1, max: 20 },
      { name: 'height', label: 'Высота', type: 'number', min: 160, max: 1000 },
    ],
  },
  faq: {
    label: 'Частые вопросы',
    category: 'Контент',
    icon: '?',
    interactive: true,
    defaults: {
      schemaMarkup: true,
      items: [
        { question: 'Что сюда входит?', answer: '<p>Добавьте сюда краткий ответ.</p>' },
        { question: 'Как начать?', answer: '<p>Опишите здесь следующий шаг.</p>' },
      ],
    },
    schema: [
      toggle('schemaMarkup', 'Добавить структурированные данные FAQ'),
      items('items', 'Вопросы', [text('question', 'Вопрос'), richText('answer', 'Ответ')]),
    ],
  },
  breadcrumbs: {
    label: 'Хлебные крошки',
    category: 'Сайт',
    icon: '›',
    defaults: {
      source: 'manual',
      items: [
        { label: 'Главная', href: '/' },
        { label: 'Текущая страница', href: '' },
      ],
    },
    schema: [
      select('source', 'Источник', ['auto', 'manual']),
      items('items', 'Элементы', [text('label', 'Название'), url('href', 'URL')]),
    ],
  },
  pageList: {
    label: 'Список страниц',
    category: 'Динамические',
    icon: '▤',
    defaults: {
      sourceType: 'manual',
      source: '',
      limit: 6,
      sort: 'newest',
      cardTemplate: 'default',
      items: [
        { title: 'Пример страницы', description: 'Краткое описание страницы со ссылкой.', href: '#' },
      ],
    },
    schema: [
      select('sourceType', 'Источник', ['folder', 'tag', 'manual']),
      text('source', 'Значение фильтра'),
      { name: 'limit', label: 'Количество', type: 'number', min: 1, max: 50 },
      select('sort', 'Сортировка', ['newest', 'oldest', 'title']),
      select('cardTemplate', 'Шаблон карточки', ['default', 'compact', 'image']),
      items('items', 'Страницы, заданные вручную', [
        text('title', 'Заголовок'),
        text('description', 'Описание'),
        url('href', 'URL'),
        image('coverAssetId', 'Обложка'),
      ]),
    ],
  },
  navbar: {
    label: 'Навигация',
    category: 'Сайт',
    icon: '☰',
    defaults: {
      brand: 'Ваш бренд',
      homeHref: '/',
      links: [
        { label: 'О нас', href: '#about' },
        { label: 'Контакты', href: '#contact' },
      ],
      ctaLabel: '',
      ctaHref: '',
    },
    schema: [
      text('brand', 'Бренд'),
      url('homeHref', 'URL главной страницы'),
      items('links', 'Ссылки', [text('label', 'Название'), url('href', 'URL')]),
      text('ctaLabel', 'Текст действия'),
      url('ctaHref', 'URL действия'),
    ],
  },
  footer: {
    label: 'Подвал',
    category: 'Сайт',
    icon: '▔',
    defaults: {
      brand: 'Ваш бренд',
      text: 'Создано с заботой.',
      copyright: `© ${new Date().getFullYear()} Ваша компания`,
      links: [{ label: 'Конфиденциальность', href: '/privacy' }],
    },
    schema: [
      text('brand', 'Бренд'),
      text('text', 'Описание'),
      text('copyright', 'Авторские права'),
      items('links', 'Ссылки', [text('label', 'Название'), url('href', 'URL')]),
    ],
  },
};

export const BLOCK_TYPES = Object.keys(BLOCK_REGISTRY);
export const INTERACTIVE_BLOCK_TYPES = new Set(
  BLOCK_TYPES.filter((type) => BLOCK_REGISTRY[type].interactive),
);

export function getBlockDefinition(type) {
  return BLOCK_REGISTRY[type] || null;
}

function idFor(type) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${type}-${suffix}`;
}

export function createBlock(type, overrides = {}) {
  const definition = getBlockDefinition(type);
  if (!definition) throw new Error(`Неизвестный тип блока: ${type}`);
  return {
    id: overrides.id || idFor(type),
    type,
    version: String(overrides.version || definition.version || '1.0'),
    parentId: overrides.parentId ?? null,
    props: {
      ...structuredClone(definition.defaults),
      ...(overrides.props || {}),
    },
  };
}

export function canNest(childType, parentType, depth = 0) {
  if (!parentType) return true;
  if (depth >= 5) return false;
  const parent = getBlockDefinition(parentType);
  if (!parent?.acceptsChildren) return false;
  if (childType === 'navbar' || childType === 'footer') return false;
  if (parentType === 'columns' && childType === 'columns') return false;
  return true;
}

export function validateBlock(block) {
  const definition = getBlockDefinition(block?.type);
  if (!definition) return [`Неизвестный тип блока: ${block?.type || 'не указан'}`];
  return definition.schema.flatMap((field) => {
    const value = block.props?.[field.name];
    if (field.required && (value == null || String(value).trim() === '')) {
      return [`Поле «${field.label}» обязательно`];
    }
    if (field.type === 'url' && value && !/^(\/|#|https?:\/\/|mailto:|tel:)/i.test(value)) {
      return [`Поле «${field.label}» должно содержать корректный URL или путь`];
    }
    return [];
  });
}

export function registryByCategory() {
  return BLOCK_TYPES.reduce((groups, type) => {
    const definition = BLOCK_REGISTRY[type];
    groups[definition.category] ||= [];
    groups[definition.category].push({ type, ...definition });
    return groups;
  }, {});
}
