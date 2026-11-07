import { useEffect, useMemo, useState } from 'react';
import { useSearch, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Wallet as WalletIcon, ArrowDownToLine, ArrowUpFromLine, Copy, Check, Download, AlertTriangle, BookUser, Trash2, Plus, ShieldOff, MessageSquareReply } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePlatform, list, useRun } from '@/lib/platform';
import { exportUrl, fileUrl, type R } from '@/lib/api';
import { amount, num, when, D, dmax0, Decimal, ledgerLabel } from '@/lib/format';
import { PageHeader, PageSkeleton, ErrorState, EmptyState, StatusChip, SignInPrompt, ActionSheet, CoinIcon, FilePick } from '@/components/app/kit';
import { cn } from '@/lib/utils';

function CoinNet({ currencies, coin, setCoin, net, setNet }: { currencies: R[]; coin: string; setCoin: (c: string) => void; net: string; setNet: (n: string) => void }) {
  const cur = currencies.find((c) => c.code === coin);
  const nets = list(cur?.networks).filter((n) => n.enabled !== false);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {currencies.map((c) => <button key={String(c.code)} onClick={() => { setCoin(String(c.code)); setNet(''); }} className={cn('press flex items-center gap-2 rounded-2xl border ps-1.5 pe-3 py-1.5 text-sm shrink-0', coin === c.code ? 'border-primary bg-accent font-semibold' : 'bg-card')} data-testid={`button-pick-${c.code}`}><CoinIcon code={String(c.code)} size={24} />{c.code}</button>)}
      </div>
      {cur && (
        <div className="flex gap-2 flex-wrap">
          {nets.length ? nets.map((n) => <button key={String(n.name)} onClick={() => setNet(String(n.name))} className={cn('press rounded-full border px-4 py-1.5 text-sm', net === n.name ? 'bg-primary text-primary-foreground border-primary' : 'bg-card')} data-testid={`button-net-${n.name}`}>{n.name}</button>) : <p className="text-sm text-muted-foreground">No enabled networks for {coin}.</p>}
        </div>
      )}
    </div>
  );
}

function Tracker({ steps, at, failed }: { steps: string[]; at: number; failed?: boolean }) {
  return (
    <div className="flex items-center gap-1 mt-3">
      {steps.map((s, i) => (
        <div key={s} className="flex-1">
          <div className={cn('h-1.5 rounded-full', i <= at ? (failed && i === at ? 'bg-destructive' : 'brand-grad') : 'bg-muted')} />
          <div className={cn('text-[10px] mt-1', i <= at ? 'font-semibold' : 'text-muted-foreground')}>{s}</div>
        </div>
      ))}
    </div>
  );
}

function DepositSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, settings } = usePlatform();
  const { run, pending } = useRun('user');
  const currencies = list(state.currencies).filter((c) => c.enabled !== false);
  const [coin, setCoin] = useState('');
  const [net, setNet] = useState('');
  const [step, setStep] = useState<'address' | 'claim'>('address');
  const [copied, setCopied] = useState(false);
  const [f, setF] = useState({ amount: '', txid: '', proof: '', terms: false });
  useEffect(() => { if (!open) { setStep('address'); setF({ amount: '', txid: '', proof: '', terms: false }); } }, [open]);
  const cur = currencies.find((c) => c.code === coin);
  const network = list(cur?.networks).find((n) => n.name === net);
  const addrs = network ? [String(network.address || ''), ...(Array.isArray(network.fallback_addresses) ? network.fallback_addresses.map(String) : [])].filter(Boolean) : [];
  const [addrIdx, setAddrIdx] = useState(0);
  useEffect(() => setAddrIdx(0), [coin, net]);
  const depAddr = addrs[addrIdx] || addrs[0] || '';
  const txidRequired = !!(settings.security as R)?.deposit_txid_required || !!(settings.billing as R)?.deposit_txid_required;
  const terms = typeof settings.deposit_terms === 'string' ? settings.deposit_terms : (settings.deposit_terms as R)?.body || (settings.terms as R)?.deposit;
  const below = D(f.amount).gt(0) && D(f.amount).lt(D(cur?.min_deposit));

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title="Deposit" description="Send funds to the address below, then tell us. A person reviews every deposit before it is credited.">
      {step === 'address' ? (
        <div className="space-y-5">
          <CoinNet currencies={currencies} coin={coin} setCoin={setCoin} net={net} setNet={setNet} />
          {network ? (
            depAddr ? (
              <div className="rounded-3xl border p-5 space-y-4 rise">
                <div className="mx-auto w-fit p-3 rounded-2xl bg-[#f4f7fa]"><QRCodeSVG value={depAddr} size={168} fgColor="#0B1A2E" bgColor="#f4f7fa" /></div>
                {addrs.length > 1 && <div className="flex flex-wrap gap-1.5" data-testid="group-deposit-address">{addrs.map((_, i) => <button key={i} type="button" onClick={() => setAddrIdx(i)} className={`rounded-full px-3 py-1 text-xs border ${i === addrIdx ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground'}`} data-testid={`button-deposit-address-${i}`}>{i === 0 ? 'Primary' : `Fallback ${i}`}</button>)}</div>}
                <div>
                  <Label className="text-xs text-muted-foreground">{coin} address on {net}</Label>
                  <div className="mt-1 flex items-center gap-2 rounded-2xl bg-muted p-3">
                    <code className="text-xs break-all flex-1" data-testid="text-deposit-address">{depAddr}</code>
                    <Button size="icon" variant="ghost" className="rounded-full shrink-0" onClick={() => { navigator.clipboard.writeText(depAddr); setCopied(true); setTimeout(() => setCopied(false), 1600); }} data-testid="button-copy-address">{copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}</Button>
                  </div>
                  {network.memo && <p className="text-xs mt-2">Memo / tag: <code className="font-semibold">{network.memo}</code></p>}
                  {network.memo_required && <p className="text-xs mt-1 text-destructive font-medium" data-testid="text-memo-required">This network requires the memo / tag. Deposits without it cannot be matched to your account.</p>}
                </div>
                <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />Send only {coin} on {net}. Minimum {amount(cur?.min_deposit)} {coin}. Funds sent on another network may be lost permanently.</div>
                <Button className="w-full rounded-full h-12" onClick={() => setStep('claim')} data-testid="button-completed-deposit">I have completed deposit</Button>
              </div>
            ) : <EmptyState icon={AlertTriangle} title="No address configured" body={`Deposits for ${coin} on ${net} are not open yet.`} />
          ) : <p className="text-sm text-muted-foreground">Choose a coin and network to reveal the deposit address.</p>}
        </div>
      ) : (
        <div className="space-y-4 rise">
          <div className="flex items-center gap-2 text-sm"><CoinIcon code={coin} size={22} />{coin} via {net}</div>
          <div><Label>Amount sent</Label><Input type="number" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="mt-1 h-12 rounded-2xl num" data-testid="input-deposit-amount" />{below && <p className="text-xs text-destructive mt-1">Below the {amount(cur?.min_deposit)} minimum.</p>}</div>
          <div><Label>Transaction ID {txidRequired ? '' : '(optional)'}</Label><Input value={f.txid} onChange={(e) => setF({ ...f, txid: e.target.value.trim() })} className="mt-1 h-12 rounded-2xl font-mono text-xs" data-testid="input-deposit-txid" /></div>
          <div><Label>Screenshot (optional)</Label><div className="mt-1"><FilePick value={f.proof} onChange={(p) => setF({ ...f, proof: p })} accept="image/*" label="Add proof screenshot" testId="input-deposit-proof" /></div></div>
          {terms && <div className="rounded-2xl bg-muted p-3 text-xs max-h-32 overflow-y-auto whitespace-pre-line">{String(terms)}</div>}
          <label className="flex items-start gap-3 text-sm"><Checkbox checked={f.terms} onCheckedChange={(v) => setF({ ...f, terms: v === true })} data-testid="checkbox-deposit-terms" />I confirm I sent this deposit and accept the deposit terms. Credit happens only after manual review.</label>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-full h-12" onClick={() => setStep('address')}>Back</Button>
            <Button className="flex-1 rounded-full h-12" disabled={pending || !f.terms || D(f.amount).lte(0) || below || (txidRequired && !f.txid)} data-testid="button-submit-deposit"
              onClick={() => run('deposit', { currency: coin, network: net, address_used: depAddr, amount: f.amount, txid: f.txid || undefined, terms: true, proof_image: f.proof || undefined }, { success: 'Deposit submitted for review', onSuccess: () => onOpenChange(false) })}>Submit for review</Button>
          </div>
        </div>
      )}
    </ActionSheet>
  );
}

function WithdrawSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, user } = usePlatform();
  const { run, pending } = useRun('user');
  const currencies = list(state.currencies).filter((c) => c.enabled !== false);
  const [coin, setCoin] = useState('');
  const [net, setNet] = useState('');
  const [addrId, setAddrId] = useState('');
  const [amt, setAmt] = useState('');
  const [code, setCode] = useState('');
  const [terms, setTerms] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => { if (!open) { setAmt(''); setCode(''); setTerms(false); setConfirmId(null); setAddrId(''); } }, [open]);
  const cur = currencies.find((c) => c.code === coin);
  const w = list(state.wallets).find((x) => x.currency === coin);
  const avail = dmax0(D(w?.balance).minus(D(w?.locked)));
  const amtD = D(amt);
  const book = list(state.addressBook).filter((a) => a.currency === coin && a.network === net);
  const addr = book.find((a) => String(a.id) === addrId);
  const cooling = addr?.usable_after && new Date(String(addr.usable_after)).getTime() > Date.now();
  const pctFee = String(cur?.fee_type ?? cur?.withdraw_fee_type) === 'percent';
  const feeRaw = D(cur?.fee ?? cur?.withdraw_fee_value);
  const feeVal = pctFee ? amtD.times(feeRaw).div(100) : feeRaw;
  const totalDebit = amtD.plus(feeVal);
  // Max recipient amount such that amount + fee <= available
  const maxAmt = dmax0(pctFee ? avail.div(D(1).plus(feeRaw.div(100))) : avail.minus(feeRaw)).toDecimalPlaces(8, Decimal.ROUND_DOWN);
  const tooLow = amtD.gt(0) && amtD.lt(D(cur?.min_withdraw));
  const tooHigh = D(cur?.max_withdraw).gt(0) && amtD.gt(D(cur?.max_withdraw));
  const totp = !!user?.twofa_enabled;

  if (user?.withdrawals_blocked) {
    return <ActionSheet open={open} onOpenChange={onOpenChange} title="Withdraw"><EmptyState icon={ShieldOff} title="Withdrawals are on hold" body="Your account needs identity verification before funds can leave. Complete the requested steps to restore withdrawals." action={<a href="/kyc" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold">Open verification</a>} /></ActionSheet>;
  }
  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title="Withdraw" description="Withdrawals go only to saved addresses that have passed the 24-hour safety cooldown.">
      {confirmId ? (
        <div className="space-y-4 rise">
          <p className="text-sm">We emailed a confirmation code. Enter it to release this withdrawal.</p>
          <Input value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="6-digit code" className="h-14 rounded-2xl text-center num text-2xl tracking-[0.4em]" data-testid="input-confirm-code" />
          <Button className="w-full rounded-full h-12" disabled={pending || code.length < 4} onClick={() => run('confirm-withdrawal', { id: confirmId, code }, { success: 'Withdrawal confirmed', onSuccess: () => onOpenChange(false) })} data-testid="button-confirm-withdrawal">Confirm withdrawal</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <CoinNet currencies={currencies} coin={coin} setCoin={setCoin} net={net} setNet={(n) => { setNet(n); setAddrId(''); }} />
          {coin && net && (
            <>
              <div>
                <Label>Destination</Label>
                {book.length ? (
                  <Select value={addrId} onValueChange={setAddrId}>
                    <SelectTrigger className="mt-1 h-12 rounded-2xl" data-testid="select-address"><SelectValue placeholder="Choose a saved address" /></SelectTrigger>
                    <SelectContent>{book.map((a) => <SelectItem key={String(a.id)} value={String(a.id)}>{a.label} · {String(a.address).slice(0, 8)}…{String(a.address).slice(-6)}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <p className="text-sm text-muted-foreground mt-1">No saved {coin}/{net} address. Add one in the Address book tab; it becomes usable after 24 hours.</p>}
                {cooling && <p className="text-xs text-amber-600 mt-1">This address unlocks {when(addr?.usable_after)}.</p>}
              </div>
              <div>
                <div className="flex justify-between"><Label>Amount</Label><button className="text-xs text-primary num" onClick={() => setAmt(maxAmt.toFixed())} data-testid="button-max">Max {amount(maxAmt)}</button></div>
                <Input type="number" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className="mt-1 h-12 rounded-2xl num" data-testid="input-withdraw-amount" />
                {tooLow && <p className="text-xs text-destructive mt-1">Minimum {amount(cur?.min_withdraw)} {coin}.</p>}
                {tooHigh && <p className="text-xs text-destructive mt-1">Maximum {amount(cur?.max_withdraw)} {coin}.</p>}
              </div>
              <div className="rounded-2xl bg-muted p-4 text-sm space-y-1 num">
                <div className="flex justify-between font-semibold"><span>Recipient gets</span><span data-testid="text-recipient">{amount(amtD)} {coin}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fee (charged on top)</span><span>{amount(feeVal)} {coin}</span></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span>Total debit from balance</span><span data-testid="text-total-debit">{amount(totalDebit)} {coin}</span></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>Available</span><span>{amount(avail)} {coin}</span></div>
                {totalDebit.gt(avail) && <p className="text-xs text-destructive">Amount plus fee exceeds your available balance.</p>}
              </div>
              {totp && <div><Label>Authenticator code</Label><Input value={code} onChange={(e) => setCode(e.target.value.trim())} className="mt-1 h-12 rounded-2xl num text-center tracking-[0.3em]" data-testid="input-totp" /></div>}
              {!totp && <p className="text-xs text-muted-foreground">An email confirmation code will be sent after you submit. If email delivery is unavailable you will see a clear error and no funds move. Enable 2FA in Profile to confirm instantly.</p>}
              <label className="flex items-start gap-3 text-sm"><Checkbox checked={terms} onCheckedChange={(v) => setTerms(v === true)} data-testid="checkbox-withdraw-terms" />I checked the address and network. Blockchain transfers cannot be reversed.</label>
              <Button className="w-full rounded-full h-12" data-testid="button-submit-withdraw"
                disabled={pending || !addr || !!cooling || !terms || amtD.lte(0) || tooLow || tooHigh || totalDebit.gt(avail) || (totp && code.length < 6)}
                onClick={() => run('withdraw', { currency: coin, network: net, address: addr?.address, memo: addr?.memo, amount: amt, terms: true, code: totp ? code : undefined }, {
                  success: 'Withdrawal requested',
                  onSuccess: (res) => {
                    const wd = (res.withdrawal as R) || res;
                    if (!totp && (wd.status === 'pending_confirm' || res.requires_confirmation)) setConfirmId(String(wd.id ?? res.id));
                    else onOpenChange(false);
                  },
                })}>Request withdrawal</Button>
            </>
          )}
        </div>
      )}
    </ActionSheet>
  );
}

const DEP_STEPS = ['Submitted', 'In review', 'Credited'];
const depAt = (s: string) => (s === 'approved' ? 2 : s === 'rejected' ? 2 : s === 'needs_info' ? 1 : 1);
const WD_STEPS = ['Requested', 'Processing', 'Sent'];
const wdAt = (s: string) => (['sent'].includes(s) ? 2 : ['queued', 'processing', 'manual_fallback'].includes(s) ? 1 : ['rejected', 'failed'].includes(s) ? 2 : 0);

export default function WalletPage() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { state, user, booting, workspaceLoading, workspaceError, refetch } = usePlatform();
  const { run, pending } = useRun('user');
  const [sheet, setSheet] = useState<'deposit' | 'withdraw' | null>(null);
  const [fCur, setFCur] = useState('all');
  const [fType, setFType] = useState('all');
  const [reply, setReply] = useState<R | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyProof, setReplyProof] = useState('');
  const [addr, setAddr] = useState({ label: '', currency: '', network: '', address: '', memo: '' });
  const [fab, setFab] = useState(false);

  useEffect(() => {
    const s = new URLSearchParams(search).get('sheet');
    if (s === 'deposit' || s === 'withdraw') setSheet(s);
  }, [search]);
  const ledger = list(state.ledger);
  const types = useMemo(() => Array.from(new Set(ledger.map((l) => String(l.type)))), [ledger]);

  if (booting || workspaceLoading) return <PageSkeleton />;
  const currencies = list(state.currencies).filter((c) => c.enabled !== false);
  if (!user) return (
    <div className="space-y-5">
      <PageHeader title={t('wallet')} icon={WalletIcon} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">{currencies.map((c) => <div key={String(c.code)} className="rounded-3xl border bg-card p-4 flex items-center gap-3"><CoinIcon code={String(c.code)} /><div><div className="font-semibold">{c.code}</div><div className="num text-sm text-muted-foreground">0.00</div></div></div>)}</div>
      <SignInPrompt />
    </div>
  );
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;

  const closeSheet = (o: boolean) => { if (!o) { setSheet(null); if (search) navigate('/wallet'); } };
  const shownLedger = ledger.filter((l) => (fCur === 'all' || l.currency === fCur) && (fType === 'all' || l.type === fType));
  const wallets = list(state.wallets);
  const codes = currencies.length ? currencies.map((c) => String(c.code)) : wallets.map((w) => String(w.currency));
  const nets = list(currencies.find((c) => c.code === addr.currency)?.networks);
  const regex = nets.find((n) => n.name === addr.network)?.address_regex;
  const addrValid = !addr.address || !regex || new RegExp(String(regex)).test(addr.address);

  return (
    <div>
      <PageHeader title={t('wallet')} icon={WalletIcon} action={
        <div className="hidden md:flex gap-2">
          <Button className="rounded-full" onClick={() => setSheet('deposit')} data-testid="button-deposit"><ArrowDownToLine className="w-4 h-4 me-1.5" />{t('deposit')}</Button>
          <Button variant="outline" className="rounded-full" onClick={() => setSheet('withdraw')} data-testid="button-withdraw"><ArrowUpFromLine className="w-4 h-4 me-1.5" />{t('withdraw')}</Button>
        </div>} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {codes.map((c, i) => {
          const w = wallets.find((x) => x.currency === c);
          return (
            <div key={c} className="rounded-3xl border bg-card p-4 rise" style={{ animationDelay: `${i * 40}ms` }} data-testid={`card-wallet-${c}`}>
              <div className="flex items-center gap-2"><CoinIcon code={c} size={28} /><span className="font-semibold">{c}</span></div>
              <div className="num text-xl font-semibold mt-3">{amount(w?.balance)}</div>
              <div className="num text-[11px] text-muted-foreground">Locked {amount(w?.locked)}</div>
            </div>
          );
        })}
      </div>
      <Tabs defaultValue="history">
        <TabsList className="rounded-full h-11 p-1 mb-4 w-full md:w-auto overflow-x-auto no-scrollbar justify-start">
          <TabsTrigger value="history" className="rounded-full" data-testid="tab-history">{t('transactions')}</TabsTrigger>
          <TabsTrigger value="deposits" className="rounded-full" data-testid="tab-deposits">Deposits</TabsTrigger>
          <TabsTrigger value="withdrawals" className="rounded-full" data-testid="tab-withdrawals">Withdrawals</TabsTrigger>
          <TabsTrigger value="book" className="rounded-full" data-testid="tab-book">Address book</TabsTrigger>
        </TabsList>
        <TabsContent value="history">
          <div className="flex flex-wrap gap-2 mb-3">
            <Select value={fCur} onValueChange={setFCur}><SelectTrigger className="w-32 rounded-full" data-testid="select-filter-currency"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All coins</SelectItem>{codes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            <Select value={fType} onValueChange={setFType}><SelectTrigger className="w-40 rounded-full" data-testid="select-filter-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{types.map((c) => <SelectItem key={c} value={c}>{ledgerLabel(c)}</SelectItem>)}</SelectContent></Select>
            <a href={exportUrl('ledger')} className="ms-auto inline-flex items-center gap-1.5 text-sm rounded-full border px-4 py-2 hover:bg-muted" data-testid="link-export-ledger"><Download className="w-4 h-4" />CSV</a>
          </div>
          {shownLedger.length ? (
            <div className="rounded-3xl border bg-card divide-y">
              {shownLedger.map((l) => (
                <div key={String(l.id)} className="flex items-center gap-3 p-4" data-testid={`row-ledger-${l.id}`}>
                  <CoinIcon code={String(l.currency)} size={30} />
                  <div className="flex-1 min-w-0"><div className="text-sm font-medium capitalize">{ledgerLabel(l.type)}</div><div className="text-xs text-muted-foreground">{when(l.created_at)}</div></div>
                  <div className="text-end"><div className={cn('num font-semibold', !D(l.amount).isNegative() ? 'text-emerald-600 dark:text-emerald-400' : '')}>{!D(l.amount).isNegative() ? '+' : ''}{amount(l.amount)}</div><div className="num text-[11px] text-muted-foreground">Bal {amount(l.balance_after)}</div></div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={WalletIcon} title="No transactions yet" body="Credits, rental charges and refunds appear here, each tied to a ledger entry." />}
        </TabsContent>
        <TabsContent value="deposits" className="space-y-3">
          <div className="flex justify-end"><a href={exportUrl('deposits')} className="inline-flex items-center gap-1.5 text-sm rounded-full border px-4 py-2 hover:bg-muted"><Download className="w-4 h-4" />CSV</a></div>
          {list(state.deposits).length ? list(state.deposits).map((d) => (
            <div key={String(d.id)} className="rounded-3xl border bg-card p-4" data-testid={`card-deposit-${d.id}`}>
              <div className="flex items-center gap-3"><CoinIcon code={String(d.currency)} size={30} /><div className="flex-1"><div className="font-semibold num">{amount(d.amount_credited || d.amount_claimed)} {d.currency}</div><div className="text-xs text-muted-foreground">{d.network} · {when(d.created_at)}</div></div><StatusChip status={d.status} /></div>
              <Tracker steps={d.status === 'rejected' ? ['Submitted', 'In review', 'Rejected'] : DEP_STEPS} at={depAt(String(d.status))} failed={d.status === 'rejected'} />
              {d.review_note && <p className="text-sm mt-3 rounded-2xl bg-muted p-3">{d.review_note}</p>}
              {d.status === 'needs_info' && <Button size="sm" className="mt-3 rounded-full" onClick={() => { setReply(d); setReplyBody(''); setReplyProof(''); }} data-testid={`button-reply-deposit-${d.id}`}><MessageSquareReply className="w-4 h-4 me-1.5" />Reply with info</Button>}
              {d.proof_image && <a href={fileUrl(String(d.proof_image))} target="_blank" rel="noreferrer" className="text-xs text-primary underline mt-2 inline-block">View proof</a>}
            </div>
          )) : <EmptyState icon={ArrowDownToLine} title="No deposits yet" action={<Button className="rounded-full" onClick={() => setSheet('deposit')}>{t('deposit')}</Button>} />}
        </TabsContent>
        <TabsContent value="withdrawals" className="space-y-3">
          <div className="flex justify-end"><a href={exportUrl('withdrawals')} className="inline-flex items-center gap-1.5 text-sm rounded-full border px-4 py-2 hover:bg-muted"><Download className="w-4 h-4" />CSV</a></div>
          {list(state.withdrawals).length ? list(state.withdrawals).map((w) => (
            <div key={String(w.id)} className="rounded-3xl border bg-card p-4" data-testid={`card-withdrawal-${w.id}`}>
              <div className="flex items-center gap-3"><CoinIcon code={String(w.currency)} size={30} /><div className="flex-1 min-w-0"><div className="font-semibold num">{amount(w.amount)} {w.currency}</div><div className="text-xs text-muted-foreground truncate">{w.network} · {String(w.address)}</div></div><StatusChip status={w.status} /></div>
              <Tracker steps={['rejected', 'failed'].includes(String(w.status)) ? ['Requested', 'Processing', 'Rejected, refunded'] : WD_STEPS} at={wdAt(String(w.status))} failed={['rejected', 'failed'].includes(String(w.status))} />
              {w.txid && <p className="text-xs mt-2 font-mono break-all">TXID {w.txid}</p>}
              {w.fail_reason && <p className="text-sm mt-2 text-destructive">{w.fail_reason}</p>}
            </div>
          )) : <EmptyState icon={ArrowUpFromLine} title="No withdrawals yet" />}
        </TabsContent>
        <TabsContent value="book">
          <div className="grid lg:grid-cols-[1fr_380px] gap-4">
            <div className="space-y-2">
              {list(state.addressBook).length ? list(state.addressBook).map((a) => {
                const cool = a.usable_after && new Date(String(a.usable_after)).getTime() > Date.now();
                return (
                  <div key={String(a.id)} className="rounded-2xl border bg-card p-4 flex items-center gap-3" data-testid={`row-address-${a.id}`}>
                    <CoinIcon code={String(a.currency)} size={28} />
                    <div className="flex-1 min-w-0"><div className="font-medium text-sm">{a.label} <span className="text-muted-foreground">· {a.network}</span></div><div className="text-xs font-mono truncate">{a.address}</div>{cool && <div className="text-[11px] text-amber-600">Cooling down until {when(a.usable_after)}</div>}</div>
                    <Button size="icon" variant="ghost" className="rounded-full" disabled={pending} onClick={() => run('address-delete', { id: a.id }, { success: 'Address removed' })} data-testid={`button-delete-address-${a.id}`}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                );
              }) : <EmptyState icon={BookUser} title="Address book is empty" body="Save destination addresses here. New addresses unlock after 24 hours." />}
            </div>
            <div className="rounded-3xl border bg-card p-5 space-y-3 h-fit">
              <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" />New address</h3>
              <Input placeholder="Label" value={addr.label} onChange={(e) => setAddr({ ...addr, label: e.target.value })} className="rounded-xl" data-testid="input-address-label" />
              <div className="grid grid-cols-2 gap-2">
                <Select value={addr.currency} onValueChange={(v) => setAddr({ ...addr, currency: v, network: '' })}><SelectTrigger className="rounded-xl" data-testid="select-address-currency"><SelectValue placeholder="Coin" /></SelectTrigger><SelectContent>{codes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                <Select value={addr.network} onValueChange={(v) => setAddr({ ...addr, network: v })}><SelectTrigger className="rounded-xl" data-testid="select-address-network"><SelectValue placeholder="Network" /></SelectTrigger><SelectContent>{nets.map((n) => <SelectItem key={String(n.name)} value={String(n.name)}>{n.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <Input placeholder="Address" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value.trim() })} className={cn('rounded-xl font-mono text-xs', !addrValid && 'border-destructive')} data-testid="input-address" />
              {!addrValid && <p className="text-xs text-destructive">This does not look like a valid {addr.network} address.</p>}
              <Input placeholder="Memo / tag (optional)" value={addr.memo} onChange={(e) => setAddr({ ...addr, memo: e.target.value })} className="rounded-xl" data-testid="input-address-memo" />
              <Button className="w-full rounded-full" disabled={pending || !addr.label || !addr.currency || !addr.network || !addr.address || !addrValid} data-testid="button-save-address"
                onClick={() => run('address-create', { ...addr, memo: addr.memo || undefined }, { success: 'Address saved. Usable in 24 hours.', onSuccess: () => setAddr({ label: '', currency: '', network: '', address: '', memo: '' }) })}>Save address</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="md:hidden fixed end-4 bottom-24 z-30 flex flex-col items-end gap-2">
        {fab && (
          <>
            <button onClick={() => { setSheet('withdraw'); setFab(false); }} className="rise press flex items-center gap-2 rounded-2xl bg-card border shadow-lg px-4 py-3 text-sm font-medium" data-testid="fab-withdraw"><ArrowUpFromLine className="w-4 h-4" />{t('withdraw')}</button>
            <button onClick={() => { setSheet('deposit'); setFab(false); }} className="rise press flex items-center gap-2 rounded-2xl bg-card border shadow-lg px-4 py-3 text-sm font-medium" data-testid="fab-deposit"><ArrowDownToLine className="w-4 h-4" />{t('deposit')}</button>
          </>
        )}
        <button onClick={() => setFab(!fab)} className="press w-14 h-14 rounded-2xl brand-grad text-[#06101d] shadow-xl grid place-items-center" data-testid="button-fab"><Plus className={cn('w-6 h-6 transition-transform', fab && 'rotate-45')} /></button>
      </div>

      <DepositSheet open={sheet === 'deposit'} onOpenChange={closeSheet} />
      <WithdrawSheet open={sheet === 'withdraw'} onOpenChange={closeSheet} />
      <ActionSheet open={!!reply} onOpenChange={(o) => !o && setReply(null)} title="Reply to review" description={String(reply?.review_note || '')}>
        <div className="space-y-3">
          <Textarea rows={4} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Add the requested details" className="rounded-2xl" data-testid="input-deposit-reply" />
          <FilePick value={replyProof} onChange={setReplyProof} accept="image/*" label="Attach extra proof" testId="input-reply-proof" />
          <Button className="w-full rounded-full h-12" disabled={pending || !replyBody} onClick={() => reply && run('deposit-reply', { id: reply.id, body: replyBody, proof_image: replyProof || undefined }, { success: 'Reply sent', onSuccess: () => setReply(null) })} data-testid="button-send-deposit-reply">Send</Button>
        </div>
      </ActionSheet>
    </div>
  );
}
