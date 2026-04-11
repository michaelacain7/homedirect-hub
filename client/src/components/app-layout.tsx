import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Notification } from "@shared/schema";
import {
  LayoutDashboard,
  MessageSquare,
  KanbanSquare,
  CheckSquare,
  FolderOpen,
  Users,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
  Bell,
  CheckCheck,
  MessageCircle,
  ListTodo,
  CalendarDays,
  Handshake,
  BarChart3,
  Network,
  Bot,
  BookOpen,
} from "lucide-react";

// ── Notification Bell Component ──────────────────
function NotificationBell() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const prevCountRef = useRef(0);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 30000,
  });

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: open,
  });

  const unreadCount = unreadData?.count ?? 0;

  // Play notification sound on new notifications
  useEffect(() => {
    if (unreadCount > prevCountRef.current && prevCountRef.current >= 0) {
      // Use AudioContext to play a short notification beep
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = "sine";
        gain.gain.value = 0.1;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
      } catch {
        // Audio not available, ignore
      }
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount]);

  const markAsRead = useCallback(async (id: number) => {
    await apiRequest("PUT", `/api/notifications/${id}/read`);
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
  }, []);

  const markAllRead = useCallback(async () => {
    await apiRequest("POST", "/api/notifications/mark-all-read");
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
  }, []);

  const handleClick = useCallback((notif: Notification) => {
    if (!notif.read) markAsRead(notif.id);
    if (notif.linkTo) {
      setLocation(notif.linkTo);
      setOpen(false);
    }
  }, [markAsRead, setLocation]);

  function getIcon(type: string) {
    switch (type) {
      case "chat_message":
        return <MessageCircle className="h-3.5 w-3.5 text-blue-400" />;
      case "chat_mention":
        return <MessageCircle className="h-3.5 w-3.5 text-orange-400" />;
      case "task_assigned":
        return <ListTodo className="h-3.5 w-3.5 text-amber-400" />;
      case "meeting_request":
      case "meeting_accepted":
      case "meeting_declined":
      case "meeting_new_time":
        return <Handshake className="h-3.5 w-3.5 text-indigo-400" />;
      default:
        return <Bell className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-1.5 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          data-testid="button-notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-80 max-h-[80vh] p-0 bg-popover border border-border shadow-lg rounded-lg overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>
        <ScrollArea className="flex-1 overflow-auto">
          {isLoading && open ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.slice(0, 50).map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={`w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex gap-3 ${
                    !notif.read ? "bg-primary/5" : ""
                  }`}
                  data-testid={`notification-item-${notif.id}`}
                >
                  <div className="mt-0.5 shrink-0">{getIcon(notif.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${!notif.read ? "font-semibold" : "font-normal text-muted-foreground"}`}>
                        {notif.title}
                      </span>
                      {!notif.read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {notif.body}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {timeAgo(notif.createdAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

type WSContext = {
  send: (event: string, data: any) => void;
  on: (event: string, handler: (data: any) => void) => () => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WSContext>({
  send: () => {},
  on: () => () => {},
  isConnected: false,
});

export function useWS() {
  return useContext(WebSocketContext);
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ai", label: "AI Assistant", icon: Bot },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: KanbanSquare },
  { href: "/tracking", label: "Tracking", icon: BarChart3 },
  { href: "/todos", label: "My To-Do", icon: CheckSquare },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/meetings", label: "Meetings", icon: Handshake },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/org-chart", label: "Org Chart", icon: Network },
  { href: "/team", label: "Team", icon: Users },
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logoutMutation } = useAuth();
  const ws = useWebSocket(user?.id ?? null);
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  return (
    <WebSocketContext.Provider value={ws}>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar - always dark */}
        <aside
          className={`fixed md:static inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-transform md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Logo + Notification Bell */}
          <div className="flex items-center justify-between px-5 py-5 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5">
              <svg
                width="32"
                height="32"
                viewBox="0 0 40 40"
                fill="none"
                aria-label="HomeDirectAI Logo"
              >
                <rect
                  width="40"
                  height="40"
                  rx="8"
                  fill="hsl(230 80% 62%)"
                />
                <path
                  d="M20 10L10 18V30H16V24H24V30H30V18L20 10Z"
                  fill="white"
                />
                <circle cx="26" cy="14" r="3" fill="white" opacity="0.7" />
              </svg>
              <span className="font-semibold text-sm text-sidebar-foreground">
                HomeDirectAI HQ
              </span>
            </div>
            <NotificationBell />
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const active = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? "bg-sidebar-accent text-sidebar-primary"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Bottom: theme toggle + user */}
          <div className="border-t border-sidebar-border px-3 py-3 space-y-3">
            <button
              onClick={() => setDark(!dark)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors w-full rounded-md hover:bg-sidebar-accent/50"
              data-testid="button-toggle-theme"
            >
              {dark ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
              {dark ? "Light Mode" : "Dark Mode"}
            </button>

            {user && (
              <div className="flex items-center gap-2.5 px-2">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                  style={{ backgroundColor: user.avatarColor }}
                >
                  {getInitials(user.displayName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-sidebar-foreground">
                    {user.displayName}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  onClick={() => logoutMutation.mutate()}
                  data-testid="button-logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile header */}
          <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSidebarOpen(true)}
              data-testid="button-toggle-sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-semibold text-sm">HomeDirectAI HQ</span>
          </div>

          <div className="flex-1 overflow-y-auto bg-background">
            {children}
          </div>
        </main>
      </div>
    </WebSocketContext.Provider>
  );
}
