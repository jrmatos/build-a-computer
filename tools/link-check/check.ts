/**
 * CNT-02 link checker: the logic, with `fetch` and the clock injected so tests
 * run offline. `live.test.ts` wires it to the real network and the level list.
 *
 * Rules (docs/plan.md "Resource policy", E-RES-01, E-RES-02):
 * - YouTube links are checked through YouTube's oEmbed endpoint. A 401, 403 or
 *   404 there means the video is removed, private or not embeddable.
 * - Other links are fetched with GET, following redirects. A redirect to a
 *   different host counts as "redirected elsewhere".
 * - An HTML page whose <title> no longer matches the recorded `verifiedTitle`
 *   is a soft 404 (the page works but shows something else).
 * - Non-HTML files (PDFs) pass on a 2xx; there is no title to compare.
 * - Bot walls (Cloudflare challenges) and rate limits are "blocked": the result
 *   is unknown, so no issue is opened for them.
 * The checker reports. It never edits or swaps a link.
 */

export interface CheckableResource {
  url: string;
  title: string;
  verifiedTitle: string;
}

export interface LinkItem {
  levelId: string;
  resource: CheckableResource;
}

export type LinkStatus = 'ok' | 'fail' | 'blocked';

export type FailReason =
  | 'http-error'
  | 'network-error'
  | 'redirected-elsewhere'
  | 'title-changed'
  | 'no-title'
  | 'video-unavailable';

export interface LinkResult {
  url: string;
  status: LinkStatus;
  reason?: FailReason;
  detail: string;
  /** Title seen now (HTML <title> or oEmbed title). */
  seenTitle?: string;
  expectedTitle: string;
  finalUrl?: string;
  httpStatus?: number;
  /** Every level that links this URL. */
  levels: string[];
}

/** The subset of the WHATWG fetch Response the checker reads. */
export interface FetchResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init: { redirect: 'follow'; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponse>;

export interface CheckOptions {
  fetch: FetchFn;
  /** Waits between retries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Parallel requests (default 4). */
  concurrency?: number;
  /** Retries for 429 and 5xx (default 1). */
  retries?: number;
  userAgent?: string;
}

export const USER_AGENT =
  'Mozilla/5.0 (compatible; build-a-computer-link-check/1.0; +https://github.com/)';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

export function isYouTube(url: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function oembedUrl(url: string): string {
  return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  middot: '·',
  raquo: '»',
  laquo: '«',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The first <title> of an HTML document, decoded and trimmed, or undefined. */
export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const t = decodeEntities(m[1] ?? '').replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/** Case, whitespace, quote and dash differences never count as a change. */
export function normalizeTitle(t: string): string {
  return t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same page when the normalized titles are equal or one contains the other
 * (sites add or drop a " | Site name" suffix). Anything else is a soft 404.
 */
export function titlesMatch(expected: string, seen: string): boolean {
  const a = normalizeTitle(expected);
  const b = normalizeTitle(seen);
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
}

/** Registrable-ish host: drops a leading "www." so www/no-www is the same site. */
function siteOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

function isBotWall(res: FetchResponse): boolean {
  return (
    res.status === 429 ||
    ((res.status === 403 || res.status === 503) &&
      (res.headers.get('cf-mitigated') === 'challenge' || /cloudflare/i.test(res.headers.get('server') ?? '')))
  );
}

async function fetchWithRetry(url: string, opts: CheckOptions): Promise<FetchResponse> {
  const retries = opts.retries ?? 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let res: FetchResponse | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    res = await opts.fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': opts.userAgent ?? USER_AGENT, accept: 'text/html,application/json,*/*', 'accept-language': 'en' },
    });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt < retries) await sleep(2000 * (attempt + 1));
  }
  return res!;
}

type Base = Pick<LinkResult, 'url' | 'expectedTitle' | 'levels'>;

async function checkYouTube(base: Base, opts: CheckOptions): Promise<LinkResult> {
  const res = await fetchWithRetry(oembedUrl(base.url), opts);
  if (res.status === 429) return { ...base, status: 'blocked', httpStatus: 429, detail: 'oEmbed rate limited' };
  if (!res.ok) {
    return {
      ...base,
      status: 'fail',
      reason: 'video-unavailable',
      httpStatus: res.status,
      detail: `oEmbed returned ${res.status}: video removed, private or not embeddable (E-RES-02)`,
    };
  }
  let title: string | undefined;
  try {
    const data = JSON.parse(await res.text()) as { title?: unknown };
    title = typeof data.title === 'string' ? data.title : undefined;
  } catch {
    title = undefined;
  }
  if (!title) return { ...base, status: 'fail', reason: 'no-title', httpStatus: res.status, detail: 'oEmbed response has no title' };
  if (!titlesMatch(base.expectedTitle, title)) {
    return { ...base, status: 'fail', reason: 'title-changed', seenTitle: title, httpStatus: res.status, detail: 'Video title changed' };
  }
  return { ...base, status: 'ok', seenTitle: title, httpStatus: res.status, detail: 'oEmbed title matches' };
}

async function checkPage(base: Base, opts: CheckOptions): Promise<LinkResult> {
  const res = await fetchWithRetry(base.url, opts);
  const finalUrl = res.url || base.url;
  if (isBotWall(res)) {
    return { ...base, status: 'blocked', httpStatus: res.status, finalUrl, detail: `Blocked by a bot wall or rate limit (${res.status})` };
  }
  if (!res.ok) {
    return { ...base, status: 'fail', reason: 'http-error', httpStatus: res.status, finalUrl, detail: `HTTP ${res.status}` };
  }
  if (siteOf(finalUrl) !== siteOf(base.url)) {
    return {
      ...base,
      status: 'fail',
      reason: 'redirected-elsewhere',
      httpStatus: res.status,
      finalUrl,
      detail: `Redirected to another site: ${finalUrl}`,
    };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/html/i.test(type)) {
    return { ...base, status: 'ok', httpStatus: res.status, finalUrl, detail: `${type || 'unknown type'}: no title to compare` };
  }
  const title = extractTitle(await res.text());
  if (!title) return { ...base, status: 'fail', reason: 'no-title', httpStatus: res.status, finalUrl, detail: 'Page has no <title>' };
  if (!titlesMatch(base.expectedTitle, title)) {
    return {
      ...base,
      status: 'fail',
      reason: 'title-changed',
      seenTitle: title,
      httpStatus: res.status,
      finalUrl,
      detail: 'Title changed: possible soft 404 (E-RES-01)',
    };
  }
  return { ...base, status: 'ok', seenTitle: title, httpStatus: res.status, finalUrl, detail: 'Title matches' };
}

export async function checkUrl(url: string, expectedTitle: string, levels: string[], opts: CheckOptions): Promise<LinkResult> {
  const base: Base = { url, expectedTitle, levels };
  try {
    return isYouTube(url) ? await checkYouTube(base, opts) : await checkPage(base, opts);
  } catch (e) {
    return { ...base, status: 'fail', reason: 'network-error', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Checks every distinct URL once, listing all the levels that use it. */
export async function checkAll(items: LinkItem[], opts: CheckOptions): Promise<LinkResult[]> {
  const byUrl = new Map<string, { title: string; levels: string[] }>();
  for (const { levelId, resource } of items) {
    const e = byUrl.get(resource.url);
    if (e) {
      if (!e.levels.includes(levelId)) e.levels.push(levelId);
    } else byUrl.set(resource.url, { title: resource.verifiedTitle, levels: [levelId] });
  }
  const jobs = [...byUrl.entries()];
  const results: LinkResult[] = new Array<LinkResult>(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const [url, { title, levels }] = jobs[i]!;
      results[i] = await checkUrl(url, title, levels, opts);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return results;
}

export interface Issue {
  title: string;
  body: string;
}

/** One issue per failing URL; the title is stable so the job can skip duplicates. */
export function issuesFor(results: LinkResult[], checkedAt: string): Issue[] {
  return results
    .filter((r) => r.status === 'fail')
    .map((r) => ({
      title: `Broken resource link: ${r.url}`,
      body: [
        `The weekly link check (CNT-02) found a problem with a level resource.`,
        '',
        `- URL: ${r.url}`,
        `- Levels: ${r.levels.join(', ')}`,
        `- Reason: ${r.reason ?? 'unknown'} — ${r.detail}`,
        `- Recorded title: ${r.expectedTitle}`,
        `- Title seen now: ${r.seenTitle ?? '(none)'}`,
        ...(r.finalUrl && r.finalUrl !== r.url ? [`- Final URL: ${r.finalUrl}`] : []),
        ...(r.httpStatus ? [`- HTTP status: ${r.httpStatus}`] : []),
        `- Checked at: ${checkedAt}`,
        '',
        'The checker never swaps links. Fetch a replacement, record its `verifiedTitle` and `verifiedAt`, and open a PR (or remove the link; the level shows its remaining resources).',
      ].join('\n'),
    }));
}

export function formatReport(results: LinkResult[], checkedAt: string): string {
  const count = (s: LinkStatus) => results.filter((r) => r.status === s).length;
  const lines = [
    `# Resource link check`,
    '',
    `Checked ${results.length} distinct URLs at ${checkedAt}: ${count('ok')} ok, ${count('fail')} failing, ${count('blocked')} blocked (unknown).`,
    '',
  ];
  for (const status of ['fail', 'blocked'] as const) {
    const rows = results.filter((r) => r.status === status);
    if (!rows.length) continue;
    lines.push(`## ${status === 'fail' ? 'Failing' : 'Blocked (not checked)'}`, '', '| URL | Levels | Detail |', '| --- | --- | --- |');
    for (const r of rows) lines.push(`| ${r.url} | ${r.levels.join(', ')} | ${r.detail.replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  return lines.join('\n');
}
