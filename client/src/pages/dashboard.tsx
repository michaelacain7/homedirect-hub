import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardList,
  Loader2,
  Target,
  Users,
  Milestone as MilestoneIcon,
  Megaphone,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Circle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { Announcement, Milestone } from "@shared/schema";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  "in-progress": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const statusIcons: Record<string, typeof Circle> = {
  pending: Circle,
  "in-progress": Clock,
  completed: CheckCircle2,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [annTitle, setAnnTitle] = useState("");
  const [annContent, setAnnContent] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalTasks: number;
    tasksByStatus: { todo: number; "in-progress": number; review: number; done: number };
    milestonesCompleted: number;
    milestonesTotal: number;
    teamMembers: number;
    onlineMembers: number;
  }>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: milestones, isLoading: milestonesLoading } = useQuery<
    Milestone[]
  >({
    queryKey: ["/api/milestones"],
  });

  const { data: announcements, isLoading: announcementsLoading } = useQuery<
    (Announcement & { user?: { displayName: string } })[]
  >({
    queryKey: ["/api/announcements"],
  });

  const createAnnouncement = useMutation({
    mutationFn: async (data: {
      title: string;
      content: string;
      pinned: number;
    }) => {
      await apiRequest("POST", "/api/announcements", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      setAnnouncementOpen(false);
      setAnnTitle("");
      setAnnContent("");
      toast({ title: "Announcement posted" });
    },
  });

  const deleteAnnouncement = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/announcements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
    },
  });

  const updateMilestone = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: number;
      status: string;
    }) => {
      await apiRequest("PUT", `/api/milestones/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const isAdmin = user?.role === "admin";
  const statCards = [
    {
      label: "Total Tasks",
      value: stats?.totalTasks ?? 0,
      icon: ClipboardList,
    },
    { label: "In Progress", value: stats?.tasksByStatus?.["in-progress"] ?? 0, icon: Target },
    { label: "Team Members", value: stats?.teamMembers ?? 0, icon: Users },
    {
      label: "Milestones Done",
      value: stats?.milestonesCompleted ?? 0,
      icon: MilestoneIcon,
    },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-greeting">
          {getGreeting()}, {user?.displayName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here's what's happening with your team today.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <Skeleton className="h-4 w-20 mb-3" />
                  <Skeleton className="h-8 w-12" />
                </CardContent>
              </Card>
            ))
          : statCards.map((s) => (
              <Card key={s.label}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {s.label}
                    </span>
                    <s.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p
                    className="text-xl font-bold"
                    data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/tasks">
          <Button variant="outline" size="sm" data-testid="button-create-task">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Task
          </Button>
        </Link>
        <Dialog open={announcementOpen} onOpenChange={setAnnouncementOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-post-announcement"
            >
              <Megaphone className="h-3.5 w-3.5 mr-1.5" /> Post Announcement
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Announcement</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createAnnouncement.mutate({
                  title: annTitle,
                  content: annContent,
                  pinned: 0,
                });
              }}
              className="space-y-4"
            >
              <Input
                placeholder="Title"
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                required
                data-testid="input-announcement-title"
              />
              <Textarea
                placeholder="Content..."
                value={annContent}
                onChange={(e) => setAnnContent(e.target.value)}
                required
                rows={4}
                data-testid="input-announcement-content"
              />
              <Button
                type="submit"
                disabled={createAnnouncement.isPending}
                data-testid="button-submit-announcement"
              >
                {createAnnouncement.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Post
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Link href="/files">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-upload-file"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Upload File
          </Button>
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Milestones */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Milestones
            </CardTitle>
          </CardHeader>
          <CardContent>
            {milestonesLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !milestones?.length ? (
              <p className="text-sm text-muted-foreground">
                No milestones yet.
              </p>
            ) : (
              <div className="space-y-0">
                {milestones.map((m, idx) => {
                  const StatusIcon = statusIcons[m.status] || Circle;
                  return (
                    <div
                      key={m.id}
                      className="flex gap-3 py-3"
                      data-testid={`milestone-${m.id}`}
                    >
                      <div className="flex flex-col items-center">
                        <StatusIcon
                          className={`h-5 w-5 shrink-0 ${
                            m.status === "completed"
                              ? "text-green-500"
                              : m.status === "in-progress"
                              ? "text-blue-500"
                              : "text-muted-foreground"
                          }`}
                        />
                        {idx < milestones.length - 1 && (
                          <div className="w-px flex-1 bg-border mt-1" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {m.title}
                          </span>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${statusColors[m.status]}`}
                          >
                            {m.status}
                          </Badge>
                        </div>
                        {m.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {m.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          {m.targetDate && (
                            <span className="text-[11px] text-muted-foreground">
                              Target:{" "}
                              {new Date(m.targetDate).toLocaleDateString()}
                            </span>
                          )}
                          {isAdmin && (
                            <Select
                              value={m.status}
                              onValueChange={(val) =>
                                updateMilestone.mutate({
                                  id: m.id,
                                  status: val,
                                })
                              }
                            >
                              <SelectTrigger className="h-6 text-[11px] w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">
                                  Pending
                                </SelectItem>
                                <SelectItem value="in-progress">
                                  In Progress
                                </SelectItem>
                                <SelectItem value="completed">
                                  Completed
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Announcements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Recent Announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {announcementsLoading ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : !announcements?.length ? (
              <p className="text-sm text-muted-foreground">
                No announcements yet.
              </p>
            ) : (
              <div className="space-y-3">
                {announcements.map((a) => (
                  <div
                    key={a.id}
                    className="p-3 rounded-lg bg-muted/50 border border-border/50"
                    data-testid={`announcement-${a.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                          {a.content}
                        </p>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteAnnouncement.mutate(a.id)}
                          data-testid={`button-delete-announcement-${a.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[11px] text-muted-foreground">
                        {(a as any).author?.displayName ?? "Team"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        ·
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {a.createdAt
                          ? formatDistanceToNow(new Date(a.createdAt), {
                              addSuffix: true,
                            })
                          : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
