import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import AppLayout from "@/components/app-layout";
import AuthPage from "@/pages/auth";
import DashboardPage from "@/pages/dashboard";
import ChatPage from "@/pages/chat";
import TasksPage from "@/pages/tasks";
import TodosPage from "@/pages/todos";
import FilesPage from "@/pages/files";
import TeamPage from "@/pages/team";
import CalendarPage from "@/pages/calendar";
import MeetingsPage from "@/pages/meetings";
import TaskTrackingPage from "@/pages/task-tracking";
import OrgChartPage from "@/pages/org-chart";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

function AppRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/chat" component={ChatPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/tracking" component={TaskTrackingPage} />
        <Route path="/todos" component={TodosPage} />
        <Route path="/files" component={FilesPage} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/meetings" component={MeetingsPage} />
        <Route path="/org-chart" component={OrgChartPage} />
        <Route path="/team" component={TeamPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
