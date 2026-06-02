/**
 * Pure QA helpers (no Convex deps) — unit-testable. Citation enforcement is the
 * load-bearing safety property: the model must cite retrieved evidence, and it
 * can never reference an article that wasn't retrieved.
 */

/** Greetings / thanks / short conversational turns skip corpus enforcement. */
export function shouldBypassCorpusRetrieval(question: string): boolean {
  const q = question.toLowerCase().trim();
  if (q.length === 0) return true;
  if (q.length > 40) return false;
  return /^(hi|hey|hello|yo|thanks|thank you|thx|ok|okay|cool|got it|nice|great|good (morning|afternoon|evening))\b/.test(q);
}

/** Distinct, in-range [n] citation markers present in the answer, ascending. */
export function referencedIndices(answer: string, max: number): number[] {
  const seen = new Set<number>();
  const re = /\[(\d{1,2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= max) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}
