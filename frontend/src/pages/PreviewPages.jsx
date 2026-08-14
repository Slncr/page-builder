import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConstruktorRenderer } from '@construktor/renderer';
import { api } from '../api/client.js';
import { rendererAdapters } from '../renderer/integrations.js';

export function AdminPreviewPage() {
  const { pageId } = useParams();
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.pages.get(pageId)
      .then((result) => active && setPage(result))
      .catch((nextError) => active && setError(nextError.message));
    return () => { active = false; };
  }, [pageId]);
  if (error) return <main className="pb-fatal-state"><h1>Предпросмотр недоступен</h1><p>{error}</p></main>;
  if (!page) return <div className="pb-app-loading">Загрузка предпросмотра…</div>;
  return (
    <div className="pb-admin-preview">
      <header><div><strong>Предпросмотр</strong><span>Этот URL доступен только авторизованным редакторам.</span></div><Link className="pb-primary-button pb-primary-button--small" to={`/admin/builder/pages/${pageId}`}>Вернуться в редактор</Link></header>
      <ConstruktorRenderer document={page} {...rendererAdapters} />
    </div>
  );
}

export function DevicePreviewPage() {
  const [page, setPage] = useState(null);
  useEffect(() => {
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'pb:render') return;
      setPage(event.data.page);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pb:ready' }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);
  return page
    ? <ConstruktorRenderer document={page} {...rendererAdapters} />
    : <main className="pb-public-state">Подготовка предпросмотра…</main>;
}
