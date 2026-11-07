import { useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Building2, Cpu, Timer, Clock, CalendarDays, Minus, Plus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { usePlatform, list, useRun } from '@/lib/platform';
import { fileUrl, type R } from '@/lib/api';
import { amount, num, titleCase, D, dmax0 } from '@/lib/format';
import { PageSkeleton, ErrorState, EmptyState, StatusChip, ActionSheet, SignInPrompt } from '@/components/app/kit';
import { assetImage, assetImageFallback } from '@/components/app/domain';
import { cn } from '@/lib/utils';

const MODES = [
  { k: 'minute', icon: Timer, label: 'perMinute', unit: 'minutes' },
  { k: 'hour', icon: Clock, label: 'perHour', unit: 'hours' },
  { k: 'day', icon: CalendarDays, label: 'perDay', unit: 'days' },
] as const;

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { state, user, booting, bootError, refetch } = usePlatform();
  const { run, pending } = useRun('user');
  const [img, setImg] = useState(0);
  const [open, setOpen] = useState(false);
  const [virtualAccepted, setVirtualAccepted] = useState(false);
  const [mode, setMode] = useState<'minute' | 'hour' | 'day'>('hour');
  const [dur, setDur] = useState(1);
  const [units, setUnits] = useState(1);
  const [auto, setAuto] = useState(false);

  if (booting) return <PageSkeleton />;
  if (bootError) return <ErrorState error={bootError} onRetry={refetch} />;
  const a = list(state.assets).find((x) => String(x.id) === id);
  if (!a) return <EmptyState icon={Building2} title="Listing not found" body="It may have been removed or is no longer published." action={<Link href="/market" className="text-primary font-semibold">{t('browseMarket')}</Link>} />;

  const rates = (a.rates as R) || {};
  const images: string[] = Array.isArray(a.images) && a.images.length ? a.images.map((x: unknown) => fileUrl(String(x))) : [assetImage(a)];
  const specs = Object.entries((a.specs as R) || {});
  const configured = Boolean(a.profit_model_configured);
  const comingSoon = a.status === 'coming_soon';
  const rate = D(rates[mode]);
  const principal = D(a.capital_required).times(units);
  const estimate = rate.times(dur).times(units);
  const wallet = list(state.wallets).find((w) => w.currency === a.currency);
  const bal = dmax0(D(wallet?.balance).minus(D(wallet?.locked)));
  const short = user ? principal.gt(bal) : false;
  const Icon = a.type === 'machine' ? Cpu : Building2;
  const minD = num(a.min_duration), maxD = num(a.max_duration);
  const durMinutes = dur * (mode === 'minute' ? 1 : mode === 'hour' ? 60 : 1440);
  const outOfRange = (minD > 0 && durMinutes < minD) || (maxD > 0 && durMinutes > maxD);

  return (
    <div className="max-w-6xl mx-auto">
      <button onClick={() => navigate('/market')} className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 hover:text-foreground" data-testid="button-back"><ArrowLeft className="w-4 h-4 rtl:rotate-180" />{t('market')}</button>
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="rise">
          <div className="rounded-[28px] overflow-hidden aspect-[4/3] bg-muted"><img src={images[img]} alt={String(a.title)} onError={(event) => { const image = event.currentTarget; if (image.dataset.fallbackApplied !== 'true') { image.dataset.fallbackApplied = 'true'; image.src = assetImageFallback(a); } }} className="w-full h-full object-cover" data-testid="img-asset" /></div>
          {images.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
              {images.map((src, i) => <button key={src + i} onClick={() => setImg(i)} className={cn('w-20 h-16 rounded-xl overflow-hidden border-2 shrink-0', i === img ? 'border-primary' : 'border-transparent opacity-70')} data-testid={`button-thumb-${i}`}><img src={src} alt="" className="w-full h-full object-cover" /></button>)}
            </div>
          )}
          <div className="mt-6">
            <h2 className="font-semibold mb-2">About</h2>
            <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{a.description || 'No description provided.'}</p>
          </div>
          {specs.length > 0 && (
            <div className="mt-6">
              <h2 className="font-semibold mb-3">Specifications</h2>
              <dl className="grid grid-cols-2 gap-2">
                {specs.map(([k, v]) => <div key={k} className="rounded-2xl bg-card border p-3"><dt className="text-[11px] text-muted-foreground uppercase tracking-wide">{titleCase(k)}</dt><dd className="font-medium text-sm mt-0.5">{String(v)}</dd></div>)}
              </dl>
            </div>
          )}
        </div>
        <div className="space-y-4 rise" style={{ animationDelay: '80ms' }}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="w-4 h-4" />{titleCase(String(a.type))} · {a.category}</div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-asset-title">{a.title}</h1>
          {a.location && <p className="flex items-center gap-1.5 text-sm"><MapPin className="w-4 h-4 text-primary" />{a.location}</p>}
          <div className="flex items-center gap-3"><StatusChip status={comingSoon ? 'coming_soon' : !configured ? 'terms_pending' : num(a.available_units) > 0 ? 'available' : 'unavailable'} />{!comingSoon && <span className="text-sm num">{num(a.available_units)} of {num(a.total_units)} units free</span>}</div>
          {comingSoon ? (
            <div className="rounded-2xl border bg-card p-4 text-sm" data-testid={`text-coming-soon-detail-${a.id}`}>
              <p className="font-semibold">Coming soon</p>
              <p className="text-muted-foreground mt-1">Pricing and rental terms are being prepared. This listing cannot be booked yet.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <button key={m.k} onClick={() => { setMode(m.k); if (user) setOpen(true); }} disabled={!configured || rates[m.k] == null} data-testid={`card-rate-${m.k}`}
                    className="press rounded-3xl border bg-card p-4 text-start hover:border-primary disabled:opacity-40">
                    <m.icon className="w-5 h-5 text-primary" />
                    <div className="num text-xl font-semibold mt-3">{rates[m.k] != null ? amount(rates[m.k]) : '—'}</div>
                    <div className="text-xs text-muted-foreground">{a.currency} profit / {t(m.label)}</div>
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border bg-card p-4 text-sm">
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">{t('capitalRequired')}</span><span className="num font-medium">{configured ? amount(a.capital_required) : 'Not configured'} {configured ? a.currency : ''}</span></div>
                {!configured && <p className="text-xs text-amber-600 mt-2">The administrator must set capital and profit terms before this rental can start.</p>}
              </div>
              {(minD > 0 || maxD > 0) && <p className="text-xs text-muted-foreground">Duration window: {minD || 1} to {maxD || 'unlimited'} minutes.</p>}
              {user ? (
                <Button size="lg" className="w-full rounded-full h-14 text-base" disabled={!configured || a.status !== 'active' || num(a.available_units) <= 0} onClick={() => setOpen(true)} data-testid="button-open-rent">{t('rent')} {a.title}</Button>
              ) : (
                <SignInPrompt body="Create an account and fund your wallet to rent this listing." />
              )}
            </>
          )}
        </div>
      </div>

      {!comingSoon && <ActionSheet open={open} onOpenChange={(value)=>{setOpen(value);if(!value)setVirtualAccepted(false);}} title={`${t('rent')} ${a.title}`} description={t('lockedUntilMaturity')}>
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2 p-1 rounded-full bg-muted">
            {MODES.map((m) => <button key={m.k} disabled={rates[m.k] == null} onClick={() => setMode(m.k)} className={cn('rounded-full py-2 text-sm', mode === m.k ? 'bg-card shadow font-semibold' : 'text-muted-foreground')} data-testid={`button-mode-${m.k}`}>{titleCase(m.k)}</button>)}
          </div>
          {[['Duration', dur, setDur, MODES.find((m) => m.k === mode)!.unit], ['Units', units, setUnits, `of ${num(a.available_units)}`]].map(([label, val, set, hint]) => (
            <div key={String(label)}>
              <div className="flex justify-between text-sm mb-2"><span className="font-medium">{String(label)}</span><span className="text-muted-foreground">{String(hint)}</span></div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="rounded-full h-12 w-12" onClick={() => (set as (n: number) => void)(Math.max(1, (val as number) - 1))} data-testid={`button-dec-${label}`}><Minus className="w-4 h-4" /></Button>
                <Input type="number" min={1} value={val as number} onChange={(e) => (set as (n: number) => void)(Math.max(1, Math.floor(num(e.target.value))))} className="text-center num h-12 rounded-2xl text-lg" data-testid={`input-${String(label).toLowerCase()}`} />
                <Button variant="outline" size="icon" className="rounded-full h-12 w-12" onClick={() => (set as (n: number) => void)((val as number) + 1)} data-testid={`button-inc-${label}`}><Plus className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}
          <label className="flex items-center justify-between rounded-2xl border p-4">
            <span><span className="font-medium text-sm block">{t('autoRenew')}</span><span className="text-xs text-muted-foreground">Credit each completed term's profit and keep the same principal locked for the next term.</span></span>
            <Switch checked={auto} onCheckedChange={setAuto} data-testid="switch-autorenew" />
          </label>
          <div className="rounded-3xl vault-card p-5">
            <div className="text-xs uppercase tracking-wider text-white/60">Capital locked now</div>
            <div className="num text-3xl font-semibold mt-1" data-testid="text-cost-preview">{amount(principal)} <span className="text-base text-white/70">{a.currency}</span></div>
            <div className="text-xs text-white/70 mt-2 num" data-testid="text-estimate">{t('estimatedProfit')} {dur} {mode}{dur === 1 ? '' : 's'} × {units} unit(s): {amount(estimate)} {a.currency}</div>
            <div className="text-xs text-white/70 mt-1 num">{t('totalAtMaturity')}: {amount(principal.plus(estimate))} {a.currency}</div>
            <div className="text-xs text-white/60 mt-2 flex items-center gap-1.5 num"><Wallet className="w-3.5 h-3.5" />Available {amount(bal)} {a.currency}</div>
          </div>
          {short && <p className="text-sm text-destructive">Your available balance does not cover this. <Link href="/wallet?sheet=deposit" className="underline font-medium">Deposit {a.currency}</Link></p>}
          {outOfRange && <p className="text-sm text-amber-600">Duration is outside the allowed window for this listing.</p>}
          <div className="text-xs text-muted-foreground">{t('earlyStopProration')}</div>
          <label className="flex items-start gap-3 rounded-2xl border bg-accent/40 p-3 text-xs leading-relaxed"><input type="checkbox" checked={virtualAccepted} onChange={(e)=>setVirtualAccepted(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary" data-testid="checkbox-rental-terms" /><span>{t('rentalTermsAck')}</span></label>
          <Button size="lg" className="w-full rounded-full h-14" disabled={pending || !configured || !virtualAccepted || short || outOfRange || units > num(a.available_units)} data-testid="button-confirm-rent"
            onClick={() => run('rent', { asset_id: a.id, billing_mode: mode, duration: dur, units, auto_renew: auto, rental_terms_accepted:true }, { success: 'Rental started', onSuccess: () => { setOpen(false); setVirtualAccepted(false); navigate('/rentals'); } })}>
            {t('confirm')}
          </Button>
        </div>
      </ActionSheet>}
    </div>
  );
}
