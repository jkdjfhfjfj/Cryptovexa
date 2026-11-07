import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Bell, CheckCheck, FileText, CalendarClock, Upload, IdCard, Camera, Home as HomeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlatform, list, useRun } from '@/lib/platform';
import { type R } from '@/lib/api';
import { ago, when, titleCase } from '@/lib/format';
import { PageHeader, PageSkeleton, ErrorState, EmptyState, StatusChip, SignInPrompt, FilePick } from '@/components/app/kit';
import { cn } from '@/lib/utils';

const ITEM_META: Record<string, { label: string; icon: typeof IdCard; hint: string }> = {
  id_front: { label: 'ID, front side', icon: IdCard, hint: 'Passport, national ID or driving licence. All corners visible.' },
  id_back: { label: 'ID, back side', icon: IdCard, hint: 'Same document, reverse side.' },
  selfie: { label: 'Selfie', icon: Camera, hint: 'Face clearly visible holding the same ID.' },
  proof_of_address: { label: 'Proof of address', icon: HomeIcon, hint: 'Utility bill or bank statement under 3 months old.' },
};

export function KycPage() {
  const { t } = useTranslation();
  const { state, user, booting, workspaceLoading, workspaceError, refetch } = usePlatform();
  const { run, pending } = useRun('user');
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  if (booting || workspaceLoading) return <PageSkeleton />;
  if (!user) return <SignInPrompt />;
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;
  const reqs = list(state.kycRequests);
  const req = reqs.find((r) => r.status === 'requested' || r.status === 'rejected') || reqs[0];
  if (!req) return <><PageHeader title={t('kyc')} icon={ShieldCheck} /><EmptyState icon={ShieldCheck} title="No verification needed" body="If our team ever needs to verify your identity, you will see the request here and by email." /></>;

  const items: string[] = Array.isArray(req.required_items) ? req.required_items : [];
  const existing = list(req.documents);
  const docFor = (k: string) => existing.find((d) => d.type === k);
  const needs = items.filter((k) => !docFor(k) || docFor(k)?.status === 'rejected');
  const editable = req.status === 'requested' || req.status === 'rejected';
  const cur = needs[step];
  const statusIdx = ['requested', 'submitted', 'approved'].indexOf(String(req.status));

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title={t('kyc')} icon={ShieldCheck} sub={req.deadline ? `Deadline ${when(req.deadline)}` : undefined} />
      <div className="flex items-center gap-1 mb-6">
        {['Requested', 'Submitted', req.status === 'rejected' ? 'Rejected' : 'Approved'].map((s, i) => <div key={s} className="flex-1"><div className={cn('h-1.5 rounded-full', (req.status === 'rejected' ? i <= 2 : i <= statusIdx) ? (req.status === 'rejected' && i === 2 ? 'bg-destructive' : 'brand-grad') : 'bg-muted')} /><div className="text-[11px] mt-1">{s}</div></div>)}
      </div>
      {req.note && <div className="rounded-2xl bg-muted p-4 text-sm mb-4">{req.note}</div>}
      {req.block_withdrawals && <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm mb-4 flex gap-2"><CalendarClock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />Withdrawals stay paused until verification is approved.</div>}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {items.map((k) => { const d = docFor(k); const m = ITEM_META[k] || { label: titleCase(k), icon: FileText, hint: '' }; return (
          <div key={k} className="rounded-2xl border bg-card p-4 flex items-start gap-3" data-testid={`kyc-item-${k}`}><m.icon className="w-5 h-5 text-primary mt-0.5" /><div className="flex-1"><div className="font-medium text-sm">{m.label}</div>{d?.reject_reason && <p className="text-xs text-destructive mt-1">{d.reject_reason}</p>}</div><StatusChip status={d ? String(d.status || 'submitted') : docs[k] ? 'submitted' : 'requested'} /></div>
        ); })}
      </div>
      {editable && needs.length > 0 && (
        <div className="rounded-3xl border bg-card p-5 rise">
          <div className="text-xs text-muted-foreground">Step {Math.min(step + 1, needs.length)} of {needs.length}</div>
          {cur ? (
            <>
              <h3 className="font-semibold text-lg mt-1">{ITEM_META[cur]?.label || titleCase(cur)}</h3>
              <p className="text-sm text-muted-foreground mb-4">{ITEM_META[cur]?.hint}</p>
              <FilePick value={docs[cur]} onChange={(p) => setDocs({ ...docs, [cur]: p })} accept="image/*,application/pdf" label="Upload document" testId={`input-kyc-${cur}`} />
              <div className="flex gap-2 mt-4">
                {step > 0 && <Button variant="outline" className="rounded-full" onClick={() => setStep(step - 1)}>Back</Button>}
                <Button className="rounded-full flex-1" disabled={!docs[cur]} onClick={() => setStep(step + 1)} data-testid="button-kyc-next">Next</Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-semibold text-lg mt-1">Review and submit</h3>
              <p className="text-sm text-muted-foreground">Files are stored privately and only reviewed by authorised staff.</p>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="rounded-full" onClick={() => setStep(0)}>Start over</Button>
                <Button className="rounded-full flex-1" disabled={pending || needs.some((k) => !docs[k])} data-testid="button-kyc-submit"
                  onClick={() => run('kyc-submit', { id: req.id, documents: needs.map((k) => ({ type: k, objectPath: docs[k] })) }, { success: 'Documents submitted', onSuccess: () => { setDocs({}); setStep(0); } })}><Upload className="w-4 h-4 me-1.5" />Submit documents</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const { state, user, booting, workspaceLoading, workspaceError, refetch } = usePlatform();
  const { run, pending } = useRun('user');
  if (booting || workspaceLoading) return <PageSkeleton />;
  if (!user) return <><PageHeader title={t('notifications')} icon={Bell} /><SignInPrompt /></>;
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;
  const items = list(state.notifications);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title={t('notifications')} icon={Bell} action={items.some((n) => !n.read) && <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => run('notifications-read', {}, { success: false })} data-testid="button-mark-read"><CheckCheck className="w-4 h-4 me-1.5" />{t('markAllRead')}</Button>} />
      {items.length ? <div className="rounded-3xl border bg-card divide-y">{items.map((n: R) => (
        <div key={String(n.id)} className={cn('flex gap-3 p-4', !n.read && 'bg-accent/30')} data-testid={`row-notification-${n.id}`}>
          <span className={cn('w-2 h-2 rounded-full mt-2 shrink-0', n.read ? 'bg-transparent' : 'bg-primary')} />
          <div className="flex-1"><div className="font-medium text-sm">{n.title}</div><p className="text-sm text-muted-foreground">{n.body}</p><div className="text-[11px] text-muted-foreground mt-1">{ago(n.created_at)}</div></div>
          {n.link && <Link href={String(n.link)} className="text-xs text-primary self-center">Open</Link>}
        </div>))}</div> : <EmptyState icon={Bell} title="You are all caught up" />}
    </div>
  );
}

const LEGAL_TITLES: Record<string, string> = { terms: 'Terms of Service', privacy: 'Privacy Policy', risk: 'Risk Disclosure', deposit_terms: 'Deposit Terms', withdrawal_terms: 'Withdrawal Terms' };

export function LegalPage() {
  const { key } = useParams<{ key: string }>();
  const { state, brand, booting } = usePlatform();
  const { i18n } = useTranslation();
  if (booting) return <PageSkeleton />;
  const pages = list(state.legalPages).filter((p) => p.key === key);
  const page = pages.find((p) => p.language === i18n.language) || pages.find((p) => p.language === 'en') || pages[0];
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-6">{Object.entries(LEGAL_TITLES).map(([k, v]) => <Link key={k} href={`/legal/${k}`} className={cn('shrink-0 rounded-full border px-4 py-1.5 text-sm', k === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card')} data-testid={`link-legal-${k}`}>{v}</Link>)}</div>
      <PageHeader title={LEGAL_TITLES[key] || titleCase(key)} icon={FileText} sub={brand.name} />
      {page ? <article className="prose prose-slate dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: String(page.body) }} data-testid="legal-body" /> : <EmptyState icon={FileText} title="Not yet published" body="This document has not been published in your language yet." />}
      {key === 'risk' && <p className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">Renting assets and holding crypto involve risk. Nothing on {brand.name} is a promise or guarantee of returns.</p>}
    </div>
  );
}
