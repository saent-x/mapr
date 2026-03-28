# AISStream.io API Research

## Overview
Free WebSocket API for real-time maritime vessel tracking via AIS data. Beta service.

## Connection
URL: `wss://stream.aisstream.io/v0/stream`

**Authentication:** API key required (free, sign up via GitHub at https://aisstream.io/authenticate)

**CORS:** NOT supported. Must proxy through backend.

## Subscription Message
Send within 3 seconds of connecting:
```json
{
  "APIKey": "<key>",
  "BoundingBoxes": [[[-90, -180], [90, 180]]],
  "FiltersShipMMSI": ["368207620"],
  "FilterMessageTypes": ["PositionReport"]
}
```

- BoundingBoxes: Required. `[[[lat1, lon1], [lat2, lon2]], ...]`
- FiltersShipMMSI: Optional. Max 50 MMSI values.
- FilterMessageTypes: Optional. Filter to specific AIS message types.

## Key Message Types

### PositionReport (most useful)
```json
{
  "MessageType": "PositionReport",
  "MetaData": {
    "MMSI": 259000420,
    "ShipName": "AUGUSTSON",
    "latitude": 66.02695,
    "longitude": 12.253821,
    "time_utc": "2022-12-29 18:22:32.318353 +0000 UTC"
  },
  "Message": {
    "PositionReport": {
      "Latitude": 66.02695,
      "Longitude": 12.253821,
      "Cog": 308,
      "Sog": 0,
      "TrueHeading": 235,
      "NavigationalStatus": 15,
      "UserID": 259000420,
      "Timestamp": 31
    }
  }
}
```

### ShipStaticData (vessel identity)
Contains: Name, CallSign, ImoNumber, Type, Dimension, Destination, MaxDraught

## Throughput
~300 messages/second for global coverage. Backend must process efficiently.

## Strategy for Mapr
1. Backend maintains persistent WebSocket connection to AISStream
2. Filter to PositionReport + ShipStaticData message types
3. Cache vessel positions in memory (Map keyed by MMSI)
4. Serve cached positions via REST endpoint /api/vessels
5. Push updates to frontend via SSE
6. Use bounding boxes to limit to regions of interest (reduce load)

## Key Notes
- Subscription can be updated by resending subscription message
- Connection closed if no subscription within 3s
- Connection may be closed if read queue too large (process messages fast)
- Ship types: 30-39=fishing, 40-49=high-speed, 50-59=pilot/SAR, 60-69=passenger, 70-79=cargo, 80-89=tanker
- MMSI format: 9 digits, first 3 = country code (MID)
- Env var needed: AISSTREAM_API_KEY
