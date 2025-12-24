/* =====================================================
Fireline Edge Server
    - Local incident coordination (HTTP + WebSocket)
    - Reliability: msgId + ACK + dedup (TTL)
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
    Types
    ========================= */
type ClientMeta = { incidentId: string; responderId: string };

type Location = {
    lat: number;
    lng: number;
    accuracy?: number;
    at: number; // server timestamp (ms)
};

type SosState = {
    note?: string;
    at: number; // server timestamp when SOS was raised
};

/* =========================
    Fireline In-Memory State
    ========================= */
const rooms = new Map<string, Set<WebSocket>>();
const clientMeta = new Map<WebSocket, ClientMeta>();

const lastLocationByResponder = new Map<string, Location>();
const activeSosByIncident = new Map<string, Map<string, SosState>>();

const dedupMsgIdsByIncident = new Map<string, Map<string, number>>();
const DEDUP_TTL_MS = 15 * 60 * 1000; // 15 minutes

/* =========================
    Helpers
    ========================= */
function safeJsonParse(raw: WebSocket.RawData): any | null {
    try {
    return JSON.parse(raw.toString());
    } catch {
    return null;
    }
}

function send(ws: WebSocket, payload: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
}

function error(ws: WebSocket, message: string) {
    send(ws, { type: "ERROR", error: message, at: Date.now() });
}

function ack(ws: WebSocket, msgId: string) {
    send(ws, { type: "ACK_MSG", msgId, at: Date.now() });
}

function broadcastToIncident(incidentId: string, payload: unknown) {
    const clients = rooms.get(incidentId);
    if (!clients) return;

    const msg = JSON.stringify(payload);
    for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
}

function getIncidentResponderIds(incidentId: string): string[] {
    const clients = rooms.get(incidentId);
    if (!clients) return [];

    const ids: string[] = [];
    for (const client of clients) {
    const meta = clientMeta.get(client);
    if (meta) ids.push(meta.responderId);
    }
    return ids;
}

function getIncidentLocations(incidentId: string): Record<string, Location> {
    const responderIds = getIncidentResponderIds(incidentId);
    const locations: Record<string, Location> = {};

    for (const id of responderIds) {
    const loc = lastLocationByResponder.get(id);
    if (loc) locations[id] = loc;
    }
    return locations;
}

function getIncidentSos(incidentId: string): Record<string, SosState> {
    const incidentSos = activeSosByIncident.get(incidentId);
    if (!incidentSos) return {};

    const out: Record<string, SosState> = {};
    for (const [responderId, sos] of incidentSos.entries()) out[responderId] = sos;
    return out;
}

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

function getIncidentDedupMap(incidentId: string): Map<string, number> {
    if (!dedupMsgIdsByIncident.has(incidentId)) {
    dedupMsgIdsByIncident.set(incidentId, new Map());
    }
    return dedupMsgIdsByIncident.get(incidentId)!;
}

function markMsgIdIfNew(incidentId: string, msgId: string): boolean {
    const map = getIncidentDedupMap(incidentId);
    if (map.has(msgId)) return false;
    map.set(msgId, Date.now());
    return true;
}

/* TTL cleanup for dedup store */
setInterval(() => {
    const now = Date.now();
    for (const [incidentId, map] of dedupMsgIdsByIncident.entries()) {
    for (const [msgId, firstSeenAt] of map.entries()) {
        if (now - firstSeenAt > DEDUP_TTL_MS) map.delete(msgId);
    }
    if (map.size === 0) dedupMsgIdsByIncident.delete(incidentId);
    }
}, 60 * 1000);

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
    WebSocket Server
    ========================= */
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    ws.on("message", (data) => {
    const msg = safeJsonParse(data);
    if (!msg) {
        error(ws, "Invalid JSON");
        return;
    }

    /* ---- Handshake ---- */
    if (msg.type === "CLIENT_HELLO") {
        const incidentId = String(msg.incidentId ?? "");
        const responderId = String(msg.responderId ?? "");

        if (!incidentId || !responderId) {
        error(ws, "CLIENT_HELLO requires incidentId and responderId");
        return;
        }

        clientMeta.set(ws, { incidentId, responderId });

        if (!rooms.has(incidentId)) rooms.set(incidentId, new Set());
        rooms.get(incidentId)!.add(ws);

        send(ws, { type: "ACK", message: "Joined incident", incidentId, at: Date.now() });

        send(ws, {
        type: "INCIDENT_SNAPSHOT",
        incidentId,
        responders: getIncidentResponderIds(incidentId),
        locations: getIncidentLocations(incidentId),
        sos: getIncidentSos(incidentId),
        at: Date.now(),
        });

        return;
    }

    /* Must be joined */
    const meta = clientMeta.get(ws);
    if (!meta) {
        error(ws, "Must send CLIENT_HELLO before other messages");
        return;
    }

    /* Reliability: msgId required */
    const msgId = msg.msgId;
    if (typeof msgId !== "string" || msgId.trim() === "") {
        error(ws, "Missing msgId (required for reliability)");
        return;
    }

    /* Dedup: idempotent effect */
    if (!markMsgIdIfNew(meta.incidentId, msgId)) {
        ack(ws, msgId);
        return;
    }

    /* ACK immediately on acceptance */
    ack(ws, msgId);

    /* ---- LOCATION_UPDATE ---- */
    if (msg.type === "LOCATION_UPDATE") {
        const { lat, lng, accuracy } = msg;

        if (!isValidLatLng(lat, lng)) {
        error(ws, "Invalid lat/lng");
        return;
        }

        const location: Location = {
        lat,
        lng,
        at: Date.now(),
        ...(typeof accuracy === "number" && Number.isFinite(accuracy) ? { accuracy } : {}),
        };

        lastLocationByResponder.set(meta.responderId, location);

        broadcastToIncident(meta.incidentId, {
        type: "LOCATION_UPDATE",
        msgId,
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        ...location,
        });

        return;
    }

    /* ---- SOS_RAISE ---- */
    if (msg.type === "SOS_RAISE") {
        const note = typeof msg.note === "string" ? msg.note : undefined;

        if (!activeSosByIncident.has(meta.incidentId)) activeSosByIncident.set(meta.incidentId, new Map());
        const incidentSos = activeSosByIncident.get(meta.incidentId)!;

        const sosState: SosState = {
        at: Date.now(),
        ...(note ? { note } : {}),
        };

        incidentSos.set(meta.responderId, sosState);

        broadcastToIncident(meta.incidentId, {
        type: "SOS_RAISE",
        msgId,
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        ...sosState,
        });

        return;
    }

    /* ---- SOS_CLEAR ---- */
    if (msg.type === "SOS_CLEAR") {
        const incidentSos = activeSosByIncident.get(meta.incidentId);
        incidentSos?.delete(meta.responderId);
        if (incidentSos && incidentSos.size === 0) activeSosByIncident.delete(meta.incidentId);

        broadcastToIncident(meta.incidentId, {
        type: "SOS_CLEAR",
        msgId,
        incidentId: meta.incidentId,
        responderId: meta.responderId,
        at: Date.now(),
        });

        return;
    }

    /* ---- CHAT_SEND ---- */
    if (msg.type === "CHAT_SEND") {
        const text = String(msg.text ?? "");
        if (!text) {
        error(ws, "CHAT_SEND requires text");
        return;
        }

        broadcastToIncident(meta.incidentId, {
        type: "CHAT_SEND",
        msgId,
        incidentId: meta.incidentId,
        from: meta.responderId,
        text,
        at: Date.now(),
        });

        return;
    }

    /* Default broadcast */
    broadcastToIncident(meta.incidentId, {
        ...msg,
        msgId,
        incidentId: meta.incidentId,
        from: meta.responderId,
        at: Date.now(),
    });
    });

    ws.on("close", () => {
    const meta = clientMeta.get(ws);
    if (meta) {
        const set = rooms.get(meta.incidentId);
        set?.delete(ws);
        if (set && set.size === 0) rooms.delete(meta.incidentId);

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
    Startup
    ========================= */
server.listen(3000, () => {
    console.log("Fireline edge server listening on port 3000");
});