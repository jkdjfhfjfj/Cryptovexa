import { formatDistanceToNowStrict, format } from 'date-fns';
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN });
export { Decimal };

/** Safe Decimal from any API money value (decimal strings). Invalid -> 0. */
export const D = (v: unknown): Decimal => {
  if (v instanceof Decimal) return v;
  const s = String(v ?? '').trim();
  if (!s) return new Decimal(0);
  try { const d = new Decimal(s); return d.isFinite() ? d : new Decimal(0); } catch { return new Decimal(0); }
};
export const dsum = (vals: unknown[]) => vals.reduce<Decimal>((a, v) => a.plus(D(v)), new Decimal(0));
export const dmax0 = (d: Decimal) => (d.isNegative() ? new Decimal(0) : d);

function group(fixed: string, minDp: number) {
  const neg = fixed.startsWith('-');
  const [i, f = ''] = fixed.replace('-', '').split('.');
  let frac = f.replace(/0+$/, '');
  if (frac.length < minDp) frac = frac.padEnd(minDp, '0');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
};

/** Display money with decimal precision (no float conversion). */
export const amount = (v: unknown, max = 8) => {
  const d = D(v);
  const dp = !d.isZero() && d.abs().lt(1) ? max : Math.max(4, Math.min(max, d.decimalPlaces()));
  return group(d.toFixed(Math.min(dp, max), Decimal.ROUND_DOWN), 2);
};

export const usd = (v: unknown) => {
  const d = D(v);
  return `${d.isNegative() ? '-' : ''}$${group(d.abs().toFixed(2, Decimal.ROUND_HALF_UP), 2)}`;
};

export const when = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy, HH:mm');
};
export const ago = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? '—' : formatDistanceToNowStrict(d, { addSuffix: true });
};

export const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return (d ? `${d}d ` : '') + `${pad(h)}:${pad(m)}:${pad(sec)}`;
};

export const maskEmail = (e?: string) => {
  if (!e || !e.includes('@')) return e || '—';
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(2, u.length - 2))}@${d}`;
};

export const titleCase = (s?: string) => (s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
