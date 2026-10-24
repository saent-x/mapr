import { describe, expect, it } from 'vitest';
import type { Embedder } from '../src/embed/client.js';
import { CloudflareEmbedder, estimateTokens, NEURONS_PER_M_TOKENS, RoutedEmbedder } from '../src/embed/cloudflare.js';

function fakeFetch(responses: Array<(texts: string[]) => Response>) {
  const calls: Array<{ url: string; auth: string | null; texts: string[] }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const texts = (JSON.parse(String(init?.body)) as { text: string[] }).text;
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), texts });
    return responses[Math.min(calls.length - 1, responses.length - 1)]!(texts);
  }) as typeof fetch;
  return { impl, calls };
}
const ok = (dim = 4) => (texts: string[]) =>
  Response.json({ success: true, result: { shape: [texts.length, dim], data: texts.map(() => Array.from({ length: dim }, () => 2)) } });
const opts = { accountId: 'acct', apiToken: 'tok', model: '@cf/qwen/qwen3-embedding-0.6b', dim: 4, backoffMs: 1 };

describe('CloudflareEmbedder', () => {
  it('calls the account run endpoint in batches, normalises and reports neurons', async () => {
    const f = fakeFetch([ok()]);
    const spent: number[] = [];
    const e = new CloudflareEmbedder({ ...opts, batchSize: 2, fetchImpl: f.impl, onNeurons: async (n) => void spent.push(n) });
    const v = await e.embed(['aaa', 'bbb', 'ccc']);
    expect(f.calls.map((c) => c.texts)).toEqual([['aaa', 'bbb'], ['ccc']]);
    expect(f.calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/qwen/qwen3-embedding-0.6b');
    expect(f.calls[0]!.auth).toBe('Bearer tok');
    expect(v[0]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(spent).toEqual([(2 / 1e6) * NEURONS_PER_M_TOKENS, (1 / 1e6) * NEURONS_PER_M_TOKENS]);
  });
  it('retries 429 and 5xx but not an error body or a wrong dimension', async () => {
    const f = fakeFetch([() => new Response('slow down', { status: 429 }), ok()]);
    expect(await new CloudflareEmbedder({ ...opts, fetchImpl: f.impl }).embed(['x'])).toHaveLength(1);
    expect(f.calls).toHaveLength(2);

    const err = fakeFetch([() => Response.json({ success: false, errors: [{ message: 'bad input' }] })]);
    await expect(new CloudflareEmbedder({ ...opts, fetchImpl: err.impl }).embed(['x'])).rejects.toThrow('bad input');
    expect(err.calls).toHaveLength(1);

    const dim = fakeFetch([ok(3)]);
    await expect(new CloudflareEmbedder({ ...opts, fetchImpl: dim.impl }).embed(['x'])).rejects.toThrow('not 4 finite floats');
  });
  it('estimates tokens on the high side', () => {
    expect(estimateTokens(['abcdef', 'g'])).toBe(3);
  });
});

describe('RoutedEmbedder', () => {
  const tag = (name: string, fail = false): Embedder & { used: number } => ({
    used: 0,
    async embed(texts) {
      this.used++;
      if (fail) throw new Error(`${name} down`);
      return texts.map(() => [name === 'cf' ? 1 : 0]);
    },
  });

  it('uses Workers AI while the budget is open', async () => {
    const cf = tag('cf');
    const local = tag('local');
    const r = new RoutedEmbedder({ cloudflare: cf, local, budgetOpen: async () => true });
    expect(await r.embed(['a'])).toEqual([[1]]);
    expect([cf.used, local.used]).toEqual([1, 0]);
  });
  it('uses the local model when the budget is closed or Workers AI fails', async () => {
    const reasons: string[] = [];
    const local = tag('local');
    const closed = new RoutedEmbedder({ cloudflare: tag('cf'), local, budgetOpen: async () => false, onFallback: (r) => void reasons.push(r) });
    expect(await closed.embed(['a'])).toEqual([[0]]);
    const failing = new RoutedEmbedder({ cloudflare: tag('cf', true), local, budgetOpen: async () => true, onFallback: (r) => void reasons.push(r) });
    expect(await failing.embed(['a'])).toEqual([[0]]);
    expect(reasons).toEqual(['budget closed', 'Workers AI failed']);
  });
});
