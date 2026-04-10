import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Edit2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@shared/schema";

type TeamMember = User & { online?: boolean };

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function OrgChartPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";
  const [editUser, setEditUser] = useState<TeamMember | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editReportsTo, setEditReportsTo] = useState<string>("none");

  const { data: team = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
  });

  const updateProfile = useMutation({
    mutationFn: async ({ id, title, reportsTo }: { id: number; title: string; reportsTo: number | null }) => {
      const res = await apiRequest("PUT", `/api/team/${id}/profile`, { title, reportsTo });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      setEditUser(null);
      toast({ title: "Profile updated" });
    },
  });

  function openEdit(member: TeamMember) {
    setEditUser(member);
    setEditTitle(member.title || "");
    setEditReportsTo(member.reportsTo ? member.reportsTo.toString() : "none");
  }

  // Build tree structure
  const roots = team.filter((m) => !m.reportsTo || !team.some((t) => t.id === m.reportsTo));
  const childMap = new Map<number, TeamMember[]>();
  for (const m of team) {
    if (m.reportsTo && team.some((t) => t.id === m.reportsTo)) {
      const children = childMap.get(m.reportsTo) || [];
      children.push(m);
      childMap.set(m.reportsTo, children);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl" data-testid="page-org-chart">
      <div>
        <h1 className="text-xl font-semibold">Organization Chart</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Team structure and roles
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-0">
          {roots.map((member) => (
            <OrgNode
              key={member.id}
              member={member}
              childMap={childMap}
              depth={0}
              isAdmin={isAdmin}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editUser?.displayName}</DialogTitle>
          </DialogHeader>
          {editUser && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateProfile.mutate({
                  id: editUser.id,
                  title: editTitle.trim(),
                  reportsTo: editReportsTo === "none" ? null : Number(editReportsTo),
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="text-sm font-medium mb-1 block">Job Title</label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. CEO, CTO, Marketing Lead..."
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Reports To</label>
                <Select value={editReportsTo} onValueChange={setEditReportsTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select manager..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No one (top level)</SelectItem>
                    {team
                      .filter((m) => m.id !== editUser.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.displayName}
                          {m.title ? ` - ${m.title}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateProfile.isPending}>
                  {updateProfile.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Org Node (recursive) ─────────────────────────
function OrgNode({
  member,
  childMap,
  depth,
  isAdmin,
  onEdit,
}: {
  member: TeamMember;
  childMap: Map<number, TeamMember[]>;
  depth: number;
  isAdmin: boolean;
  onEdit: (m: TeamMember) => void;
}) {
  const children = childMap.get(member.id) || [];
  const hasChildren = children.length > 0;

  return (
    <div className={depth > 0 ? "ml-8 md:ml-12" : ""}>
      {/* Connector line */}
      {depth > 0 && (
        <div className="flex items-center ml-[-16px] md:ml-[-24px] mb-[-1px]">
          <div className="w-4 md:w-6 border-b-2 border-l-2 border-border rounded-bl-lg h-6" />
        </div>
      )}

      <Card className="mb-3 hover:border-primary/20 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="relative">
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0"
                style={{ backgroundColor: member.avatarColor }}
              >
                {getInitials(member.displayName)}
              </div>
              {member.online !== undefined && (
                <div
                  className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${
                    member.online ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{member.displayName}</p>
              {member.title ? (
                <p className="text-xs text-primary font-medium">{member.title}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">No title set</p>
              )}
              <p className="text-[11px] text-muted-foreground truncate">{member.email}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {hasChildren && (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ChevronDown className="h-3 w-3" />
                  {children.length} report{children.length !== 1 ? "s" : ""}
                </div>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onEdit(member)}
                >
                  <Edit2 className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Children */}
      {children.map((child) => (
        <OrgNode
          key={child.id}
          member={child}
          childMap={childMap}
          depth={depth + 1}
          isAdmin={isAdmin}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
