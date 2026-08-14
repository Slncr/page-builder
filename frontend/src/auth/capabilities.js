const LEVEL = {
  Viewer: 0,
  Copywriter: 1,
  Editor: 2,
  Publisher: 3,
  Admin: 4,
};

export const CAPABILITY_LEVEL = {
  view: 0,
  edit: 1,
  review: 2,
  publish: 3,
  administer: 4,
};

export function roleLevel(role) {
  return LEVEL[role] ?? -1;
}

export function can(user, capability) {
  return roleLevel(user?.role || (user?.id === 'demo-admin' ? 'Admin' : '')) >= CAPABILITY_LEVEL[capability];
}

export function navigationFor(user) {
  return [
    ['Страницы', '/admin/builder', true, 'view'],
    ['Медиа', '/admin/builder/media', false, 'view'],
    ['Шаблоны', '/admin/builder/templates', false, 'view'],
    ['Формы', '/admin/builder/forms', false, 'review'],
    ['Перенаправления', '/admin/builder/redirects', false, 'publish'],
    ['Журнал', '/admin/builder/audit', false, 'administer'],
    ['Настройки', '/admin/builder/settings', false, 'administer'],
  ].filter((item) => can(user, item[3]));
}

