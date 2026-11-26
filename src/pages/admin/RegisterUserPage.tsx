import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UserRole } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Icon } from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';

const ROLES: Array<{ value: UserRole; title: string; text: string }> = [
  { value: 'staff', title: 'Staff', text: 'Browses items, sends borrowing requests and returns items.' },
  { value: 'admin', title: 'Admin', text: 'Manages items, approves requests, hands items over and manages users.' },
];

/** Admin registers a person by email. Only registered emails can sign in. */
export default function RegisterUserPage() {
  const { call } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setEmailError('Enter a valid email address.');
      document.getElementById('reg-email')?.focus();
      return;
    }
    setEmailError(null);
    setBusy(true);
    try {
      await call('/admin/users', { body: { email: clean, role } });
      navigate('/admin/users', {
        state: { notice: `Registered ${clean} as ${role}. They can now sign in with that Google account.` },
      });
    } catch (err) {
      if (err instanceof ApiError && err.fields?.email) setEmailError(err.fields.email);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <p className="breadcrumb">
        <Link to="/admin/users">← Accounts</Link>
      </p>

      <div className="hero">
        <h1>User Registration</h1>
      </div>


      <form className="panel form register-form" onSubmit={submit} noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className={`field ${emailError ? 'field-error' : ''}`}>
          <label htmlFor="reg-email">
            Google account email <span className="req">(required)</span>
          </label>
          <p className="hint" id="reg-email-hint">
            The exact email they will sign in with.
          </p>
          <input
            id="reg-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoFocus
            placeholder="name@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'reg-email-hint reg-email-err' : 'reg-email-hint'}
          />
          {emailError ? (
            <p className="error-text" id="reg-email-err" role="alert">
              {emailError}
            </p>
          ) : null}
        </div>

        <fieldset className="field">
          <legend>Role</legend>
          <div className="role-options">
            {ROLES.map((r) => (
              <label key={r.value} className={`role-option ${role === r.value ? 'selected' : ''}`}>
                <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} />
                <span className="role-option-icon" aria-hidden="true">
                  <Icon name={r.value === 'admin' ? 'grid' : 'users'} size={20} />
                </span>
                <span className="role-option-text">
                  <strong>{r.title}</strong>
                  <small>{r.text}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="button-row">
          <Button type="submit" busy={busy}>
            Register {role === 'admin' ? 'admin' : 'staff'}
          </Button>
          <Link to="/admin/users" className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
