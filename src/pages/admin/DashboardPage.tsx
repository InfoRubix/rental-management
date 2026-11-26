import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { DashboardSummary } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Icon, Loading, type IconName } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useConfig } from '../../lib/config';
import { RequestList, useStaffQuery } from './shared';

function Stat({ label, value, to, tone, icon }: { label: string; value: number; to: string; tone?: string; icon: IconName }) {
  return (
    <Link to={to} className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </Link>
  );
}

function DashSection({
  title,
  count,
  tone,
  icon,
  children,
}: {
  title: string;
  count: number;
  tone: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <section className={`dash-section dash-${tone}`}>
      <div className="dash-section-head">
        <span className="dash-section-icon">
          <Icon name={icon} size={18} />
        </span>
        <h2>{title}</h2>
        <span className="dash-count">
          {count}
          <span className="sr-only"> total</span>
        </span>
      </div>
      {children}
    </section>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const config = useConfig();
  const { call } = useAuth();
  const { data, error, loading, reload } = useStaffQuery<DashboardSummary>('/admin/summary');
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    setSeeding(true);
    try {
      const r = await call<{ created: number; skipped: number }>('/admin/dev/seed', { method: 'POST' });
      setSeedMsg(`Added ${r.created} sample item(s). ${r.skipped ? `${r.skipped} already existed.` : ''}`);
      await reload();
    } catch (e) {
      setSeedMsg(errorMessage(e));
    } finally {
      setSeeding(false);
    }
  }

  return (
    <>
      <div className="hero">
        <div className="page-head">
          <div>
            <p className="hero-eyebrow">{greeting()} 👋</p>
            <h1>Dashboard</h1>
            <p className="hero-sub">Here’s what’s happening with your inventory today.</p>
          </div>
          <Button variant="secondary" className="hero-btn" onClick={() => void reload()} busy={loading && !!data}>
            Refresh
          </Button>
        </div>
      </div>

      {config.mode === 'memory' ? (
        <Alert tone="warning" title="Development data">
          <p>You can load clearly labelled “[SAMPLE]” items into the in-memory store to try the workflow.</p>
          <Button variant="secondary" onClick={() => void seed()} busy={seeding}>
            Load sample items
          </Button>
          {seedMsg ? <p className="small">{seedMsg}</p> : null}
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {!data && loading ? <Loading /> : null}
      {data ? (
        <>
          <div className="stats">
            <Stat label="Available items" value={data.counts.availableItems} to="/admin/items?status=Available" tone="green" icon="check" />
            <Stat label="Active loans" value={data.counts.activeLoans} to="/admin/requests?status=On%20loan" tone="blue" icon="swap" />
            <Stat label="Pending requests" value={data.counts.pendingRequests} to="/admin/requests?status=Pending" tone="amber" icon="clock" />
            <Stat label="Overdue loans" value={data.counts.overdueLoans} to="/admin/requests?status=Overdue" tone="red" icon="alert" />
          </div>
          <p className="muted small dash-note">
            Also: {data.counts.awaitingHandover} approved awaiting handover · {data.counts.returnRequested} return requested ·{' '}
            {data.counts.underMaintenance} under maintenance. Overdue is based on the expected return date; no fees are applied.
          </p>

          <div className="dash-sections">
            <DashSection title="Pending review" count={data.counts.pendingRequests} tone="amber" icon="clock">
              <RequestList requests={data.pending} empty="No requests waiting for review." />
            </DashSection>
            <DashSection title="Approved — awaiting handover" count={data.counts.awaitingHandover} tone="teal" icon="check">
              <RequestList requests={data.awaitingHandover} empty="Nothing waiting to be handed over." />
            </DashSection>
            <DashSection title="Return requested — inspect & confirm" count={data.counts.returnRequested} tone="purple" icon="swap">
              <RequestList requests={data.returnRequested} empty="No returns waiting for inspection." />
            </DashSection>
            <DashSection title="Overdue" count={data.counts.overdueLoans} tone="red" icon="alert">
              <RequestList requests={data.overdue} empty="No overdue loans." />
            </DashSection>
          </div>
        </>
      ) : null}
    </>
  );
}
