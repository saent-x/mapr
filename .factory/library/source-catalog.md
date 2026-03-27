# Source Catalog Notes

- `server/sourceCatalog.js` normalizes `isoA2` from `feed.country` via a direct `countryToIso(feed.country)` lookup.
- Alias-style country strings in feed metadata are **not** normalized through `COUNTRY_ALIASES` first.
- If a feed uses a non-canonical country label (for example `Congo-Brazzaville` instead of the geocoder's canonical `Congo`), the catalog entry will get `isoA2: null` unless the feed provides an explicit ISO code.
