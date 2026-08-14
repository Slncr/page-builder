import { describe, expect, it } from 'vitest';
import { can, navigationFor, roleLevel } from './capabilities.js';

describe('role capabilities', () => {
  it('orders backend roles and gates publishing', () => {
    expect(roleLevel('Viewer')).toBeLessThan(roleLevel('Copywriter'));
    expect(roleLevel('Copywriter')).toBeLessThan(roleLevel('Editor'));
    expect(roleLevel('Editor')).toBeLessThan(roleLevel('Publisher'));
    expect(can({ role: 'Viewer' }, 'edit')).toBe(false);
    expect(can({ role: 'Copywriter' }, 'edit')).toBe(true);
    expect(can({ role: 'Editor' }, 'review')).toBe(true);
    expect(can({ role: 'Publisher' }, 'publish')).toBe(true);
    expect(can({ role: 'Admin' }, 'administer')).toBe(true);
  });

  it('hides privileged navigation from lower roles', () => {
    expect(navigationFor({ role: 'Viewer' }).map(([label]) => label)).toEqual([
      'Страницы',
      'Медиа',
      'Шаблоны',
    ]);
    expect(navigationFor({ role: 'Admin' }).map(([label]) => label)).toContain('Журнал');
  });
});

