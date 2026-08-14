import { describe, expect, it } from 'vitest';
import {
  normalizeBasePath,
  withBasePath,
  withoutBasePath,
} from './basePath.js';

describe('application base path', () => {
  it('normalizes configured prefixes', () => {
    expect(normalizeBasePath('page-builder')).toBe('/page-builder/');
    expect(normalizeBasePath('/page-builder/')).toBe('/page-builder/');
    expect(normalizeBasePath('/')).toBe('/');
  });

  it('prefixes only root-relative application URLs', () => {
    expect(withBasePath('/', '/page-builder/')).toBe('/page-builder/');
    expect(withBasePath('/admin/builder', '/page-builder/')).toBe('/page-builder/admin/builder');
    expect(withBasePath('/page-builder/login', '/page-builder/')).toBe('/page-builder/login');
    expect(withBasePath('#content', '/page-builder/')).toBe('#content');
    expect(withBasePath('https://example.com/path', '/page-builder/')).toBe('https://example.com/path');
  });

  it('removes the browser prefix before public API resolution', () => {
    expect(withoutBasePath('/page-builder/', '/page-builder/')).toBe('/');
    expect(withoutBasePath('/page-builder/about', '/page-builder/')).toBe('/about');
    expect(withoutBasePath('/about', '/page-builder/')).toBe('/about');
  });
});
