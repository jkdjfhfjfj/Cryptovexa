import { requestUpload } from '@workspace/api-client-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

let csrfToken = '';
export const setCsrf = (t: unknown) => {
  if (typeof t === 'string') csrfToken = t;
};
export const getCsrf = () => csrfToken;
export const csrfOpts = () => ({ headers: { 'x-csrf-token': csrfToken } });

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const anyE = e as R | null;
  return (
    anyE?.data?.error ||
    anyE?.data?.message ||
    (typeof anyE?.message === 'string' ? anyE.message : '') ||
    fallback
  );
}

/** Uploads must declare which session owns the file; admin and user cookies can coexist. */
export const authScope = () => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const path = window.location.pathname.slice(base.length) || '/';
  return /^\/admin(\/|$)/.test(path) ? 'admin' : 'user';
};

export async function uploadFile(file: File): Promise<string> {
  if (file.size > 10485760) throw new Error('File exceeds the 10 MB limit');
  const res = await requestUpload(
    { name: file.name, contentType: file.type || 'application/octet-stream', size: file.size },
    { headers: { ...csrfOpts().headers, 'x-auth-scope': authScope() } },
  );
  const put = await fetch(res.uploadURL, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!put.ok) throw new Error('Upload failed. Please try again.');
  return res.objectPath;
}

export const fileUrl = (p?: string) => {
  if (!p) return '';
  if (/^https?:|^\/api\//.test(p)) return p;
  if (p.startsWith('/') && !p.startsWith('/objects/')) return p;
  return `/api/v1/files/${p.replace(/^\//, '')}`;
};
export const invoiceUrl = (id: string | number) => `/api/v1/rentals/${id}/invoice`;
export const exportUrl = (type: string) => `/api/v1/export/${type}`;
export const adminExportUrl = (type: string) => `/api/admin/export/${type}`;
