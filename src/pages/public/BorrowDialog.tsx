import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { PublicItem } from '../../../shared/types';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { Alert, Button, Icon } from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { formatDate } from '../../lib/format';

/** YYYY-MM-DD plus n days (calendar dates, no time zones involved). */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const QUICK: Array<{ label: string; days: number }> = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
];

/**
 * Pop-up for borrowing an item: choose the dates, press Send, and you are taken to the new request.
 * Name, phone and department come from the profile (the server uses the stored profile too).
 */
export function BorrowDialog({ item, open, onClose }: { item: PublicItem; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const config = useConfig();
  const me = useMe();
  const { call } = useAuth();
  const navigate = useNavigate();
  const today = config.today;

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState('');
  const [quick, setQuick] = useState<number | 'custom' | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [department, setDepartment] = useState(''); // only for local test accounts (no stored profile)
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRequestId = useRef(crypto.randomUUID());

  const needsProfile = !me.localTest && !me.profileComplete;

  // Open / close the native modal (focus trap, Esc and backdrop come with <dialog>).
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      clientRequestId.current = crypto.randomUUID();
      setFrom(today);
      setTo('');
      setQuick(null);
      setNote('');
      setShowNote(false);
      setErrors({});
      setSubmitError(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, today]);

  function pickQuick(days: number) {
    setQuick(days);
    setTo(addDays(from || today, days));
    setErrors(({ to: _r, ...rest }) => rest);
  }

  function changeFrom(v: string) {
    setFrom(v);
    setErrors(({ from: _r, ...rest }) => rest);
    // Keep the chosen length when the start date moves.
    if (typeof quick === 'number' && v) setTo(addDays(v, quick));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v: Record<string, string> = {};
    if (!from) v.from = 'Choose the date you want to borrow it.';
    else if (from < today) v.from = 'The borrowing date cannot be in the past.';
    if (!to) v.to = 'Choose how long you need it.';
    else if (from && to < from) v.to = 'The return date must be on or after the borrowing date.';
    if (me.localTest && department.trim().length < 2) v.department = 'Enter your department.';
    setErrors(v);
    setSubmitError(null);
    if (Object.keys(v).length) return;

    setBusy(true);
    try {
      const res = await call<{ duplicate: boolean; requestId: string }>('/requests', {
        body: {
          itemId: item.id,
          requestedDate: from,
          expectedReturnDate: to,
          customerNotes: note.trim(),
          // The server uses the saved profile; these are only used by local test accounts.
          department: me.localTest ? department.trim() : me.profile.department,
          phone: me.localTest ? '' : me.profile.phone,
          clientRequestId: clientRequestId.current,
        },
      });
      ref.current?.close();
      navigate(`/my/${res.requestId}`, { state: { justSubmitted: !res.duplicate } });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors({
          ...(err.fields.requestedDate ? { from: err.fields.requestedDate } : {}),
          ...(err.fields.expectedReturnDate ? { to: err.fields.expectedReturnDate } : {}),
        });
      }
      setSubmitError(errorMessage(err));
      setBusy(false);
    }
  }

  const days = from && to && to >= from ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : null;

  return (
    <dialog
      ref={ref}
      className="borrow-dialog"
      aria-labelledby="borrow-title"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault(); // don't close with Esc while sending
      }}
      onClick={(e) => {
        // Click on the dimmed backdrop (outside the box) closes it.
        if (e.target === e.currentTarget && !busy) ref.current?.close();
      }}
    >
      <form method="dialog" onSubmit={submit} noValidate>
        <div className="borrow-head">
          <div>
            <p className="borrow-eyebrow">Request to borrow</p>
            <h2 id="borrow-title">{item.name}</h2>
            <span className="code">{item.itemCode}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()} disabled={busy}>
            ✕
          </button>
        </div>

        {needsProfile ? (
          <Alert tone="info" title="Complete your profile first">
            Requests use your full name, phone and department.{' '}
            <Link to={`/profile?next=${encodeURIComponent(`/item/${item.id}`)}`}>Fill in your profile</Link>, then come back.
          </Alert>
        ) : (
          <>
            <div className={`field ${errors.from ? 'field-error' : ''}`}>
              <label htmlFor="bd-from">Preferred borrowing date</label>
              <input
                id="bd-from"
                type="date"
                value={from}
                min={today}
                onChange={(e) => changeFrom(e.target.value)}
                aria-invalid={errors.from ? true : undefined}
                aria-describedby={errors.from ? 'bd-from-err' : undefined}
              />
              {errors.from ? (
                <p className="error-text" id="bd-from-err" role="alert">
                  {errors.from}
                </p>
              ) : null}
            </div>

            <div className={`field ${errors.to ? 'field-error' : ''}`}>
              <span className="filter-label" id="bd-len-label">
                For how long?
              </span>
              <div className="quick-picks" role="group" aria-labelledby="bd-len-label">
                {QUICK.map((qp) => (
                  <button
                    key={qp.days}
                    type="button"
                    className={`pill ${quick === qp.days ? 'active' : ''}`}
                    aria-pressed={quick === qp.days}
                    onClick={() => pickQuick(qp.days)}
                  >
                    {qp.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`pill ${quick === 'custom' ? 'active' : ''}`}
                  aria-pressed={quick === 'custom'}
                  onClick={() => {
                    setQuick('custom');
                    setTimeout(() => document.getElementById('bd-to')?.focus(), 0);
                  }}
                >
                  Custom
                </button>
              </div>
              <label htmlFor="bd-to" className="sr-only">
                Expected return date
              </label>
              <div className="return-row">
                <span className="small muted">Expected return date</span>
                <input
                  id="bd-to"
                  type="date"
                  value={to}
                  min={from || today}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setQuick('custom');
                    setErrors(({ to: _r, ...rest }) => rest);
                  }}
                  aria-invalid={errors.to ? true : undefined}
                  aria-describedby={errors.to ? 'bd-to-err' : undefined}
                />
              </div>
              {to && days !== null && !errors.to ? (
                <p className="return-summary">
                  <Icon name="clock" size={16} /> Return by <strong>{formatDate(to)}</strong>
                  {days > 0 ? ` · ${days} day${days === 1 ? '' : 's'}` : ' · same day'}
                </p>
              ) : null}
              {errors.to ? (
                <p className="error-text" id="bd-to-err" role="alert">
                  {errors.to}
                </p>
              ) : null}
            </div>

            {me.localTest ? (
              <div className={`field ${errors.department ? 'field-error' : ''}`}>
                <label htmlFor="bd-dept">Department (test account)</label>
                <input id="bd-dept" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={100} />
                {errors.department ? <p className="error-text">{errors.department}</p> : null}
              </div>
            ) : null}

            {showNote ? (
              <div className="field">
                <label htmlFor="bd-note">
                  Note for the admin <span className="opt">(optional)</span>
                </label>
                <textarea id="bd-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </div>
            ) : (
              <button type="button" className="link-btn add-note" onClick={() => setShowNote(true)}>
                + Add a note (optional)
              </button>
            )}

            {submitError ? <Alert tone="error">{submitError}</Alert> : null}

            <Button type="submit" block busy={busy}>
              {busy ? 'Sending…' : 'Send request'}
            </Button>
            <p className="hint borrow-foot">
              Sent as <strong>{me.localTest ? me.email : me.profile.fullName}</strong>. An admin reviews it and hands the item over.
            </p>
          </>
        )}
      </form>
    </dialog>
  );
}
