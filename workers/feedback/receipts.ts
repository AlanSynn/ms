import { isDigest, isSubmissionId } from './validation';

export const FEEDBACK_REPOSITORY = 'AlanSynn/ms';
export const FEEDBACK_REPOSITORY_ID = '1283287676';
const encoder = new TextEncoder();
const RECEIPT_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export interface UploadReceipt {
  version: 1;
  repository: typeof FEEDBACK_REPOSITORY;
  submissionId: string;
  digest: string;
  attachment: string | null;
  phase: 'uploaded' | 'unknown';
  expiresAt: number;
}

function base64url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid receipt');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signValue(secret: string, value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(value))));
}

export function isNativeAttachmentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && /^\/user-attachments\/assets\/[a-zA-Z0-9_-]+$/.test(url.pathname)
      && url.href === value;
  } catch { return false; }
}

export async function createUploadReceipt(
  secret: string, submissionId: string, digest: string, attachment: string | null,
  phase: UploadReceipt['phase'], now: number,
): Promise<string> {
  const receipt: UploadReceipt = {
    version: 1, repository: FEEDBACK_REPOSITORY, submissionId, digest, attachment, phase,
    expiresAt: now + RECEIPT_LIFETIME_MS,
  };
  const payload = base64url(encoder.encode(JSON.stringify(receipt)));
  return `${payload}.${await signValue(secret, payload)}`;
}

export async function verifyUploadReceipt(
  secret: string, encoded: string, submissionId: string, digest: string, now: number,
): Promise<UploadReceipt> {
  try {
    if (encoded.length > 2_048) throw new Error();
    const [payload, signature, excess] = encoded.split('.');
    if (!payload || !signature || excess !== undefined) throw new Error();
    if (!await crypto.subtle.verify('HMAC', await key(secret), new Uint8Array(decode(signature)), encoder.encode(payload))) throw new Error();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(payload))) as UploadReceipt;
    if (Object.keys(value).length !== 7 || value.version !== 1 || value.repository !== FEEDBACK_REPOSITORY
      || !isSubmissionId(value.submissionId) || !isDigest(value.digest)
      || value.submissionId !== submissionId || value.digest !== digest
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now
      || !['uploaded', 'unknown'].includes(value.phase)
      || value.attachment !== null && !isNativeAttachmentUrl(value.attachment)) throw new Error();
    return value;
  } catch { throw new Error('The retry receipt is invalid or expired.'); }
}

export async function submissionMarker(secret: string, submissionId: string, digest: string, attachment: string | null): Promise<string> {
  const value = `${FEEDBACK_REPOSITORY}:${submissionId}:${digest}:${attachment ?? 'text'}`;
  return `<!-- motionsmith-feedback:${submissionId}:${digest}:${attachment ? 'image' : 'text'}:${await signValue(secret, value)} -->`;
}
