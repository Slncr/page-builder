const STATUS_LABELS = {
  active: 'Активна',
  inactive: 'Неактивна',
  draft: 'Черновик',
  in_review: 'На проверке',
  approved: 'Одобрено',
  scheduled: 'Запланировано',
  published: 'Опубликовано',
  archived: 'В архиве',
  trashed: 'В корзине',
  pending: 'Ожидает проверки',
  rejected: 'Отклонено',
};

export function formatStatus(status) {
  return STATUS_LABELS[status] || status || 'Неизвестно';
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
}
