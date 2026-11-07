import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBootstrap,
  getGetBootstrapQueryKey,
  useGetWorkspace,
  getGetWorkspaceQueryKey,
  getGetAdminWorkspaceQueryKey,
  useAccountAction,
  useUserAction,
  useAdminAction,
  useAdminAccountAction,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { setCsrf, csrfOpts, errorMessage, fileUrl, type R } from './api';
import i18n, { applyLanguage } from './i18n';

export const DEFAULT_BRAND = { site_name: 'MyCryptoVexa', short_name: 'Vexa' };

type Platform = {
  state: R;
  settings: R;
  user: R | null;
  brand: { name: string; short: string; logo?: string };
  booting: boolean;
  bootError: unknown;
  workspaceLoading: boolean;
  workspaceError: unknown;
  refetch: () => void;
};
const Ctx = createContext<Platform | null>(null);

function hexToHsl(hex: string) {
  const m = hex.replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const isObj = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);
/** Workspace settings layer over public bootstrap settings without dropping keys (terms, favicon, ...). */
export function deepMerge(a: R, b: R): R {
  const out: R = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === null) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const boot = useGetBootstrap({ query: { queryKey: getGetBootstrapQueryKey(), staleTime: 60000, retry: 1 } });
  const bootUser = (boot.data?.user as R | null) ?? null;
  const qc = useQueryClient();
  const uid = bootUser ? String(bootUser.id ?? bootUser.email ?? 'me') : null;
  // Workspace is scoped per signed-in identity so a different account never sees the previous account's cached data.
  const ws = useGetWorkspace({
    query: { enabled: !!uid, queryKey: [...getGetWorkspaceQueryKey(), uid] as unknown as ReturnType<typeof getGetWorkspaceQueryKey>, refetchInterval: 15000 },
  });
  const prevUid = useRef<string | null>(uid);
  useEffect(() => {
    if (prevUid.current !== uid) {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === getGetWorkspaceQueryKey()[0] && q.queryKey[1] !== uid });
      prevUid.current = uid;
    }
  }, [uid, qc]);
  useEffect(() => setCsrf((boot.data as R | undefined)?.csrfToken), [boot.data]);

  const state = useMemo<R>(() => {
    const b = (boot.data as R) || {};
    const wd = ws.data as R | undefined;
    const wu = wd?.user as R | undefined;
    const same = !wu || String(wu.id ?? wu.email ?? 'me') === uid;
    const w = uid && same ? (wd || {}) : {};
    return { ...b, ...w, settings: deepMerge((b.settings as R) || {}, (w.settings as R) || {}) };
  }, [boot.data, ws.data, uid]);
  const settings = (state.settings as R) || {};
  const user = bootUser ? ((state.user as R) ?? bootUser) : null;
  const branding = (settings.branding as R) || {};
  const brand = {
    name: settings.site_name || branding.site_name || DEFAULT_BRAND.site_name,
    short: settings.short_name || branding.short_name || DEFAULT_BRAND.short_name,
    logo: settings.logo || branding.logo,
  };

  useEffect(() => {
    const color = settings.brand_color || branding.brand_color;
    const hsl = typeof color === 'string' ? hexToHsl(color) : null;
    if (hsl) {
      const style=document.documentElement.style;
      style.setProperty('--primary', hsl);
      style.setProperty('--brand-start', color);
      const [h,s,l]=hsl.split(' ').map(parseFloat);
      style.setProperty('--brand-end', color.toLowerCase()==='#14b8a6'?'#10B981':`hsl(${(h+347)%360} ${Math.min(100,s+4)}% ${Math.max(0,l-1)}%)`);
      const channels=color.slice(1).match(/.{2}/g)!.map((x:string)=>parseInt(x,16)/255).map((x:number)=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
      const luminance=channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
      style.setProperty('--primary-foreground',luminance>0.179?'214 66% 7%':'0 0% 100%');
    }
    const fav = settings.favicon || branding.favicon;
    const link = document.getElementById('app-favicon') as HTMLLinkElement | null;
    if (link && typeof fav === 'string' && fav) link.href = fileUrl(fav);
    if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) {
      let tc = document.head.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (!tc) { tc = document.createElement('meta'); tc.name = 'theme-color'; document.head.appendChild(tc); }
      tc.content = color;
    }
    const icon = settings.app_icon || branding.app_icon;
    const apple = document.head.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
    if (apple && typeof icon === 'string' && icon) apple.href = fileUrl(icon);
    document.head.querySelector('meta[name="application-name"]')?.setAttribute('content', brand.name);
  }, [brand.name, settings.brand_color, settings.favicon, settings.app_icon, branding.brand_color, branding.favicon, branding.app_icon]);

  useEffect(() => {
    if (user?.language) applyLanguage(String(user.language));
  }, [user?.language]);
  useEffect(() => {
    const overrides=settings.translations;
    if(overrides&&typeof overrides==="object"){
      for(const [lang,strings] of Object.entries(overrides)){
        if(strings&&typeof strings==="object")i18n.addResourceBundle(lang,"translation",strings,true,true);
      }
    }
  }, [settings.translations]);

  return (
    <Ctx.Provider
      value={{
        state,
        settings,
        user,
        brand,
        booting: boot.isLoading,
        bootError: boot.error,
        workspaceLoading: !!bootUser && ws.isLoading,
        workspaceError: ws.error,
        refetch: () => {
          boot.refetch();
          if (bootUser) ws.refetch();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const usePlatform = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('PlatformProvider missing');
  return c;
};

export const list = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]) : []);

type Kind = 'account' | 'user' | 'admin' | 'adminAccount';
type RunOpts = { success?: string | false; onSuccess?: (res: R) => void; silentError?: boolean };

/** Shared mutation runner: CSRF header, toast, and cache invalidation across all workspaces. */
export function useRun(kind: Kind) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const request = { get headers() { return csrfOpts().headers; } } as { headers: Record<string, string> };
  const opts = { request };
  const acc = useAccountAction(opts);
  const usr = useUserAction(opts);
  const adm = useAdminAction(opts);
  const admAcc = useAdminAccountAction(opts);
  const m = { account: acc, user: usr, admin: adm, adminAccount: admAcc }[kind];

  const run = async (action: string, data: R = {}, o: RunOpts = {}): Promise<R | null> => {
    try {
      const payload = kind === 'adminAccount' || kind === 'account' ? { ...data } : { request_id: crypto.randomUUID(), ...data };
      const res = (await m.mutateAsync({ action, data: payload })) as R;
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetBootstrapQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetAdminWorkspaceQueryKey() }),
      ]);
      if (res && res.success === false) {
        if (!o.silentError) toast({ title: 'Not completed', description: res.message || 'The request was not accepted.', variant: 'destructive' });
        return null;
      }
      if (o.success !== false) toast({ title: o.success || res?.message || 'Done' });
      o.onSuccess?.(res);
      return res;
    } catch (e) {
      if (!o.silentError) toast({ title: 'Request failed', description: errorMessage(e), variant: 'destructive' });
      return null;
    }
  };
  return { run, pending: m.isPending };
}
