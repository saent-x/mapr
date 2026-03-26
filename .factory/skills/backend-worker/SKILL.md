---
name: backend-worker
description: Implements backend features - data pipeline, server modules, API endpoints, database, ingestion
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

For features involving:
- Server-side code (server/, api/)
- Data ingestion pipeline (fetching, parsing, geocoding, deduplication)
- Database schema changes and storage layer
- API endpoints and response formats
- Entity extraction and NLP processing
- Source catalog management
- Backend utility functions (src/utils/ shared with frontend)

## Required Skills

None. Backend work uses standard tools (file editing, terminal commands).

## Work Procedure

### 1. Understand the Feature
- Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully
- Read `AGENTS.md` for mission boundaries and conventions
- Read `.factory/library/architecture.md` for codebase patterns
- Read `.factory/library/environment.md` for env vars and external dependencies
- Identify which files need to change and what existing patterns to follow

### 2. Write Tests First (TDD)
- Create or update test files in `test/` directory
- Write failing tests that cover the expected behavior (one test per behavior item)
- Test file naming: `test/{featureName}.test.js`
- Use Node.js built-in test runner (`import { describe, it } from 'node:test'`)
- Run tests to confirm they fail: `node --test test/{file}.test.js`

### 3. Implement
- Follow existing code patterns (ES modules, no TypeScript)
- Keep shared utilities in `src/utils/` (used by both frontend and backend)
- Keep server-only code in `server/`
- Keep Vercel API handlers in `api/`
- If modifying ingest.js or storage.js, be very careful about the data flow
- Preserve backward compatibility with existing API response shapes unless the feature explicitly changes them

### 4. Run Tests
- Run the specific test file: `node --test test/{file}.test.js`
- Run the full test suite: `node --test`
- ALL tests must pass (108 existing + new tests)

### 5. Manual Verification
- Start the backend server if not running: `node server/index.js &`
- Use curl to test API endpoints:
  - `curl -s http://localhost:3030/api/health | head -c 500`
  - `curl -s http://localhost:3030/api/briefing | head -c 500`
  - Test any new/modified endpoints
- Verify no console errors in server output
- Kill any background processes you started

### 6. Verify Full Suite
- Run `node --test` and confirm all tests pass
- Check for any regressions

## Example Handoff

```json
{
  "salientSummary": "Fixed duplicate key constraint in upsertArticles by switching from URL-based to ID-based conflict resolution. Added retry logic for FK violations in linkArticlesToEvent. Ran `node --test` (112 passing, 4 skipped). Verified via `curl /api/refresh` - ingestion completed with 347 articles.",
  "whatWasImplemented": "Modified server/storage.js upsertArticles to use ON CONFLICT (id) instead of catching URL uniqueness errors. Added defensive check in linkArticlesToEvent to skip missing article references. Added 4 new test cases in test/storage.test.js covering duplicate ID handling and FK edge cases.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "node --test test/storage.test.js", "exitCode": 0, "observation": "8 tests passing including 4 new ones for upsert edge cases" },
      { "command": "node --test", "exitCode": 0, "observation": "112 passing, 4 skipped (DB tests without DATABASE_URL)" },
      { "command": "curl -s http://localhost:3030/api/health | node -e \"process.stdin.on('data',d=>console.log(JSON.parse(d).status))\"", "exitCode": 0, "observation": "Output: healthy" }
    ],
    "interactiveChecks": [
      { "action": "curl POST /api/refresh to trigger full ingestion cycle", "observed": "Returned 200 with 347 articles, 42 events. No duplicate key errors in server logs." }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "test/storage.test.js",
        "cases": [
          { "name": "upsertArticles handles duplicate IDs gracefully", "verifies": "No crash on re-inserting same article ID" },
          { "name": "upsertArticles updates existing article on ID conflict", "verifies": "Article data is updated, not duplicated" },
          { "name": "linkArticlesToEvent skips missing article references", "verifies": "FK violation doesn't crash the pipeline" },
          { "name": "full ingest cycle completes without constraint errors", "verifies": "End-to-end pipeline with realistic data" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a frontend component or route that doesn't exist yet
- DATABASE_URL is not set and the feature requires live database access
- An existing test fails that is unrelated to the current feature
- The ingestion pipeline is in a broken state that blocks verification
- Requirements are ambiguous about API response shape or data model
