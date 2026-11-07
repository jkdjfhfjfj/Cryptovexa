import { useState } from 'react';
import { Plus, Trash2, Square, Pause, PlusCircle, X, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { list, useRun } from '@/lib/platform';
import { fileUrl, type R } from '@/lib/api';
import { amount, when, D, Decimal } from '@/lib/format';
import { StatusChip, ActionSheet, FilePick } from '@/components/app/kit';
import { assetImage } from '@/components/app/domain';
import { useAdmin, DataTable, AdminTitle, userLabel } from './shell';
import { usePrompt } from './parts';

type RateBasis = 'minute' | 'hour' | 'day';
type ScheduledRow = { at: string; basis: RateBasis; value: string; applied: boolean; raw?: R };
const toLocalDateTime = (value: unknown) => {
  const date = new Date(String(value ?? ''));
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};
const rateInput = (value: unknown) => {
  const text = String(value ?? '');
  return /^\d{1,18}(\.\d{1,18})?$/.test(text) ? D(text).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3) : text;
};
const parseScheduledRows = (value: unknown): ScheduledRow[] => {
  let parsed = value;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return []; } }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => {
    const raw = (item && typeof item === 'object' ? item : {}) as R;
    const rawRates = raw.rates && typeof raw.rates === 'object' ? raw.rates as R : raw;
    const basis = (['minute', 'hour', 'day'].includes(String(raw.profit_rate_basis))
      ? String(raw.profit_rate_basis)
      : (['minute', 'hour', 'day'].find((key) => rawRates[key] !== undefined) || 'hour')) as RateBasis;
    return { at: toLocalDateTime(raw.at), basis, value: rateInput(rawRates[basis]), applied: Boolean(raw.applied), raw };
  });
};
const blank = { type: 'property', title: '', description: '', location: '', category: '', status: 'active' as string, total_units: '1', available_units: '1', currency: 'USDT', capital_required: '', profit_rate_basis: 'hour', profit_rate_value: '', min_duration: '', max_duration: '', rates: { minute: '', hour: '', day: '' }, images: [] as string[], specs: [] as [string, string][], discount_rules: '', scheduled_changes: [] as ScheduledRow[] };

function AssetEditor({ a, onDone }: { a: R | null; onDone: () => void }) {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const [f, setF] = useState(() => a ? { ...blank, ...a, status: a.status === 'disabled' ? 'inactive' : String(a.status || 'active'), total_units: String(a.total_units ?? 1), available_units: String(a.available_units ?? 1), capital_required: String(a.capital_required ?? ''), profit_rate_basis: String(a.profit_rate_basis ?? 'hour'), profit_rate_value: String(a.profit_rate_value ?? (a.rates as R)?.[String(a.profit_rate_basis ?? 'hour')] ?? ''), min_duration: String(a.min_duration ?? ''), max_duration: String(a.max_duration ?? ''), rates: { minute: rateInput((a.rates as R)?.minute), hour: rateInput((a.rates as R)?.hour), day: rateInput((a.rates as R)?.day) }, images: Array.isArray(a.images) ? a.images.map(String) : [], specs: Object.entries((a.specs as R) || {}).map(([k, v]) => [k, String(v)] as [string, string]), discount_rules: a.discount_rules ? JSON.stringify(a.discount_rules) : '', scheduled_changes: parseScheduledRows(a.scheduled_changes) } : blank);
  const [img, setImg] = useState('');
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v } as typeof f);
  const setProfitRate = (basis: 'minute' | 'hour' | 'day', value: string) => {
    const valid = /^\d{1,18}(\.\d{0,3})?$/.test(value);
    if (!value.trim()) {
      setF({ ...f, profit_rate_basis: basis, profit_rate_value: '', rates: { minute: '', hour: '', day: '' } });
      return;
    }
    if (!valid) {
      setF({ ...f, profit_rate_basis: basis, profit_rate_value: value, rates: { ...f.rates, [basis]: value } });
      return;
    }
    const rate = D(value);
    const perMinute = basis === 'minute' ? rate : basis === 'hour' ? rate.div(60) : rate.div(1440);
    const perHour = basis === 'minute' ? rate.times(60) : basis === 'hour' ? rate : rate.div(24);
    const perDay = basis === 'minute' ? rate.times(1440) : basis === 'hour' ? rate.times(24) : rate;
    const fixed = (n: typeof rate) => n.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
    setF({ ...f, profit_rate_basis: basis, profit_rate_value: value, rates: { minute: fixed(perMinute), hour: fixed(perHour), day: fixed(perDay) } });
  };
  const parse = (s: string) => { if (!s.trim()) return null; try { return JSON.parse(s); } catch { return null; } };
  const validMoney = (value: string) => /^\d{1,18}(\.\d{1,3})?$/.test(value) && !D(value).isNegative();
  const profitSetupValid = validMoney(f.capital_required) && D(f.capital_required).gt(0) && validMoney(f.profit_rate_value) && D(f.profit_rate_value).gt(0);
  const scheduleErr = f.scheduled_changes.some((row) => !row.applied && (!row.at || !Number.isFinite(new Date(row.at).getTime()) || !validMoney(row.value)));
  const coins = list(state.currencies).map((c) => String(c.code));
  const save = () => scheduleErr ? undefined : run('asset-save', {
    ...(a?.id ? { id: a.id } : {}), type: f.type, title: f.title, description: f.description, location: f.location, category: f.category, status: f.status,
    total_units: Number(f.total_units), available_units: Number(f.available_units), currency: f.currency,
    capital_required: f.capital_required, profit_rate_basis: f.profit_rate_basis, profit_rate_value: f.profit_rate_value,
    min_duration: f.min_duration ? Number(f.min_duration) : null, max_duration: f.max_duration ? Number(f.max_duration) : null,
    rates: Object.fromEntries(Object.entries(f.rates).map(([k, v]) => [k, v === '' ? null : v])),
    images: f.images, specs: Object.fromEntries(f.specs.filter(([k]) => k)), discount_rules: parse(f.discount_rules),
    scheduled_changes: f.scheduled_changes.map((row) => {
      const raw = row.raw ?? {};
      const rawRates = raw.rates && typeof raw.rates === 'object' ? raw.rates as R : Object.fromEntries(['minute', 'hour', 'day'].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
      return { ...raw, at: new Date(row.at).toISOString(), profit_rate_basis: row.basis, rates: { ...rawRates, [row.basis]: row.value } };
    }),
  }, { success: 'Asset saved', onSuccess: onDone });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Select value={f.type} onValueChange={(v) => set('type', v)}><SelectTrigger className="rounded-xl" data-testid="select-asset-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="property">Property</SelectItem><SelectItem value="machine">Machine</SelectItem></SelectContent></Select>
        <Select value={f.status} onValueChange={(v) => set('status', v)}><SelectTrigger className="rounded-xl" data-testid="select-asset-status"><SelectValue /></SelectTrigger><SelectContent>{['active', 'maintenance', 'inactive'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <Input placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)} className="rounded-xl" data-testid="input-asset-title" />
      <Textarea placeholder="Description" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} className="rounded-xl" data-testid="input-asset-description" />
      <div className="grid grid-cols-2 gap-2"><Input placeholder="Location" value={f.location} onChange={(e) => set('location', e.target.value)} className="rounded-xl" data-testid="input-asset-location" /><Input placeholder="Category" value={f.category} onChange={(e) => set('category', e.target.value)} className="rounded-xl" data-testid="input-asset-category" /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Total units</Label><Input type="number" value={f.total_units} onChange={(e) => set('total_units', e.target.value)} className="rounded-xl mt-1" /></div>
        <div><Label className="text-xs">Available</Label><Input type="number" value={f.available_units} onChange={(e) => set('available_units', e.target.value)} className="rounded-xl mt-1" /></div>
        <div><Label className="text-xs">Currency</Label><Select value={f.currency} onValueChange={(v) => set('currency', v)}><SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger><SelectContent>{(coins.length ? coins : ['USDT']).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div><Label className="text-xs">Capital required per unit</Label><Input type="text" inputMode="decimal" value={f.capital_required} onChange={(e) => set('capital_required', e.target.value)} placeholder="e.g. 100.000" className="rounded-xl mt-1 num" data-testid="input-capital-required" /><p className="text-[11px] text-muted-foreground mt-1">Enter up to 3 decimal places. This amount stays locked for the full rental term.</p></div>
      <div className="rounded-2xl border p-3 space-y-2">
        <div className="text-xs font-semibold">Profit schedule ({f.currency} per unit)</div>
        <p className="text-[11px] text-muted-foreground">Enter up to 3 decimal places. Edit any one period; the other rates recalculate using 60 minutes per hour and 24 hours per day.</p>
        <div className="grid grid-cols-3 gap-2">{(['minute', 'hour', 'day'] as const).map((m) => <div key={m}><Label className="text-xs">Profit per {m}</Label><Input type="text" inputMode="decimal" value={f.rates[m]} onChange={(e) => setProfitRate(m, e.target.value)} className="rounded-xl mt-1 num" data-testid={`input-rate-${m}`} /></div>)}</div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Min duration (min)</Label><Input type="number" value={f.min_duration} onChange={(e) => set('min_duration', e.target.value)} className="rounded-xl mt-1" /></div><div><Label className="text-xs">Max duration (min)</Label><Input type="number" value={f.max_duration} onChange={(e) => set('max_duration', e.target.value)} className="rounded-xl mt-1" /></div></div>
        <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">Legacy discount settings are kept as-is and do not change the new rental profit schedule.</div>
        <div className="rounded-2xl border p-3 space-y-3">
          <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-semibold">Scheduled rate changes</div><p className="text-[11px] text-muted-foreground">Choose when the new rate starts and enter the rate for one period.</p></div><Button type="button" size="sm" variant="outline" className="rounded-full shrink-0" onClick={() => set('scheduled_changes', [...f.scheduled_changes, { at: '', basis: 'hour', value: '', applied: false }])} data-testid="button-add-rate-change"><Plus className="w-3.5 h-3.5 me-1" />Add rate</Button></div>
          {f.scheduled_changes.map((row, i) => <div key={i} className="rounded-xl bg-muted/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2"><Label className="text-xs">Change {i + 1}{row.applied ? ' · Already applied' : ''}</Label><Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => set('scheduled_changes', f.scheduled_changes.filter((_, j) => j !== i))} aria-label={`Remove scheduled rate ${i + 1}`}><X className="w-4 h-4" /></Button></div>
            <div><Label className="text-xs">Starts at</Label><Input type="datetime-local" disabled={row.applied} value={row.at} onChange={(e) => set('scheduled_changes', f.scheduled_changes.map((item, j) => j === i ? { ...item, at: e.target.value } : item))} className="rounded-xl mt-1" data-testid={`input-scheduled-at-${i}`} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Rate period</Label><Select disabled={row.applied} value={row.basis} onValueChange={(value) => { const basis=value as RateBasis; set('scheduled_changes', f.scheduled_changes.map((item, j) => { if (j !== i) return item; const oldRates=item.raw?.rates as R|undefined; return { ...item, basis, value: String(oldRates?.[basis] ?? item.value) }; })); }}><SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger><SelectContent>{(['minute', 'hour', 'day'] as const).map((basis) => <SelectItem key={basis} value={basis}>Per {basis}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Profit per {row.basis}</Label><Input type="text" inputMode="decimal" disabled={row.applied} value={row.value} onChange={(e) => set('scheduled_changes', f.scheduled_changes.map((item, j) => j === i ? { ...item, value: e.target.value } : item))} placeholder="e.g. 4.200" className="rounded-xl mt-1 num" data-testid={`input-scheduled-rate-${i}`} /></div>
            </div>
          </div>)}
          {scheduleErr && <p className="text-sm text-destructive" data-testid="text-schedule-error">Enter a valid start time and a non-negative amount with up to 3 decimal places for each scheduled rate.</p>}
        </div>
        {f.status === 'active' && !profitSetupValid && <p className="text-sm text-destructive">An active rental needs positive capital and a positive profit rate. Enter each amount with no more than 3 decimal places.</p>}
      </div>
      <div className="rounded-2xl border p-3 space-y-2">
        <div className="text-xs font-semibold">Specs</div>
        {f.specs.map(([k, v], i) => <div key={i} className="flex gap-2"><Input value={k} placeholder="Key" onChange={(e) => { const s = [...f.specs]; s[i] = [e.target.value, v]; set('specs', s); }} className="rounded-xl" /><Input value={v} placeholder="Value" onChange={(e) => { const s = [...f.specs]; s[i] = [k, e.target.value]; set('specs', s); }} className="rounded-xl" /><Button size="icon" variant="ghost" onClick={() => set('specs', f.specs.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button></div>)}
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => set('specs', [...f.specs, ['', '']])} data-testid="button-add-spec"><Plus className="w-3.5 h-3.5 me-1" />Spec</Button>
      </div>
      <div className="rounded-2xl border p-3 space-y-2">
        <div className="text-xs font-semibold">Images</div>
        <div className="flex gap-2 flex-wrap">{f.images.map((p) => <div key={p} className="relative w-20 h-16 rounded-xl overflow-hidden"><img src={fileUrl(p)} alt="" className="w-full h-full object-cover" /><button onClick={() => set('images', f.images.filter((x) => x !== p))} className="absolute top-0.5 end-0.5 bg-black/60 rounded-full p-0.5"><X className="w-3 h-3 text-white" /></button></div>)}</div>
        <FilePick value={img} onChange={(p) => { if (p) set('images', [...f.images, p]); setImg(''); }} accept="image/*" label="Upload image" testId="input-asset-image" />
      </div>
      <Button className="w-full rounded-full h-11" disabled={pending || scheduleErr || !f.title || (f.status === 'active' && !profitSetupValid)} onClick={save} data-testid="button-save-asset">Save asset</Button>
    </div>
  );
}

export function AdminAssets() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [edit, setEdit] = useState<R | null | 'new'>(null);
  return (
    <div>
      <AdminTitle title="Assets and profit schedules" action={<Button className="rounded-full" onClick={() => setEdit('new')} data-testid="button-new-asset"><Plus className="w-4 h-4 me-1.5" />New asset</Button>} />
      <DataTable testId="assets" rows={list(state.assets)} onRow={setEdit} exportType="assets"
        cols={[
          { key: 'title', label: 'Asset', render: (a) => <div className="flex items-center gap-3"><img src={assetImage(a)} alt="" className="w-12 h-9 rounded-lg object-cover" /><div><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">{a.type} · {a.category}</div></div></div> },
          { key: 'capital', label: 'Capital / unit', render: (a) => <span className="num text-xs">{a.profit_model_configured ? `${amount(a.capital_required)} ${a.currency}` : 'Not configured'}</span> },
          { key: 'rates', label: 'Profit / min · hr · day', render: (a) => <span className="num text-xs">{['minute', 'hour', 'day'].map((m) => ((a.rates as R)?.[m] != null ? amount((a.rates as R)[m]) : '—')).join(' / ')} {a.currency}</span> },
          { key: 'units', label: 'Units', render: (a) => <span className="num">{a.available_units}/{a.total_units}</span> },
          { key: 'status', label: 'Status', render: (a) => <StatusChip status={a.status} /> },
          { key: 'x', label: '', render: (a) => <Button size="icon" variant="ghost" className="rounded-full" disabled={pending} onClick={(e) => { e.stopPropagation(); p.open({ title: `Delete ${a.title}?`, danger: true, fields: [], ack: 'Active rentals must be stopped first. This cannot be undone.', confirm: 'Delete', onSubmit: async () => { await run('asset-delete', { id: a.id }, { success: 'Asset deleted' }); } }); }} data-testid={`button-delete-asset-${a.id}`}><Trash2 className="w-4 h-4" /></Button> },
        ]} />
      <ActionSheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'New asset' : `Edit ${(edit as R)?.title ?? ''}`}>{edit && <AssetEditor key={edit === 'new' ? 'new' : String((edit as R).id)} a={edit === 'new' ? null : (edit as R)} onDone={() => setEdit(null)} />}</ActionSheet>
      {p.node}
    </div>
  );
}

export function AdminRentals() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [status, setStatus] = useState('active');
  const rows = list(state.rentals).filter((r) => status === 'all' || r.status === status);
  return (
    <div>
      <AdminTitle title="Rentals" />
      <DataTable testId="rentals" rows={rows} exportType="rentals"
        toolbar={<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-36 rounded-full"><SelectValue /></SelectTrigger><SelectContent>{['all', 'active', 'paused', 'completed', 'cancelled', 'failed'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>}
        cols={[
          { key: 'asset_title', label: 'Asset' },
          { key: 'user', label: 'User', render: (r) => userLabel(state, r.user_id) },
          { key: 'mode', label: 'Profit schedule', render: (r) => <span className="num text-xs">{Number(r.rental_model_version) === 2 ? `${amount(r.rate_snapshot)} / ${r.billing_mode} × ${r.units}` : `Legacy fee ${amount(r.rate_snapshot)} / ${r.billing_mode} × ${r.units}`}</span> },
          { key: 'start', label: 'Start / end', render: (r) => <span className="text-xs">{when(r.start_at)}<br />{when(r.end_at)}</span> },
          { key: 'cost', label: 'Profit paid', render: (r) => <span className="num">{Number(r.rental_model_version) === 2 ? amount(r.profit_paid ?? r.total_cost) : amount(r.total_cost)}</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusChip status={r.status} /> },
          { key: 'auto', label: 'Auto', render: (r) => <Switch checked={!!r.auto_renew} disabled /> },
          { key: 'x', label: '', render: (r) => ['active', 'paused'].includes(String(r.status)) ? (
            <div className="flex gap-1">
              {Number(r.rental_model_version) !== 2 && r.status === 'paused' && (r.admin_paused || (r.data as R | undefined)?.admin_paused) && <Button size="icon" variant="ghost" title="Resume (paid remaining time is preserved)" disabled={pending} onClick={() => run('rental-resume', { id: r.id }, { success: 'Rental resumed' })} data-testid={`button-resume-${r.id}`}><Play className="w-4 h-4" /></Button>}
              {Number(r.rental_model_version) !== 2 && r.status === 'active' && <Button size="icon" variant="ghost" title="Pause" disabled={pending} onClick={() => run('rental-pause', { id: r.id }, { success: 'Rental paused' })} data-testid={`button-pause-${r.id}`}><Pause className="w-4 h-4" /></Button>}
              <Button size="icon" variant="ghost" title="Extend" disabled={pending} onClick={() => p.open({ title: 'Extend rental', fields: [{ key: 'duration', label: `Additional ${r.billing_mode}s`, required: true, type: 'number' }], onSubmit: async (v) => { return await run('rental-extend', { id: r.id, duration: Number(v.duration) }, { success: 'Extended' }); } })} data-testid={`button-extend-${r.id}`}><PlusCircle className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" title="Force stop" disabled={pending} onClick={() => p.open({ title: 'Force stop rental', danger: true, fields: [{key:'reason',label:'Reason for stopping',required:true,multiline:true}], ack: Number(r.rental_model_version) === 2 ? 'Release principal and settle prorated profit under the rental terms.' : 'Stop now and refund per legacy billing rules.', onSubmit: async (v) => { return await run('rental-stop', { id: r.id,reason:v.reason }, { success: 'Stopped' }); } })} data-testid={`button-stop-${r.id}`}><Square className="w-4 h-4 text-destructive" /></Button>
            </div>) : null },
        ]} />
      {p.node}
    </div>
  );
}
