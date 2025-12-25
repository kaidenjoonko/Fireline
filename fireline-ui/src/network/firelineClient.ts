/**
 * FirelineClient
 * --------------
 * This file owns the WebSocket connection to your edge server.
 * 
 * React components should NOT directly manage sockets, reconnects, or protocol.
 * Instead, React calls simple methods like:
 * - client.connect(...)
 * - client.disconnect(...)
 * 
 * And the client updates a store that the UI can render from.
 */

import { EDGE_URL } from "../config/env";
import { MSG } from "../types/protocol";
import { setStatus, setIdentity } from "../store/firelineStore";

export class FirelineClient {
    private ws: WebSocket | null = null;

    connect(incidentId: string, responderId: string, edgeUrl: string = EDGE_URL){
        //store identity so ui can display it
        setIdentity(incidentId, responderId);

        //we are attempting a connection
        setStatus("connecting");

        //close any existing socket (importatnt for reconnect / switching incidents)
        if (this.ws){
            this.ws.close();
            this.ws = null;
        }

        const ws = new WebSocket(edgeUrl);
        this.ws = ws;

        ws.onopen = () => {
            setStatus("connected");

            //handshake: bind socket --> incident + responder on server
            ws.send(
                JSON.stringify({
                    type: MSG.CLIENT_HELLO,
                    incidentId,
                    responderId,
                })
            );
        };

        ws.onclose = () => {
            setStatus("disconnected");
        };

        ws.onerror = (err) => {
            console.warn("[fireline-ui] ws error", err);
        };
    }

    disconnect(){
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        setStatus("disconnected");
    }
}

export const firelineClient = new FirelineClient();