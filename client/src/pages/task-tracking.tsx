import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  AlertCircle,
  ListTodo,
  Search as SearchIcon,
  Users,
} from "lucide-react";
import type { Task, User } from "@shared/schema";

type SafeUser = { id: number; displayName: string; avatarColor: string };
type TaskWithUsers = Task & { assignedUsers?: SafeUser[]; createdByUser?: any };

const STATUS_ORDER = ["todo", "in-progress", "review", "done"] as const;
const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};
const STATUS_COLORS: Record<string, string> = {
  todo: "bg-gray-400",
  "in-progress": "bg-blue-500",
  review: "bg-amber-500",
  done: "bg-green-500",
};
const STATUS_TEXT_COLORS: Record<string, string> = {
  todo: "text-gray-600 dark:text-gray-400",
  "in-progress": "text-blue-600 dark:text-blue-400",
  review: "text-amber-600 dark:text-amber-400",
  done: "text-green-600 dark:text-green-400",
};

const PHASE_LABELS: Record<string, string> = {
  "phase-1": "Phase 1",
  "phase-2": "Phase 2",
  "phase-3": "Phase 3",
};

const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function parseAssignedIds(assignedTo: any): number[] {
  try { return JSON.parse(assignedTo as string); } catch { return []; }
}

export default function TaskTrackingPage() {
  const [filterPhase, setFilterPhase] = useState("all");
  const [filterMember, setFilterMember] = useState("all");

  const { data: tasks = [], isLoading } = useQuery<TaskWithUsers[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: team = [] } = useQuery<any[]>({
    queryKey: ["/api/team"],
  });

  // Filter tasks by phase
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterPhase !== "all" && t.phase !== filterPhase) return false;
      return true;
    });
  }, [tasks, filterPhase]);

  // Build per-member stats
  const memberStats = useMemo(() => {
    const map = new Map<number, { user: SafeUser; todo: number; inProgress: number; review: number; done: number; total: number; tasks: TaskWithUsers[] }>();

    for (const member of team) {
      map.set(member.id, {
        user: { id: member.id, displayName: member.displayName, avatarColor: member.avatarColor },
        todo: 0, inProgress: 0, review: 0, done: 0, total: 0, tasks: [],
      });
    }

    for (const task of filtered) {
      const ids = parseAssignedIds(task.assignedTo);
      for (const uid of ids) {
        let entry = map.get(uid);
        if (!entry) continue;
        entry.total++;
        entry.tasks.push(task);
        if (task.status === "todo") entry.todo++;
        else if (task.status === "in-progress") entry.inProgress++;
        else if (task.status === "review") entry.review++;
        else if (task.status === "done") entry.done++;
      }
    }

    // Also track unassigned
    const unassigned = filtered.filter((t) => parseAssignedIds(t.assignedTo).length === 0);

    return {
      members: Array.from(map.values()).filter((m) => m.total > 0 || filterMember === m.user.id.toString()),
      unassigned,
    };
  }, [filtered, team, filterMember]);

  // Overall stats
  const overallStats = useMemo(() => {
    const todo = filtered.filter((t) => t.status === "todo").length;
    const inProgress = filtered.filter((t) => t.status === "in-progress").length;
    const review = filtered.filter((t) => t.status === "review").length;
    const done = filtered.filter((t) => t.status === "done").length;
    const total = filtered.length;
    return { todo, inProgress, review, done, total };
  }, [filtered]);

  const completionPct = overallStats.total > 0
    ? Math.round((overallStats.done / overallStats.total) * 100) : 0;

  // Filter members list
  const displayMembers = filterMember === "all"
    ? memberStats.members
    : memberStats.members.filter((m) => m.user.id.toString() === filterMember);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl" data-testid="page-task-tracking">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Task Tracking</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track task progress per team member
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filterPhase} onValueChange={setFilterPhase}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Phase" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Phases</SelectItem>
              <SelectItem value="phase-1">Phase 1</SelectItem>
              <SelectItem value="phase-2">Phase 2</SelectItem>
              <SelectItem value="phase-3">Phase 3</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterMember} onValueChange={setFilterMember}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Members</SelectItem>
              {team.map((m: any) => (
                <SelectItem key={m.id} value={m.id.toString()}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Overall Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <ListTodo className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold">{overallStats.total}</p>
            <p className="text-[11px] text-muted-foreground">Total Tasks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="h-5 w-5 mx-auto mb-1 rounded-full bg-gray-400" />
            <p className="text-2xl font-bold">{overallStats.todo}</p>
            <p className="text-[11px] text-muted-foreground">To Do</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="h-5 w-5 mx-auto mb-1 text-blue-500" />
            <p className="text-2xl font-bold">{overallStats.inProgress}</p>
            <p className="text-[11px] text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <SearchIcon className="h-5 w-5 mx-auto mb-1 text-amber-500" />
            <p className="text-2xl font-bold">{overallStats.review}</p>
            <p className="text-[11px] text-muted-foreground">Review</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-500" />
            <p className="text-2xl font-bold">{overallStats.done}</p>
            <p className="text-[11px] text-muted-foreground">Done</p>
          </CardContent>
        </Card>
      </div>

      {/* Overall Completion Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Completion</span>
            <span className="text-sm font-bold text-green-600">{completionPct}%</span>
          </div>
          <Progress value={completionPct} className="h-3" />
          <div className="flex gap-4 mt-3">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className={`h-2.5 w-2.5 rounded-full ${STATUS_COLORS[s]}`} />
                {STATUS_LABELS[s]}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Per-Member Breakdown */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : displayMembers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No tasks assigned{filterPhase !== "all" ? ` in ${PHASE_LABELS[filterPhase]}` : ""}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayMembers
            .sort((a, b) => b.total - a.total)
            .map((member) => {
              const pct = member.total > 0 ? Math.round((member.done / member.total) * 100) : 0;
              return (
                <Card key={member.user.id}>
                  <CardContent className="p-4">
                    {/* Member Header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                        style={{ backgroundColor: member.user.avatarColor }}
                      >
                        {getInitials(member.user.displayName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">{member.user.displayName}</h3>
                          <span className="text-xs text-muted-foreground">
                            {member.done}/{member.total} done ({pct}%)
                          </span>
                        </div>
                        <Progress value={pct} className="h-2 mt-1" />
                      </div>
                    </div>

                    {/* Status Breakdown Bar */}
                    <div className="flex h-6 rounded-full overflow-hidden bg-muted mb-3">
                      {member.todo > 0 && (
                        <div
                          className="bg-gray-400 flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ width: `${(member.todo / member.total) * 100}%` }}
                          title={`To Do: ${member.todo}`}
                        >
                          {member.todo}
                        </div>
                      )}
                      {member.inProgress > 0 && (
                        <div
                          className="bg-blue-500 flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ width: `${(member.inProgress / member.total) * 100}%` }}
                          title={`In Progress: ${member.inProgress}`}
                        >
                          {member.inProgress}
                        </div>
                      )}
                      {member.review > 0 && (
                        <div
                          className="bg-amber-500 flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ width: `${(member.review / member.total) * 100}%` }}
                          title={`Review: ${member.review}`}
                        >
                          {member.review}
                        </div>
                      )}
                      {member.done > 0 && (
                        <div
                          className="bg-green-500 flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ width: `${(member.done / member.total) * 100}%` }}
                          title={`Done: ${member.done}`}
                        >
                          {member.done}
                        </div>
                      )}
                    </div>

                    {/* Status counts row */}
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {STATUS_ORDER.map((s) => {
                        const count = s === "todo" ? member.todo : s === "in-progress" ? member.inProgress : s === "review" ? member.review : member.done;
                        return (
                          <div key={s} className="text-center">
                            <p className={`text-lg font-bold ${STATUS_TEXT_COLORS[s]}`}>{count}</p>
                            <p className="text-[10px] text-muted-foreground">{STATUS_LABELS[s]}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Task list */}
                    <div className="space-y-1">
                      {member.tasks
                        .sort((a, b) => {
                          const si = STATUS_ORDER.indexOf(a.status as any);
                          const sj = STATUS_ORDER.indexOf(b.status as any);
                          if (si !== sj) return si - sj;
                          return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
                        })
                        .map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                          >
                            <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[task.status]}`} />
                            <span className="text-xs flex-1 truncate">{task.title}</span>
                            <Badge variant="secondary" className="text-[9px] h-4 shrink-0">
                              {task.priority}
                            </Badge>
                            {task.phase && (
                              <Badge variant="outline" className="text-[9px] h-4 shrink-0">
                                {PHASE_LABELS[task.phase] || task.phase}
                              </Badge>
                            )}
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

          {/* Unassigned tasks */}
          {memberStats.unassigned.length > 0 && filterMember === "all" && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold bg-muted text-muted-foreground shrink-0">
                    ?
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Unassigned</h3>
                    <p className="text-xs text-muted-foreground">{memberStats.unassigned.length} task{memberStats.unassigned.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  {memberStats.unassigned.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[task.status]}`} />
                      <span className="text-xs flex-1 truncate">{task.title}</span>
                      <Badge variant="secondary" className="text-[9px] h-4 shrink-0">
                        {task.priority}
                      </Badge>
                      {task.phase && (
                        <Badge variant="outline" className="text-[9px] h-4 shrink-0">
                          {PHASE_LABELS[task.phase] || task.phase}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
