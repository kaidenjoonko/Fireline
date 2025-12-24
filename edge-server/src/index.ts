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

    activeSosByIncident:
    incidentId -> (responderId -> SosState)
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

type SosState = {
    note?: string;
    at: number; // server timestamp when SOS was raised
};

const activeSosByIncident = new Map<string, Map<string, SosState>>();

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

/**
* Gather active SOS states for responders currently in an incident.
*/
function getIncidentSos(incidentId: string): Record<string, SosState> {
    const incidentSos = activeSosByIncident.get(incidentId);
    if (!incidentSos) return {};

    const out: Record<string, SosState> = {};
    for (const [responderId, sos] of incidentSos.entries()) {
    out[responderId] = sos;
    }
    return out;
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

    /* ---- Handshake: Join Incident Room ---- */
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

        clientMeta.set(ws, { incidentId, responderId });

        if (!rooms.has(incidentId)) rooms.set(incidentId, new Set());
        rooms.get(incidentId)!.add(ws);

        ws.send(
        JSON.stringify({
            type: "ACK",
            message: "Joined incident",
            incidentId,
        })
        );

        ws.send(
        JSON.stringify({
            type: "INCIDENT_SNAPSHOT",
            incidentId,
            responders: getIncidentResponderIds(incidentId),
            locations: getIncidentLocations(incidentId),
            sos: getIncidentSos(incidentId),
        })
        );

        return; // IMPORTANT: stop processing this message
    }

    /* ---- Must be joined after this point ---- */
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

    /* ---- Location Updates ---- */
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

        lastLocationByResponder.set(meta.responderId, location);

        broadcastToIncident(meta.incidentId, {
        type: "LOCATION_UPDATE",
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        ...location,
        });

        return;
    }

    /* ---- SOS Updates ---- */
    if (msg.type === "SOS_RAISE") {
        const note = typeof msg.note === "string" ? msg.note : undefined;

        if (!activeSosByIncident.has(meta.incidentId)) {
        activeSosByIncident.set(meta.incidentId, new Map());
        }

        const incidentSos = activeSosByIncident.get(meta.incidentId)!;

        const sosState: SosState = {
        at: Date.now(),
        ...(note ? { note } : {}),
        };

        incidentSos.set(meta.responderId, sosState);

        broadcastToIncident(meta.incidentId, {
        type: "SOS_RAISE",
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        ...sosState,
        });

        return;
    }

    if (msg.type === "SOS_CLEAR") {
        const incidentSos = activeSosByIncident.get(meta.incidentId);
        incidentSos?.delete(meta.responderId);

        if (incidentSos && incidentSos.size === 0) {
        activeSosByIncident.delete(meta.incidentId);
        }

        broadcastToIncident(meta.incidentId, {
        type: "SOS_CLEAR",
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        at: Date.now(),
        });

        return;
    }

    /* ---- Default: broadcast message within incident ---- */
    broadcastToIncident(meta.incidentId, {
        ...msg,
        incidentId: meta.incidentId,
        from: meta.responderId,
        at: Date.now(),
    });
    });

    /* ---- Cleanup on Disconnect ---- */
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