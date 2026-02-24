# Fireline
### Edge-first incident coordination for first responders

> Built for the Verizon Frontline App Developer Challenge

Fireline keeps first responders coordinated during wildfires, EMS incidents, and disaster response — even when cellular coverage is degraded, towers are overloaded, or cloud infrastructure is unreachable. It **assumes failure is the norm**, not the exception.

---

## The Problem

During large-scale emergencies, traditional real-time systems break down:

| Problem | Impact |
|---|---|
| Intermittent / degraded connectivity | Responders go dark — no awareness of teammates |
| Overloaded cell towers | Messages dropped silently, no confirmation of delivery |
| Cloud dependency | If the backend is unreachable, coordination collapses |
| Reconnect storms | Duplicate messages, stale state, missed SOS alerts |

**Fireline's answer:** run coordination locally on an edge node that lives at the incident site — no cloud required. Every message is reliable by design.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    INCIDENT SITE                        │
│                                                         │
│  ┌──────────┐    WebSocket    ┌─────────────────────┐   │
│  │ R-01     │◄───────────────►│                     │   │
│  │ (phone)  │                 │   Edge Server       │   │
│  └──────────┘                 │   (Node.js + TS)    │   │
│                               │                     │   │
│  ┌──────────┐    WebSocket    │  • Incident rooms   │   │
│  │ R-02     │◄───────────────►│  • Presence state   │   │
│  │ (phone)  │                 │  • Location store   │   │
│  └──────────┘                 │  • SOS state        │   │
│                               │  • Dedup store      │   │
│  ┌──────────┐    WebSocket    │                     │   │
│  │ COMMAND  │◄───────────────►│                     │   │
│  │ (browser)│                 └─────────────────────┘   │
│  └──────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

**Edge Server** — Node.js + TypeScript, runs locally at the incident (laptop, portable server, or Verizon edge node). All state lives here. No cloud dependency.

**Clients** — React Native app (mobile) + browser-based command dashboard. Both connect via WebSocket.

**Simulator** — CLI tool (`sim.ts`) for testing without physical devices. Multiple instances simulate a full incident.

---

## Core Technical Features

### 1. Reliable Message Delivery (Exactly-Once Semantics)

Every client message gets a unique `msgId`. The server ACKs it. The client retries until it receives the ACK. The server deduplicates by `msgId` — so retries never produce duplicate effects.

```
Client                        Edge Server
  │                               │
  │── {type, msgId, ...} ────────►│  1. Check dedup map
  │                               │  2. Mark msgId as seen
  │◄── {ACK_MSG, msgId} ──────────│  3. Process message
  │                               │  4. Broadcast to room
  │  (if no ACK after 1.5s)       │
  │── {type, msgId, ...} ────────►│  → duplicate detected, re-ACK only
```

Dedup entries expire after 15 minutes (TTL cleanup runs every 60s).

### 2. Priority-Based Offline Queue

When a responder loses connectivity, outgoing messages queue locally and are sorted by priority. On reconnect, the most critical messages transmit first — guaranteeing SOS alerts arrive before chat.

| Priority | Message Type |
|---|---|
| 0 (highest) | `SOS_RAISE`, `SOS_CLEAR` |
| 2 | `LOCATION_UPDATE` |
| 3 | `CHAT_SEND` |
| 5 | Everything else |

### 3. Incident Snapshot (State Hydration)

When a responder joins or reconnects — even mid-incident — the edge server immediately sends a full snapshot:

```json
{
  "type": "INCIDENT_SNAPSHOT",
  "responders": ["R-01", "R-02"],
  "locations": {
    "R-01": { "lat": 37.782, "lng": -122.415, "accuracy": 8 }
  },
  "sos": {
    "R-02": { "note": "Trapped, sector 7", "at": 1703456789000 }
  }
}
```

Late joiners and reconnecting clients instantly see the full incident state — no polling, no missed alerts.

### 4. Incident-Scoped Isolation

Responders join a named incident (`INCIDENT_ID`). Messages, state, and presence are fully isolated per incident. Multiple simultaneous deployments share one edge server with zero cross-incident leakage.

### 5. SOS Persistence

SOS alerts survive disconnects. If a responder raises SOS and their connection drops, the alert remains active on the server. Every new client who joins sees it in the snapshot. It only clears when the responder explicitly sends `SOS_CLEAR`.

### 6. Command Dashboard

A browser-based tactical dashboard (served at `http://localhost:3000`) shows the full incident in real time:

- **Live map** — responder positions update as location packets arrive (Leaflet + CartoDB dark tiles)
- **SOS banner** — pulsing alert bar when any responder is in distress; map markers pulse red
- **Presence list** — who's online, who has GPS, who has active SOS
- **Comms log** — full chat feed with per-responder color coding
- No build step — pure WebSocket client served directly by Express

---

## Message Protocol

All messages are JSON over WebSocket.

| Type | Direction | Description |
|---|---|---|
| `CLIENT_HELLO` | Client → Server | Join an incident (incidentId + responderId) |
| `ACK` | Server → Client | Confirm join |
| `INCIDENT_SNAPSHOT` | Server → Client | Full incident state on join/reconnect |
| `PRESENCE_JOIN` | Server → All | A responder connected |
| `PRESENCE_LEAVE` | Server → All | A responder disconnected |
| `LOCATION_UPDATE` | Client → Server → All | GPS position update |
| `SOS_RAISE` | Client → Server → All | Distress alert with optional note |
| `SOS_CLEAR` | Client → Server → All | Responder is safe |
| `CHAT_SEND` | Client → Server → All | Text message to incident room |
| `ACK_MSG` | Server → Client | Confirms a specific msgId was received |
| `ERROR` | Server → Client | Protocol or validation error |

---

## Running the Demo

### 1. Install dependencies

```bash
cd edge-server && npm install
```

### 2. Start the edge server

```bash
cd edge-server && npm run dev
```

Verify it's up:
```bash
curl http://localhost:3000/health
# {"ok":true}
```

### 3. Open the command dashboard

Go to `http://localhost:3000` in your browser. Enter an incident ID (e.g. `DEMO-001`) and click **Connect**.

### 4. Start responder simulators

Each simulator is a separate terminal, each with a different `RESPONDER_ID`:

```bash
# Terminal 2
cd edge-server && RESPONDER_ID=R-01 INCIDENT_ID=DEMO-001 npm run sim

# Terminal 3
cd edge-server && RESPONDER_ID=R-02 INCIDENT_ID=DEMO-001 npm run sim
```

### 5. Demo commands

```
walk <lat> <lng>   start auto-walking (sends location every 3s)
stop               stop auto-walk
loc <lat> <lng>    send a single location update
sos [note]         raise SOS alert
clear              clear SOS
chat <text>        send a chat message
drop               simulate network loss (socket closes, auto-reconnects in 1s)
status             show outbox / pending message counts
```

### Demo script

```
# R-01 terminal
walk 37.782 -122.415

# R-02 terminal
walk 37.776 -122.421
chat Wind shifting northeast, adjusting route

# R-01 terminal
chat Copy, moving toward the ridge

# R-02 terminal — trigger SOS
sos Trapped, structure collapse sector 7

# R-01 terminal — simulate network loss then recovery
drop
# (watch messages queue, then flush in priority order on reconnect)

# R-02 terminal — resolve
clear
```

---

## Project Structure

```
Fireline/
├── edge-server/
│   └── src/
│       ├── index.ts      Edge server (WebSocket + HTTP)
│       ├── protocol.ts   Message type constants
│       └── sim.ts        CLI responder simulator
├── fireline-ui/
│   └── src/
│       ├── network/firelineClient.ts   WebSocket client
│       ├── store/firelineStore.ts      Reactive state store
│       └── types/protocol.ts          Protocol types
├── dashboard/
│   └── index.html        Browser command dashboard
└── README.md
```

---

## Roadmap

- **Mobile UI** — complete the React Native client (SOS button, chat, location send, offline indicator)
- **Persistence** — survive edge server restarts without losing incident state
- **Multi-edge sync** — coordinate across multiple edge nodes for large incidents
- **Smart alerts** — no-movement detection, geofencing, buddy separation warnings
