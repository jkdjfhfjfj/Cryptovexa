import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, KeyRound, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRun } from '@/lib/platform';
import { type R } from '@/lib/api';
import { StatusChip } from '@/components/app/kit';
import { useAdmin, AdminTitle } from './shell';
import { Section } from './parts';

/** Admin's own security: authenticator setup via adminAccountAction twofa-setup / twofa-enable. */
export default function AdminSecurity() {
  const { admin, state } = useAdmin();
  const { run, pending } = useRun('adminAccount');
  const [tf, setTf] = useState<R | null>(null);
  const [code, setCode] = useState('');
  const mode = String(((state.settings as R)?.security as R)?.admin_twofa_mode ?? (state.settings as R)?.admin_twofa_mode ?? 'optional');
  const uri = tf ? String(tf.uri || tf.otpauth_url || tf.otpauthUrl || tf.otpauth || '') : '';
  const secret = tf ? String(tf.secret || '') : '';
  return (
    <div className="max-w-2xl">
      <AdminTitle title="My security" sub={String(admin.email || '')} />
      <Section title="Two-factor authentication" action={<StatusChip status={admin.twofa_enabled ? 'active' : 'disabled'} />}>
        <p className="text-sm text-muted-foreground mb-4">{mode === 'required' ? 'Required by policy. Console actions stay blocked until your authenticator is enabled.' : 'Strongly recommended for every staff account.'}</p>
        {admin.twofa_enabled ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600"><ShieldCheck className="w-4 h-4" />Authenticator is active on this account. Ask a superadmin to reset it if you lose your device.</div>
        ) : tf ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {uri && <div className="p-2 rounded-2xl bg-[#f4f7fa]"><QRCodeSVG value={uri} size={148} fgColor="#0B1A2E" bgColor="#f4f7fa" /></div>}
              <div className="text-sm space-y-2">
                <p>Scan with your authenticator app, or enter the key manually.</p>
                {secret && <button className="font-mono text-xs rounded-xl bg-muted px-3 py-2 flex items-center gap-2 break-all" onClick={() => navigator.clipboard.writeText(secret)} data-testid="button-copy-admin-secret">{secret}<Copy className="w-3.5 h-3.5 shrink-0" /></button>}
              </div>
            </div>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="rounded-xl num tracking-[0.3em] max-w-[180px]" data-testid="input-admin-2fa-code" />
              <Button className="rounded-full" disabled={pending || code.length < 6} onClick={() => run('twofa-enable', { code }, { success: 'Authenticator enabled', onSuccess: () => { setTf(null); setCode(''); } })} data-testid="button-admin-2fa-enable">Enable</Button>
            </div>
          </div>
        ) : (
          <Button className="rounded-full" disabled={pending} onClick={() => run('twofa-setup', {}, { success: false, onSuccess: (r) => setTf(r) })} data-testid="button-admin-2fa-setup"><KeyRound className="w-4 h-4 me-1.5" />Set up authenticator</Button>
        )}
      </Section>
    </div>
  );
}
