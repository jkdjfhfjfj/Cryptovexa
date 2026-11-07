import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Building2, Cpu, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type R, fileUrl } from '@/lib/api';
import { amount, duration, num, D } from '@/lib/format';
import { StatusChip } from './kit';

const ASSET_FALLBACK: Record<string, string> = {
  'asset-loft': '/images/assets/asset-loft.jpg',
  'asset-gpu': '/images/assets/asset-gpu.jpg',
  'asset-villa': '/images/assets/asset-villa.jpg',
  'asset-printer': '/images/assets/asset-printer.jpg',
};

export const assetImage = (a: R) => {
  const img = Array.isArray(a.images) ? a.images[0] : undefined;
  return img ? fileUrl(String(img)) : ASSET_FALLBACK[String(a.id)] || '/images/hero-vault.jpg';
};

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function AssetCard({ a, i = 0 }: { a: R; i?: number }) {
  const { t } = useTranslation();
  const rates = (a.rates as R) || {};
  const Icon = a.type === 'machine' ? Cpu : Building2;
  const configured = Boolean(a.profit_model_configured);
  return (
    <Link href={`/market/${a.id}`} className="group rounded-3xl border bg-card overflow-hidden press hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 rise block" style={{ animationDelay: `${i * 40}ms` }} data-testid={`card-asset-${a.id}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img src={assetImage(a)} alt={String(a.title)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" />
        <div className="absolute top-3 start-3 flex items-center gap-1.5 rounded-full bg-[#0B1A2E]/80 text-white text-[11px] px-2.5 py-1 backdrop-blur">
          <Icon className="w-3.5 h-3.5" />Virtual · {a.category || a.type}
        </div>
        <div className="absolute top-3 end-3"><StatusChip status={!configured ? 'terms_pending' : num(a.available_units) > 0 ? a.status || 'available' : 'unavailable'} className="bg-card/90" /></div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold leading-snug line-clamp-1">{a.title}</h3>
        {a.location && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="w-3 h-3" />{a.location}</p>}
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          {(['minute', 'hour', 'day'] as const).map((m) => (
            <div key={m} className="rounded-xl bg-muted/70 py-1.5">
               <div className="num text-sm font-semibold">{rates[m] != null ? amount(rates[m]) : '—'}</div>
               <div className="text-[10px] text-muted-foreground">profit / {t(m === 'minute' ? 'perMinute' : m === 'hour' ? 'perHour' : 'perDay')}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span className="num">{configured ? `Capital ${amount(a.capital_required)} ${a.currency}` : 'Rental terms not set'}</span>
          <span className="num">{num(a.available_units)}/{num(a.total_units)} {t('available')}</span>
        </div>
      </div>
    </Link>
  );
}

export function RentalClock({ r }: { r: R }) {
  const now = useNow();
  const start = new Date(String(r.start_at)).getTime();
  const end = r.end_at ? new Date(String(r.end_at)).getTime() : 0;
  const running = r.status === 'active';
  const elapsed = running ? now - start : (end || now) - start;
  const remaining = end && running ? end - now : 0;
  const rate = D(r.rate_snapshot);
  const isProfitRental = Number(r.rental_model_version) === 2;
  const paid = D(isProfitRental ? r.profit_paid ?? r.total_cost : r.total_cost);
  let live = paid;
  if (isProfitRental && running) {
    const durationMs = Number(r.duration_ms);
    const cycleStart = new Date(String(r.cycle_started_at || r.start_at)).getTime();
    if (durationMs > 0 && Number.isSafeInteger(durationMs)) {
      const accruedMs = Math.max(0, Math.min(durationMs, now - cycleStart));
      live = paid.plus(D(r.profit_per_cycle).times(accruedMs).div(durationMs).toDecimalPlaces(18));
    }
  } else if (!isProfitRental) {
    // Legacy rentals already active during the model transition keep their original fee billing.
    const accrued = rate.times(Math.floor(elapsed / 60000)).times(D(r.units || 1));
    live = r.billing_mode === 'minute' && running && accrued.gt(paid) ? accrued : paid;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{remaining > 0 ? 'Remaining' : 'Elapsed'}</div>
        <div className="num text-lg font-semibold" data-testid={`text-timer-${r.id}`}>{duration(remaining > 0 ? remaining : elapsed)}</div>
      </div>
      <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{isProfitRental ? (running ? 'Profit paid + estimate' : 'Profit paid') : 'Cost so far'}</div>
        <div className="num text-lg font-semibold">{amount(live)}</div>
      </div>
    </div>
  );
}
