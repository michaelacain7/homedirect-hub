import { useState, useEffect, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

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
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: KanbanSquare },
  { href: "/todos", label: "My To-Do", icon: CheckSquare },
  { href: "/files", label: "Files", icon: FolderOpen },
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
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sidebar-border">
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
