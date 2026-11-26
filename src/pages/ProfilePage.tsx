import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DEPARTMENTS, type UserProfile } from '../../shared/types';
import { useAuth, useMe } from '../auth/AuthProvider';
import { Alert, Button, Field, Icon } from '../components/ui';
import { ApiError, errorMessage } from '../lib/api';
import { InstallApp } from '../pwa/PwaUi';

function validate(p: UserProfile): Record<string, string> {
  const e: Record<string, string> = {};
  if (p.fullName.trim().length < 2) e.fullName = 'Enter your full name.';
  if (!/^\+?[0-9\s\-()]{7,25}$/.test(p.phone.trim()) || p.phone.replace(/\D/g, '').length < 7)
    e.phone = 'Enter a valid phone number (digits, spaces, +, - only).';
  if (!p.department) e.department = 'Choose your department.';
  return e;
}

/** The signed-in person's own details. Staff must complete it before using the system. */
export default function ProfilePage() {
  const me = useMe();
  const { call, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/profile') ? next : null;
  const firstTime = !me.profileComplete && !me.localTest;

  const [form, setForm] = useState<UserProfile>(() => ({
    fullName: me.profile.fullName || me.name || '',
    phone: me.profile.phone,
    department: me.profile.department,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (k: keyof UserProfile) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors(({ [k]: _removed, ...rest }) => rest);
    setSaved(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = validate(form);
    setErrors(v);
    setSaveError(null);
    if (Object.keys(v).length) {
      document.getElementById(`p-${Object.keys(v)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await call('/my/profile', { method: 'PUT', body: form });
      await refresh();
      if (safeNext) navigate(safeNext, { replace: true });
      else if (firstTime && me.role === 'staff') navigate('/', { replace: true });
      else setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="hero profile-hero">
        <div className="profile-hero-row">
          <span className="profile-avatar" aria-hidden="true">
            {(form.fullName || me.email || '?').trim()[0]?.toUpperCase()}
          </span>
          <div>
            <p className="hero-eyebrow">{firstTime ? 'One more step' : 'My profile'}</p>
            <h1>{firstTime ? 'Complete your profile' : form.fullName || 'My profile'}</h1>
            <p className="hero-sub">
              {firstTime
                ? 'Tell us who you are. Admins use these details when you borrow and return items.'
                : 'These details are attached to your borrowing requests.'}
            </p>
          </div>
        </div>
      </div>

      {me.localTest ? (
        <Alert tone="warning">You are using a local test account. Test accounts are not stored, so this profile can’t be saved.</Alert>
      ) : null}
      {saved ? <Alert tone="success">Profile saved.</Alert> : null}
      {saveError ? <Alert tone="error">{saveError}</Alert> : null}

      <form className="panel form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="p-email">
            Email <span className="opt">(registered by your admin)</span>
          </label>
          <div className="readonly-input">
            <Icon name="check" size={16} />
            <input id="p-email" value={me.email ?? ''} readOnly aria-readonly="true" />
          </div>
          <p className="hint">This is the account your administrator registered. It can’t be changed here.</p>
        </div>

        <Field label="Full name" required error={errors.fullName} id="p-fullName">
          {(p) => <input {...p} value={form.fullName} onChange={set('fullName')} autoComplete="name" maxLength={120} />}
        </Field>

        <Field label="Phone number" required error={errors.phone} id="p-phone" hint="For example +60 12-345 6789">
          {(p) => <input {...p} type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" maxLength={25} />}
        </Field>

        <Field label="Department" required error={errors.department} id="p-department">
          {(p) => (
            <select {...p} value={form.department} onChange={set('department')}>
              <option value="">Choose your department…</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Button type="submit" block busy={busy} disabled={me.localTest}>
          {firstTime ? 'Save and continue' : 'Save changes'}
        </Button>
      </form>

      <section className="panel install-panel">
        <h2>Install the app</h2>
        <p className="muted small">Open Rental Management from your home screen like a normal app.</p>
        <InstallApp />
      </section>
    </div>
  );
}
