// Query-time embeddings via Ollama (same bge-m3 model the Rust ingestor uses).
// One model service for both ingest + query embeddings + generation.

const EMBED_TIMEOUT_MS = 15_000;
const DIM = 1024;

function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

/** Embed a query string to a 1024-dim L2-normalized bge-m3 vector via Ollama. */
export async function ollamaEmbed(text: string): Promise<number[]> {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL not configured");
  const model = process.env.EMBED_MODEL ?? "bge-m3";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ollama embed ${res.status}`);
    const data = (await res.json()) as { embeddings?: number[][] };
    const vec = data.embeddings?.[0];
    if (!vec || vec.length !== DIM) throw new Error(`ollama embed: expected ${DIM}-dim, got ${vec?.length ?? 0}`);
    return l2normalize(vec);
  } finally {
    clearTimeout(timer);
  }
}
