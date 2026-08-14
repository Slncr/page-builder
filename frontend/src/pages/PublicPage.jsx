import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ConstruktorRenderer } from '@construktor/renderer';
import { api } from '../api/client.js';
import { rendererAdapters, resolveRendererAsset } from '../renderer/integrations.js';
import { withBasePath, withoutBasePath } from '../routing/basePath.js';

function useSeo(page) {
  useEffect(() => {
    if (!page) return undefined;
    const previousTitle = document.title;
    document.title = page.seo?.title || page.title;
    const created = [];
    const setMeta = (selector, attributes, content) => {
      let element = document.head.querySelector(selector);
      if (!element) {
        element = document.createElement('meta');
        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
        document.head.append(element);
        created.push(element);
      }
      const previous = element.content;
      element.content = content || '';
      return () => { element.content = previous; };
    };
    const restores = [
      setMeta('meta[name="description"]', { name: 'description' }, page.seo?.description),
      setMeta('meta[name="robots"]', { name: 'robots' }, page.seo?.noIndex ? 'noindex,follow' : 'index,follow'),
      setMeta('meta[property="og:title"]', { property: 'og:title' }, page.seo?.ogTitle || page.seo?.title || page.title),
      setMeta('meta[property="og:description"]', { property: 'og:description' }, page.seo?.ogDescription || page.seo?.description),
      setMeta('meta[property="og:image"]', { property: 'og:image' }, resolveRendererAsset(page.seo?.socialImage)),
      setMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, page.seo?.twitterCard || 'summary_large_image'),
      setMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, page.seo?.ogTitle || page.seo?.title || page.title),
      setMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, page.seo?.ogDescription || page.seo?.description),
    ];
    let canonical = document.head.querySelector('link[rel="canonical"]');
    const previousCanonical = canonical?.href;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
      created.push(canonical);
    }
    canonical.href = page.seo?.canonical
      ? withBasePath(page.seo.canonical)
      : window.location.href;
    return () => {
      document.title = previousTitle;
      restores.forEach((restore) => restore());
      if (previousCanonical) canonical.href = previousCanonical;
      created.forEach((element) => element.remove());
    };
  }, [page]);
}

export default function PublicPage() {
  const { slug } = useParams();
  const location = useLocation();
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  useSeo(page);

  useEffect(() => {
    let active = true;
    const path = slug ? `/${slug}` : withoutBasePath(location.pathname);
    const resolve = api.pages.resolvePublic
      ? api.pages.resolvePublic(path).then((result) => {
        if (result.mode === 'redirect') {
          window.location.replace(withBasePath(result.location));
          return null;
        }
        if (result.mode !== 'builder') throw new Error('Опубликованная страница не найдена.');
        return api.pages.getPublic(path);
      })
      : api.pages.getPublic(path);
    resolve
      .then((result) => active && setPage(result))
      .catch((nextError) => active && setError(nextError.message));
    return () => { active = false; };
  }, [location.pathname, slug]);

  if (error) return <main className="pb-public-state"><h1>Страница не найдена</h1><p>{error}</p></main>;
  if (!page) return <main className="pb-public-state" role="status">Загрузка страницы…</main>;
  return <ConstruktorRenderer document={page} {...rendererAdapters} />;
}
