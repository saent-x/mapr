import { sleep } from '../util/pool.js';

export const EMBED_DIM = 1024;

export interface Embedder {
  /** One unit-length vector per input text, in order. */
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export class EmbedError extends Error {
  override name = 'EmbedError';
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface EmbedClientOptions {
  url: string;
  batchSize?: number;
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  dim?: number;
  fetchImpl?: typeof fetch;
}

interface EmbedResponse {
  vectors: number[][];
  model?: string;
}

export function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n > 0 ? v.map((x) => x / n) : v;
}

/** Client for the local embedder: POST {url}/embed {"texts": [...]} -> {"vectors": [[...]], "model": "..."}. */
export class HttpEmbedder implements Embedder {
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly attempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly dim: number;
  private readonly fetchImpl: typeof fetch;
  model: string | undefined;

  constructor(o: EmbedClientOptions) {
    this.endpoint = o.url.replace(/\/+$/, '') + '/embed';
    this.batchSize = o.batchSize ?? 32;
    this.attempts = o.attempts ?? 4;
    this.timeoutMs = o.timeoutMs ?? 60_000;
    this.backoffMs = o.backoffMs ?? 1_000;
    this.dim = o.dim ?? EMBED_DIM;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(...(await this.embedBatch(texts.slice(i, i + this.batchSize), signal)));
    }
    return out;
  }

  private async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (signal?.aborted) throw new EmbedError('aborted', false);
      try {
        return await this.once(texts, signal);
      } catch (err) {
        lastErr = err;
        if (err instanceof EmbedError && !err.retryable) throw err;
        if (attempt < this.attempts) await sleep(this.backoffMs * 2 ** (attempt - 1), signal);
      }
    }
    throw lastErr instanceof Error ? lastErr : new EmbedError(String(lastErr), true);
  }

  private async once(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: sig,
      });
    } catch (err) {
      throw new EmbedError(`embedder unreachable: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new EmbedError(`embedder HTTP ${res.status}`, retryable);
    }
    let body: EmbedResponse;
    try {
      body = (await res.json()) as EmbedResponse;
    } catch {
      throw new EmbedError('embedder returned invalid JSON', true);
    }
    if (!Array.isArray(body.vectors) || body.vectors.length !== texts.length) {
      throw new EmbedError(`embedder returned ${body.vectors?.length ?? 'no'} vectors for ${texts.length} texts`, false);
    }
    for (const v of body.vectors) {
      if (!Array.isArray(v) || v.length !== this.dim || !v.every(Number.isFinite)) {
        throw new EmbedError(`embedder returned a vector that is not ${this.dim} finite floats`, false);
      }
    }
    this.model = body.model;
    return body.vectors.map(normalize);
  }
}

export function embedText(title: string, lead: string | null | undefined): string {
  const l = (lead ?? '').trim();
  return l ? `${title}. ${l}` : title;
}
