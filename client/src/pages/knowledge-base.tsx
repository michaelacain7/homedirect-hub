import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Plus,
  Search,
  X,
  Edit2,
  Trash2,
  FileText,
  Paperclip,
  Download,
  BookOpen,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { KnowledgeArticle, FileRecord } from "@shared/schema";

type ArticleWithMeta = KnowledgeArticle & {
  createdByUser?: any;
  updatedByUser?: any;
  attachmentFiles?: FileRecord[];
};

const CATEGORIES = [
  { value: "general", label: "General", color: "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400" },
  { value: "legal", label: "Legal", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "product", label: "Product", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400" },
  { value: "engineering", label: "Engineering", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  { value: "operations", label: "Operations", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "marketing", label: "Marketing", color: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" },
  { value: "finance", label: "Finance", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
];

function getCategoryStyle(cat: string) {
  return CATEGORIES.find(c => c.value === cat)?.color || CATEGORIES[0].color;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [viewArticle, setViewArticle] = useState<ArticleWithMeta | null>(null);
  const [editArticle, setEditArticle] = useState<ArticleWithMeta | null>(null);

  const { data: articles = [], isLoading } = useQuery<ArticleWithMeta[]>({
    queryKey: ["/api/knowledge"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/knowledge", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setShowCreate(false);
      toast({ title: "Article created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PUT", `/api/knowledge/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setEditArticle(null);
      setViewArticle(null);
      toast({ title: "Article updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setViewArticle(null);
      toast({ title: "Article deleted" });
    },
  });

  const filtered = articles.filter((a) => {
    if (filterCategory !== "all" && a.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!a.title.toLowerCase().includes(q) && !a.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Group by category
  const grouped = new Map<string, ArticleWithMeta[]>();
  for (const a of filtered) {
    const list = grouped.get(a.category) || [];
    list.push(a);
    grouped.set(a.category, list);
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl" data-testid="page-knowledge">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Company information, documents, and resources
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Article
        </Button>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Articles */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No articles yet. Add company information to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([cat, catArticles]) => {
            const catInfo = CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];
            return (
              <div key={cat}>
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Badge variant="secondary" className={`text-[10px] ${catInfo.color}`}>
                    {catInfo.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">({catArticles.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {catArticles.map((article) => (
                    <Card
                      key={article.id}
                      className="cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => setViewArticle(article)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <FileText className="h-4 w-4 text-primary shrink-0" />
                              <h3 className="text-sm font-semibold truncate">{article.title}</h3>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {article.content.slice(0, 150)}{article.content.length > 150 ? "..." : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-[10px] text-muted-foreground">
                            {article.createdByUser?.displayName || "Unknown"} · {timeAgo(article.updatedAt || article.createdAt)}
                          </span>
                          {article.attachmentFiles && article.attachmentFiles.length > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Paperclip className="h-3 w-3" />
                              {article.attachmentFiles.length} file{article.attachmentFiles.length !== 1 ? "s" : ""}
                            </div>
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

      {/* View Article Dialog */}
      <Dialog open={!!viewArticle && !editArticle} onOpenChange={(o) => { if (!o) setViewArticle(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {viewArticle?.title}
            </DialogTitle>
          </DialogHeader>
          {viewArticle && (
            <div className="flex-1 overflow-y-auto space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className={`text-[10px] ${getCategoryStyle(viewArticle.category)}`}>
                  {CATEGORIES.find(c => c.value === viewArticle.category)?.label || viewArticle.category}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  by {viewArticle.createdByUser?.displayName || "Unknown"}
                </span>
                <span className="text-xs text-muted-foreground">
                  · Updated {timeAgo(viewArticle.updatedAt || viewArticle.createdAt)}
                </span>
              </div>

              <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap text-sm">
                {viewArticle.content}
              </div>

              {/* Attachments */}
              {viewArticle.attachmentFiles && viewArticle.attachmentFiles.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" />
                    Attachments
                  </h4>
                  <div className="space-y-1.5">
                    {viewArticle.attachmentFiles.map((f: any) => (
                      <a
                        key={f.id}
                        href={`/api/files/download/${f.id}`}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{f.originalName}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
                        <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button size="sm" variant="outline" onClick={() => setEditArticle(viewArticle)}>
                  <Edit2 className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate(viewArticle.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / Edit Dialog */}
      {(showCreate || !!editArticle) && (
        <ArticleFormDialog
          open={true}
          onClose={() => { setShowCreate(false); setEditArticle(null); }}
          article={editArticle}
          onSubmit={(data) => {
            if (editArticle) {
              updateMutation.mutate({ id: editArticle.id, ...data });
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

// ── Article Form Dialog ──────────────────────────
function ArticleFormDialog({
  open,
  onClose,
  article,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  article: ArticleWithMeta | null;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(article?.title || "");
  const [content, setContent] = useState(article?.content || "");
  const [category, setCategory] = useState(article?.category || "general");
  const [attachmentIds, setAttachmentIds] = useState<number[]>(
    (() => { try { return JSON.parse(article?.attachments || "[]"); } catch { return []; } })()
  );
  const [uploadedFiles, setUploadedFiles] = useState<any[]>(article?.attachmentFiles || []);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/knowledge/upload", { method: "POST", body: formData, credentials: "include" });
      if (res.ok) {
        const record = await res.json();
        setAttachmentIds(prev => [...prev, record.id]);
        setUploadedFiles(prev => [...prev, record]);
      }
    } catch {}
    setUploading(false);
    e.target.value = "";
  }

  function removeAttachment(fileId: number) {
    setAttachmentIds(prev => prev.filter(id => id !== fileId));
    setUploadedFiles(prev => prev.filter((f: any) => f.id !== fileId));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      content,
      category,
      attachments: JSON.stringify(attachmentIds),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{article ? "Edit Article" : "New Article"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article title..." required />
          </div>

          <div>
            <label className="text-sm font-medium">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Content</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste or type company information here..."
              rows={12}
              className="font-mono text-sm"
            />
          </div>

          {/* Attachments */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Attachments
              {uploadedFiles.length > 0 && (
                <span className="ml-1 text-muted-foreground font-normal">({uploadedFiles.length})</span>
              )}
            </label>
            {uploadedFiles.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {uploadedFiles.map((f: any) => (
                  <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-border text-xs">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{f.originalName}</span>
                    <span className="text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
                    <button type="button" onClick={() => removeAttachment(f.id)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 mr-1" />}
              {uploading ? "Uploading..." : "Attach File"}
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? "Saving..." : article ? "Update" : "Create Article"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
