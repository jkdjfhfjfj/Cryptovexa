import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Save, PlugZap, Send, Plus, Trash2, CheckCircle2, CircleDashed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { list, useRun } from '@/lib/platform';
import { fileUrl, type R } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import { FilePick, CoinIcon, ActionSheet } from '@/components/app/kit';
import { cn } from '@/lib/utils';
import { useAdmin, AdminTitle, DataTable } from './shell';
import { Section } from './parts';

type F = { k: string; label: string; t: 'text' | 'number' | 'bool' | 'select' | 'secret' | 'image' | 'textarea' | 'color' | 'list'; opts?: string[]; hint?: string };
const SECTIONS: Record<string, { title: string; fields: F[] }> = {
  general: { title: 'General', fields: [{ k: 'site_name', label: 'Site name', t: 'text' }, { k: 'short_name', label: 'Short name', t: 'text' }, { k: 'maintenance', label: 'Maintenance mode', t: 'bool' }, { k: 'support_email', label: 'Support email', t: 'text' }] },
  branding: { title: 'Branding', fields: [{ k: 'brand_color', label: 'Brand color', t: 'color' }, { k: 'logo', label: 'Logo (512px PNG/SVG)', t: 'image' }, { k: 'favicon', label: 'Favicon', t: 'image' }, { k: 'app_icon', label: 'App icon (PWA)', t: 'image' }] },
  security: { title: 'Security', fields: [{ k: 'twofa_mode', label: 'User 2FA', t: 'select', opts: ['off', 'optional', 'required'] }, { k: 'admin_twofa_mode', label: 'Admin 2FA', t: 'select', opts: ['off', 'optional', 'required'] }, { k: 'api_keys_enabled', label: 'User API keys', t: 'bool' }, { k: 'registration_mode', label: 'Registration', t: 'select', opts: ['open', 'invite-only', 'closed'] }, { k: 'email_verification_required', label: 'Require email verification', t: 'bool' }, { k: 'deposit_txid_required', label: 'Require TXID on deposits', t: 'bool' }, { k: 'captcha_enabled', label: 'Turnstile CAPTCHA on sign-in and sign-up', t: 'bool' }, { k: 'captcha_site_key', label: 'Turnstile site key', t: 'text' }, { k: 'captcha_secret', label: 'Turnstile secret key', t: 'secret' }, { k: 'login_lockout_attempts', label: 'Lockout after failed logins', t: 'number' }] },
  billing: { title: 'Billing', fields: [{ k: 'proration', label: 'Prorate early stops', t: 'bool' }, { k: 'early_stop_penalty_percent', label: 'Early-stop penalty %', t: 'number' }, { k: 'grace_period_minutes', label: 'Grace period (minutes)', t: 'number' }, { k: 'minimum_charge', label: 'Minimum charge', t: 'number' }, { k: 'low_balance_threshold', label: 'Low balance threshold', t: 'number' }] },
  withdrawal_rules: { title: 'Withdrawal rules', fields: [{ k: 'auto_threshold', label: 'Auto-process up to (USD)', t: 'number' }, { k: 'daily_limit_user', label: 'Daily limit per user (USD)', t: 'number' }, { k: 'daily_limit_global', label: 'Global daily limit (USD)', t: 'number' }, { k: 'new_address_cooldown_hours', label: 'New address cooldown (hours)', t: 'number' }, { k: 'large_alert_threshold', label: 'Large withdrawal alert (USD)', t: 'number' }, { k: 'kyc_required', label: 'Require approved KYC', t: 'bool' }, { k: 'address_blacklist', label: 'Address blacklist (one per line)', t: 'list' }] },
  notifications: { title: 'Admin notifications', fields: [{ k: 'deposit_alert_emails', label: 'Pending deposit alerts to', t: 'text', hint: 'emails' }, { k: 'withdrawal_alert_emails', label: 'Withdrawal alerts to', t: 'text', hint: 'emails' }, { k: 'ticket_alert_emails', label: 'New ticket alerts to', t: 'text', hint: 'emails' }, { k: 'kyc_alert_emails', label: 'KYC alerts to', t: 'text', hint: 'emails' }, { k: 'reconcile_alert_emails', label: 'Reconciliation alerts to', t: 'text', hint: 'emails' }, { k: 'telegram_chat_id', label: 'Telegram chat ID', t: 'text' }, { k: 'telegram_bot_token', label: 'Telegram bot token', t: 'secret' }] },
  smtp: { title: 'SMTP', fields: [{ k: 'host', label: 'Host', t: 'text' }, { k: 'port', label: 'Port', t: 'number' }, { k: 'username', label: 'Username', t: 'text' }, { k: 'password', label: 'Password', t: 'secret' }, { k: 'tls', label: 'TLS', t: 'bool' }, { k: 'from_name', label: 'From name', t: 'text' }, { k: 'from_email', label: 'From email', t: 'text' }] },
  binance: { title: 'Binance', fields: [{ k: 'api_key', label: 'API key', t: 'secret' }, { k: 'api_secret', label: 'API secret', t: 'secret' }, { k: 'force_manual', label: 'Force manual withdrawals', t: 'bool' }, { k: 'deposit_hints', label: 'Deposit hint polling', t: 'bool' }] },
};

function SectionForm({ section }: { section: string }) {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const cfg = SECTIONS[section];
  const settings = (state.settings as R) || {};
  const src = ((settings[section] as R) || (section === 'general' || section === 'branding' ? settings : {})) as R;
  const [v, setV] = useState<R>({});
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const init: R = {};
    cfg.fields.forEach((f) => { if (f.t !== 'secret') init[f.k] = f.hint === 'emails' ? (Array.isArray(src[f.k]) ? src[f.k].join(', ') : String(src[f.k] ?? '')) : f.t === 'list' ? (Array.isArray(src[f.k]) ? src[f.k].join('\n') : src[f.k] ?? '') : src[f.k] ?? (f.t === 'bool' ? false : ''); });
    setV(init);
  }, [section, JSON.stringify(src)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const values: R = {};
    const invalid: string[] = [];
    cfg.fields.forEach((f) => {
      const x = v[f.k];
      if (f.t === 'secret') { if (x) values[f.k] = x; return; }
      if (f.hint === 'emails') {
        const bad = String(x || '').split(/[,\n]/).map((s) => s.trim()).filter((s) => s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
        if (bad.length) invalid.push(`Invalid email: ${bad[0]}`);
      }
      if (f.t === 'number' && (x === '' || x == null)) return;
      values[f.k] = f.t === 'number' ? String(x) : f.t === 'list' ? String(x || '').split('\n').map((s) => s.trim()).filter(Boolean) : x;
    });
    if (invalid.length) { setErr(invalid[0]); return; }
    setErr('');
    if (section === 'security' && values.captcha_enabled && (!values.captcha_site_key || (!values.captcha_secret && !src.captcha_secret_configured))) { setErr('Enabling Turnstile needs both the site key and the secret key (enter the secret in this same save if it is not configured).'); return; }
    run('settings-save', { section, values }, { success: `${cfg.title} saved`, onSuccess: () => setV((o) => Object.fromEntries(Object.entries(o).filter(([k]) => cfg.fields.find((f) => f.k === k)?.t !== 'secret'))) });
  };

  return (
    <Section title={cfg.title} action={<Button className="rounded-full" disabled={pending} onClick={save} data-testid={`button-save-${section}`}><Save className="w-4 h-4 me-1.5" />Save</Button>}>
      <div className="grid md:grid-cols-2 gap-4">
        {cfg.fields.map((f) => {
          const configured = src[`${f.k}_configured`];
          return (
            <div key={f.k} className={cn(f.t === 'list' || f.t === 'textarea' ? 'md:col-span-2' : '')}>
              {f.t === 'bool' ? (
                <label className="flex items-center justify-between rounded-2xl border p-3 text-sm h-full">{f.label}<Switch checked={!!v[f.k]} onCheckedChange={(x) => setV({ ...v, [f.k]: x })} data-testid={`switch-${section}-${f.k}`} /></label>
              ) : (
                <>
                  <Label className="text-xs flex items-center gap-1.5">{f.label}{f.t === 'secret' && (configured ? <span className="text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" />configured</span> : <span className="text-muted-foreground flex items-center gap-0.5"><CircleDashed className="w-3 h-3" />not set</span>)}</Label>
                  <div className="mt-1">
                    {f.t === 'select' ? <Select value={String(v[f.k] || '')} onValueChange={(x) => setV({ ...v, [f.k]: x })}><SelectTrigger className="rounded-xl" data-testid={`select-${section}-${f.k}`}><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{f.opts!.map((o) => <SelectItem key={o} value={o}>{titleCase(o)}</SelectItem>)}</SelectContent></Select>
                      : f.t === 'list' || f.t === 'textarea' ? <Textarea rows={4} value={String(v[f.k] ?? '')} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} className="rounded-xl font-mono text-xs" data-testid={`input-${section}-${f.k}`} />
                      : f.t === 'image' ? <div className="flex items-center gap-3">{v[f.k] && <img src={fileUrl(String(v[f.k]))} alt="" className="w-12 h-12 rounded-xl object-contain border bg-muted" />}<div className="flex-1"><FilePick value={String(v[f.k] || '')} onChange={(p) => setV({ ...v, [f.k]: p ? fileUrl(p) : '' })} accept="image/*" label="Upload" testId={`input-${section}-${f.k}`} /></div></div>
                      : f.t === 'color' ? <div className="flex gap-2"><input type="color" value={String(v[f.k] || '#14B8A6')} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} className="h-10 w-14 rounded-xl border bg-transparent" /><Input value={String(v[f.k] || '')} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} className="rounded-xl font-mono" data-testid={`input-${section}-${f.k}`} /></div>
                      : <Input type={f.t === 'secret' ? 'password' : f.t === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={f.t === 'secret' ? (configured ? 'Leave blank to keep current value' : 'Enter value') : ''} value={String(v[f.k] ?? '')} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} className="rounded-xl" data-testid={`input-${section}-${f.k}`} />}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="text-sm text-destructive mt-3" data-testid="text-settings-error">{err}</p>}
      {section === 'notifications' && <p className="text-xs text-muted-foreground mt-3">Telegram alerts are optional and delivered through the background queue once both chat ID and bot token are set.</p>}
      {section === 'smtp' && <div className="flex gap-2 mt-4"><Input placeholder="Send test to" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-full max-w-xs" data-testid="input-smtp-test" /><Button variant="outline" className="rounded-full" disabled={pending || !to} onClick={() => run('email-test', { to }, { success: 'Test email sent' })} data-testid="button-smtp-test"><Send className="w-4 h-4 me-1.5" />Send test</Button></div>}
      {section === 'binance' && <Button variant="outline" className="rounded-full mt-4" disabled={pending} onClick={() => run('binance-test', {})} data-testid="button-binance-test-settings"><PlugZap className="w-4 h-4 me-1.5" />Test connection</Button>}
    </Section>
  );
}

function TermsForm() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const [lang, setLang] = useState('en');
  const terms = ((state.settings as R)?.terms as R) || {};
  const cur = (terms[lang] as R) || (lang === 'en' ? terms : {});
  const [v, setV] = useState({ deposit: '', withdrawal: '' });
  useEffect(() => setV({ deposit: String(cur.deposit ?? cur.deposit_terms ?? ''), withdrawal: String(cur.withdrawal ?? cur.withdrawal_terms ?? '') }), [lang, JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Section title="Deposit and withdrawal terms" action={<div className="flex gap-2"><Select value={lang} onValueChange={setLang}><SelectTrigger className="w-32 rounded-full"><SelectValue /></SelectTrigger><SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent></Select><Button className="rounded-full" disabled={pending} onClick={() => run('settings-save', { section: 'terms', values: { ...terms, [lang]: v } }, { success: 'Terms saved' })} data-testid="button-save-terms"><Save className="w-4 h-4 me-1.5" />Save</Button></div>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div><Label className="text-xs">Deposit terms</Label><Textarea rows={8} value={v.deposit} onChange={(e) => setV({ ...v, deposit: e.target.value })} className="rounded-xl mt-1" data-testid="input-terms-deposit" /></div>
        <div><Label className="text-xs">Withdrawal terms</Label><Textarea rows={8} value={v.withdrawal} onChange={(e) => setV({ ...v, withdrawal: e.target.value })} className="rounded-xl mt-1" data-testid="input-terms-withdrawal" /></div>
      </div>
    </Section>
  );
}

function CurrencyEditor({ c, onDone }: { c: R; onDone: () => void }) {
  const { run, pending } = useRun('admin');
  const [f, setF] = useState<R>(() => ({ ...c, networks: list(c.networks).map((n) => ({ ...n })) }));
  const nets = f.networks as R[];
  const setNet = (i: number, k: string, val: unknown) => { const n = [...nets]; n[i] = { ...n[i], [k]: val }; setF({ ...f, networks: n }); };
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between text-sm rounded-2xl border p-3">Enabled<Switch checked={f.enabled !== false} onCheckedChange={(v) => setF({ ...f, enabled: v })} /></label>
      <div className="grid grid-cols-2 gap-2">{[['min_deposit', 'Min deposit'], ['min_withdraw', 'Min withdraw'], ['max_withdraw', 'Max withdraw'], ['fee', 'Withdraw fee']].map(([k, l]) => <div key={k}><Label className="text-xs">{l}</Label><Input value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1 num" data-testid={`input-cur-${k}`} /></div>)}</div>
      <div><Label className="text-xs">Fee type</Label><Select value={String(f.fee_type || 'flat')} onValueChange={(v) => setF({ ...f, fee_type: v })}><SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="flat">Flat</SelectItem><SelectItem value="percent">Percent</SelectItem></SelectContent></Select></div>
      <div className="text-xs font-semibold pt-2">Networks and deposit addresses</div>
      {nets.map((n, i) => (
        <div key={i} className="rounded-2xl border p-3 space-y-2">
          <div className="flex gap-2"><Input placeholder="Network (e.g. TRC20)" value={String(n.name || '')} onChange={(e) => setNet(i, 'name', e.target.value)} className="rounded-xl" /><Switch checked={n.enabled !== false} onCheckedChange={(v) => setNet(i, 'enabled', v)} className="mt-2" /><Button size="icon" variant="ghost" onClick={() => setF({ ...f, networks: nets.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button></div>
          <Input placeholder="Deposit address" value={String(n.address || '')} onChange={(e) => setNet(i, 'address', e.target.value)} className="rounded-xl font-mono text-xs" />
          <div className="grid grid-cols-2 gap-2"><Input placeholder="Memo / tag" value={String(n.memo || '')} onChange={(e) => setNet(i, 'memo', e.target.value)} className="rounded-xl" /><Input placeholder="Confirmations" type="number" value={String(n.confirmations ?? '')} onChange={(e) => setNet(i, 'confirmations', e.target.value)} className="rounded-xl" /></div>
          <label className="flex items-center justify-between text-xs rounded-xl border px-3 py-2">Memo / tag required for deposits<Switch checked={!!n.memo_required} onCheckedChange={(v) => setNet(i, 'memo_required', v)} data-testid={`switch-net-memo-required-${i}`} /></label>
          <Input placeholder="Address regex" value={String(n.address_regex || '')} onChange={(e) => setNet(i, 'address_regex', e.target.value)} className="rounded-xl font-mono text-xs" />
          <Textarea placeholder="Fallback addresses, one per line" rows={2} value={Array.isArray(n.fallback_addresses) ? n.fallback_addresses.join('\n') : String(n.fallback_addresses || '')} onChange={(e) => setNet(i, 'fallback_addresses', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} className="rounded-xl font-mono text-xs" />
        </div>
      ))}
      <Button size="sm" variant="outline" className="rounded-full" onClick={() => setF({ ...f, networks: [...nets, { name: '', enabled: true, address: '' }] })} data-testid="button-add-network"><Plus className="w-3.5 h-3.5 me-1" />Network</Button>
      <Button className="w-full rounded-full" disabled={pending} onClick={() => run('currency-save', f, { success: `${f.code} saved`, onSuccess: onDone })} data-testid="button-save-currency">Save {String(f.code)}</Button>
    </div>
  );
}

function Currencies() {
  const { state } = useAdmin();
  const [sel, setSel] = useState<R | null>(null);
  return (
    <>
      <DataTable testId="currencies" search={false} rows={list(state.currencies)} onRow={setSel} cols={[
        { key: 'code', label: 'Coin', render: (c) => <span className="flex items-center gap-2 font-semibold"><CoinIcon code={String(c.code)} size={22} />{c.code}</span> },
        { key: 'enabled', label: 'Enabled', render: (c) => (c.enabled !== false ? 'Yes' : 'No') },
        { key: 'networks', label: 'Networks', render: (c) => list(c.networks).map((n) => `${n.name}${n.address ? '' : ' (no address)'}`).join(', ') },
        { key: 'limits', label: 'Min dep / wd', render: (c) => <span className="num text-xs">{String(c.min_deposit ?? '—')} / {String(c.min_withdraw ?? '—')}</span> },
      ]} />
      <ActionSheet open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={`${sel?.code ?? ''} configuration`}>{sel && <CurrencyEditor key={String(sel.code)} c={sel} onDone={() => setSel(null)} />}</ActionSheet>
    </>
  );
}

function Admins() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const [f, setF] = useState({ email: '', password: '', role: 'support' });
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      <DataTable testId="admins" search={false} rows={list(state.admins)} cols={[{ key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'status', label: 'Status' }, { key: 'twofa_enabled', label: '2FA', render: (a) => (a.twofa_enabled ? 'On' : 'Off') }]} empty="Admin list not provided by workspace." />
      <Section title="Add or update staff">
        <div className="space-y-2">
          <Input placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="rounded-xl" data-testid="input-admin-new-email" />
          <Input type="password" placeholder="Password (12+ chars)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="rounded-xl" data-testid="input-admin-new-password" />
          <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{['superadmin', 'finance', 'support'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
          <Button className="w-full rounded-full" disabled={pending || !f.email || f.password.length < 12} onClick={() => run('admin-save', f, { success: 'Staff account saved', onSuccess: () => setF({ email: '', password: '', role: 'support' }) })} data-testid="button-save-admin">Save</Button>
        </div>
      </Section>
    </div>
  );
}

const TABS = ['general', 'branding', 'security', 'billing', 'withdrawal_rules', 'notifications', 'smtp', 'binance', 'currencies', 'terms', 'referral_config', 'translations', 'staff'];

export default function AdminSettings() {
  const [tab, setTab] = useState('general');
  return (
    <div>
      <AdminTitle title="Settings" sub="Secrets are encrypted at rest and never returned. Only their status is shown." />
      <div className="grid lg:grid-cols-[220px_1fr] gap-5">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar">{TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={cn('shrink-0 text-start rounded-xl px-3 py-2 text-sm', tab === t ? 'bg-accent text-accent-foreground font-semibold' : 'hover:bg-muted text-muted-foreground')} data-testid={`settings-tab-${t}`}>{titleCase(t)}</button>)}</nav>
        <div>
          {SECTIONS[tab] && <SectionForm key={tab} section={tab} />}
          {tab === 'currencies' && <Currencies />}
          {tab === 'terms' && <TermsForm />}
          {tab === 'staff' && <Admins />}
          {tab === 'referral_config' && <Section title="Referral program"><p className="text-sm text-muted-foreground">Levels, percentages, triggers and caps are edited alongside referral reports. <Link href="/admin/referrals" className="text-primary underline">Open referral settings</Link></p></Section>}
          {tab === 'translations' && <Section title="Translations"><p className="text-sm text-muted-foreground">Per-language UI strings live in the content editor. <Link href="/admin/content" className="text-primary underline">Open translation editor</Link></p></Section>}
        </div>
      </div>
    </div>
  );
}
