import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../auth/SessionContext.jsx';
import { navigationFor } from '../auth/capabilities.js';
import '../styles/admin.css';

export default function AdminLayout() {
  const { user, logout } = useSession();
  const navigation = navigationFor(user);
  return (
    <div className="pb-admin" data-pb-admin>
      <aside className="pb-admin-nav">
        <Link className="pb-admin-brand" to="/admin/builder">
          <span aria-hidden="true">C</span>
          <strong>Construktor</strong>
        </Link>
        <nav aria-label="Конструктор страниц">
          {navigation.map(([label, to, end]) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => isActive ? 'is-active' : undefined}
            >
              <span aria-hidden="true">{label.slice(0, 1)}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="pb-admin-user">
          <span>{(user?.displayName || user?.name || user?.email || 'А').slice(0, 1).toUpperCase()}</span>
          <div><strong>{user?.displayName || user?.name || 'Администратор'}</strong><small>{user?.email}</small></div>
          <button type="button" onClick={logout} aria-label="Выйти" title="Выйти">↪</button>
        </div>
      </aside>
      <div className="pb-admin-content">
        <Outlet />
      </div>
    </div>
  );
}
