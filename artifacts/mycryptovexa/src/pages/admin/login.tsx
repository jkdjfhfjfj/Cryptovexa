import { useState } from 'react';
import { useLocation } from 'wouter';
import { Mail, Lock, KeyRound, AtSign, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlatform, useRun } from '@/lib/platform';
import { AuthLayout, Field } from '../auth';

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const { state, brand } = usePlatform();
  const { run, pending } = useRun('adminAccount');
  const [f, setF] = useState({ email: '', password: '', code: '', username: '' });
  const [need2fa, setNeed2fa] = useState(false);
  const [setup, setSetup] = useState(false);
  const setupAvailable = !!state.adminSetupAvailable;

  if (setup && setupAvailable) {
    const ok = f.email && f.username && f.password.length >= 12;
    return (
      <AuthLayout title="Create the first administrator" sub="Development-only setup. Available because no admin accounts exist yet.">
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex gap-2 mb-4"><ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />This account becomes superadmin. Choose a unique password of at least 12 characters; there are no default credentials.</div>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run('setup', { email: f.email, password: f.password, username: f.username }, { success: 'Administrator created', onSuccess: () => navigate('/admin/dashboard') }); }}>
          <Field icon={Mail} label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-setup-email" />
          <Field icon={AtSign} label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} data-testid="input-setup-username" />
          <Field icon={Lock} label="Password (12+ characters)" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="input-setup-password" />
          <Button type="submit" className="w-full h-12 rounded-full" disabled={pending || !ok} data-testid="button-setup">Create administrator</Button>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSetup(false)}>Back to sign in</button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`${brand.short} Console`} sub="Staff sign in. Sessions are separate from user accounts.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const res = await run('login', { email: f.email, password: f.password, code: f.code || undefined }, { success: false });
        if (!res) return;
        if (res.requires2fa || res.requiresTwoFactor || res.twofa_required) { setNeed2fa(true); return; }
        navigate('/admin/dashboard');
      }}>
        <Field icon={Mail} label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-admin-email" />
        <Field icon={Lock} label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="input-admin-password" />
        {need2fa && <Field icon={KeyRound} label="Authenticator code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} data-testid="input-admin-code" />}
        <Button type="submit" className="w-full h-12 rounded-full" disabled={pending || !f.email || !f.password} data-testid="button-admin-login">Sign in</Button>
        {setupAvailable && <button type="button" className="w-full text-sm text-primary font-semibold" onClick={() => setSetup(true)} data-testid="button-open-setup">First run: create administrator</button>}
      </form>
    </AuthLayout>
  );
}
