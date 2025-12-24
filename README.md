# Fireline (Verizon Frontline App Developer Challenge)

**Fireline** is an edge-first, offline-tolerant incident connectivity platform designed to help first responders stay coordinated during critical deployments (e.g., wildfires, EMS incidents, disaster response) when cellular coverage is degraded, networks are congested, or cloud connectivity is unavailable.

Fireline assumes failure is the norm, not the exception—and is built to preserve situational awareness despite unreliable connectivity.

---

## Problem

During large-scale emergency incidents, first responders often face:

- Intermittent or degraded connectivity (dead zones, overloaded towers, damaged infrastructure)
- Loss of real-time situational awareness (who is online, where teammates are, who needs help)
- Dropped or duplicated messages during reconnects
- Critical alerts (e.g., SOS) failing to propagate reliably

Traditional real-time systems assume stable cloud connectivity. Fireline is built around **local, resilient coordination**: responders should be able to connect, recover state, and deliver critical updates even when “the cloud” is unreliable or unreachable.

---

## Solution Overview

Fireline uses a **local edge node** (currently a developer laptop; later deployable to portable edge infrastructure) that provides:

- Persistent real-time communication via WebSockets
- Incident-scoped “rooms” to isolate coordination per deployment
- Server-authoritative incident state
- Offline-first delivery semantics (queue → retry → acknowledge)
- Priority handling for critical messages (e.g., SOS)

---

## Architecture (Current)

### Edge Server (Node.js + TypeScript)
- HTTP `/health` endpoint for edge heartbeat
- WebSocket server for real-time communication
- Incident room routing (messages are broadcast only within the same incident)
- Join handshake (`CLIENT_HELLO`) binds socket → responder → incident
- Server-authoritative incident state (presence, SOS, locations)
- Disconnect cleanup + presence leave notifications

### Client Model (Simulator / Future UI)
- WebSocket-based real-time client
- Local outbox queue for offline messages
- Retry-until-ACK delivery
- State resynchronization via incident snapshots on reconnect

---

## What’s Implemented So Far

### Incident Rooms & Presence
- Multiple clients can join the same incident and receive real-time broadcasts
- Different incidents are fully isolated (no cross-incident leakage)
- Disconnects trigger cleanup and presence leave notifications

### Incident Snapshot (State Hydration)
When a responder joins or reconnects, the edge server immediately sends a snapshot containing:
- Responders currently online
- Last-known locations (if available)
- Active SOS events (if any)

This ensures state consistency after reconnects or late joins.

### SOS System (High Priority)
- Responders can raise and clear SOS alerts
- SOS state is stored server-side per incident
- SOS persists across disconnects and reconnects
- Late joiners immediately see active SOS alerts

### Location Sharing
- Responders send validated location updates (lat/lng/accuracy)
- Edge stores last-known location per responder
- Location updates are broadcast in real time
- Locations are included in incident snapshots

### Offline-First Delivery & Reliability (Core Innovation)
- Every client message includes a unique `msgId`
- Edge server immediately ACKs accepted messages (`ACK_MSG`)
- Clients retry unacknowledged messages until delivery is confirmed
- Server-side deduplication ensures **exactly-once effect**
- Supports intermittent connectivity without message loss

### Priority-Based Messaging
Messages are queued and sent in priority order:
1. SOS alerts
2. (Future) safety/status messages
3. Location updates
4. Chat messages

This ensures critical signals are delivered first during reconnect.

---

## What’s Being Added Next (Roadmap)

### 1) Mobile App UI (Next Major Phase)
Planned initial UI (React Native / Expo):
- Join / Select Incident
- Map View (responder locations)
- SOS banner + active SOS list
- Incident-scoped chat
- Connectivity + queued message indicator

### 2) UI-State Integration
- Visualize incident snapshots
- Live updates for location, presence, and SOS
- Show offline / reconnecting state clearly

### 3) Edge Enhancements (Stretch)
- Smarter reconnect handling
- Optional persistence layer
- Multi-edge synchronization (future)
- Smart alerts (no-movement, geofencing, buddy separation)

---

## Running the Edge Server (Development)

From the repo root:

```bash
cd edge-server
npm install
npm run dev
```

Verify the edge node is running:
```bash
curl http://localhost:3000/health
# → {"ok":true}
```

Run Responder Simulators
In separate terminals:
```bash
RESPONDER_ID=A INCIDENT_ID=I1 npm run sim
RESPONDER_ID=B INCIDENT_ID=I1 npm run sim
```

Simulator commands:
	•	sos [note]
	•	clear
	•	chat <text>
	•	loc <lat> <lng>
	•	drop (simulate network loss)
	•	status (outbox / pending counts)
