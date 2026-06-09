# Mapr — Global Source Coverage & Catalog Maintenance

_Last expanded: 2026-06-09 (live-validated workflow)._

## Coverage

The ingest catalog (`sourceCatalog`) is seeded from the curated `DEFAULT_SOURCES`
list in [`convex/functions/ingest.ts`](../convex/functions/ingest.ts). As of the
2026-06-09 global-coverage expansion it carries **~385 feeds across 122+ regions**,
with **2+ live-validated national feeds for essentially every country**:

- **Africa** — full continent incl. the long tail (Eritrea, Djibouti, Malawi,
  Lesotho, Eswatini, Comoros, Mauritius, Seychelles, Guinea-Bissau, Gambia, DRC…).
- **Middle East & North Africa** — Iran, Iraq, Syria, Lebanon, Jordan, Palestine,
  Yemen, the Gulf (UAE, Qatar, Kuwait, Bahrain, Oman), Morocco, Algeria, Tunisia,
  Sudan, South Sudan.
- **Europe** — Western (UK, Ireland, Spain, Portugal, Italy, Netherlands, Belgium,
  Switzerland, Austria), Nordic + Baltic, Central/Eastern (Czechia, Slovakia,
  Hungary, Romania, Bulgaria, Belarus, Moldova), and the Balkans + Greece.
- **Americas** — Canada, the US (national + regional), Mexico, all of Central
  America, the Caribbean (Cuba, Dominican Republic, Haiti, Trinidad, Bahamas,
  Barbados…), and all of South America (incl. Chile, Peru, Ecuador, Uruguay,
  Guyana, Suriname).
- **Asia-Pacific** — China (English outlets), Taiwan, Malaysia, Brunei, Laos,
  Timor-Leste, Afghanistan, Bhutan, Maldives, the Central Asian republics,
  Mongolia, plus Pacific (Papua New Guinea, Fiji).
- **Global wires + firehoses** — BBC, Al Jazeera, Guardian, NPR, UN News,
  ReliefWeb, GDELT, and social signal (Mastodon/Bluesky tags).

Every feed was validated live (curl → HTTP 200 + RSS/Atom root + ≥2 recent items)
before being added; dead feeds were dropped/replaced. A single live ingest cycle
over the expanded list fetched **~97% of sources successfully** and grew event
coverage from **132 → 169 active regions**.

### Adding a source

Append to `DEFAULT_SOURCES` (`{ name, url, kind: "rss"|"html", region: "<ISO2>" }`).
The daily maintenance cron syncs it into the live catalog automatically — no manual
re-seed needed. `region` should be the country's ISO-3166 alpha-2 (used as the
geocode fallback when an article can't be located precisely).

## Catalog maintenance (scheduled background jobs)

[`convex/functions/sourceSync.ts`](../convex/functions/sourceSync.ts) + crons in
[`convex/functions/crons.ts`](../convex/functions/crons.ts) keep the global feed
list healthy without manual babysitting:

| Job | Schedule | What it does |
|-----|----------|--------------|
| `maintainCatalog` | daily 03:30 UTC | **Curated sync** — adds any new `DEFAULT_SOURCES` to the live catalog. **Health lifecycle** — auto-disables a standard feed that has errored ≥8 ingest cycles in a row (the ingestor then skips it). GDELT/Bluesky firehoses are operator-managed and never auto-disabled. |
| `probeDisabledSources` | daily 03:45 UTC | **Re-validation / recovery** — re-fetches auto-disabled feeds and re-enables the ones that came back. Only touches feeds it auto-disabled (`autoDisabledAt`), never operator-disabled ones. |
| `discoverCandidates` | weekly Mon 06:00 UTC | **Gap discovery** — flags regions with real news volume but no dedicated feed into the admin review queue (`sourceRequests`, pending), with an optional LLM-suggested outlet. Never auto-enables; an admin vets + approves. |

The Rust ingestor already reports per-source health (`lastStatus`,
`consecutiveFailures`, `lastFetchedAt`) every cycle via `ingest.reportSourceHealth`,
so the lifecycle job acts on real liveness data rather than re-probing on its own.

### Fetch UA

The ingestor presents a desktop-browser `User-Agent` + browser-like `Accept`
headers ([`ingestor/src/fetch.rs`](../ingestor/src/fetch.rs)) because many news
CDNs/WAFs (Cloudflare, Akamai) return `403` to bot-shaped UAs — which would
silently drop otherwise-live national feeds. This is conventional for feed readers.
