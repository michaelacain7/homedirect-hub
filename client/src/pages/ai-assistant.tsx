import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { AiConversation, AiMessage } from "@shared/schema";
import {
  Bot,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
  Sparkles,
  AlertCircle,
} from "lucide-react";

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function AIAssistantPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeConv, setActiveConv] = useState<number | null>(null);
  const [inputText, setInputText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check AI status
  const { data: aiStatus } = useQuery<{ aiEnabled: boolean; vectorStoreEnabled: boolean }>({
    queryKey: ["/api/ai/status"],
  });

  // Conversations list
  const { data: conversations = [] } = useQuery<AiConversation[]>({
    queryKey: ["/api/ai/conversations"],
  });

  // Messages for active conversation
  const { data: messages = [], isLoading: messagesLoading } = useQuery<AiMessage[]>({
    queryKey: ["/api/ai/conversations", activeConv, "messages"],
    queryFn: async () => {
      if (!activeConv) return [];
      const res = await apiRequest("GET", `/api/ai/conversations/${activeConv}/messages`);
      return res.json();
    },
    enabled: !!activeConv,
  });

  const createConv = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/conversations", { title: "New Conversation" });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
      setActiveConv(data.id);
    },
  });

  const deleteConv = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
      setActiveConv(null);
    },
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  // Send message with streaming
  const sendMessage = useCallback(async () => {
    if (!inputText.trim() || streaming) return;
    const text = inputText.trim();
    setInputText("");
    setStreaming(true);
    setStreamContent("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId: activeConv,
          message: text,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        toast({ title: err.message || "AI error", variant: "destructive" });
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) { setStreaming(false); return; }

      const decoder = new TextDecoder();
      let accumulated = "";
      let newConvId = activeConv;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.type === "meta" && data.conversationId) {
              newConvId = data.conversationId;
              if (!activeConv) setActiveConv(newConvId);
            } else if (data.type === "chunk") {
              accumulated += data.content;
              setStreamContent(accumulated);
            } else if (data.type === "done") {
              // Refresh data
              queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
              if (newConvId) {
                queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations", newConvId, "messages"] });
              }
            } else if (data.type === "error") {
              toast({ title: data.message || "AI error", variant: "destructive" });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      toast({ title: "Failed to reach AI", variant: "destructive" });
    }

    setStreaming(false);
    setStreamContent("");
  }, [inputText, activeConv, streaming, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const allMessages = [
    ...messages,
    // Show the user's pending message during streaming
    ...(streaming && inputText === "" ? [] : []),
  ];

  if (!aiStatus?.aiEnabled) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-lg font-semibold mb-2">AI Assistant Not Configured</h2>
          <p className="text-sm text-muted-foreground mb-4">
            To enable the AI assistant, set the following environment variables on your server:
          </p>
          <div className="text-left bg-muted rounded-lg p-4 text-xs font-mono space-y-1">
            <p>AI_PROVIDER=together</p>
            <p>TOGETHER_API_KEY=your-key-here</p>
            <p className="text-muted-foreground"># Optional: Supabase for RAG</p>
            <p>SUPABASE_URL=https://your-project.supabase.co</p>
            <p>SUPABASE_SERVICE_KEY=your-key</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full" data-testid="page-ai-assistant">
      {/* Conversation sidebar */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">AI Chats</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { setActiveConv(null); setInputText(""); }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {conversations.map((conv) => (
              <div key={conv.id} className="group flex items-center">
                <button
                  onClick={() => setActiveConv(conv.id)}
                  className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors text-left truncate ${
                    conv.id === activeConv
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{conv.title}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConv.mutate(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No conversations yet
              </p>
            )}
          </div>
        </ScrollArea>
        {aiStatus?.vectorStoreEnabled && (
          <div className="p-2 border-t border-border">
            <div className="flex items-center gap-1.5 px-2 text-[10px] text-green-600">
              <Sparkles className="h-3 w-3" />
              RAG enabled
            </div>
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">HomeDirectAI Assistant</span>
          <span className="text-[11px] text-muted-foreground ml-1">
            Llama 3.3 via Together AI
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeConv && messages.length === 0 && !streaming && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-sm">
                <Bot className="h-14 w-14 mx-auto mb-4 text-primary/30" />
                <h3 className="text-lg font-semibold mb-2">HomeDirectAI Assistant</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Ask me about your tasks, project status, company files, or anything about real estate tech and startup operations.
                </p>
                <div className="grid grid-cols-1 gap-2 text-left">
                  {[
                    "What tasks are assigned to me?",
                    "Summarize our current project milestones",
                    "What are the Florida real estate licensing requirements?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInputText(q); inputRef.current?.focus(); }}
                      className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messagesLoading && activeConv ? (
            <div className="text-center py-8">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : (
            allMessages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "" : ""}`}>
                {msg.role === "user" ? (
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                    style={{ backgroundColor: user?.avatarColor || "#4F6BED" }}
                  >
                    {getInitials(user?.displayName || "?")}
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full flex items-center justify-center bg-primary/10 shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold">
                    {msg.role === "user" ? user?.displayName || "You" : "AI Assistant"}
                  </span>
                  <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words mt-0.5 prose prose-sm max-w-none dark:prose-invert">
                    {msg.content}
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Streaming response */}
          {streaming && streamContent && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full flex items-center justify-center bg-primary/10 shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold">AI Assistant</span>
                <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words mt-0.5">
                  {streamContent}
                  <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse ml-0.5" />
                </div>
              </div>
            </div>
          )}

          {streaming && !streamContent && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full flex items-center justify-center bg-primary/10 shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <span className="text-xs font-semibold">AI Assistant</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Ask the AI assistant..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              className="flex-1"
              data-testid="input-ai-message"
            />
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!inputText.trim() || streaming}
              data-testid="button-send-ai"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
