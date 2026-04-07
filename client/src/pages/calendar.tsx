import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { CalendarEvent, User } from "@shared/schema";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Users,
  User as UserIcon,
  Clock,
  Trash2,
  Edit2,
  X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────
interface CalendarEventWithUser extends CalendarEvent {
  user?: Partial<User>;
  attendeeUsers?: Partial<User>[];
}

const EVENT_TYPES = [
  { value: "meeting", label: "Meeting", color: "#4F6BED" },
  { value: "task", label: "Task", color: "#F59E0B" },
  { value: "deadline", label: "Deadline", color: "#EF4444" },
  { value: "reminder", label: "Reminder", color: "#8B5CF6" },
  { value: "other", label: "Other", color: "#10B981" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Helpers ───────────────────────────────────────
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function isSameDay(d1: string, year: number, month: number, day: number) {
  const date = new Date(d1);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

function isToday(year: number, month: number, day: number) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateRange(start: string, end: string, allDay: number) {
  const s = new Date(start);
  const e = new Date(end);
  const dateStr = s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return dateStr + " (All day)";
  return `${dateStr}, ${formatTime(start)} – ${formatTime(end)}`;
}

function toLocalDatetimeStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function toLocalDateStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Main Calendar Page ────────────────────────────
export default function CalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [viewMode, setViewMode] = useState<"master" | "my">("master");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventWithUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEventWithUser | null>(null);
  const [clickedDate, setClickedDate] = useState<Date | null>(null);

  // Fetch team members for attendees dropdown
  const { data: teamMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/team"],
  });

  // Fetch events based on view mode
  const eventsQueryKey = viewMode === "master"
    ? ["/api/calendar-events"]
    : ["/api/calendar-events/user", user?.id];

  const { data: events = [], isLoading } = useQuery<CalendarEventWithUser[]>({
    queryKey: eventsQueryKey,
    queryFn: async () => {
      const url = viewMode === "master"
        ? "/api/calendar-events"
        : `/api/calendar-events/user/${user?.id}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/calendar-events", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events/user", user?.id] });
      toast({ title: "Event created" });
      setShowCreate(false);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PUT", `/api/calendar-events/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events/user", user?.id] });
      toast({ title: "Event updated" });
      setEditEvent(null);
      setSelectedEvent(null);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/calendar-events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events/user", user?.id] });
      toast({ title: "Event deleted" });
      setSelectedEvent(null);
    },
  });

  // Navigation
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  // Build calendar grid
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  // Events indexed by day
  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEventWithUser[]>();
    for (const ev of events) {
      const start = new Date(ev.startDate);
      const end = new Date(ev.endDate);
      // Show event on each day it spans within this month
      for (let d = 1; d <= daysInMonth; d++) {
        const cellStart = new Date(year, month, d, 0, 0, 0);
        const cellEnd = new Date(year, month, d, 23, 59, 59);
        if (start <= cellEnd && end >= cellStart) {
          if (!map.has(d)) map.set(d, []);
          map.get(d)!.push(ev);
        }
      }
    }
    return map;
  }, [events, year, month, daysInMonth]);

  function handleDayClick(day: number) {
    const d = new Date(year, month, day, 9, 0);
    setClickedDate(d);
    setShowCreate(true);
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-full" data-testid="page-calendar">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Calendar</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("master")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "master"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-view-master"
            >
              <Users className="h-3.5 w-3.5" />
              Master
            </button>
            <button
              onClick={() => setViewMode("my")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "my"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-view-my"
            >
              <UserIcon className="h-3.5 w-3.5" />
              My Calendar
            </button>
          </div>

          <Button
            size="sm"
            onClick={() => { setClickedDate(null); setShowCreate(true); }}
            data-testid="button-new-event"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Event
          </Button>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth} data-testid="button-prev-month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[180px] text-center" data-testid="text-current-month">
            {MONTH_NAMES[month]} {year}
          </h2>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth} data-testid="button-next-month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={goToday}>
            Today
          </Button>
        </div>

        {/* Legend */}
        <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
          {EVENT_TYPES.map(t => (
            <div key={t.value} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/50">
          {DAY_NAMES.map(d => (
            <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {Array.from({ length: totalCells }).map((_, idx) => {
            const day = idx - firstDay + 1;
            const inMonth = day >= 1 && day <= daysInMonth;
            const today = inMonth && isToday(year, month, day);
            const dayEvents = inMonth ? (eventsByDay.get(day) || []) : [];

            return (
              <div
                key={idx}
                className={`min-h-[90px] md:min-h-[110px] border-b border-r border-border p-1 transition-colors ${
                  inMonth ? "bg-background hover:bg-accent/30 cursor-pointer" : "bg-muted/20"
                } ${idx % 7 === 0 ? "border-l-0" : ""}`}
                onClick={() => inMonth && handleDayClick(day)}
                data-testid={inMonth ? `calendar-day-${day}` : undefined}
              >
                {inMonth && (
                  <>
                    <div className={`text-xs font-medium mb-0.5 ${
                      today
                        ? "bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center"
                        : "text-foreground px-1"
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <button
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                          className="w-full text-left px-1 py-0.5 rounded text-[10px] md:text-[11px] leading-tight truncate hover:opacity-80 transition-opacity"
                          style={{
                            backgroundColor: `${ev.color}20`,
                            color: ev.color,
                            borderLeft: `2px solid ${ev.color}`,
                          }}
                          data-testid={`event-chip-${ev.id}`}
                        >
                          {ev.allDay ? "" : formatTime(ev.startDate) + " "}{ev.title}
                        </button>
                      ))}
                      {dayEvents.length > 3 && (
                        <p className="text-[10px] text-muted-foreground px-1">
                          +{dayEvents.length - 3} more
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Event detail dialog */}
      <Dialog open={!!selectedEvent && !editEvent} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: selectedEvent?.color }}
              />
              {selectedEvent?.title}
            </DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {formatDateRange(selectedEvent.startDate, selectedEvent.endDate, selectedEvent.allDay)}
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="text-xs">
                  {EVENT_TYPES.find(t => t.value === selectedEvent.type)?.label || selectedEvent.type}
                </Badge>
              </div>

              {selectedEvent.description && (
                <p className="text-sm text-muted-foreground">{selectedEvent.description}</p>
              )}

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserIcon className="h-3.5 w-3.5" />
                Created by {selectedEvent.user?.displayName || "Unknown"}
              </div>

              {selectedEvent.attendeeUsers && selectedEvent.attendeeUsers.length > 0 && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Attendees: </span>
                  {selectedEvent.attendeeUsers.map((u: any) => u.displayName).join(", ")}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-border">
                {selectedEvent.userId === user?.id && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditEvent(selectedEvent)}
                      data-testid="button-edit-event"
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(selectedEvent.id)}
                      disabled={deleteMutation.isPending}
                      data-testid="button-delete-event"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / Edit dialog */}
      {(showCreate || !!editEvent) && (
        <EventFormDialog
          key={editEvent ? `edit-${editEvent.id}` : `new-${clickedDate?.getTime() ?? "btn"}`}
          open={true}
          onClose={() => { setShowCreate(false); setEditEvent(null); setClickedDate(null); }}
          initialDate={clickedDate}
          event={editEvent}
          teamMembers={teamMembers}
          currentUserId={user?.id ?? 0}
          onSubmit={(data) => {
            if (editEvent) {
              updateMutation.mutate({ id: editEvent.id, ...data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Event Form Dialog ─────────────────────────────
function EventFormDialog({
  open,
  onClose,
  initialDate,
  event,
  teamMembers,
  currentUserId,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  initialDate: Date | null;
  event: CalendarEventWithUser | null;
  teamMembers: any[];
  currentUserId: number;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const isEdit = !!event;
  const defaultStart = event ? new Date(event.startDate) : (initialDate || new Date());
  const defaultEnd = event ? new Date(event.endDate) : new Date(defaultStart.getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [type, setType] = useState(event?.type ?? "meeting");
  const [allDay, setAllDay] = useState(!!event?.allDay);
  const [startDate, setStartDate] = useState(
    event?.allDay ? toLocalDateStr(defaultStart) : toLocalDatetimeStr(defaultStart)
  );
  const [endDate, setEndDate] = useState(
    event?.allDay ? toLocalDateStr(defaultEnd) : toLocalDatetimeStr(defaultEnd)
  );
  const [color, setColor] = useState(event?.color ?? "#4F6BED");
  const [selectedAttendees, setSelectedAttendees] = useState<number[]>(
    event ? JSON.parse(event.attendees || "[]") : []
  );

  function handleClose() {
    setTitle("");
    setDescription("");
    setType("meeting");
    setAllDay(false);
    setStartDate(toLocalDatetimeStr(new Date()));
    setEndDate(toLocalDatetimeStr(new Date(Date.now() + 3600000)));
    setColor("#4F6BED");
    setSelectedAttendees([]);
    onClose();
  }

  function handleTypeChange(val: string) {
    setType(val);
    const found = EVENT_TYPES.find(t => t.value === val);
    if (found) setColor(found.color);
  }

  function toggleAttendee(id: number) {
    setSelectedAttendees(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const payload: any = {
      title: title.trim(),
      description: description.trim(),
      type,
      allDay: allDay ? 1 : 0,
      startDate: allDay ? new Date(startDate + "T00:00:00").toISOString() : new Date(startDate).toISOString(),
      endDate: allDay ? new Date(endDate + "T23:59:59").toISOString() : new Date(endDate).toISOString(),
      color,
      attendees: JSON.stringify(selectedAttendees),
    };
    onSubmit(payload);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "New Event"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title..."
              required
              data-testid="input-event-title"
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-sm font-medium">Type</label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger data-testid="select-event-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                      {t.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* All day toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="allDay"
              checked={allDay}
              onCheckedChange={(v) => {
                setAllDay(!!v);
                if (v) {
                  setStartDate(toLocalDateStr(new Date(startDate)));
                  setEndDate(toLocalDateStr(new Date(endDate)));
                } else {
                  setStartDate(toLocalDatetimeStr(new Date(startDate)));
                  setEndDate(toLocalDatetimeStr(new Date(endDate)));
                }
              }}
              data-testid="checkbox-all-day"
            />
            <label htmlFor="allDay" className="text-sm">All day event</label>
          </div>

          {/* Date/Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start</label>
              <Input
                type={allDay ? "date" : "datetime-local"}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                data-testid="input-start-date"
              />
            </div>
            <div>
              <label className="text-sm font-medium">End</label>
              <Input
                type={allDay ? "date" : "datetime-local"}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                data-testid="input-end-date"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              data-testid="input-event-description"
            />
          </div>

          {/* Attendees */}
          <div>
            <label className="text-sm font-medium mb-1 block">Attendees</label>
            <div className="flex flex-wrap gap-2">
              {teamMembers
                .filter((m: any) => m.id !== currentUserId)
                .map((m: any) => {
                  const selected = selectedAttendees.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleAttendee(m.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50"
                      }`}
                      data-testid={`attendee-toggle-${m.id}`}
                    >
                      <div
                        className="h-4 w-4 rounded-full flex items-center justify-center text-[8px] text-white shrink-0"
                        style={{ backgroundColor: m.avatarColor }}
                      >
                        {m.displayName?.split(" ").map((w: string) => w[0]).join("").slice(0, 2)}
                      </div>
                      {m.displayName}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !title.trim()} data-testid="button-save-event">
              {isPending ? "Saving..." : isEdit ? "Update" : "Create Event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
