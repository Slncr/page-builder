import { describe, expect, it } from 'vitest';
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  canNest,
  createBlock,
  getBlockDefinition,
  validateBlock,
} from './index.js';

describe('block registry', () => {
  const mandatoryTypes = [
    'section', 'container', 'columns', 'spacer', 'divider',
    'heading', 'text', 'quote',
    'image', 'gallery', 'video', 'file',
    'button', 'cta',
    'card', 'featureList', 'accordion', 'tabs', 'table', 'list',
    'form',
    'embed', 'html', 'map', 'faq', 'breadcrumbs', 'pageList',
  ];

  it('provides defaults and inspector schemas for every registered block', () => {
    expect(BLOCK_TYPES.length).toBeGreaterThanOrEqual(20);
    for (const [type, definition] of Object.entries(BLOCK_REGISTRY)) {
      expect(definition.label, `${type} label`).toBeTruthy();
      expect(definition.category, `${type} category`).toBeTruthy();
      expect(definition.defaults, `${type} defaults`).toBeTypeOf('object');
      expect(definition.schema, `${type} schema`).toBeInstanceOf(Array);
      const block = createBlock(type);
      expect(block.type).toBe(type);
      expect(block.version).toBe('1.0');
      expect(block.id).toMatch(new RegExp(`^${type}-`));
      expect(block.props).not.toBe(definition.defaults);
    }
    expect(BLOCK_TYPES).toEqual(expect.arrayContaining(mandatoryTypes));
    expect(BLOCK_TYPES).not.toContain('misEntity');
  });

  it('returns independent default objects', () => {
    const first = createBlock('features');
    const second = createBlock('features');
    first.props.items[0].title = 'Mutated';
    expect(second.props.items[0].title).not.toBe('Mutated');
  });

  it('validates required fields and URL fields', () => {
    const heading = createBlock('heading', { props: { text: '' } });
    const button = createBlock('button', { props: { url: 'javascript:alert(1)' } });
    expect(validateBlock(heading)).toContain('Поле «Текст» обязательно');
    expect(validateBlock(button).join(' ')).toContain('корректный URL');
  });

  it('enforces registry nesting constraints', () => {
    expect(canNest('heading', 'section', 0)).toBe(true);
    expect(canNest('heading', 'heading', 0)).toBe(false);
    expect(canNest('columns', 'columns', 0)).toBe(false);
    expect(canNest('heading', 'section', 4)).toBe(true);
    expect(canNest('heading', 'section', 5)).toBe(false);
    expect(getBlockDefinition('missing')).toBeNull();
  });
});
