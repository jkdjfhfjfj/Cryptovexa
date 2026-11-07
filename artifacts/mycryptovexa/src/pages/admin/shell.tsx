import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useGetAdminWorkspace, getGetAdminWorkspaceQueryKey, adminAccountAction } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Users, Building2, Timer, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, GitBranch, Headset, BookOpen, FileText, Mail, Settings, ScrollText, BarChart3, ChevronsLeft, LogOut, Fingerprint, Moon, Sun, Menu, Search, Download } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { usePlatform, list } from '@/lib/platform';
import { csrfOpts, adminExportUrl, type R } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/app/brand';
import { TranslationNotice } from '@/components/app/translation-notice';
import { PageSkeleton, ErrorState } from '@/components/app/kit';

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['superadmin', 'finance', 'support'] },
  { key: 'users', label: 'Users', icon: Users, roles: ['superadmin', 'support'] },
  { key: 'assets', label: 'Assets', icon: Building2, roles: ['superadmin'] },
  { key: 'rentals', label: 'Rentals', icon: Timer, roles: ['superadmin', 'finance'] },
  { key: 'deposits', label: 'Deposits', icon: ArrowDownToLine, roles: ['superadmin', 'finance'] },
  { key: 'withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine, roles: ['superadmin', 'finance'] },
  { key: 'kyc', label: 'KYC', icon: ShieldCheck, roles: ['superadmin', 'support'] },
  { key: 'referrals', label: 'Referrals', icon: GitBranch, roles: ['superadmin', 'finance'] },
  { key: 'support', label: 'Support', icon: Headset, roles: ['superadmin', 'support'] },
  { key: 'help', label: 'Help Center', icon: BookOpen, roles: ['superadmin', 'support'] },
  { key: 'content', label: 'Content', icon: FileText, roles: ['superadmin'] },
  { key: 'emails', label: 'Emails', icon: Mail, roles: ['superadmin'] },
  { key: 'settings', label: 'Settings', icon: Settings, roles: ['superadmin'] },
  { key: 'logs', label: 'Logs', icon: ScrollText, roles: ['superadmin', 'finance'] },
  { key: 'reports', label: 'Reports', icon: BarChart3, roles: ['superadmin', 'finance'] },
  { key: 'security', label: 'My security', icon: Fingerprint, roles: ['superadmin', 'finance', 'support'] },
] as const;

type AdminCtx = { state: R; admin: R; role: string; can: (k: string) => boolean };
const Ctx = createContext<AdminCtx | null>(null);
export const useAdmin = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('admin ctx');
  return c;
};

export function AdminShell({ children }: { children: ReactNode }) {
  const { state: boot, booting, brand } = usePlatform();
  const [loc, navigate] = useLocation();
  const qc = useQueryClient();
  const { resolved, setTheme } = useTheme();
  const bootAdmin = (boot.adminUser || boot.admin) as R | null | undefined;
  const ws = useGetAdminWorkspace({ query: { enabled: !!bootAdmin, queryKey: [...getGetAdminWorkspaceQueryKey(),bootAdmin?.id??'signed-out'], refetchInterval: 15000, retry: 1 } });
  useEffect(()=>{
    qc.removeQueries({queryKey:getGetAdminWorkspaceQueryKey(),predicate:q=>q.queryKey.at(-1)!==bootAdmin?.id});
  },[qc,bootAdmin?.id]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const status = (ws.error as R | null)?.status;

  useEffect(() => {
    if (!booting && (!bootAdmin || status === 401)) navigate('/admin/login');
  }, [booting, bootAdmin, status, navigate]);
  const setupRequired = !!(ws.data as R | undefined)?.requiresTwofaSetup;
  const onSecurity = loc.split('/')[2] === 'security';
  useEffect(() => {
    if (setupRequired && !onSecurity) navigate('/admin/security');
  }, [setupRequired, onSecurity, navigate]);

  if (booting || (bootAdmin && ws.isLoading)) return <div className="p-8"><PageSkeleton rows={6} /></div>;
  if (!bootAdmin) return null;
  if (ws.error && status !== 401 && status !== 403) return <div className="p-8"><ErrorState error={ws.error} onRetry={() => ws.refetch()} /></div>;

  const state = (ws.data as R) || {};
  const admin = (state.admin || state.user || bootAdmin) as R;
  const role = String(admin.role || 'support');
  const can = (k: string) => !!MODULES.find((m) => m.key === k)?.roles.includes(role as never);
  const mods = MODULES.filter((m) => can(m.key));
  const current = loc.split('/')[2] || 'dashboard';
  const sec = (state.settings as R)?.security as R | undefined;
  const needs2fa = setupRequired || (status === 403 && !admin.twofa_enabled) || !admin.twofa_enabled && String(sec?.admin_twofa_mode ?? (state.settings as R)?.admin_twofa_mode) === 'required';
  const logout = async () => {
    try { await adminAccountAction('logout', {}, csrfOpts()); } finally {
      qc.removeQueries({queryKey:getGetAdminWorkspaceQueryKey()});
      await qc.invalidateQueries();
      navigate('/admin/login');
    }
  };

  const nav = (compact: boolean) => (
    <nav className="flex flex-col gap-0.5 p-3">
      {mods.map((m) => (
        <Link key={m.key} href={`/admin/${m.key}`} onClick={() => setMobile(false)} title={m.label} data-testid={`admin-nav-${m.key}`}
          className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', current === m.key ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground')}>
          <m.icon className="w-[18px] h-[18px] shrink-0" />{!compact && m.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <Ctx.Provider value={{ state, admin, role, can }}>
      <div className="min-h-[100dvh] flex bg-background">
        <aside className={cn('hidden lg:flex flex-col bg-sidebar text-sidebar-foreground border-e border-sidebar-border sticky top-0 h-[100dvh] transition-[width] duration-300', collapsed ? 'w-[76px]' : 'w-64')}>
          <div className="h-16 flex items-center px-5 border-b border-sidebar-border"><Logo name={brand.name} logo={brand.logo} size={28} className={collapsed ? '[&>span:last-child]:hidden' : ''} /></div>
          <div className="flex-1 overflow-y-auto no-scrollbar">{nav(collapsed)}</div>
          <button className="m-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent" onClick={() => setCollapsed(!collapsed)} data-testid="button-collapse"><ChevronsLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />{!collapsed && 'Collapse'}</button>
        </aside>
        <Sheet open={mobile} onOpenChange={setMobile}><SheetContent side="left" className="bg-sidebar text-sidebar-foreground p-0 w-72"><div className="h-16 flex items-center px-5"><Logo name={brand.name} size={28} /></div>{nav(false)}</SheetContent></Sheet>
        <div className="flex-1 min-w-0">
          <header className="h-16 sticky top-0 z-30 bg-background/85 backdrop-blur-xl border-b flex items-center gap-3 px-4 md:px-6">
            <button className="lg:hidden p-2 rounded-xl hover:bg-muted" onClick={() => setMobile(true)} data-testid="button-admin-menu"><Menu className="w-5 h-5" /></button>
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Console</span>
            <div className="ms-auto flex items-center gap-2">
              <span className="hidden sm:inline text-sm text-muted-foreground">{admin.email}</span>
              <span className="text-[11px] rounded-full bg-accent text-accent-foreground px-2 py-0.5 font-semibold uppercase">{role}</span>
              <button className="p-2 rounded-full hover:bg-muted" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} data-testid="button-admin-theme">{resolved === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
              <button className="p-2 rounded-full hover:bg-muted" onClick={logout} data-testid="button-admin-logout"><LogOut className="w-4 h-4" /></button>
            </div>
          </header>
          <TranslationNotice />
          <main className="p-4 md:p-6 max-w-[1500px]">{setupRequired && current === 'security' && <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" data-testid="banner-admin-2fa-setup"><div className="font-semibold">Enroll two-factor authentication to continue</div><p className="text-muted-foreground mt-1">Staff accounts must have an authenticator app linked. The rest of the console stays locked and shows no operational data until enrollment is complete.</p></div>}{needs2fa && current !== 'security' && <Link href="/admin/security" className="block mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" data-testid="banner-admin-2fa">Two-factor authentication is required for staff. Console actions are blocked until you enable it. Set it up now.</Link>}{(status === 403 || setupRequired) && current !== 'security' ? <ErrorState error={ws.error} onRetry={() => ws.refetch()} /> : can(current) ? children : <ErrorState error={{ message: 'Your role does not include this module.' }} />}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

export type Col = { key: string; label: string; render?: (r: R) => ReactNode; className?: string };

export function DataTable({ rows, cols, onRow, search = true, exportType, toolbar, empty = 'Nothing here yet', testId = 'table' }: { rows: R[]; cols: Col[]; onRow?: (r: R) => void; search?: boolean; exportType?: string; toolbar?: ReactNode; empty?: string; testId?: string }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : rows;
  const per = 25;
  const shown = filtered.slice(page * per, page * per + per);
  return (
    <div className="rounded-3xl border bg-card overflow-hidden" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 p-3 border-b">
        {search && <div className="relative"><Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Filter…" className="ps-9 h-9 w-56 rounded-full" data-testid={`${testId}-search`} /></div>}
        {toolbar}
        <span className="ms-auto text-xs text-muted-foreground num">{filtered.length} rows</span>
        {exportType && <a href={adminExportUrl(exportType)} className="inline-flex items-center gap-1.5 text-xs rounded-full border px-3 py-1.5 hover:bg-muted" data-testid={`${testId}-export`}><Download className="w-3.5 h-3.5" />CSV</a>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-start text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">{cols.map((c) => <th key={c.key} className={cn('text-start font-medium px-4 py-2.5 whitespace-nowrap', c.className)}>{c.label}</th>)}</tr></thead>
          <tbody className="divide-y">
            {shown.map((r, i) => (
              <tr key={String(r.id ?? i)} onClick={() => onRow?.(r)} className={cn(onRow && 'cursor-pointer hover:bg-muted/40')} data-testid={`${testId}-row-${r.id ?? i}`}>
                {cols.map((c) => <td key={c.key} className={cn('px-4 py-3 align-middle', c.className)}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="p-10 text-center text-sm text-muted-foreground">{empty}</div>}
      </div>
      {filtered.length > per && (
        <div className="flex items-center justify-end gap-2 p-3 border-t text-xs">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-full border px-3 py-1 disabled:opacity-40">Prev</button>
          <span className="num">{page + 1} / {Math.ceil(filtered.length / per)}</span>
          <button disabled={(page + 1) * per >= filtered.length} onClick={() => setPage(page + 1)} className="rounded-full border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

export const userLabel = (state: R, id: unknown) => {
  const u = list(state.users).find((x) => x.id === id);
  return u ? String(u.email || u.username) : String(id ?? '—').slice(0, 10);
};

export function AdminTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{sub && <p className="text-sm text-muted-foreground">{sub}</p>}</div>
      {action}
    </div>
  );
}
