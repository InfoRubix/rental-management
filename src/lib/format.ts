/** Formats a YYYY-MM-DD calendar date (no time zone shifting). */
export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Formats an ISO timestamp in the viewer's local time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function actorName(a: { type: string; name?: string | null; email?: string | null } | null | undefined): string {
  if (!a) return '—';
  if (a.type === 'customer') return 'Customer';
  if (a.type === 'system') return a.name ?? 'System';
  return a.name || a.email || 'Staff';
}

