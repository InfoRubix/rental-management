import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { UserAccount, UserInvite, UserRole, UserStatus } from '../../../shared/types';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { Alert, Button, Empty, Icon, Loading, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useStaffQuery } from './shared';

const STATUS_LABEL: Record<UserStatus, string> = { active: 'Active', pending: 'Waiting for approval', blocked: 'Blocked' };

export default function UsersPage() {
  const me = useMe();
  const { call } = useAuth();
  const { data, error, loading, reload } = useStaffQuery<{ users: UserAccount[]; invites: UserInvite[] }>('/admin/users');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ uid: string; change: { role?: UserRole; status?: UserStatus }; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const location = useLocation();
  // Message passed back from the Register page.
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function removeInvite(email: string) {
    setRemoving(email);
    setActionError(null);
    setNotice(null);
    try {
      await call(`/admin/invites/${encodeURIComponent(email)}`, { method: 'DELETE' });
      setNotice(`Removed the registration for ${email}.`);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRemoving(null);
    }
  }

  const users = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.users ?? []).filter(
      (u) =>
        (roleFilter === 'all' || u.role === roleFilter) &&
        (!term ||
          `${u.email} ${u.name ?? ''} ${u.profile.fullName} ${u.profile.department} ${u.profile.phone}`.toLowerCase().includes(term)),
    );
  }, [data, q, roleFilter]);

  const roleCounts = useMemo(() => {
    const all = data?.users ?? [];
    return { all: all.length, staff: all.filter((u) => u.role === 'staff').length, admin: all.filter((u) => u.role === 'admin').length };
  }, [data]);

  async function apply() {
    if (!confirm) return;
    setBusyUid(confirm.uid);
    setActionError(null);
    try {
      await call(`/admin/users/${encodeURIComponent(confirm.uid)}`, { method: 'PATCH', body: confirm.change });
      setNotice('Saved.');
      setConfirm(null);
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusyUid(null);
    }
  }

  const ask = (u: UserAccount, change: { role?: UserRole; status?: UserStatus }, text: string) => {
    setNotice(null);
    setActionError(null);
    setConfirm({ uid: u.uid, change, text });
  };

  return (
    <>
      <div className="page-head">
        <h1>Accounts</h1>
        <div className="button-row">
          <Button variant="secondary" onClick={() => void reload()}>
            Refresh
          </Button>
          <Link to="/admin/users/new" className="btn btn-primary">
            <Icon name="users" size={18} />
            Register User
          </Link>
        </div>
      </div>
      <p className="muted">
        Only registered people can sign in. <strong>Staff</strong> browse and request items; <strong>admins</strong> manage
        items, requests and users.
      </p>

      {me.localTest ? (
        <Alert tone="warning">
          You are using the local test sign-in. Test accounts are not stored, so they are not listed here.
        </Alert>
      ) : null}
      <div className="account-filters">
        <div className="field">
          <label htmlFor="uq">Search</label>
          <input id="uq" type="search" placeholder="Name, email, department or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <span className="filter-label" id="role-filter-label">
            Role
          </span>
          <div className="pill-group" role="group" aria-labelledby="role-filter-label">
            {(['all', 'staff', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`pill ${roleFilter === r ? 'active' : ''}`}
                aria-pressed={roleFilter === r}
                onClick={() => setRoleFilter(r)}
              >
                {r === 'all' ? 'All' : r === 'staff' ? 'Staff' : 'Admin'}
                <span className="pill-count">{roleCounts[r]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading /> : null}
      {data && users.length === 0 ? <Empty title={q || roleFilter !== 'all' ? 'No accounts match these filters.' : 'No accounts yet. Use “Register User” to add someone.'} /> : null}

      <ul className="card-list">
        {users.map((u) => {
          const self = u.uid === me.uid;
          return (
            <li key={u.uid} className="card user-card">
              <div className="request-card-top">
                <div>
                  <span className="card-title">
                    {u.profile.fullName || u.name || u.email} {self ? <span className="muted small">(you)</span> : null}
                  </span>
                  <span className="muted small">{u.email}</span>
                  {u.profileComplete ? (
                    <span className="small profile-line">
                      {u.profile.department} · {u.profile.phone}
                    </span>
                  ) : u.role === 'staff' ? (
                    <span className="small muted">Profile not completed yet</span>
                  ) : null}
                </div>
                <span className="badges">
                  <StatusBadge status={u.role === 'admin' ? 'Admin' : 'Staff'} />
                  <StatusBadge status={STATUS_LABEL[u.status]} />
                </span>
              </div>
              <span className="muted small">
                Joined {formatDateTime(u.createdAt)} · Last seen {formatDateTime(u.lastSeenAt)}
              </span>

              {confirm?.uid === u.uid ? (
                <div className="form">
                  <p>{confirm.text}</p>
                  <div className="button-row">
                    <Button busy={busyUid === u.uid} onClick={() => void apply()}>
                      Confirm
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="button-row">
                  {u.status === 'pending' ? (
                    <Button onClick={() => ask(u, { status: 'active' }, `Approve ${u.email}? They can then browse and request items.`)}>
                      Approve
                    </Button>
                  ) : null}
                  {u.role === 'staff' ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        ask(u, { role: 'admin' }, `Make ${u.email} an admin? They will be able to manage items, requests and users.`)
                      }
                    >
                      Make admin
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => ask(u, { role: 'staff' }, `Change ${u.email} to normal staff? They will lose admin access.`)}
                    >
                      Make staff
                    </Button>
                  )}
                  {u.status === 'blocked' ? (
                    <Button variant="secondary" onClick={() => ask(u, { status: 'active' }, `Unblock ${u.email}?`)}>
                      Unblock
                    </Button>
                  ) : !self ? (
                    <Button
                      variant="danger"
                      onClick={() => ask(u, { status: 'blocked' }, `Block ${u.email}? They will not be able to use the system. Their history is kept.`)}
                    >
                      Block
                    </Button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {data?.invites.length ? (
        <section className="section">
          <hr className="section-divider" />
          <h2>Waiting for first sign-in ({data.invites.length})</h2>
          <ul className="card-list">
            {data.invites.map((i) => (
              <li key={i.email} className="card user-card invite-card">
                <div className="request-card-top">
                  <div>
                    <span className="card-title">{i.email}</span>
                    <span className="muted small">
                      Registered {formatDateTime(i.invitedAt)}
                      {i.invitedBy?.name ? ` by ${i.invitedBy.name}` : ''}
                    </span>
                  </div>
                  <span className="badges">
                    <StatusBadge status={i.role === 'admin' ? 'Admin' : 'Staff'} />
                    <StatusBadge status="Not signed in yet" />
                  </span>
                </div>
                <div className="button-row">
                  <Button variant="secondary" busy={removing === i.email} onClick={() => void removeInvite(i.email)}>
                    Remove registration
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </>
  );
}
