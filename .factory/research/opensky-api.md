# OpenSky Network API Research

## Overview
Free REST API for real-time aircraft tracking via ADS-B/Mode S data.

## Endpoints

### GET /states/all
Base URL: `https://opensky-network.org/api/states/all`

**Query params:**
- `lamin`, `lomin`, `lamax`, `lomax` — bounding box (WGS84 decimal degrees)
- `icao24` — filter by transponder address (hex string, repeatable)
- `time` — Unix timestamp (anonymous: ignored, uses current)
- `extended=1` — include aircraft category

**Response:** `{ time: int, states: [[icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source, category], ...] }`

State vector indices:
- 0: icao24 (string, hex)
- 1: callsign (string, 8 chars, nullable)
- 2: origin_country (string)
- 3: time_position (int, nullable)
- 4: last_contact (int)
- 5: longitude (float, nullable)
- 6: latitude (float, nullable)
- 7: baro_altitude (float, meters, nullable)
- 8: on_ground (boolean)
- 9: velocity (float, m/s, nullable)
- 10: true_track (float, degrees, nullable)
- 11: vertical_rate (float, m/s, nullable)
- 13: geo_altitude (float, meters, nullable)
- 14: squawk (string, nullable)
- 17: category (int, 0-20)

## Rate Limits

**Anonymous (no auth):**
- 400 credits/day
- 10s resolution
- Current time only

**Registered (free, OAuth2):**
- 4000 credits/day (8000 if contributing ADS-B data)
- 5s resolution
- Up to 1h history

**Credit costs by area:**
- 0-25 sq deg (~500x500km): 1 credit
- 25-100 sq deg (~1000x1000km): 2 credits
- 100-400 sq deg (~2000x2000km): 3 credits
- >400 sq deg or global: 4 credits

**Strategy for Mapr:** Poll globally every 30s using anonymous access = ~2880 requests/day at 4 credits each = 11,520 credits. This exceeds anonymous limit. Better approach: poll every 2-3 minutes globally (480-720 requests = 1920-2880 credits/day) or use bounding boxes for active regions only.

## Authentication
OAuth2 client credentials flow (basic auth deprecated March 18, 2026).
Anonymous access works without auth but with stricter limits.

## Key Notes
- No CORS issues (server-side only)
- Aircraft category 14 = UAV/drone, useful for OSINT
- Military aircraft visible (no filtering by default)
- Squawk codes: 7500=hijack, 7600=comms failure, 7700=emergency
