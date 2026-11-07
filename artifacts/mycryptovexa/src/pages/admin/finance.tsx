import { useState } from 'react';
import { Check, X, HelpCircle, Send, RotateCcw, AlertTriangle, Image as ImageIcon, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { list, useRun } from '@/lib/platform';
import { fileUrl, type R } from '@/lib/api';
import { amount, when, D } from '@/lib/format';
import { StatusChip, CoinIcon, ActionSheet } from '@/components/app/kit';
import { useAdmin, DataTable, AdminTitle, userLabel } from './shell';
import { usePrompt } from './parts';

function Filters({ status, setStatus, statuses, coin, setCoin, coins }: { status: string; setStatus: (s: string) => void; statuses: string[]; coin: string; setCoin: (s: string) => void; coins: string[] }) {
  return (
    <>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-44 rounded-full" data-testid="filter-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      <Select value={coin} onValueChange={setCoin}><SelectTrigger className="h-9 w-32 rounded-full" data-testid="filter-coin"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All coins</SelectItem>{coins.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
    </>
  );
}

export function AdminDeposits() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [status, setStatus] = useState('pending_review');
  const [coin, setCoin] = useState('all');
  const [sel, setSel] = useState<R | null>(null);
  const deps = list(state.deposits);
  const rows = deps.filter((d) => (status === 'all' || d.status === status) && (coin === 'all' || d.currency === coin));
  const dupe = (d: R) => !!d.txid && deps.filter((x) => x.txid === d.txid).length > 1;
  const coins = list(state.currencies).map((c) => String(c.code));

  return (
    <div>
      <AdminTitle title="Deposits" sub="Every credit is a human decision. Approval writes exactly one ledger entry." />
      <DataTable testId="deposits" rows={rows} exportType="deposits" onRow={setSel}
        toolbar={<Filters status={status} setStatus={setStatus} statuses={['pending_review', 'needs_info', 'approved', 'rejected']} coin={coin} setCoin={setCoin} coins={coins} />}
        cols={[
          { key: 'created_at', label: 'Submitted', render: (d) => when(d.created_at) },
          { key: 'user', label: 'User', render: (d) => userLabel(state, d.user_id) },
          { key: 'amount', label: 'Claimed', render: (d) => <span className="flex items-center gap-2 num"><CoinIcon code={String(d.currency)} size={20} />{amount(d.amount_claimed)} {d.currency}</span> },
          { key: 'network', label: 'Network' },
          { key: 'txid', label: 'TXID', render: (d) => <span className="font-mono text-xs flex items-center gap-1">{d.txid ? `${String(d.txid).slice(0, 12)}…` : '—'}{dupe(d) && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}</span> },
          { key: 'hint', label: 'Hint', render: (d) => d.binance_hint_json || d.binance_hint ? <span className="text-[11px] rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5">Possible match</span> : '' },
          { key: 'status', label: 'Status', render: (d) => <StatusChip status={d.status} /> },
        ]} />
      <ActionSheet open={!!sel} onOpenChange={(o) => !o && setSel(null)} title="Review deposit" description={sel ? `${userLabel(state, sel.user_id)} · ${when(sel.created_at)}` : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="rounded-2xl vault-card p-4"><div className="text-xs text-white/60">Claimed</div><div className="num text-2xl font-semibold">{amount(sel.amount_claimed)} {sel.currency}</div><div className="text-xs text-white/60">{sel.network}{sel.amount_credited ? ` · credited ${amount(sel.amount_credited)}` : ''}</div></div>
            {sel.address_used && <div className="text-xs" data-testid="text-address-used"><span className="text-muted-foreground">Sent to {sel.address_kind ? `${sel.address_kind} ` : ''}address: </span><code className="break-all">{String(sel.address_used)}</code>{sel.memo_used ? <> · memo <code>{String(sel.memo_used)}</code></> : null}</div>}
            {sel.txid && <div className="text-xs font-mono break-all flex gap-2 items-start">{sel.txid}<button onClick={() => navigator.clipboard.writeText(String(sel.txid))}><Copy className="w-3.5 h-3.5" /></button></div>}
            {dupe(sel) && <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-3 text-sm flex gap-2"><AlertTriangle className="w-4 h-4 text-destructive" />This TXID appears on another deposit.</div>}
            {(sel.binance_hint_json || sel.binance_hint) && <pre className="rounded-2xl bg-muted p-3 text-[11px] overflow-x-auto">{JSON.stringify(sel.binance_hint_json || sel.binance_hint, null, 2)}</pre>}
            {sel.proof_image ? <a href={fileUrl(String(sel.proof_image))} target="_blank" rel="noreferrer" className="block rounded-2xl overflow-hidden border"><img src={fileUrl(String(sel.proof_image))} alt="Proof" className="w-full max-h-72 object-contain bg-muted" /></a> : <div className="text-sm text-muted-foreground flex items-center gap-2"><ImageIcon className="w-4 h-4" />No proof attached</div>}
            {list(sel.messages).map((m) => <div key={String(m.id)} className="rounded-2xl bg-muted p-3 text-sm">{m.body}</div>)}
            {sel.review_note && <p className="text-sm">Note: {sel.review_note}</p>}
            {['pending_review', 'needs_info'].includes(String(sel.status)) && (
              <div className="grid grid-cols-3 gap-2">
                <Button className="rounded-full" disabled={pending} data-testid="button-approve-deposit" onClick={() => p.open({ title: 'Approve deposit', body: 'Leave amount blank to credit the claimed amount.', fields: [{ key: 'amount', label: `Credit amount (${sel.currency})`, type: 'number', initial: String(sel.amount_claimed ?? '') }, { key: 'reason', label: 'Reason for adjustment' }], confirm: 'Approve and credit', onSubmit: async (v) => { const adj = v.amount && !D(v.amount).eq(D(sel.amount_claimed)); if (adj && !v.reason) return false; return await run('deposit-approve', { id: sel.id, amount: v.amount || undefined, reason: v.reason || undefined }, { success: 'Deposit approved', onSuccess: () => setSel(null) }); } })}><Check className="w-4 h-4 me-1" />Approve</Button>
                <Button variant="outline" className="rounded-full" disabled={pending} data-testid="button-info-deposit" onClick={() => p.open({ title: 'Request more information', fields: [{ key: 'reason', label: 'What do you need from the user?', required: true, multiline: true }], onSubmit: async (v) => { return await run('deposit-info', { id: sel.id, reason: v.reason }, { success: 'Info requested', onSuccess: () => setSel(null) }); } })}><HelpCircle className="w-4 h-4 me-1" />Ask</Button>
                <Button variant="outline" className="rounded-full text-destructive" disabled={pending} data-testid="button-reject-deposit" onClick={() => p.open({ title: 'Reject deposit', danger: true, fields: [{ key: 'reason', label: 'Reason shown to the user', required: true, multiline: true }], confirm: 'Reject', onSubmit: async (v) => { return await run('deposit-reject', { id: sel.id, reason: v.reason }, { success: 'Deposit rejected', onSuccess: () => setSel(null) }); } })}><X className="w-4 h-4 me-1" />Reject</Button>
              </div>
            )}
          </div>
        )}
      </ActionSheet>
      {p.node}
    </div>
  );
}

export function AdminWithdrawals() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [status, setStatus] = useState('all');
  const [coin, setCoin] = useState('all');
  const [sel, setSel] = useState<R | null>(null);
  const settings = (state.settings as R) || {};
  const binance = (settings.binance as R) || {};
  const forceManual = !!(binance.force_manual ?? settings.force_manual);
  const rows = list(state.withdrawals).filter((w) => (status === 'all' || w.status === status) && (coin === 'all' || w.currency === coin));
  const coins = list(state.currencies).map((c) => String(c.code));
  const manualCount = list(state.withdrawals).filter((w) => w.status === 'manual_fallback').length;

  const unknown = !!sel && !['sent', 'rejected'].includes(String(sel.status)) && !!(sel.outcome_unknown ?? (sel.data as R | undefined)?.outcome_unknown);
  return (
    <div>
      <AdminTitle title="Withdrawals" sub="Automatic through Binance with a manual fallback queue." action={
        <label className="flex items-center gap-3 rounded-full border bg-card ps-4 pe-2 py-1.5 text-sm">Force manual mode<Switch checked={forceManual} disabled={pending} onCheckedChange={(v) => run('settings-save', { section: 'binance', values: { force_manual: v } }, { success: v ? 'All withdrawals now route to manual' : 'Automatic processing restored' })} data-testid="switch-force-manual" /></label>} />
      {manualCount > 0 && <button onClick={() => setStatus('manual_fallback')} className="w-full mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-start flex gap-2" data-testid="banner-manual-queue"><AlertTriangle className="w-4 h-4 text-amber-600" />{manualCount} withdrawal(s) waiting in the manual queue.</button>}
      <DataTable testId="withdrawals" rows={rows} exportType="withdrawals" onRow={setSel}
        toolbar={<Filters status={status} setStatus={setStatus} statuses={['pending_confirm', 'queued', 'processing', 'manual_fallback', 'sent', 'rejected', 'failed']} coin={coin} setCoin={setCoin} coins={coins} />}
        cols={[
          { key: 'created_at', label: 'Requested', render: (w) => when(w.created_at) },
          { key: 'user', label: 'User', render: (w) => userLabel(state, w.user_id) },
          { key: 'amount', label: 'Amount', render: (w) => <span className="flex items-center gap-2 num"><CoinIcon code={String(w.currency)} size={20} />{amount(w.amount)} {w.currency}</span> },
          { key: 'network', label: 'Network' },
          { key: 'address', label: 'Address', render: (w) => <span className="font-mono text-xs">{String(w.address).slice(0, 10)}…</span> },
          { key: 'status', label: 'Status', render: (w) => <StatusChip status={w.status} /> },
        ]} />
      <ActionSheet open={!!sel} onOpenChange={(o) => !o && setSel(null)} title="Withdrawal" description={sel ? userLabel(state, sel.user_id) : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="rounded-2xl vault-card p-4"><div className="num text-2xl font-semibold">{amount(sel.amount)} {sel.currency}</div><div className="text-xs text-white/60 num">Fee {amount(sel.fee)} · {sel.network}</div></div>
            <div className="text-xs font-mono break-all rounded-2xl bg-muted p-3">{sel.address}{sel.memo ? ` · memo ${sel.memo}` : ''}</div>
            <StatusChip status={sel.status} />
            {sel.txid && <p className="text-xs font-mono break-all">TXID {sel.txid}</p>}
            {unknown && <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-3 text-sm flex gap-2" data-testid="banner-outcome-unknown"><AlertTriangle className="w-4 h-4 text-destructive shrink-0" />Binance outcome unknown (timeout or interrupted processing). Funds may already have left. Check Binance withdrawal history before marking sent, retrying or rejecting.</div>}
            {sel.fail_reason && <p className="text-sm text-destructive">{sel.fail_reason}</p>}
            {sel.binance_response && <pre className="rounded-2xl bg-muted p-3 text-[11px] overflow-x-auto">{JSON.stringify(sel.binance_response, null, 2)}</pre>}
            <div className="grid grid-cols-2 gap-2">
              {!unknown && ['queued', 'pending_confirm', 'processing'].includes(String(sel.status)) && <Button className="rounded-full" disabled={pending} onClick={() => run('withdrawal-approve', { id: sel.id }, { success: 'Withdrawal approved', onSuccess: () => setSel(null) })} data-testid="button-approve-withdrawal"><Check className="w-4 h-4 me-1" />Approve</Button>}
              {(sel.status === 'manual_fallback' || unknown) && <Button className="rounded-full" disabled={pending} onClick={() => p.open({ title: 'Mark as sent', body: 'Send the funds externally first, then record the on-chain TXID.', fields: [{ key: 'txid', label: 'Transaction ID', required: true }], ...(unknown ? { ack: 'I checked Binance withdrawal history and no completed transfer exists for this withdrawal.' } : {}), confirm: 'Mark as sent', onSubmit: async (v) => { return await run('withdrawal-sent', { id: sel.id, txid: v.txid.trim(), ...(unknown ? { confirm_history_checked: true } : {}) }, { success: 'Marked as sent', onSuccess: () => setSel(null) }); } })} data-testid="button-mark-sent"><Send className="w-4 h-4 me-1" />Mark sent</Button>}
              {(['failed', 'manual_fallback'].includes(String(sel.status)) || unknown) && <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => p.open({ title: 'Retry automatic withdrawal', body: 'Check Binance withdrawal history and your external wallet before retrying, to avoid sending twice.', fields: [], ack: unknown ? 'I checked Binance withdrawal history and no completed transfer exists for this withdrawal.' : 'I checked withdrawal history and confirm this has not been sent.', confirm: 'Retry', onSubmit: async () => { return await run('withdrawal-retry', { id: sel.id, confirm_history_checked: true }, { success: 'Retry queued', onSuccess: () => setSel(null) }); } })} data-testid="button-retry-withdrawal"><RotateCcw className="w-4 h-4 me-1" />Retry</Button>}
              {!['sent', 'rejected'].includes(String(sel.status)) && <Button variant="outline" className="rounded-full text-destructive" disabled={pending} onClick={() => p.open({ title: 'Reject and refund', danger: true, fields: [{ key: 'reason', label: 'Reason shown to the user', required: true, multiline: true }], ...(unknown ? { ack: 'I checked Binance withdrawal history and no completed transfer exists for this withdrawal.' } : {}), confirm: 'Reject', onSubmit: async (v) => { return await run('withdrawal-reject', { id: sel.id, reason: v.reason, ...(unknown ? { confirm_history_checked: true } : {}) }, { success: 'Rejected and refunded', onSuccess: () => setSel(null) }); } })} data-testid="button-reject-withdrawal"><X className="w-4 h-4 me-1" />Reject</Button>}
            </div>
          </div>
        )}
      </ActionSheet>
      {p.node}
    </div>
  );
}
