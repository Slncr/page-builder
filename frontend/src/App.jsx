import { lazy, Suspense } from 'react';
import { Link, Outlet, Route, Routes } from 'react-router-dom';
import { CapabilityRoute, ProtectedRoute, SessionProvider } from './auth/SessionContext.jsx';

const AdminLayout = lazy(() => import('./components/AdminLayout.jsx'));
const EditorPage = lazy(() => import('./pages/EditorPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const PageListPage = lazy(() => import('./pages/PageListPage.jsx'));
const MediaPage = lazy(() => import('./pages/ResourcePages.jsx').then((module) => ({ default: module.MediaPage })));
const TemplatesPage = lazy(() => import('./pages/ResourcePages.jsx').then((module) => ({ default: module.TemplatesPage })));
const FormsPage = lazy(() => import('./pages/ResourcePages.jsx').then((module) => ({ default: module.FormsPage })));
const RedirectsPage = lazy(() => import('./pages/ResourcePages.jsx').then((module) => ({ default: module.RedirectsPage })));
const AuditPage = lazy(() => import('./pages/ResourcePages.jsx').then((module) => ({ default: module.AuditPage })));
const SettingsPage = lazy(() => import('./pages/ResourcePages.jsx').then((module) => ({ default: module.SettingsPage })));
const PublicPage = lazy(() => import('./pages/PublicPage.jsx'));
const AdminPreviewPage = lazy(() => import('./pages/PreviewPages.jsx').then((module) => ({ default: module.AdminPreviewPage })));
const DevicePreviewPage = lazy(() => import('./pages/PreviewPages.jsx').then((module) => ({ default: module.DevicePreviewPage })));

const protectedPage = (children) => <ProtectedRoute>{children}</ProtectedRoute>;
const capablePage = (capability, children) => (
  <CapabilityRoute capability={capability}>{children}</CapabilityRoute>
);

function SessionRoutes() {
  return <SessionProvider><Outlet /></SessionProvider>;
}

export default function App() {
  return (
    <Suspense fallback={<div className="pb-app-loading" role="status">Загрузка…</div>}>
      <Routes>
        <Route path="/" element={<PublicPage />} />
        <Route element={<SessionRoutes />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/builder" element={protectedPage(<AdminLayout />)}>
            <Route index element={<PageListPage />} />
            <Route path="media" element={<MediaPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="forms" element={capablePage('review', <FormsPage />)} />
            <Route path="redirects" element={capablePage('publish', <RedirectsPage />)} />
            <Route path="audit" element={capablePage('administer', <AuditPage />)} />
            <Route path="settings" element={capablePage('administer', <SettingsPage />)} />
          </Route>
          <Route path="/admin/builder/pages/:pageId" element={protectedPage(<EditorPage />)} />
          <Route path="/admin/builder/:pageId/edit" element={protectedPage(<EditorPage />)} />
          <Route path="/admin/builder/pages/:pageId/frame" element={protectedPage(<DevicePreviewPage />)} />
          <Route path="/admin/builder/preview/:pageId" element={protectedPage(<AdminPreviewPage />)} />
        </Route>
        <Route path="/p/:slug" element={<PublicPage />} />
        <Route path="/admin/*" element={<main className="pb-fatal-state"><h1>Страница не найдена</h1><Link className="pb-primary-button" to="/admin/builder">Открыть конструктор</Link></main>} />
        <Route path="*" element={<PublicPage />} />
      </Routes>
    </Suspense>
  );
}
