import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { MeetingRequest, User } from "@shared/schema";
import {
  Plus,
  Calendar,
  Clock,
  Check,
  X,
  RefreshCw,
  Send,
  Inbox,
  Trash2,
  User as UserIcon,
} from "lucide-react";

interface MeetingRequestWithUsers extends MeetingRequest {
  requester?: Partial<User>;
  recipient?: Partial<User>;
}

function toLocalDatetimeStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function formatDateTime(isoStr: string, allDay?: number) {
  const d = new Date(isoStr);
  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (allDay) return dateStr + " (All day)";
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr}, ${timeStr}`;
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

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  accepted: { label: "Accepted", color: "text-green-600", bg: "bg-green-50 border-green-200" },
  declined: { label: "Declined", color: "text-red-600", bg: "bg-red-50 border-red-200" },
  new_time_proposed: { label: "New Time Proposed", color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
};

export default function MeetingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [showCreate, setShowCreate] = useState(false);
  const [declineDialog, setDeclineDialog] = useState<MeetingRequestWithUsers | null>(null);
  const [proposeTimeDialog, setProposeTimeDialog] = useState<MeetingRequestWithUsers | null>(null);

  const { data: requests = [], isLoading } = useQuery<MeetingRequestWithUsers[]>({
    queryKey: ["/api/meeting-requests"],
  });

  const { data: teamMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/team"],
  });

  const inbox = requests.filter((r) => r.recipientId === user?.id);
  const sent = requests.filter((r) => r.requesterId === user?.id);
  // For new_time_proposed, show in inbox of the person who DIDN'T propose the new time
  // The status change means the other party needs to respond
  const displayedRequests = tab === "inbox" ? inbox : sent;

  const acceptMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PUT", `/api/meeting-requests/${id}/accept`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      toast({ title: "Meeting accepted and added to calendar" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async ({ id, message }: { id: number; message: string }) => {
      const res = await apiRequest("PUT", `/api/meeting-requests/${id}/decline`, { message });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
      setDeclineDialog(null);
      toast({ title: "Meeting declined" });
    },
  });

  const proposeTimeMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      proposedNewStartDate: string;
      proposedNewEndDate: string;
      message: string;
    }) => {
      const { id, ...body } = data;
      const res = await apiRequest("PUT", `/api/meeting-requests/${id}/propose-new-time`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
      setProposeTimeDialog(null);
      toast({ title: "New time proposed" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/meeting-requests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
      toast({ title: "Request cancelled" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/meeting-requests", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meeting-requests"] });
      setShowCreate(false);
      toast({ title: "Meeting request sent" });
    },
  });

  const pendingInbox = inbox.filter(
    (r) => r.status === "pending" || r.status === "new_time_proposed"
  ).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl" data-testid="page-meetings">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Meeting Requests</h1>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-meeting-request">
          <Plus className="h-4 w-4 mr-1" />
          Request Meeting
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
        <button
          onClick={() => setTab("inbox")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "inbox"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <Inbox className="h-4 w-4" />
          Inbox
          {pendingInbox > 0 && (
            <span className="ml-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold bg-red-500 text-white rounded-full">
              {pendingInbox}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("sent")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "sent"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <Send className="h-4 w-4" />
          Sent
        </button>
      </div>

      {/* Request List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : displayedRequests.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {tab === "inbox"
              ? "No meeting requests received"
              : "No meeting requests sent"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedRequests.map((req) => {
            const status = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending;
            const otherUser = tab === "inbox" ? req.requester : req.recipient;
            const canRespond =
              tab === "inbox" &&
              (req.status === "pending" || req.status === "new_time_proposed");
            // For sent requests with new_time_proposed, the requester can accept the new time
            const canAcceptNewTime =
              tab === "sent" && req.status === "new_time_proposed";

            return (
              <div
                key={req.id}
                className={`border rounded-lg p-4 transition-colors ${status.bg}`}
                data-testid={`meeting-request-${req.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm truncate">{req.title}</h3>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${status.color} shrink-0`}
                      >
                        {status.label}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      <UserIcon className="h-3 w-3" />
                      {tab === "inbox" ? "From" : "To"}: {otherUser?.displayName || "Unknown"}
                    </div>

                    {req.description && (
                      <p className="text-xs text-muted-foreground mb-2">
                        {req.description}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(req.proposedStartDate, req.allDay)} &mdash;{" "}
                      {formatDateTime(req.proposedEndDate, req.allDay)}
                    </div>

                    {req.status === "new_time_proposed" &&
                      req.proposedNewStartDate &&
                      req.proposedNewEndDate && (
                        <div className="mt-2 pl-3 border-l-2 border-blue-300">
                          <p className="text-xs font-medium text-blue-600 mb-0.5">
                            New Proposed Time:
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(req.proposedNewStartDate, req.allDay)}{" "}
                            &mdash;{" "}
                            {formatDateTime(req.proposedNewEndDate, req.allDay)}
                          </div>
                          {req.responseMessage && (
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              "{req.responseMessage}"
                            </p>
                          )}
                        </div>
                      )}

                    {req.status === "declined" && req.responseMessage && (
                      <p className="text-xs text-red-600 mt-1 italic">
                        "{req.responseMessage}"
                      </p>
                    )}

                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      {timeAgo(req.createdAt)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {canRespond && (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => acceptMutation.mutate(req.id)}
                          disabled={acceptMutation.isPending}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setProposeTimeDialog(req)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          New Time
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => setDeclineDialog(req)}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Decline
                        </Button>
                      </>
                    )}
                    {canAcceptNewTime && (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => acceptMutation.mutate(req.id)}
                        disabled={acceptMutation.isPending}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Accept New Time
                      </Button>
                    )}
                    {tab === "sent" && req.status === "pending" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => deleteMutation.mutate(req.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Meeting Request Dialog */}
      {showCreate && (
        <CreateMeetingDialog
          open={true}
          onClose={() => setShowCreate(false)}
          teamMembers={teamMembers}
          currentUserId={user?.id ?? 0}
          onSubmit={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
        />
      )}

      {/* Decline Dialog */}
      {declineDialog && (
        <DeclineDialog
          request={declineDialog}
          onClose={() => setDeclineDialog(null)}
          onDecline={(message) =>
            declineMutation.mutate({ id: declineDialog.id, message })
          }
          isPending={declineMutation.isPending}
        />
      )}

      {/* Propose New Time Dialog */}
      {proposeTimeDialog && (
        <ProposeTimeDialog
          request={proposeTimeDialog}
          onClose={() => setProposeTimeDialog(null)}
          onPropose={(data) =>
            proposeTimeMutation.mutate({ id: proposeTimeDialog.id, ...data })
          }
          isPending={proposeTimeMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Create Meeting Request Dialog ────────────────
function CreateMeetingDialog({
  open,
  onClose,
  teamMembers,
  currentUserId,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  teamMembers: any[];
  currentUserId: number;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [recipientId, setRecipientId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const defaultStart = new Date();
  defaultStart.setMinutes(0);
  defaultStart.setHours(defaultStart.getHours() + 1);
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);
  const [startDate, setStartDate] = useState(toLocalDatetimeStr(defaultStart));
  const [endDate, setEndDate] = useState(toLocalDatetimeStr(defaultEnd));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientId || !title.trim()) return;
    onSubmit({
      recipientId,
      title: title.trim(),
      description: description.trim(),
      proposedStartDate: new Date(startDate).toISOString(),
      proposedEndDate: new Date(endDate).toISOString(),
      allDay: allDay ? 1 : 0,
    });
  }

  const others = teamMembers.filter((m: any) => m.id !== currentUserId);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request a Meeting</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Recipient */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Meet with
            </label>
            <div className="flex flex-wrap gap-2">
              {others.map((m: any) => {
                const selected = recipientId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setRecipientId(m.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    <div
                      className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] text-white shrink-0"
                      style={{ backgroundColor: m.avatarColor }}
                    >
                      {m.displayName
                        ?.split(" ")
                        .map((w: string) => w[0])
                        .join("")
                        .slice(0, 2)}
                    </div>
                    {m.displayName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting title..."
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this meeting about?"
              rows={2}
            />
          </div>

          {/* All day toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="meetingAllDay"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="meetingAllDay" className="text-sm">
              All day
            </label>
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
              />
            </div>
            <div>
              <label className="text-sm font-medium">End</label>
              <Input
                type={allDay ? "date" : "datetime-local"}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !recipientId || !title.trim()}
            >
              {isPending ? "Sending..." : "Send Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Decline Dialog ───────────────────────────────
function DeclineDialog({
  request,
  onClose,
  onDecline,
  isPending,
}: {
  request: MeetingRequestWithUsers;
  onClose: () => void;
  onDecline: (message: string) => void;
  isPending: boolean;
}) {
  const [message, setMessage] = useState("");

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline Meeting</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Decline "{request.title}" from {request.requester?.displayName}?
          </p>
          <div>
            <label className="text-sm font-medium">
              Reason (optional)
            </label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Let them know why..."
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => onDecline(message)}
              disabled={isPending}
            >
              {isPending ? "Declining..." : "Decline"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Propose New Time Dialog ──────────────────────
function ProposeTimeDialog({
  request,
  onClose,
  onPropose,
  isPending,
}: {
  request: MeetingRequestWithUsers;
  onClose: () => void;
  onPropose: (data: {
    proposedNewStartDate: string;
    proposedNewEndDate: string;
    message: string;
  }) => void;
  isPending: boolean;
}) {
  const origStart = new Date(request.proposedStartDate);
  const origEnd = new Date(request.proposedEndDate);
  const [startDate, setStartDate] = useState(toLocalDatetimeStr(origStart));
  const [endDate, setEndDate] = useState(toLocalDatetimeStr(origEnd));
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onPropose({
      proposedNewStartDate: new Date(startDate).toISOString(),
      proposedNewEndDate: new Date(endDate).toISOString(),
      message,
    });
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose New Time</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Suggest a different time for "{request.title}"
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start</label>
              <Input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">End</label>
              <Input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Message (optional)</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="This time works better because..."
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Sending..." : "Propose Time"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
