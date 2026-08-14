import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { isDemoMode } from '../api/client.js';
import { useSession } from '../auth/SessionContext.jsx';

export default function LoginPage() {
  const { user, login } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(isDemoMode ? 'admin@example.com' : '');
  const [password, setPassword] = useState(isDemoMode ? 'demo' : '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/admin/builder" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login({ email, password });
      navigate(location.state?.from?.pathname || '/admin/builder', { replace: true });
    } catch (nextError) {
      setError(nextError.message || 'Не удалось войти.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="pb-login">
      <section className="pb-login__intro">
        <Link to="/" className="pb-login__brand" aria-label="Главная Construktor">
          <span aria-hidden="true">C</span> Construktor
        </Link>
        <div>
          <p className="pb-kicker">КОНСТРУКТОР СТРАНИЦ</p>
          <h1>Превращайте хорошие идеи в полезные страницы.</h1>
          <p>Создавайте, проверяйте, просматривайте и публикуйте в едином рабочем пространстве.</p>
        </div>
      </section>
      <section className="pb-login__form-wrap">
        <form className="pb-login__form" onSubmit={submit}>
          <header>
            <p className="pb-kicker">С ВОЗВРАЩЕНИЕМ</p>
            <h2>Войдите, чтобы продолжить</h2>
            <p>Используйте учётную запись администратора.</p>
          </header>
          <label>
            <span>Электронная почта</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="pb-alert pb-alert--error" role="alert">{error}</p>}
          <button className="pb-primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Вход…' : 'Войти'}
          </button>
          {isDemoMode && <small>Демо-режим включён: подойдут любые непустые данные.</small>}
        </form>
      </section>
    </main>
  );
}
