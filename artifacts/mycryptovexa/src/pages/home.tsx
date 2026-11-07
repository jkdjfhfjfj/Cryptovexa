import { useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Store, UserPlus, LifeBuoy, ShieldAlert, Megaphone, ChevronRight, Timer, Eye, EyeOff } from 'lucide-react';
import { Carousel, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { usePlatform, list } from '@/lib/platform';
import { amount, usd, num, when, D } from '@/lib/format';
import { CoinIcon, PageSkeleton, ErrorState, EmptyState, SignInPrompt, StatusChip } from '@/components/app/kit';
import { AssetCard, RentalClock } from '@/components/app/domain';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const { t } = useTranslation();
  const { state, user, brand, booting, bootError, workspaceLoading, refetch } = usePlatform();
  const [coin, setCoin] = useState<string | null>(null);
  const [hide, setHide] = useState(false);
  if (booting || workspaceLoading) return <PageSkeleton />;
  if (bootError) return <ErrorState error={bootError} onRetry={refetch} />;

  const currencies = list(state.currencies).filter((c) => c.enabled !== false);
  const wallets = list(state.wallets);
  const codes = currencies.length ? currencies.map((c) => String(c.code)) : wallets.map((w) => String(w.currency));
  const sel = coin || codes[0] || '';
  const w = wallets.find((x) => x.currency === sel);
  const cur = currencies.find((c) => c.code === sel);
  const bal = user ? D(w?.balance) : D(0);
  const price = D(cur?.usd_price ?? cur?.price_usd);
  const totalUsd = user ? wallets.reduce((s, x) => { const c = currencies.find((y) => y.code === x.currency); return s.plus(D(x.balance).times(D(c?.usd_price ?? c?.price_usd))); }, D(0)) : D(0);
  const rentals = list(state.rentals).filter((r) => r.status === 'active' || r.status === 'paused');
  const announcements = list(state.announcements).filter((a) => a.active !== false);
  const kycOpen = user && (user.kyc_status === 'requested' || user.kyc_status === 'rejected');
  const assets = list(state.assets).filter((a) => a.status !== 'disabled').slice(0, 4);

  const quick = [
    { href: '/wallet?sheet=deposit', icon: ArrowDownToLine, label: t('deposit') },
    { href: '/wallet?sheet=withdraw', icon: ArrowUpFromLine, label: t('withdraw') },
    { href: '/market', icon: Store, label: t('rent') },
    { href: '/referrals', icon: UserPlus, label: t('invite') },
    { href: '/help', icon: LifeBuoy, label: t('help') },
  ];

  return (
    <div className="space-y-6">
      {kycOpen && (
        <Link href="/kyc" className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 rise" data-testid="banner-kyc">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
          <span className="text-sm flex-1">{t('kycBanner')}</span>
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center">{t('verifyNow')}<ChevronRight className="w-4 h-4 rtl:rotate-180" /></span>
        </Link>
      )}

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5">
        <section className="vault-card rounded-[28px] p-6 md:p-7 relative overflow-hidden rise" data-testid="card-balance">
          <div className="absolute inset-0 hex-pattern" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.2em] text-white/60">{t('totalBalance')}</span>
              <button onClick={() => setHide(!hide)} className="p-2 rounded-full hover:bg-white/10" data-testid="button-toggle-balance">{hide ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            <div className="mt-3 flex items-end gap-3">
              <span className="num text-4xl md:text-5xl font-semibold tracking-tight" data-testid="text-balance">{hide ? '••••••' : amount(bal)}</span>
              <span className="text-lg text-white/70 mb-1">{sel}</span>
            </div>
            <div className="text-sm text-white/60 mt-1 num">
              {hide ? '≈ ••••' : !price.isZero() ? `≈ ${usd(bal.times(price))}` : user ? `Locked ${amount(w?.locked)} ${sel}` : 'Sign in to see your balance'}
              {totalUsd.gt(0) && !hide && <span className="ms-3">Portfolio ≈ {usd(totalUsd)}</span>}
            </div>
            <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar">
              {codes.map((c) => (
                <button key={c} onClick={() => setCoin(c)} data-testid={`button-coin-${c}`}
                  className={cn('press flex items-center gap-2 rounded-full ps-1 pe-3 py-1 text-sm border transition-colors shrink-0', c === sel ? 'bg-white text-[#0B1A2E] border-white' : 'border-white/20 text-white/80 hover:bg-white/10')}>
                  <CoinIcon code={c} size={22} />{c}
                </button>
              ))}
            </div>
            {!user && <p className="mt-5 text-sm text-white/70">Balances show zero until you sign in. We never display sample figures.</p>}
          </div>
        </section>

        <section className="grid grid-cols-5 lg:grid-cols-3 gap-2 content-start rise" style={{ animationDelay: '80ms' }}>
          {quick.map((q) => (
            <Link key={q.label} href={q.href} className="press flex flex-col items-center justify-center gap-2 rounded-3xl bg-card border py-4 hover:border-primary/50 transition-colors" data-testid={`quick-${q.label}`}>
              <span className="w-12 h-12 rounded-2xl bg-accent grid place-items-center"><q.icon className="w-5 h-5 text-accent-foreground" /></span>
              <span className="text-[11px] md:text-xs font-medium text-center">{q.label}</span>
            </Link>
          ))}
          <div className="hidden lg:flex rounded-3xl border bg-card p-4 col-span-1 flex-col justify-center">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</span>
            <span className="text-sm font-semibold mt-1 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{state.settings?.maintenance ? 'Maintenance' : 'Operational'}</span>
          </div>
        </section>
      </div>

      {announcements.length > 0 && (
        <Carousel opts={{ loop: true }} className="rise">
          <CarouselContent>
            {announcements.map((a) => (
              <CarouselItem key={String(a.id)} className="md:basis-1/2">
                <div className="rounded-3xl border bg-card p-5 flex gap-4 h-full" data-testid={`card-announcement-${a.id}`}>
                  <div className="w-10 h-10 rounded-xl bg-secondary grid place-items-center shrink-0"><Megaphone className="w-5 h-5" /></div>
                  <div><div className="flex items-center gap-2"><h3 className="font-semibold">{a.title}</h3><StatusChip status={a.type === 'warning' ? 'pending' : 'submitted'} /></div><p className="text-sm text-muted-foreground mt-1">{a.body}</p></div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Timer className="w-5 h-5 text-primary" />{t('activeRentals')}</h2>
          {user && <Link href="/rentals" className="text-sm text-primary font-medium" data-testid="link-all-rentals">All</Link>}
        </div>
        {!user ? (
          <SignInPrompt body={`Sign in to ${brand.name} to see live timers and spend for every rental you run.`} />
        ) : rentals.length === 0 ? (
          <EmptyState icon={Timer} title={t('noRentals')} body="Pick a property or machine and pay by the minute, hour or day." action={<Link href="/market" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold" data-testid="link-browse">{t('browseMarket')}</Link>} />
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {rentals.map((r) => (
              <Link key={String(r.id)} href="/rentals" className="rounded-3xl border bg-card p-5 press block" data-testid={`card-rental-${r.id}`}>
                <div className="flex items-start justify-between gap-2 mb-3"><div><h3 className="font-semibold">{r.asset_title}</h3><p className="text-xs text-muted-foreground">Started {when(r.start_at)} · per {r.billing_mode}</p></div><StatusChip status={r.status} /></div>
                <RentalClock r={r} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{t('market')}</h2>
          <Link href="/market" className="text-sm text-primary font-medium flex items-center" data-testid="link-market-more">{t('browseMarket')}<ChevronRight className="w-4 h-4 rtl:rotate-180" /></Link>
        </div>
        {assets.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{assets.map((a, i) => <AssetCard key={String(a.id)} a={a} i={i} />)}</div>
        ) : (
          <EmptyState icon={Store} title="Nothing listed yet" body="New properties and machines appear here as soon as they are published." />
        )}
      </section>
      <p className="text-xs text-muted-foreground text-center pt-2">{t('risk')} <Link href="/legal/risk" className="underline">Risk disclosure</Link></p>
    </div>
  );
}
