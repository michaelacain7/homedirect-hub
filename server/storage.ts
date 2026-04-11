import {
  type User, type InsertUser, users,
  type Channel, type InsertChannel, channels,
  type Message, type InsertMessage, messages,
  type Task, type InsertTask, tasks,
  type Todo, type InsertTodo, todos,
  type FileFolder, type InsertFileFolder, fileFolders,
  type FileRecord, type InsertFile, files,
  type Announcement, type InsertAnnouncement, announcements,
  type Milestone, type InsertMilestone, milestones,
  type Notification, type InsertNotification, notifications,
  type MessageReaction, type InsertMessageReaction, messageReactions,
  type CalendarEvent, type InsertCalendarEvent, calendarEvents,
  type MeetingRequest, type InsertMeetingRequest, meetingRequests,
  type TaskComment, type InsertTaskComment, taskComments,
  type DocumentChunk, type InsertDocumentChunk, documentChunks,
  type AiConversation, type InsertAiConversation, aiConversations,
  type AiMessage, type InsertAiMessage, aiMessages,
  type KnowledgeArticle, type InsertKnowledgeArticle, knowledgeArticles,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, asc } from "drizzle-orm";
import { hashSync, compareSync } from "bcryptjs";
import path from "path";

// Use DATABASE_PATH env var for Railway Volume persistence, default to local
const dbPath = process.env.DATABASE_PATH || "data.db";
console.log(`[db] Using database at: ${dbPath}`);
const sqlite = new Database(dbPath);
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

  // User profile updates
  updateUserProfile(id: number, data: { title?: string; reportsTo?: number | null }): User | undefined;

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

  // File Folders
  getAllFileFolders(): FileFolder[];
  createFileFolder(f: InsertFileFolder): FileFolder;
  updateFileFolder(id: number, data: Partial<InsertFileFolder>): FileFolder | undefined;
  deleteFileFolder(id: number): void;

  // Files
  getAllFiles(): FileRecord[];
  getFile(id: number): FileRecord | undefined;
  createFile(file: InsertFile): FileRecord;
  moveFileToFolder(fileId: number, folderId: number | null): FileRecord | undefined;
  deleteFile(id: number): void;

  // Announcements
  getAnnouncements(): Announcement[];
  createAnnouncement(ann: InsertAnnouncement): Announcement;
  deleteAnnouncement(id: number): void;

  // Milestones
  getMilestones(): Milestone[];
  createMilestone(m: InsertMilestone): Milestone;
  updateMilestone(id: number, data: Partial<InsertMilestone>): Milestone | undefined;

  // Notifications
  getNotificationsByUser(userId: number, limit?: number): Notification[];
  getUnreadCount(userId: number): number;
  createNotification(n: InsertNotification): Notification;
  markNotificationRead(id: number): Notification | undefined;
  markAllRead(userId: number): void;

  // Message Search
  searchMessages(query: string, channelId?: number): (Message & { user?: { displayName: string; avatarColor: string }; channelName?: string })[];

  // Message Reactions
  getReactionsByMessage(messageId: number): MessageReaction[];
  getReactionsByMessages(messageIds: number[]): MessageReaction[];
  addReaction(data: InsertMessageReaction): MessageReaction;
  removeReaction(messageId: number, userId: number, emoji: string): void;
  findReaction(messageId: number, userId: number, emoji: string): MessageReaction | undefined;

  // Calendar Events
  getAllCalendarEvents(): CalendarEvent[];
  getCalendarEventsByUser(userId: number): CalendarEvent[];
  getCalendarEvent(id: number): CalendarEvent | undefined;
  createCalendarEvent(event: InsertCalendarEvent): CalendarEvent;
  updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): CalendarEvent | undefined;
  deleteCalendarEvent(id: number): void;

  // Task Comments
  getTaskComments(taskId: number): TaskComment[];
  createTaskComment(data: InsertTaskComment): TaskComment;
  deleteTaskComment(id: number): void;

  // Meeting Requests
  getMeetingRequestsByUser(userId: number): MeetingRequest[];
  getMeetingRequest(id: number): MeetingRequest | undefined;
  createMeetingRequest(data: InsertMeetingRequest): MeetingRequest;
  updateMeetingRequest(id: number, data: Partial<InsertMeetingRequest>): MeetingRequest | undefined;
  deleteMeetingRequest(id: number): void;

  // Auth helpers
  verifyPassword(plain: string, hash: string): boolean;
  hashPassword(plain: string): string;

  // Knowledge Base
  getAllKnowledgeArticles(): KnowledgeArticle[];
  getKnowledgeArticle(id: number): KnowledgeArticle | undefined;
  createKnowledgeArticle(data: InsertKnowledgeArticle): KnowledgeArticle;
  updateKnowledgeArticle(id: number, data: Partial<InsertKnowledgeArticle>): KnowledgeArticle | undefined;
  deleteKnowledgeArticle(id: number): void;

  // Document Chunks (RAG)
  getChunksBySource(sourceType: string, sourceId: number): DocumentChunk[];
  getAllChunks(): DocumentChunk[];
  createDocumentChunk(data: InsertDocumentChunk): DocumentChunk;
  deleteChunksBySource(sourceType: string, sourceId: number): void;

  // AI Conversations
  getConversationsByUser(userId: number): AiConversation[];
  getConversation(id: number): AiConversation | undefined;
  createConversation(data: InsertAiConversation): AiConversation;
  updateConversationTitle(id: number, title: string): AiConversation | undefined;
  deleteConversation(id: number): void;

  // AI Messages
  getMessagesByConversation(conversationId: number): AiMessage[];
  createAiMessage(data: InsertAiMessage): AiMessage;

  // User merge
  mergeUsers(keepId: number, removeId: number): void;

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
  updateUserProfile(id: number, data: { title?: string; reportsTo?: number | null }): User | undefined {
    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.reportsTo !== undefined) updateData.reportsTo = data.reportsTo;
    return db.update(users).set(updateData).where(eq(users.id, id)).returning().get();
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

  // ── File Folders ──
  getAllFileFolders(): FileFolder[] {
    return db.select().from(fileFolders).orderBy(fileFolders.name).all();
  }
  createFileFolder(data: InsertFileFolder): FileFolder {
    return db.insert(fileFolders).values(data).returning().get();
  }
  updateFileFolder(id: number, data: Partial<InsertFileFolder>): FileFolder | undefined {
    return db.update(fileFolders).set(data).where(eq(fileFolders.id, id)).returning().get();
  }
  deleteFileFolder(id: number): void {
    // Move files in this folder to uncategorized
    db.update(files).set({ folderId: null }).where(eq(files.folderId, id)).run();
    db.delete(fileFolders).where(eq(fileFolders.id, id)).run();
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
  moveFileToFolder(fileId: number, folderId: number | null): FileRecord | undefined {
    return db.update(files).set({ folderId }).where(eq(files.id, fileId)).returning().get();
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

  // ── Notifications ──
  getNotificationsByUser(userId: number, limit = 50): Notification[] {
    return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.id)).limit(limit).all();
  }
  getUnreadCount(userId: number): number {
    const result = db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.read, 0))).all();
    return result.length;
  }
  createNotification(data: InsertNotification): Notification {
    return db.insert(notifications).values({ ...data, createdAt: now() }).returning().get();
  }
  markNotificationRead(id: number): Notification | undefined {
    return db.update(notifications).set({ read: 1 }).where(eq(notifications.id, id)).returning().get();
  }
  markAllRead(userId: number): void {
    db.update(notifications).set({ read: 1 }).where(and(eq(notifications.userId, userId), eq(notifications.read, 0))).run();
  }

  // ── Message Search ──
  searchMessages(query: string, channelId?: number) {
    const q = `%${query}%`;
    let sql = `
      SELECT m.*, u.display_name, u.avatar_color, c.name as channel_name
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN channels c ON m.channel_id = c.id
      WHERE m.content LIKE ?
    `;
    const params: any[] = [q];
    if (channelId) {
      sql += ` AND m.channel_id = ?`;
      params.push(channelId);
    }
    sql += ` ORDER BY m.created_at DESC LIMIT 50`;
    const rows = sqlite.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      channelId: r.channel_id,
      userId: r.user_id,
      content: r.content,
      createdAt: r.created_at,
      user: r.display_name ? { displayName: r.display_name, avatarColor: r.avatar_color } : undefined,
      channelName: r.channel_name || undefined,
    }));
  }

  // ── Message Reactions ──
  getReactionsByMessage(messageId: number): MessageReaction[] {
    return db.select().from(messageReactions).where(eq(messageReactions.messageId, messageId)).all();
  }
  getReactionsByMessages(messageIds: number[]): MessageReaction[] {
    if (!messageIds.length) return [];
    // Use raw SQL IN query for batch fetch
    const placeholders = messageIds.map(() => '?').join(',');
    const stmt = sqlite.prepare(`SELECT * FROM message_reactions WHERE message_id IN (${placeholders})`);
    return stmt.all(...messageIds) as MessageReaction[];
  }
  addReaction(data: InsertMessageReaction): MessageReaction {
    return db.insert(messageReactions).values(data).returning().get();
  }
  removeReaction(messageId: number, userId: number, emoji: string): void {
    db.delete(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji)))
      .run();
  }
  findReaction(messageId: number, userId: number, emoji: string): MessageReaction | undefined {
    return db.select().from(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId), eq(messageReactions.emoji, emoji)))
      .get();
  }

  // ── Calendar Events ──
  getAllCalendarEvents(): CalendarEvent[] {
    return db.select().from(calendarEvents).orderBy(asc(calendarEvents.startDate)).all();
  }
  getCalendarEventsByUser(userId: number): CalendarEvent[] {
    return db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId)).orderBy(asc(calendarEvents.startDate)).all();
  }
  getCalendarEvent(id: number): CalendarEvent | undefined {
    return db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).get();
  }
  createCalendarEvent(data: InsertCalendarEvent): CalendarEvent {
    return db.insert(calendarEvents).values({ ...data, createdAt: now() }).returning().get();
  }
  updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): CalendarEvent | undefined {
    return db.update(calendarEvents).set(data).where(eq(calendarEvents.id, id)).returning().get();
  }
  deleteCalendarEvent(id: number): void {
    db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
  }

  // ── Task Comments ──
  getTaskComments(taskId: number): TaskComment[] {
    return db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(asc(taskComments.id)).all();
  }
  createTaskComment(data: InsertTaskComment): TaskComment {
    return db.insert(taskComments).values({ ...data, createdAt: now() }).returning().get();
  }
  deleteTaskComment(id: number): void {
    db.delete(taskComments).where(eq(taskComments.id, id)).run();
  }

  // ── Meeting Requests ──
  getMeetingRequestsByUser(userId: number): MeetingRequest[] {
    const idStr = `"${userId}"`;
    const sql = `SELECT * FROM meeting_requests WHERE requester_id = ? OR recipient_ids LIKE ? ORDER BY id DESC`;
    return sqlite.prepare(sql).all(userId, `%${idStr}%`) as MeetingRequest[];
  }
  getMeetingRequest(id: number): MeetingRequest | undefined {
    return db.select().from(meetingRequests).where(eq(meetingRequests.id, id)).get();
  }
  createMeetingRequest(data: InsertMeetingRequest): MeetingRequest {
    return db.insert(meetingRequests).values({ ...data, createdAt: now(), updatedAt: now() }).returning().get();
  }
  updateMeetingRequest(id: number, data: Partial<InsertMeetingRequest>): MeetingRequest | undefined {
    return db.update(meetingRequests).set({ ...data, updatedAt: now() }).where(eq(meetingRequests.id, id)).returning().get();
  }
  deleteMeetingRequest(id: number): void {
    db.delete(meetingRequests).where(eq(meetingRequests.id, id)).run();
  }

  // ── Knowledge Base ──
  getAllKnowledgeArticles(): KnowledgeArticle[] {
    return db.select().from(knowledgeArticles).orderBy(desc(knowledgeArticles.id)).all();
  }
  getKnowledgeArticle(id: number): KnowledgeArticle | undefined {
    return db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id)).get();
  }
  createKnowledgeArticle(data: InsertKnowledgeArticle): KnowledgeArticle {
    return db.insert(knowledgeArticles).values({ ...data, createdAt: now(), updatedAt: now() }).returning().get();
  }
  updateKnowledgeArticle(id: number, data: Partial<InsertKnowledgeArticle>): KnowledgeArticle | undefined {
    return db.update(knowledgeArticles).set({ ...data, updatedAt: now() }).where(eq(knowledgeArticles.id, id)).returning().get();
  }
  deleteKnowledgeArticle(id: number): void {
    db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, id)).run();
  }

  // ── Document Chunks ──
  getChunksBySource(sourceType: string, sourceId: number): DocumentChunk[] {
    return db.select().from(documentChunks).where(and(eq(documentChunks.sourceType, sourceType), eq(documentChunks.sourceId, sourceId))).all();
  }
  getAllChunks(): DocumentChunk[] {
    return db.select().from(documentChunks).all();
  }
  createDocumentChunk(data: InsertDocumentChunk): DocumentChunk {
    return db.insert(documentChunks).values({ ...data, createdAt: now() }).returning().get();
  }
  deleteChunksBySource(sourceType: string, sourceId: number): void {
    db.delete(documentChunks).where(and(eq(documentChunks.sourceType, sourceType), eq(documentChunks.sourceId, sourceId))).run();
  }

  // ── AI Conversations ──
  getConversationsByUser(userId: number): AiConversation[] {
    return db.select().from(aiConversations).where(eq(aiConversations.userId, userId)).orderBy(desc(aiConversations.id)).all();
  }
  getConversation(id: number): AiConversation | undefined {
    return db.select().from(aiConversations).where(eq(aiConversations.id, id)).get();
  }
  createConversation(data: InsertAiConversation): AiConversation {
    return db.insert(aiConversations).values({ ...data, createdAt: now() }).returning().get();
  }
  updateConversationTitle(id: number, title: string): AiConversation | undefined {
    return db.update(aiConversations).set({ title }).where(eq(aiConversations.id, id)).returning().get();
  }
  deleteConversation(id: number): void {
    db.delete(aiMessages).where(eq(aiMessages.conversationId, id)).run();
    db.delete(aiConversations).where(eq(aiConversations.id, id)).run();
  }

  // ── AI Messages ──
  getMessagesByConversation(conversationId: number): AiMessage[] {
    return db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.id)).all();
  }
  createAiMessage(data: InsertAiMessage): AiMessage {
    return db.insert(aiMessages).values({ ...data, createdAt: now() }).returning().get();
  }

  // ── User Merge ──
  mergeUsers(keepId: number, removeId: number): void {
    const removeStr = `"${removeId}"`;
    const keepStr = `"${keepId}"`;

    // Messages: reassign
    sqlite.prepare(`UPDATE messages SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // Tasks: reassign created_by
    sqlite.prepare(`UPDATE tasks SET created_by = ? WHERE created_by = ?`).run(keepId, removeId);
    // Tasks: update assigned_to JSON arrays - replace removeId with keepId
    const allTasks = sqlite.prepare(`SELECT id, assigned_to FROM tasks WHERE assigned_to LIKE ?`).all(`%${removeStr}%`) as any[];
    for (const t of allTasks) {
      try {
        let ids: number[] = JSON.parse(t.assigned_to);
        ids = ids.map((id: number) => id === removeId ? keepId : id);
        ids = [...new Set(ids)]; // deduplicate
        sqlite.prepare(`UPDATE tasks SET assigned_to = ? WHERE id = ?`).run(JSON.stringify(ids), t.id);
      } catch {}
    }

    // Task comments
    sqlite.prepare(`UPDATE task_comments SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // Todos
    sqlite.prepare(`UPDATE todos SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // Files
    sqlite.prepare(`UPDATE files SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // File folders
    sqlite.prepare(`UPDATE file_folders SET created_by = ? WHERE created_by = ?`).run(keepId, removeId);

    // Announcements
    sqlite.prepare(`UPDATE announcements SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // Notifications: reassign
    sqlite.prepare(`UPDATE notifications SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // Message reactions
    // Delete duplicate reactions first (same message+emoji, both users reacted)
    sqlite.prepare(`
      DELETE FROM message_reactions WHERE user_id = ? AND id IN (
        SELECT mr1.id FROM message_reactions mr1
        INNER JOIN message_reactions mr2 ON mr1.message_id = mr2.message_id AND mr1.emoji = mr2.emoji
        WHERE mr1.user_id = ? AND mr2.user_id = ?
      )
    `).run(removeId, removeId, keepId);
    sqlite.prepare(`UPDATE message_reactions SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);

    // Calendar events: reassign creator
    sqlite.prepare(`UPDATE calendar_events SET user_id = ? WHERE user_id = ?`).run(keepId, removeId);
    // Calendar events: update attendees JSON arrays
    const allEvents = sqlite.prepare(`SELECT id, attendees FROM calendar_events WHERE attendees LIKE ?`).all(`%${removeStr}%`) as any[];
    for (const e of allEvents) {
      try {
        let ids: number[] = JSON.parse(e.attendees);
        ids = ids.map((id: number) => id === removeId ? keepId : id);
        ids = [...new Set(ids)];
        sqlite.prepare(`UPDATE calendar_events SET attendees = ? WHERE id = ?`).run(JSON.stringify(ids), e.id);
      } catch {}
    }

    // Meeting requests: reassign requester
    sqlite.prepare(`UPDATE meeting_requests SET requester_id = ? WHERE requester_id = ?`).run(keepId, removeId);
    // Meeting requests: update recipient_ids and responses JSON
    const allMeetings = sqlite.prepare(`SELECT id, recipient_ids, responses FROM meeting_requests WHERE recipient_ids LIKE ? OR responses LIKE ?`).all(`%${removeStr}%`, `%${removeStr}%`) as any[];
    for (const m of allMeetings) {
      try {
        let rids: number[] = JSON.parse(m.recipient_ids);
        rids = rids.map((id: number) => id === removeId ? keepId : id);
        rids = [...new Set(rids)];
        let resp: Record<string, string> = JSON.parse(m.responses);
        if (resp[String(removeId)]) {
          const val = resp[String(removeId)];
          delete resp[String(removeId)];
          if (!resp[String(keepId)]) resp[String(keepId)] = val;
        }
        sqlite.prepare(`UPDATE meeting_requests SET recipient_ids = ?, responses = ? WHERE id = ?`).run(JSON.stringify(rids), JSON.stringify(resp), m.id);
      } catch {}
    }

    // Delete the duplicate user
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(removeId);
    console.log(`[merge] User ${removeId} merged into ${keepId} and deleted`);
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
        title TEXT NOT NULL DEFAULT '',
        reports_to INTEGER,
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
        assigned_to TEXT NOT NULL DEFAULT '[]',
        created_by INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        category TEXT NOT NULL DEFAULT 'general',
        phase TEXT NOT NULL DEFAULT 'phase-1',
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        user_id INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT 'meeting',
        color TEXT NOT NULL DEFAULT '#4F6BED',
        attendees TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        link_to TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS file_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        created_by INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        UNIQUE(message_id, user_id, emoji)
      );
      CREATE TABLE IF NOT EXISTS meeting_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL,
        recipient_ids TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        proposed_start_date TEXT NOT NULL,
        proposed_end_date TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        responses TEXT NOT NULL DEFAULT '{}',
        response_message TEXT NOT NULL DEFAULT '',
        proposed_new_start_date TEXT,
        proposed_new_end_date TEXT,
        calendar_event_id INTEGER,
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS knowledge_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        attachments TEXT NOT NULL DEFAULT '[]',
        created_by INTEGER NOT NULL,
        updated_by INTEGER,
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS document_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        source_name TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        embedding TEXT,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Conversation',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    // Add folder_id column to files if missing (migration for existing DBs)
    try { sqlite.exec(`ALTER TABLE files ADD COLUMN folder_id INTEGER`); } catch {}

    // Promote all users to admin
    try { sqlite.exec(`UPDATE users SET role = 'admin'`); } catch {}

    // Add title and reports_to columns to users if missing
    try { sqlite.exec(`ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT ''`); } catch {}
    try { sqlite.exec(`ALTER TABLE users ADD COLUMN reports_to INTEGER`); } catch {}

    // Add phase column to tasks if missing (migration for existing DBs)
    try { sqlite.exec(`ALTER TABLE tasks ADD COLUMN phase TEXT NOT NULL DEFAULT 'phase-1'`); } catch {}

    // Migrate tasks assigned_to from integer to JSON array (for existing DBs)
    try {
      const rows = sqlite.prepare(`SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL AND assigned_to != '[]' AND assigned_to NOT LIKE '[%'`).all() as any[];
      for (const row of rows) {
        const val = Number(row.assigned_to);
        if (!isNaN(val) && val > 0) {
          sqlite.prepare(`UPDATE tasks SET assigned_to = ? WHERE id = ?`).run(JSON.stringify([val]), row.id);
        }
      }
      // Convert NULL values to empty arrays
      sqlite.prepare(`UPDATE tasks SET assigned_to = '[]' WHERE assigned_to IS NULL`).run();
    } catch {}

    // Migrate meeting_requests: recipient_id -> recipient_ids + responses (for existing DBs)
    try { sqlite.exec(`ALTER TABLE meeting_requests ADD COLUMN recipient_ids TEXT NOT NULL DEFAULT '[]'`); } catch {}
    try { sqlite.exec(`ALTER TABLE meeting_requests ADD COLUMN responses TEXT NOT NULL DEFAULT '{}'`); } catch {}
    // Migrate any old single-recipient rows to the new format
    try {
      const oldRows = sqlite.prepare(`SELECT id, recipient_id FROM meeting_requests WHERE recipient_ids = '[]' AND recipient_id IS NOT NULL`).all() as any[];
      for (const row of oldRows) {
        sqlite.prepare(`UPDATE meeting_requests SET recipient_ids = ?, responses = ? WHERE id = ?`)
          .run(JSON.stringify([row.recipient_id]), JSON.stringify({ [row.recipient_id]: "pending" }), row.id);
      }
    } catch {}

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
