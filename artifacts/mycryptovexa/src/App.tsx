import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import '@/lib/i18n';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { ThemeProvider } from '@/lib/theme';
import { PlatformProvider, usePlatform } from '@/lib/platform';
import { GlobalLoader, ErrorState } from '@/components/app/kit';
import { Splash, Logo } from '@/components/app/brand';
import { UserShell } from '@/components/app/user-shell';
import HomePage from '@/pages/home';
import MarketPage from '@/pages/market';
import MarketDetailPage from '@/pages/market-detail';
import RentalsPage from '@/pages/rentals';
import WalletPage from '@/pages/wallet';
import ReferralsPage from '@/pages/referrals';
import { HelpPage, ArticlePage, TicketsPage, TicketThreadPage } from '@/pages/help';
import ProfilePage from '@/pages/profile';
import { KycPage, NotificationsPage, LegalPage } from '@/pages/misc';
import { LoginPage, RegisterPage, ForgotPage, ResetPage, VerifyEmailPage } from '@/pages/auth';
import AdminLoginPage from '@/pages/admin/login';
import { AdminShell } from '@/pages/admin/shell';
import AdminDashboard from '@/pages/admin/dashboard';
import { AdminDeposits, AdminWithdrawals } from '@/pages/admin/finance';
import { AdminUsers, AdminKyc, AdminReferrals } from '@/pages/admin/people';
import { AdminAssets, AdminRentals } from '@/pages/admin/catalog';
import { AdminSupport, AdminHelp } from '@/pages/admin/support';
import { AdminContent, AdminEmails, AdminLogs, AdminReports } from '@/pages/admin/content';
import AdminSettings from '@/pages/admin/settings';
import AdminSecurity from '@/pages/admin/security';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false, refetchInterval: false } } });

const u = (C: () => ReactNode) => () => <UserShell><C /></UserShell>;
const a = (C: () => ReactNode) => () => <AdminShell><C /></AdminShell>;

function AdminRedirect() {
  const [, nav] = useLocation();
  useEffect(() => nav('/admin/dashboard'), [nav]);
  return null;
}

function RootPage() {
  const { user, brand } = usePlatform();
  const [, nav] = useLocation();
  useEffect(() => {
    if (!user) nav('/login', { replace: true });
  }, [user, nav]);
  return user ? <UserShell><HomePage /></UserShell> : <Splash name={brand.name} />;
}

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Home'], [/^\/market\/.+/, 'Asset'], [/^\/market/, 'Marketplace'], [/^\/rentals/, 'My rentals'], [/^\/wallet/, 'Wallet'],
  [/^\/referrals/, 'Referrals'], [/^\/help\/tickets/, 'Support tickets'], [/^\/help\/article/, 'Help article'], [/^\/help/, 'Help Center'],
  [/^\/profile/, 'Profile'], [/^\/kyc/, 'Verification'], [/^\/notifications/, 'Notifications'], [/^\/legal\//, 'Legal'],
  [/^\/login/, 'Sign in'], [/^\/register/, 'Create account'], [/^\/forgot-password/, 'Forgot password'], [/^\/reset-password/, 'Reset password'],
  [/^\/verify-email/, 'Verify email'], [/^\/admin\/login/, 'Console sign in'], [/^\/admin\/(\w+)/, 'Console'],
];
function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.content = content;
}
function useRouteMeta() {
  const [loc] = useLocation();
  const { brand, settings } = usePlatform();
  useEffect(() => {
    const hit = TITLES.find(([re]) => re.test(loc));
    const adminMod = loc.match(/^\/admin\/(\w+)/)?.[1];
    const page = adminMod && adminMod !== 'login' ? `Console · ${adminMod.charAt(0).toUpperCase()}${adminMod.slice(1)}` : hit?.[1] || 'Not found';
    const title = `${page} · ${brand.name}`;
    const desc = String(settings.description || `${brand.name}: browse virtual rentals with admin-set profit schedules and clear capital requirements.`);
    document.title = title;
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:site_name', brand.name);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:url', window.location.href);
    setMeta('property', 'og:image', `${window.location.origin}/icon-512.png`);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', title);
  }, [loc, brand.name, settings.description]);
}

function Router() {
  const { booting, bootError, refetch, brand } = usePlatform();
  useRouteMeta();
  if (booting) return <Splash name={brand.name} />;
  if (bootError) return <div className="min-h-[100dvh] grid place-items-center p-6"><div className="w-full max-w-md flex flex-col items-center gap-6"><Logo name={brand.name} logo={brand.logo} size={40} /><ErrorState error={bootError} onRetry={refetch} /></div></div>;
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={RootPage} />
        <Route path="/market" component={u(MarketPage)} />
        <Route path="/market/:id" component={u(MarketDetailPage)} />
        <Route path="/rentals" component={u(RentalsPage)} />
        <Route path="/wallet" component={u(WalletPage)} />
        <Route path="/referrals" component={u(ReferralsPage)} />
        <Route path="/help" component={u(HelpPage)} />
        <Route path="/help/article/:slug" component={u(ArticlePage)} />
        <Route path="/help/tickets" component={u(TicketsPage)} />
        <Route path="/help/tickets/:id" component={u(TicketThreadPage)} />
        <Route path="/profile" component={u(ProfilePage)} />
        <Route path="/kyc" component={u(KycPage)} />
        <Route path="/notifications" component={u(NotificationsPage)} />
        <Route path="/legal/:key" component={u(LegalPage)} />
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/forgot-password" component={ForgotPage} />
        <Route path="/reset-password" component={ResetPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/admin/login" component={AdminLoginPage} />
        <Route path="/admin" component={AdminRedirect} />
        <Route path="/admin/dashboard" component={a(AdminDashboard)} />
        <Route path="/admin/users" component={a(AdminUsers)} />
        <Route path="/admin/assets" component={a(AdminAssets)} />
        <Route path="/admin/rentals" component={a(AdminRentals)} />
        <Route path="/admin/deposits" component={a(AdminDeposits)} />
        <Route path="/admin/withdrawals" component={a(AdminWithdrawals)} />
        <Route path="/admin/kyc" component={a(AdminKyc)} />
        <Route path="/admin/referrals" component={a(AdminReferrals)} />
        <Route path="/admin/support" component={a(AdminSupport)} />
        <Route path="/admin/help" component={a(AdminHelp)} />
        <Route path="/admin/content" component={a(AdminContent)} />
        <Route path="/admin/emails" component={a(AdminEmails)} />
        <Route path="/admin/settings" component={a(AdminSettings)} />
        <Route path="/admin/logs" component={a(AdminLogs)} />
        <Route path="/admin/reports" component={a(AdminReports)} />
        <Route path="/admin/security" component={a(AdminSecurity)} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PlatformProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <GlobalLoader />
            <Toaster />
          </TooltipProvider>
        </PlatformProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
