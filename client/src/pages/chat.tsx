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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Hash, Plus, Send, Loader2, AtSign, SmilePlus, Search, X, WifiOff, ImagePlus } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { Channel, Message, User, MessageReaction } from "@shared/schema";

// Common reaction emojis
const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "✅", "💯"];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Image URL pattern ────────────────────────────
// Matches both old path-based URLs and new data: URLs
const IMAGE_MARKER_REGEX = /!\[image\]\(((?:\/api\/chat\/images\/[\w\-.]+|data:[^)]+))\)/g;

// ── Mention + Image helpers ─────────────────────
/** Render message content with highlighted @mentions and inline images */
function RenderContent({ content, teamMembers, onImageClick }: { content: string; teamMembers: SafeUser[]; onImageClick?: (src: string) => void }) {
  const names = useMemo(
    () => teamMembers.map((u) => u.displayName).sort((a, b) => b.length - a.length),
    [teamMembers]
  );

  const rendered = useMemo(() => {
    // First split on image markers
    const segments: { type: "text" | "image"; value: string }[] = [];
    let lastIdx = 0;
    const imgRegex = /!\[image\]\(((?:\/api\/chat\/images\/[\w\-.]+|data:[^)]+))\)/g;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(content)) !== null) {
      if (imgMatch.index > lastIdx) {
        segments.push({ type: "text", value: content.slice(lastIdx, imgMatch.index) });
      }
      segments.push({ type: "image", value: imgMatch[1] });
      lastIdx = imgMatch.index + imgMatch[0].length;
    }
    if (lastIdx < content.length) {
      segments.push({ type: "text", value: content.slice(lastIdx) });
    }

    // For text segments, apply mention highlighting
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const mentionRegex = names.length
      ? new RegExp(`(@(?:${escaped.join("|")}))(\\b|\\s|$)`, "gi")
      : null;

    function renderText(text: string, baseKey: number) {
      if (!mentionRegex) return <Fragment key={baseKey}>{text}</Fragment>;
      const parts: { text: string; isMention: boolean }[] = [];
      let idx = 0;
      let m: RegExpExecArray | null;
      mentionRegex.lastIndex = 0;
      while ((m = mentionRegex.exec(text)) !== null) {
        if (m.index > idx) parts.push({ text: text.slice(idx, m.index), isMention: false });
        parts.push({ text: m[1], isMention: true });
        idx = m.index + m[1].length;
      }
      if (idx < text.length) parts.push({ text: text.slice(idx), isMention: false });
      return (
        <Fragment key={baseKey}>
          {parts.map((p, j) =>
            p.isMention ? (
              <span key={j} className="bg-primary/15 text-primary font-medium rounded px-0.5">{p.text}</span>
            ) : (
              <Fragment key={j}>{p.text}</Fragment>
            )
          )}
        </Fragment>
      );
    }

    return segments.map((seg, i) => {
      if (seg.type === "image") {
        return (
          <button key={i} type="button" onClick={() => onImageClick?.(seg.value)} className="block my-1 text-left">
            <img
              src={seg.value}
              alt="Shared image"
              className="max-w-xs max-h-64 rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </button>
        );
      }
      return renderText(seg.value, i);
    });
  }, [content, names]);

  return <>{rendered}</>;
}

type SafeUser = Omit<User, "password">;

export default function ChatPage() {
  const { user } = useAuth();
  const ws = useWS();
  const { toast } = useToast();
  const [activeChannel, setActiveChannel] = useState<number | null>(null);
  const [messageText, setMessageText] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
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

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1); // cursor position of the @

  // Image paste/upload state
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: channels, isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ["/api/channels"],
  });

  // Chat search query
  const { data: searchResults } = useQuery<
    { id: number; channelId: number; userId: number; content: string; createdAt: string; user?: { displayName: string; avatarColor: string }; channelName?: string }[]
  >({
    queryKey: ["/api/messages/search", searchQuery],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/messages/search?q=${encodeURIComponent(searchQuery)}`);
      return res.json();
    },
    enabled: searchQuery.length >= 2,
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
    (Message & { user?: { displayName: string; avatarColor: string }; reactions?: MessageReaction[] })[]
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

  // Listen for reaction updates
  useEffect(() => {
    const unsub = ws.on("chat:reaction", (data: any) => {
      // Optimistically update the cached messages with new reactions
      queryClient.setQueryData(
        ["/api/messages", activeChannel],
        (old: any[] | undefined) => {
          if (!old) return old;
          return old.map((msg: any) =>
            msg.id === data.messageId ? { ...msg, reactions: data.reactions } : msg
          );
        }
      );
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

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await fetch("/api/chat/upload-image", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url;
    } catch {
      return null;
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if ((!messageText.trim() && !pendingImage) || !activeChannel) return;

    let content = messageText.trim();

    // If there's a pending image, upload it first
    if (pendingImage) {
      setImageUploading(true);
      const url = await uploadImage(pendingImage.file);
      setImageUploading(false);
      if (!url) {
        toast({ title: "Failed to upload image", variant: "destructive" });
        return;
      }
      const imageMarkdown = `![image](${url})`;
      content = content ? `${content}\n${imageMarkdown}` : imageMarkdown;
      setPendingImage(null);
    }

    if (!content) return;

    const sent = ws.send("chat:message", {
      channelId: activeChannel,
      content,
    });
    if (!sent) {
      toast({
        title: "Message not sent",
        description: "Connection lost. Reconnecting — please try again in a moment.",
        variant: "destructive",
      });
      return;
    }
    setMessageText("");
    setMentionQuery(null);
    setHighlightMsgId(null);
    deepLinkActive.current = false;
  }, [messageText, activeChannel, ws, toast, pendingImage, uploadImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const preview = URL.createObjectURL(file);
          setPendingImage({ file, preview });
        }
        return;
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const preview = URL.createObjectURL(file);
      setPendingImage({ file, preview });
    }
    e.target.value = "";
  }, []);

  const toggleReaction = useCallback((messageId: number, emoji: string) => {
    ws.send("chat:reaction", { messageId, emoji });
  }, [ws]);

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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  {channels.find((c) => c.id === activeChannel)?.name}
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchOpen(!searchOpen);
                  if (!searchOpen) {
                    setTimeout(() => searchInputRef.current?.focus(), 100);
                  } else {
                    setSearchQuery("");
                  }
                }}
                className={`p-1.5 rounded-md transition-colors ${searchOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                data-testid="button-toggle-chat-search"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Chat search panel */}
        {searchOpen && (
          <div className="border-b border-border bg-muted/30 px-4 py-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Search messages across all channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-8 text-xs"
                data-testid="input-search-chat"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-chat-search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searchQuery.length >= 2 && searchResults && (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">No messages found</p>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</p>
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        className="w-full text-left flex gap-2 p-2 rounded-md hover:bg-muted transition-colors"
                        onClick={() => {
                          // Navigate to the channel and highlight the message
                          setActiveChannel(result.channelId);
                          setHighlightMsgId(result.id);
                          hasScrolledToMsg.current = false;
                          deepLinkActive.current = true;
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                        data-testid={`search-result-${result.id}`}
                      >
                        <div
                          className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0 mt-0.5"
                          style={{ backgroundColor: result.user?.avatarColor || '#4F6BED' }}
                        >
                          {getInitials(result.user?.displayName || '?')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium">{result.user?.displayName || 'Unknown'}</span>
                            <span className="text-[10px] text-muted-foreground">in #{result.channelName}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{result.content}</p>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Connection lost banner */}
        {!ws.isConnected && (
          <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2">
            <WifiOff className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs text-destructive font-medium">Connection lost. Reconnecting...</span>
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
            messages.map((msg) => {
              // Group reactions: { emoji: string, count: number, userIds: number[] }
              const reactionGroups = (msg.reactions || []).reduce<Record<string, { emoji: string; count: number; userIds: number[] }>>((acc, r) => {
                const key = r.emoji;
                if (!acc[key]) acc[key] = { emoji: key, count: 0, userIds: [] };
                acc[key].count++;
                acc[key].userIds.push(r.userId ?? (r as any).user_id);
                return acc;
              }, {});
              const groupedReactions = Object.values(reactionGroups);

              return (
                <div
                  key={msg.id}
                  className="group flex gap-3 rounded-md px-2 py-1.5 -mx-2 transition-colors relative"
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
                  <div className="min-w-0 flex-1">
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
                      <RenderContent content={msg.content} teamMembers={teamMembers} onImageClick={setLightboxSrc} />
                    </p>

                    {/* Reaction chips */}
                    {groupedReactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {groupedReactions.map((rg) => {
                          const isMine = user ? rg.userIds.includes(user.id) : false;
                          const reactorNames = rg.userIds
                            .map((uid) => {
                              if (uid === user?.id) return "You";
                              const member = teamMembers.find((m) => m.id === uid);
                              return member?.displayName || "Unknown";
                            })
                            .join(", ");
                          return (
                            <Tooltip key={rg.emoji}>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => toggleReaction(msg.id, rg.emoji)}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                                    isMine
                                      ? "bg-primary/15 border-primary/30 text-primary"
                                      : "bg-muted/50 border-border hover:bg-muted"
                                  }`}
                                  data-testid={`reaction-${msg.id}-${rg.emoji}`}
                                >
                                  <span>{rg.emoji}</span>
                                  <span className="font-medium">{rg.count}</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {reactorNames}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Emoji picker button (visible on hover) */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                        data-testid={`reaction-picker-${msg.id}`}
                      >
                        <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="end" className="w-auto p-1.5">
                      <div className="flex gap-0.5">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(msg.id, emoji)}
                            className="hover:bg-muted rounded p-1 text-lg transition-transform hover:scale-125"
                            data-testid={`emoji-pick-${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })
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

            {/* Image preview */}
            {pendingImage && (
              <div className="relative inline-block mb-2">
                <img
                  src={pendingImage.preview}
                  alt="Preview"
                  className="max-h-32 rounded-lg border border-border"
                />
                <button
                  onClick={() => { URL.revokeObjectURL(pendingImage.preview); setPendingImage(null); }}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center text-xs hover:bg-destructive/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
                title="Upload image"
              >
                <ImagePlus className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Input
                ref={inputRef}
                placeholder="Type a message... Paste or attach images"
                value={messageText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="flex-1"
                data-testid="input-chat-message"
              />
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={(!messageText.trim() && !pendingImage) || imageUploading}
                data-testid="button-send-message"
              >
                {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Image lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxSrc}
            alt="Full size"
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

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
