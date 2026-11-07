import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export type PromptField = { key: string; label: string; required?: boolean; multiline?: boolean; type?: string; placeholder?: string; initial?: string; step?: string; maxDecimals?: number; allowNegative?: boolean };

/** Modal form for review actions that need reasons, amounts or TXIDs. */
export function usePrompt() {
  const [cfg, setCfg] = useState<{ title: string; body?: string; fields: PromptField[]; confirm?: string; danger?: boolean; ack?: string; onSubmit: (v: Record<string, string>) => Promise<unknown> | void } | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = (c: NonNullable<typeof cfg>) => {
    setVals(Object.fromEntries(c.fields.map((f) => [f.key, f.initial ?? ''])));
    setAck(false);
    setCfg(c);
  };
  const valid = cfg && cfg.fields.every((f) => {
    const value = (vals[f.key] || '').trim();
    if (f.required && !value) return false;
    if (!value || !f.maxDecimals) return true;
    const sign = f.allowNegative ? '-?' : '';
    return new RegExp(`^${sign}\\d+(?:\\.\\d{1,${f.maxDecimals}})?$`).test(value);
  }) && (!cfg.ack || ack);
  const node: ReactNode = (
    <Dialog open={!!cfg} onOpenChange={(o) => !o && setCfg(null)}>
      <DialogContent className="rounded-3xl">
        <DialogHeader><DialogTitle>{cfg?.title}</DialogTitle>{cfg?.body && <DialogDescription>{cfg.body}</DialogDescription>}</DialogHeader>
        <div className="space-y-3">
          {cfg?.fields.map((f) => (
            <div key={f.key}>
              <Label className="text-xs">{f.label}{f.required && ' *'}</Label>
              {f.multiline ? <Textarea rows={3} value={vals[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} className="mt-1 rounded-xl" data-testid={`prompt-${f.key}`} />
                : <Input type={f.type || 'text'} step={f.step} value={vals[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} className="mt-1 rounded-xl" data-testid={`prompt-${f.key}`} />}
            </div>
          ))}
          {cfg?.ack && <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="prompt-ack" />{cfg.ack}</label>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => setCfg(null)}>Cancel</Button>
          <Button className={`rounded-full ${cfg?.danger ? 'bg-destructive hover:bg-destructive/90' : ''}`} disabled={!valid || busy} data-testid="prompt-confirm"
            onClick={async () => { if (!cfg) return; setBusy(true); try { const r = await cfg.onSubmit(vals); if (r !== null && r !== false) setCfg(null); } finally { setBusy(false); } }}>{cfg?.confirm || 'Confirm'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { open, node };
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4"><h3 className="font-semibold">{title}</h3>{action}</div>
      {children}
    </section>
  );
}
