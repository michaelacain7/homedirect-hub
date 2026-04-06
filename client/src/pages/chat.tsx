import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useWS } from "@/components/app-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Hash, Plus, Send, Loader2 } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { Channel, Message } from "@shared/schema";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function ChatPage() {
  const { user } = useAuth();
  const ws = useWS();
  const [activeChannel, setActiveChannel] = useState<number | null>(null);
  const [messageText, setMessageText] = useState("");
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(
    new Map()
  );
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelDesc, setChannelDesc] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingSentRef = useRef(0);

  const isAdmin = user?.role === "admin";

  const { data: channels, isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ["/api/channels"],
  });

  // Set default channel
  useEffect(() => {
    if (channels?.length && !activeChannel) {
      setActiveChannel(channels[0].id);
    }
  }, [channels, activeChannel]);

  const { data: messages, isLoading: messagesLoading } = useQuery<
    (Message & { user?: { displayName: string; avatarColor: string } })[]
  >({
    queryKey: ["/api/messages", activeChannel],
    enabled: !!activeChannel,
  });

  // Join channel via WS
  useEffect(() => {
    if (activeChannel) {
      ws.send("chat:join", { channelId: activeChannel });
    }
  }, [activeChannel, ws]);

  // Listen for new messages
  useEffect(() => {
    const unsub = ws.on("chat:message", (data: any) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/messages", activeChannel],
      });
    });
    return unsub;
  }, [ws, activeChannel]);

  // Listen for typing
  useEffect(() => {
    const unsub = ws.on("chat:typing", (data: any) => {
      if (data.userId !== user?.id) {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(data.userId, data.displayName || "Someone");
          return next;
        });
        // Clear after 3 seconds
        setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(data.userId);
            return next;
          });
        }, 3000);
      }
    });
    return unsub;
  }, [ws, user?.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(() => {
    if (!messageText.trim() || !activeChannel) return;
    ws.send("chat:message", {
      channelId: activeChannel,
      content: messageText.trim(),
    });
    setMessageText("");
  }, [messageText, activeChannel, ws]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Send typing indicator (debounced)
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000 && activeChannel) {
      ws.send("chat:typing", { channelId: activeChannel });
      lastTypingSentRef.current = now;
    }
  };

  const createChannel = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      await apiRequest("POST", "/api/channels", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setNewChannelOpen(false);
      setChannelName("");
      setChannelDesc("");
    },
  });

  const typingText =
    typingUsers.size > 0
      ? Array.from(typingUsers.values()).join(", ") + " is typing..."
      : null;

  return (
    <div className="flex h-full" data-testid="chat-page">
      {/* Channel list */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">Channels</span>
          {isAdmin && (
            <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  data-testid="button-new-channel"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Channel</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createChannel.mutate({
                      name: channelName,
                      description: channelDesc,
                    });
                  }}
                  className="space-y-3"
                >
                  <Input
                    placeholder="Channel name"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    required
                    data-testid="input-channel-name"
                  />
                  <Input
                    placeholder="Description (optional)"
                    value={channelDesc}
                    onChange={(e) => setChannelDesc(e.target.value)}
                    data-testid="input-channel-desc"
                  />
                  <Button
                    type="submit"
                    disabled={createChannel.isPending}
                    data-testid="button-submit-channel"
                  >
                    Create
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {channelsLoading
            ? [1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full mb-1" />
              ))
            : channels?.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannel(ch.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    ch.id === activeChannel
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  data-testid={`channel-${ch.id}`}
                >
                  <Hash className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        {activeChannel && channels && (
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {channels.find((c) => c.id === activeChannel)?.name}
              </span>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messagesLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : !messages?.length ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">
                No messages yet. Start the conversation!
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className="flex gap-3"
                data-testid={`message-${msg.id}`}
              >
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                  style={{
                    backgroundColor:
                      (msg as any).user?.avatarColor || "#4F6BED",
                  }}
                >
                  {getInitials(
                    (msg as any).user?.displayName || "?"
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">
                      {(msg as any).user?.displayName || "Unknown"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {msg.createdAt
                        ? format(new Date(msg.createdAt), "h:mm a")
                        : ""}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator */}
        {typingText && (
          <div className="px-4 pb-1">
            <p className="text-xs text-muted-foreground italic">
              {typingText}
            </p>
          </div>
        )}

        {/* Input */}
        {activeChannel && (
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Input
                placeholder="Type a message..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1"
                data-testid="input-chat-message"
              />
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={!messageText.trim()}
                data-testid="button-send-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
