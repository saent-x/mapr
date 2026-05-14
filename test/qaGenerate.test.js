import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAnswer, __test__ } from '../server/qa/generate.js';

const {
  trimPriorMessages,
  trimRetrieved,
  shouldBypassCorpusRetrieval,
  buildInput,
  coerceOutput,
  enrichCitations,
  aiGenerateError,
  badModelOutputError,
  DEFAULT_QA_MAX_TOKENS,
  DEFAULT_QA_GENERATE_TIMEOUT_MS,
} = __test__;

test('trimPriorMessages caps at 4 and normalizes role', () => {
  const out = trimPriorMessages([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
    { role: 'assistant', content: 'd' },
    { role: 'user', content: 'e' },
    { role: 'assistant', content: 'f' },
    { role: 'user', content: 'g' },        // 7th — should drop the oldest
  ]);
  assert.equal(out.length, 4);
  assert.equal(out[0].content, 'd');       // oldest kept
  assert.equal(out[out.length - 1].content, 'g');

  const weird = trimPriorMessages([{ role: 'system', content: 'x' }]);
  assert.equal(weird[0].role, 'user');     // unknown role normalized to user
});

test('trimRetrieved enforces citation/excerpt caps + index numbering', () => {
  const out = trimRetrieved([
    {
      articleId: 'a',
      title: 'T',
      source: 'src',
      excerpt: 'x'.repeat(500),
      eventTitle: 'Event T',
      eventCountry: 'Yemen',
      eventCategory: 'Conflict',
      retrievalMode: 'hybrid',
    },
    { articleId: 'b', title: 'U', source: 'src', excerpt: 'y' },
    { articleId: 'c', title: 'V', source: 'src', excerpt: 'z' },
    { articleId: 'd', title: 'W', source: 'src', excerpt: 'q' },
    { articleId: 'e', title: 'X', source: 'src', excerpt: 'ignored' },
  ]);
  assert.equal(out.length, 4);
  assert.equal(out[0].index, 1);
  assert.equal(out[1].index, 2);
  assert.equal(out[0].excerpt.length, 220);
  assert.equal(out[0].eventTitle, 'Event T');
  assert.equal(out[0].eventCountry, 'Yemen');
  assert.equal(out[0].eventCategory, 'Conflict');
  assert.equal(out[0].retrievalMode, 'hybrid');
});

test('shouldBypassCorpusRetrieval classifies simple conversational turns without generating a reply', () => {
  assert.equal(shouldBypassCorpusRetrieval('Hello'), true);
  assert.equal(shouldBypassCorpusRetrieval('thanks'), true);
  assert.equal(shouldBypassCorpusRetrieval('What happened in the Red Sea?'), false);
  assert.equal(shouldBypassCorpusRetrieval('Hello, what happened in Sudan today?'), false);
});

test('buildInput explicitly forbids model-memory answers', () => {
  const input = buildInput({
    question: 'What happened?',
    retrieved: [{ articleId: 'a', title: 'T', source: 'src', excerpt: 'excerpt' }],
    priorMessages: [],
  });
  assert.match(input.instructions, /ONLY the provided Mapr corpus citations/);
  assert.match(input.instructions, /Do not use general world knowledge/);
  assert.equal(input.citations.length, 1);
});

test('buildInput sends no-context turns to the model without a canned answer', () => {
  const input = buildInput({
    question: 'Hello',
    retrieved: [],
    priorMessages: [],
  });
  assert.equal(input.citations.length, 0);
  assert.match(input.instructions, /No Mapr corpus citations were retrieved/);
  assert.match(input.instructions, /For non-factual conversational messages, respond naturally/);
});

test('coerceOutput defaults on bad input', () => {
  assert.deepEqual(coerceOutput(null), { answer: '', citations: [] });
  assert.deepEqual(coerceOutput({}), { answer: '', citations: [] });
  const out = coerceOutput({
    answer: 'hello',
    citations: [{ articleId: 'a', index: 1, quote: 'q' }, { weird: true }],
  });
  assert.equal(out.answer, 'hello');
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].articleId, 'a');
});

test('coerceOutput normalizes citation indexes to sequential one-based values', () => {
  const out = coerceOutput({
    answer: 'hello',
    citations: [
      { articleId: 'a1', index: 0 },
      { articleId: 'a2', index: 1 },
    ],
  });
  assert.deepEqual(out.citations.map((c) => c.index), [1, 2]);
});

test('enrichCitations drops unknown articleIds, attaches eventId', () => {
  const retrieved = [
    { articleId: 'a1', eventId: 'e1', title: 'T1', source: 's1', url: 'http://x/1' },
    { articleId: 'a2', eventId: null, title: 'T2', source: 's2', url: 'http://x/2' },
  ];
  const cites = [
    { index: 1, articleId: 'a1', quote: 'q' },
    { index: 2, articleId: 'a2' },
    { index: 3, articleId: 'ghost' },         // not in retrieved
  ];
  const out = enrichCitations(cites, retrieved);
  assert.equal(out.length, 2);
  assert.equal(out[0].eventId, 'e1');
  assert.equal(out[1].eventId, null);
  assert.equal(out[0].quote, 'q');
});

test('enrichCitations renders sequential one-based indexes even when model returns zero-based values', () => {
  const retrieved = [
    { articleId: 'a1', eventId: 'e1', title: 'T1', source: 's1', url: 'http://x/1' },
    { articleId: 'a2', eventId: null, title: 'T2', source: 's2', url: 'http://x/2' },
  ];
  const out = enrichCitations([
    { index: 0, articleId: 'a1' },
    { index: 1, articleId: 'a2' },
  ], retrieved);

  assert.deepEqual(out.map((c) => c.index), [1, 2]);
});

test('generateAnswer calls the model even when no corpus rows were retrieved', async () => {
  let request;
  const out = await generateAnswer({
    question: 'Hello',
    retrieved: [],
    priorMessages: [],
  }, {
    generate: async (req) => {
      request = req;
      return {
        output: { answer: 'Model-generated greeting', citations: [] },
        model: 'fake-model',
        tokens_in: 12,
        tokens_out: 4,
      };
    },
  });

  assert.equal(request.task, 'qa');
  assert.equal(request.input.citations.length, 0);
  assert.equal(out.answer, 'Model-generated greeting');
  assert.deepEqual(out.citations, []);
  assert.equal(out.modelUsed, 'fake-model');
  assert.equal(out.tokensIn, 12);
  assert.equal(out.tokensOut, 4);
});

test('generateAnswer default timeout exceeds the sidecar 40s timeout', async () => {
  let request;
  await generateAnswer({
    question: 'Hello',
    retrieved: [],
    priorMessages: [],
  }, {
    generate: async (req) => {
      request = req;
      return {
        output: { answer: 'Model-generated greeting', citations: [] },
        model: 'fake-model',
      };
    },
  });

  assert.equal(DEFAULT_QA_GENERATE_TIMEOUT_MS, 45_000);
  assert.equal(request.timeoutMs, DEFAULT_QA_GENERATE_TIMEOUT_MS);
  assert.equal(DEFAULT_QA_MAX_TOKENS, 384);
  assert.equal(request.maxTokens, DEFAULT_QA_MAX_TOKENS);
});

test('generateAnswer returns model text with enriched citations', async () => {
  const out = await generateAnswer({
    question: 'What happened?',
    retrieved: [
      { articleId: 'a1', eventId: 'e1', title: 'T1', source: 's1', url: 'http://x/1' },
    ],
    priorMessages: [],
  }, {
    generate: async () => ({
      output: { answer: 'A cited answer [1]', citations: [{ index: 1, articleId: 'a1' }] },
      model: 'fake-model',
    }),
  });

  assert.equal(out.answer, 'A cited answer [1]');
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].eventId, 'e1');
});

test('generateAnswer propagates model failures instead of returning canned text', async () => {
  await assert.rejects(
    generateAnswer({
      question: 'Hello',
      retrieved: [],
      priorMessages: [],
    }, {
      generate: async () => {
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      },
    }),
    { code: 'AI_GENERATE_FAILED', statusCode: 502 },
  );
});

test('generateAnswer rejects uncited factual output when retrieval rows exist', async () => {
  await assert.rejects(
    generateAnswer({
      question: 'What happened?',
      retrieved: [
        { articleId: 'a1', eventId: 'e1', title: 'T1', source: 's1', url: 'http://x/1' },
      ],
      priorMessages: [],
    }, {
      generate: async () => ({
        output: { answer: 'No citations here', citations: [] },
        model: 'fake-model',
      }),
    }),
    { code: 'AI_BAD_QA_OUTPUT', statusCode: 502 },
  );
});

test('AI error helpers return structured errors, not assistant replies', () => {
  const timeout = aiGenerateError(new Error('timeout'));
  assert.equal(timeout.code, 'AI_GENERATE_FAILED');
  assert.equal(timeout.statusCode, 502);

  const bad = badModelOutputError('bad output');
  assert.equal(bad.code, 'AI_BAD_QA_OUTPUT');
  assert.equal(bad.statusCode, 502);
});
