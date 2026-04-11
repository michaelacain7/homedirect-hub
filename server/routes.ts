import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import {
  insertUserSchema, insertChannelSchema, insertMessageSchema,
  insertTaskSchema, insertTodoSchema, insertAnnouncementSchema,
  insertMilestoneSchema, insertNotificationSchema, insertCalendarEventSchema,
  insertMeetingRequestSchema, insertTaskCommentSchema,
} from "@shared/schema";
import {
  sendMeetingRequestEmail,
  sendMeetingAcceptedEmail,
  sendMeetingDeclinedEmail,
  sendMeetingNewTimeEmail,
  sendNotificationEmail,
} from "./email";
import {
  isAIEnabled,
  chatCompletionStream,
  type ChatMessage,
  extractTextFromFile,
} from "./ai";
import {
  isVectorStoreEnabled,
  indexDocument,
  removeDocument,
  semanticSearch,
  getRAGContext,
  keywordSearch,
} from "./vector-store";
import session from "express-session";
import MemoryStore from "memorystore";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// ── File Upload Setup ──────────────────────────────
const uploadDir = path.resolve("uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ── WebSocket Tracking ─────────────────────────────
interface WSClient {
  ws: WebSocket;
  userId: number;
  username: string;
  channelId?: number;
}
const wsClients = new Map<WebSocket, WSClient>();

function broadcast(event: string, data: any, channelId?: number) {
  const payload = JSON.stringify({ event, data });
  wsClients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (channelId === undefined || client.channelId === channelId) {
        client.ws.send(payload);
      }
    }
  });
}

function broadcastAll(event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  wsClients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  });
}

function getOnlineUsers(): number[] {
  const ids = new Set<number>();
  wsClients.forEach((c) => ids.add(c.userId));
  return Array.from(ids);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── Initialize DB ──
  storage.seed();

  // ── Session + Auth ──────────────────────────────
  const SessionStore = MemoryStore(session);
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "homedirect-hub-secret-key-change-in-prod",
      resave: false,
      saveUninitialized: false,
      store: new SessionStore({ checkPeriod: 86400000 }),
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({ usernameField: "email" }, (email, password, done) => {
      const user = storage.getUserByEmail(email);
      if (!user) return done(null, false, { message: "Invalid email or password" });
      if (!storage.verifyPassword(password, user.password))
        return done(null, false, { message: "Invalid email or password" });
      return done(null, user);
    })
  );

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser((id: number, done) => {
    const user = storage.getUser(id);
    done(null, user || null);
  });

  function requireAuth(req: Request, res: Response, next: any) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: "Not authenticated" });
  }

  function safeUser(user: any) {
    if (!user) return null;
    const { password, ...safe } = user;
    return safe;
  }

  // ── Auth Routes ──────────────────────────────────
  app.post("/api/auth/register", (req, res, next) => {
    try {
      const { username, email, password, displayName } = req.body;
      if (!username || !email || !password || !displayName) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (storage.getUserByEmail(email)) {
        return res.status(400).json({ message: "Email already taken" });
      }
      if (storage.getUserByUsername(username)) {
        return res.status(400).json({ message: "Username already taken" });
      }
      const colors = ["#4F6BED", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];
      const avatarColor = colors[Math.floor(Math.random() * colors.length)];
      const user = storage.createUser({ username, email, password, displayName, role: "member", avatarColor });
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(safeUser(user));
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(safeUser(user));
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated()) {
      return res.json(safeUser(req.user));
    }
    res.status(401).json({ message: "Not authenticated" });
  });

  // ── Team Routes ──────────────────────────────────
  app.get("/api/team", requireAuth, (_req, res) => {
    const allUsers = storage.getAllUsers().map(safeUser);
    const online = getOnlineUsers();
    res.json(allUsers.map((u: any) => ({ ...u, online: online.includes(u.id) })));
  });

  app.put("/api/team/:id/role", requireAuth, (req, res) => {
    const user = req.user as any;
    if (user.role !== "admin") return res.status(403).json({ message: "Admins only" });
    const updated = storage.updateUserRole(Number(req.params.id), req.body.role);
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(safeUser(updated));
  });

  app.put("/api/team/:id/profile", requireAuth, (req, res) => {
    const user = req.user as any;
    if (user.role !== "admin") return res.status(403).json({ message: "Admins only" });
    const { title, reportsTo } = req.body;
    const updated = storage.updateUserProfile(Number(req.params.id), {
      title: title !== undefined ? title : undefined,
      reportsTo: reportsTo !== undefined ? reportsTo : undefined,
    });
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(safeUser(updated));
  });

  app.post("/api/team/merge", requireAuth, (req, res) => {
    const user = req.user as any;
    if (user.role !== "admin") return res.status(403).json({ message: "Admins only" });
    const { keepId, removeId } = req.body;
    if (!keepId || !removeId || keepId === removeId) {
      return res.status(400).json({ message: "Invalid merge parameters" });
    }
    const keepUser = storage.getUser(keepId);
    const removeUser = storage.getUser(removeId);
    if (!keepUser || !removeUser) {
      return res.status(404).json({ message: "User not found" });
    }
    storage.mergeUsers(keepId, removeId);
    broadcastAll("team:updated", {});
    res.json({ ok: true, message: `Merged "${removeUser.displayName}" into "${keepUser.displayName}"` });
  });

  // ── Channel Routes ───────────────────────────────
  app.get("/api/channels", requireAuth, (_req, res) => {
    res.json(storage.getChannels());
  });

  app.post("/api/channels", requireAuth, (req, res) => {
    try {
      const channel = storage.createChannel(req.body);
      broadcastAll("channel:created", channel);
      res.json(channel);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Chat Image Upload ────────────────────────────
  app.post("/api/chat/upload-image", requireAuth, upload.single("image"), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No image uploaded" });
    if (!file.mimetype.startsWith("image/")) {
      const filePath = path.join(uploadDir, file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ message: "Only images are allowed" });
    }
    // Read file and convert to base64 data URL for persistence
    const filePath = path.join(uploadDir, file.filename);
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString("base64");
    const dataUrl = `data:${file.mimetype};base64,${base64}`;
    // Clean up the temp file
    fs.unlinkSync(filePath);
    res.json({
      url: dataUrl,
      filename: file.originalname,
      mimeType: file.mimetype,
    });
  });

  app.get("/api/chat/images/:filename", requireAuth, (req, res) => {
    const filename = req.params.filename;
    if (!/^[\w\-.]+$/.test(filename)) return res.status(400).json({ message: "Invalid filename" });
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Image not found" });
    res.sendFile(filePath);
  });

  // ── Message Routes ───────────────────────────────
  app.get("/api/messages/search", requireAuth, (req, res) => {
    const query = (req.query.q as string) || "";
    const channelId = req.query.channelId ? Number(req.query.channelId) : undefined;
    if (!query || query.length < 2) return res.json([]);
    const results = storage.searchMessages(query, channelId);
    res.json(results);
  });

  app.get("/api/messages/:channelId", requireAuth, (req, res) => {
    const msgs = storage.getMessagesByChannel(Number(req.params.channelId));
    const msgIds = msgs.map(m => m.id);
    const allReactions = storage.getReactionsByMessages(msgIds);
    const reactionsByMsg = new Map<number, typeof allReactions>();
    for (const r of allReactions) {
      const list = reactionsByMsg.get(r.messageId) || [];
      list.push(r);
      reactionsByMsg.set(r.messageId, list);
    }
    res.json(msgs.map((m) => ({
      ...m,
      user: m.user ? safeUser(m.user) : null,
      reactions: reactionsByMsg.get(m.id) || [],
    })));
  });

  // ── Task Routes ──────────────────────────────────
  app.get("/api/tasks", requireAuth, (_req, res) => {
    const allTasks = storage.getAllTasks();
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(allTasks.map(t => {
      const assignedIds: number[] = (() => { try { return JSON.parse(t.assignedTo as string); } catch { return []; } })();
      return {
        ...t,
        assignedUsers: assignedIds.map(id => userMap.get(id)).filter(Boolean),
        createdByUser: userMap.get(t.createdBy),
      };
    }));
  });

  app.post("/api/tasks", requireAuth, (req, res) => {
    const user = req.user as any;
    const task = storage.createTask({ ...req.body, createdBy: user.id });
    broadcastAll("task:created", task);
    // Notify assigned users
    const assignedIds: number[] = (() => { try { return JSON.parse(task.assignedTo as string); } catch { return []; } })();
    for (const uid of assignedIds) {
      if (uid !== user.id) {
        notifyUser(uid, "task_assigned", "New Task Assigned", `${user.displayName} assigned you: "${task.title}"`, "/tasks");
      }
    }
    res.json(task);
  });

  app.put("/api/tasks/:id", requireAuth, (req, res) => {
    const user = req.user as any;
    const oldTask = storage.getTask(Number(req.params.id));
    const updated = storage.updateTask(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    broadcastAll("task:updated", updated);
    // Notify newly assigned users
    const oldIds: number[] = (() => { try { return JSON.parse(oldTask?.assignedTo as string || "[]"); } catch { return []; } })();
    const newIds: number[] = (() => { try { return JSON.parse(req.body.assignedTo || "[]"); } catch { return []; } })();
    for (const uid of newIds) {
      if (!oldIds.includes(uid) && uid !== user.id) {
        notifyUser(uid, "task_assigned", "Task Assigned to You", `${user.displayName} assigned you: "${updated.title}"`, "/tasks");
      }
    }
    res.json(updated);
  });

  app.delete("/api/tasks/:id", requireAuth, (req, res) => {
    storage.deleteTask(Number(req.params.id));
    broadcastAll("task:deleted", { id: Number(req.params.id) });
    res.json({ ok: true });
  });

  // ── Task Comment Routes ──────────────────────────
  app.get("/api/tasks/:taskId/comments", requireAuth, (req, res) => {
    const comments = storage.getTaskComments(Number(req.params.taskId));
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(comments.map(c => ({ ...c, user: userMap.get(c.userId) })));
  });

  app.post("/api/tasks/:taskId/comments", requireAuth, (req, res) => {
    const user = req.user as any;
    const taskId = Number(req.params.taskId);
    const task = storage.getTask(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: "Content is required" });
    const comment = storage.createTaskComment({ taskId, userId: user.id, content: content.trim() });
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    const enriched = { ...comment, user: userMap.get(comment.userId) };
    broadcastAll("task:comment", enriched);

    // Detect @mentions
    const contentLower = content.toLowerCase();
    const mentionedUserIds = new Set<number>();
    for (const u of allUsers) {
      if (contentLower.includes("@" + u.displayName.toLowerCase())) {
        mentionedUserIds.add(u.id);
      }
    }

    // Notify: mentioned users get a tagged notification, others get a regular comment notification
    const assignedIds: number[] = (() => { try { return JSON.parse(task.assignedTo as string); } catch { return []; } })();
    const allNotifyIds = [...new Set([...assignedIds, task.createdBy, ...mentionedUserIds])].filter(id => id !== user.id);
    for (const uid of allNotifyIds) {
      if (mentionedUserIds.has(uid)) {
        notifyUser(uid, "task_mention", `Tagged in "${task.title}"`, `${user.displayName} mentioned you: ${content.length > 80 ? content.slice(0, 80) + "..." : content}`, "/tasks");
      } else {
        notifyUser(uid, "task_comment", "New Comment on Task", `${user.displayName} commented on "${task.title}"`, "/tasks");
      }
    }
    res.json(enriched);
  });

  app.delete("/api/tasks/:taskId/comments/:commentId", requireAuth, (req, res) => {
    storage.deleteTaskComment(Number(req.params.commentId));
    res.json({ ok: true });
  });

  // ── Todo Routes ──────────────────────────────────
  app.get("/api/todos", requireAuth, (req, res) => {
    const user = req.user as any;
    res.json(storage.getTodosByUser(user.id));
  });

  app.post("/api/todos", requireAuth, (req, res) => {
    const user = req.user as any;
    const todo = storage.createTodo({ ...req.body, userId: user.id });
    res.json(todo);
  });

  app.put("/api/todos/:id", requireAuth, (req, res) => {
    const updated = storage.updateTodo(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Todo not found" });
    res.json(updated);
  });

  app.delete("/api/todos/:id", requireAuth, (req, res) => {
    storage.deleteTodo(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── File Folder Routes ──────────────────────────
  app.get("/api/file-folders", requireAuth, (_req, res) => {
    res.json(storage.getAllFileFolders());
  });
  app.post("/api/file-folders", requireAuth, (req, res) => {
    const user = req.user as any;
    const folder = storage.createFileFolder({ ...req.body, createdBy: user.id });
    res.json(folder);
  });
  app.put("/api/file-folders/:id", requireAuth, (req, res) => {
    const folder = storage.updateFileFolder(Number(req.params.id), req.body);
    res.json(folder);
  });
  app.delete("/api/file-folders/:id", requireAuth, (req, res) => {
    storage.deleteFileFolder(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── File Routes ──────────────────────────────────
  app.get("/api/files", requireAuth, (_req, res) => {
    const allFiles = storage.getAllFiles();
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(allFiles.map(f => ({
      ...f,
      uploadedBy: userMap.get(f.userId),
    })));
  });

  app.post("/api/files/upload", requireAuth, upload.single("file"), (req, res) => {
    const user = req.user as any;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });
    const folderId = req.body?.folderId ? Number(req.body.folderId) : null;
    const record = storage.createFile({
      userId: user.id,
      folderId,
      originalName: file.originalname,
      storedName: file.filename,
      size: file.size,
      mimeType: file.mimetype,
    });
    broadcastAll("file:uploaded", record);
    res.json(record);
  });

  app.get("/api/files/download/:id", requireAuth, (req, res) => {
    const file = storage.getFile(Number(req.params.id));
    if (!file) return res.status(404).json({ message: "File not found" });
    const filePath = path.join(uploadDir, file.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File missing from disk" });
    res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`);
    res.setHeader("Content-Type", file.mimeType);
    fs.createReadStream(filePath).pipe(res);
  });

  app.put("/api/files/:id/move", requireAuth, (req, res) => {
    const folderId = req.body.folderId ?? null;
    const file = storage.moveFileToFolder(Number(req.params.id), folderId);
    res.json(file);
  });

  app.delete("/api/files/:id", requireAuth, (req, res) => {
    const file = storage.getFile(Number(req.params.id));
    if (file) {
      const filePath = path.join(uploadDir, file.storedName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    storage.deleteFile(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Announcement Routes ──────────────────────────
  app.get("/api/announcements", requireAuth, (_req, res) => {
    const anns = storage.getAnnouncements();
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(anns.map(a => ({ ...a, author: userMap.get(a.userId) })));
  });

  app.post("/api/announcements", requireAuth, (req, res) => {
    const user = req.user as any;
    const ann = storage.createAnnouncement({ ...req.body, userId: user.id });
    broadcastAll("announcement:created", ann);
    res.json(ann);
  });

  app.delete("/api/announcements/:id", requireAuth, (req, res) => {
    storage.deleteAnnouncement(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Milestone Routes ─────────────────────────────
  app.get("/api/milestones", requireAuth, (_req, res) => {
    res.json(storage.getMilestones());
  });

  app.post("/api/milestones", requireAuth, (req, res) => {
    const milestone = storage.createMilestone(req.body);
    broadcastAll("milestone:updated", milestone);
    res.json(milestone);
  });

  app.put("/api/milestones/:id", requireAuth, (req, res) => {
    const updated = storage.updateMilestone(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Milestone not found" });
    broadcastAll("milestone:updated", updated);
    res.json(updated);
  });

  // ── Notification Routes ──────────────────────────
  app.get("/api/notifications", requireAuth, (req, res) => {
    const user = req.user as any;
    res.json(storage.getNotificationsByUser(user.id));
  });

  app.get("/api/notifications/unread-count", requireAuth, (req, res) => {
    const user = req.user as any;
    res.json({ count: storage.getUnreadCount(user.id) });
  });

  app.put("/api/notifications/:id/read", requireAuth, (req, res) => {
    const updated = storage.markNotificationRead(Number(req.params.id));
    if (!updated) return res.status(404).json({ message: "Notification not found" });
    res.json(updated);
  });

  app.post("/api/notifications/mark-all-read", requireAuth, (req, res) => {
    const user = req.user as any;
    storage.markAllRead(user.id);
    res.json({ ok: true });
  });

  // Helper: create notification and push via WebSocket + email
  function notifyUser(userId: number, type: string, title: string, body: string, linkTo?: string) {
    const notif = storage.createNotification({ userId, type, title, body, linkTo, read: 0 });
    // Push to connected WebSocket clients for this user
    wsClients.forEach((client) => {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ event: "notification:new", data: notif }));
      }
    });
    // Also send email notification
    const recipient = storage.getUser(userId);
    if (recipient?.email) {
      sendNotificationEmail(recipient.email, title, body);
    }
    return notif;
  }

  // ── Calendar Event Routes ─────────────────
  app.get("/api/calendar-events", requireAuth, (_req, res) => {
    const allEvents = storage.getAllCalendarEvents();
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(allEvents.map(e => ({
      ...e,
      user: userMap.get(e.userId),
      attendeeUsers: (JSON.parse(e.attendees) as number[]).map(id => userMap.get(id)).filter(Boolean),
    })));
  });

  app.get("/api/calendar-events/user/:userId", requireAuth, (req, res) => {
    const userId = Number(req.params.userId);
    const userEvents = storage.getCalendarEventsByUser(userId);
    // Also include events where this user is an attendee
    const allEvents = storage.getAllCalendarEvents();
    const attendeeEvents = allEvents.filter(e =>
      e.userId !== userId && (JSON.parse(e.attendees) as number[]).includes(userId)
    );
    const combined = [...userEvents, ...attendeeEvents];
    // Deduplicate by id
    const seen = new Set<number>();
    const unique = combined.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(unique.map(e => ({
      ...e,
      user: userMap.get(e.userId),
      attendeeUsers: (JSON.parse(e.attendees) as number[]).map(id => userMap.get(id)).filter(Boolean),
    })));
  });

  app.post("/api/calendar-events", requireAuth, (req, res) => {
    const user = req.user as any;
    const event = storage.createCalendarEvent({ ...req.body, userId: user.id });
    broadcastAll("calendar:created", event);
    // Notify attendees
    const attendeeIds = JSON.parse(event.attendees || "[]") as number[];
    for (const attendeeId of attendeeIds) {
      if (attendeeId !== user.id) {
        notifyUser(
          attendeeId,
          "calendar_event",
          "New Calendar Event",
          `${user.displayName} invited you to: "${event.title}"`,
          "/calendar"
        );
      }
    }
    res.json(event);
  });

  app.put("/api/calendar-events/:id", requireAuth, (req, res) => {
    const updated = storage.updateCalendarEvent(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Event not found" });
    broadcastAll("calendar:updated", updated);
    res.json(updated);
  });

  app.delete("/api/calendar-events/:id", requireAuth, (req, res) => {
    storage.deleteCalendarEvent(Number(req.params.id));
    broadcastAll("calendar:deleted", { id: Number(req.params.id) });
    res.json({ ok: true });
  });

  // ── Meeting Request Routes ───────────────────────

  // Helper to compute overall status from per-user responses
  function computeMeetingStatus(responses: Record<string, string>): string {
    const vals = Object.values(responses);
    if (vals.length === 0) return "pending";
    if (vals.some(v => v === "new_time_proposed")) return "new_time_proposed";
    if (vals.every(v => v === "accepted")) return "accepted";
    if (vals.every(v => v === "declined")) return "declined";
    if (vals.some(v => v === "pending")) return "pending";
    return "pending"; // mixed accepted/declined with none pending
  }

  app.get("/api/meeting-requests", requireAuth, (req, res) => {
    const user = req.user as any;
    const requests = storage.getMeetingRequestsByUser(user.id);
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    res.json(requests.map((r: any) => ({
      ...r,
      requester: userMap.get(r.requesterId),
      recipientUsers: (JSON.parse(r.recipientIds || "[]") as number[]).map(id => userMap.get(id)).filter(Boolean),
    })));
  });

  app.post("/api/meeting-requests", requireAuth, (req, res) => {
    const user = req.user as any;
    const { recipientIds, title, description, proposedStartDate, proposedEndDate, allDay } = req.body;
    const ids: number[] = Array.isArray(recipientIds) ? recipientIds : [];
    if (!ids.length || !title || !proposedStartDate || !proposedEndDate) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    // Build initial responses: all pending
    const responses: Record<string, string> = {};
    for (const id of ids) responses[String(id)] = "pending";

    const request = storage.createMeetingRequest({
      requesterId: user.id,
      recipientIds: JSON.stringify(ids),
      title,
      description: description || "",
      proposedStartDate,
      proposedEndDate,
      allDay: allDay || 0,
      status: "pending",
      responses: JSON.stringify(responses),
      responseMessage: "",
    });
    broadcastAll("meeting-request:created", request);

    // Notify + email each recipient
    for (const recipientId of ids) {
      notifyUser(
        recipientId,
        "meeting_request",
        "Meeting Request",
        `${user.displayName} wants to meet: "${title}"`,
        "/meetings"
      );
      const recipient = storage.getUser(recipientId);
      if (recipient?.email) {
        sendMeetingRequestEmail(
          recipient.email,
          user.displayName,
          title,
          description || "",
          proposedStartDate,
          proposedEndDate,
          !!allDay,
        );
      }
    }
    res.json(request);
  });

  app.put("/api/meeting-requests/:id/accept", requireAuth, (req, res) => {
    const user = req.user as any;
    const request = storage.getMeetingRequest(Number(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    const recipientIds: number[] = JSON.parse(request.recipientIds || "[]");
    if (!recipientIds.includes(user.id) && request.requesterId !== user.id) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Update this user's response
    const responses: Record<string, string> = JSON.parse(request.responses || "{}");
    responses[String(user.id)] = "accepted";
    const overallStatus = computeMeetingStatus(responses);

    // Determine final times
    const startDate = request.proposedNewStartDate || request.proposedStartDate;
    const endDate = request.proposedNewEndDate || request.proposedEndDate;

    let calendarEventId = request.calendarEventId;

    // Create/update calendar event when all have accepted, or update attendees
    const acceptedIds = Object.entries(responses).filter(([, v]) => v === "accepted").map(([k]) => Number(k));
    const allAttendees = [request.requesterId, ...acceptedIds];

    if (!calendarEventId) {
      // Create calendar event on first acceptance
      const calendarEvent = storage.createCalendarEvent({
        title: request.title,
        description: request.description,
        userId: request.requesterId,
        startDate,
        endDate,
        allDay: request.allDay,
        type: "meeting",
        color: "#4F6BED",
        attendees: JSON.stringify(allAttendees),
      });
      broadcastAll("calendar:created", calendarEvent);
      calendarEventId = calendarEvent.id;
    } else {
      // Update attendees on existing calendar event
      storage.updateCalendarEvent(calendarEventId, {
        attendees: JSON.stringify(allAttendees),
      });
      broadcastAll("calendar:updated", { id: calendarEventId });
    }

    const updated = storage.updateMeetingRequest(request.id, {
      status: overallStatus,
      responses: JSON.stringify(responses),
      calendarEventId,
    });
    broadcastAll("meeting-request:updated", updated);

    // Notify requester and other recipients
    const notifyIds = [request.requesterId, ...recipientIds].filter(id => id !== user.id);
    for (const id of notifyIds) {
      notifyUser(
        id,
        "meeting_accepted",
        "Meeting Accepted",
        `${user.displayName} accepted the meeting: "${request.title}"`,
        "/calendar"
      );
      const u = storage.getUser(id);
      if (u?.email) {
        sendMeetingAcceptedEmail(u.email, user.displayName, request.title, startDate, endDate, !!request.allDay);
      }
    }
    res.json(updated);
  });

  app.put("/api/meeting-requests/:id/decline", requireAuth, (req, res) => {
    const user = req.user as any;
    const request = storage.getMeetingRequest(Number(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    const recipientIds: number[] = JSON.parse(request.recipientIds || "[]");
    if (!recipientIds.includes(user.id) && request.requesterId !== user.id) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const responses: Record<string, string> = JSON.parse(request.responses || "{}");
    responses[String(user.id)] = "declined";
    const overallStatus = computeMeetingStatus(responses);

    const updated = storage.updateMeetingRequest(request.id, {
      status: overallStatus,
      responses: JSON.stringify(responses),
      responseMessage: req.body.message || "",
    });
    broadcastAll("meeting-request:updated", updated);

    // Notify requester
    notifyUser(
      request.requesterId,
      "meeting_declined",
      "Meeting Declined",
      `${user.displayName} declined the meeting: "${request.title}"`,
      "/meetings"
    );
    const requester = storage.getUser(request.requesterId);
    if (requester?.email) {
      sendMeetingDeclinedEmail(requester.email, user.displayName, request.title, req.body.message);
    }
    res.json(updated);
  });

  app.put("/api/meeting-requests/:id/propose-new-time", requireAuth, (req, res) => {
    const user = req.user as any;
    const request = storage.getMeetingRequest(Number(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    const recipientIds: number[] = JSON.parse(request.recipientIds || "[]");
    if (!recipientIds.includes(user.id) && request.requesterId !== user.id) {
      return res.status(403).json({ message: "Not authorized" });
    }
    const { proposedNewStartDate, proposedNewEndDate, message } = req.body;
    if (!proposedNewStartDate || !proposedNewEndDate) {
      return res.status(400).json({ message: "New times are required" });
    }

    // Mark this user's response and reset others to pending
    const responses: Record<string, string> = JSON.parse(request.responses || "{}");
    for (const key of Object.keys(responses)) {
      responses[key] = key === String(user.id) ? "new_time_proposed" : "pending";
    }

    const updated = storage.updateMeetingRequest(request.id, {
      status: "new_time_proposed",
      responses: JSON.stringify(responses),
      proposedNewStartDate,
      proposedNewEndDate,
      responseMessage: message || "",
    });
    broadcastAll("meeting-request:updated", updated);

    // Notify all other parties
    const notifyIds = [request.requesterId, ...recipientIds].filter(id => id !== user.id);
    for (const id of notifyIds) {
      notifyUser(
        id,
        "meeting_new_time",
        "New Time Proposed",
        `${user.displayName} proposed a new time for: "${request.title}"`,
        "/meetings"
      );
      const u = storage.getUser(id);
      if (u?.email) {
        sendMeetingNewTimeEmail(u.email, user.displayName, request.title, proposedNewStartDate, proposedNewEndDate, !!request.allDay, message);
      }
    }
    res.json(updated);
  });

  app.delete("/api/meeting-requests/:id", requireAuth, (req, res) => {
    const user = req.user as any;
    const request = storage.getMeetingRequest(Number(req.params.id));
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.requesterId !== user.id) {
      return res.status(403).json({ message: "Only the requester can cancel" });
    }
    storage.deleteMeetingRequest(request.id);
    broadcastAll("meeting-request:deleted", { id: request.id });
    res.json({ ok: true });
  });

  // ── Knowledge Base Routes ────────────────────────
  app.get("/api/knowledge", requireAuth, (_req, res) => {
    const articles = storage.getAllKnowledgeArticles();
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    const allFiles = storage.getAllFiles();
    const fileMap = new Map(allFiles.map(f => [f.id, f]));
    res.json(articles.map(a => {
      const attachmentIds: number[] = (() => { try { return JSON.parse(a.attachments); } catch { return []; } })();
      return {
        ...a,
        createdByUser: userMap.get(a.createdBy),
        updatedByUser: a.updatedBy ? userMap.get(a.updatedBy) : null,
        attachmentFiles: attachmentIds.map(id => fileMap.get(id)).filter(Boolean),
      };
    }));
  });

  app.get("/api/knowledge/:id", requireAuth, (req, res) => {
    const article = storage.getKnowledgeArticle(Number(req.params.id));
    if (!article) return res.status(404).json({ message: "Article not found" });
    const allUsers = storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, safeUser(u)]));
    const allFiles = storage.getAllFiles();
    const fileMap = new Map(allFiles.map(f => [f.id, f]));
    const attachmentIds: number[] = (() => { try { return JSON.parse(article.attachments); } catch { return []; } })();
    res.json({
      ...article,
      createdByUser: userMap.get(article.createdBy),
      updatedByUser: article.updatedBy ? userMap.get(article.updatedBy) : null,
      attachmentFiles: attachmentIds.map(id => fileMap.get(id)).filter(Boolean),
    });
  });

  app.post("/api/knowledge", requireAuth, (req, res) => {
    const user = req.user as any;
    const article = storage.createKnowledgeArticle({ ...req.body, createdBy: user.id });
    broadcastAll("knowledge:created", article);
    res.json(article);
  });

  app.put("/api/knowledge/:id", requireAuth, (req, res) => {
    const user = req.user as any;
    const updated = storage.updateKnowledgeArticle(Number(req.params.id), { ...req.body, updatedBy: user.id });
    if (!updated) return res.status(404).json({ message: "Article not found" });
    broadcastAll("knowledge:updated", updated);
    res.json(updated);
  });

  app.delete("/api/knowledge/:id", requireAuth, (req, res) => {
    storage.deleteKnowledgeArticle(Number(req.params.id));
    broadcastAll("knowledge:deleted", { id: Number(req.params.id) });
    res.json({ ok: true });
  });

  // Upload attachment for knowledge base article
  app.post("/api/knowledge/upload", requireAuth, upload.single("file"), (req, res) => {
    const user = req.user as any;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No file uploaded" });
    const record = storage.createFile({
      userId: user.id,
      folderId: null,
      originalName: file.originalname,
      storedName: file.filename,
      size: file.size,
      mimeType: file.mimetype,
    });
    res.json(record);
  });

  // ── AI Routes ────────────────────────────────────
  app.get("/api/ai/status", requireAuth, (_req, res) => {
    res.json({
      aiEnabled: isAIEnabled(),
      vectorStoreEnabled: isVectorStoreEnabled(),
    });
  });

  // AI Conversations
  app.get("/api/ai/conversations", requireAuth, (req, res) => {
    const user = req.user as any;
    res.json(storage.getConversationsByUser(user.id));
  });

  app.post("/api/ai/conversations", requireAuth, (req, res) => {
    const user = req.user as any;
    const conv = storage.createConversation({ userId: user.id, title: req.body.title || "New Conversation" });
    res.json(conv);
  });

  app.delete("/api/ai/conversations/:id", requireAuth, (req, res) => {
    const conv = storage.getConversation(Number(req.params.id));
    if (!conv) return res.status(404).json({ message: "Not found" });
    const user = req.user as any;
    if (conv.userId !== user.id) return res.status(403).json({ message: "Not yours" });
    storage.deleteConversation(conv.id);
    res.json({ ok: true });
  });

  app.get("/api/ai/conversations/:id/messages", requireAuth, (req, res) => {
    res.json(storage.getMessagesByConversation(Number(req.params.id)));
  });

  // AI Chat (streaming)
  app.post("/api/ai/chat", requireAuth, async (req, res) => {
    if (!isAIEnabled()) return res.status(503).json({ message: "AI not configured" });

    const user = req.user as any;
    const { conversationId, message } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: "Message required" });

    let convId = conversationId;
    if (!convId) {
      const conv = storage.createConversation({ userId: user.id, title: message.slice(0, 60) });
      convId = conv.id;
    }

    // Save user message
    storage.createAiMessage({ conversationId: convId, role: "user", content: message });

    // Get conversation history
    const history = storage.getMessagesByConversation(convId);
    const chatMessages: ChatMessage[] = [];

    // Build RAG context
    let ragContext = "";
    if (isVectorStoreEnabled()) {
      ragContext = await getRAGContext(message);
    } else {
      // Fallback: keyword search across local content
      const allTasks = storage.getAllTasks();
      const allContent = allTasks.map(t => ({
        sourceType: "task",
        sourceId: t.id,
        sourceName: t.title,
        content: `Task: ${t.title}\nDescription: ${t.description}\nStatus: ${t.status}\nPriority: ${t.priority}\nPhase: ${t.phase}`,
      }));
      const results = keywordSearch(message, allContent);
      if (results.length) {
        ragContext = results.map(r => `[${r.source_name}]\n${r.content}`).join("\n\n---\n\n");
      }
    }

    // System prompt
    const systemPrompt = `You are the HomeDirectAI assistant, an AI helper embedded in the HomeDirectAI team collaboration hub. You help team members with questions about their projects, tasks, files, and company information.

You are knowledgeable about real estate technology, AI-powered real estate platforms, Florida real estate regulations, and startup operations.

Be concise, helpful, and professional. When referencing specific tasks or documents, cite them clearly.

${ragContext ? `\n--- RELEVANT CONTEXT FROM COMPANY DATA ---\n${ragContext}\n--- END CONTEXT ---\n\nUse the above context to inform your answers when relevant. If the context doesn't contain the answer, say so and provide your best general knowledge.` : ""}

Current user: ${user.displayName}
Current date: ${new Date().toLocaleDateString()}`;

    chatMessages.push({ role: "system", content: systemPrompt });

    // Add conversation history (last 20 messages for context window)
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      if (msg.role === "user" || msg.role === "assistant") {
        chatMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
      }
    }

    // Stream response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send conversation ID first
    res.write(`data: ${JSON.stringify({ type: "meta", conversationId: convId })}\n\n`);

    try {
      let fullResponse = "";
      for await (const chunk of chatCompletionStream(chatMessages)) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
      }

      // Save assistant response
      storage.createAiMessage({ conversationId: convId, role: "assistant", content: fullResponse });

      // Auto-title the conversation from first message
      if (history.length === 0) {
        const title = message.length > 50 ? message.slice(0, 50) + "..." : message;
        storage.updateConversationTitle(convId, title);
      }

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("[ai] Chat error:", err);
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message || "AI error" })}\n\n`);
      res.end();
    }
  });

  // AI Semantic Search
  app.get("/api/ai/search", requireAuth, async (req, res) => {
    const query = (req.query.q as string) || "";
    if (!query || query.length < 2) return res.json([]);

    if (isVectorStoreEnabled()) {
      const results = await semanticSearch(query, { limit: 15 });
      res.json(results);
    } else if (isAIEnabled()) {
      // Fallback keyword search
      const allTasks = storage.getAllTasks();
      const allAnnouncements = storage.getAnnouncements();
      const allContent = [
        ...allTasks.map(t => ({
          sourceType: "task", sourceId: t.id, sourceName: t.title,
          content: `${t.title} ${t.description} ${t.status} ${t.priority} ${t.category}`,
        })),
        ...allAnnouncements.map(a => ({
          sourceType: "announcement", sourceId: a.id, sourceName: a.title,
          content: `${a.title} ${a.content}`,
        })),
      ];
      res.json(keywordSearch(query, allContent, 15));
    } else {
      res.json([]);
    }
  });

  // Index a file into the vector store (triggered on upload)
  app.post("/api/ai/index-file/:fileId", requireAuth, async (req, res) => {
    if (!isVectorStoreEnabled()) return res.json({ indexed: 0, message: "Vector store not configured" });
    const file = storage.getFile(Number(req.params.fileId));
    if (!file) return res.status(404).json({ message: "File not found" });

    const filePath = path.join(uploadDir, file.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not on disk" });

    const content = fs.readFileSync(filePath);
    const text = extractTextFromFile(content, file.mimeType, file.originalName);
    if (!text) return res.json({ indexed: 0, message: "Unsupported file type for indexing" });

    const count = await indexDocument("file", file.id, file.originalName, text);
    res.json({ indexed: count });
  });

  // Bulk re-index all content
  app.post("/api/ai/reindex", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (user.role !== "admin") return res.status(403).json({ message: "Admins only" });
    if (!isVectorStoreEnabled()) return res.json({ message: "Vector store not configured" });

    let total = 0;

    // Index tasks
    const tasks = storage.getAllTasks();
    for (const t of tasks) {
      const text = `Task: ${t.title}\nDescription: ${t.description}\nStatus: ${t.status}\nPriority: ${t.priority}\nPhase: ${t.phase}\nCategory: ${t.category}`;
      total += await indexDocument("task", t.id, t.title, text);
    }

    // Index announcements
    const announcements = storage.getAnnouncements();
    for (const a of announcements) {
      total += await indexDocument("announcement", a.id, a.title, `${a.title}\n${a.content}`);
    }

    // Index text files
    const files = storage.getAllFiles();
    for (const f of files) {
      const filePath = path.join(uploadDir, f.storedName);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath);
      const text = extractTextFromFile(content, f.mimeType, f.originalName);
      if (text) total += await indexDocument("file", f.id, f.originalName, text);
    }

    res.json({ indexed: total, message: `Indexed ${total} chunks` });
  });

  // ── Dashboard Stats ──────────────────────────────
  app.get("/api/dashboard/stats", requireAuth, (_req, res) => {
    const allTasks = storage.getAllTasks();
    const allMilestones = storage.getMilestones();
    const allUsers = storage.getAllUsers();
    const online = getOnlineUsers();

    res.json({
      totalTasks: allTasks.length,
      tasksByStatus: {
        todo: allTasks.filter(t => t.status === "todo").length,
        "in-progress": allTasks.filter(t => t.status === "in-progress").length,
        review: allTasks.filter(t => t.status === "review").length,
        done: allTasks.filter(t => t.status === "done").length,
      },
      milestonesCompleted: allMilestones.filter(m => m.status === "completed").length,
      milestonesTotal: allMilestones.length,
      teamMembers: allUsers.length,
      onlineMembers: online.length,
    });
  });

  // ── WebSocket ────────────────────────────────────
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.event === "auth") {
          const user = storage.getUser(msg.data.userId);
          if (user) {
            wsClients.set(ws, { ws, userId: user.id, username: user.username });
            broadcastAll("online:update", getOnlineUsers());
          }
        }

        if (msg.event === "chat:join") {
          const client = wsClients.get(ws);
          if (client) {
            client.channelId = msg.data.channelId;
          }
        }

        if (msg.event === "chat:message") {
          const client = wsClients.get(ws);
          if (client) {
            const saved = storage.createMessage({
              channelId: msg.data.channelId,
              userId: client.userId,
              content: msg.data.content,
            });
            const user = storage.getUser(client.userId);
            broadcast("chat:message", {
              ...saved,
              user: user ? safeUser(user) : null,
            }, msg.data.channelId);

            if (user) {
              const channel = storage.getChannel(msg.data.channelId);
              const channelName = channel?.name || "chat";
              const preview = msg.data.content.length > 80 ? msg.data.content.slice(0, 80) + "..." : msg.data.content;
              const allUsers = storage.getAllUsers();

              // Detect @mentions by matching against known display names
              const contentLower = msg.data.content.toLowerCase();
              const mentionedUserIds = new Set<number>();
              for (const u of allUsers) {
                const pattern = "@" + u.displayName.toLowerCase();
                if (contentLower.includes(pattern)) {
                  mentionedUserIds.add(u.id);
                }
              }

              const messageLink = `/chat?channel=${msg.data.channelId}&msgId=${saved.id}`;

              for (const u of allUsers) {
                if (u.id !== client.userId) {
                  if (mentionedUserIds.has(u.id)) {
                    // Tagged mention — only notify when explicitly @mentioned
                    notifyUser(
                      u.id,
                      "chat_mention",
                      `Mentioned in #${channelName}`,
                      `${user.displayName} tagged you: ${preview}`,
                      messageLink
                    );
                  }
                }
              }
            }
          }
        }

        if (msg.event === "chat:reaction") {
          const client = wsClients.get(ws);
          if (client) {
            const { messageId, emoji } = msg.data;
            // Toggle: if already reacted, remove; otherwise add
            const existing = storage.findReaction(messageId, client.userId, emoji);
            if (existing) {
              storage.removeReaction(messageId, client.userId, emoji);
            } else {
              storage.addReaction({ messageId, userId: client.userId, emoji });
            }
            // Fetch updated reactions for this message and broadcast to everyone
            const reactions = storage.getReactionsByMessage(messageId);
            broadcastAll("chat:reaction", { messageId, reactions });
          }
        }

        if (msg.event === "chat:typing") {
          const client = wsClients.get(ws);
          if (client) {
            broadcast("chat:typing", {
              userId: client.userId,
              username: client.username,
              channelId: msg.data.channelId,
            }, msg.data.channelId);
          }
        }
      } catch {}
    });

    ws.on("close", () => {
      wsClients.delete(ws);
      broadcastAll("online:update", getOnlineUsers());
    });
  });

  return httpServer;
}
