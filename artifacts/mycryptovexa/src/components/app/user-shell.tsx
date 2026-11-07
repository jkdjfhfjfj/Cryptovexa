import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Bell, Globe, Headset, Home, Store, Timer, Wallet, UserRound, Moon, Sun, LogIn, LogOut, Users, ShieldCheck, Download, Wrench } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { usePlatform, list, useRun } from '@/lib/platform';
import { LANGUAGES, applyLanguage } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Logo } from './brand';
import { TranslationNotice } from './translation-notice';

const NAV = [
  { href: '/', key: 'home', icon: Home },
  { href: '/market', key: 'market', icon: Store },
  { href: '/rentals', key: 'rentals', icon: Timer },
  { href: '/wallet', key: 'wallet', icon: Wallet },
  { href: '/profile', key: 'profile', icon: UserRound },
];

type BIP = Event & { prompt: () => Promise<void> };

export function UserShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [loc, navigate] = useLocation();
  const { brand, user, state, settings } = usePlatform();
  const { resolved, setTheme } = useTheme();
  const { run } = useRun('account');
  const { run: runUser } = useRun('user');
  const unread = list(state.notifications).filter((n) => !n.read).length;
  const [install, setInstall] = useState<BIP | null>(null);

  useEffect(() => {
    const fn = (e: Event) => { e.preventDefault(); setInstall(e as BIP); };
    window.addEventListener('beforeinstallprompt', fn);
    return () => window.removeEventListener('beforeinstallprompt', fn);
  }, []);

  const active = (href: string) => (href === '/' ? loc === '/' : loc.startsWith(href));
  const changeLang = (code: string) => {
    applyLanguage(code);
    if (user) runUser('profile-preferences', { language: code, theme: resolved, notifications: (user.preferences as Record<string, unknown>)?.notifications ?? {} }, { success: false, silentError: true });
  };

  return (
    <div className="min-h-[100dvh] bg-background grain">
      {settings.maintenance ? (
        <div className="bg-amber-500 text-[#1c1300] text-xs font-medium text-center py-1.5 px-4 flex items-center justify-center gap-2" data-testid="banner-maintenance">
          <Wrench className="w-3.5 h-3.5" /> Scheduled maintenance is in progress. Some actions may be unavailable.
        </div>
      ) : null}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b">
        <div className="max-w-7xl mx-auto h-16 px-4 flex items-center gap-4">
          <Link href="/" className="shrink-0" data-testid="link-home-logo"><Logo name={brand.name} logo={brand.logo} size={30} /></Link>
          <nav className="hidden lg:flex items-center gap-1 ms-6">
            {[...NAV.slice(0, 4), { href: '/referrals', key: 'referrals', icon: Users }].map((n) => (
              <Link key={n.href} href={n.href} data-testid={`nav-${n.key}`}
                className={cn('flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors', active(n.href) ? 'bg-accent text-accent-foreground font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}>
                <n.icon className="w-4 h-4" />{t(n.key)}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            {install && (
              <button className="hidden sm:flex items-center gap-1.5 text-xs rounded-full border px-3 py-1.5 me-1 hover:bg-muted" onClick={async () => { await install.prompt(); setInstall(null); }} data-testid="button-install">
                <Download className="w-3.5 h-3.5" />Install app
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" data-testid="button-language"><Globe className="w-5 h-5" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-2xl">
                <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
                {LANGUAGES.map((l) => (
                  <DropdownMenuItem key={l.code} onClick={() => changeLang(l.code)} className={cn(i18n.language === l.code && 'font-semibold text-primary')} data-testid={`lang-${l.code}`}>{l.label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button className="w-10 h-10 grid place-items-center rounded-full hover:bg-muted" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} data-testid="button-theme">
              {resolved === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <Link href="/help" aria-label={t('help')} className="w-10 h-10 hidden min-[360px]:grid place-items-center rounded-full hover:bg-muted" data-testid="link-help"><Headset className="w-5 h-5" /></Link>
            <Link href="/notifications" className="relative w-10 h-10 grid place-items-center rounded-full hover:bg-muted" data-testid="link-notifications">
              <Bell className="w-5 h-5" />
              {unread > 0 && <span className="absolute top-1.5 end-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-[10px] font-bold text-white grid place-items-center" data-testid="text-unread">{unread > 9 ? '9+' : unread}</span>}
            </Link>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="ms-1 w-9 h-9 rounded-full brand-grad text-[#06101d] font-bold text-sm grid place-items-center" data-testid="button-account">
                  {String(user.username || user.email || '?').slice(0, 1).toUpperCase()}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl w-56">
                  <DropdownMenuLabel className="truncate">{String(user.username || user.email)}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')}><UserRound className="w-4 h-4 me-2" />{t('profile')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/kyc')}><ShieldCheck className="w-4 h-4 me-2" />{t('kyc')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/referrals')}><Users className="w-4 h-4 me-2" />{t('referrals')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-testid="button-logout" onClick={() => run('logout', {}, { success: 'Signed out', onSuccess: () => navigate('/') })}><LogOut className="w-4 h-4 me-2" />{t('signOut')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link href="/login" aria-label={t('signIn')} className="ms-1 press inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold" data-testid="link-login">
                <LogIn className="w-4 h-4" /><span className="hidden sm:inline">{t('signIn')}</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <TranslationNotice />
      <main className="max-w-7xl mx-auto px-4 pt-5 pb-safe">{children}</main>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur-xl border-t" style={{ paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
        <div className="grid grid-cols-5 h-[72px]">
          {NAV.map((n) => {
            const on = active(n.href);
            return (
              <Link key={n.href} href={n.href} className="flex flex-col items-center justify-center gap-1 press" data-testid={`tab-${n.key}`}>
                <span className={cn('h-8 w-16 rounded-full grid place-items-center transition-all duration-300', on ? 'bg-accent scale-100' : 'scale-90')}>
                  <n.icon className={cn('w-[22px] h-[22px]', on ? 'text-accent-foreground' : 'text-muted-foreground')} strokeWidth={on ? 2.4 : 1.8} />
                </span>
                <span className={cn('text-[11px]', on ? 'font-semibold' : 'text-muted-foreground')}>{t(n.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
