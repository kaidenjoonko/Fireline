import { useEffect, useState } from "react";
import { View, Text, Button, TextInput } from "react-native";

import { getState, subscribe } from "./src/store/firelineStore";
import { firelineClient } from "./src/network/firelineClient";

export default function App() {
  const [, forceRender] = useState(0);

  // Local inputs (UI only). The store holds the “official” identity after connect().
  const [incidentId, setIncidentId] = useState("I1");
  const [responderId, setResponderId] = useState("A");

  useEffect(() => {
    const unsub = subscribe(() => forceRender((n) => n + 1));
    return unsub;
  }, []);

  const s = getState();

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Fireline UI (MVP)</Text>

      <Text>Status: {s.status}</Text>
      <Text>
        Identity: {s.responderId ?? "(none)"} @ {s.incidentId ?? "(none)"}
      </Text>

      <TextInput
        value={incidentId}
        onChangeText={setIncidentId}
        placeholder="Incident ID (e.g., I1)"
        autoCapitalize="none"
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <TextInput
        value={responderId}
        onChangeText={setResponderId}
        placeholder="Responder ID (e.g., A)"
        autoCapitalize="none"
        style={{ borderWidth: 1, padding: 10, borderRadius: 8 }}
      />

      <Button title="Connect" onPress={() => firelineClient.connect(incidentId, responderId)} />
      <Button title="Disconnect" onPress={() => firelineClient.disconnect()} />
    </View>
  );
}