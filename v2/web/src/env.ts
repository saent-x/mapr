import type { LiveHub } from './live';

export interface Env {
  SNAPSHOT: KVNamespace;
  LIVE: DurableObjectNamespace<LiveHub>;
  ASSETS: Fetcher;
  INGEST_URL: string;
  /** Secret: `wrangler secret put INGEST_TOKEN`. */
  INGEST_TOKEN: string;
}

type MaprEnv = Env;

declare global {
  namespace Cloudflare {
    interface Env extends MaprEnv {}
    interface GlobalProps {
      mainModule: typeof import('./index');
      durableNamespaces: 'LiveHub';
    }
  }
}
