const CYRILLIC_TO_LATIN = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function slugify(value, fallback = 'stranitsa-bez-nazvaniya') {
  const transliterated = Array.from(String(value || '').toLowerCase().trim())
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  return transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || fallback;
}
