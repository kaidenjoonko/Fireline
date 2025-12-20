// Fireline edge server — HTTP + WebSocket
console.log("Fireline edge server starting...");

// commonJS-compatible imports for TypeScript
import express = require("express");
import http = require("http");
import WebSocket = require("ws");

// create Express app
const app = express();

// health endpoint (edge heartbeat)
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// create shared HTTP server
const server = http.createServer(app);

// attach WebSocket server to HTTP server
const wss = new WebSocket.Server({ server });

// handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  // handle incoming messages
  ws.on("message", (data) => {
    const message = data.toString();
    console.log("Received:", message);

    // echo back for now (test loop)
    ws.send(message);
  });

  // handle disconnects
  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });
});

// start server (keeps process alive)
server.listen(3000, () => {
  console.log("Fireline edge server listening on port 3000");
});