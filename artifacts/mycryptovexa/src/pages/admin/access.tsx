import { MapPin, ShieldAlert } from 'lucide-react';
import { AdminTitle, DataTable, useAdmin, type Col } from './shell';
import { list } from '@/lib/platform';

const eventLabel = (value: unknown) => String(value ?? 'unknown').replaceAll('_', ' ');
const dateLabel = (value: unknown) => {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

export default function AdminAccessHistory() {
  const { state } = useAdmin();
  const events = list(state.adminAccessEvents);
  const columns: Col[] = [
    { key: 'created_at', label: 'Time', render: (row) => <span className="whitespace-nowrap text-xs">{dateLabel(row.created_at)}</span> },
    { key: 'event', label: 'Event', render: (row) => <span className="font-medium capitalize">{String(row.event_label || eventLabel(row.event))}</span> },
    { key: 'email', label: 'Account', render: (row) => String(row.email || '—') },
    { key: 'ip', label: 'IP address', render: (row) => <code className="text-xs">{String(row.ip || '—')}</code> },
    { key: 'location_summary', label: 'Location', render: (row) => <span className="text-xs">{String(row.location_summary || 'Precise location not shared')}</span> },
    { key: 'referrer_origin', label: 'Referrer site', render: (row) => String(row.referrer_origin || 'Direct') },
    { key: 'user_agent', label: 'Browser / device', render: (row) => <span className="block max-w-sm truncate text-xs" title={String(row.user_agent || '')}>{String(row.user_agent || '—')}</span> },
  ];

  return (
    <div className="space-y-5">
      <AdminTitle title="Admin access history" sub="Latest 1,000 sign-in page and administrator authentication events." />
      <section className="rounded-3xl border bg-card p-4 md:p-5 flex gap-3" data-testid="admin-access-privacy-note">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-semibold">Location is optional and browser-reported</p>
          <p className="mt-1 text-muted-foreground">IP, time, browser, and referring site are recorded for page visits and sign-in attempts. Precise coordinates appear only when someone explicitly shares device location. Coordinates are not independently verified; IP addresses are shown without sending them to a third-party geolocation provider.</p>
        </div>
      </section>
      <div className="rounded-3xl border bg-card p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-primary" />{events.length} recorded events</div>
        <DataTable
          rows={events}
          cols={columns}
          testId="admin-access-history"
          empty="No administrator access events have been recorded yet."
        />
      </div>
      <p className="text-xs text-muted-foreground">In production, security alert emails go to the fixed security contact. Repeated page-access and failed-login emails from the same IP and event are grouped for five minutes; successful sign-ins and explicit location shares are reported each time.</p>
    </div>
  );
}
