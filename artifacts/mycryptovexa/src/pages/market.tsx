import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Store, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { usePlatform, list } from '@/lib/platform';
import { num, D } from '@/lib/format';
import { PageHeader, PageSkeleton, ErrorState, EmptyState } from '@/components/app/kit';
import { AssetCard } from '@/components/app/domain';
import { cn } from '@/lib/utils';

export default function MarketPage() {
  const { t } = useTranslation();
  const { state, booting, bootError, refetch } = usePlatform();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('featured');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [maxHour, setMaxHour] = useState('');
  const assets = list(state.assets);
  const cats = useMemo(() => Array.from(new Set(assets.map((a) => String(a.category || '')).filter(Boolean))), [assets]);
  const shown = useMemo(() => {
    let r = assets.filter((a) => a.status !== 'disabled');
    if (type !== 'all') r = r.filter((a) => a.type === type);
    if (cat !== 'all') r = r.filter((a) => a.category === cat);
    if (onlyAvail) r = r.filter((a) => num(a.available_units) > 0);
    if (maxHour) r = r.filter((a) => D((a.rates as Record<string, unknown>)?.hour).lte(D(maxHour)));
    if (q) { const s = q.toLowerCase(); r = r.filter((a) => `${a.title} ${a.location} ${a.description}`.toLowerCase().includes(s)); }
    const rate = (a: Record<string, unknown>) => D((a.rates as Record<string, unknown>)?.hour);
    if (sort === 'low') r = [...r].sort((a, b) => rate(a).comparedTo(rate(b)));
    if (sort === 'high') r = [...r].sort((a, b) => rate(b).comparedTo(rate(a)));
    return r;
  }, [assets, type, cat, onlyAvail, maxHour, q, sort]);

  if (booting) return <PageSkeleton />;
  if (bootError) return <ErrorState error={bootError} onRetry={refetch} />;

  return (
    <div>
      <div className="relative rounded-[28px] overflow-hidden mb-6 vault-card rise">
        <img src="/images/hero-vault.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-55" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B1A2E] via-[#0B1A2E]/80 to-transparent rtl:bg-gradient-to-l" />
        <div className="relative p-6 md:p-10 max-w-xl">
          <span className="text-xs uppercase tracking-[0.25em] text-[#5eead4]">{t('market')}</span>
          <h1 className="text-3xl md:text-4xl font-semibold mt-2 leading-tight">Lofts, studios, rigs and heavy machines. Billed to the minute.</h1>
          <p className="text-white/70 text-sm mt-3">Every rate is fixed at the moment you start. Stop early and unused time is refunded under published billing rules.</p>
        </div>
      </div>
      <PageHeader title={t('browseMarket')} sub={`${shown.length} listings`} icon={Store} />
      <div className="sticky top-16 z-30 -mx-4 px-4 py-3 bg-background/85 backdrop-blur-xl mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute start-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}…`} className="ps-11 h-12 rounded-full bg-card" data-testid="input-search" />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar items-center">
          {['all', 'property', 'machine'].map((k) => (
            <button key={k} onClick={() => setType(k)} data-testid={`filter-type-${k}`} className={cn('press shrink-0 rounded-full border px-4 py-1.5 text-sm', type === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card')}>
              {k === 'all' ? t('all') : k === 'property' ? t('properties') : t('machines')}
            </button>
          ))}
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-40 rounded-full shrink-0 h-9" data-testid="select-category"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All categories</SelectItem>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-40 rounded-full shrink-0 h-9" data-testid="select-sort"><SlidersHorizontal className="w-3.5 h-3.5" /><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="featured">Featured</SelectItem><SelectItem value="low">Hourly: low to high</SelectItem><SelectItem value="high">Hourly: high to low</SelectItem></SelectContent>
          </Select>
          <Input value={maxHour} onChange={(e) => setMaxHour(e.target.value)} type="number" placeholder="Max / hour" className="w-32 h-9 rounded-full shrink-0" data-testid="input-max-price" />
          <label className="flex items-center gap-2 text-sm shrink-0 ps-1"><Switch checked={onlyAvail} onCheckedChange={setOnlyAvail} data-testid="switch-available" />{t('available')}</label>
        </div>
      </div>
      {shown.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{shown.map((a, i) => <AssetCard key={String(a.id)} a={a} i={i} />)}</div>
      ) : (
        <EmptyState icon={Search} title="No listings match" body="Loosen a filter or clear the search to see more." />
      )}
    </div>
  );
}
