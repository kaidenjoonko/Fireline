/**
 * Fireline Protocol Constants
 * Single source of truth for message type strings.
 *
 * CommonJS export to match the project's TS/CommonJS import style.
 */
const MSG = {
    // Handshake / state hydration
    CLIENT_HELLO: "CLIENT_HELLO",
    ACK: "ACK",
    INCIDENT_SNAPSHOT: "INCIDENT_SNAPSHOT",

    // Reliability
    ACK_MSG: "ACK_MSG",
    ERROR: "ERROR",

    // Presence
    PRESENCE_JOIN: "PRESENCE_JOIN",
    PRESENCE_LEAVE: "PRESENCE_LEAVE",

    // Core updates
    LOCATION_UPDATE: "LOCATION_UPDATE",
    SOS_RAISE: "SOS_RAISE",
    SOS_CLEAR: "SOS_CLEAR",
    CHAT_SEND: "CHAT_SEND",
} as const;

export = { MSG };