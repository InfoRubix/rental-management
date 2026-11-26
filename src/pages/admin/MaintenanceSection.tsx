import { useRef, useState, type FormEvent } from 'react';
import type { MaintenanceEntry, StaffItem } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Field } from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { csvFilename, downloadCSV, toCSV } from '../../lib/csv';
import { actorName, formatDate, formatDateTime } from '../../lib/format';

/** Staff-only maintenance log for one item. Entries are permanent (no edit or delete). */
export function MaintenanceSection({
  item,
  entries,
  onSaved,
}: {
  item: StaffItem;
  entries: MaintenanceEntry[];
  onSaved: () => Promise<void>;
}) {
  const config = useConfig();
  const { call } = useAuth();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(config.today);
  const [description, setDescription] = useState('');
  const [performedBy, setPerformedBy] = useState('');
  const [markAvailable, setMarkAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // New ID per form opening: a double-click on Save can't create two entries.
  const entryId = useRef(crypto.randomUUID());

  const canFinish = item.status === 'Under maintenance' && !item.holdRequestId;

  function start() {
    entryId.current = crypto.randomUUID();
    setDate(config.today);
    setDescription('');
    setPerformedBy('');
    setMarkAvailable(false);
    setErrors({});
    setError(null);
    setNotice(null);
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v: Record<string, string> = {};
    if (description.trim().length < 3) v.description = 'Describe what was done.';
    if (!date) v.date = 'Choose a date.';
    else if (date > config.today) v.date = 'Cannot be in the future.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ alreadyDone: boolean; item: StaffItem }>(`/admin/items/${item.id}/maintenance`, {
        body: { date, description, performedBy, markAvailable: canFinish && markAvailable, clientEntryId: entryId.current },
      });
      setOpen(false);
      setNotice(
        r.alreadyDone
          ? 'This entry was already saved.'
          : `Maintenance recorded.${r.item.status === 'Available' && markAvailable ? ' The item is now Available.' : ''}`,
      );
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function exportLog() {
    downloadCSV(
      csvFilename(`maintenance-${item.itemCode}`),
      toCSV(
        ['Item code', 'Date', 'Work done', 'Performed by', 'Status change', 'Recorded by', 'Recorded at'],
        entries.map((m) => [
          m.itemCode,
          m.date,
          m.description,
          m.performedBy,
          m.statusChange ? `${m.statusChange.from} → ${m.statusChange.to}` : '',
          actorName(m.createdBy),
          m.createdAt.replace('T', ' ').slice(0, 16),
        ]),
      ),
    );
  }

  return (
    <section className="panel">
      <div className="page-head">
        <h2>Maintenance log ({entries.length})</h2>
        {entries.length ? (
          <Button variant="ghost" onClick={exportLog}>
            Export CSV
          </Button>
        ) : null}
      </div>
      <p className="muted small">Staff only. Record inspections, repairs and servicing. Entries are kept permanently.</p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {!open ? (
        <Button variant="secondary" onClick={start}>
          + Add maintenance record
        </Button>
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <Field label="Date of work" required error={errors.date}>
            {(p) => <input {...p} type="date" max={config.today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="What was done" required error={errors.description} hint="e.g. Replaced lamp, cleaned filter, tested OK.">
            {(p) => <textarea {...p} rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <Field label="Done by" error={errors.performedBy} hint="Staff member or service company.">
            {(p) => <input {...p} maxLength={120} value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} />}
          </Field>
          {canFinish ? (
            <label className="radio">
              <input type="checkbox" checked={markAvailable} onChange={(e) => setMarkAvailable(e.target.checked)} /> Work is
              finished — mark the item <strong>Available</strong>
            </label>
          ) : null}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="button-row">
            <Button type="submit" busy={busy}>
              Save record
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <p className="muted">No maintenance recorded yet.</p>
      ) : (
        <ol className="activity-list">
          {entries.map((m) => (
            <li key={m.id}>
              <div className="activity-head">
                <strong>{formatDate(m.date)}</strong>
                {m.performedBy ? <span className="muted"> · {m.performedBy}</span> : null}
              </div>
              <div className="pre">{m.description}</div>
              {m.statusChange ? (
                <div className="small">
                  Status: {m.statusChange.from} → {m.statusChange.to}
                </div>
              ) : null}
              <div className="muted small">
                Recorded {formatDateTime(m.createdAt)} by {actorName(m.createdBy)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
