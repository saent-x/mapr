import zlib from 'node:zlib';
import { Agent, request, type Dispatcher } from 'undici';
import { assertPublicUrl, guardedLookup, type Resolver, systemResolver } from './ssrf.js';

export class FetchError extends Error {
  override name = 'FetchError';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
  accept?: string;
  signal?: AbortSignal;
  dispatcher?: Dispatcher;
  resolver?: Resolver;
}

export interface FetchResult {
  status: number;
  notModified: boolean;
  finalUrl: string;
  body?: Buffer;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

/** One shared agent whose sockets only ever connect to addresses guardedLookup approved. */
export function createGuardedAgent(timeoutMs: number): Agent {
  return new Agent({
    connect: { lookup: guardedLookup as never, timeout: Math.min(timeoutMs, 10_000) },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: 4_000,
    connections: 4,
  });
}

let defaultAgent: Agent | undefined;

function header(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

async function readCapped(body: Dispatcher.ResponseData['body'], maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      body.destroy();
      throw new FetchError(`body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks, total);
}

export function decompress(buf: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const enc = (encoding ?? '').trim().toLowerCase();
  const opts = { maxOutputLength: maxBytes };
  try {
    if (enc === '' || enc === 'identity') return buf;
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf, opts);
    if (enc === 'br') return zlib.brotliDecompressSync(buf, opts);
    if (enc === 'deflate') {
      try {
        return zlib.inflateSync(buf, opts);
      } catch {
        return zlib.inflateRawSync(buf, opts);
      }
    }
  } catch (err) {
    if (err instanceof RangeError) throw new FetchError(`decompressed body exceeds ${maxBytes} bytes`);
    throw new FetchError(`bad ${enc} body: ${(err as Error).message}`);
  }
  throw new FetchError(`unsupported content-encoding: ${enc}`);
}

/**
 * GET with conditional headers, manual redirects (each hop re-checked by the
 * SSRF guard), an overall timeout and a byte cap applied before and after
 * decompression.
 */
export async function fetchFeed(url: string, o: FetchOptions): Promise<FetchResult> {
  const dispatcher = o.dispatcher ?? (defaultAgent ??= createGuardedAgent(o.timeoutMs));
  const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs)]) : AbortSignal.timeout(o.timeoutMs);
  const headers: Record<string, string> = {
    'user-agent': o.userAgent,
    accept: o.accept ?? 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (o.etag) headers['if-none-match'] = o.etag;
  if (o.lastModified) headers['if-modified-since'] = o.lastModified;

  let current = url;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current, o.resolver ?? systemResolver);
    let res: Dispatcher.ResponseData;
    try {
      res = await request(current, { method: 'GET', headers, dispatcher, signal });
    } catch (err) {
      if (signal.aborted) throw new FetchError(`timeout after ${o.timeoutMs} ms`);
      const e = err as Error & { cause?: Error };
      throw new FetchError(e.cause?.message ?? e.message);
    }
    const h = res.headers;
    if (res.statusCode >= 300 && res.statusCode < 400 && res.statusCode !== 304) {
      await res.body.dump().catch(() => {});
      const loc = header(h, 'location');
      if (!loc) throw new FetchError(`redirect ${res.statusCode} without location`, res.statusCode);
      if (hop >= o.maxRedirects) throw new FetchError(`more than ${o.maxRedirects} redirects`, res.statusCode);
      current = new URL(loc, current).href;
      continue;
    }
    const base = {
      status: res.statusCode,
      finalUrl: current,
      ...(header(h, 'etag') ? { etag: header(h, 'etag')! } : {}),
      ...(header(h, 'last-modified') ? { lastModified: header(h, 'last-modified')! } : {}),
    };
    if (res.statusCode === 304) {
      await res.body.dump().catch(() => {});
      return { ...base, notModified: true };
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump().catch(() => {});
      throw new FetchError(`HTTP ${res.statusCode}`, res.statusCode);
    }
    let raw: Buffer;
    try {
      raw = await readCapped(res.body, o.maxBytes);
    } catch (err) {
      if (signal.aborted) throw new FetchError(`timeout after ${o.timeoutMs} ms`);
      throw err instanceof FetchError ? err : new FetchError((err as Error).message);
    }
    const body = decompress(raw, header(h, 'content-encoding'), o.maxBytes);
    const ct = header(h, 'content-type');
    return { ...base, notModified: false, body, ...(ct ? { contentType: ct } : {}) };
  }
}

/** Decode a feed body: BOM, then HTTP charset, then the XML declaration, else UTF-8. */
export function decodeBody(buf: Buffer, contentType?: string): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const head = buf.subarray(0, 512).toString('latin1');
  const fromXml = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/i)?.[1];
  const fromHttp = contentType?.match(/charset\s*=\s*"?([A-Za-z0-9._:-]+)/i)?.[1];
  for (const label of [fromHttp, fromXml]) {
    if (!label) continue;
    try {
      return new TextDecoder(label.toLowerCase()).decode(buf);
    } catch {
      /* unknown label: try the next one */
    }
  }
  return buf.toString('utf8');
}
