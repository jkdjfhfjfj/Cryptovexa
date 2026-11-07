import { useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Timer, FileDown, Square, PlusCircle, AlertTriangle, Download } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { usePlatform, list, useRun } from '@/lib/platform';
import { invoiceUrl, exportUrl, type R } from '@/lib/api';
import { amount, num, when, D } from '@/lib/format';
import { PageHeader, PageSkeleton, ErrorState, EmptyState, StatusChip, SignInPrompt, ActionSheet } from '@/components/app/kit';
import { RentalClock } from '@/components/app/domain';

export default function RentalsPage() {
  const { t } = useTranslation();
  const { state, user, booting, workspaceLoading, workspaceError, refetch, settings } = usePlatform();
  const { run, pending } = useRun('user');
  const [stopId, setStopId] = useState<R | null>(null);
  const [ext, setExt] = useState<R | null>(null);
  const [extDur, setExtDur] = useState(1);

  if (booting || workspaceLoading) return <PageSkeleton />;
  if (!user) return <><PageHeader title={t('rentals')} icon={Timer} /><SignInPrompt /></>;
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;

  const all = list(state.rentals);
  const groups = { active: all.filter((r) => r.status === 'active'), paused: all.filter((r) => r.status === 'paused'), history: all.filter((r) => !['active', 'paused'].includes(String(r.status))) };
  const threshold = D((settings.billing as R)?.low_balance_threshold);
  const legacyActive = groups.active.filter((r) => Number(r.rental_model_version) !== 2);
  const low = list(state.wallets).filter((w) => legacyActive.some((r) => (list(state.assets).find((a) => a.id === r.asset_id)?.currency ?? w.currency) === w.currency) && D(w.balance).minus(D(w.locked)).lte(threshold) && threshold.gt(0));

  const card = (r: R) => (
    (() => {
      const profitRental = Number(r.rental_model_version) === 2;
      const principal = D(r.principal_amount);
      const estimate = D(r.expected_profit);
      const paid = D(r.profit_paid ?? r.total_cost);
      return (
    <div key={String(r.id)} className="rounded-3xl border bg-card p-5 rise" data-testid={`card-rental-${r.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/market/${r.asset_id}`} className="font-semibold hover:text-primary">{r.asset_title}</Link>
          <p className="text-xs text-muted-foreground mt-0.5 num">{when(r.start_at)} → {r.end_at ? when(r.end_at) : 'open-ended'}</p>
          <p className="text-xs text-muted-foreground num">{profitRental ? 'Profit rate' : 'Rental rate'}: {amount(r.rate_snapshot)} per {r.billing_mode} × {num(r.units || 1)} unit(s)</p>
        </div>
        <StatusChip status={r.status} />
      </div>
      {profitRental && <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
        <div className="rounded-xl bg-muted p-3"><div className="text-muted-foreground">Principal locked</div><div className="num font-semibold mt-1">{amount(principal)} {r.currency}</div></div>
        <div className="rounded-xl bg-muted p-3"><div className="text-muted-foreground">Term profit</div><div className="num font-semibold mt-1">{amount(estimate)} {r.currency}</div></div>
        <div className="rounded-xl bg-muted p-3"><div className="text-muted-foreground">Profit paid</div><div className="num font-semibold mt-1">{amount(paid)} {r.currency}</div></div>
      </div>}
      <div className="mt-4"><RentalClock r={r} /></div>
      <div className="mt-4 flex flex-wrap gap-2 items-center">
        {(r.status === 'active' || r.status === 'paused') && (
          <>
            {(profitRental || r.billing_mode !== 'minute') && <Button size="sm" variant="secondary" className="rounded-full" onClick={() => { setExt(r); setExtDur(1); }} data-testid={`button-extend-${r.id}`}><PlusCircle className="w-4 h-4 me-1.5" />{t('extend')}</Button>}
            <Button size="sm" variant="outline" className="rounded-full text-destructive" onClick={() => setStopId(r)} data-testid={`button-stop-${r.id}`}><Square className="w-4 h-4 me-1.5" />{t('stop')}</Button>
            {(profitRental || r.billing_mode !== 'minute') && <label className="flex items-center gap-2 text-xs ms-auto">{t('autoRenew')}<Switch checked={!!r.auto_renew} disabled={pending} onCheckedChange={(v) => run('rental-renew', { id: r.id, auto_renew: v }, { success: v ? 'Auto-renew on' : 'Auto-renew off' })} data-testid={`switch-renew-${r.id}`} /></label>}
          </>
        )}
        <a href={invoiceUrl(String(r.id))} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs rounded-full border px-3 py-1.5 hover:bg-muted" data-testid={`link-invoice-${r.id}`}><FileDown className="w-3.5 h-3.5" />Invoice</a>
      </div>
    </div>
      );
    })()
  );

  return (
    <div>
      <PageHeader title={t('rentals')} icon={Timer} sub={`${groups.active.length} running`} action={<a href={exportUrl('rentals')} className="inline-flex items-center gap-1.5 text-sm rounded-full border px-4 py-2 hover:bg-muted" data-testid="link-export-rentals"><Download className="w-4 h-4" />CSV</a>} />
      {low.length > 0 && <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex gap-3 text-sm" data-testid="banner-low-balance"><AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />Low balance in {low.map((w) => w.currency).join(', ')}. Running rentals pause when funds run out. <Link href="/wallet?sheet=deposit" className="font-semibold underline">Top up</Link></div>}
      <Tabs defaultValue="active">
        <TabsList className="rounded-full h-11 p-1 mb-4">
          {(['active', 'paused', 'history'] as const).map((k) => <TabsTrigger key={k} value={k} className="rounded-full px-5" data-testid={`tab-${k}`}>{k === 'history' ? t('history') : t(k)} <span className="ms-1.5 num text-xs opacity-60">{groups[k].length}</span></TabsTrigger>)}
        </TabsList>
        {(['active', 'paused', 'history'] as const).map((k) => (
          <TabsContent key={k} value={k}>
            {groups[k].length ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{groups[k].map(card)}</div> : <EmptyState icon={Timer} title={k === 'history' ? 'No past rentals yet' : t('noRentals')} action={<Link href="/market" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold">{t('browseMarket')}</Link>} />}
          </TabsContent>
        ))}
      </Tabs>

      <AlertDialog open={!!stopId} onOpenChange={(o) => !o && setStopId(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader><AlertDialogTitle>Stop {stopId?.asset_title}?</AlertDialogTitle><AlertDialogDescription>{Number(stopId?.rental_model_version) === 2 ? 'Your locked principal will be released and profit prorated through the stop time. Any already settled term profits stay credited.' : `Unused prepaid time is refunded minus the early-stop penalty of ${num((settings.billing as R)?.early_stop_penalty_percent ?? (settings.billing as R)?.penalty_percent)}%. This cannot be undone.`}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="rounded-full">{t('cancel')}</AlertDialogCancel><AlertDialogAction className="rounded-full bg-destructive" data-testid="button-confirm-stop" onClick={() => stopId && run('rental-stop', { id: stopId.id }, { success: 'Rental stopped' })}>{t('stop')}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionSheet open={!!ext} onOpenChange={(o) => !o && setExt(null)} title={`${t('extend')} ${ext?.asset_title ?? ''}`} description={Number(ext?.rental_model_version) === 2 ? `Extends the locked-principal term at the snapshotted profit rate.` : `Adds prepaid ${ext?.billing_mode}s at the snapshotted rate.`}>
        <div className="space-y-4">
          <Input type="number" min={1} value={extDur} onChange={(e) => setExtDur(Math.max(1, Math.floor(num(e.target.value))))} className="h-12 rounded-2xl num text-lg" data-testid="input-extend" />
          <div className="rounded-2xl bg-muted p-4 num">{Number(ext?.rental_model_version) === 2 ? 'Additional estimated profit' : 'Cost'}: {amount(D(ext?.rate_snapshot).times(extDur).times(D(ext?.units || 1)))} {ext?.currency}</div>
          <Button className="w-full rounded-full h-12" disabled={pending} onClick={() => ext && run('rental-extend', { id: ext.id, duration: extDur }, { success: 'Rental extended', onSuccess: () => setExt(null) })} data-testid="button-confirm-extend">{t('confirm')}</Button>
        </div>
      </ActionSheet>
    </div>
  );
}
