import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useTranslation } from 'react-i18next';
import { LifeBuoy, Search, BookOpen, ThumbsUp, ThumbsDown, MessageSquarePlus, Ticket, ArrowLeft, Send, Lock, ChevronRight } from 'lucide-react';
import { userAction } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { usePlatform, list, useRun } from '@/lib/platform';
import { csrfOpts, errorMessage, fileUrl, type R } from '@/lib/api';
import { ago, titleCase, cooldownAdjective, withdrawalCooldownMinutes } from '@/lib/format';
import { PageHeader, PageSkeleton, ErrorState, EmptyState, StatusChip, SignInPrompt, ActionSheet, FilePick } from '@/components/app/kit';
import { cn } from '@/lib/utils';

const cooldownAwareArticleBody = (body: unknown, settings: R) =>
  String(body || '').replace(/24-hour security cooldown/gi, `${cooldownAdjective(withdrawalCooldownMinutes(settings))} security cooldown`);

const useArticles = () => {
  const { state } = usePlatform();
  const { i18n } = useTranslation();
  const all = list(state.articles).filter((a) => a.published !== false);
  const local = all.filter((a) => !a.language || a.language === i18n.language);
  return local.length ? local : all.filter((a) => !a.language || a.language === 'en');
};

function TicketForm({ onDone }: { onDone: () => void }) {
  const arts = useArticles();
  const { run, pending } = useRun('user');
  const [f, setF] = useState({ subject: '', body: '', category: 'general', priority: 'normal', attach: '' });
  const words = f.subject.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const sugg = words.length ? arts.filter((a) => words.some((w) => String(a.title).toLowerCase().includes(w))).slice(0, 3) : [];
  return (
    <div className="space-y-3">
      <div><Label>Subject</Label><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className="mt-1 rounded-xl" data-testid="input-ticket-subject" /></div>
      {sugg.length > 0 && <div className="rounded-2xl bg-accent/50 p-3 space-y-1"><div className="text-xs font-semibold">These articles may help</div>{sugg.map((a) => <Link key={String(a.id)} href={`/help/article/${a.slug}`} className="block text-sm text-primary underline">{a.title}</Link>)}</div>}
      <div className="grid grid-cols-2 gap-2">
        <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger className="rounded-xl" data-testid="select-ticket-category"><SelectValue /></SelectTrigger><SelectContent>{['general', 'deposits', 'withdrawals', 'rentals', 'account', 'kyc', 'referrals'].map((c) => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}</SelectContent></Select>
        <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}><SelectTrigger className="rounded-xl" data-testid="select-ticket-priority"><SelectValue /></SelectTrigger><SelectContent>{['low', 'normal', 'high', 'urgent'].map((c) => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label>Describe the issue</Label><Textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="mt-1 rounded-xl" data-testid="input-ticket-body" /></div>
      <FilePick value={f.attach} onChange={(p) => setF({ ...f, attach: p })} testId="input-ticket-attach" />
      <Button className="w-full rounded-full h-12" disabled={pending || !f.subject || !f.body} data-testid="button-submit-ticket"
        onClick={() => run('ticket-create', { subject: f.subject, body: f.body, category: f.category, priority: f.priority, attachments: f.attach ? [f.attach] : [] }, { success: 'Ticket opened', onSuccess: onDone })}>Open ticket</Button>
    </div>
  );
}

export function HelpPage() {
  const { t } = useTranslation();
  const { state, user, settings, booting, bootError, refetch } = usePlatform();
  const arts = useArticles();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const cats = useMemo(() => Array.from(new Set(arts.map((a) => String(a.category || 'General')))), [arts]);
  if (booting) return <PageSkeleton />;
  if (bootError) return <ErrorState error={bootError} onRetry={refetch} />;
  const shown = arts.filter((a) => (cat === 'all' || (a.category || 'General') === cat) && (!q || `${a.title} ${a.body}`.toLowerCase().includes(q.toLowerCase())));
  const tickets = list(state.tickets);
  return (
    <div className="min-w-0 max-w-full">
      <div className="vault-card rounded-[28px] p-6 md:p-10 relative overflow-hidden mb-6">
        <div className="absolute inset-0 hex-pattern" />
        <div className="relative max-w-xl">
          <LifeBuoy className="w-8 h-8 text-[#5eead4]" />
          <h1 className="text-3xl font-semibold mt-3">How can we help?</h1>
          <div className="relative mt-5"><Search className="absolute start-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deposits, rentals, 2FA…" className="ps-11 h-12 rounded-full bg-white/10 border-white/20 text-white placeholder:text-white/50" data-testid="input-help-search" /></div>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="min-w-0">
          <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 mb-4" aria-label="Help categories">
            {['all', ...cats].map((c) => <button key={c} onClick={() => setCat(c)} className={cn('press max-w-full rounded-full border px-4 py-1.5 text-sm', cat === c ? 'bg-primary text-primary-foreground border-primary' : 'bg-card')} data-testid={`filter-help-${c}`}>{c === 'all' ? t('all') : c}</button>)}
          </div>
          {shown.length ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] sm:grid-cols-[repeat(2,minmax(0,1fr))] gap-3">{shown.map((a) => (
            <Link key={String(a.id)} href={`/help/article/${a.slug}`} className="press min-w-0 [overflow-wrap:anywhere] rounded-3xl border bg-card p-5 hover:border-primary/50 block" data-testid={`card-article-${a.slug}`}>
              <BookOpen className="w-5 h-5 text-primary" /><h3 className="font-semibold mt-3">{a.title}</h3><p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cooldownAwareArticleBody(a.body, settings).replace(/<[^>]+>/g, '').slice(0, 140)}</p><span className="text-[11px] text-muted-foreground mt-3 block">{a.category}</span>
            </Link>))}</div> : <EmptyState icon={Search} title="No articles found" body="Try different words, or open a ticket and a person will reply." />}
        </div>
        <aside className="min-w-0 space-y-3">
          <div className="rounded-3xl border bg-card p-5">
            <h3 className="font-semibold flex items-center gap-2"><Ticket className="w-4 h-4" />{t('tickets')}</h3>
            {user ? (
              <>
                <div className="mt-3 space-y-2">{tickets.slice(0, 5).map((tk) => <Link key={String(tk.id)} href={`/help/tickets/${tk.id}`} className="flex items-center gap-2 rounded-2xl hover:bg-muted p-2 -mx-2" data-testid={`link-ticket-${tk.id}`}><span className="flex-1 text-sm truncate">{tk.subject}</span><StatusChip status={tk.status} /></Link>)}{!tickets.length && <p className="text-sm text-muted-foreground">No tickets yet.</p>}</div>
                <div className="flex gap-2 mt-4"><Button className="rounded-full flex-1" onClick={() => setOpen(true)} data-testid="button-new-ticket"><MessageSquarePlus className="w-4 h-4 me-1.5" />{t('newTicket')}</Button>{tickets.length > 0 && <Button variant="outline" className="rounded-full" onClick={() => navigate('/help/tickets')} data-testid="button-all-tickets">All</Button>}</div>
              </>
            ) : <p className="text-sm text-muted-foreground mt-2"><Link href="/login" className="text-primary underline">Sign in</Link> to contact a person.</p>}
          </div>
        </aside>
      </div>
      <ActionSheet open={open} onOpenChange={setOpen} title={t('newTicket')}><TicketForm onDone={() => setOpen(false)} /></ActionSheet>
    </div>
  );
}

export function ArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const { booting, user, settings } = usePlatform();
  const arts = useArticles();
  const { toast } = useToast();
  const [voted, setVoted] = useState<boolean | null>(null);
  const [voting, setVoting] = useState(false);
  if (booting) return <PageSkeleton />;
  const a = arts.find((x) => x.slug === slug);
  if (!a) return <EmptyState icon={BookOpen} title="Article not found" action={<Link href="/help" className="text-primary font-semibold">Help Center</Link>} />;
  const related = arts.filter((x) => x.category === a.category && x.id !== a.id).slice(0, 4);
  const vote = async (helpful: boolean) => {
    setVoting(true);
    try {
      await userAction('article-vote', { id: String(a.id), helpful, request_id: crypto.randomUUID() }, csrfOpts());
      setVoted(helpful);
    } catch (e) {
      toast({ title: 'Vote not saved', description: errorMessage(e), variant: 'destructive' });
    } finally { setVoting(false); }
  };
  return (
    <div className="min-w-0 max-w-3xl mx-auto [overflow-wrap:anywhere]">
      <Link href="/help" className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4" data-testid="link-back-help"><ArrowLeft className="w-4 h-4 rtl:rotate-180" />Help Center</Link>
      <span className="text-xs uppercase tracking-wider text-primary">{a.category}</span>
      <h1 className="text-3xl font-semibold tracking-tight mt-1 mb-6">{a.title}</h1>
      <article className="prose prose-slate dark:prose-invert min-w-0 max-w-none prose-img:rounded-2xl [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto" dangerouslySetInnerHTML={{ __html: cooldownAwareArticleBody(a.body, settings) }} data-testid="article-body" />
      <div className="mt-10 rounded-3xl border bg-card p-5 flex flex-wrap items-center gap-3">
        <span className="w-full sm:w-auto sm:flex-1 font-medium">{voted === null ? 'Was this helpful?' : 'Thanks for the feedback.'}</span>
        {voted === null && <><Button variant="outline" className="rounded-full" disabled={voting} onClick={() => vote(true)} data-testid="button-helpful-yes"><ThumbsUp className="w-4 h-4 me-1.5" />Yes</Button><Button variant="outline" className="rounded-full" disabled={voting} onClick={() => vote(false)} data-testid="button-helpful-no"><ThumbsDown className="w-4 h-4 me-1.5" />No</Button></>}
        {voted === false && user && <Link href="/help" className="text-sm text-primary underline">Open a ticket</Link>}
      </div>
      {related.length > 0 && <div className="mt-8"><h2 className="font-semibold mb-3">Related</h2><div className="space-y-2">{related.map((r) => <Link key={String(r.id)} href={`/help/article/${r.slug}`} className="flex items-center rounded-2xl border bg-card p-4 hover:border-primary/50"><span className="flex-1 text-sm">{r.title}</span><ChevronRight className="w-4 h-4 rtl:rotate-180" /></Link>)}</div></div>}
    </div>
  );
}

export function TicketsPage() {
  const { state, user, booting, workspaceLoading, workspaceError, refetch } = usePlatform();
  const [open, setOpen] = useState(false);
  if (booting || workspaceLoading) return <PageSkeleton />;
  if (!user) return <SignInPrompt />;
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;
  const tickets = list(state.tickets);
  return (
    <div>
      <PageHeader title="Support tickets" icon={Ticket} action={<Button className="rounded-full" onClick={() => setOpen(true)} data-testid="button-new-ticket"><MessageSquarePlus className="w-4 h-4 me-1.5" />New</Button>} />
      {tickets.length ? <div className="rounded-3xl border bg-card divide-y">{tickets.map((tk) => <Link key={String(tk.id)} href={`/help/tickets/${tk.id}`} className="flex items-center gap-3 p-4 hover:bg-muted/50" data-testid={`row-ticket-${tk.id}`}><div className="flex-1 min-w-0"><div className="font-medium truncate">{tk.subject}</div><div className="text-xs text-muted-foreground">{titleCase(String(tk.category))} · {titleCase(String(tk.priority))} · {list(tk.messages).length} messages</div></div><StatusChip status={tk.status} /></Link>)}</div> : <EmptyState icon={Ticket} title="No tickets" body="When docs are not enough, a person is a ticket away." />}
      <ActionSheet open={open} onOpenChange={setOpen} title="New ticket"><TicketForm onDone={() => setOpen(false)} /></ActionSheet>
    </div>
  );
}

export function TicketThreadPage() {
  const { id } = useParams<{ id: string }>();
  const { state, user, booting, workspaceLoading } = usePlatform();
  const { run, pending } = useRun('user');
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState('');
  if (booting || workspaceLoading) return <PageSkeleton />;
  if (!user) return <SignInPrompt />;
  const tk = list(state.tickets).find((x) => String(x.id) === id);
  if (!tk) return <EmptyState icon={Ticket} title="Ticket not found" action={<Link href="/help/tickets" className="text-primary font-semibold">All tickets</Link>} />;
  const closed = tk.status === 'closed';
  return (
    <div className="min-w-0 max-w-3xl mx-auto [overflow-wrap:anywhere]">
      <Link href="/help/tickets" className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4"><ArrowLeft className="w-4 h-4 rtl:rotate-180" />Tickets</Link>
      <div className="flex items-start justify-between gap-3 mb-5"><div className="min-w-0"><h1 className="text-2xl font-semibold">{tk.subject}</h1><p className="text-xs text-muted-foreground mt-1">#{String(tk.id).slice(0, 8)} · {titleCase(String(tk.category))} · {titleCase(String(tk.priority))}</p></div><StatusChip status={tk.status} /></div>
      <div className="space-y-3">
        {list(tk.messages).filter((m) => !m.is_internal).map((m: R) => {
          const mine = m.author_type === 'user';
          return (
            <div key={String(m.id)} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-3xl px-4 py-3', mine ? 'bg-primary text-primary-foreground rounded-ee-md' : 'bg-card border rounded-es-md')} data-testid={`msg-${m.id}`}>
                <div className="text-[11px] opacity-70 mb-1">{mine ? 'You' : 'Support'} · {ago(m.created_at)}</div>
                <p className="text-sm whitespace-pre-line">{m.body}</p>
                {list(m.attachments).length > 0 && <div className="mt-2 flex gap-2 flex-wrap">{(m.attachments as string[]).map((p) => <a key={p} href={fileUrl(p)} target="_blank" rel="noreferrer" className="text-xs underline">Attachment</a>)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {closed ? <div className="mt-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Lock className="w-4 h-4" />This ticket is closed.</div> : (
        <div className="mt-6 rounded-3xl border bg-card p-4 space-y-3">
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply" className="rounded-2xl" data-testid="input-ticket-reply" />
          <FilePick value={attach} onChange={setAttach} testId="input-reply-attach" />
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-full" disabled={pending} onClick={() => run('ticket-close', { id: tk.id }, { success: 'Ticket closed' })} data-testid="button-close-ticket">Close ticket</Button>
            <Button className="rounded-full flex-1" disabled={pending || !body} onClick={() => run('ticket-reply', { id: tk.id, body, attachments: attach ? [attach] : [] }, { success: 'Reply sent', onSuccess: () => { setBody(''); setAttach(''); } })} data-testid="button-send-reply"><Send className="w-4 h-4 me-1.5" />Send</Button>
          </div>
        </div>
      )}
    </div>
  );
}
