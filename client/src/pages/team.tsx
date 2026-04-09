import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Merge } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@shared/schema";

type TeamMember = User & { online?: boolean };

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";
  const [mergeUser, setMergeUser] = useState<TeamMember | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string>("");

  const { data: team, isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      await apiRequest("PUT", `/api/team/${id}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Role updated" });
    },
  });

  const mergeUsers = useMutation({
    mutationFn: async ({ keepId, removeId }: { keepId: number; removeId: number }) => {
      const res = await apiRequest("POST", "/api/team/merge", { keepId, removeId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      setMergeUser(null);
      setMergeTarget("");
      toast({ title: data.message || "Users merged" });
    },
    onError: () => {
      toast({ title: "Failed to merge users", variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {team?.length ?? 0} members
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {team?.map((member) => (
            <Card key={member.id} data-testid={`team-card-${member.id}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div
                      className="h-12 w-12 rounded-full flex items-center justify-center text-sm font-semibold text-white"
                      style={{ backgroundColor: member.avatarColor }}
                    >
                      {getInitials(member.displayName)}
                    </div>
                    <div
                      className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${
                        member.online ? "bg-green-500" : "bg-gray-400"
                      }`}
                      data-testid={`status-${member.id}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {member.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {member.email}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      {isAdmin && member.id !== user?.id ? (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(val) =>
                              updateRole.mutate({ id: member.id, role: val })
                            }
                          >
                            <SelectTrigger
                              className="h-6 text-[11px] w-24"
                              data-testid={`select-role-${member.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => { setMergeUser(member); setMergeTarget(""); }}
                            title="Merge this user into another"
                          >
                            <Merge className="h-3 w-3 mr-1" />
                            Merge
                          </Button>
                        </>
                      ) : (
                        <Badge
                          variant={
                            member.role === "admin" ? "default" : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {member.role}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Merge Dialog */}
      <Dialog open={!!mergeUser} onOpenChange={(open) => { if (!open) setMergeUser(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge User</DialogTitle>
          </DialogHeader>
          {mergeUser && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Merge <strong>{mergeUser.displayName}</strong> ({mergeUser.email}) into another user.
                All their tasks, messages, files, and other data will be transferred. The merged account will be deleted.
              </p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Merge into</label>
                <Select value={mergeTarget} onValueChange={setMergeTarget}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select user to keep..." />
                  </SelectTrigger>
                  <SelectContent>
                    {team
                      ?.filter((m) => m.id !== mergeUser.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.displayName} ({m.email})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {mergeTarget && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm">
                  <strong>{mergeUser.displayName}</strong> will be deleted. All data moves to{" "}
                  <strong>{team?.find((m) => m.id.toString() === mergeTarget)?.displayName}</strong>.
                  This cannot be undone.
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setMergeUser(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!mergeTarget || mergeUsers.isPending}
                  onClick={() =>
                    mergeUsers.mutate({
                      keepId: Number(mergeTarget),
                      removeId: mergeUser.id,
                    })
                  }
                >
                  {mergeUsers.isPending ? "Merging..." : "Merge & Delete"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
