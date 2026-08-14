import { Link } from 'react-router-dom';
import { can } from '../auth/capabilities.js';
import { useBuilderStore } from '../store/builderStore.js';
import { formatStatus } from '../utils/display.js';

export default function EditorTopbar({
  onSave,
  onPublish,
  onHistory,
  onPreview,
  onWorkflow,
  publishing,
  readOnly,
  user,
}) {
  const title = useBuilderStore((state) => state.title);
  const status = useBuilderStore((state) => state.status);
  const hasPublishedVersion = useBuilderStore((state) => state.hasPublishedVersion);
  const saveState = useBuilderStore((state) => state.saveState);
  const lastSavedAt = useBuilderStore((state) => state.lastSavedAt);
  const history = useBuilderStore((state) => state.history);
  const device = useBuilderStore((state) => state.device);
  const canvasMode = useBuilderStore((state) => state.canvasMode);
  const updatePage = useBuilderStore((state) => state.updatePage);
  const undo = useBuilderStore((state) => state.undo);
  const redo = useBuilderStore((state) => state.redo);
  const setDevice = useBuilderStore((state) => state.setDevice);
  const setCanvasMode = useBuilderStore((state) => state.setCanvasMode);

  const saveLabel = {
    saving: 'Сохранение…',
    saved: 'Сохранено',
    conflict: 'Конфликт',
    error: 'Ошибка сохранения',
    idle: lastSavedAt ? 'Есть несохранённые изменения' : 'Не сохранено',
  }[saveState] || 'Есть несохранённые изменения';

  return (
    <header className="pb-editor-topbar">
      <div className="pb-editor-topbar__identity">
        <Link className="pb-icon-button" to="/admin/builder" aria-label="Вернуться к страницам">←</Link>
        <div>
          <input aria-label="Заголовок страницы" value={title} disabled={readOnly} onChange={(event) => updatePage({ title: event.target.value })} />
          <small><span className={`pb-save-dot is-${saveState}`} />{saveLabel}{status !== 'draft' && ` · ${formatStatus(status)}`}</small>
        </div>
      </div>
      <div className="pb-editor-topbar__history" role="group" aria-label="История изменений">
        <button type="button" onClick={undo} disabled={readOnly || !history.past.length} aria-label="Отменить" title="Отменить (Ctrl/⌘ Z)">↶</button>
        <button type="button" onClick={redo} disabled={readOnly || !history.future.length} aria-label="Повторить" title="Повторить (Ctrl/⌘ Shift Z)">↷</button>
      </div>
      <div className="pb-device-switcher" role="group" aria-label="Ширина предпросмотра">
        {[
          ['desktop', 'Компьютер', '▱'],
          ['tablet', 'Планшет', '▯'],
          ['mobile', 'Телефон', '▯'],
        ].map(([value, label, icon]) => (
          <button type="button" className={device === value ? 'is-active' : ''} onClick={() => setDevice(value)} key={value} aria-label={label} aria-pressed={device === value}>{icon}</button>
        ))}
      </div>
      <div className="pb-editor-mode" role="group" aria-label="Режим холста">
        <button type="button" className={canvasMode === 'edit' ? 'is-active' : ''} onClick={() => setCanvasMode('edit')}>Редактор</button>
        <button type="button" className={canvasMode === 'preview' ? 'is-active' : ''} onClick={() => setCanvasMode('preview')}>Предпросмотр</button>
      </div>
      <div className="pb-editor-topbar__actions">
        <button type="button" className="pb-icon-button" onClick={onHistory} aria-label="История версий" title="История версий">◷</button>
        <button type="button" className="pb-secondary-button" onClick={onPreview}>Поделиться предпросмотром</button>
        {can(user, 'edit') && (
          <details className="pb-action-menu">
            <summary className="pb-secondary-button">Действия</summary>
            <div>
              <button type="button" onClick={() => onWorkflow('duplicate')}>Создать копию</button>
              <button type="button" onClick={() => onWorkflow('submitReview')}>Отправить на проверку</button>
              {can(user, 'review') && <button type="button" onClick={() => onWorkflow('approve')}>Одобрить</button>}
              {can(user, 'review') && <button type="button" onClick={() => onWorkflow('reject')}>Отклонить</button>}
              {can(user, 'publish') && <button type="button" onClick={() => onWorkflow('schedule')}>Запланировать</button>}
              {can(user, 'publish') && status === 'published' && <button type="button" onClick={() => onWorkflow('unpublish')}>Снять с публикации</button>}
              <button type="button" className="is-danger" onClick={() => onWorkflow('trash')}>Переместить в корзину</button>
            </div>
          </details>
        )}
        {can(user, 'edit') && (
          <button
            type="button"
            className="pb-secondary-button"
            onClick={() => onSave?.()}
            disabled={readOnly || publishing || saveState === 'saving'}
          >
            {hasPublishedVersion && can(user, 'publish')
              ? 'Сохранить и обновить сайт'
              : 'Сохранить черновик'}
          </button>
        )}
        {can(user, 'publish') && (
          <button
            type="button"
            className="pb-primary-button"
            onClick={onPublish}
            disabled={readOnly || publishing || saveState === 'saving'}
          >
            {publishing
              ? 'Публикация…'
              : hasPublishedVersion
                ? 'Опубликовать изменения'
                : 'Опубликовать'}
          </button>
        )}
      </div>
    </header>
  );
}
