import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  Download,
  Trash2,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  Loader2,
  FolderOpen,
  FolderPlus,
  Folder,
  Plus,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { FileRecord, FileFolder } from "@shared/schema";

type FileWithUser = FileRecord & {
  uploadedBy?: { id: number; displayName: string } | null;
};

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

const FOLDER_COLORS = [
  "#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
];

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.includes("pdf")) return FileText;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv"))
    return FileSpreadsheet;
  if (mimeType.includes("document") || mimeType.includes("word"))
    return FileText;
  return File;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function FilesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [activeFolder, setActiveFolder] = useState<number | null>(null); // null = "All Files"
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);
  const [moveFileId, setMoveFileId] = useState<number | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState<string>("uncategorized");

  const { data: folders = [], isLoading: foldersLoading } = useQuery<FileFolder[]>({
    queryKey: ["/api/file-folders"],
  });

  const { data: files, isLoading: filesLoading } = useQuery<FileWithUser[]>({
    queryKey: ["/api/files"],
  });

  const createFolder = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      await apiRequest("POST", "/api/file-folders", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/file-folders"] });
      setNewFolderOpen(false);
      setFolderName("");
      toast({ title: "Folder created" });
    },
  });

  const deleteFolder = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/file-folders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/file-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      if (activeFolder !== null) setActiveFolder(null);
      toast({ title: "Folder deleted. Files moved to All Files." });
    },
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      if (activeFolder !== null) {
        formData.append("folderId", String(activeFolder));
      }
      const res = await fetch(`${API_BASE}/api/files/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "File uploaded" });
    },
    onError: (err: Error) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const moveFile = useMutation({
    mutationFn: async ({ fileId, folderId }: { fileId: number; folderId: number | null }) => {
      await apiRequest("PUT", `/api/files/${fileId}/move`, { folderId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      setMoveFileId(null);
      toast({ title: "File moved" });
    },
  });

  const deleteFile = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/files/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "File deleted" });
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) uploadFile.mutate(droppedFile);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) uploadFile.mutate(selectedFile);
    e.target.value = "";
  };

  const isAdmin = user?.role === "admin";

  // Filter files by active folder
  const filteredFiles = (files || []).filter((f) => {
    if (activeFolder === null) return true; // All files
    if (activeFolder === 0) return !f.folderId; // Uncategorized
    return f.folderId === activeFolder;
  });

  // Count files per folder
  const folderCounts = new Map<number | null, number>();
  folderCounts.set(null, (files || []).length); // all
  folderCounts.set(0, (files || []).filter(f => !f.folderId).length); // uncategorized
  for (const folder of folders) {
    folderCounts.set(folder.id, (files || []).filter(f => f.folderId === folder.id).length);
  }

  const activeFolderName = activeFolder === null
    ? "All Files"
    : activeFolder === 0
    ? "Uncategorized"
    : folders.find(f => f.id === activeFolder)?.name || "Folder";

  return (
    <div className="flex h-full" data-testid="files-page">
      {/* Folder sidebar */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">Folders</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setNewFolderOpen(true)}
            data-testid="button-new-folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {/* All Files */}
          <button
            onClick={() => setActiveFolder(null)}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors ${
              activeFolder === null
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            data-testid="folder-all"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">All Files</span>
            </div>
            <span className="text-[10px] tabular-nums">{folderCounts.get(null) || 0}</span>
          </button>

          {/* Uncategorized */}
          <button
            onClick={() => setActiveFolder(0)}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors ${
              activeFolder === 0
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            data-testid="folder-uncategorized"
          >
            <div className="flex items-center gap-2">
              <File className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Uncategorized</span>
            </div>
            <span className="text-[10px] tabular-nums">{folderCounts.get(0) || 0}</span>
          </button>

          {/* Separator */}
          {folders.length > 0 && <div className="border-t border-border my-1.5" />}

          {/* User folders */}
          {foldersLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setActiveFolder(folder.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors group ${
                  activeFolder === folder.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`folder-${folder.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: folder.color }} />
                  <span className="truncate">{folder.name}</span>
                </div>
                <span className="text-[10px] tabular-nums">{folderCounts.get(folder.id) || 0}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{activeFolderName}</h1>
              <span className="text-sm text-muted-foreground">
                {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
              </span>
            </div>
            {activeFolder !== null && activeFolder !== 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => deleteFolder.mutate(activeFolder)}
                data-testid="button-delete-folder"
              >
                <Trash2 className="h-3 w-3 mr-1" /> Delete Folder
              </Button>
            )}
          </div>

          {/* Upload area */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/30"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            data-testid="file-drop-zone"
          >
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-xs text-muted-foreground mb-2">
              Drop a file here to upload{activeFolder && activeFolder > 0
                ? ` to ${folders.find(f => f.id === activeFolder)?.name}`
                : ""}
            </p>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-file-upload"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadFile.isPending}
              data-testid="button-upload-file"
            >
              {uploadFile.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Choose File
            </Button>
          </div>

          {/* File list */}
          <Card>
            <CardContent className="p-0">
              {filesLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !filteredFiles.length ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {activeFolder === null ? "No files uploaded yet." : "No files in this folder."}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      {activeFolder === null && <TableHead className="w-28">Folder</TableHead>}
                      <TableHead className="w-24">Size</TableHead>
                      <TableHead className="w-32">Uploaded By</TableHead>
                      <TableHead className="w-32">Date</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFiles.map((f) => {
                      const Icon = getFileIcon(f.mimeType);
                      const canDelete = isAdmin || f.userId === user?.id;
                      const folder = folders.find(fd => fd.id === f.folderId);
                      return (
                        <TableRow key={f.id} data-testid={`file-row-${f.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="text-sm truncate">{f.originalName}</span>
                            </div>
                          </TableCell>
                          {activeFolder === null && (
                            <TableCell>
                              {folder ? (
                                <button
                                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80"
                                  onClick={() => setActiveFolder(folder.id)}
                                >
                                  <Folder className="h-3 w-3" style={{ color: folder.color }} />
                                  {folder.name}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">\u2014</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-sm text-muted-foreground">
                            {formatSize(f.size)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(f as any).uploadedBy?.displayName ?? "Unknown"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {f.createdAt
                              ? formatDistanceToNow(new Date(f.createdAt), { addSuffix: true })
                              : ""}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Move to folder"
                                onClick={() => {
                                  setMoveFileId(f.id);
                                  setMoveTargetFolder(f.folderId ? String(f.folderId) : "uncategorized");
                                }}
                                data-testid={`button-move-${f.id}`}
                              >
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  window.open(`${API_BASE}/api/files/download/${f.id}`, "_blank")
                                }
                                data-testid={`button-download-${f.id}`}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              {canDelete && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  onClick={() => deleteFile.mutate(f.id)}
                                  data-testid={`button-delete-file-${f.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!folderName.trim()) return;
              createFolder.mutate({ name: folderName.trim(), color: folderColor });
            }}
            className="space-y-3"
          >
            <Input
              placeholder="Folder name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              required
              data-testid="input-folder-name"
            />
            <div className="flex gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFolderColor(c)}
                  className={`h-6 w-6 rounded-full transition-all ${
                    folderColor === c ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                  data-testid={`color-${c}`}
                />
              ))}
            </div>
            <Button
              type="submit"
              disabled={createFolder.isPending}
              data-testid="button-submit-folder"
            >
              {createFolder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Folder
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Move File Dialog */}
      <Dialog open={!!moveFileId} onOpenChange={(open) => { if (!open) setMoveFileId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move File to Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={moveTargetFolder} onValueChange={setMoveTargetFolder}>
              <SelectTrigger data-testid="select-move-folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uncategorized">Uncategorized</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => {
                if (moveFileId) {
                  const folderId = moveTargetFolder === "uncategorized" ? null : Number(moveTargetFolder);
                  moveFile.mutate({ fileId: moveFileId, folderId });
                }
              }}
              disabled={moveFile.isPending}
              data-testid="button-confirm-move"
            >
              {moveFile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
