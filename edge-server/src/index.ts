/* =====================================================
Fireline Edge Server
- Local incident coordination (HTTP + WebSocket)
===================================================== */

console.log("Fireline edge server starting...");

/* =========================
    Imports (CommonJS + TS)
    ========================= */
import express = require("express");
import http = require("http");
import WebSocket = require("ws");

/* =========================
    App + Server Initialization
    ========================= */
const app = express();

/* =========================
    Fireline In-Memory State
    =========================
    rooms:
    incidentId -> set of active WebSocket connections

    clientMeta:
    socket -> { incidentId, responderId }

    lastLocationByResponder:
    responderId -> { lat, lng, accuracy?, at }
*/
const rooms = new Map<string, Set<WebSocket>>();
const clientMeta = new Map<WebSocket, { incidentId: string; responderId: string }>();

type Location = {
    lat: number;
    lng: number;
    accuracy?: number;
    at: number; // server timestamp (ms)
};

const lastLocationByResponder = new Map<string, Location>();

/* =========================
    Helpers
    ========================= */

/**
* Safely parse incoming WebSocket data as JSON.
* Prevents malformed messages from crashing the server.
*/
function safeJsonParse(raw: WebSocket.RawData): any | null {
    try {
    return JSON.parse(raw.toString());
    } catch {
    return null;
    }
}

/**
* Broadcast a payload to all clients in an incident room.
*/
function broadcastToIncident(incidentId: string, payload: unknown) {
    const clients = rooms.get(incidentId);
    if (!clients) return;

    const msg = JSON.stringify(payload);
    for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
    }
    }
}

/**
* Get the list of responder IDs currently in an incident room.
*/
function getIncidentResponderIds(incidentId: string): string[] {
    const clients = rooms.get(incidentId);
    if (!clients) return [];

    const responderIds: string[] = [];
    for (const client of clients) {
    const meta = clientMeta.get(client);
    if (meta) responderIds.push(meta.responderId);
    }
    return responderIds;
}

/**
* Validate latitude/longitude.
*/
function isValidLatLng(lat: unknown, lng: unknown): lat is number {
    return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
    );
}

/**
* Gather last-known locations for responders currently in an incident.
* Only includes responders that have a stored location.
*/
function getIncidentLocations(incidentId: string): Record<string, Location> {
    const responderIds = getIncidentResponderIds(incidentId);

    const locations: Record<string, Location> = {};
    for (const id of responderIds) {
    const loc = lastLocationByResponder.get(id);
    if (loc) locations[id] = loc;
    }
    return locations;
}

/* =========================
    HTTP Endpoints
    ========================= */
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});

/* =========================
    Shared HTTP Server
    ========================= */
const server = http.createServer(app);

/* =========================
    WebSocket Server (Realtime)
    ========================= */
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    ws.on("message", (data) => {
    const msg = safeJsonParse(data);
    if (!msg) {
        ws.send(JSON.stringify({ type: "ERROR", error: "Invalid JSON" }));
        return;
    }

    /* ---- Handshake: Join Incident Room ----
        First message must be CLIENT_HELLO so the server can bind:
        socket -> {incidentId, responderId}
    */
    if (msg.type === "CLIENT_HELLO") {
        const incidentId = String(msg.incidentId ?? "");
        const responderId = String(msg.responderId ?? "");

        if (!incidentId || !responderId) {
        ws.send(
            JSON.stringify({
            type: "ERROR",
            error: "CLIENT_HELLO requires incidentId and responderId",
            })
        );
        return;
        }

        // Bind identity to socket (server truth)
        clientMeta.set(ws, { incidentId, responderId });

        // Add socket to incident room
        if (!rooms.has(incidentId)) rooms.set(incidentId, new Set());
        rooms.get(incidentId)!.add(ws);

        // Confirm join
        ws.send(
        JSON.stringify({
            type: "ACK",
            message: "Joined incident",
            incidentId,
        })
        );

        // Send incident snapshot (presence + last-known locations)
        const responders = getIncidentResponderIds(incidentId);
        const locations = getIncidentLocations(incidentId);

        ws.send(
        JSON.stringify({
            type: "INCIDENT_SNAPSHOT",
            incidentId,
            responders,
            locations,
        })
        );

        return;
    }

    // Must have joined an incident before sending any other messages
    const meta = clientMeta.get(ws);
    if (!meta) {
        ws.send(
        JSON.stringify({
            type: "ERROR",
            error: "Must send CLIENT_HELLO before other messages",
        })
        );
        return;
    }

    /* ---- Location Updates ----
        Clients send lat/lng; server validates, stores last-known, and broadcasts.
    */
    if (msg.type === "LOCATION_UPDATE") {
        const lat = msg.lat;
        const lng = msg.lng;
        const accuracy = msg.accuracy;

        if (!isValidLatLng(lat, lng)) {
        ws.send(JSON.stringify({ type: "ERROR", error: "Invalid lat/lng" }));
        return;
        }

        const location: Location = {
            lat,
            lng,
            at: Date.now(),
            ...(typeof accuracy === "number" && Number.isFinite(accuracy)
              ? { accuracy }
              : {}),
        };

        // Store last-known location by responder identity (stable across reconnects)
        lastLocationByResponder.set(meta.responderId, location);

        // Broadcast location update within incident
        broadcastToIncident(meta.incidentId, {
        type: "LOCATION_UPDATE",
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        ...location,
        });

        return;
    }

    /* ---- Default: broadcast message within incident ----
        Server enforces incident + sender identity.
    */
    broadcastToIncident(meta.incidentId, {
        ...msg,
        incidentId: meta.incidentId,
        from: meta.responderId,
        at: Date.now(),
    });
    });

    /* ---- Cleanup on Disconnect ----
    Remove socket from room and metadata; notify others.
    */
    ws.on("close", () => {
    const meta = clientMeta.get(ws);
    if (meta) {
        const set = rooms.get(meta.incidentId);
        set?.delete(ws);

        if (set && set.size === 0) {
        rooms.delete(meta.incidentId);
        }

        clientMeta.delete(ws);

        broadcastToIncident(meta.incidentId, {
        type: "PRESENCE_LEAVE",
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        at: Date.now(),
        });
    }

    console.log("WebSocket client disconnected");
    });
});

/* =========================
    Server Startup
    ========================= */
server.listen(3000, () => {
    console.log("Fireline edge server listening on port 3000");
});