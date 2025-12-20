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
   */
   const rooms = new Map<string, Set<WebSocket>>();
   const clientMeta = new Map<WebSocket, { incidentId: string; responderId: string }>();
   
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
   
       // ---- Handshake: Join Incident Room ----
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
   
         if (!rooms.has(incidentId)) {
           rooms.set(incidentId, new Set());
         }
         rooms.get(incidentId)!.add(ws);
   
         ws.send(
           JSON.stringify({
             type: "ACK",
             message: "Joined incident",
             incidentId,
           })
         );
         return;
       }
   
       // Must have joined an incident before sending other messages
       const meta = clientMeta.get(ws);
       if (!meta) {
         ws.send(JSON.stringify({ type: "ERROR", error: "Must send CLIENT_HELLO before other messages" }));
         return;
       }
   
       // Broadcast within the same incident room
       broadcastToIncident(meta.incidentId, {
         ...msg,
         incidentId: meta.incidentId, // enforce server truth
         from: meta.responderId,
         at: Date.now(),
       });
     });
   
     // ---- Cleanup on Disconnect ----
     ws.on("close", () => {
       const meta = clientMeta.get(ws);
       if (meta) {
         const set = rooms.get(meta.incidentId);
         set?.delete(ws);
   
         if (set && set.size === 0) {
           rooms.delete(meta.incidentId);
         }
   
         clientMeta.delete(ws);
   
         // Optional: notify others someone left
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