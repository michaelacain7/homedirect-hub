import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useWS } from "@/components/app-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Hash, Plus, Send, Loader2, AtSign } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { Channel, Message, User } from "@shared/schema";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Mention helpers ──────────────────────────────
/** Render message content with highlighted @mentions */
function RenderContent({ content, teamMembers }: { content: string; teamMembers: SafeUser[] }) {
  // Build a sorted list of display names (longest first to match greedily)
  const names = useMemo(
    () => teamMembers.map((u) => u.displayName).sort((a, b) => b.length - a.length),
    [teamMembers]
  );

  const parts = useMemo(() => {
    if (!names.length) return [{ text: content, isMention: false }];

    // Build regex that matches @DisplayName for any known user
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`(@(?:${escaped.join("|")}))(\\b|\\s|$)`, "gi");

    const result: { text: string; isMention: boolean }[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIdx) {
        result.push({ text: content.slice(lastIdx, match.index), isMention: false });
      }
      result.push({ text: match[1], isMention: true });
      lastIdx = match.index + match[1].length;
    }
    if (lastIdx < content.length) {
      result.push({ text: content.slice(lastIdx), isMention: false });
    }
    return result;
  }, [content, names]);

  return (
    <>
      {parts.map((p, i) =>
        p.isMention ? (
          <span
            key={i}
            className="bg-primary/15 text-primary font-medium rounded px-0.5"
          >
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}

type SafeUser = Omit<User, "password">;

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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingSentRef = useRef(0);
  const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);
  const hasScrolledToMsg = useRef(false);
  const deepLinkActive = useRef(false); // blocks auto-scroll while deep-link is pending

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1); // cursor position of the @

  const { data: channels, isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ["/api/channels"],
  });

  // Team members for @mention
  const { data: teamMembers = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/team"],
  });

  // Parse URL params for deep-link from notification
  // wouter hash routing may put query params in either the hash or the regular search
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const searchParams = new URLSearchParams(window.location.search);
    const channelParam = hashParams.get("channel") || searchParams.get("channel");
    const msgIdParam = hashParams.get("msgId") || searchParams.get("msgId");
    if (channelParam) {
      setActiveChannel(Number(channelParam));
    }
    if (msgIdParam) {
      setHighlightMsgId(Number(msgIdParam));
      hasScrolledToMsg.current = false;
      deepLinkActive.current = true;
    }
    // Clean up URL params after reading them
    if (channelParam || msgIdParam) {
      window.history.replaceState(null, "", window.location.pathname + "#/chat");
    }
  }, []);

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

  // Scroll to highlighted message from notification deep-link
  useEffect(() => {
    if (highlightMsgId && messages && !hasScrolledToMsg.current) {
      const el = document.querySelector(`[data-testid="message-${highlightMsgId}"]`);
      if (el) {
        hasScrolledToMsg.current = true;
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("highlight-flash");
          setTimeout(() => el.classList.remove("highlight-flash"), 2500);
        }, 300);
      }
    }
  }, [highlightMsgId, messages]);

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

  // Auto-scroll only when there is no active deep-link
  useEffect(() => {
    if (!deepLinkActive.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMessage = useCallback(() => {
    if (!messageText.trim() || !activeChannel) return;
    ws.send("chat:message", {
      channelId: activeChannel,
      content: messageText.trim(),
    });
    setMessageText("");
    setMentionQuery(null);
    setHighlightMsgId(null);
    deepLinkActive.current = false; // re-enable auto-scroll after user interacts
  }, [messageText, activeChannel, ws]);

  // @mention autocomplete filtering
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return teamMembers
      .filter((m) => m.id !== user?.id && m.displayName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, teamMembers, user?.id]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setMessageText(val);

    // Detect @mention trigger
    const cursorPos = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@([A-Za-z ]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionStart(cursorPos - atMatch[0].length);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(member: SafeUser) {
    const before = messageText.slice(0, mentionStart);
    const after = messageText.slice(
      mentionStart + 1 + (mentionQuery?.length ?? 0)
    );
    const newText = `${before}@${member.displayName} ${after}`;
    setMessageText(newText);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle @mention autocomplete navigation
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

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
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
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
                className="flex gap-3 rounded-md px-2 py-1.5 -mx-2 transition-colors"
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
                    <RenderContent content={msg.content} teamMembers={teamMembers} />
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

        {/* Input with @mention autocomplete */}
        {activeChannel && (
          <div className="p-4 border-t border-border relative">
            {/* @mention autocomplete dropdown */}
            {mentionQuery !== null && mentionCandidates.length > 0 && (
              <div className="absolute bottom-full left-4 right-4 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
                {mentionCandidates.map((member, idx) => (
                  <button
                    key={member.id}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent input blur
                      insertMention(member);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                      idx === mentionIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    }`}
                    data-testid={`mention-option-${member.id}`}
                  >
                    <div
                      className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0"
                      style={{ backgroundColor: member.avatarColor }}
                    >
                      {getInitials(member.displayName)}
                    </div>
                    <span className="font-medium">{member.displayName}</span>
                    <AtSign className="h-3 w-3 text-muted-foreground ml-auto" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                ref={inputRef}
                placeholder="Type a message... Use @ to mention someone"
                value={messageText}
                onChange={handleInputChange}
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

      {/* CSS for highlight flash animation */}
      <style>{`
        @keyframes highlightFlash {
          0% { background-color: hsl(var(--primary) / 0.2); }
          100% { background-color: transparent; }
        }
        .highlight-flash {
          animation: highlightFlash 2.5s ease-out;
        }
      `}</style>
    </div>
  );
}
