import { describe, expect, it } from 'vitest';
import {
  checkAll,
  checkUrl,
  extractTitle,
  formatReport,
  isYouTube,
  issuesFor,
  oembedUrl,
  titlesMatch,
  type FetchFn,
  type FetchResponse,
} from './check';

interface Fake {
  status?: number;
  url?: string;
  type?: string;
  body?: string;
  headers?: Record<string, string>;
}

function response(f: Fake, requested: string): FetchResponse {
  const status = f.status ?? 200;
  const headers: Record<string, string> = { 'content-type': f.type ?? 'text/html; charset=utf-8', ...f.headers };
  return {
    status,
    ok: status >= 200 && status < 300,
    url: f.url ?? requested,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => f.body ?? '',
  };
}

/** A fetch that answers from a table, and records every URL it was asked for. */
function fakeFetch(table: Record<string, Fake | Fake[] | Error>) {
  const calls: string[] = [];
  const seen = new Map<string, number>();
  const fetch: FetchFn = async (url) => {
    calls.push(url);
    const entry = table[url];
    if (entry === undefined) throw new Error(`unexpected fetch ${url}`);
    if (entry instanceof Error) throw entry;
    if (Array.isArray(entry)) {
      const n = seen.get(url) ?? 0;
      seen.set(url, n + 1);
      return response(entry[Math.min(n, entry.length - 1)]!, url);
    }
    return response(entry, url);
  };
  return { fetch, calls };
}

const noSleep = async () => {};
const page = (title: string) => `<html><head><title>${title}</title></head><body>x</body></html>`;

describe('title helpers', () => {
  it('extracts and decodes the first <title>', () => {
    expect(extractTitle('<html><head><TITLE lang="en">\n  Two&#39;s complement &amp; more\n</TITLE>')).toBe("Two's complement & more");
    expect(extractTitle('<html><body>none</body></html>')).toBeUndefined();
    expect(extractTitle('<title>   </title>')).toBeUndefined();
  });

  it('matches across case, whitespace, quotes and an added site suffix', () => {
    expect(titlesMatch("Two's complement - Wikipedia", 'Two’s  Complement – Wikipedia')).toBe(true);
    expect(titlesMatch('Lab: Traps', 'Lab: Traps | 6.1810')).toBe(true);
    expect(titlesMatch('Home | nand2tetris', 'Page not found')).toBe(false);
  });

  it('recognizes YouTube links and builds the oEmbed URL', () => {
    expect(isYouTube('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTube('https://youtu.be/abc')).toBe(true);
    expect(isYouTube('https://example.com/youtube.com')).toBe(false);
    expect(oembedUrl('https://www.youtube.com/watch?v=abc')).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc&format=json',
    );
  });
});

describe('E-RES-01 dead, redirected and soft-404 links', () => {
  it('passes a page whose title still matches', async () => {
    const { fetch } = fakeFetch({ 'https://a.org/x': { body: page('Lab: Traps') } });
    const r = await checkUrl('https://a.org/x', 'Lab: Traps', ['trap-handler'], { fetch, sleep: noSleep });
    expect(r.status).toBe('ok');
    expect(r.seenTitle).toBe('Lab: Traps');
  });

  it('fails a dead link (404)', async () => {
    const { fetch } = fakeFetch({ 'https://a.org/x': { status: 404, body: page('Not Found') } });
    const r = await checkUrl('https://a.org/x', 'Lab: Traps', ['l'], { fetch, sleep: noSleep });
    expect(r).toMatchObject({ status: 'fail', reason: 'http-error', httpStatus: 404 });
  });

  it('fails a soft 404: 200 OK but a different title', async () => {
    const { fetch } = fakeFetch({ 'https://a.org/x': { body: page('Page not found | a.org') } });
    const r = await checkUrl('https://a.org/x', 'Lab: Traps', ['l'], { fetch, sleep: noSleep });
    expect(r).toMatchObject({ status: 'fail', reason: 'title-changed', seenTitle: 'Page not found | a.org' });
  });

  it('fails a redirect to another site but allows same-site redirects', async () => {
    const { fetch } = fakeFetch({
      'https://a.org/old': { url: 'https://parked.example/landing', body: page('Lab: Traps') },
      'https://www.a.org/moved': { url: 'https://a.org/new/moved', body: page('Lab: Traps') },
    });
    const away = await checkUrl('https://a.org/old', 'Lab: Traps', ['l'], { fetch, sleep: noSleep });
    expect(away).toMatchObject({ status: 'fail', reason: 'redirected-elsewhere', finalUrl: 'https://parked.example/landing' });
    const same = await checkUrl('https://www.a.org/moved', 'Lab: Traps', ['l'], { fetch, sleep: noSleep });
    expect(same.status).toBe('ok');
  });

  it('fails an HTML page with no title', async () => {
    const { fetch } = fakeFetch({ 'https://a.org/x': { body: '<html><body>hi</body></html>' } });
    expect((await checkUrl('https://a.org/x', 'T', ['l'], { fetch, sleep: noSleep })).reason).toBe('no-title');
  });

  it('passes a PDF on 200 without comparing titles', async () => {
    const { fetch } = fakeFetch({ 'https://a.org/book.pdf': { type: 'application/pdf', body: '%PDF-1.5' } });
    expect((await checkUrl('https://a.org/book.pdf', 'Book', ['l'], { fetch, sleep: noSleep })).status).toBe('ok');
  });

  it('reports network errors as failures', async () => {
    const { fetch } = fakeFetch({ 'https://a.org/x': new Error('getaddrinfo ENOTFOUND a.org') });
    expect(await checkUrl('https://a.org/x', 'T', ['l'], { fetch, sleep: noSleep })).toMatchObject({
      status: 'fail',
      reason: 'network-error',
    });
  });

  it('marks bot walls and rate limits as blocked, not failing', async () => {
    const { fetch } = fakeFetch({
      'https://wall.org/x': { status: 403, headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } },
      'https://busy.org/x': { status: 429 },
    });
    expect((await checkUrl('https://wall.org/x', 'T', ['l'], { fetch, sleep: noSleep })).status).toBe('blocked');
    expect((await checkUrl('https://busy.org/x', 'T', ['l'], { fetch, sleep: noSleep })).status).toBe('blocked');
  });

  it('retries once on 429 or 5xx', async () => {
    const { fetch, calls } = fakeFetch({ 'https://a.org/x': [{ status: 503 }, { body: page('T') }] });
    const r = await checkUrl('https://a.org/x', 'T', ['l'], { fetch, sleep: noSleep });
    expect(r.status).toBe('ok');
    expect(calls).toHaveLength(2);
  });
});

describe('E-RES-02 YouTube through oEmbed', () => {
  const video = 'https://www.youtube.com/watch?v=gI-qXk7XojA';

  it('passes when the oEmbed title matches and never fetches the watch page', async () => {
    const { fetch, calls } = fakeFetch({
      [oembedUrl(video)]: { type: 'application/json', body: JSON.stringify({ title: 'Boolean Logic & Logic Gates' }) },
    });
    const r = await checkUrl(video, 'Boolean Logic & Logic Gates', ['and-gate'], { fetch, sleep: noSleep });
    expect(r.status).toBe('ok');
    expect(calls).toEqual([oembedUrl(video)]);
  });

  it.each([401, 403, 404])('fails a removed, private or non-embeddable video (%i)', async (status) => {
    const { fetch } = fakeFetch({ [oembedUrl(video)]: { status, type: 'text/html', body: 'Unauthorized' } });
    expect(await checkUrl(video, 'T', ['l'], { fetch, sleep: noSleep })).toMatchObject({
      status: 'fail',
      reason: 'video-unavailable',
    });
  });

  it('fails when the video title changed', async () => {
    const { fetch } = fakeFetch({ [oembedUrl(video)]: { type: 'application/json', body: '{"title":"Something else"}' } });
    expect((await checkUrl(video, 'Boolean Logic', ['l'], { fetch, sleep: noSleep })).reason).toBe('title-changed');
  });
});

describe('checkAll and the report', () => {
  it('checks each URL once and lists every level that uses it', async () => {
    const { fetch, calls } = fakeFetch({
      'https://a.org/x': { body: page('X') },
      'https://a.org/gone': { status: 410 },
    });
    const res = { url: 'https://a.org/x', title: 'X', verifiedTitle: 'X' };
    const results = await checkAll(
      [
        { levelId: 'not-gate', resource: res },
        { levelId: 'and-gate', resource: res },
        { levelId: 'or-gate', resource: { url: 'https://a.org/gone', title: 'G', verifiedTitle: 'G' } },
      ],
      { fetch, sleep: noSleep, concurrency: 2 },
    );
    expect(calls.filter((c) => c === 'https://a.org/x')).toHaveLength(1);
    expect(results.find((r) => r.url === 'https://a.org/x')?.levels).toEqual(['not-gate', 'and-gate']);

    const at = '2026-10-05T00:00:00Z';
    const issues = issuesFor(results, at);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toBe('Broken resource link: https://a.org/gone');
    expect(issues[0]!.body).toContain('or-gate');
    expect(issues[0]!.body).toContain('never swaps links');
    const report = formatReport(results, at);
    expect(report).toContain('2 distinct URLs');
    expect(report).toContain('1 failing');
  });
});
