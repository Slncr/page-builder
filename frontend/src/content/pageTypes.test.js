import { describe, expect, it } from 'vitest';
import {
  BREADCRUMB_MODE_OPTIONS,
  PAGE_SHELL_OPTIONS,
  canonicalRoutePath,
  createTemplateContent,
  defaultSectionKey,
  normalizeListingMeta,
  normalizePageLayout,
} from './pageTypes.js';

describe('content types', () => {
  it('provides canonical defaults while preserving custom paths', () => {
    expect(canonicalRoutePath('news', 'Launch Day')).toBe('/about/news/launch-day');
    expect(canonicalRoutePath('article', 'Design Systems')).toBe(
      '/about/articles/design-systems',
    );
    expect(canonicalRoutePath('service', 'Consulting')).toBe('/services/consulting');
    expect(canonicalRoutePath('service', 'Consulting', '/solutions/advice')).toBe(
      '/solutions/advice',
    );
    expect(defaultSectionKey('article')).toBe('articles');
  });

  it('normalizes the host layout contract with backward-compatible defaults', () => {
    expect(PAGE_SHELL_OPTIONS.map(({ value }) => value)).toEqual([
      'auto',
      'plain',
      'home',
      'about',
      'services',
      'labs',
      'doctors',
      'branches',
    ]);
    expect(BREADCRUMB_MODE_OPTIONS.map(({ value }) => value)).toEqual(['auto', 'hidden']);
    expect(normalizePageLayout({})).toEqual({
      shell: 'auto',
      showPageTitle: false,
      breadcrumbs: 'auto',
    });
    expect(normalizePageLayout({
      shell: 'services',
      showPageTitle: true,
      breadcrumbs: 'hidden',
    })).toEqual({
      shell: 'services',
      showPageTitle: true,
      breadcrumbs: 'hidden',
    });
    expect(normalizePageLayout({
      shell: 'unsupported',
      showPageTitle: 'yes',
      breadcrumbs: 'visible',
    })).toEqual({
      shell: 'auto',
      showPageTitle: false,
      breadcrumbs: 'auto',
    });
  });

  it('normalizes listing defaults and creates all content templates', () => {
    expect(normalizeListingMeta({ excerpt: 'Summary', featured: true })).toMatchObject({
      excerpt: 'Summary',
      sortOrder: 0,
      featured: true,
      hiddenFromLists: false,
    });

    for (const type of ['generic', 'news', 'article', 'service', 'home', 'branch', 'vacancy']) {
      const content = createTemplateContent(type, `Template ${type}`);
      expect(content.rootOrder.length, type).toBeGreaterThan(0);
      const hasTitle = Object.values(content.byId).some((block) => (
        (block.type === 'heading' && block.props.level === 'h1')
        || (block.type === 'hero' && block.props.title)
      ));
      expect(hasTitle, type).toBe(true);
    }
  });
});
