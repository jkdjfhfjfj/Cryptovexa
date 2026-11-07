import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, AtSign, KeyRound, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { usePlatform, useRun } from '@/lib/platform';
import { Logo, HexLoader } from '@/components/app/brand';
import { Turnstile, useCaptchaConfig } from '@/components/app/turnstile';

export function AuthLayout({ title, sub, children, footer }: { title: string; sub?: string; children: ReactNode; footer?: ReactNode }) {
  const { brand } = usePlatform();
  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex relative overflow-hidden vault-card p-12 flex-col justify-between">
        <img src="/images/auth-lattice.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="relative"><Link href="/"><Logo name={brand.name} logo={brand.logo} size={36} /></Link></div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight">Rent what you need. Pay for exactly the time you use.</h2>
          <p className="text-white/70 mt-4">Crypto-funded balances, transparent per-minute billing and a person reviewing every deposit.</p>
        </div>
        <p className="relative text-xs text-white/50">Rentals and crypto carry risk. Returns are never guaranteed.</p>
      </div>
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="w-full max-w-sm mx-auto rise">
          <Link href="/" className="lg:hidden mb-8 inline-block"><Logo name={brand.name} logo={brand.logo} size={32} /></Link>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {sub && <p className="text-muted-foreground text-sm mt-1.5">{sub}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({ icon: Icon, label, ...p }: { icon: typeof Mail; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="relative mt-1"><Icon className="absolute start-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input {...p} className="ps-11 h-12 rounded-2xl" /></div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { run, pending } = useRun('account');
  const [f, setF] = useState({ email: '', password: '', code: '' });
  const [need2fa, setNeed2fa] = useState(false);
  const cap = useCaptchaConfig();
  const [token, setToken] = useState('');
  const [capReset, setCapReset] = useState(0);
  const submit = async () => {
    // Credentials and the captcha token are retained across the 2FA continuation step.
    const res = await run('login', { email: f.email, password: f.password, code: need2fa ? f.code || undefined : undefined, captcha_token: cap.enabled ? token : undefined }, { success: false, silentError: false });
    if (!res) { setNeed2fa(false); setF((o) => ({ ...o, code: '' })); setToken(''); setCapReset((n) => n + 1); return; }
    if (res.requires2fa || res.requiresTwoFactor || res.twofa_required) { setNeed2fa(true); return; }
    navigate('/');
  };
  return (
    <AuthLayout title={t('signIn')} sub="Welcome back." footer={<>New here? <Link href="/register" className="text-primary font-semibold">{t('signUp')}</Link></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field icon={Mail} label="Email" type="email" autoComplete="email" value={f.email} disabled={need2fa} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-email" />
        <Field icon={Lock} label="Password" type="password" autoComplete="current-password" value={f.password} disabled={need2fa} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="input-password" />
        {need2fa && <Field icon={KeyRound} label="Authenticator or recovery code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} autoFocus data-testid="input-2fa-code" />}
        <div className="flex justify-end"><Link href="/forgot-password" className="text-xs text-primary" data-testid="link-forgot">Forgot password?</Link></div>
        {cap.enabled && !need2fa && <Turnstile siteKey={cap.siteKey} onToken={setToken} resetKey={capReset} />}
        {need2fa && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setNeed2fa(false); setF({ ...f, code: '' }); setToken(''); setCapReset((n) => n + 1); }} data-testid="button-2fa-restart">Use a different account</button>}
        <Button type="submit" className="w-full h-12 rounded-full" disabled={pending || !f.email || !f.password || (cap.enabled && !token) || (need2fa && !f.code)} data-testid="button-login">{t('signIn')}</Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { settings } = usePlatform();
  const { run, pending } = useRun('account');
  const [f, setF] = useState({ email: '', username: '', password: '', referral: new URLSearchParams(search).get('ref') || '', terms: false });
  const mode = String(settings.registration_mode || 'open');
  const cap = useCaptchaConfig();
  const [token, setToken] = useState('');
  const [capReset, setCapReset] = useState(0);
  const ok = f.password.length >= 12 && f.terms && f.email && f.username && (mode !== 'invite-only' && mode !== 'invite_only' || f.referral);
  if (mode === 'closed') return <AuthLayout title="Registration is closed" sub="New sign-ups are paused for now." footer={<Link href="/login" className="text-primary font-semibold">{t('signIn')}</Link>}><div /></AuthLayout>;
  return (
    <AuthLayout title={t('signUp')} sub={mode.startsWith('invite') ? 'An invite code is required.' : 'Takes under a minute.'} footer={<>Already registered? <Link href="/login" className="text-primary font-semibold">{t('signIn')}</Link></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run('register', { email: f.email, username: f.username, password: f.password, terms: true, referral: f.referral || undefined, captcha_token: cap.enabled ? token : undefined }, { success: 'Account created. Check your inbox to verify your email.', onSuccess: () => navigate('/') }).then((r) => { if (!r) { setToken(''); setCapReset((n) => n + 1); } }); }}>
        <Field icon={Mail} label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-email" />
        <Field icon={AtSign} label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} data-testid="input-username" />
        <Field icon={Lock} label="Password (12+ characters)" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="input-password" />
        {f.password && f.password.length < 12 && <p className="text-xs text-destructive -mt-2">{12 - f.password.length} more characters needed.</p>}
        <Field icon={KeyRound} label="Referral code (optional)" value={f.referral} onChange={(e) => setF({ ...f, referral: e.target.value })} data-testid="input-referral" />
        <label className="flex items-start gap-3 text-xs leading-relaxed"><Checkbox checked={f.terms} onCheckedChange={(v) => setF({ ...f, terms: v === true })} data-testid="checkbox-terms" /><span>I accept the <Link href="/legal/terms" className="underline">Terms</Link>, <Link href="/legal/privacy" className="underline">Privacy Policy</Link> and <Link href="/legal/risk" className="underline">Risk Disclosure</Link>, and understand returns are not guaranteed.</span></label>
        {cap.enabled && <Turnstile siteKey={cap.siteKey} onToken={setToken} resetKey={capReset} />}
        <Button type="submit" className="w-full h-12 rounded-full" disabled={pending || !ok || (cap.enabled && !token)} data-testid="button-register">{t('signUp')}</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const { run, pending } = useRun('account');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout title="Reset password" sub="We will email a link valid for one hour." footer={<Link href="/login" className="text-primary font-semibold">Back to sign in</Link>}>
      {sent ? <div className="rounded-2xl bg-accent p-4 text-sm flex gap-2"><CheckCircle2 className="w-5 h-5 text-primary shrink-0" />If an account exists for {email}, a reset link is on its way.</div> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run('forgot-password', { email }, { success: false, onSuccess: () => setSent(true) }); }}>
          <Field icon={Mail} label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
          <Button type="submit" className="w-full h-12 rounded-full" disabled={pending || !email} data-testid="button-send-reset">Send link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const token = new URLSearchParams(search).get('token') || '';
  const { run, pending } = useRun('account');
  const [pw, setPw] = useState({ a: '', b: '' });
  const ok = pw.a.length >= 12 && pw.a === pw.b;
  return (
    <AuthLayout title="Choose a new password" footer={<Link href="/login" className="text-primary font-semibold">Back to sign in</Link>}>
      {!token ? <p className="text-sm text-destructive">This link is missing its token. Request a new one.</p> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run('reset-password', { token, password: pw.a }, { success: 'Password updated. Sign in again.', onSuccess: () => navigate('/login') }); }}>
          <Field icon={Lock} label="New password (12+ characters)" type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} data-testid="input-password" />
          <Field icon={Lock} label="Repeat password" type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} data-testid="input-password-confirm" />
          <Button type="submit" className="w-full h-12 rounded-full" disabled={pending || !ok} data-testid="button-reset">Save password</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get('token') || '';
  const { run } = useRun('account');
  const [st, setSt] = useState<'idle' | 'ok' | 'fail'>('idle');
  const once = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!token || once.current) return;
    once.current = true;
    runRef.current('verify-email', { token }, { success: false, silentError: true }).then((r) => setSt(r ? 'ok' : 'fail'));
  }, [token]);
  return (
    <AuthLayout title="Email verification" footer={<Link href="/" className="text-primary font-semibold">Continue</Link>}>
      {!token ? <p className="text-sm text-destructive">This link is missing its token.</p> : st === 'idle' ? <div className="flex items-center gap-3"><HexLoader size={40} />Verifying…</div> : st === 'ok' ? <div className="flex gap-2 items-center text-sm"><CheckCircle2 className="w-5 h-5 text-primary" />Your email is verified.</div> : <div className="flex gap-2 items-center text-sm"><XCircle className="w-5 h-5 text-destructive" />This link is invalid or has expired. Request a new one from your profile.</div>}
    </AuthLayout>
  );
}
