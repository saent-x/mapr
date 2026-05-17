import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const mainPy = readFileSync(resolve(ROOT, 'home-pc/app/main.py'), 'utf8');

function functionBody(name) {
  const marker = `def ${name}(`;
  const start = mainPy.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = mainPy.indexOf('\ndef ', start + marker.length);
  const nextAsync = mainPy.indexOf('\nasync def ', start + marker.length);
  const ends = [next, nextAsync].filter((idx) => idx > start);
  const end = ends.length ? Math.min(...ends) : mainPy.length;
  return mainPy.slice(start, end);
}

test('AI gateway retrieval embeds the current question instead of previous assistant answers', () => {
  const body = functionBody('_retrieve_for_qa');

  assert.doesNotMatch(body, /last_assistant/);
  assert.doesNotMatch(body, /Previous answer:/);
  assert.match(body, /_build_retrieval_query\(question,\s*prior\)/);
  assert.match(body, /model\.encode\(\[retrieval_query\]/);
  assert.match(body, /_db_retrieve_sync\(retrieval_query,\s*vec,\s*filters/);
});

test('AI gateway retrieval removes negated stale locations from correction turns', () => {
  assert.match(mainPy, /def _negative_terms\(/);

  const searchBody = functionBody('_search_terms');
  assert.match(searchBody, /_negative_terms\(question\)/);
  assert.match(searchBody, /negated/);

  assert.match(mainPy, /"whats"/);
  assert.match(mainPy, /"happening"/);
  assert.match(mainPy, /"going"/);
});

test('AI gateway prompt treats conversation as context only and answers the latest question', () => {
  const body = functionBody('_generate_qa');

  assert.match(body, /CURRENT QUESTION/);
  assert.match(body, /CONVERSATION CONTEXT \(for pronoun resolution only\)/);
  assert.match(body, /Do not answer a previous question/);
  assert.match(body, /Never start an answer with .*The recent conversation indicates/);
});

test('AI gateway query helpers keep Nigeria questions separate from stale Maldives context', () => {
  const script = String.raw`
import importlib.util
import pathlib
import sys
import types

class BaseModel:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

def Field(default=None, **kwargs):
    if 'default_factory' in kwargs:
        return kwargs['default_factory']()
    return default

class FastAPI:
    def __init__(self, *args, **kwargs): pass
    def get(self, *args, **kwargs):
        return lambda fn: fn
    def post(self, *args, **kwargs):
        return lambda fn: fn
    def on_event(self, *args, **kwargs):
        return lambda fn: fn

class HTTPException(Exception):
    def __init__(self, status_code=500, detail=None):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))

fastapi = types.ModuleType('fastapi')
fastapi.Body = lambda *args, **kwargs: None
fastapi.Depends = lambda dep=None, *args, **kwargs: dep
fastapi.FastAPI = FastAPI
fastapi.HTTPException = HTTPException
fastapi.Request = object
sys.modules['fastapi'] = fastapi

pydantic = types.ModuleType('pydantic')
pydantic.BaseModel = BaseModel
pydantic.Field = Field
sys.modules['pydantic'] = pydantic

httpx = types.ModuleType('httpx')
httpx.TimeoutException = TimeoutError
httpx.HTTPError = Exception
class AsyncClient:
    def __init__(self, *args, **kwargs): pass
    async def aclose(self): pass
httpx.AsyncClient = AsyncClient
sys.modules['httpx'] = httpx

psycopg = types.ModuleType('psycopg')
psycopg.connect = lambda *args, **kwargs: None
sys.modules['psycopg'] = psycopg
rows = types.ModuleType('psycopg.rows')
rows.dict_row = object()
sys.modules['psycopg.rows'] = rows

path = pathlib.Path('home-pc/app/main.py').resolve()
spec = importlib.util.spec_from_file_location('mapr_ai_main', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

prior = [{'role': 'assistant', 'content': 'The recent conversation was about Adhadhu journalists in Maldives.'}]
query = mod._build_retrieval_query('whats happened in Nigeria today?', prior)
assert 'nigeria' in query.lower(), query
assert 'maldives' not in query.lower(), query

terms = mod._search_terms('I asked whats happening in Nigeria not maldives')
assert terms == ['nigeria'], terms

followup = mod._build_retrieval_query('what about there now?', [{'role': 'user', 'content': 'what is happening in Nigeria?'}])
assert 'Nigeria' in followup, followup
`;

  execFileSync('python3', ['-c', script], { cwd: ROOT, stdio: 'pipe' });
});
