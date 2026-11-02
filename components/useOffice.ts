"use client";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "../shared/types";

export function useOffice() {
  const [state, setState] = useState<Snapshot>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/state")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((snapshot) => {
        if (snapshot) setState(snapshot);
      })
      .catch(() => {});
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      setState(JSON.parse(event.data));
      setConnected(true);
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, []);
  const action = useCallback(
    async <T>(name: string, data?: unknown): Promise<T> => {
      try {
        const response = await fetch(
          name === "message.send" ? "/api/messages" : "/api/action",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              name === "message.send" ? data : { action: name, data },
            ),
          },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "เกิดข้อผิดพลาด");
        return result.result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "เชื่อมต่อไม่ได้";
        setError(message);
        throw error;
      }
    },
    [],
  );
  return { state, connected, error, setError, action };
}
