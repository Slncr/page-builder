import { describe, expect, it } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('transliterates Russian names without losing characters', () => {
    expect(slugify('Ёжик в чаще')).toBe('yozhik-v-chashche');
    expect(slugify('О нашей компании')).toBe('o-nashey-kompanii');
  });

  it('uses a safe Russian-page fallback', () => {
    expect(slugify('---')).toBe('stranitsa-bez-nazvaniya');
  });
});
