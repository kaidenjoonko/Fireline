# Fireline (Verizon Frontline App Developer Challenge)
A mission-aware, offline-first coordination app that keeps first responders located, connected, and alerted using edge computing when networks degrade. 
Fireline is an edge-first, offline-tolerant incident connectivity concept designed to help first responders stay coordinated during critical deployments (e.g., wildfires, EMS incidents, disaster response) when cellular coverage is degraded, networks are congested, or cloud connectivity is unavailable.

## Problem
During large incidents, first responders often face:
- Intermittent connectivity (dead zones, overloaded towers, damaged infrastructure)
- Difficulty maintaining real-time situational awareness (who is online, where teammates are, who needs help)
- Communication breakdown across teams and shifting incident boundaries

Fireline focuses on **local, resilient coordination**: responders should be able to connect and share critical updates even when “the cloud” is unreliable.

## Solution Overview
Fireline uses an **edge node** (initially your laptop in development; later deployable to portable edge infrastructure) that provides:
- Persistent real-time communication (WebSockets)
- Incident “rooms” that scope coordination to the correct incident
- A foundation for offline-first delivery semantics (queue → retry → acknowledge)

### Architecture (Current)
- **Edge Server (Node.js + TypeScript)**
  - HTTP `/health` endpoint (edge heartbeat)
  - WebSocket server for realtime messaging
  - Incident room routing: messages are broadcast only to responders in the same incident
  - Join handshake (`CLIENT_HELLO`) establishes incident + responder identity
  - Disconnect cleanup + presence leave notifications

## What’s Implemented So Far: Edge Server, Manual Testing
- Multiple WebSocket clients join the same incident and receive broadcasts
- Different incidents are isolated (no cross-room leakage)
- Disconnect triggers cleanup + leave notification

## What’s Being Added Next (Roadmap)
### 1) Incident Snapshot (next)
When a responder joins an incident, the edge node should send an immediate snapshot:
- responders currently online
- last known locations (if available)
- active SOS events (if available)

### 2) Message Contract + Validation
Define and validate message types (examples):
- `LOCATION_UPDATE`
- `CHAT_SEND`
- `SOS_RAISE`
- `ACK` / `DELIVERED`

### 3) Mobile App UI (Expo / React Native)
Initial screens:
- Join/Select Incident
- Map View (team locations)
- Chat (incident-scoped)
- SOS (high priority)
- Connectivity banner (online/offline/edge connected)

### 4) Location Pipeline
- Periodic location updates from clients (throttled)
- Edge stores last-known location per responder
- Edge broadcasts updates to the incident room

### 5) Offline-First Delivery (Key Innovation)
- Local outbox queue on device when disconnected
- Retry on reconnect
- Priority sending (SOS > safety > location > chat)
- Server acknowledgements to confirm delivery

### 6) Edge “Smart Alerts” (Optional/Stretch)
- No-movement detection
- Geofence/hazard zone warnings
- Buddy separation alerts

## Running the Edge Server (Development)
From repo root:

```bash
cd edge-server
npm install
npm run dev