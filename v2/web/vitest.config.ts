import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { INGEST_TOKEN: 'test-token', INGEST_URL: 'https://ingest.test' } },
    }),
  ],
});
