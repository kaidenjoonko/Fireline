// src/types/protocol.ts

export const MSG = {
    CLIENT_HELLO: "CLIENT_HELLO",
    INCIDENT_SNAPSHOT: "INCIDENT_SNAPSHOT",
  
    LOCATION_UPDATE: "LOCATION_UPDATE",
    CHAT_SEND: "CHAT_SEND",
  
    SOS_RAISE: "SOS_RAISE",
    SOS_CLEAR: "SOS_CLEAR",
  
    ERROR: "ERROR",
  } as const;