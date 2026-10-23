// A stand-in for the real embedder: bag-of-words hashed into 1024 dims and
// normalised, so texts that share most words get a high cosine similarity.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { hash32, tokenize } from '../../src/dedup/minhash.js';

export function fakeVector(text: string, dim = 1024): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const t of tokenize(text)) v[hash32(t) % dim]! += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export async function startFakeEmbedder(): Promise<{ url: string; calls: string[][]; close(): Promise<void> }> {
  const calls: string[][] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/embed') {
        res.writeHead(404).end();
        return;
      }
      const { texts } = JSON.parse(body) as { texts: string[] };
      calls.push(texts);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake-bow-1024', vectors: texts.map((t) => fakeVector(t)) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}
