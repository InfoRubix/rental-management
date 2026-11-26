import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ItemStatus, RequestStatus } from '../../shared/types';

// ---------------------------------------------------------------------------
// Status badges: always text + symbol, never colour alone.
// ---------------------------------------------------------------------------

const BADGE: Record<string, { tone: string; icon: string }> = {
  Available: { tone: 'green', icon: '●' },
  'On loan': { tone: 'blue', icon: '⇄' },
  'Under maintenance': { tone: 'amber', icon: '⚠' },
  Inactive: { tone: 'grey', icon: '○' },
  Pending: { tone: 'amber', icon: '…' },
  Approved: { tone: 'teal', icon: '✓' },
  Rejected: { tone: 'red', icon: '✕' },
  'Return requested': { tone: 'purple', icon: '↩' },
  Returned: { tone: 'grey', icon: '✓' },
  Cancelled: { tone: 'grey', icon: '✕' },
  Overdue: { tone: 'red', icon: '!' },
  'Not available right now': { tone: 'grey', icon: '○' },
  'Awaiting handover': { tone: 'teal', icon: '⏳' },
  // Accounts
  Admin: { tone: 'purple', icon: '★' },
  Staff: { tone: 'blue', icon: '●' },
  Active: { tone: 'green', icon: '✓' },
  Blocked: { tone: 'red', icon: '✕' },
  'Waiting for approval': { tone: 'amber', icon: '…' },
  'Not signed in yet': { tone: 'amber', icon: '…' },
};

export function StatusBadge({ status }: { status: ItemStatus | RequestStatus | string }) {
  const b = BADGE[status] ?? { tone: 'grey', icon: '•' };
  return (
    <span className={`badge badge-${b.tone}`}>
      <span aria-hidden="true">{b.icon}</span> {status}
    </span>
  );
}

// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  busy?: boolean;
  block?: boolean;
};

export function Button({ variant = 'primary', busy, block, children, disabled, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  id: givenId,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  id?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }) => ReactNode;
}) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> (required)</span> : <span className="opt"> (optional)</span>}
      </label>
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, required })}
      {error ? (
        <p className="error-text" id={errId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <strong className="alert-title">{title}</strong> : null}
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="inbox" size={28} />
      </span>
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function FullPageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="container narrow full-page">
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.select();
    }
  }
  return (
    <div className="copy-field">
      <label htmlFor={id}>{label}</label>
      <div className="copy-row">
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </Button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}

export function DefinitionList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="deflist">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ItemImage({ src, alt, size = 'md' }: { src: string | null; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`item-img item-img-${size} item-img-placeholder`} aria-hidden="true">
        <Icon name="photo" size={size === 'sm' ? 22 : 32} />
        {size === 'sm' ? null : <span>No photo</span>}
      </div>
    );
  }
  return <img className={`item-img item-img-${size}`} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

// ---------------------------------------------------------------------------
// Small inline line icons (decorative; always paired with visible text).
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, ReactNode> = {
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M7 12h10" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-7Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </>
  ),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  swap: <path d="M4 8h14l-4-4M20 16H6l4 4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />,
  photo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="box" size={Math.round(size * 0.58)} />
    </span>
  );
}
