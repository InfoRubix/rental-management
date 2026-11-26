import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth, useMe } from '../auth/AuthProvider';
import { useConfig } from '../lib/config';
import { Alert, Button, FullPageMessage, Icon, Loading, LogoMark } from './ui';

export const APP_NAME = 'Rental Management';

export function DevBanner() {
  const config = useConfig();
  if (config.mode === 'firebase' && config.devStaffLogin) {
    return (
      <div className="dev-banner" role="note">
        <strong>Local test mode:</strong> passwordless test sign-in is ON (DEV_STAFF_LOGIN). Connected to the real Firebase
        database — changes are saved.
      </div>
    );
  }
  if (config.mode !== 'memory') return null;
  return (
    <div className="dev-banner" role="note">
      <strong>Development mode:</strong> data is kept in memory on this computer and is lost when the dev server stops. Not
      connected to Firebase.
    </div>
  );
}

/** Every page except /login requires a Google sign-in and an active account. */
export function RequireAuth() {
  const { state, signOut } = useAuth();
  const location = useLocation();

  if (state.kind === 'loading') {
    return (
      <FullPageMessage title="Checking sign-in…">
        <Loading />
      </FullPageMessage>
    );
  }
  if (state.kind === 'error') {
    return (
      <FullPageMessage title="Cannot reach the server">
        <Alert tone="error">{state.message}</Alert>
      </FullPageMessage>
    );
  }
  if (state.kind === 'signed-out') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  const { me } = state;
  if (me.status !== 'active') {
    return (
      <>
        <DevBanner />
        <FullPageMessage title={me.status === 'blocked' ? 'Account blocked' : 'Waiting for approval'}>
          <p>
            Signed in as <strong>{me.email}</strong>.
          </p>
          <Alert tone={me.status === 'blocked' ? 'error' : 'info'}>
            {me.status === 'blocked'
              ? 'This account has been blocked by an administrator. Contact your administrator if you think this is a mistake.'
              : 'Your account was created. An administrator needs to approve it before you can use the system. Please check back later.'}
          </Alert>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </FullPageMessage>
      </>
    );
  }
  // Staff must fill in their profile (name, phone, department) before using the system.
  if (me.role === 'staff' && !me.profileComplete && location.pathname !== '/profile') {
    return <Navigate to={`/profile?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <Outlet />;
}

/** Admin-only section. The server also checks the admin role on every admin request. */
export function RequireAdmin() {
  const me = useMe();
  // Staff who open an admin link are simply taken to Browse items.
  if (me.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

export function AppLayout() {
  const me = useMe();
  const { signOut: doSignOut } = useAuth();
  const navigate = useNavigate();
  // Go to a clean login page, so the next person isn't sent back to this user's last page.
  const signOut = async () => {
    await doSignOut();
    navigate('/login', { replace: true });
  };
  return (
    <>
      <DevBanner />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-row">
          <Link to="/" className="brand">
            <LogoMark />
            <span>{APP_NAME}</span> {me.role === 'admin' ? <span className="brand-tag">Admin</span> : null}
          </Link>
          <div className="header-user">
            <Link to="/profile" className="header-profile" title="My profile">
              <span className="avatar" aria-hidden="true">
                {((me.profile.fullName || me.email || '?')[0] ?? '?').toUpperCase()}
              </span>
              <span className="header-email small">{me.profile.fullName || me.email}</span>
            </Link>
            <Button variant="ghost" className="signout-btn" onClick={() => void signOut()}>
              <Icon name="logout" size={18} />
              Sign out
            </Button>
          </div>
        </div>
        {/* Admins use the Admin sub-menu only; item pages opened from a QR code still work for them. */}
        {me.role !== 'admin' ? (
          <nav aria-label="Main" className="container nav staff-nav">
            <NavLink to="/" end>
              <Icon name="grid" size={18} />
              Browse items
            </NavLink>
            <NavLink to="/scan">
              <Icon name="scan" size={18} />
              Scan
            </NavLink>
            <NavLink to="/my">
              <Icon name="list" size={18} />
              My requests
            </NavLink>
          </nav>
        ) : null}
      </header>
      <main id="main" className="container">
        <Outlet />
      </main>
    </>
  );
}

/** Second row of navigation inside the admin section. */
export function AdminLayout() {
  return (
    <>
      <nav aria-label="Admin" className="nav sub-nav">
        <NavLink to="/admin" end>
          <Icon name="grid" size={18} />
          Dashboard
        </NavLink>
        <NavLink to="/admin/requests">
          <Icon name="inbox" size={18} />
          Requests
        </NavLink>
        <NavLink to="/admin/items">
          <Icon name="box" size={18} />
          Items
        </NavLink>
        <NavLink to="/admin/users">
          <Icon name="users" size={18} />
          Users
        </NavLink>
        <NavLink to="/admin/activity">
          <Icon name="activity" size={18} />
          Activity
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
