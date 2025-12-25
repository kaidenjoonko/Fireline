/**
 * FirelineStore
 */

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
type FirelineState = {
    status: ConnectionStatus;
    responders: string[];
    incidentId: string | null;
    responderId: string | null;
};
const state: FirelineState = {
    status: "disconnected",
    responders: [],
    incidentId: null,
    responderId: null,
};

export function getState() {
    return state;
}
export function setStatus(status: ConnectionStatus) {
    state.status = status;
    emit(); //notify subscribers
}
export function applySnapshot(responders: string[]) {
    state.responders = responders;
    emit(); //notify subscribers
}
export function setIdentity(incidentId: string, responderId: string) {
    state.incidentId = incidentId;
    state.responderId = responderId;
    emit(); //notify subscribers
}

/**
 * listner mechanism: react will know when something changes
 */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener) {
    listeners.add(listener);

    //return cleanup function (important for React unmount)
    return () => {
        listeners.delete(listener);
    };
}
function emit() {
    for (const listener of listeners) {
        listener();
    }
}

// /** TEMP TESTS (delete after you see logs) */
// console.log("Initial store state:", getState());
// setStatus("connecting");
// console.log("After setStatus:", getState());
// applySnapshot(["A", "B"]);
// console.log("After applySnapshot:", getState());