/**
 * Share links (COM-01): `#share=<format><base64url>` where format 'z' is
 * deflate-raw JSON and 'j' is plain JSON (browsers without
 * CompressionStream). Links longer than SHARE_MAX_CHARS fall back to a file.
 *
 * Opening a link is untrusted input: the fragment length, the inflated size,
 * nesting depth and prototype keys are limited before the schema check
 * (E-DATA-03).
 */
import { parseUntrustedJson, SharedBoard, SHARE_KIND, type Board, type ChipMap } from '@build-a-computer/schema';
import { closure } from '@build-a-computer/sim-logic';
import { deflateRaw, fromBase64Url, inflate, InflateError, toBase64Url } from './deflate';

/** Longest fragment payload we create (~6 KB): fits chat apps and URL bars comfortably. */
export const SHARE_MAX_CHARS = 6 * 1024;
/** Longest fragment we try to open: anything longer was not made by us. */
export const SHARE_OPEN_MAX_CHARS = 64 * 1024;
/** Inflated JSON limit for a share link. */
export const SHARE_MAX_JSON = 2 * 1024 * 1024;
export const SHARE_PREFIX = '#share=';

export class ShareError extends Error {
  constructor(
    readonly code: 'too-long' | 'corrupt' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

/** The payload for a board: only the chips it uses travel with it. */
export function sharePayload(board: Board, chips: ChipMap, levelId?: string, title?: string): SharedBoard {
  return {
    kind: SHARE_KIND,
    version: 1,
    ...(levelId ? { levelId } : {}),
    ...(title ? { title } : {}),
    board,
    chips: closure(board, chips),
  };
}

/** Encode to the fragment value (without `#share=`). `compress: false` forces the plain format. */
export async function encodeShare(payload: SharedBoard, compress = true): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const z = compress ? await deflateRaw(bytes) : null;
  return z ? `z${toBase64Url(z)}` : `j${toBase64Url(bytes)}`;
}

export type ShareLink = { kind: 'link'; url: string; chars: number } | { kind: 'too-large'; chars: number };

/** A full link for `base` (current page URL), or 'too-large' past SHARE_MAX_CHARS. */
export async function makeShareLink(payload: SharedBoard, base: string, compress = true): Promise<ShareLink> {
  const value = await encodeShare(payload, compress);
  if (value.length > SHARE_MAX_CHARS) return { kind: 'too-large', chars: value.length };
  const url = new URL(base);
  url.search = '';
  url.hash = `share=${value}`;
  return { kind: 'link', url: url.href, chars: value.length };
}

/** The fragment value of a share link in `hash`, or null. */
export function shareFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}

/** Decode and validate a fragment value. Throws ShareError. */
export async function decodeShare(value: string, opts: { preferJs?: boolean } = {}): Promise<SharedBoard> {
  if (value.length > SHARE_OPEN_MAX_CHARS) throw new ShareError('too-long', 'This share link is too long.');
  const format = value[0];
  let bytes: Uint8Array;
  try {
    const raw = fromBase64Url(value.slice(1));
    if (format === 'z') bytes = await inflate(raw, SHARE_MAX_JSON, opts.preferJs);
    else if (format === 'j') bytes = raw;
    else throw new InflateError('Unknown format');
  } catch (e) {
    if (e instanceof InflateError && /size limit/.test(e.message)) throw new ShareError('too-long', 'This share link expands past the size limit.');
    throw new ShareError('corrupt', 'This share link is damaged or incomplete.');
  }
  let data: unknown;
  try {
    data = parseUntrustedJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maxBytes: SHARE_MAX_JSON, maxDepth: 64 });
  } catch (e) {
    throw new ShareError('corrupt', e instanceof Error ? e.message : 'This share link is damaged.');
  }
  const parsed = SharedBoard.safeParse(data);
  if (!parsed.success) throw new ShareError('invalid', 'This share link does not hold a valid board.');
  return parsed.data;
}
