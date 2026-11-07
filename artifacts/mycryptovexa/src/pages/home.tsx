import { useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { sanitizeRichHtml } from '@/components/app/rich-text-editor';
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
  const assets = list(state.assets).filter((a) => a.status !== 'disabled').slice(0, 15);

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

        <section className="grid grid-cols-6 lg:grid-cols-3 gap-2.5 content-start min-w-0 rise" style={{ animationDelay: '80ms' }}>
          {quick.map((q, i) => {
            const wide = i < 2;
            return (
              <Link key={q.label} href={q.href} title={q.label} aria-label={q.label} data-testid={`quick-${q.label}`}
                className={cn(
                  'press group min-w-0 rounded-2xl lg:rounded-3xl border bg-card hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors',
                  wide
                    ? 'col-span-3 flex items-center gap-2 min-h-[64px] px-2 py-3 min-[360px]:gap-3 min-[360px]:px-3 lg:col-span-1 lg:flex-col lg:justify-center lg:gap-2 lg:px-2 lg:py-4'
                    : 'col-span-2 flex flex-col items-center justify-center gap-1.5 min-h-[80px] px-1.5 py-3 lg:col-span-1 lg:gap-2 lg:py-4',
                )}>
                <span className={cn('shrink-0 grid place-items-center rounded-xl lg:rounded-2xl lg:w-12 lg:h-12', wide ? 'w-10 h-10 bg-primary text-primary-foreground lg:bg-accent lg:text-accent-foreground' : 'w-10 h-10 bg-accent text-accent-foreground')}>
                  <q.icon className="w-5 h-5" />
                </span>
                <span className={cn('min-w-0 max-w-full font-semibold leading-tight break-words hyphens-auto line-clamp-2', wide ? 'text-xs min-[360px]:text-sm text-start lg:text-xs lg:text-center' : 'text-xs text-center')}>{q.label}</span>
              </Link>
            );
          })}
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
                  <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="font-semibold">{a.title}</h3><StatusChip status={a.type === 'warning' ? 'pending' : 'submitted'} /></div><div className="prose prose-sm dark:prose-invert max-w-none mt-1 text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(String(a.body ?? '')) }} /></div>
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
          <EmptyState icon={Timer} title={t('noRentals')} body="Choose an in-app rental term, review the locked capital and profit estimate, then track settlement here." action={<Link href="/market" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold" data-testid="link-browse">{t('browseMarket')}</Link>} />
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
          <EmptyState icon={Store} title="Nothing listed yet" body="New virtual rentals appear here as soon as they are published." />
        )}
      </section>
      <p className="text-xs text-muted-foreground text-center pt-2">{t('risk')} <Link href="/legal/risk" className="underline">Risk disclosure</Link></p>
    </div>
  );
}
