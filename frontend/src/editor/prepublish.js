import { getBlockDefinition, validateBlock } from '../registry/index.js';
import { editorOnlyBlockTypes, isUuid } from '../api/adapters.js';
import { isDemoMode } from '../api/client.js';

const textFromHtml = (value = '') => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export function getPrepublishWarnings(page) {
  const warnings = [];
  const seo = page.seo || {};
  const blocks = Object.values(page.content?.byId || page.byId || {});

  if (!page.title?.trim()) warnings.push({ level: 'error', message: 'Не указан заголовок страницы.' });
  if (!page.slug?.trim()) warnings.push({ level: 'error', message: 'Не указан URL-идентификатор страницы.' });
  if (page.slug && !/^[a-z0-9._-]+$/.test(page.slug)) warnings.push({ level: 'error', message: 'URL-идентификатор страницы содержит недопустимые символы.' });
  if (!seo.title?.trim()) warnings.push({ level: 'warning', message: 'Не указан SEO-заголовок.' });
  if ((seo.title || '').length > 60) warnings.push({ level: 'warning', message: 'SEO-заголовок длиннее 60 символов.' });
  if (!seo.description?.trim()) warnings.push({ level: 'error', message: 'Перед публикацией необходимо добавить метаописание.' });
  if ((seo.description || '').length > 160) warnings.push({ level: 'warning', message: 'Метаописание длиннее 160 символов.' });
  if (!seo.socialImage?.trim()) warnings.push({ level: 'warning', message: 'Не выбрано изображение для социальных сетей.' });
  if (!blocks.length) warnings.push({ level: 'error', message: 'На странице нет блоков с контентом.' });

  const headingOnes = blocks.filter(
    (block) => block.type === 'heading' && Number(String(block.props?.level).replace(/\D/g, '')) === 1,
  );
  const shellOwnsPageTitle = page.layout?.showPageTitle === true;
  if (blocks.length && !shellOwnsPageTitle && !headingOnes.length) {
    warnings.push({ level: 'error', message: 'На странице должен быть ровно один заголовок первого уровня.' });
  }
  if (shellOwnsPageTitle && headingOnes.length) {
    warnings.push({ level: 'error', message: 'Удалите H1 из блоков: его выводит оболочка сайта.' });
  } else if (headingOnes.length > 1) {
    warnings.push({ level: 'error', message: 'Оставьте на странице только один заголовок первого уровня.' });
  }

  const editorOnly = editorOnlyBlockTypes(page);
  if (editorOnly.length) warnings.push({
    level: isDemoMode ? 'warning' : 'error',
    message: `Удалите неподдерживаемые блоки: ${editorOnly.join(', ')}.`,
  });

  for (const block of blocks) {
    const definition = getBlockDefinition(block.type);
    if (!definition) {
      warnings.push({ level: 'error', message: `Неизвестный тип блока «${block.type}».`, blockId: block.id });
      continue;
    }
    for (const message of validateBlock(block)) {
      warnings.push({ level: 'error', message: `${definition.label}: ${message}.`, blockId: block.id });
    }
    if (
      block.type === 'image'
      && !isUuid(block.props?.assetId)
      && !(block.props?.usePageCover && isUuid(page.listingMeta?.coverAssetId))
    ) {
      warnings.push({
        level: 'error',
        message: block.props?.usePageCover
          ? 'Для блока обложки выберите обложку в настройках страницы.'
          : 'Для изображения нужно выбрать файл из медиатеки.',
        blockId: block.id,
      });
    }
    if (block.type === 'image' && !block.props?.decorative && !block.props?.alt?.trim()) {
      warnings.push({ level: 'warning', message: 'У изображения нет альтернативного текста.', blockId: block.id });
    }
    if (block.type === 'file' && !isUuid(block.props?.assetId)) {
      warnings.push({ level: 'error', message: 'Для файла нужно выбрать материал из медиатеки.', blockId: block.id });
    }
    if (block.type === 'card' && block.props?.image && !isUuid(block.props.image)) {
      warnings.push({
        level: 'error',
        message: 'Для изображения карточки нужно выбрать файл из медиатеки.',
        blockId: block.id,
      });
    }
    if (block.type === 'hero' && block.props?.backgroundImage && !isUuid(block.props.backgroundImage)) {
      warnings.push({
        level: 'error',
        message: 'Для фона первого экрана нужно выбрать файл из медиатеки.',
        blockId: block.id,
      });
    }
    if (block.type === 'section' && block.props?.backgroundImage && !isUuid(block.props.backgroundImage)) {
      warnings.push({
        level: 'error',
        message: 'Для фонового изображения секции нужно выбрать файл из медиатеки.',
        blockId: block.id,
      });
    }
    if (block.type === 'video') {
      if (block.props?.autoplay && !block.props?.muted) {
        warnings.push({
          level: 'error',
          message: 'Автовоспроизведение видео возможно только без звука.',
          blockId: block.id,
        });
      }
      if (block.props?.posterAssetId && !isUuid(block.props.posterAssetId)) {
        warnings.push({
          level: 'error',
          message: 'Для обложки видео нужно выбрать файл из медиатеки.',
          blockId: block.id,
        });
      }
    }
    if (block.type === 'gallery') {
      const galleryAssets = block.props?.assets || block.props?.images || [];
      if (!galleryAssets.length) {
        warnings.push({
          level: 'error',
          message: 'Галерея должна содержать хотя бы одно изображение.',
          blockId: block.id,
        });
      }
      const missing = galleryAssets
        .filter((item) => !isUuid(typeof item === 'string' ? item : item.assetId)).length;
      if (missing) warnings.push({
        level: 'error',
        message: `Изображения галереи без файлов из медиатеки: ${missing}.`,
        blockId: block.id,
      });
      const missingAlt = (block.props?.assets || block.props?.images || [])
        .filter((item) => typeof item !== 'string' && !item.alt?.trim()).length;
      if (missingAlt) warnings.push({
        level: 'warning',
        message: `Изображения галереи без альтернативного текста: ${missingAlt}.`,
        blockId: block.id,
      });
    }
    if (['richText', 'text'].includes(block.type) && !textFromHtml(block.props?.html)) {
      warnings.push({ level: 'warning', message: 'Блок форматированного текста пуст.', blockId: block.id });
    }
    if (block.type === 'pageList' && block.props?.sourceType !== 'manual' && !String(block.props?.source || '').trim()) {
      warnings.push({
        level: 'warning',
        message: 'Укажите папку или тег для динамического списка страниц.',
        blockId: block.id,
      });
    }
    if (block.type === 'form') {
      if (block.props?.successAction === 'redirect' && !String(block.props?.redirectUrl || '').trim()) {
        warnings.push({
          level: 'error',
          message: 'Укажите URL перенаправления после отправки формы.',
          blockId: block.id,
        });
      }
      const names = (block.props?.fields || []).map((field) => field.name).filter(Boolean);
      if (!names.length) warnings.push({
        level: 'error',
        message: 'В форме должно быть хотя бы одно поле.',
        blockId: block.id,
      });
      if (new Set(names).size !== names.length) warnings.push({
        level: 'error',
        message: 'Имена полей формы не должны повторяться.',
        blockId: block.id,
      });
      for (const field of block.props?.fields || []) {
        if (['select', 'radio'].includes(field.type) && !String(field.options || '').trim()) {
          warnings.push({
            level: 'warning',
            message: `Поле «${field.label || field.name}»: добавьте варианты ответа.`,
            blockId: block.id,
          });
        }
      }
    }
  }

  return warnings;
}
