import { useState } from 'react';
import { Send, Lock, Plus, Trash2, Megaphone, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { list, useRun } from '@/lib/platform';
import { fileUrl, type R } from '@/lib/api';
import { ago, titleCase } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import { StatusChip, ActionSheet, EmptyState } from '@/components/app/kit';
import { cn } from '@/lib/utils';
import { RichTextEditor, sanitizeRichHtml } from '@/components/app/rich-text-editor';
import { useAdmin, DataTable, AdminTitle, userLabel } from './shell';
import { usePrompt, Section } from './parts';

const CANNED = [
  'Thanks for reaching out. We are looking into this and will update you shortly.',
  'Your deposit is in the review queue. Reviews usually complete within a few hours.',
  'Could you share the transaction ID and a screenshot from your sending wallet?',
  'This has been resolved on our side. Please confirm everything looks right.',
];

export function AdminSupport() {
  const { state, admin } = useAdmin();
  const { run, pending } = useRun('admin');
  const [status, setStatus] = useState('open');
  const [selId, setSelId] = useState<unknown>(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const tickets = list(state.tickets);
  const rows = tickets.filter((t) => status === 'all' || t.status === status);
  const sel = tickets.find((t) => t.id === selId);
  const admins = list(state.admins);
  return (
    <div>
      <AdminTitle title="Support inbox" />
      <DataTable testId="tickets" rows={rows} onRow={(t) => setSelId(t.id)} exportType="tickets"
        toolbar={<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-40 rounded-full"><SelectValue /></SelectTrigger><SelectContent>{['all', 'open', 'awaiting_user', 'resolved', 'closed'].map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent></Select>}
        cols={[
          { key: 'subject', label: 'Subject', render: (t) => <div><div className="font-medium">{t.subject}</div><div className="text-xs text-muted-foreground">{userLabel(state, t.user_id)}</div></div> },
          { key: 'category', label: 'Category', render: (t) => titleCase(String(t.category)) },
          { key: 'priority', label: 'Priority', render: (t) => <span className={cn('text-xs font-semibold', ['high', 'urgent'].includes(String(t.priority)) && 'text-destructive')}>{titleCase(String(t.priority))}</span> },
          { key: 'assigned_to', label: 'Assignee', render: (t) => String(admins.find((a) => a.id === t.assigned_to)?.email || t.assigned_to || '—') },
          { key: 'status', label: 'Status', render: (t) => <StatusChip status={t.status} /> },
        ]} />
      <ActionSheet open={!!sel} onOpenChange={(o) => !o && setSelId(null)} title={String(sel?.subject || '')} description={sel ? userLabel(state, sel.user_id) : ''}>
        {sel && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Select value={String(sel.status)} onValueChange={(v) => run('ticket-update', { id: sel.id, status: v, priority: sel.priority, assigned_to: sel.assigned_to }, { success: 'Updated' })}><SelectTrigger className="rounded-xl h-9 text-xs" data-testid="select-ticket-status"><SelectValue /></SelectTrigger><SelectContent>{['open', 'awaiting_user', 'resolved', 'closed'].map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent></Select>
              <Select value={String(sel.priority)} onValueChange={(v) => run('ticket-update', { id: sel.id, status: sel.status, priority: v, assigned_to: sel.assigned_to }, { success: 'Updated' })}><SelectTrigger className="rounded-xl h-9 text-xs" data-testid="select-ticket-priority"><SelectValue /></SelectTrigger><SelectContent>{['low', 'normal', 'high', 'urgent'].map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent></Select>
              <Select value={String(sel.assigned_to ?? 'none')} onValueChange={(v) => run('ticket-update', { id: sel.id, status: sel.status, priority: sel.priority, assigned_to: v === 'none' ? null : v }, { success: 'Assigned' })}><SelectTrigger className="rounded-xl h-9 text-xs" data-testid="select-ticket-assignee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{admin.id && !admins.some((a) => a.id === admin.id) && <SelectItem value={String(admin.id)}>Me</SelectItem>}{admins.map((a) => <SelectItem key={String(a.id)} value={String(a.id)}>{String(a.email)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-2 max-h-[45vh] overflow-y-auto">
              {list(sel.messages).map((m) => (
                <div key={String(m.id)} className={cn('rounded-2xl p-3 text-sm', m.is_internal ? 'bg-amber-500/10 border border-amber-500/30' : m.author_type === 'user' ? 'bg-muted' : 'bg-accent/50')}>
                  <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">{m.is_internal && <Lock className="w-3 h-3" />}{m.author_type === 'user' ? 'User' : 'Staff'} · {ago(m.created_at)}</div>
                  <p className="whitespace-pre-line">{m.body}</p>
                  {Array.isArray(m.attachments) && m.attachments.map((p: string) => <a key={p} href={fileUrl(p)} target="_blank" rel="noreferrer" className="text-xs underline me-2">Attachment</a>)}
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap">{CANNED.map((c, i) => <button key={i} onClick={() => setBody(c)} className="text-[11px] rounded-full border px-2.5 py-1 hover:bg-muted" data-testid={`button-canned-${i}`}>{c.slice(0, 28)}…</button>)}</div>
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-2xl" placeholder={internal ? 'Internal note, never shown to the user' : 'Reply to user'} data-testid="input-admin-reply" />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><Switch checked={internal} onCheckedChange={setInternal} data-testid="switch-internal" />Internal note</label>
              <Button className="rounded-full ms-auto" disabled={pending || !body} onClick={() => run('ticket-reply', { id: sel.id, body, is_internal: internal }, { success: internal ? 'Note added' : 'Reply sent', onSuccess: () => setBody('') })} data-testid="button-admin-send"><Send className="w-4 h-4 me-1.5" />Send</Button>
            </div>
          </div>
        )}
      </ActionSheet>
    </div>
  );
}

const blankArticle = { title: '', category: '', slug: '', body: '', language: 'en', published: false, sort_order: 0 };

export function AdminHelp() {
  const { state } = useAdmin();
  const { run, pending } = useRun('admin');
  const p = usePrompt();
  const [lang, setLang] = useState('en');
  const [edit, setEdit] = useState<R | null>(null);
  const [ann, setAnn] = useState<R | null>(null);
  const arts = list(state.articles).filter((a) => (a.language || 'en') === lang).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const move = (a: R, dir: number) => run('article-save', { ...a, sort_order: Number(a.sort_order || 0) + dir }, { success: false });
  return (
    <div>
      <AdminTitle title="Help Center" action={<div className="flex gap-2"><Select value={lang} onValueChange={setLang}><SelectTrigger className="w-36 rounded-full" data-testid="select-help-lang"><SelectValue /></SelectTrigger><SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent></Select><Button className="rounded-full" onClick={() => setEdit({ ...blankArticle, language: lang })} data-testid="button-new-article"><Plus className="w-4 h-4 me-1.5" />Article</Button></div>} />
      <Tabs defaultValue="articles">
        <TabsList className="rounded-full mb-4"><TabsTrigger value="articles" className="rounded-full">Articles</TabsTrigger><TabsTrigger value="announcements" className="rounded-full">Announcements</TabsTrigger></TabsList>
        <TabsContent value="articles">
          <DataTable testId="articles" rows={arts} onRow={setEdit} cols={[
            { key: 'title', label: 'Title', render: (a) => <div><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">/{a.slug}</div></div> },
            { key: 'category', label: 'Category' },
            { key: 'helpful', label: 'Helpful', render: (a) => <span className="text-xs flex gap-2"><ThumbsUp className="w-3.5 h-3.5" />{Number(a.helpful_yes || 0)}<ThumbsDown className="w-3.5 h-3.5" />{Number(a.helpful_no || 0)}</span> },
            { key: 'published', label: 'State', render: (a) => <StatusChip status={a.published ? 'published' : 'draft'} /> },
            { key: 'order', label: 'Order', render: (a) => <span className="flex gap-1" onClick={(e) => e.stopPropagation()}><button className="px-2 rounded border" onClick={() => move(a, -1)}>Up</button><button className="px-2 rounded border" onClick={() => move(a, 1)}>Down</button></span> },
          ]} />
        </TabsContent>
        <TabsContent value="announcements">
          <div className="flex justify-end mb-3"><Button className="rounded-full" onClick={() => setAnn({ title: '', body: '', type: 'info', active: true })} data-testid="button-new-announcement"><Megaphone className="w-4 h-4 me-1.5" />Announcement</Button></div>
          {list(state.announcements).length ? <div className="grid md:grid-cols-2 gap-3">{list(state.announcements).map((a) => <button key={String(a.id)} onClick={() => setAnn(a)} className="text-start rounded-3xl border bg-card p-4 hover:border-primary/50"><div className="flex justify-between"><span className="font-semibold">{a.title}</span><StatusChip status={a.active ? 'active' : 'disabled'} /></div><p className="text-sm text-muted-foreground mt-1">{a.body}</p></button>)}</div> : <EmptyState icon={Megaphone} title="No announcements" />}
        </TabsContent>
      </Tabs>
      <ActionSheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? 'Edit article' : 'New article'}>
        {edit && (
          <div className="space-y-3">
            <Input placeholder="Title" value={String(edit.title)} onChange={(e) => setEdit({ ...edit, title: e.target.value, slug: edit.id ? edit.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} className="rounded-xl" data-testid="input-article-title" />
            <div className="grid grid-cols-2 gap-2"><Input placeholder="Slug" value={String(edit.slug)} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} className="rounded-xl" /><Input placeholder="Category" value={String(edit.category)} onChange={(e) => setEdit({ ...edit, category: e.target.value })} className="rounded-xl" data-testid="input-article-category" /></div>
            <Select value={String(edit.language)} onValueChange={(v) => setEdit({ ...edit, language: v })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent></Select>
            <RichTextEditor id="article-body" testId="input-article-body" label="Article body" value={String(edit.body ?? '')} onChange={(v) => setEdit((e) => (e ? { ...e, body: v } : e))} />
            <details className="rounded-xl border p-3"><summary className="text-xs cursor-pointer">Preview</summary><div className="prose prose-sm dark:prose-invert mt-2 [&_img]:max-w-full [&_img]:h-auto" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(String(edit.body ?? '')) }} /></details>
            <label className="flex items-center justify-between text-sm">Published<Switch checked={!!edit.published} onCheckedChange={(v) => setEdit({ ...edit, published: v })} data-testid="switch-article-published" /></label>
            <div className="flex gap-2">
              {edit.id && <Button variant="outline" className="rounded-full text-destructive" disabled={pending} onClick={() => p.open({ title: 'Delete article?', danger: true, fields: [], confirm: 'Delete', onSubmit: async () => { await run('article-delete', { id: edit.id }, { success: 'Deleted', onSuccess: () => setEdit(null) }); } })} data-testid="button-delete-article"><Trash2 className="w-4 h-4" /></Button>}
              <Button className="rounded-full flex-1" disabled={pending || !edit.title || !edit.slug} onClick={() => run('article-save', edit, { success: 'Article saved', onSuccess: () => setEdit(null) })} data-testid="button-save-article">Save</Button>
            </div>
          </div>
        )}
      </ActionSheet>
      <ActionSheet open={!!ann} onOpenChange={(o) => !o && setAnn(null)} title="Announcement / status banner">
        {ann && (
          <div className="space-y-3">
            <Input placeholder="Title" value={String(ann.title)} onChange={(e) => setAnn({ ...ann, title: e.target.value })} className="rounded-xl" data-testid="input-ann-title" />
            <Textarea placeholder="Body" value={String(ann.body)} onChange={(e) => setAnn({ ...ann, body: e.target.value })} className="rounded-xl" data-testid="input-ann-body" />
            <Select value={String(ann.type)} onValueChange={(v) => setAnn({ ...ann, type: v })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{['info', 'warning', 'status', 'promo'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Start</Label><Input type="datetime-local" value={String(ann.start || '')} onChange={(e) => setAnn({ ...ann, start: e.target.value })} className="rounded-xl mt-1" /></div><div><Label className="text-xs">End</Label><Input type="datetime-local" value={String(ann.end || '')} onChange={(e) => setAnn({ ...ann, end: e.target.value })} className="rounded-xl mt-1" /></div></div>
            <label className="flex items-center justify-between text-sm">Active<Switch checked={!!ann.active} onCheckedChange={(v) => setAnn({ ...ann, active: v })} /></label>
            <Button className="rounded-full w-full" disabled={pending || !ann.title} onClick={() => run('announcement-save', ann, { success: 'Saved', onSuccess: () => setAnn(null) })} data-testid="button-save-announcement">Save</Button>
          </div>
        )}
      </ActionSheet>
      {p.node}
    </div>
  );
}

export { Section };
