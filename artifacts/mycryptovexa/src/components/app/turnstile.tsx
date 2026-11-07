import { useEffect, useRef } from 'react';
import { usePlatform } from '@/lib/platform';

type TS = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void };
declare global { interface Window { turnstile?: TS } }

let loading: Promise<void> | null = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error('captcha')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function useCaptchaConfig() {
  const { settings } = usePlatform();
  const sec = (settings.security as Record<string, unknown>) || {};
  const enabled = !!(settings.captcha_enabled ?? sec.captcha_enabled);
  const siteKey = String(settings.captcha_site_key ?? sec.captcha_site_key ?? '');
  return { enabled: enabled && !!siteKey, misconfigured: enabled && !siteKey, siteKey };
}

/** Cloudflare Turnstile challenge. Changing `resetKey` forces a fresh challenge. */
export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (t: string) => void; resetKey: number }) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken); cb.current = onToken;
  useEffect(() => {
    let dead = false;
    loadScript().then(() => {
      if (dead || !el.current || !window.turnstile) return;
      id.current = window.turnstile.render(el.current, {
        sitekey: siteKey,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(''),
        'error-callback': () => cb.current(''),
      });
    }).catch(() => cb.current(''));
    return () => { dead = true; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = null; };
  }, [siteKey]);
  useEffect(() => { if (resetKey && id.current && window.turnstile) { window.turnstile.reset(id.current); cb.current(''); } }, [resetKey]);
  return <div ref={el} className="min-h-[65px] flex justify-center" data-testid="captcha-turnstile" />;
}
