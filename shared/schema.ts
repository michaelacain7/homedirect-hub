import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users ──────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), // admin | member
  avatarColor: text("avatar_color").notNull().default("#4F6BED"),
  createdAt: text("created_at").notNull().default(""),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Channels ───────────────────────────────────────
export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
});

export const insertChannelSchema = createInsertSchema(channels).omit({
  id: true,
  createdAt: true,
});
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channels.$inferSelect;

// ── Messages ───────────────────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: integer("channel_id").notNull(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(""),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ── Tasks (Delegation Board) ───────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  assignedTo: integer("assigned_to"),
  createdBy: integer("created_by").notNull(),
  status: text("status").notNull().default("todo"), // todo | in-progress | review | done
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  category: text("category").notNull().default("general"), // engineering | product | marketing | legal | operations | general
  dueDate: text("due_date"),
  createdAt: text("created_at").notNull().default(""),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ── Todos (Personal) ──────────────────────────────
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  completed: integer("completed").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
});

export const insertTodoSchema = createInsertSchema(todos).omit({
  id: true,
  createdAt: true,
});
export type InsertTodo = z.infer<typeof insertTodoSchema>;
export type Todo = typeof todos.$inferSelect;

// ── File Folders ──────────────────────────────────
export const fileFolders = sqliteTable("file_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  createdBy: integer("created_by").notNull(),
});

export const insertFileFolderSchema = createInsertSchema(fileFolders).omit({ id: true });
export type InsertFileFolder = z.infer<typeof insertFileFolderSchema>;
export type FileFolder = typeof fileFolders.$inferSelect;

// ── Files (Shared) ────────────────────────────────
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  folderId: integer("folder_id"),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  createdAt: text("created_at").notNull().default(""),
});

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  createdAt: true,
});
export type InsertFile = z.infer<typeof insertFileSchema>;
export type FileRecord = typeof files.$inferSelect;

// ── Announcements ─────────────────────────────────
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  pinned: integer("pinned").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
});

export const insertAnnouncementSchema = createInsertSchema(announcements).omit({
  id: true,
  createdAt: true,
});
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

// ── Milestones ────────────────────────────────────
export const milestones = sqliteTable("milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending | in-progress | completed
  targetDate: text("target_date"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
});

export const insertMilestoneSchema = createInsertSchema(milestones).omit({
  id: true,
  createdAt: true,
});
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestones.$inferSelect;

// ── Notifications ─────────────────────────────────
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(), // recipient
  type: text("type").notNull(), // chat_message | task_assigned | task_updated | announcement
  title: text("title").notNull(),
  body: text("body").notNull(),
  linkTo: text("link_to"), // e.g. "/chat" or "/tasks"
  read: integer("read").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ── Message Reactions ─────────────────────────────
export const messageReactions = sqliteTable("message_reactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  emoji: text("emoji").notNull(), // e.g. "👍", "❤️", "😂"
});

export const insertMessageReactionSchema = createInsertSchema(messageReactions).omit({
  id: true,
});
export type InsertMessageReaction = z.infer<typeof insertMessageReactionSchema>;
export type MessageReaction = typeof messageReactions.$inferSelect;

// ── Calendar Events ───────────────────────────────
export const calendarEvents = sqliteTable("calendar_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  userId: integer("user_id").notNull(), // creator
  startDate: text("start_date").notNull(), // ISO string
  endDate: text("end_date").notNull(), // ISO string
  allDay: integer("all_day").notNull().default(0),
  type: text("type").notNull().default("meeting"), // meeting | task | deadline | reminder | other
  color: text("color").notNull().default("#4F6BED"),
  attendees: text("attendees").notNull().default("[]"), // JSON array of user IDs
  createdAt: text("created_at").notNull().default(""),
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

// ── Meeting Requests ─────────────────────────────
export const meetingRequests = sqliteTable("meeting_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requesterId: integer("requester_id").notNull(),
  recipientIds: text("recipient_ids").notNull().default("[]"), // JSON array of user IDs
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  proposedStartDate: text("proposed_start_date").notNull(),
  proposedEndDate: text("proposed_end_date").notNull(),
  allDay: integer("all_day").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | accepted | declined | new_time_proposed
  responses: text("responses").notNull().default("{}"), // JSON: { "userId": "pending"|"accepted"|"declined"|"new_time_proposed" }
  responseMessage: text("response_message").notNull().default(""),
  proposedNewStartDate: text("proposed_new_start_date"),
  proposedNewEndDate: text("proposed_new_end_date"),
  calendarEventId: integer("calendar_event_id"), // set when accepted
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const insertMeetingRequestSchema = createInsertSchema(meetingRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMeetingRequest = z.infer<typeof insertMeetingRequestSchema>;
export type MeetingRequest = typeof meetingRequests.$inferSelect;
