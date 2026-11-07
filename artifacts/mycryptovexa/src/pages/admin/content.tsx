import { useEffect, useMemo, useState } from 'react';
import { Save, Send, RotateCcw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { adminAction } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { list, useRun, usePlatform } from '@/lib/platform';
import { adminExportUrl, csrfOpts, errorMessage, type R } from '@/lib/api';
import { when, amount, titleCase, D, Decimal } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import i18n from '@/lib/i18n';
import { StatusChip, Stat } from '@/components/app/kit';
import { useAdmin, DataTable, AdminTitle } from './shell';
import { Section } from './parts';
import { RichTextEditor } from '@/components/app/rich-text-editor';

const LEGAL_KEYS = ['terms', 'privacy', 'risk', 'deposit_terms', 'withdrawal_terms'];

function LangSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="w-36 rounded-full" data-testid="select-lang"><SelectValue /></SelectTrigger><SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent></Select>;
}

export function AdminContent() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const [key, setKey] = useState('terms');
  const [lang, setLang] = useState('en');
  const page = list(state.legalPages).find((p) => p.key === key && (p.language || 'en') === lang);
  const [body, setBody] = useState('');
  useEffect(() => setBody(String(page?.body || '')), [key, lang, page?.body]);
  const [tLang, setTLang] = useState('es');
  const [q, setQ] = useState('');
  const base = i18n.getResourceBundle('en', 'translation') as Record<string, string>;
  const overrides = ((state.settings as R)?.translations as R)?.[tLang] as Record<string, string> | undefined;
  const current = i18n.getResourceBundle(tLang, 'translation') as Record<string, string>;
  const [tr, setTr] = useState<Record<string, string>>({});
  useEffect(() => setTr({ ...current, ...(overrides || {}) }), [tLang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <AdminTitle title="Content" />
      <Tabs defaultValue="legal">
        <TabsList className="rounded-full mb-4"><TabsTrigger value="legal" className="rounded-full">Legal pages</TabsTrigger><TabsTrigger value="translations" className="rounded-full">Translations</TabsTrigger></TabsList>
        <TabsContent value="legal">
          <div className="flex flex-wrap gap-2 mb-3">{LEGAL_KEYS.map((k) => <button key={k} onClick={() => setKey(k)} className={`rounded-full border px-4 py-1.5 text-sm ${key === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`} data-testid={`button-legal-${k}`}>{titleCase(k)}</button>)}<span className="ms-auto"><LangSelect value={lang} onChange={setLang} /></span></div>
          <div className="grid xl:grid-cols-2 gap-4">
            <Section title="Editor"><RichTextEditor id="legal-body" testId="input-legal-body" label={`${titleCase(key)} (${lang})`} value={body} onChange={setBody} minHeight={420} /><Button className="rounded-full mt-3" disabled={pending} onClick={() => run('legal-save', { key, language: lang, body }, { success: 'Legal page saved' })} data-testid="button-save-legal"><Save className="w-4 h-4 me-1.5" />Save</Button></Section>
            <Section title="Preview"><iframe title="Legal page preview" sandbox="" srcDoc={body} className="w-full min-h-80 rounded-xl bg-white" /></Section>
          </div>
        </TabsContent>
        <TabsContent value="translations">
          <div className="flex gap-2 mb-3"><LangSelect value={tLang} onChange={setTLang} /><Input placeholder="Filter keys" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 rounded-full" /><Button className="rounded-full ms-auto" disabled={pending} onClick={() => run('settings-save', { section: 'translations', values: { ...((state.settings as R)?.translations as R), [tLang]: tr } }, { success: 'Translations saved', onSuccess: () => i18n.addResourceBundle(tLang, 'translation', tr, true, true) })} data-testid="button-save-translations"><Save className="w-4 h-4 me-1.5" />Save</Button></div>
          <div className="rounded-3xl border bg-card divide-y">{Object.keys(base).filter((k) => !q || k.includes(q) || base[k].toLowerCase().includes(q.toLowerCase())).map((k) => (
            <div key={k} className="grid md:grid-cols-[180px_1fr_1fr] gap-2 p-3 items-center text-sm"><code className="text-xs">{k}</code><span className="text-muted-foreground">{base[k]}</span><Input value={tr[k] ?? ''} onChange={(e) => setTr({ ...tr, [k]: e.target.value })} className="rounded-xl" dir={tLang === 'ar' ? 'rtl' : 'ltr'} data-testid={`input-tr-${k}`} /></div>
          ))}</div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const VARS = ['{{site_name}}', '{{username}}', '{{title}}', '{{body}}', '{{amount}}', '{{currency}}', '{{link}}', '{{code}}', '{{txid}}', '{{reason}}', '{{logo_url}}', '{{support_email}}', '{{site_url}}', '{{year}}'];

export function AdminEmails() {
  const { state } = useAdmin();
  const { brand } = usePlatform();
  const { run, pending } = useRun('admin');
  const temps = list(state.emailTemplates);
  const keys = useMemo(() => Array.from(new Set(temps.map((t) => String(t.key)))), [temps]);
  const settings = (state.settings as R) || {};
  const smtp = (settings.smtp as R) || {};
  const [key, setKey] = useState('');
  const [lang, setLang] = useState('en');
  const [f, setF] = useState({ subject: '', body_html: '' });
  const [to, setTo] = useState('');
  const k = key || keys[0] || '';
  const t = temps.find((x) => x.key === k && (x.language || 'en') === lang);
  useEffect(() => setF({ subject: String(t?.subject || ''), body_html: String(t?.body_html || '') }), [k, lang, t?.subject, t?.body_html]);
  const safeText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const configuredUrl = String(smtp.public_url || (typeof window !== 'undefined' ? window.location.origin : ''));
  const baseUrl = /^https:\/\//i.test(configuredUrl) ? configuredUrl.replace(/\/$/, '') : '';
  const configuredLogo = String(smtp.email_logo_url || '');
  const logoUrl = /^https:\/\//i.test(configuredLogo) ? configuredLogo : baseUrl ? `${baseUrl}/icon-192.png` : '/icon-192.png';
  const supportEmail = String(settings.support_email || '');
  const previewValues: R = {
    site_name: brand.name, username: 'Amara', title: 'Your account update',
    body: 'This is a preview of the branded email template and its account details.',
    amount: '125.40', currency: 'USDT', link: baseUrl ? `${baseUrl}/account` : '#',
    code: '123456', txid: '0x1234…', reason: 'Preview only',
    logo_url: logoUrl, support_email: supportEmail, site_url: baseUrl,
    year: String(new Date().getFullYear()),
  };
  const previewBody = f.body_html.replace(/{{\s*([\w]+)\s*}}/g, (_match, token: string) => safeText(previewValues[token]));
  const previewSubject = f.subject.replace(/{{\s*([\w]+)\s*}}/g, (_match, token: string) => String(previewValues[token] ?? ''));
  const accent = /^#[\da-f]{6}$/i.test(String(settings.brand_color || '')) ? String(settings.brand_color) : '#14b8a6';
  const supportFooter = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)
    ? `Contact <a href="mailto:${safeText(supportEmail)}" style="color:#0f766e">${safeText(supportEmail)}</a>.`
    : 'Reply to this email for help.';
  const preview = `<!doctype html><html><body style="margin:0;padding:20px;background:#f1f5f9;font-family:Arial,sans-serif;color:#152238"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #dbe4ee;border-radius:16px;overflow:hidden"><tr><td style="padding:20px 26px;background:#0b1a2e"><img src="${safeText(logoUrl)}" alt="${safeText(brand.name)}" width="44" height="44" style="vertical-align:middle;border-radius:10px"><span style="padding-left:12px;color:#fff;font-size:19px;font-weight:bold">${safeText(brand.name)}</span></td></tr><tr><td style="padding:28px;font-size:14px;line-height:1.7">${previewBody}<p><a href="${safeText(previewValues.link)}" style="display:inline-block;padding:12px 20px;background:${accent};border-radius:8px;color:#06101d;text-decoration:none;font-weight:bold">Open your account</a></p></td></tr><tr><td style="padding:18px 26px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px">${supportFooter}<p>© ${previewValues.year} ${safeText(brand.name)}. This is an operational message from ${safeText(brand.name)}.</p></td></tr></table></body></html>`;

  return (
    <div>
      <AdminTitle title="Emails" action={<div className="flex gap-2"><Input placeholder="test@yourdomain.com" value={to} onChange={(e) => setTo(e.target.value)} className="w-56 rounded-full" data-testid="input-test-to" /><Button variant="outline" className="rounded-full" disabled={pending || !to} onClick={() => run('email-test', { to }, { success: 'Test email queued' })} data-testid="button-email-test"><Send className="w-4 h-4 me-1.5" />Send test</Button></div>} />
      <Tabs defaultValue="templates">
        <TabsList className="rounded-full mb-4"><TabsTrigger value="templates" className="rounded-full">Templates</TabsTrigger><TabsTrigger value="log" className="rounded-full">Delivery log</TabsTrigger></TabsList>
        <TabsContent value="templates">
          <div className="grid xl:grid-cols-[240px_1fr_1fr] gap-4">
            <div className="rounded-3xl border bg-card p-2 max-h-[70vh] overflow-y-auto">{keys.length ? keys.map((x) => <button key={x} onClick={() => setKey(x)} className={`w-full text-start rounded-xl px-3 py-2 text-sm ${x === k ? 'bg-accent font-semibold' : 'hover:bg-muted'}`} data-testid={`button-template-${x}`}>{titleCase(x)}</button>) : <p className="p-3 text-sm text-muted-foreground">No templates seeded.</p>}</div>
            <Section title={titleCase(k) || 'Template'} action={<LangSelect value={lang} onChange={setLang} />}>
              <div className="space-y-3">
                <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Subject" className="rounded-xl" data-testid="input-template-subject" />
                <Label htmlFor="template-body" className="text-xs flex items-center justify-between"><span>Email body: HTML source only</span><span className="font-normal text-muted-foreground">Source editing, no visual editor.</span></Label>
                <Textarea id="template-body" aria-describedby="template-body-note" rows={16} value={f.body_html} onChange={(e) => setF({ ...f, body_html: e.target.value })} className="rounded-xl font-mono text-xs" data-testid="input-template-body" />
                <p id="template-body-note" className="text-[11px] text-muted-foreground">Template variables and supported HTML are retained. Unsafe or unsupported tags and attributes, including inline styles, are removed server-side on save. The preview shows your submitted draft; the saved, server-sanitized output may differ until reload. Click a variable to append it.</p>
                <div className="flex gap-1 flex-wrap">{VARS.map((v) => <button key={v} onClick={() => setF({ ...f, body_html: f.body_html + v })} className="text-[11px] font-mono rounded-full border px-2 py-0.5 hover:bg-muted">{v}</button>)}</div>
                <Button className="rounded-full" disabled={pending || !k} onClick={() => run('email-template-save', { key: k, language: lang, subject: f.subject, body_html: f.body_html }, { success: 'Template saved' })} data-testid="button-save-template"><Save className="w-4 h-4 me-1.5" />Save</Button>
              </div>
            </Section>
            <Section title="Branded email preview"><div className="rounded-2xl overflow-hidden border bg-[#f4f7fa]"><div className="p-4 text-[#0B1A2E] text-sm"><div className="font-semibold mb-2">{previewSubject}</div><iframe title="Email template preview" sandbox="" srcDoc={preview} className="w-full min-h-80 bg-white rounded-lg" /></div></div></Section>
          </div>
        </TabsContent>
        <TabsContent value="log">
          <DataTable testId="email-logs" rows={list(state.emailLogs)} exportType="email_logs" cols={[
            { key: 'to', label: 'To' }, { key: 'template', label: 'Template' },
            { key: 'status', label: 'Status', render: (l) => <StatusChip status={l.status} /> },
            { key: 'attempts', label: 'Tries' }, { key: 'error', label: 'Error', render: (l) => <span className="text-xs text-destructive">{String(l.error || '')}</span> },
            { key: 'sent_at', label: 'Sent', render: (l) => when(l.sent_at || l.created_at) },
            { key: 'x', label: '', render: (l) => l.status === 'failed' ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run('email-test', { to: l.to, resend_log_id: l.id }, { success: 'Resend queued' })}><RotateCcw className="w-3.5 h-3.5" /></Button> : null },
          ]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function AdminLogs() {
  const { state } = useAdmin();
  const [tab, setTab] = useState('audit');
  const sets: Record<string, R[]> = { audit: list(state.auditLogs), login: list(state.loginLogs), email: list(state.emailLogs), worker: list(state.workerLogs), error: list(state.errorLogs) };
  return (
    <div>
      <AdminTitle title="Logs" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-full mb-4 overflow-x-auto no-scrollbar max-w-full justify-start">{Object.keys(sets).map((k) => <TabsTrigger key={k} value={k} className="rounded-full" data-testid={`tab-log-${k}`}>{titleCase(k)}</TabsTrigger>)}</TabsList>
        {Object.entries(sets).map(([k, rows]) => (
          <TabsContent key={k} value={k}>
            <DataTable testId={`log-${k}`} rows={rows} exportType={`${k}_logs`} cols={[
              { key: 'created_at', label: 'Time', render: (r) => <span className="text-xs whitespace-nowrap">{when(r.created_at || r.sent_at)}</span> },
              { key: 'actor', label: 'Actor', render: (r) => String(r.actor_email || r.actor_id || r.to || r.user_id || '—') },
              { key: 'action', label: 'Event', render: (r) => <span className="font-medium">{String(r.action || r.template || r.event || r.status || '—')}</span> },
              { key: 'entity', label: 'Entity', render: (r) => <span className="text-xs">{String(r.entity || '')} {r.entity_id ? String(r.entity_id).slice(0, 10) : ''}</span> },
              { key: 'ip', label: 'IP' },
              { key: 'meta', label: 'Detail', render: (r) => <code className="text-[10px] line-clamp-2 max-w-xs block">{r.meta_json ? JSON.stringify(r.meta_json) : String(r.error || r.message || '')}</code> },
            ]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export function AdminReports() {
  const { state } = useAdmin();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const reconcile = async () => {
    setBusy(true);
    try { const r = await adminAction('reconcile', { request_id: crypto.randomUUID() }, csrfOpts()) as R; toast({ title: r?.message || 'Reconciliation complete' }); await qc.invalidateQueries(); }
    catch (e) { toast({ title: 'Reconciliation failed', description: errorMessage(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const s = (state.stats as R) || {};
  const totals = list(s.ledger_totals ?? s.ledgerTotals);
  const recon = (s.reconciliation as R) || {};
  // Decimal sums; converted to number only for chart rendering
  const sumBy = (rows: R[], f: string, k: string) => Object.entries(rows.reduce<Record<string, Decimal>>((a, r) => { a[String(r.currency)] = (a[String(r.currency)] || D(0)).plus(D(r[f])); return a; }, {})).map(([currency, v]) => ({ currency, [k]: v.toNumber(), [`${k}_exact`]: v.toFixed() }));
  const dep = sumBy(list(state.deposits).filter((d) => d.status === 'approved'), 'amount_credited', 'deposits');
  const wd = sumBy(list(state.withdrawals).filter((w) => w.status === 'sent'), 'amount', 'withdrawals');
  const merged = Array.from(new Set([...dep, ...wd].map((x) => x.currency))).map((c) => ({ currency: c, deposits: dep.find((x) => x.currency === c)?.deposits || 0, withdrawals: wd.find((x) => x.currency === c)?.withdrawals || 0 }));
  return (
    <div className="space-y-5">
      <AdminTitle title="Reports" action={<Button variant="outline" className="rounded-full" disabled={busy} onClick={reconcile} data-testid="button-run-reconcile">Run reconciliation</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Approved deposits" value={list(state.deposits).filter((d) => d.status === 'approved').length} />
        <Stat label="Sent withdrawals" value={list(state.withdrawals).filter((w) => w.status === 'sent').length} />
        <Stat label="Completed rentals" value={list(state.rentals).filter((r) => r.status === 'completed').length} />
        <Stat label="Reconciliation" value={recon.status ? titleCase(String(recon.status)) : 'Not run'} hint={recon.checked_at ? when(recon.checked_at) : undefined} />
      </div>
      <Section title="Flow by currency (approved deposits vs sent withdrawals)">
        <div className="h-64"><ResponsiveContainer><BarChart data={merged}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="currency" fontSize={11} /><YAxis fontSize={11} /><Tooltip contentStyle={{ borderRadius: 12, background: 'hsl(var(--popover))' }} /><Bar dataKey="deposits" fill="#14B8A6" radius={[6, 6, 0, 0]} /><Bar dataKey="withdrawals" fill="#0B1A2E" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </Section>
      {totals.length > 0 && <Section title="Ledger totals"><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">{totals.map((t) => <div key={String(t.currency)} className="rounded-2xl border p-3"><div className="text-xs text-muted-foreground">{t.currency}</div><div className="num font-semibold">{amount(t.total ?? t.sum)}</div>{t.mismatch && <div className="text-xs text-destructive">Mismatch {amount(t.mismatch)}</div>}</div>)}</div></Section>}
      <Section title="Exports">
        <a href="/api/admin/backup" className="inline-flex rounded-full border px-4 py-2 text-sm hover:bg-muted mb-3">Export platform data backup</a>
        <div className="flex flex-wrap gap-2">{['deposits', 'withdrawals', 'rentals', 'ledger', 'revenue', 'commissions', 'users'].map((k) => <a key={k} href={adminExportUrl(k)} className="rounded-full border px-4 py-2 text-sm hover:bg-muted" data-testid={`link-export-${k}`}>{titleCase(k)} CSV</a>)}</div>
      </Section>
    </div>
  );
}
