import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Users, Copy, Check, Share2, Send, GitBranch, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlatform, list } from '@/lib/platform';
import { type R } from '@/lib/api';
import { amount, num, when, maskEmail, dsum } from '@/lib/format';
import { PageHeader, PageSkeleton, ErrorState, EmptyState, StatusChip, SignInPrompt, Stat } from '@/components/app/kit';

export default function ReferralsPage() {
  const { t } = useTranslation();
  const { state, user, brand, settings, booting, workspaceLoading, workspaceError, refetch } = usePlatform();
  const [copied, setCopied] = useState(false);
  if (booting || workspaceLoading) return <PageSkeleton />;
  const cfg = (settings.referral_config as R) || {};
  if (!user) return (
    <div className="min-w-0 max-w-full space-y-5">
      <PageHeader title={t('referrals')} icon={Users} />
      <div className="rounded-3xl border bg-card p-6"><h3 className="font-semibold">How referrals work</h3><p className="text-sm text-muted-foreground mt-1">Share your link. When invited members deposit or rent, commissions are credited through the ledger under the current program rules{cfg.levels ? `, across ${cfg.levels} level(s)` : ''}.</p></div>
      <SignInPrompt />
    </div>
  );
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;

  const link = `${window.location.origin}/register?ref=${user.referral_code ?? ''}`;
  const shareText = `Join me on ${brand.name}: ${link}`;
  const refs = list(state.referrals);
  const comm = list(state.commissions);
  const sum = (s?: string) => dsum(comm.filter((c) => !s || c.status === s).map((c) => c.amount));
  const levels = [1, 2, 3].map((l) => refs.filter((r) => num(r.level) === l));

  return (
    <div className="min-w-0 max-w-full">
      <PageHeader title={t('referrals')} icon={Users} sub={cfg.enabled === false ? 'The program is currently paused.' : undefined} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
        <div className="vault-card min-w-0 rounded-[28px] p-4 sm:p-6 relative overflow-hidden">
          <div className="absolute inset-0 hex-pattern" />
          <div className="relative flex min-w-0 flex-col sm:flex-row gap-6 items-start">
            <div className="shrink-0 max-w-full bg-[#f4f7fa] p-3 rounded-2xl"><QRCodeSVG value={link} size={128} fgColor="#0B1A2E" bgColor="#f4f7fa" /></div>
            <div className="w-full flex-1 min-w-0">
              <div className="text-xs uppercase tracking-[0.2em] text-white/60">Your code</div>
              <div className="num break-all text-2xl sm:text-3xl font-semibold mt-1" data-testid="text-ref-code">{user.referral_code || '—'}</div>
              <div className="mt-3 flex min-w-0 max-w-full items-center gap-2 rounded-2xl bg-white/10 p-2 ps-3"><span className="min-w-0 text-xs truncate flex-1" title={link}>{link}</span>
                <Button size="sm" className="rounded-full bg-white text-[#0B1A2E] hover:bg-white/90" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} data-testid="button-copy-link">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</Button></div>
              <div className="flex flex-wrap gap-2 mt-3 [&>a]:min-h-9 [&>a]:py-2">
                {'share' in navigator && <Button size="sm" variant="outline" className="rounded-full bg-transparent border-white/30 text-white" onClick={() => navigator.share({ text: shareText }).catch(() => {})} data-testid="button-share"><Share2 className="w-4 h-4 me-1.5" />Share</Button>}
                <a href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Join me on ${brand.name}`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 text-sm" data-testid="link-share-telegram"><Send className="w-4 h-4" />Telegram</a>
                <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full border border-white/30 px-3 text-sm" data-testid="link-share-whatsapp">WhatsApp</a>
              </div>
            </div>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 content-start [&>div]:min-w-0 [&_.num]:break-all [&_.num]:text-lg sm:[&_.num]:text-2xl">
          <Stat label="Invited" value={refs.length} icon={Users} />
          <Stat label="Total earned" value={amount(sum())} icon={Coins} />
          <Stat label="Pending" value={amount(sum('pending'))} />
          <Stat label="Paid" value={amount(sum('paid').plus(sum('credited')))} />
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5 mt-6">
        <section className="min-w-0">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><GitBranch className="w-4 h-4 text-primary" />Referral tree</h2>
          {refs.length ? (
            <div className="space-y-3">
              {levels.map((lv, i) => lv.length > 0 && (
                <div key={i} className="rounded-3xl border bg-card p-4" style={{ marginInlineStart: i * 16 }}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Level {i + 1} · {lv.length}</div>
                  <div className="space-y-1.5">{lv.map((r) => <div key={String(r.id)} className="flex min-w-0 flex-col sm:flex-row sm:justify-between gap-1 text-sm"><span className="min-w-0 break-all">{maskEmail(String(r.email || r.referred_email || r.username || ''))}</span><span className="text-xs text-muted-foreground">{when(r.created_at)}</span></div>)}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={Users} title="No referrals yet" body="Share your link to start building your tree." />}
        </section>
        <section className="min-w-0">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Coins className="w-4 h-4 text-primary" />Commissions</h2>
          {comm.length ? <div className="min-w-0 rounded-3xl border bg-card divide-y">{comm.map((c) => <div key={String(c.id)} className="flex min-w-0 flex-wrap items-center gap-3 p-4 text-sm"><div className="w-full sm:w-auto sm:flex-1 min-w-0"><div className="break-words font-medium capitalize">{String(c.source_type || 'commission').replace(/_/g, ' ')} · L{c.level}</div><div className="text-xs text-muted-foreground">{when(c.created_at)}</div></div><span className="num max-w-full break-all font-semibold">{amount(c.amount)} {c.currency}</span><StatusChip status={c.status} /></div>)}</div> : <EmptyState icon={Coins} title="No commissions yet" />}
        </section>
      </div>
    </div>
  );
}
