import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import {
  insertUserSchema, insertChannelSchema, insertMessageSchema,
  insertTaskSchema, insertTodoSchema, insertAnnouncementSchema,
  insertMilestoneSchema,
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
  app.get("/api/messages/:channelId", requireAuth, (req, res) => {
    const msgs = storage.getMessagesByChannel(Number(req.params.channelId));
    res.json(msgs.map((m) => ({
      ...m,
      user: m.user ? safeUser(m.user) : null,
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
    res.json(task);
  });

  app.put("/api/tasks/:id", requireAuth, (req, res) => {
    const updated = storage.updateTask(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    broadcastAll("task:updated", updated);
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
    const record = storage.createFile({
      userId: user.id,
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
