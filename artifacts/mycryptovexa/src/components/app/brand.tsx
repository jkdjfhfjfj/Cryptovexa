import { useId } from 'react';
import { cn } from '@/lib/utils';
import { fileUrl } from '@/lib/api';

export function BrandMark({ size = 32, white = false, className }: { size?: number; white?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  const s = white ? '#fff' : `url(#g${id})`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-start, #14B8A6)" />
          <stop offset="1" stopColor="var(--brand-end, #10B981)" />
        </linearGradient>
      </defs>
      <path d="M32 4 56 18v28L32 60 8 46V18Z" stroke={s} strokeWidth="4" />
      <path d="m21 25 11 19 11-19" stroke={s} strokeWidth="6" />
      <circle cx="32" cy="16" r="3" fill={s} />
    </svg>
  );
}

export function Logo({ name, logo, size = 30, className }: { name: string; logo?: string; size?: number; className?: string }) {
  const short = name.replace(/[^A-Z]/g, '') || name.slice(0, 3).toUpperCase();
  return (
    <span className={cn('flex items-center gap-2.5', className)} data-testid="brand-logo">
      {logo ? <img src={fileUrl(logo)} alt="" style={{ width: size, height: size }} className="rounded-lg object-contain" /> : <BrandMark size={size} />}
      <span className="font-semibold tracking-tight leading-none" style={{ fontSize: size * 0.62 }}>
        {short.slice(0, -1)}
        <i className="not-italic font-extrabold text-grad">{short.slice(-1)}</i>
      </span>
    </span>
  );
}

export function HexLoader({ size = 56, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={cn('hex-loader', className)} width={size} height={size} viewBox="0 0 64 64" fill="none" strokeLinecap="round" strokeLinejoin="round" role="status" aria-label="Loading">
      <defs>
        <linearGradient id={`l${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-start, #14B8A6)" />
          <stop offset="1" stopColor="var(--brand-end, #10B981)" />
        </linearGradient>
      </defs>
      <path className="h" pathLength={100} d="M32 4 56 18v28L32 60 8 46V18Z" stroke={`url(#l${id})`} strokeWidth="4" />
      <path className="v" d="m21 25 11 19 11-19" stroke={`url(#l${id})`} strokeWidth="6" />
    </svg>
  );
}

export function Splash({ name }: { name: string }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background" data-testid="splash">
      <div className="flex flex-col items-center gap-5">
        <div className="relative grid place-items-center w-24 h-24">
          <span className="absolute inset-0 rounded-full border-2 border-primary ring-pulse" />
          <span className="absolute inset-0 rounded-full border-2 border-primary ring-pulse [animation-delay:1.1s]" />
          <BrandMark size={64} />
        </div>
        <div className="text-sm tracking-[0.3em] uppercase text-muted-foreground">{name}</div>
        <div className="w-28 h-1 rounded-full bg-muted overflow-hidden">
          <b className="block w-2/5 h-full rounded-full brand-grad bar-slide" />
        </div>
      </div>
    </div>
  );
}
