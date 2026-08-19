import { describe, expect, it } from 'vitest';
import { createIntegrationAdapters } from '@construktor/renderer';
import { rendererAdapters } from './integrations.js';

describe('editor renderer links', () => {
  it('keeps integrated-site paths outside the admin base path', () => {
    expect(rendererAdapters.linkResolver('/doctors')).toBe('/doctors');
    expect(rendererAdapters.linkResolver('/about/articles')).toBe('/about/articles');
    expect(rendererAdapters.linkResolver('/page-builder/doctors')).toBe('/doctors');
    expect(rendererAdapters.linkResolver('tel:+78633090506')).toBe('tel:+78633090506');
  });

  it('does not re-prefix clinic routes when the admin mount is passed as basePath', () => {
    const adapters = createIntegrationAdapters({ basePath: '/page-builder' });
    expect(adapters.linkResolver('/doctors')).toBe('/doctors');
    expect(adapters.linkResolver('/page-builder/doctors')).toBe('/doctors');
    expect(adapters.linkResolver('/about/news')).toBe('/about/news');
    expect(adapters.linkResolver('/services/directions')).toBe('/services/directions');
  });
});
