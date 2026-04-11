import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useWS } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Monitor,
  MonitorOff,
  Eye,
  Users,
  Loader2,
  ScreenShare,
  X,
} from "lucide-react";

interface ScreenSession {
  hostId: number;
  hostName: string;
  startedAt: string;
}

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export default function ScreenSharePage() {
  const { user } = useAuth();
  const ws = useWS();
  const [sessions, setSessions] = useState<ScreenSession[]>([]);
  const [sharing, setSharing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Refs for WebRTC
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Fetch active sessions on mount
  useEffect(() => {
    ws.send("screen:list", {});
  }, [ws]);

  // Listen for screen share events
  useEffect(() => {
    const unsubs = [
      ws.on("screen:list", (data: ScreenSession[]) => {
        setSessions(data);
      }),
      ws.on("screen:started", (data: { hostId: number; hostName: string }) => {
        setSessions((prev) => {
          if (prev.some((s) => s.hostId === data.hostId)) return prev;
          return [...prev, { hostId: data.hostId, hostName: data.hostName, startedAt: new Date().toISOString() }];
        });
      }),
      ws.on("screen:stopped", (data: { hostId: number }) => {
        setSessions((prev) => prev.filter((s) => s.hostId !== data.hostId));
        if (viewing === data.hostId) {
          stopViewing();
        }
      }),

      // WebRTC signaling
      ws.on("screen:offer", async (data: { fromUserId: number; offer: RTCSessionDescriptionInit }) => {
        // I'm a host receiving nothing here - offers come from viewers
        // Actually: viewer sends offer to host, host sends answer back
        // Let me handle this: if I'm sharing, a viewer is connecting to me
        if (sharing && localStreamRef.current) {
          const pc = createPeerConnection(data.fromUserId, true);
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send("screen:answer", {
            targetUserId: data.fromUserId,
            answer: pc.localDescription,
          });
        }
      }),
      ws.on("screen:answer", async (data: { fromUserId: number; answer: RTCSessionDescriptionInit }) => {
        const pc = peerConnectionsRef.current.get(data.fromUserId);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      }),
      ws.on("screen:ice-candidate", async (data: { fromUserId: number; candidate: RTCIceCandidateInit }) => {
        const pc = peerConnectionsRef.current.get(data.fromUserId);
        if (pc && data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [ws, sharing, viewing]);

  function createPeerConnection(remoteUserId: number, isHost: boolean): RTCPeerConnection {
    // Clean up existing connection
    const existing = peerConnectionsRef.current.get(remoteUserId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionsRef.current.set(remoteUserId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.send("screen:ice-candidate", {
          targetUserId: remoteUserId,
          candidate: event.candidate,
        });
      }
    };

    if (isHost && localStreamRef.current) {
      // Add local screen tracks to the connection
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    if (!isHost) {
      // Viewer: receive remote tracks
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setConnecting(false);
        }
      };
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        pc.close();
        peerConnectionsRef.current.delete(remoteUserId);
      }
    };

    return pc;
  }

  const startSharing = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false,
      });
      localStreamRef.current = stream;
      setSharing(true);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Notify server
      ws.send("screen:start", {});

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
    } catch (err) {
      console.error("Failed to start screen share:", err);
    }
  }, [ws]);

  const stopSharing = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    // Close all peer connections
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    setSharing(false);
    ws.send("screen:stop", {});
  }, [ws]);

  const startViewing = useCallback(async (hostId: number) => {
    setViewing(hostId);
    setConnecting(true);

    // Create peer connection as viewer and send offer to host
    const pc = createPeerConnection(hostId, false);

    // Add a transceiver to receive video
    pc.addTransceiver("video", { direction: "recvonly" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send("screen:offer", {
      targetUserId: hostId,
      offer: pc.localDescription,
    });
  }, [ws]);

  const stopViewing = useCallback(() => {
    if (viewing) {
      const pc = peerConnectionsRef.current.get(viewing);
      if (pc) pc.close();
      peerConnectionsRef.current.delete(viewing);
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setViewing(null);
    setConnecting(false);
  }, [viewing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      peerConnectionsRef.current.forEach((pc) => pc.close());
    };
  }, []);

  const otherSessions = sessions.filter((s) => s.hostId !== user?.id);
  const mySession = sessions.find((s) => s.hostId === user?.id);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl" data-testid="page-screen-share">
      <div>
        <h1 className="text-xl font-semibold">Screen Share</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Share your screen with team members in real-time
        </p>
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {!sharing ? (
          <Button onClick={startSharing} disabled={!!viewing}>
            <Monitor className="h-4 w-4 mr-2" />
            Share My Screen
          </Button>
        ) : (
          <Button variant="destructive" onClick={stopSharing}>
            <MonitorOff className="h-4 w-4 mr-2" />
            Stop Sharing
          </Button>
        )}
      </div>

      {/* Active sharing preview (host view) */}
      {sharing && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Badge className="bg-red-500 text-white text-xs animate-pulse">LIVE</Badge>
              <span className="text-sm font-medium">You are sharing your screen</span>
            </div>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full max-h-[400px] rounded-lg border border-border bg-black object-contain"
            />
          </CardContent>
        </Card>
      )}

      {/* Viewing someone's screen */}
      {viewing && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-500 text-white text-xs">VIEWING</Badge>
                <span className="text-sm font-medium">
                  {sessions.find((s) => s.hostId === viewing)?.hostName || "Unknown"}'s screen
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={stopViewing}>
                <X className="h-3.5 w-3.5 mr-1" />
                Leave
              </Button>
            </div>
            {connecting && (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Connecting...
              </div>
            )}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full max-h-[500px] rounded-lg border border-border bg-black object-contain ${connecting ? "hidden" : ""}`}
            />
          </CardContent>
        </Card>
      )}

      {/* Available sessions */}
      {!viewing && (
        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Active Screen Shares
            {otherSessions.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{otherSessions.length}</Badge>
            )}
          </h2>
          {otherSessions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <ScreenShare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  No one is sharing their screen right now
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {otherSessions.map((session) => (
                <Card key={session.hostId} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Monitor className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{session.hostName}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-xs text-muted-foreground">Sharing now</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => startViewing(session.hostId)}
                        disabled={sharing}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        Watch
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
