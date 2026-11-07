import { useRef, useState, type ReactNode } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AlertTriangle, CheckCircle2, Clock, Info, LogIn, Paperclip, RotateCcw, XCircle, X, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { errorMessage, uploadFile } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { HexLoader } from './brand';

/** Global response loader: hex mark for any first-load query or any pending mutation. */
export function GlobalLoader() {
  const fetching = useIsFetching({ predicate: (q) => q.state.data === undefined });
  const mutating = useIsMutating();
  return (
    <>
      {mutating > 0 && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-background/40 backdrop-blur-[2px] rise" data-testid="loader-mutation">
          <div className="rounded-3xl bg-card border shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
            <HexLoader size={64} />
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Processing</span>
          </div>
        </div>
      )}
      {fetching > 0 && mutating === 0 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] rounded-full bg-card/95 border shadow-lg pl-1.5 pr-4 py-1.5 flex items-center gap-2 rise" data-testid="loader-query">
          <HexLoader size={26} />
          <span className="text-xs text-muted-foreground">Syncing</span>
        </div>
      )}
    </>
  );
}

const TONE: Record<string, string> = {
  amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25',
  green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  red: 'bg-red-500/12 text-red-700 dark:text-red-300 border-red-500/25',
  blue: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25',
  slate: 'bg-muted text-muted-foreground border-border',
};
const MAP: Record<string, string> = {
  pending: 'amber', pending_review: 'amber', pending_confirm: 'amber', queued: 'amber', processing: 'blue', requested: 'amber', submitted: 'blue', open: 'amber', awaiting_user: 'blue', manual_fallback: 'amber', paused: 'amber', needs_info: 'blue', draft: 'slate',
  approved: 'green', active: 'green', sent: 'green', completed: 'green', credited: 'green', resolved: 'green', published: 'green', available: 'green', paid: 'green', verified: 'green', success: 'green',
  rejected: 'red', failed: 'red', cancelled: 'red', suspended: 'red', closed: 'slate', disabled: 'slate', none: 'slate', expired: 'red',
};
export function StatusChip({ status, className }: { status?: string; className?: string }) {
  const s = String(status || 'none').toLowerCase();
  const tone = MAP[s] || 'slate';
  const Icon = tone === 'green' ? CheckCircle2 : tone === 'red' ? XCircle : tone === 'blue' ? Info : tone === 'amber' ? Clock : Info;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', TONE[tone], className)} data-testid={`status-${s}`}>
      <Icon className="w-3 h-3" />
      {titleCase(s)}
    </span>
  );
}

const COIN: Record<string, [string, string]> = {
  BTC: ['#F7931A', '₿'], ETH: ['#627EEA', 'Ξ'], BNB: ['#F0B90B', 'B'], USDT: ['#26A17B', '₮'], USDC: ['#2775CA', '$'],
};
export function CoinIcon({ code, size = 32 }: { code?: string; size?: number }) {
  const [c, g] = COIN[String(code).toUpperCase()] || ['#14B8A6', String(code || '?').slice(0, 1)];
  return (
    <span className="inline-grid place-items-center rounded-full font-bold text-white shrink-0" style={{ width: size, height: size, background: c, fontSize: size * 0.45 }} aria-hidden>
      {g}
    </span>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, body, action }: { icon?: typeof Inbox; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6 rounded-3xl border border-dashed bg-card/50" data-testid="empty-state">
      <div className="relative mb-4">
        <div className="w-16 h-16 rounded-2xl bg-accent grid place-items-center rotate-6"><Icon className="w-7 h-7 text-accent-foreground -rotate-6" /></div>
      </div>
      <h3 className="font-semibold">{title}</h3>
      {body && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center text-center py-12 px-6 rounded-3xl border border-destructive/30 bg-destructive/5" data-testid="error-state">
      <AlertTriangle className="w-8 h-8 text-destructive mb-3" />
      <h3 className="font-semibold">{t('loadError')}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{errorMessage(error, 'The server did not respond.')}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4 rounded-full" onClick={onRetry} data-testid="button-retry">
          <RotateCcw className="w-4 h-4 mr-2" />{t('retry')}
        </Button>
      )}
    </div>
  );
}

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" data-testid="page-skeleton">
      <Skeleton className="h-8 w-48 rounded-xl" />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
    </div>
  );
}

export function SignInPrompt({ title, body }: { title?: string; body?: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-3xl vault-card p-6 relative overflow-hidden" data-testid="signin-prompt">
      <div className="absolute inset-0 hex-pattern opacity-60" />
      <div className="relative">
        <h3 className="text-lg font-semibold">{title || t('signIn')}</h3>
        <p className="text-sm text-white/70 mt-1 max-w-md">{body || t('signInPrompt')}</p>
        <div className="flex gap-2 mt-4">
          <Link href="/login" className="press inline-flex items-center gap-2 rounded-full brand-grad text-[#06101d] font-semibold px-5 py-2.5 text-sm" data-testid="link-signin">
            <LogIn className="w-4 h-4" />{t('signIn')}
          </Link>
          <Link href="/register" className="press inline-flex items-center rounded-full border border-white/25 px-5 py-2.5 text-sm" data-testid="link-register">
            {t('signUp')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, action, icon: Icon }: { title: string; sub?: string; action?: ReactNode; icon?: typeof Inbox }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5 rise">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && <div className="w-11 h-11 rounded-2xl bg-accent grid place-items-center shrink-0"><Icon className="w-5 h-5 text-accent-foreground" /></div>}
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">{title}</h1>
          {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Bottom sheet on mobile, side panel on desktop. */
export function ActionSheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={mobile ? 'bottom' : 'right'} className={cn('overflow-y-auto', mobile ? 'rounded-t-[28px] max-h-[92dvh] pb-8' : 'w-full sm:max-w-lg')}>
        {mobile && <div className="mx-auto -mt-2 mb-2 h-1.5 w-10 rounded-full bg-muted" />}
        <SheetHeader className="text-start">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="mt-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function FilePick({ value, onChange, label = 'Attach file', accept = 'image/*,application/pdf', testId = 'input-file' }: { value?: string; onChange: (path: string) => void; label?: string; accept?: string; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  return (
    <div>
      <input ref={ref} type="file" accept={accept} className="hidden" data-testid={testId}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true); setErr('');
          try { onChange(await uploadFile(f)); setName(f.name); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); e.target.value = ''; }
        }} />
      {value ? (
        <div className="flex items-center gap-2 rounded-2xl border bg-accent/40 px-3 py-2 text-sm">
          <Paperclip className="w-4 h-4" /><span className="truncate flex-1">{name || 'Uploaded file'}</span>
          <button type="button" onClick={() => { onChange(''); setName(''); }} className="p-1 rounded-full hover:bg-muted" data-testid={`${testId}-clear`}><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="rounded-2xl w-full border-dashed h-12" disabled={busy} onClick={() => ref.current?.click()} data-testid={`${testId}-button`}>
          {busy ? <HexLoader size={22} className="mr-2" /> : <Paperclip className="w-4 h-4 mr-2" />}{busy ? 'Uploading' : label}
        </Button>
      )}
      {err && <p className="text-xs text-destructive mt-1">{err}</p>}
    </div>
  );
}

export function Stat({ label, value, icon: Icon, hint }: { label: string; value: ReactNode; icon?: typeof Inbox; hint?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">{label}{Icon && <Icon className="w-4 h-4" />}</div>
      <div className="mt-2 text-xl font-semibold num">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
