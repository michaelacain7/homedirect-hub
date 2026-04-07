import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import {
  insertUserSchema, insertChannelSchema, insertMessageSchema,
  insertTaskSchema, insertTodoSchema, insertAnnouncementSchema,
  insertMilestoneSchema, insertNotificationSchema, insertCalendarEventSchema,
} from "@shared/schema";
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
    res.json(allTasks.map(t => ({
      ...t,
      assignedUser: t.assignedTo ? userMap.get(t.assignedTo) : null,
      createdByUser: userMap.get(t.createdBy),
    })));
  });

  app.post("/api/tasks", requireAuth, (req, res) => {
    const user = req.user as any;
    const task = storage.createTask({ ...req.body, createdBy: user.id });
    broadcastAll("task:created", task);
    // Notify assigned user
    if (task.assignedTo && task.assignedTo !== user.id) {
      const assignedUser = storage.getUser(task.assignedTo);
      if (assignedUser) {
        notifyUser(
          task.assignedTo,
          "task_assigned",
          "New Task Assigned",
          `${user.displayName} assigned you: "${task.title}"`,
          "/tasks"
        );
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
    // Notify if assignment changed
    if (req.body.assignedTo && req.body.assignedTo !== oldTask?.assignedTo && req.body.assignedTo !== user.id) {
      notifyUser(
        req.body.assignedTo,
        "task_assigned",
        "Task Assigned to You",
        `${user.displayName} assigned you: "${updated.title}"`,
        "/tasks"
      );
    }
    res.json(updated);
  });

  app.delete("/api/tasks/:id", requireAuth, (req, res) => {
    storage.deleteTask(Number(req.params.id));
    broadcastAll("task:deleted", { id: Number(req.params.id) });
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

  // Helper: create notification and push via WebSocket
  function notifyUser(userId: number, type: string, title: string, body: string, linkTo?: string) {
    const notif = storage.createNotification({ userId, type, title, body, linkTo, read: 0 });
    // Push to connected WebSocket clients for this user
    wsClients.forEach((client) => {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ event: "notification:new", data: notif }));
      }
    });
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
                    // Tagged mention — higher priority notification
                    notifyUser(
                      u.id,
                      "chat_mention",
                      `Mentioned in #${channelName}`,
                      `${user.displayName} tagged you: ${preview}`,
                      messageLink
                    );
                  } else {
                    // Regular chat notification
                    notifyUser(
                      u.id,
                      "chat_message",
                      `#${channelName}`,
                      `${user.displayName}: ${preview}`,
                      "/chat"
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
