# Tracking APIs

Worker reference for flight and ship tracking integrations.

## OpenSky Network (Flight Tracking)

- **Endpoint:** `GET https://opensky-network.org/api/states/all`
- **Auth:** Anonymous (400 credits/day) or OAuth2 (4000/day). Use anonymous for MVP.
- **Polling:** Every 2 minutes globally (4 credits each = ~2880/day, within anonymous limit)
- **Bounding box:** `?lamin=...&lomin=...&lamax=...&lomax=...` reduces credit cost
- **Response:** `{ time, states: [[icao24, callsign, origin_country, ..., lat, lng, altitude, on_ground, velocity, heading, ...]] }`
- **State vector indices:** 0=icao24, 1=callsign, 2=origin_country, 5=lng, 6=lat, 7=altitude(m), 8=on_ground, 9=velocity(m/s), 10=heading(deg), 11=vertical_rate
- **OSINT squawk codes:** 7500=hijack, 7600=comms failure, 7700=emergency
- **Full docs:** .factory/research/opensky-api.md

## AISStream.io (Ship Tracking)

- **WebSocket:** `wss://stream.aisstream.io/v0/stream`
- **Auth:** API key required (env: AISSTREAM_API_KEY). Free signup at aisstream.io.
- **NO CORS:** Must proxy through backend, never connect from browser.
- **Subscription:** Send JSON with APIKey, BoundingBoxes, FilterMessageTypes within 3s of connect.
- **Key messages:** PositionReport (position, speed, heading), ShipStaticData (name, type, destination)
- **MetaData fields:** MMSI, ShipName, latitude, longitude, time_utc
- **Ship types:** 30-39=fishing, 60-69=passenger, 70-79=cargo, 80-89=tanker
- **Throughput:** ~300 msg/sec global. Filter to PositionReport for efficiency.
- **Full docs:** .factory/research/aisstream-api.md

## Architecture Pattern

Both tracking services follow the same pattern:
1. Backend service maintains connection (polling for OpenSky, WebSocket for AIS)
2. Cache positions in-memory (Map keyed by icao24 or MMSI)
3. Prune stale entries (>5min for aircraft, >15min for ships)
4. REST endpoint serves current snapshot: GET /api/flights, GET /api/vessels
5. SSE pushes incremental updates to connected frontends
6. Frontend renders as independent toggle-able map layers (not overlay modes)
