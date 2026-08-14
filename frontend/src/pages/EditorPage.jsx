import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { can } from '../auth/capabilities.js';
import { useSession } from '../auth/SessionContext.jsx';
import { defaultRoutePath } from '../content/pageTypes.js';
import BlockLibrary from '../editor/BlockLibrary.jsx';
import EditorCanvas from '../editor/EditorCanvas.jsx';
import { PublishDialog, RevisionHistory } from '../editor/EditorDialogs.jsx';
import EditorTopbar from '../editor/EditorTopbar.jsx';
import Inspector from '../editor/Inspector.jsx';
import { getPrepublishWarnings } from '../editor/prepublish.js';
import { useAutosave } from '../editor/useAutosave.js';
import { useEditorShortcuts } from '../editor/useEditorShortcuts.js';
import { usePageLock } from '../editor/usePageLock.js';
import { useBuilderStore } from '../store/builderStore.js';
import '../styles/admin.css';

const routeFor = (state) => state.routePath
  || defaultRoutePath(state.contentType, state.slug);

export default function EditorPage() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [serverIssues, setServerIssues] = useState([]);
  const [workflowMessage, setWorkflowMessage] = useState('');
  const loadPage = useBuilderStore((state) => state.loadPage);
  const conflict = useBuilderStore((state) => state.conflict);
  const dirty = useBuilderStore((state) => state.dirty);
  const serialize = useBuilderStore((state) => state.serialize);
  const markSaved = useBuilderStore((state) => state.markSaved);
  const { error: saveError, lockLost, saveNow, forceSave, reloadServer } = useAutosave(pageId);
  const { lock, error: lockError, forceAcquire } = usePageLock(pageId, user);
  const readOnly = !can(user, 'edit') || lock.readOnly || lockLost;

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.pages.get(pageId)
      .then((page) => active && loadPage(page))
      .catch((error) => active && setLoadError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [loadPage, pageId]);

  useEffect(() => {
    const warn = (event) => {
      if (!useBuilderStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const saveDraft = useCallback(() => {
    saveNow().catch(() => {});
  }, [saveNow]);
  useEditorShortcuts(saveDraft, !readOnly);

  const refreshPage = useCallback(async () => {
    const page = await api.pages.get(pageId);
    loadPage(page);
    return page;
  }, [loadPage, pageId]);

  const validateServer = useCallback(async () => {
    const report = await api.pages.validate(pageId);
    const issues = (report.issues || []).map((issue) => ({
      level: 'error',
      message: issue.message,
      path: issue.path,
    }));
    setServerIssues(issues);
    return report.valid;
  }, [pageId]);

  const openPublish = async () => {
    setWorkflowMessage('');
    try {
      if (useBuilderStore.getState().dirty) await saveNow();
      await validateServer();
      setPublishOpen(true);
    } catch (error) {
      setWorkflowMessage(error.message);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      if (useBuilderStore.getState().dirty) await saveNow();
      const state = useBuilderStore.getState();
      if (state.conflict) return;
      if (!await validateServer()) return;
      const savedPage = state.serialize();
      const published = await api.pages.publish(pageId, {
        baseVersion: state.baseVersion,
        routePath: routeFor(state),
        page: savedPage,
      });
      markSaved(published, savedPage);
      setWorkflowMessage('Изменения опубликованы на сайте.');
      setPublishOpen(false);
    } catch (error) {
      setWorkflowMessage(error.message);
    } finally {
      setPublishing(false);
    }
  };

  const saveChanges = async () => {
    setWorkflowMessage('');
    const state = useBuilderStore.getState();
    if (state.hasPublishedVersion && can(user, 'publish')) {
      await publish();
      return;
    }
    try {
      await saveNow();
      setWorkflowMessage(
        state.hasPublishedVersion
          ? 'Черновик сохранён. Для обновления сайта его должен опубликовать пользователь с правом публикации.'
          : 'Черновик сохранён.',
      );
    } catch {
      // The autosave banner already exposes the actionable error.
    }
  };

  const workflow = async (action) => {
    setWorkflowMessage('');
    try {
      if (
        useBuilderStore.getState().dirty
        && ['submitReview', 'approve', 'reject', 'schedule'].includes(action)
      ) {
        await saveNow();
      }
      if (action === 'duplicate') {
        const duplicate = await api.pages.duplicate(pageId);
        navigate(`/admin/builder/pages/${duplicate.id}`);
      } else if (action === 'trash' && window.confirm('Переместить эту страницу в корзину?')) {
        await api.pages.trash(pageId);
        navigate('/admin/builder');
      } else if (action === 'submitReview') {
        await api.pages.submitReview(pageId, window.prompt('Комментарий для проверки (необязательно)') || '');
        await refreshPage();
      } else if (action === 'approve') {
        await api.pages.approveReview(pageId, window.prompt('Комментарий к одобрению (необязательно)') || '');
        await refreshPage();
      } else if (action === 'reject') {
        const comment = window.prompt('Почему проверка отклонена?');
        if (comment) {
          await api.pages.rejectReview(pageId, comment);
          await refreshPage();
        }
      } else if (action === 'schedule') {
        const value = window.prompt('Дата и время публикации (например, 2026-08-20T09:00)');
        if (value && await validateServer()) {
          const state = useBuilderStore.getState();
          await api.pages.schedule(pageId, {
            runAt: new Date(value).toISOString(),
            baseVersion: state.baseVersion,
            routePath: routeFor(state),
          });
          await refreshPage();
        }
      } else if (action === 'unpublish' && window.confirm('Снять эту страницу с публикации?')) {
        await api.pages.unpublish(pageId);
        await refreshPage();
      }
    } catch (error) {
      setWorkflowMessage(error.message);
    }
  };

  const sharePreview = async () => {
    try {
      const preview = await api.pages.previewToken(pageId);
      await navigator.clipboard?.writeText(preview.previewUrl);
      window.open(preview.previewUrl, '_blank', 'noopener');
      setWorkflowMessage('Ссылка на предпросмотр скопирована.');
    } catch (error) {
      setWorkflowMessage(error.message);
    }
  };

  const rollback = async (revisionId) => {
    if (!window.confirm('Откатить опубликованную страницу к этой версии?')) return;
    try {
      const state = useBuilderStore.getState();
      await api.pages.rollback(pageId, revisionId, {
        baseVersion: state.baseVersion,
        routePath: routeFor(state),
      });
      await refreshPage();
      setHistoryOpen(false);
    } catch (error) {
      setWorkflowMessage(error.message);
    }
  };

  if (loading) return <div className="pb-app-loading" role="status">Открытие редактора…</div>;
  if (loadError) {
    return (
      <main className="pb-fatal-state">
        <h1>Не удалось открыть страницу</h1><p>{loadError}</p>
        <Link className="pb-primary-button" to="/admin/builder">Вернуться к страницам</Link>
      </main>
    );
  }

  const warnings = getPrepublishWarnings(serialize());
  return (
    <div className="pb-editor" data-pb-admin>
      <EditorTopbar
        onSave={saveChanges}
        onPublish={openPublish}
        onHistory={() => setHistoryOpen(true)}
        onPreview={sharePreview}
        onWorkflow={workflow}
        publishing={publishing}
        readOnly={readOnly}
        user={user}
      />
      {(readOnly || lockError) && (
        <div className="pb-save-banner is-conflict" role="status">
          <div><strong>Режим только для чтения</strong><span>{lock.warning || lockError || (lockLost ? saveError : 'Ваша роль позволяет просматривать страницу, но не редактировать её.')}</span></div>
          {can(user, 'administer') && !lock.isOwner && <button className="pb-primary-button pb-primary-button--small" onClick={() => forceAcquire().catch(() => {})}>Перехватить блокировку</button>}
        </div>
      )}
      {workflowMessage && <div className="pb-save-banner" role="status">{workflowMessage}</div>}
      {(conflict || saveError) && (
        <div className={`pb-save-banner ${conflict ? 'is-conflict' : 'is-error'}`} role="alert">
          <div><strong>{conflict ? 'Страница была изменена в другом месте.' : 'Не удалось сохранить страницу.'}</strong><span>{conflict ? 'Выберите серверную версию или замените её своими изменениями.' : saveError}</span></div>
          {conflict && <div><button className="pb-secondary-button pb-secondary-button--small" onClick={reloadServer}>Использовать серверную версию</button><button className="pb-primary-button pb-primary-button--small" onClick={() => forceSave().catch(() => {})}>Заменить на сервере</button></div>}
        </div>
      )}
      <div className="pb-editor-layout" inert={readOnly ? '' : undefined}>
        <BlockLibrary />
        <EditorCanvas />
        <Inspector />
      </div>
      <RevisionHistory pageId={pageId} open={historyOpen} onClose={() => setHistoryOpen(false)} onRestore={loadPage} onRollback={rollback} canRollback={can(user, 'publish')} />
      <PublishDialog warnings={[...warnings, ...serverIssues]} open={publishOpen} onClose={() => setPublishOpen(false)} onConfirm={publish} publishing={publishing} />
      <div className="pb-visually-hidden" aria-live="polite">{dirty ? 'На странице есть несохранённые изменения.' : 'Страница сохранена.'}</div>
    </div>
  );
}
