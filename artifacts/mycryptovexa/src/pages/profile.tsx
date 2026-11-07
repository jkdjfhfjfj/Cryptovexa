import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { UserRound, ShieldCheck, KeyRound, MonitorSmartphone, SlidersHorizontal, Copy, Trash2, LogOut, Users, Bell, FileText, ChevronRight, BookUser, Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePlatform, list, useRun } from '@/lib/platform';
import { type R } from '@/lib/api';
import { when, ago, cooldownLabel, withdrawalCooldownMinutes } from '@/lib/format';
import { LANGUAGES, applyLanguage } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { PageHeader, PageSkeleton, ErrorState, EmptyState, StatusChip, SignInPrompt, CoinIcon } from '@/components/app/kit';

const NOTIF = ['deposits', 'withdrawals', 'rentals', 'referrals', 'security', 'marketing'];

export default function ProfilePage() {
  const { t } = useTranslation();
  const { state, user, settings, booting, workspaceLoading, workspaceError, refetch } = usePlatform();
  const acc = useRun('account');
  const usr = useRun('user');
  const { theme, setTheme } = useTheme();
  const [pw, setPw] = useState({ currentPassword: '', password: '', confirm: '' });
  const [tf, setTf] = useState<R | null>(null);
  const [code, setCode] = useState('');
  const [prof, setProf] = useState({ username: '', language: 'en' });
  const [notif, setNotif] = useState<Record<string, boolean>>({});
  const [key, setKey] = useState({ name: '', ip: '' });
  const [newKey, setNewKey] = useState('');
  const [newAddress, setNewAddress] = useState({ label: '', currency: '', network: '', address: '', memo: '' });

  useEffect(() => {
    if (user) {
      setProf({ username: String(user.username || ''), language: String(user.language || 'en') });
      setNotif(((user.preferences as R)?.notifications as Record<string, boolean>) || {});
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (booting || workspaceLoading) return <PageSkeleton />;
  if (!user) return <><PageHeader title={t('profile')} icon={UserRound} /><SignInPrompt /></>;
  if (workspaceError) return <ErrorState error={workspaceError} onRetry={refetch} />;

  const twofaMode = String(settings.twofa_mode || 'optional');
  const apiOn = !!settings.api_keys_enabled;
  const pwOk = pw.password.length >= 12 && pw.password === pw.confirm;
  const addressCooldown = withdrawalCooldownMinutes(settings);
  const addressCooldownText = cooldownLabel(addressCooldown);
  const currencies = list(state.currencies).filter((currency) => currency.enabled !== false);
  const selectedCurrency = currencies.find((currency) => currency.code === newAddress.currency);
  const addressNetworks = list(selectedCurrency?.networks).filter((network) => network.enabled !== false);
  const selectedNetwork = addressNetworks.find((network) => network.name === newAddress.network);
  let addressValid = !newAddress.address || !selectedNetwork?.address_regex;
  try {
    if (newAddress.address && selectedNetwork?.address_regex) addressValid = new RegExp(String(selectedNetwork.address_regex)).test(newAddress.address);
  } catch {
    addressValid = false;
  }
  const addressMemoRequired = !!selectedNetwork?.memo_required;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 rise">
        <div className="w-16 h-16 rounded-3xl brand-grad grid place-items-center text-2xl font-bold text-[#06101d]">{String(user.username || user.email).slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate" data-testid="text-username">{user.username}</h1>
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            <StatusChip status={user.email_verified ? 'verified' : 'pending'} />
            <StatusChip status={user.twofa_enabled ? 'active' : 'disabled'} className="[&]:capitalize" />
            {user.kyc_status && user.kyc_status !== 'none' && <StatusChip status={String(user.kyc_status)} />}
          </div>
        </div>
      </div>
      {!user.email_verified && (
        <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="flex-1">Verify your email to unlock deposits and withdrawals.</span>
          <Button size="sm" variant="outline" className="rounded-full" disabled={acc.pending} onClick={() => acc.run('resend-verification', {}, { success: 'Verification email sent' })} data-testid="button-resend-verification">Resend link</Button>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6 lg:hidden">
        {[{ h: '/referrals', i: Users, l: t('referrals') }, { h: '/kyc', i: ShieldCheck, l: t('kyc') }, { h: '/notifications', i: Bell, l: t('notifications') }, { h: '/legal/terms', i: FileText, l: 'Legal' }].map((x) => <Link key={x.h} href={x.h} className="press rounded-2xl border bg-card p-3 flex items-center gap-2 text-sm"><x.i className="w-4 h-4 text-primary" />{x.l}<ChevronRight className="w-4 h-4 ms-auto rtl:rotate-180 text-muted-foreground" /></Link>)}
      </div>
      <Tabs defaultValue="security">
        <TabsList className="rounded-full h-11 p-1 mb-4 w-full md:w-auto overflow-x-auto no-scrollbar justify-start">
          <TabsTrigger value="security" className="rounded-full" data-testid="tab-security"><ShieldCheck className="w-4 h-4 me-1.5" />{t('security')}</TabsTrigger>
          <TabsTrigger value="prefs" className="rounded-full" data-testid="tab-prefs"><SlidersHorizontal className="w-4 h-4 me-1.5" />{t('preferences')}</TabsTrigger>
          <TabsTrigger value="addresses" className="rounded-full" data-testid="tab-withdrawal-addresses"><BookUser className="w-4 h-4 me-1.5" />Withdrawal addresses</TabsTrigger>
          <TabsTrigger value="sessions" className="rounded-full" data-testid="tab-sessions"><MonitorSmartphone className="w-4 h-4 me-1.5" />{t('sessions')}</TabsTrigger>
          {apiOn && <TabsTrigger value="api" className="rounded-full" data-testid="tab-api"><KeyRound className="w-4 h-4 me-1.5" />{t('apiKeys')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="security" className="grid lg:grid-cols-2 gap-4">
          <section className="rounded-3xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">Change password</h3>
            <Input type="password" placeholder="Current password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className="rounded-xl" data-testid="input-current-password" />
            <Input type="password" placeholder="New password (12+ characters)" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} className="rounded-xl" data-testid="input-new-password" />
            <Input type="password" placeholder="Repeat new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="rounded-xl" data-testid="input-confirm-password" />
            {pw.password && !pwOk && <p className="text-xs text-destructive">Use at least 12 characters and make both entries match.</p>}
            <Button className="rounded-full" disabled={acc.pending || !pwOk || !pw.currentPassword} onClick={() => acc.run('change-password', { currentPassword: pw.currentPassword, password: pw.password }, { success: 'Password changed', onSuccess: () => setPw({ currentPassword: '', password: '', confirm: '' }) })} data-testid="button-change-password">Update password</Button>
          </section>
          <section className="rounded-3xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-semibold">Two-factor authentication</h3><StatusChip status={user.twofa_enabled ? 'active' : 'disabled'} /></div>
            <p className="text-xs text-muted-foreground">Policy: {twofaMode === 'off' ? 'disabled by the platform' : twofaMode === 'required' ? 'required for every account' : 'optional, strongly recommended'}.</p>
            {twofaMode === 'off' ? null : user.twofa_enabled ? (
              <>
                <Input value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="Authenticator code" className="rounded-xl num tracking-widest" data-testid="input-2fa-disable-code" />
                <Button variant="outline" className="rounded-full text-destructive" disabled={acc.pending || code.length < 6 || twofaMode === 'required'} onClick={() => acc.run('twofa-disable', { code }, { success: '2FA disabled', onSuccess: () => setCode('') })} data-testid="button-2fa-disable">Disable 2FA</Button>
              </>
            ) : tf ? (
              <div className="space-y-3 rise">
                <div className="flex gap-4 items-start">
                  <div className="p-2 rounded-2xl bg-[#f4f7fa]"><QRCodeSVG value={String(tf.uri)} size={132} fgColor="#0B1A2E" bgColor="#f4f7fa" /></div>
                  <div className="text-xs space-y-2 min-w-0"><p>Scan with your authenticator app, or enter:</p><code className="block break-all font-semibold">{tf.secret}</code></div>
                </div>
                {list(tf.recoveryCodes).length > 0 || Array.isArray(tf.recoveryCodes) ? (
                  <div className="rounded-2xl bg-muted p-3"><div className="text-xs font-semibold mb-2">Recovery codes, shown once. Store them offline.</div><div className="grid grid-cols-2 gap-1 font-mono text-xs">{(tf.recoveryCodes as string[]).map((c) => <span key={c}>{c}</span>)}</div></div>
                ) : null}
                <Input value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="6-digit code" className="rounded-xl num tracking-widest" data-testid="input-2fa-enable-code" />
                <Button className="rounded-full" disabled={acc.pending || code.length < 6} onClick={() => acc.run('twofa-enable', { code }, { success: '2FA enabled', onSuccess: () => { setTf(null); setCode(''); } })} data-testid="button-2fa-enable">Turn on 2FA</Button>
              </div>
            ) : (
              <Button className="rounded-full" disabled={acc.pending} onClick={() => acc.run('twofa-setup', {}, { success: false, onSuccess: (r) => setTf(r) })} data-testid="button-2fa-setup">Set up authenticator</Button>
            )}
          </section>
        </TabsContent>

        <TabsContent value="prefs" className="grid lg:grid-cols-2 gap-4">
          <section className="rounded-3xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">Profile</h3>
            <div><Label>Username</Label><Input value={prof.username} onChange={(e) => setProf({ ...prof, username: e.target.value })} className="mt-1 rounded-xl" data-testid="input-username" /></div>
            <div><Label>{t('language')}</Label>
              <Select value={prof.language} onValueChange={(v) => setProf({ ...prof, language: v })}><SelectTrigger className="mt-1 rounded-xl" data-testid="select-language"><SelectValue /></SelectTrigger><SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent></Select>
            </div>
            <Button className="rounded-full" disabled={acc.pending || !prof.username} onClick={() => acc.run('update-profile', { username: prof.username, language: prof.language, preferences: { theme, notifications: notif } }, { success: 'Profile saved', onSuccess: () => applyLanguage(prof.language) })} data-testid="button-save-profile">{t('save')}</Button>
          </section>
          <section className="rounded-3xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">{t('theme')} and notifications</h3>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-full bg-muted">{(['light', 'dark', 'system'] as const).map((m) => <button key={m} onClick={() => setTheme(m)} className={`rounded-full py-2 text-sm capitalize ${theme === m ? 'bg-card shadow font-semibold' : 'text-muted-foreground'}`} data-testid={`button-theme-${m}`}>{m}</button>)}</div>
            <div className="divide-y">{NOTIF.map((k) => <label key={k} className="flex items-center justify-between py-2.5 text-sm capitalize">{k}{k === 'security' ? ' (required)' : ''}<Switch checked={k === 'security' || notif[k] !== false} disabled={k === 'security'} onCheckedChange={(v) => setNotif({ ...notif, [k]: v })} data-testid={`switch-notif-${k}`} /></label>)}</div>
            <Button className="rounded-full" disabled={usr.pending} onClick={() => usr.run('profile-preferences', { language: prof.language, theme, notifications: notif }, { success: 'Preferences saved' })} data-testid="button-save-prefs">{t('save')}</Button>
          </section>
        </TabsContent>

        <TabsContent value="addresses" className="space-y-4">
          <section className="rounded-3xl border bg-card p-5 space-y-4">
            <div>
              <h3 className="font-semibold">Withdrawal addresses</h3>
              <p className="text-sm text-muted-foreground mt-1">Whitelist the destination first. New addresses become available after {addressCooldownText}; withdrawals can only go to saved addresses.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Address label</Label><Input placeholder="My wallet" value={newAddress.label} onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })} className="mt-1 rounded-xl" data-testid="input-profile-address-label" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Currency</Label><Select value={newAddress.currency} onValueChange={(currency) => setNewAddress({ ...newAddress, currency, network: '' })}><SelectTrigger className="mt-1 rounded-xl" data-testid="select-profile-address-currency"><SelectValue placeholder="Coin" /></SelectTrigger><SelectContent>{currencies.map((currency) => <SelectItem key={String(currency.code)} value={String(currency.code)}>{String(currency.code)}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Network</Label><Select value={newAddress.network} onValueChange={(network) => setNewAddress({ ...newAddress, network })}><SelectTrigger className="mt-1 rounded-xl" data-testid="select-profile-address-network"><SelectValue placeholder="Network" /></SelectTrigger><SelectContent>{addressNetworks.map((network) => <SelectItem key={String(network.name)} value={String(network.name)}>{String(network.name)}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="sm:col-span-2"><Label>Wallet address</Label><Input placeholder="Paste the exact destination address" value={newAddress.address} onChange={(e) => setNewAddress({ ...newAddress, address: e.target.value.trim() })} className="mt-1 rounded-xl font-mono text-xs" data-testid="input-profile-address" />{!addressValid && <p className="text-xs text-destructive mt-1">This address does not match the selected network.</p>}</div>
              <div className="sm:col-span-2"><Label>{addressMemoRequired ? 'Memo / tag (required)' : 'Memo / tag (optional)'}</Label><Input placeholder="Only if your exchange requires it" value={newAddress.memo} onChange={(e) => setNewAddress({ ...newAddress, memo: e.target.value })} className="mt-1 rounded-xl" data-testid="input-profile-address-memo" /></div>
            </div>
            <Button disabled={usr.pending || !newAddress.label.trim() || !newAddress.currency || !newAddress.network || !newAddress.address || !addressValid || (addressMemoRequired && !newAddress.memo.trim())} onClick={() => usr.run('address-create', { ...newAddress, memo: newAddress.memo || undefined }, { success: `Address saved. Usable after ${addressCooldownText}.`, onSuccess: () => setNewAddress({ label: '', currency: '', network: '', address: '', memo: '' }) })} className="rounded-full" data-testid="button-profile-save-address"><Plus className="w-4 h-4 me-1.5" />Whitelist address</Button>
          </section>
          <section className="rounded-3xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">Saved destinations</h3>
            {list(state.addressBook).length ? list(state.addressBook).map((address) => {
              const cooling = new Date(String(address.usable_after)).getTime() > Date.now();
              return <div key={String(address.id)} className="flex items-center gap-3 rounded-2xl border p-3" data-testid={`row-profile-address-${address.id}`}>
                <CoinIcon code={String(address.currency)} size={30} />
                <div className="flex-1 min-w-0"><div className="font-medium text-sm">{address.label} · {address.currency}/{address.network}</div><div className="text-xs font-mono break-all">{address.address}{address.memo ? ` · ${address.memo}` : ''}</div><div className="text-[11px] mt-1 text-muted-foreground">{cooling ? `Cooling until ${when(address.usable_after)}` : 'Ready for withdrawals'}</div></div>
                <Button size="icon" variant="ghost" className="rounded-full shrink-0" disabled={usr.pending} onClick={() => usr.run('address-delete', { id: address.id }, { success: 'Withdrawal address removed' })} aria-label={`Remove ${address.label}`} data-testid={`button-profile-delete-address-${address.id}`}><Trash2 className="w-4 h-4" /></Button>
              </div>;
            }) : <EmptyState icon={BookUser} title="No withdrawal addresses yet" body="Whitelist an address above before requesting a withdrawal." />}
          </section>
        </TabsContent>

        <TabsContent value="sessions">
          {list(state.sessions).length ? <div className="rounded-3xl border bg-card divide-y">{list(state.sessions).map((s) => (
            <div key={String(s.id)} className="flex items-center gap-3 p-4" data-testid={`row-session-${s.id}`}>
              <MonitorSmartphone className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{s.device || s.user_agent || 'Unknown device'} {s.current && <span className="text-primary text-xs">· this device</span>}</div><div className="text-xs text-muted-foreground">{s.ip} · {ago(s.created_at)}</div></div>
              {!s.revoked && !s.current && <Button size="sm" variant="outline" className="rounded-full" disabled={acc.pending} onClick={() => acc.run('revoke-session', { id: s.id }, { success: 'Session revoked' })} data-testid={`button-revoke-session-${s.id}`}><LogOut className="w-4 h-4 me-1" />Revoke</Button>}
              {s.revoked && <StatusChip status="closed" />}
            </div>))}</div> : <EmptyState icon={MonitorSmartphone} title="No sessions listed" />}
        </TabsContent>

        {apiOn && (
          <TabsContent value="api" className="grid lg:grid-cols-[1fr_360px] gap-4">
            <div className="space-y-2">
              {newKey && <div className="rounded-3xl border-2 border-primary bg-accent/40 p-4"><div className="text-sm font-semibold">Copy this key now. It will not be shown again.</div><div className="mt-2 flex items-center gap-2"><code className="text-xs break-all flex-1" data-testid="text-new-key">{newKey}</code><Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(newKey)}><Copy className="w-4 h-4" /></Button></div></div>}
              {list(state.apiKeys).length ? list(state.apiKeys).map((k) => (
                <div key={String(k.id)} className="rounded-2xl border bg-card p-4 flex items-center gap-3" data-testid={`row-apikey-${k.id}`}>
                  <KeyRound className="w-5 h-5 text-primary" />
                  <div className="flex-1 min-w-0"><div className="font-medium text-sm">{k.name} <span className="text-xs text-muted-foreground">read-only</span></div><div className="text-xs text-muted-foreground">IPs: {Array.isArray(k.ip_allowlist) ? k.ip_allowlist.join(', ') || 'any' : k.ip_allowlist || 'any'} · last used {k.last_used ? when(k.last_used) : 'never'}</div></div>
                  {k.revoked ? <StatusChip status="closed" /> : <Button size="icon" variant="ghost" className="rounded-full" disabled={acc.pending} onClick={() => acc.run('api-key-revoke', { id: k.id }, { success: 'Key revoked' })} data-testid={`button-revoke-key-${k.id}`}><Trash2 className="w-4 h-4" /></Button>}
                </div>)) : <EmptyState icon={KeyRound} title="No API keys" body="Keys are read-only and can never move funds." />}
            </div>
            <div className="rounded-3xl border bg-card p-5 space-y-3 h-fit">
              <h3 className="font-semibold">New read-only key</h3>
              <Input placeholder="Name" value={key.name} onChange={(e) => setKey({ ...key, name: e.target.value })} className="rounded-xl" data-testid="input-key-name" />
              <Input placeholder="IP allowlist, comma separated" value={key.ip} onChange={(e) => setKey({ ...key, ip: e.target.value })} className="rounded-xl" data-testid="input-key-ips" />
              <Button className="w-full rounded-full" disabled={acc.pending || !key.name} onClick={() => acc.run('api-key-create', { name: key.name, ip_allowlist: key.ip.split(',').map((x) => x.trim()).filter(Boolean) }, { success: 'Key created', onSuccess: (r) => { setNewKey(String(r.key ?? r.apiKey ?? '')); setKey({ name: '', ip: '' }); } })} data-testid="button-create-key">Create key</Button>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
