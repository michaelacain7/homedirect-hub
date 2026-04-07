import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Trash2, Calendar, Search, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { Task, User } from "@shared/schema";

type TaskWithUsers = Task & {
  assignedUser?: { id: number; displayName: string; avatarColor: string } | null;
  createdByUser?: { id: number; displayName: string } | null;
};

const columns = [
  { id: "todo", label: "To Do" },
  { id: "in-progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
] as const;

const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

const categoryColors: Record<string, string> = {
  engineering: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  product: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  marketing: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  legal: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  operations: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  general: "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedTask, setSelectedTask] = useState<TaskWithUsers | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Form states
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStatus, setFormStatus] = useState("todo");
  const [formPriority, setFormPriority] = useState("medium");
  const [formCategory, setFormCategory] = useState("general");
  const [formAssignee, setFormAssignee] = useState("");
  const [formDueDate, setFormDueDate] = useState("");

  const { data: tasks, isLoading } = useQuery<TaskWithUsers[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: team } = useQuery<User[]>({
    queryKey: ["/api/team"],
  });

  const createTask = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", "/api/tasks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setCreateOpen(false);
      resetForm();
      toast({ title: "Task created" });
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      await apiRequest("PUT", `/api/tasks/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setSelectedTask(null);
      toast({ title: "Task updated" });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setSelectedTask(null);
      toast({ title: "Task deleted" });
    },
  });

  function resetForm() {
    setFormTitle("");
    setFormDesc("");
    setFormStatus("todo");
    setFormPriority("medium");
    setFormCategory("general");
    setFormAssignee("");
    setFormDueDate("");
  }

  function openEditDialog(task: TaskWithUsers) {
    setSelectedTask(task);
    setFormTitle(task.title);
    setFormDesc(task.description || "");
    setFormStatus(task.status);
    setFormPriority(task.priority);
    setFormCategory(task.category);
    setFormAssignee(task.assignedTo?.toString() || "");
    setFormDueDate(task.dueDate || "");
  }

  const filteredTasks = (tasks || []).filter((t) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchDesc = (t.description || "").toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }
    if (filterAssignee !== "all" && t.assignedTo?.toString() !== filterAssignee) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-full mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <Button
          size="sm"
          onClick={() => {
            resetForm();
            setCreateOpen(true);
          }}
          data-testid="button-new-task"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Task
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-52 pl-8 pr-8 text-xs"
            data-testid="input-search-tasks"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              data-testid="button-clear-task-search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="h-8 w-36 text-xs" data-testid="filter-assignee">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            {team?.map((m) => (
              <SelectItem key={m.id} value={m.id.toString()}>
                {m.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-8 w-32 text-xs" data-testid="filter-priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 w-32 text-xs" data-testid="filter-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="engineering">Engineering</SelectItem>
            <SelectItem value="product">Product</SelectItem>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="legal">Legal</SelectItem>
            <SelectItem value="operations">Operations</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-32 text-xs" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
        {(searchQuery || filterAssignee !== "all" || filterPriority !== "all" || filterCategory !== "all" || filterStatus !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSearchQuery("");
              setFilterAssignee("all");
              setFilterPriority("all");
              setFilterCategory("all");
              setFilterStatus("all");
            }}
            data-testid="button-clear-filters"
          >
            <X className="h-3 w-3 mr-1" /> Clear all
          </Button>
        )}
      </div>

      {/* Kanban Board */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {columns.map((col) => (
            <div key={col.id} className="space-y-3">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {columns.map((col) => {
            const colTasks = filteredTasks.filter(
              (t) => t.status === col.id
            );
            return (
              <div key={col.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="text-[10px] h-5">
                    {colTasks.length}
                  </Badge>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {colTasks.map((task) => (
                    <Card
                      key={task.id}
                      className="cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => openEditDialog(task)}
                      data-testid={`task-card-${task.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <p className="text-sm font-medium leading-snug">
                          {task.title}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              priorityColors[task.priority] || ""
                            }`}
                          >
                            {task.priority}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              categoryColors[task.category] || ""
                            }`}
                          >
                            {task.category}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          {task.assignedUser ? (
                            <div className="flex items-center gap-1.5">
                              <div
                                className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-semibold text-white"
                                style={{
                                  backgroundColor:
                                    task.assignedUser.avatarColor,
                                }}
                              >
                                {getInitials(task.assignedUser.displayName)}
                              </div>
                              <span className="text-[11px] text-muted-foreground">
                                {task.assignedUser.displayName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Unassigned
                            </span>
                          )}
                          {task.dueDate && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {new Date(task.dueDate).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" }
                              )}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={createOpen || !!selectedTask}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setSelectedTask(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedTask ? "Edit Task" : "New Task"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = {
                title: formTitle,
                description: formDesc,
                status: formStatus,
                priority: formPriority,
                category: formCategory,
                assignedTo: formAssignee ? parseInt(formAssignee) : null,
                dueDate: formDueDate || null,
                createdBy: user!.id,
              };
              if (selectedTask) {
                updateTask.mutate({ id: selectedTask.id, ...data });
              } else {
                createTask.mutate(data);
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Input
                placeholder="Task title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                required
                data-testid="input-task-title"
              />
            </div>
            <Textarea
              placeholder="Description (optional)"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              rows={3}
              data-testid="input-task-desc"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger data-testid="select-task-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
              <Select value={formPriority} onValueChange={setFormPriority}>
                <SelectTrigger data-testid="select-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger data-testid="select-task-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engineering">Engineering</SelectItem>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="legal">Legal</SelectItem>
                  <SelectItem value="operations">Operations</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={formAssignee || "unassigned"}
                onValueChange={(v) =>
                  setFormAssignee(v === "unassigned" ? "" : v)
                }
              >
                <SelectTrigger data-testid="select-task-assignee">
                  <SelectValue placeholder="Assign to..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {team?.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="date"
              value={formDueDate}
              onChange={(e) => setFormDueDate(e.target.value)}
              data-testid="input-task-due-date"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={createTask.isPending || updateTask.isPending}
                data-testid="button-submit-task"
              >
                {(createTask.isPending || updateTask.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {selectedTask ? "Update" : "Create"}
              </Button>
              {selectedTask && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => deleteTask.mutate(selectedTask.id)}
                  disabled={deleteTask.isPending}
                  data-testid="button-delete-task"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
