import WebSocket = require("ws");
const readline = require("readline");
import crypto = require("crypto");
import protocol = require("./protocol");

const { MSG } = protocol;

type OutboxItem = {
  msgId: string;
  type: string;
  payload: Record<string, any>;
  priority: number; // lower = higher priority
  lastSentAt?: number;
  attempts: number;
};

const EDGE_URL = process.env.EDGE_URL ?? "ws://localhost:3000";
const INCIDENT_ID = process.env.INCIDENT_ID ?? "I1";
const RESPONDER_ID = process.env.RESPONDER_ID ?? "A";

function priorityFor(type: string): number {
  switch (type) {
    case MSG.SOS_RAISE:
    case MSG.SOS_CLEAR:
      return 0;
    case MSG.LOCATION_UPDATE:
      return 2;
    case MSG.CHAT_SEND:
      return 3;
    default:
      return 5;
  }
}

function newMsgId(): string {
  return crypto.randomUUID();
}

class ResponderSim {
  private ws: WebSocket | null = null;
  private connected = false;

  private outbox: OutboxItem[] = [];
  private pending = new Map<string, OutboxItem>();

  private RESEND_AFTER_MS = 1500;

  start() {
    this.connect();
    setInterval(() => this.flushOutbox(), 300);
    this.setupCli();
  }

  private connect() {
    console.log(`[sim] connecting to ${EDGE_URL} as ${RESPONDER_ID} in incident ${INCIDENT_ID}`);
    const ws = new WebSocket(EDGE_URL);
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
      console.log("[sim] connected");

      ws.send(
        JSON.stringify({
          type: MSG.CLIENT_HELLO,
          incidentId: INCIDENT_ID,
          responderId: RESPONDER_ID,
        })
      );
    });

    ws.on("message", (raw) => {
      const text = raw.toString();
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        console.log("[sim] recv (non-json):", text);
        return;
      }

      if (msg.type === MSG.INCIDENT_SNAPSHOT) {
        console.log(
          `[sim] SNAPSHOT responders=${JSON.stringify(msg.responders)} locations=${JSON.stringify(
            msg.locations
          )} sos=${JSON.stringify(msg.sos)}`
        );
        return;
      }

      if (msg.type === MSG.ACK_MSG) {
        const id = msg.msgId;
        if (this.pending.has(id)) {
          this.pending.delete(id);
          this.outbox = this.outbox.filter((x) => x.msgId !== id);
          console.log(`[sim] ACK_MSG ${id} (pending=${this.pending.size}, outbox=${this.outbox.length})`);
        }
        return;
      }

      if (msg.type === MSG.ERROR) {
        console.log("[sim] ERROR:", msg.error);
        return;
      }

      console.log("[sim] recv:", msg);
    });

    ws.on("close", () => {
      this.connected = false;
      console.log("[sim] disconnected — will retry in 1s");
      setTimeout(() => this.connect(), 1000);
    });

    ws.on("error", (err) => {
      console.log("[sim] ws error:", (err as any).message ?? err);
    });
  }

  private enqueue(type: string, payload: Record<string, any>) {
    const msgId = newMsgId();
    const item: OutboxItem = {
      msgId,
      type,
      payload,
      priority: priorityFor(type),
      attempts: 0,
    };

    this.outbox.push(item);
    this.outbox.sort((a, b) => a.priority - b.priority);

    console.log(`[sim] queued ${type} msgId=${msgId} (outbox=${this.outbox.length})`);
  }

  private sendItem(item: OutboxItem) {
    if (!this.ws || !this.connected) return;

    item.lastSentAt = Date.now();
    item.attempts += 1;

    const envelope = {
      type: item.type,
      msgId: item.msgId,
      ...item.payload,
    };

    this.ws.send(JSON.stringify(envelope));
    this.pending.set(item.msgId, item);

    console.log(`[sim] sent ${item.type} msgId=${item.msgId} attempts=${item.attempts}`);
  }

  private flushOutbox() {
    if (!this.connected) return;

    for (const item of this.outbox) {
      const isPending = this.pending.has(item.msgId);

      if (!isPending) {
        this.sendItem(item);
        return;
      }

      const last = item.lastSentAt ?? 0;
      if (Date.now() - last > this.RESEND_AFTER_MS) {
        this.sendItem(item);
        return;
      }
    }
  }

  private setupCli() {
    console.log("\nCommands:");
    console.log("  sos [note]         -> raise SOS");
    console.log("  clear              -> clear SOS");
    console.log("  chat <text>        -> send chat");
    console.log("  loc <lat> <lng>    -> send location update");
    console.log("  drop               -> simulate disconnect (close socket)");
    console.log("  status             -> show outbox/pending counts");
    console.log("");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line: string) => {
      const [cmd, ...rest] = line.trim().split(" ");
      if (!cmd) return;

      if (cmd === "sos") {
        const note = rest.join(" ").trim();
        this.enqueue(MSG.SOS_RAISE, note ? { note } : {});
        return;
      }

      if (cmd === "clear") {
        this.enqueue(MSG.SOS_CLEAR, {});
        return;
      }

      if (cmd === "chat") {
        const text = rest.join(" ").trim();
        if (!text) {
          console.log("[sim] chat requires text");
          return;
        }
        this.enqueue(MSG.CHAT_SEND, { text });
        return;
      }

      if (cmd === "loc") {
        const lat = Number(rest[0]);
        const lng = Number(rest[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          console.log("[sim] loc requires numeric lat lng");
          return;
        }
        this.enqueue(MSG.LOCATION_UPDATE, { lat, lng, accuracy: 8 });
        return;
      }

      if (cmd === "drop") {
        console.log("[sim] closing socket to simulate drop");
        this.ws?.close();
        return;
      }

      if (cmd === "status") {
        console.log(`[sim] connected=${this.connected} outbox=${this.outbox.length} pending=${this.pending.size}`);
        return;
      }

      console.log("[sim] unknown command");
    });
  }
}

new ResponderSim().start();