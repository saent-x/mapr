import { describe, expect, it } from 'vitest';
import { embedText, HttpEmbedder } from '../src/embed/client.js';

function fakeFetch(responses: Array<(texts: string[]) => Response | Promise<Response>>) {
  const calls: string[][] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const texts = (JSON.parse(String(init?.body)) as { texts: string[] }).texts;
    calls.push(texts);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return r(texts);
  }) as typeof fetch;
  return { impl, calls };
}
const ok = (dim = 4) => (texts: string[]) =>
  Response.json({ model: 'fake', vectors: texts.map((_, i) => Array.from({ length: dim }, (_, j) => (j === i % dim ? 2 : 0))) });

describe('HttpEmbedder', () => {
  it('batches, preserves order and normalises', async () => {
    const f = fakeFetch([ok()]);
    const e = new HttpEmbedder({ url: 'http://emb/', batchSize: 2, dim: 4, fetchImpl: f.impl, backoffMs: 1 });
    const v = await e.embed(['a', 'b', 'c']);
    expect(f.calls).toEqual([['a', 'b'], ['c']]);
    expect(v).toHaveLength(3);
    expect(v[0]).toEqual([1, 0, 0, 0]);
    expect(e.model).toBe('fake');
  });
  it('retries 5xx and network errors, then succeeds', async () => {
    const f = fakeFetch([
      () => new Response('busy', { status: 503 }),
      () => {
        throw new TypeError('ECONNREFUSED');
      },
      ok(),
    ]);
    const e = new HttpEmbedder({ url: 'http://emb', dim: 4, fetchImpl: f.impl, backoffMs: 1 });
    expect(await e.embed(['x'])).toHaveLength(1);
    expect(f.calls).toHaveLength(3);
  });
  it('does not retry a 400 or a wrong-shaped answer', async () => {
    const bad = fakeFetch([() => new Response('no', { status: 400 })]);
    await expect(new HttpEmbedder({ url: 'http://emb', dim: 4, fetchImpl: bad.impl, backoffMs: 1 }).embed(['x'])).rejects.toThrow(/400/);
    expect(bad.calls).toHaveLength(1);
    const dims = fakeFetch([ok(3)]);
    await expect(new HttpEmbedder({ url: 'http://emb', dim: 4, fetchImpl: dims.impl, backoffMs: 1 }).embed(['x'])).rejects.toThrow(/finite floats/);
  });
  it('gives up after the configured attempts', async () => {
    const f = fakeFetch([() => new Response('x', { status: 500 })]);
    await expect(new HttpEmbedder({ url: 'http://emb', dim: 4, fetchImpl: f.impl, backoffMs: 1, attempts: 3 }).embed(['x'])).rejects.toThrow(/500/);
    expect(f.calls).toHaveLength(3);
  });
  it('builds the text as title + ". " + lead', () => {
    expect(embedText('Quake hits', 'Power cut')).toBe('Quake hits. Power cut');
    expect(embedText('Quake hits', null)).toBe('Quake hits');
  });
});
