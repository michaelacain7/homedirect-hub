import { useEffect, useRef, useCallback, useState } from "react";
import { queryClient } from "@/lib/queryClient";

type WSEvent = {
  event: string;
  data: any;
};

type WSHandler = (data: any) => void;

const API_BASE = "__PORT_5000__";

export function useWebSocket(userId: number | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<WSHandler>>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (!userId) return;

    const wsBase = API_BASE.startsWith("__") ? "" : API_BASE;
    const wsUrl = wsBase
      ? wsBase.replace(/^http/, "ws") + "/ws"
      : (window.location.protocol === "https:" ? "wss" : "ws") +
        "://" +
        window.location.host +
        "/ws";

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ event: "auth", data: { userId } }));
      // Keepalive ping every 25s to prevent proxy idle timeout
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "ping", data: {} }));
        }
      }, 25000);
    };

    ws.onmessage = (evt) => {
      try {
        const msg: WSEvent = JSON.parse(evt.data);
        const handlers = handlersRef.current.get(msg.event);
        if (handlers) {
          handlers.forEach((fn) => fn(msg.data));
        }

        // Auto-invalidate queries based on events
        switch (msg.event) {
          case "task:created":
          case "task:updated":
          case "task:deleted":
            queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
            queryClient.invalidateQueries({
              queryKey: ["/api/dashboard/stats"],
            });
            break;
          case "file:uploaded":
            queryClient.invalidateQueries({ queryKey: ["/api/files"] });
            break;
          case "announcement:created":
            queryClient.invalidateQueries({
              queryKey: ["/api/announcements"],
            });
            break;
          case "channel:created":
            queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
            break;
          case "milestone:updated":
            queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
            break;
          case "online:update":
            queryClient.invalidateQueries({ queryKey: ["/api/team"] });
            break;
          case "notification:new":
            queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
            queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
            break;
          case "calendar:created":
          case "calendar:updated":
          case "calendar:deleted":
            queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
            // Also invalidate per-user calendar queries
            queryClient.invalidateQueries({ predicate: (q) => {
              const key = q.queryKey;
              return Array.isArray(key) && key[0] === "/api/calendar-events/user";
            }});
            break;
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      // Auto-reconnect after 2 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [userId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((event: string, data: any): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
      return true;
    }
    return false;
  }, []);

  const on = useCallback((event: string, handler: WSHandler) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    return () => {
      handlersRef.current.get(event)?.delete(handler);
    };
  }, []);

  return { send, on, isConnected };
}
