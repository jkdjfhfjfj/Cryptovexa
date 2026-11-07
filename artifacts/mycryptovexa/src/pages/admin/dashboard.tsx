import { Link } from 'wouter';
import { Users, UserPlus, ArrowDownToLine, ArrowUpFromLine, Hand, Timer, Coins, Headset, ShieldCheck, PlugZap, Scale } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { list, useRun } from '@/lib/platform';
import { type R } from '@/lib/api';
import { amount, num } from '@/lib/format';
import { Stat, EmptyState } from '@/components/app/kit';
import { useAdmin, AdminTitle } from './shell';
import { Section } from './parts';

export default function AdminDashboard() {
  const { state, can } = useAdmin();
  const { run, pending } = useRun('admin');
  const s = (state.stats as R) || {};
  const count = (k: string, f: (r: R) => boolean) => s[k] ?? list(state[k === 'pending_deposits' ? 'deposits' : 'withdrawals']).filter(f).length;
  const kpis = [
    { l: 'Users', v: s.users ?? list(state.users).length, i: Users },
    { l: 'New today', v: s.new_today ?? s.newToday ?? 0, i: UserPlus },
    { l: 'Pending deposits', v: count('pending_deposits', (d) => d.status === 'pending_review'), i: ArrowDownToLine, to: 'deposits' },
    { l: 'Pending withdrawals', v: count('pending_withdrawals', (w) => ['queued', 'processing', 'pending_confirm'].includes(String(w.status))), i: ArrowUpFromLine, to: 'withdrawals' },
    { l: 'Manual fallback', v: s.manual_fallback ?? list(state.withdrawals).filter((w) => w.status === 'manual_fallback').length, i: Hand, to: 'withdrawals' },
    { l: 'Active rentals', v: s.active_rentals ?? list(state.rentals).filter((r) => r.status === 'active').length, i: Timer, to: 'rentals' },
    { l: 'Revenue', v: s.revenue != null ? (typeof s.revenue === 'object' ? Object.entries(s.revenue as R).map(([k, v]) => `${amount(v)} ${k}`).join(' · ') : amount(s.revenue)) : '—', i: Coins },
    { l: 'Open tickets', v: s.open_tickets ?? list(state.tickets).filter((t) => t.status === 'open').length, i: Headset, to: 'support' },
    { l: 'Pending KYC', v: s.pending_kyc ?? list(state.kycRequests).filter((k) => k.status === 'submitted').length, i: ShieldCheck, to: 'kyc' },
  ];
  const series = list(s.series ?? s.daily);
  const binance = (s.binance as R) || {};

  return (
    <div className="space-y-5">
      <AdminTitle title="Dashboard" sub="Live operational picture. Refreshes every 15 seconds." action={can('settings') && (
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => run('binance-test', {})} data-testid="button-binance-test"><PlugZap className="w-4 h-4 me-1.5" />Test Binance</Button>
          <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => run('reconcile', {})} data-testid="button-reconcile"><Scale className="w-4 h-4 me-1.5" />Reconcile ledger</Button>
        </div>)} />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const body = <Stat label={k.l} value={k.v as React.ReactNode} icon={k.i} />;
          return k.to && can(k.to) ? <Link key={k.l} href={`/admin/${k.to}`} className="press block hover:[&>div]:border-primary/50" data-testid={`kpi-${k.l}`}>{body}</Link> : <div key={k.l}>{body}</div>;
        })}
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Binance</div>
          <div className="mt-2 font-semibold flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${binance.connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />{binance.connected ? 'Connected' : binance.configured === false ? 'Not configured' : 'Unknown'}</div>
          {Array.isArray(binance.balance) ? <div className="mt-1 space-y-0.5" data-testid="text-binance-balance">{(binance.balance as R[]).slice(0, 4).map((b) => <div key={String(b.currency)} className="text-xs num flex justify-between gap-2"><span>{String(b.currency)}</span><span>{amount(b.free)}{b.locked && String(b.locked) !== '0' ? ` (+${amount(b.locked)} locked)` : ''}</span></div>)}</div> : binance.balance != null && typeof binance.balance !== 'object' ? <div className="text-xs num mt-1">{String(binance.balance)}</div> : null}
        </div>
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        {[['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['revenue', 'Revenue'], ['signups', 'Signups']].map(([k, label]) => (
          <Section key={k} title={label}>
            {series.length ? (
              <div className="h-56">
                <ResponsiveContainer>
                  <AreaChart data={series.map((p) => ({ ...p, [k]: num(p[k]) }))}>
                    <defs><linearGradient id={`f${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#14B8A6" stopOpacity={0.4} /><stop offset="1" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ borderRadius: 12, background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
                    <Area type="monotone" dataKey={k} stroke="#14B8A6" strokeWidth={2} fill={`url(#f${k})`} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState title="No series data yet" body="Charts populate once activity is recorded." />}
          </Section>
        ))}
      </div>
    </div>
  );
}
