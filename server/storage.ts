import {
  type User, type InsertUser, users,
  type Channel, type InsertChannel, channels,
  type Message, type InsertMessage, messages,
  type Task, type InsertTask, tasks,
  type Todo, type InsertTodo, todos,
  type FileRecord, type InsertFile, files,
  type Announcement, type InsertAnnouncement, announcements,
  type Milestone, type InsertMilestone, milestones,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, asc } from "drizzle-orm";
import { hashSync, compareSync } from "bcryptjs";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

function now() {
  return new Date().toISOString();
}

// ── Storage Interface ──────────────────────────────
export interface IStorage {
  // Users
  getUser(id: number): User | undefined;
  getUserByUsername(username: string): User | undefined;
  getUserByEmail(email: string): User | undefined;
  createUser(user: InsertUser): User;
  getAllUsers(): User[];
  updateUserRole(id: number, role: string): User | undefined;

  // Channels
  getChannels(): Channel[];
  getChannel(id: number): Channel | undefined;
  createChannel(channel: InsertChannel): Channel;

  // Messages
  getMessagesByChannel(channelId: number, limit?: number): (Message & { user?: User })[];
  createMessage(message: InsertMessage): Message;

  // Tasks
  getAllTasks(): Task[];
  getTask(id: number): Task | undefined;
  createTask(task: InsertTask): Task;
  updateTask(id: number, data: Partial<InsertTask>): Task | undefined;
  deleteTask(id: number): void;

  // Todos
  getTodosByUser(userId: number): Todo[];
  createTodo(todo: InsertTodo): Todo;
  updateTodo(id: number, data: Partial<InsertTodo>): Todo | undefined;
  deleteTodo(id: number): void;

  // Files
  getAllFiles(): FileRecord[];
  getFile(id: number): FileRecord | undefined;
  createFile(file: InsertFile): FileRecord;
  deleteFile(id: number): void;

  // Announcements
  getAnnouncements(): Announcement[];
  createAnnouncement(ann: InsertAnnouncement): Announcement;
  deleteAnnouncement(id: number): void;

  // Milestones
  getMilestones(): Milestone[];
  createMilestone(m: InsertMilestone): Milestone;
  updateMilestone(id: number, data: Partial<InsertMilestone>): Milestone | undefined;

  // Auth helpers
  verifyPassword(plain: string, hash: string): boolean;
  hashPassword(plain: string): string;

  // Seed
  seed(): void;
}

// ── Database Storage ───────────────────────────────
export class DatabaseStorage implements IStorage {
  // ── Users ──
  getUser(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  getUserByUsername(username: string): User | undefined {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  getUserByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email)).get();
  }
  createUser(data: InsertUser): User {
    return db.insert(users).values({
      ...data,
      password: this.hashPassword(data.password),
      createdAt: now(),
    }).returning().get();
  }
  getAllUsers(): User[] {
    return db.select().from(users).all();
  }
  updateUserRole(id: number, role: string): User | undefined {
    return db.update(users).set({ role }).where(eq(users.id, id)).returning().get();
  }

  // ── Channels ──
  getChannels(): Channel[] {
    return db.select().from(channels).orderBy(asc(channels.id)).all();
  }
  getChannel(id: number): Channel | undefined {
    return db.select().from(channels).where(eq(channels.id, id)).get();
  }
  createChannel(data: InsertChannel): Channel {
    return db.insert(channels).values({ ...data, createdAt: now() }).returning().get();
  }

  // ── Messages ──
  getMessagesByChannel(channelId: number, limit = 100): (Message & { user?: User })[] {
    const msgs = db.select().from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(asc(messages.id))
      .limit(limit)
      .all();
    return msgs.map(msg => {
      const user = this.getUser(msg.userId);
      return { ...msg, user };
    });
  }
  createMessage(data: InsertMessage): Message {
    return db.insert(messages).values({ ...data, createdAt: now() }).returning().get();
  }

  // ── Tasks ──
  getAllTasks(): Task[] {
    return db.select().from(tasks).orderBy(desc(tasks.id)).all();
  }
  getTask(id: number): Task | undefined {
    return db.select().from(tasks).where(eq(tasks.id, id)).get();
  }
  createTask(data: InsertTask): Task {
    return db.insert(tasks).values({ ...data, createdAt: now() }).returning().get();
  }
  updateTask(id: number, data: Partial<InsertTask>): Task | undefined {
    return db.update(tasks).set(data).where(eq(tasks.id, id)).returning().get();
  }
  deleteTask(id: number): void {
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }

  // ── Todos ──
  getTodosByUser(userId: number): Todo[] {
    return db.select().from(todos).where(eq(todos.userId, userId)).orderBy(desc(todos.id)).all();
  }
  createTodo(data: InsertTodo): Todo {
    return db.insert(todos).values({ ...data, createdAt: now() }).returning().get();
  }
  updateTodo(id: number, data: Partial<InsertTodo>): Todo | undefined {
    return db.update(todos).set(data).where(eq(todos.id, id)).returning().get();
  }
  deleteTodo(id: number): void {
    db.delete(todos).where(eq(todos.id, id)).run();
  }

  // ── Files ──
  getAllFiles(): FileRecord[] {
    return db.select().from(files).orderBy(desc(files.id)).all();
  }
  getFile(id: number): FileRecord | undefined {
    return db.select().from(files).where(eq(files.id, id)).get();
  }
  createFile(data: InsertFile): FileRecord {
    return db.insert(files).values({ ...data, createdAt: now() }).returning().get();
  }
  deleteFile(id: number): void {
    db.delete(files).where(eq(files.id, id)).run();
  }

  // ── Announcements ──
  getAnnouncements(): Announcement[] {
    return db.select().from(announcements).orderBy(desc(announcements.pinned), desc(announcements.id)).all();
  }
  createAnnouncement(data: InsertAnnouncement): Announcement {
    return db.insert(announcements).values({ ...data, createdAt: now() }).returning().get();
  }
  deleteAnnouncement(id: number): void {
    db.delete(announcements).where(eq(announcements.id, id)).run();
  }

  // ── Milestones ──
  getMilestones(): Milestone[] {
    return db.select().from(milestones).orderBy(asc(milestones.sortOrder)).all();
  }
  createMilestone(data: InsertMilestone): Milestone {
    return db.insert(milestones).values({ ...data, createdAt: now() }).returning().get();
  }
  updateMilestone(id: number, data: Partial<InsertMilestone>): Milestone | undefined {
    return db.update(milestones).set(data).where(eq(milestones.id, id)).returning().get();
  }

  // ── Auth ──
  hashPassword(plain: string): string {
    return hashSync(plain, 10);
  }
  verifyPassword(plain: string, hash: string): boolean {
    return compareSync(plain, hash);
  }

  // ── Seed ──
  seed() {
    // Create tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        avatar_color TEXT NOT NULL DEFAULT '#4F6BED',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        assigned_to INTEGER,
        created_by INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        category TEXT NOT NULL DEFAULT 'general',
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        target_date TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Seed only if no users exist
    const existingUser = db.select().from(users).get();
    if (existingUser) return;

    const colors = ["#4F6BED", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

    // Create default users
    this.createUser({
      username: "michael",
      email: "michael@homedirectai.com",
      password: "admin123",
      displayName: "Michael Cain",
      role: "admin",
      avatarColor: colors[0],
    });
    this.createUser({
      username: "james",
      email: "james@homedirectai.com",
      password: "admin123",
      displayName: "James Cain",
      role: "admin",
      avatarColor: colors[1],
    });

    // Create channels
    const channelData: InsertChannel[] = [
      { name: "general", description: "General team discussion", isDefault: 1 },
      { name: "engineering", description: "Technical development & architecture" },
      { name: "product", description: "Product decisions & feature planning" },
      { name: "marketing", description: "Marketing, growth & user acquisition" },
      { name: "legal", description: "Legal, compliance & licensing" },
    ];
    const createdChannels: Channel[] = [];
    for (const ch of channelData) {
      createdChannels.push(this.createChannel(ch));
    }

    // Seed welcome messages
    this.createMessage({ channelId: createdChannels[0].id, userId: 1, content: "Welcome to HomeDirectAI HQ! This is our internal hub for getting the business off the ground." });
    this.createMessage({ channelId: createdChannels[0].id, userId: 2, content: "Let's do this! First priority: qualifying broker and LLC formation." });

    // Seed milestones
    const milestoneData: InsertMilestone[] = [
      { title: "Business Formation", description: "LLC filing, operating agreement, EIN, bank account", status: "in-progress", targetDate: "2026-04-30", sortOrder: 1 },
      { title: "Licensing & Compliance", description: "Qualifying broker hire, FREC brokerage registration, escrow account", status: "pending", targetDate: "2026-05-31", sortOrder: 2 },
      { title: "MVP Hardening", description: "Fix remaining bugs, integrate real MLS data, real payment processing", status: "in-progress", targetDate: "2026-05-15", sortOrder: 3 },
      { title: "AI Engine Deployment", description: "Deploy Together AI fine-tuned model, set up RAG pipeline", status: "pending", targetDate: "2026-06-15", sortOrder: 4 },
      { title: "Beta Launch (Tampa Bay)", description: "Invite-only beta with first 50 users in Tampa area", status: "pending", targetDate: "2026-07-01", sortOrder: 5 },
      { title: "Marketing Campaign", description: "SEO, local Facebook groups, Nextdoor, initial paid ads", status: "pending", targetDate: "2026-07-15", sortOrder: 6 },
      { title: "Public Launch", description: "Full commercial availability in Tampa Bay market", status: "pending", targetDate: "2026-08-01", sortOrder: 7 },
    ];
    for (const m of milestoneData) {
      this.createMilestone(m);
    }

    // Seed initial tasks
    const taskData: InsertTask[] = [
      { title: "File Florida LLC", description: "Articles of Organization, $125 filing fee, registered agent", assignedTo: 1, createdBy: 1, status: "in-progress", priority: "urgent", category: "legal" },
      { title: "Draft Operating Agreement", description: "Define ownership split, roles, decision-making authority", assignedTo: 2, createdBy: 1, status: "todo", priority: "high", category: "legal" },
      { title: "Find Qualifying Broker", description: "Research broker-of-record services in FL, target $2-3K/mo", assignedTo: 2, createdBy: 1, status: "todo", priority: "urgent", category: "legal" },
      { title: "Set Up Together AI Account", description: "Sign up, get API key, test LLM integration", assignedTo: 1, createdBy: 1, status: "todo", priority: "high", category: "engineering" },
      { title: "Integrate Stripe Live Keys", description: "Switch from test mode to production Stripe keys", assignedTo: 1, createdBy: 2, status: "todo", priority: "medium", category: "engineering" },
      { title: "Design Logo & Brand Kit", description: "Professional logo, colors, typography for HomeDirectAI", assignedTo: 2, createdBy: 1, status: "todo", priority: "medium", category: "marketing" },
      { title: "Write Terms of Service", description: "Legal ToS and Privacy Policy for the platform", assignedTo: null, createdBy: 1, status: "todo", priority: "high", category: "legal", dueDate: "2026-05-01" },
      { title: "Set Up Business Bank Account", description: "Open business checking account for LLC", assignedTo: 1, createdBy: 2, status: "todo", priority: "high", category: "operations" },
      { title: "Research Title Company Partners", description: "Find title companies willing to partner for closings", assignedTo: 2, createdBy: 1, status: "todo", priority: "medium", category: "operations" },
      { title: "MLS API Production Access", description: "Upgrade RapidAPI plan for production MLS data", assignedTo: 1, createdBy: 1, status: "todo", priority: "high", category: "engineering" },
    ];
    for (const t of taskData) {
      this.createTask(t);
    }

    // Seed announcements
    this.createAnnouncement({
      userId: 1,
      title: "HomeDirectAI HQ is Live",
      content: "Welcome to our internal project hub! Use this to track tasks, share files, and coordinate everything we need to launch. Chat channels are set up for each area of the business.",
      pinned: 1,
    });
  }
}

export const storage = new DatabaseStorage();
