import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Bold, Italic, List, ListOrdered, Link2, Unlink, ImagePlus, Undo2, Redo2, Code2, Eye, Pilcrow, Heading2, Heading3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Mirrors backend sanitize-html config: defaults + img,h1,h2,span; a[href,title,target,rel]; img[src,alt,width,height]
const ALLOWED = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre', 'hr', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sub', 'sup', 'small', 'mark', 'abbr', 'caption']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'svg', 'math', 'template', 'noscript']);
const ATTRS: Record<string, string[]> = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'] };

export function safeUrl(raw: string, allowMail = false): string | null {
  const v = raw.trim();
  if (/^\{\{\s*\w+\s*\}\}$/.test(v)) return v; // template variable placeholder
  if (allowMail && /^mailto:[^\s<>"]+$/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  try { const u = new URL(v); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

export function sanitizeRichHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Element) => {
    Array.from(node.children).forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) { el.remove(); return; }
      walk(el);
      if (!ALLOWED.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); return; }
      const keep = ATTRS[tag] || [];
      Array.from(el.attributes).forEach((a) => { if (!keep.includes(a.name)) el.removeAttribute(a.name); });
      if (tag === 'a') {
        const h = el.getAttribute('href'); const s = h ? safeUrl(h, true) : null;
        if (h && !s) el.removeAttribute('href'); else if (s) el.setAttribute('href', s);
        if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'img') {
        const s = safeUrl(el.getAttribute('src') || '');
        if (!s) { el.remove(); return; }
        el.setAttribute('src', s);
        if (!el.hasAttribute('alt')) el.setAttribute('alt', '');
      }
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/&nbsp;/g, ' ').trim();
}

type Props = { value: string; onChange: (v: string) => void; label: string; id?: string; testId?: string; minHeight?: number; hint?: string };

export function RichTextEditor({ value, onChange, label, id = 'rte', testId = 'rte', minHeight = 280, hint }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>('');
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const [mode, setMode] = useState<'visual' | 'source'>('visual');
  const [panel, setPanel] = useState<null | 'link' | 'image'>(null);
  const [url, setUrl] = useState(''); const [alt, setAlt] = useState(''); const [err, setErr] = useState('');
  const [active, setActive] = useState<Record<string, boolean>>({});
  const saved = useRef<Range | null>(null);

  // controlled sync: only overwrite DOM when value changed externally
  useEffect(() => {
    if (mode !== 'visual' || !ref.current) return;
    if (value !== last.current) { ref.current.innerHTML = sanitizeRichHtml(value); last.current = value; }
  }, [value, mode]);

  const emit = () => {
    if (!ref.current) return;
    const out = sanitizeRichHtml(ref.current.innerHTML);
    last.current = out; onChangeRef.current(out);
  };
  const refresh = () => {
    try { setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), ul: document.queryCommandState('insertUnorderedList'), ol: document.queryCommandState('insertOrderedList') }); } catch { /* noop */ }
  };
  const exec = (cmd: string, arg?: string) => { ref.current?.focus(); document.execCommand(cmd, false, arg); emit(); refresh(); };
  const saveSel = () => { const s = window.getSelection(); saved.current = s && s.rangeCount && ref.current?.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
  const restoreSel = () => { ref.current?.focus(); const s = window.getSelection(); if (saved.current && s) { s.removeAllRanges(); s.addRange(saved.current); } };
  const open = (p: 'link' | 'image') => { saveSel(); setUrl(''); setAlt(''); setErr(''); setPanel(p); };

  const apply = () => {
    const s = safeUrl(url, panel === 'link');
    if (!s || s.startsWith('{{') && panel === 'image') { setErr(panel === 'image' ? 'Image URLs must start with https:// (plain http:// is removed on save) or be site-relative.' : 'Links must use https://, mailto: or a site-relative path. Plain http:// is removed on save.'); return; }
    restoreSel();
    if (panel === 'link') {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) document.execCommand('createLink', false, s);
      else { const a = document.createElement('a'); a.href = s; a.textContent = alt || s; document.execCommand('insertHTML', false, a.outerHTML); }
    } else {
      const img = document.createElement('img'); img.src = s; img.alt = alt.trim();
      document.execCommand('insertHTML', false, img.outerHTML);
    }
    emit(); setPanel(null);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitizeRichHtml(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    emit();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); open('link'); }
  };

  const Btn = ({ icon: I, label: l, on, pressed, disabled }: { icon: typeof Bold; label: string; on: () => void; pressed?: boolean; disabled?: boolean }) => (
    <button type="button" aria-label={l} title={l} aria-pressed={pressed} disabled={disabled || mode === 'source'} onMouseDown={(e) => e.preventDefault()} onClick={on}
      className={cn('h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none', pressed && 'bg-accent text-accent-foreground')}
      data-testid={`${testId}-btn-${l.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}><I className="w-4 h-4" /></button>
  );

  return (
    <div className="rounded-2xl border bg-card overflow-hidden focus-within:ring-2 focus-within:ring-ring/40" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
        <span id={`${id}-label`} className="text-xs font-semibold tracking-wide">{label}</span>
        <div role="tablist" aria-label="Editor mode" className="inline-flex rounded-full border bg-background p-0.5 text-[11px]">
          {(['visual', 'source'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { if (m === 'visual' && mode === 'source') { last.current = ''; onChangeRef.current(sanitizeRichHtml(value)); } setMode(m); setPanel(null); }}
              className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium', mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`${testId}-mode-${m}`}>
              {m === 'visual' ? <Eye className="w-3 h-3" /> : <Code2 className="w-3 h-3" />}{m === 'visual' ? 'Visual' : 'HTML source'}
            </button>
          ))}
        </div>
      </div>
      <div role="toolbar" aria-label="Formatting" aria-controls={id} className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
        <Btn icon={Pilcrow} label="Paragraph" on={() => exec('formatBlock', '<p>')} />
        <Btn icon={Heading2} label="Heading 2" on={() => exec('formatBlock', '<h2>')} />
        <Btn icon={Heading3} label="Heading 3" on={() => exec('formatBlock', '<h3>')} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn icon={Bold} label="Bold" pressed={active.bold} on={() => exec('bold')} />
        <Btn icon={Italic} label="Italic" pressed={active.italic} on={() => exec('italic')} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn icon={List} label="Bulleted list" pressed={active.ul} on={() => exec('insertUnorderedList')} />
        <Btn icon={ListOrdered} label="Numbered list" pressed={active.ol} on={() => exec('insertOrderedList')} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn icon={Link2} label="Insert link" on={() => open('link')} />
        <Btn icon={Unlink} label="Remove link" on={() => exec('unlink')} />
        <Btn icon={ImagePlus} label="Insert image" on={() => open('image')} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Btn icon={Undo2} label="Undo" on={() => exec('undo')} />
        <Btn icon={Redo2} label="Redo" on={() => exec('redo')} />
      </div>
      {panel && (
        <div className="flex flex-wrap items-start gap-2 border-b bg-accent/30 px-3 py-2" role="group" aria-label={panel === 'link' ? 'Link details' : 'Image details'}>
          <Input autoFocus aria-label={panel === 'link' ? 'Link URL' : 'Public image URL'} placeholder={panel === 'link' ? 'https://... or /help/slug' : 'https://cdn.example.com/image.png'} value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') setPanel(null); }} className="h-8 rounded-lg text-xs flex-1 min-w-48" data-testid={`${testId}-input-url`} />
          <Input aria-label={panel === 'link' ? 'Link text (if nothing selected)' : 'Alt text'} placeholder={panel === 'link' ? 'Text (optional)' : 'Alt text for screen readers'} value={alt} onChange={(e) => setAlt(e.target.value)} className="h-8 rounded-lg text-xs w-48" data-testid={`${testId}-input-alt`} />
          <button type="button" onClick={apply} className="h-8 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground" data-testid={`${testId}-button-apply`}>Insert</button>
          <button type="button" onClick={() => setPanel(null)} className="h-8 rounded-full border px-3 text-xs">Cancel</button>
          <p className="w-full text-[11px] text-muted-foreground">{err ? <span className="text-destructive" role="alert">{err}</span> : panel === 'image' ? 'Images must be public https:// or site-relative URLs. Private uploads (KYC, receipts) are never embedded.' : 'Only https://, mailto: and site-relative links are kept.'}</p>
        </div>
      )}
      {mode === 'visual' ? (
        <div id={id} ref={ref} role="textbox" aria-multiline="true" aria-labelledby={`${id}-label`} contentEditable suppressContentEditableWarning
          onInput={emit} onBlur={emit} onPaste={onPaste} onKeyDown={onKey} onKeyUp={refresh} onMouseUp={refresh} data-placeholder="Start writing"
          style={{ minHeight }} className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 outline-none overflow-y-auto max-h-[60vh] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl" data-testid={`${testId}-visual`} />
      ) : (
        <Textarea id={id} aria-labelledby={`${id}-label`} value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => onChange(sanitizeRichHtml(value))} style={{ minHeight }} className="rounded-none border-0 font-mono text-xs focus-visible:ring-0" data-testid={`${testId}-source`} />
      )}
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{hint || 'The visual editor keeps only supported HTML; the server sanitizes again on save. Template variables like {{site_name}} are preserved.'}</div>
    </div>
  );
}
