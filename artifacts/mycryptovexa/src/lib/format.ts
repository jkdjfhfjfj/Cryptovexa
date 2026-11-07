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

/** Display money to three places without converting through floating point. */
export const amount = (v: unknown) => {
  const d = D(v);
  const rounded = d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  if (!d.isZero() && rounded.isZero()) return d.isNegative() ? '-<0.001' : '<0.001';
  return group(rounded.toFixed(3), 3);
};

export const usd = (v: unknown) => {
  const d = D(v);
  return `${d.isNegative() ? '-' : ''}$${group(d.abs().toFixed(3, Decimal.ROUND_HALF_UP), 3)}`;
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

/** Keep storage/audit event names stable while showing user-friendly ledger terminology. */
export const ledgerLabel = (value: unknown) => {
  const label = String(value ?? '').replace(/_/g, ' ');
  const labels: Record<string, string> = {
    'admin adjustment': 'Balance adjustment',
    'rental principal lock': 'Rental principal locked',
    'rental principal release': 'Rental principal released',
    'rental profit': 'Rental profit payout',
    'rental charge': 'Legacy rental charge',
    'rental refund': 'Legacy rental refund',
    'rental extension': 'Legacy rental extension',
  };
  return labels[label] ?? label;
};

export const ledgerMovement = (entry: { type?: unknown; amount?: unknown; principal_amount?: unknown }) => {
  const type = String(entry.type ?? '');
  if (type === 'rental_principal_lock') return `Locked ${amount(entry.principal_amount)}`;
  if (type === 'rental_principal_release') return `Released ${amount(entry.principal_amount)}`;
  const value = D(entry.amount);
  return `${value.isNegative() ? '' : '+'}${amount(value)}`;
};

export function withdrawalCooldownMinutes(settings: unknown) {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const rules = root.withdrawal_rules && typeof root.withdrawal_rules === 'object'
    ? root.withdrawal_rules as Record<string, unknown>
    : root;
  const stored = Number(rules.cooldown_minutes);
  if (Number.isFinite(stored) && stored >= 1) return Math.ceil(stored);
  const value = Number(rules.cooldown_value ?? rules.new_address_cooldown_value ?? rules.cooldown_hours ?? 24);
  const unit = String(rules.cooldown_unit ?? rules.new_address_cooldown_unit ?? 'hours');
  const minutes = value * (unit === 'minutes' ? 1 : 60);
  return Number.isFinite(minutes) && minutes >= 1 ? Math.ceil(minutes) : 1440;
}

export const cooldownLabel = (minutes: number) => minutes % 60 === 0
  ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  : `${minutes} minute${minutes === 1 ? '' : 's'}`;

export const cooldownAdjective = (minutes: number) => minutes % 60 === 0
  ? `${minutes / 60}-hour`
  : `${minutes}-minute`;
