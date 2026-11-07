import { useState } from 'react';
import Decimal from 'decimal.js';
import { Ban, RotateCcw, Coins, LogOut, KeyRound, ShieldQuestion, Save, Check, X, FileSearch, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { list, useRun } from '@/lib/platform';
import { fileUrl, type R } from '@/lib/api';
import { amount, when, num, titleCase, maskEmail, ledgerLabel, ledgerMovement } from '@/lib/format';
import { StatusChip, ActionSheet, EmptyState } from '@/components/app/kit';
import { useAdmin, DataTable, AdminTitle, userLabel } from './shell';
import { usePrompt, Section } from './parts';

const D = (x: Decimal.Value) => new Decimal(x);
const KYC_ITEMS = ['id_front', 'id_back', 'selfie', 'proof_of_address'];

function UserDetail({ u, onClose }: { u: R; onClose: () => void }) {
  const { state, role } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [edit, setEdit] = useState({ username: String(u.username || ''), email: String(u.email || ''), notes: String(u.notes || '') });
  const [kyc, setKyc] = useState({ items: ['id_front', 'id_back', 'selfie'] as string[], note: '', deadline: '', block: true });
  const sup = role === 'superadmin';
  const mine = (k: string) => list(state[k]).filter((x) => x.user_id === u.id);
  const wallets = list(u.wallets).length ? list(u.wallets) : mine('wallets');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5"><StatusChip status={u.status} /><StatusChip status={u.email_verified ? 'verified' : 'pending'} />{u.kyc_status && <StatusChip status={String(u.kyc_status)} />}{u.withdrawals_blocked && <StatusChip status="suspended" />}</div>
      <Tabs defaultValue="profile">
        <TabsList className="rounded-full w-full overflow-x-auto no-scrollbar justify-start"><TabsTrigger value="profile" className="rounded-full">Profile</TabsTrigger><TabsTrigger value="money" className="rounded-full">Money</TabsTrigger><TabsTrigger value="activity" className="rounded-full">Activity</TabsTrigger><TabsTrigger value="kyc" className="rounded-full">KYC</TabsTrigger></TabsList>
        <TabsContent value="profile" className="space-y-3 pt-2">
          <div><Label className="text-xs">Username</Label><Input value={edit.username} disabled={!sup} onChange={(e) => setEdit({ ...edit, username: e.target.value })} className="rounded-xl mt-1" data-testid="input-user-username" /></div>
          <div><Label className="text-xs">Email</Label><Input value={edit.email} disabled={!sup} onChange={(e) => setEdit({ ...edit, email: e.target.value })} className="rounded-xl mt-1" data-testid="input-user-email" /></div>
          <div><Label className="text-xs">Internal notes</Label><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="rounded-xl mt-1" data-testid="input-user-notes" /></div>
          <Button className="rounded-full" disabled={pending} onClick={() => run('user-update', { id: u.id, ...(sup ? { username: edit.username, email: edit.email } : {}), notes: edit.notes }, { success: 'User saved' })} data-testid="button-save-user"><Save className="w-4 h-4 me-1.5" />Save</Button>
          {sup && <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => p.open({ title: u.status === 'suspended' ? 'Restore account' : 'Suspend account', danger: u.status !== 'suspended', fields: [{ key: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { return await run('user-update', { id: u.id, status: u.status === 'suspended' ? 'active' : 'suspended', reason: v.reason }, { success: 'Status updated' }); } })} data-testid="button-toggle-suspend">{u.status === 'suspended' ? <RotateCcw className="w-4 h-4 me-1" /> : <Ban className="w-4 h-4 me-1" />}{u.status === 'suspended' ? 'Restore' : 'Suspend'}</Button>
            <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => run('user-update', { id: u.id, withdrawals_blocked: !u.withdrawals_blocked }, { success: u.withdrawals_blocked ? 'Withdrawals allowed' : 'Withdrawals blocked' })} data-testid="button-toggle-withdrawals">{u.withdrawals_blocked ? 'Allow withdrawals' : 'Block withdrawals'}</Button>
            <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => run('user-revoke-sessions', { id: u.id }, { success: 'Sessions revoked' })} data-testid="button-revoke-sessions"><LogOut className="w-4 h-4 me-1" />Revoke sessions</Button>
            <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => p.open({ title: 'Reset 2FA', danger: true, fields: [{ key: 'reason', label: 'Reason (logged)', required: true }], onSubmit: async (v) => { return await run('user-reset-twofa', { id: u.id, reason: v.reason }, { success: '2FA reset' }); } })} data-testid="button-reset-2fa"><KeyRound className="w-4 h-4 me-1" />Reset 2FA</Button>
            <Button variant="outline" className="rounded-full col-span-2" disabled={pending} onClick={() => p.open({ title: `Email ${u.username || u.email}`, body: 'Sent from the platform mailbox and recorded in email logs.', fields: [{ key: 'subject', label: 'Subject', required: true }, { key: 'body', label: 'Message', required: true, multiline: true }], confirm: 'Send email', onSubmit: (v) => run('user-email', { id: u.id, subject: v.subject, body: v.body }, { success: 'Email queued' }) })} data-testid="button-email-user"><Mail className="w-4 h-4 me-1" />Email user</Button>
            <Button variant="outline" className="rounded-full col-span-2" disabled={pending} onClick={() => run('user-update', { id: u.id, send_password_reset: true }, { success: 'Password reset email requested' })} data-testid="button-reset-password">Send password reset email</Button>
          </div>}
        </TabsContent>
        <TabsContent value="money" className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-2">{wallets.length ? wallets.map((w) => <div key={String(w.currency)} className="rounded-2xl border p-3"><div className="text-xs text-muted-foreground">{w.currency}</div><div className="num font-semibold">{amount(w.balance)}</div><div className="num text-[11px] text-muted-foreground">Locked {amount(w.locked)}</div></div>) : <p className="text-sm text-muted-foreground col-span-2">No wallet data in workspace.</p>}</div>
          {(sup || role === 'finance') && <Button className="rounded-full w-full" disabled={pending} data-testid="button-adjust-balance" onClick={() => p.open({ title: 'Adjust balance', body: 'Enter up to 3 decimal places. Positive credits and negative debits are recorded in the ledger and audit log.', fields: [{ key: 'currency', label: 'Currency code', required: true, placeholder: 'USDT' }, { key: 'amount', label: 'Amount', required: true, type: 'number', step: '0.001', maxDecimals: 3, allowNegative: true, placeholder: '-12.500' }, { key: 'reason', label: 'Reason', required: true, multiline: true }], onSubmit: async (v) => { return await run('balance-adjust', { user_id: u.id, currency: v.currency.toUpperCase(), amount: v.amount, reason: v.reason }, { success: 'Balance adjusted' }); } })}><Coins className="w-4 h-4 me-1.5" />Adjust balance</Button>}
          <div className="space-y-1">{mine('ledger').slice(0, 20).map((l) => <div key={String(l.id)} className="flex justify-between text-xs py-1 border-b"><span>{ledgerLabel(l.type)} · {when(l.created_at)}</span><span className="num">{ledgerMovement(l)} {l.currency}</span></div>)}</div>
        </TabsContent>
        <TabsContent value="activity" className="space-y-2 pt-2 text-sm">
          {(['rentals', 'deposits', 'withdrawals'] as const).map((k) => <div key={k}><div className="text-xs uppercase tracking-wider text-muted-foreground mt-2 mb-1">{k} ({mine(k).length})</div>{mine(k).slice(0, 8).map((r) => <div key={String(r.id)} className="flex justify-between py-1 border-b text-xs"><span>{r.asset_title || `${amount(r.amount ?? r.amount_claimed)} ${r.currency}`}</span><StatusChip status={r.status} /></div>)}</div>)}
          <div className="text-xs uppercase tracking-wider text-muted-foreground mt-3 mb-1">Referrals</div>{list(state.referrals).filter((r) => r.referrer_id === u.id).map((r) => <div key={String(r.id)} className="text-xs py-1">L{r.level} · {userLabel(state, r.referred_id)}</div>)}
          <div className="text-xs uppercase tracking-wider text-muted-foreground mt-3 mb-1">Login history</div>{list(u.sessions ?? mine('sessions')).slice(0, 8).map((s) => <div key={String(s.id)} className="text-xs py-1">{s.ip} · {s.device || s.user_agent} · {when(s.created_at)}</div>)}
        </TabsContent>
        <TabsContent value="kyc" className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">Request verification. The user is emailed and bannered.</p>
          <div className="grid grid-cols-2 gap-2">{KYC_ITEMS.map((k) => <label key={k} className="flex items-center gap-2 text-sm rounded-xl border p-2.5"><Checkbox checked={kyc.items.includes(k)} onCheckedChange={(v) => setKyc({ ...kyc, items: v ? [...kyc.items, k] : kyc.items.filter((x) => x !== k) })} data-testid={`checkbox-kyc-${k}`} />{titleCase(k)}</label>)}</div>
          <Textarea placeholder="Note to the user" value={kyc.note} onChange={(e) => setKyc({ ...kyc, note: e.target.value })} className="rounded-xl" data-testid="input-kyc-note" />
          <div><Label className="text-xs">Deadline</Label><Input type="date" value={kyc.deadline} onChange={(e) => setKyc({ ...kyc, deadline: e.target.value })} className="rounded-xl mt-1" data-testid="input-kyc-deadline" /></div>
          <label className="flex items-center justify-between text-sm">Block withdrawals until approved<Switch checked={kyc.block} onCheckedChange={(v) => setKyc({ ...kyc, block: v })} data-testid="switch-kyc-block" /></label>
          <Button className="rounded-full w-full" disabled={pending || !kyc.items.length} onClick={() => run('kyc-request', { user_id: u.id, required_items: kyc.items, note: kyc.note, deadline: kyc.deadline || undefined, block_withdrawals: kyc.block }, { success: 'Verification requested', onSuccess: onClose })} data-testid="button-request-kyc"><ShieldQuestion className="w-4 h-4 me-1.5" />Request verification</Button>
        </TabsContent>
      </Tabs>
      {p.node}
    </div>
  );
}

export function AdminUsers() {
  const { state } = useAdmin();
  const [sel, setSel] = useState<R | null>(null);
  const [status, setStatus] = useState('all');
  const rows = list(state.users).filter((u) => status === 'all' || u.status === status || (status === 'kyc' && ['requested', 'submitted'].includes(String(u.kyc_status))));
  const live = sel ? list(state.users).find((u) => u.id === sel.id) || sel : null;
  return (
    <div>
      <AdminTitle title="Users" sub={`${list(state.users).length} accounts`} />
      <DataTable testId="users" rows={rows} onRow={setSel} exportType="users"
        toolbar={<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-40 rounded-full" data-testid="filter-user-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="kyc">KYC open</SelectItem></SelectContent></Select>}
        cols={[
          { key: 'username', label: 'User', render: (u) => <div><div className="font-medium">{u.username}</div><div className="text-xs text-muted-foreground">{u.email}</div></div> },
          { key: 'status', label: 'Status', render: (u) => <StatusChip status={u.status} /> },
          { key: 'kyc_status', label: 'KYC', render: (u) => <StatusChip status={String(u.kyc_status || 'none')} /> },
          { key: 'twofa_enabled', label: '2FA', render: (u) => (u.twofa_enabled ? 'On' : 'Off') },
          { key: 'created_at', label: 'Joined', render: (u) => when(u.created_at) },
        ]} />
      <ActionSheet open={!!live} onOpenChange={(o) => !o && setSel(null)} title={String(live?.username || 'User')} description={String(live?.email || '')}>{live && <UserDetail u={live} onClose={() => setSel(null)} />}</ActionSheet>
    </div>
  );
}

const docKey = (d: R) => String(d.type || d.objectPath || '');
const docPath = (d: R) => String(d.objectPath || d.file_url || '');

export function AdminKyc() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [sel, setSel] = useState<R | null>(null);
  const live = sel ? list(state.kycRequests).find((k) => k.id === sel.id) || sel : null;
  const docs = live ? list(live.documents) : [];
  const required = live && Array.isArray(live.required_items) ? (live.required_items as string[]) : [];
  const missing = required.filter((t) => !docs.some((d) => d.type === t));
  const notApproved = docs.filter((d) => d.status !== 'approved');
  const canApprove = docs.length > 0 && !missing.length && !notApproved.length;
  const reviewDoc = (d: R, status: 'approved' | 'rejected', reason?: string) =>
    run('kyc-document-review', { id: live!.id, type: d.type, status, reason: reason || undefined }, { success: status === 'approved' ? `${titleCase(String(d.type))} approved` : `${titleCase(String(d.type))} rejected` });
  return (
    <div>
      <AdminTitle title="KYC" sub="Every document view is audit-logged." />
      <DataTable testId="kyc" rows={list(state.kycRequests)} onRow={setSel}
        cols={[
          { key: 'user', label: 'User', render: (k) => userLabel(state, k.user_id) },
          { key: 'items', label: 'Items', render: (k) => (Array.isArray(k.required_items) ? k.required_items.map(titleCase).join(', ') : '') },
          { key: 'deadline', label: 'Deadline', render: (k) => when(k.deadline) },
          { key: 'status', label: 'Status', render: (k) => <StatusChip status={k.status} /> },
        ]} />
      <ActionSheet open={!!live} onOpenChange={(o) => !o && setSel(null)} title="Verification review" description={live ? userLabel(state, live.user_id) : ''}>
        {live && (
          <div className="space-y-3">
            {live.note && <p className="text-sm rounded-2xl bg-muted p-3">{live.note}</p>}
            {docs.length ? docs.map((d) => {
              const k = docKey(d);
              const path = docPath(d);
              return (
                <div key={k} className="rounded-2xl border p-3 space-y-2" data-testid={`card-doc-${k}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{titleCase(String(d.type))}</span><div className="flex items-center gap-2"><StatusChip status={String(d.status || 'submitted')} />{path && <a href={fileUrl(path)} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center gap-1" data-testid={`link-doc-${k}`}><FileSearch className="w-3.5 h-3.5" />Open</a>}</div></div>
                  {/\.(png|jpe?g|webp)$/i.test(path) && <img src={fileUrl(path)} alt="" className="rounded-xl max-h-48 w-full object-contain bg-muted" />}
                  {d.reject_reason && d.status === 'rejected' && <p className="text-xs text-destructive">Rejected: {String(d.reject_reason)}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" variant={d.status === 'approved' ? 'default' : 'outline'} className="rounded-full" disabled={pending || d.status === 'approved'} onClick={() => reviewDoc(d, 'approved')} data-testid={`button-doc-approve-${k}`}><Check className="w-3.5 h-3.5 me-1" />Approve</Button>
                    <Button size="sm" variant={d.status === 'rejected' ? 'destructive' : 'outline'} className="rounded-full" disabled={pending} onClick={() => p.open({ title: `Reject ${titleCase(String(d.type))}`, body: 'The user is asked to upload this document again.', danger: true, fields: [{ key: 'reason', label: 'Reason shown to the user', required: true }], onSubmit: (v) => reviewDoc(d, 'rejected', v.reason) })} data-testid={`button-doc-reject-${k}`}><X className="w-3.5 h-3.5 me-1" />Reject</Button>
                  </div>
                </div>
              );
            }) : <EmptyState title="No documents yet" body="Waiting for the user to upload." />}
            {(missing.length > 0 || (docs.length > 0 && notApproved.length > 0)) && <p className="text-xs text-muted-foreground rounded-2xl bg-muted p-3" data-testid="text-kyc-blockers">{missing.length > 0 && <>Missing: {missing.map(titleCase).join(', ')}. </>}{notApproved.length > 0 && <>Approve every document before approving the verification ({notApproved.length} pending or rejected).</>}</p>}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button className="rounded-full" disabled={pending || !canApprove} onClick={() => run('kyc-review', { id: live.id, status: 'approved' }, { success: 'Verification approved', onSuccess: () => setSel(null) })} data-testid="button-kyc-approve">Approve verification</Button>
              <Button variant="outline" className="rounded-full text-destructive" disabled={pending} onClick={() => p.open({ title: 'Reject verification', body: 'Uploaded files are kept for audit. Per-document decisions stay as recorded.', danger: true, fields: [{ key: 'reason', label: 'Reason', required: true, multiline: true }], onSubmit: (v) => run('kyc-review', { id: live.id, status: 'rejected', reason: v.reason }, { success: 'Re-upload requested', onSuccess: () => setSel(null) }) })} data-testid="button-kyc-reject">Reject / re-upload</Button>
            </div>
          </div>
        )}
      </ActionSheet>
      {p.node}
    </div>
  );
}

const TRIGGERS = ['first_deposit', 'every_deposit', 'rental_spend'];

export function AdminReferrals() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const cfg0 = ((state.settings as R)?.referral_config as R) || {};
  const pct0 = Array.isArray(cfg0.percentages) ? cfg0.percentages : Array.isArray(cfg0.percents) ? cfg0.percents : [cfg0.level1 ?? 5, cfg0.level2 ?? 0, cfg0.level3 ?? 0];
  const trg0 = Array.isArray(cfg0.triggers) ? cfg0.triggers : cfg0.trigger ? [cfg0.trigger] : ['first_deposit'];
  const [cfg, setCfg] = useState({ enabled: cfg0.enabled !== false, levels: num(cfg0.levels) || Math.max(1, pct0.length) || 1, percentages: pct0.map(String) as string[], triggers: trg0.map(String) as string[], cap: String(cfg0.cap ?? '') });
  const pctBad = cfg.percentages.slice(0, cfg.levels).some((x) => x === '' || !/^\d+(\.\d{1,3})?$/.test(x) || D(x).gt(100));
  const pctTotal = cfg.percentages.slice(0, cfg.levels).reduce((t, x) => (/^\d+(\.\d+)?$/.test(x) ? t.plus(x) : t), D(0));
  const capBad = cfg.cap !== '' && !/^\d+(\.\d{1,3})?$/.test(cfg.cap);
  const flagged = list(state.referrals).filter((r) => (r.flag || r.suspicious) && !r.review_decision);
  const review = (r: R, decision: 'allow' | 'block') => p.open({ title: decision === 'allow' ? 'Allow referral' : 'Block referral', body: decision === 'block' ? 'Pending commissions from this pair will not be paid.' : 'Commissions resume for this pair.', danger: decision === 'block', fields: [{ key: 'reason', label: 'Reason (logged)', required: true }], onSubmit: (v) => run('referral-review', { id: r.id, decision, reason: v.reason }, { success: decision === 'allow' ? 'Referral allowed' : 'Referral blocked' }) });
  const reviewCommission = (c: R, decision: 'pay' | 'block') => p.open({ title: decision === 'pay' ? 'Pay pending commission' : 'Block pending commission', body: 'This manual decision is recorded in the audit trail.', danger: decision === 'block', fields: [{ key: 'reason', label: 'Reason (logged)', required: true }], onSubmit: (v) => run('commission-review', { id: c.id, decision, reason: v.reason }, { success: decision === 'pay' ? 'Commission paid' : 'Commission blocked' }) });
  return (
    <div className="space-y-5">
      <AdminTitle title="Referrals" />
      <div className="grid xl:grid-cols-[380px_1fr] gap-4">
        <Section title="Program configuration">
          <div className="space-y-3">
            <label className="flex items-center justify-between text-sm">Enabled<Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} data-testid="switch-ref-enabled" /></label>
            <div><Label className="text-xs">Levels</Label><Select value={String(cfg.levels)} onValueChange={(v) => setCfg({ ...cfg, levels: Number(v) })}><SelectTrigger className="rounded-xl mt-1" data-testid="select-ref-levels"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></div>
            {Array.from({ length: cfg.levels }).map((_, i) => <div key={i}><Label className="text-xs">Level {i + 1} percentage</Label><Input type="number" step="0.001" inputMode="decimal" value={cfg.percentages[i] ?? ''} onChange={(e) => { const x = [...cfg.percentages]; x[i] = e.target.value.trim(); setCfg({ ...cfg, percentages: x }); }} className="rounded-xl mt-1 num" data-testid={`input-ref-pct-${i}`} /></div>)}
            <p className="text-xs text-muted-foreground num" data-testid="text-ref-total">Total payout across levels: {pctTotal.toString()}%</p>
            <div className="space-y-1.5"><Label className="text-xs">Triggers</Label>{TRIGGERS.map((t) => <label key={t} className="flex items-center gap-2 text-sm"><Checkbox checked={cfg.triggers.includes(t)} onCheckedChange={(v) => setCfg({ ...cfg, triggers: v ? [...cfg.triggers, t] : cfg.triggers.filter((x) => x !== t) })} data-testid={`checkbox-ref-trigger-${t}`} />{titleCase(t)}</label>)}</div>
            <div><Label className="text-xs">Cumulative cap per referred user, per beneficiary, per currency</Label><Input type="number" step="0.001" inputMode="decimal" placeholder="No cap" value={cfg.cap} onChange={(e) => setCfg({ ...cfg, cap: e.target.value.trim() })} className="rounded-xl mt-1 num" data-testid="input-ref-cap" /><p className="text-[11px] text-muted-foreground mt-1">Amounts and percentages accept up to 3 decimal places.</p></div>
            {(pctBad || capBad || !cfg.triggers.length) && <p className="text-xs text-destructive">{pctBad ? 'Each percentage must be from 0 to 100, with up to 3 decimal places.' : capBad ? 'Cap must be a positive amount with up to 3 decimal places, or blank.' : 'Choose at least one trigger.'}</p>}
            <Button className="rounded-full w-full" disabled={pending || pctBad || capBad || !cfg.triggers.length} onClick={() => run('settings-save', { section: 'referral_config', values: { enabled: cfg.enabled, levels: cfg.levels, percentages: cfg.percentages.slice(0, cfg.levels), triggers: cfg.triggers, cap: cfg.cap === '' ? null : cfg.cap } }, { success: 'Referral config saved' })} data-testid="button-save-ref">Save</Button>
          </div>
        </Section>
        <div className="space-y-4 min-w-0">
          {flagged.length > 0 && <Section title={`Flagged for review (${flagged.length})`}>{flagged.map((r) => <div key={String(r.id)} className="text-sm flex flex-wrap items-center justify-between gap-2 py-2 border-b" data-testid={`row-flagged-${r.id}`}><div className="min-w-0"><div className="truncate">{userLabel(state, r.referrer_id)} → {maskEmail(userLabel(state, r.referred_id))}</div><div className="text-xs text-destructive">{String(r.flag || r.suspicious_reason || 'suspicious')}</div></div><div className="flex gap-1.5"><Button size="sm" variant="outline" className="rounded-full" disabled={pending} onClick={() => review(r, 'allow')} data-testid={`button-ref-allow-${r.id}`}><Check className="w-3.5 h-3.5 me-1" />Allow</Button><Button size="sm" variant="outline" className="rounded-full text-destructive" disabled={pending} onClick={() => review(r, 'block')} data-testid={`button-ref-block-${r.id}`}><Ban className="w-3.5 h-3.5 me-1" />Block</Button></div></div>)}</Section>}
          <DataTable testId="referrals" rows={list(state.referrals)} exportType="referrals" cols={[{ key: 'referrer', label: 'Referrer', render: (r) => userLabel(state, r.referrer_id) }, { key: 'referred', label: 'Referred', render: (r) => userLabel(state, r.referred_id) }, { key: 'level', label: 'Level' }, { key: 'review', label: 'Review', render: (r) => (r.review_decision ? <StatusChip status={String(r.review_decision === 'block' ? 'blocked' : 'approved')} /> : r.flag || r.suspicious ? <StatusChip status="pending" /> : '—') }]} />
          <DataTable testId="commissions" rows={list(state.commissions)} exportType="commissions" cols={[{ key: 'beneficiary', label: 'Beneficiary', render: (c) => userLabel(state, c.user_id ?? c.referrer_id) }, { key: 'amount', label: 'Amount', render: (c) => <span className="num">{amount(c.amount)} {c.currency}</span> }, { key: 'source_type', label: 'Source' }, { key: 'level', label: 'L' }, { key: 'status', label: 'Status', render: (c) => <div className="flex items-center gap-2"><StatusChip status={c.status} />{c.status === 'pending' && <><Button size="sm" variant="outline" className="rounded-full" disabled={pending} onClick={() => reviewCommission(c, 'pay')} data-testid={`button-commission-pay-${c.id}`}>Pay</Button><Button size="sm" variant="outline" className="rounded-full text-destructive" disabled={pending} onClick={() => reviewCommission(c, 'block')} data-testid={`button-commission-block-${c.id}`}>Block</Button></>}</div> }]} />
        </div>
      </div>
      {p.node}
    </div>
  );
}
