// Workers AI embeddings over the REST API, and a router that uses them while the
// daily neuron budget is open and the same model on the local embedder when it
// is not. Both sides must run the same model, so vectors stay comparable.

import { sleep } from '../util/pool.js';
import { EMBED_DIM, EmbedError, normalize, type Embedder } from './client.js';

/** Workers AI price for the hosted embedding models (bge-m3, qwen3-embedding-0.6b). */
export const NEURONS_PER_M_TOKENS = 1075;

/** No tokenizer here; ~3 characters per token over-counts slightly, which errs on the safe side. */
export function estimateTokens(texts: string[]): number {
  let chars = 0;
  for (const t of texts) chars += t.length;
  return Math.ceil(chars / 3);
}

export interface CloudflareEmbedderOptions {
  accountId: string;
  apiToken: string;
  model: string;
  batchSize?: number;
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  dim?: number;
  fetchImpl?: typeof fetch;
  /** Called after each successful request with the neurons it is estimated to have used. */
  onNeurons?: (neurons: number) => Promise<void>;
}

interface RunResponse {
  success?: boolean;
  result?: { data?: number[][]; shape?: number[] };
  errors?: Array<{ message?: string }>;
}

export class CloudflareEmbedder implements Embedder {
  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly attempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly dim: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: CloudflareEmbedderOptions) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(o.accountId)}/ai/run/${o.model}`;
    this.batchSize = o.batchSize ?? 100;
    this.attempts = o.attempts ?? 3;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.backoffMs = o.backoffMs ?? 1_000;
    this.dim = o.dim ?? EMBED_DIM;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      out.push(...(await this.withRetry(batch, signal)));
      await this.o.onNeurons?.((estimateTokens(batch) / 1e6) * NEURONS_PER_M_TOKENS);
    }
    return out;
  }

  private async withRetry(texts: string[], signal?: AbortSignal): Promise<number[][]> {
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
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiToken}` },
        body: JSON.stringify({ text: texts }),
        signal: sig,
      });
    } catch (err) {
      throw new EmbedError(`Workers AI unreachable: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw new EmbedError(`Workers AI HTTP ${res.status}`, retryable);
    }
    let body: RunResponse;
    try {
      body = (await res.json()) as RunResponse;
    } catch {
      throw new EmbedError('Workers AI returned invalid JSON', true);
    }
    const data = body.result?.data;
    if (!body.success || !Array.isArray(data) || data.length !== texts.length) {
      const msg = body.errors?.map((e) => e.message).join('; ') || `${data?.length ?? 'no'} vectors for ${texts.length} texts`;
      throw new EmbedError(`Workers AI: ${msg}`, false);
    }
    for (const v of data) {
      if (!Array.isArray(v) || v.length !== this.dim || !v.every(Number.isFinite)) {
        throw new EmbedError(`Workers AI returned a vector that is not ${this.dim} finite floats`, false);
      }
    }
    return data.map(normalize);
  }
}

export interface RoutedEmbedderOptions {
  cloudflare: Embedder;
  local: Embedder;
  /** True while the account's daily neuron budget is open. */
  budgetOpen: () => Promise<boolean>;
  onFallback?: (reason: string, err?: unknown) => void;
}

/** Workers AI while the budget is open; the local embedder (same model) when it is closed or Cloudflare fails. */
export class RoutedEmbedder implements Embedder {
  constructor(private readonly o: RoutedEmbedderOptions) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!(await this.o.budgetOpen())) {
      this.o.onFallback?.('budget closed');
      return this.o.local.embed(texts, signal);
    }
    try {
      return await this.o.cloudflare.embed(texts, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      this.o.onFallback?.('Workers AI failed', err);
      return this.o.local.embed(texts, signal);
    }
  }
}

/** Workers AI model ids for the local models they host. Vectors only mix within one row of this map. */
export const CLOUDFLARE_MODEL_FOR: Record<string, string> = {
  'Qwen/Qwen3-Embedding-0.6B': '@cf/qwen/qwen3-embedding-0.6b',
  'BAAI/bge-m3': '@cf/baai/bge-m3',
};
