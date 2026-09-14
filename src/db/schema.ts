import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  numeric,
  boolean,
  date,
  pgEnum,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------- Enums ----------
export const roleEnum = pgEnum("role", [
  "owner",
  "manager",
  "receptionist",
  "teacher",
]);

export const membershipTypeEnum = pgEnum("membership_type", [
  "drop_in",
  "class_pack",
  "unlimited_monthly",
]);

export const signInStatusEnum = pgEnum("sign_in_status", [
  "attended",
  "no_show",
  "late_cancel",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "scheduled",
  "completed",
  "cancelled",
]);

export const revenueSourceEnum = pgEnum("revenue_source", [
  "membership_sale",
  "drop_in",
  "other",
]);

// A booking is a guest holding a spot for a class ahead of time — distinct
// from signIns, which records someone physically checked in that day.
// "attended" means check-in converted this reservation into an actual
// sign-in; "cancelled" frees the spot back up without deleting the row (so
// no-show history stays intact even if the guest cancels last-minute).
export const bookingStatusEnum = pgEnum("booking_status", [
  "booked",
  "cancelled",
  "attended",
]);

// ---------- Accounts Payable (vendor bills, Launch Path b7) ----------
export const billStatusEnum = pgEnum("bill_status", ["unpaid", "paid"]);
export const billFrequencyEnum = pgEnum("bill_frequency", [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

// ---------- Payments (Iyzico, Launch Path p4) ----------
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "success",
  "failed",
  "refunded",
]);
export const paymentPurposeEnum = pgEnum("payment_purpose", [
  "booking",
  "membership",
]);

// ---------- Core tenant ----------
export const studios = pgTable("studios", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 60 }).notNull().unique(),
  city: varchar("city", { length: 80 }),
  timezone: varchar("timezone", { length: 60 }).notNull().default("UTC"),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Users & studio membership ----------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // A super owner (you) can see and switch between every studio,
  // regardless of per-studio membership rows below.
  isSuperOwner: boolean("is_super_owner").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const studioMembers = pgTable(
  "studio_members",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studioId: integer("studio_id")
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("studio_member_unique").on(t.userId, t.studioId)]
);

// ---------- Teachers ----------
export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }),
  phone: varchar("phone", { length: 40 }),
  payRateType: varchar("pay_rate_type", { length: 30 })
    .notNull()
    .default("per_class"), // per_class | per_head | salary
  payRate: numeric("pay_rate", { precision: 10, scale: 2 }),
  active: boolean("active").notNull().default(true),
  // Self-serve profile fields — a teacher edits these themselves once
  // they're signed in (see /profile), rather than a manager typing bios
  // in for them.
  bio: text("bio"),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Guests / customers ----------
export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }),
  phone: varchar("phone", { length: 40 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Class types & sessions ----------
export const classTypes = pgTable("class_types", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  // Deactivated class types drop out of "add a class" pickers but stay
  // attached to any past sessions that already used them.
  active: boolean("active").notNull().default(true),
  description: text("description"),
  photoUrl: text("photo_url"),
});

export const classSessions = pgTable("class_sessions", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  classTypeId: integer("class_type_id").references(() => classTypes.id, {
    onDelete: "set null",
  }),
  teacherId: integer("teacher_id").references(() => teachers.id, {
    onDelete: "set null",
  }),
  room: varchar("room", { length: 60 }), // e.g. "Shala 1", "Shala 2"
  startsAt: timestamp("starts_at").notNull(),
  capacity: integer("capacity").notNull().default(20),
  status: sessionStatusEnum("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Recurring schedule templates ----------
// A studio can save more than one named weekly pattern (e.g. "Default",
// "High season"). The one with isDefault=true is the pattern used to
// auto-fill an empty future week; any template can also be applied to a
// specific week on demand from the schedule page.
export const scheduleTemplates = pgTable("schedule_templates", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduleTemplateSlots = pgTable("schedule_template_slots", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id")
    .notNull()
    .references(() => scheduleTemplates.id, { onDelete: "cascade" }),
  // 0 = Monday .. 6 = Sunday, matching lib/time.ts's weekDays() ordering.
  weekday: integer("weekday").notNull(),
  // 24-hour "HH:MM" local time, same convention as the schedule page's
  // <input type="time">.
  time: varchar("time", { length: 5 }).notNull(),
  teacherId: integer("teacher_id").references(() => teachers.id, {
    onDelete: "set null",
  }),
  classTypeId: integer("class_type_id").references(() => classTypes.id, {
    onDelete: "set null",
  }),
  room: varchar("room", { length: 60 }),
  capacity: integer("capacity").notNull().default(20),
});

// ---------- Memberships ----------
export const memberships = pgTable("memberships", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  guestId: integer("guest_id")
    .notNull()
    .references(() => guests.id, { onDelete: "cascade" }),
  type: membershipTypeEnum("type").notNull(),
  totalCredits: integer("total_credits"), // null = unlimited
  remainingCredits: integer("remaining_credits"), // null = unlimited
  startsOn: date("starts_on").notNull(),
  expiresOn: date("expires_on"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Bookings / reservations ----------
// Holds a guest's spot for a future class, made ahead of the class date
// (self-booking, or staff booking on someone's behalf later). Kept
// separate from signIns because "reserved a spot for Thursday" and
// "physically checked in today" are different facts — conflating them
// would make capacity counts wrong (a class could look empty right up
// until the day of, when it's actually fully booked) and would erase the
// "booked but never showed" signal that matters for no-show tracking.
//
// One row per (classSessionId, guestId): booking again after a
// cancellation flips the existing row back to "booked" rather than
// inserting a second one, so a guest can't accidentally hold two spots in
// the same class.
export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    studioId: integer("studio_id")
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
    classSessionId: integer("class_session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    guestId: integer("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    status: bookingStatusEnum("status").notNull().default("booked"),
    // Where the booking came from — today always "widget", but keeps room
    // for staff-entered bookings later without a schema change.
    source: varchar("source", { length: 20 }).notNull().default("widget"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("booking_session_guest_unique").on(t.classSessionId, t.guestId)]
);

// ---------- Vendor bills / Accounts Payable ----------
// A bill the studio owes someone else — rent, utilities, insurance,
// supplies, a teacher's payroll for a period, or a one-off (repairs,
// equipment, construction). Deliberately its own table rather than just
// another `expenses` row: an expense is money already spent, a vendor
// bill is money *owed* — it needs a due date and an unpaid/paid state so
// a manager can see what's due/past due before it's actually paid. When
// marked paid, a matching `expenses` row is written too (see bills
// actions), so /money and /reports still see the real cash outflow.
//
// Recurring bills use the lazy-generation pattern already established for
// the weekly schedule (see schedule/page.tsx): rather than a cron job,
// `ensureRecurringBillOccurrences` (src/lib/bills.ts) tops up each
// recurring series with upcoming instances whenever the bills page is
// viewed. `recurrenceSeriesId` points every generated instance back at
// the original recurring bill (which has `recurrenceSeriesId = null`),
// so "find the latest instance in this series" is a simple query.
export const vendorBills = pgTable("vendor_bills", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  vendorName: varchar("vendor_name", { length: 120 }).notNull(),
  // rent | utilities | insurance | supplies | teacher_pay | construction |
  // repairs | equipment | other — free-ish text rather than an enum since
  // Gün explicitly wants to add his own rows for things like "new
  // construction" without a code change.
  category: varchar("category", { length: 60 }).notNull().default("other"),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  status: billStatusEnum("status").notNull().default("unpaid"),
  paidOn: date("paid_on"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceFrequency: billFrequencyEnum("recurrence_frequency"),
  recurrenceSeriesId: integer("recurrence_series_id").references(
    (): AnyPgColumn => vendorBills.id,
    { onDelete: "set null" }
  ),
  enteredByUserId: integer("entered_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Payments (Iyzico) ----------
// One row per real payment attempt against Iyzico's Checkout Form API —
// created "pending" the moment a guest is handed off to iyzico's hosted
// payment page, then updated to success/failed once the callback is
// verified server-side (never trust the callback body alone — see
// src/lib/iyzico.ts). Exists independently of `bookings`/`memberships` so
// a failed or abandoned payment attempt is still visible, not silently
// lost.
//
// `settledManually`/`settledOn` exist for Launch Path b9 (card settlement
// tracking): Gün confirmed Türkiye's settlement window isn't a fixed
// number of days he can compute automatically (varies, and there's a
// separate "get paid instantly" option that costs a percentage) — so this
// stays a manual flag a manager sets once the money actually lands in the
// bank, not an auto-computed date. The columns exist now so that manual
// step has somewhere to write to when b9's UI gets built; nothing sets
// them yet.
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  guestId: integer("guest_id").references(() => guests.id, {
    onDelete: "set null",
  }),
  bookingId: integer("booking_id").references(() => bookings.id, {
    onDelete: "set null",
  }),
  membershipId: integer("membership_id").references(() => memberships.id, {
    onDelete: "set null",
  }),
  purpose: paymentPurposeEnum("purpose").notNull(),
  provider: varchar("provider", { length: 30 }).notNull().default("iyzico"),
  providerConversationId: varchar("provider_conversation_id", { length: 120 }),
  providerToken: varchar("provider_token", { length: 120 }),
  providerPaymentId: varchar("provider_payment_id", { length: 120 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  settledManually: boolean("settled_manually").notNull().default(false),
  settledOn: date("settled_on"),
  rawResponse: text("raw_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Sign-ins / attendance ----------
export const signIns = pgTable("sign_ins", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  classSessionId: integer("class_session_id")
    .notNull()
    .references(() => classSessions.id, { onDelete: "cascade" }),
  guestId: integer("guest_id")
    .notNull()
    .references(() => guests.id, { onDelete: "cascade" }),
  membershipId: integer("membership_id").references(() => memberships.id, {
    onDelete: "set null",
  }),
  status: signInStatusEnum("status").notNull().default("attended"),
  checkedInAt: timestamp("checked_in_at").defaultNow().notNull(),
  checkedInByUserId: integer("checked_in_by_user_id").references(
    () => users.id,
    { onDelete: "set null" }
  ),
});

// ---------- Money: manual expense & revenue ledgers ----------
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 60 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
  occurredOn: date("occurred_on").notNull(),
  enteredByUserId: integer("entered_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const revenueEntries = pgTable("revenue_entries", {
  id: serial("id").primaryKey(),
  studioId: integer("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  source: revenueSourceEnum("source").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  note: text("note"),
  guestId: integer("guest_id").references(() => guests.id, {
    onDelete: "set null",
  }),
  occurredOn: date("occurred_on").notNull(),
  enteredByUserId: integer("entered_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------- Relations (for query ergonomics) ----------
export const studiosRelations = relations(studios, ({ many }) => ({
  members: many(studioMembers),
  teachers: many(teachers),
  guests: many(guests),
  classSessions: many(classSessions),
  scheduleTemplates: many(scheduleTemplates),
}));

export const scheduleTemplatesRelations = relations(
  scheduleTemplates,
  ({ one, many }) => ({
    studio: one(studios, {
      fields: [scheduleTemplates.studioId],
      references: [studios.id],
    }),
    slots: many(scheduleTemplateSlots),
  })
);

export const scheduleTemplateSlotsRelations = relations(
  scheduleTemplateSlots,
  ({ one }) => ({
    template: one(scheduleTemplates, {
      fields: [scheduleTemplateSlots.templateId],
      references: [scheduleTemplates.id],
    }),
    teacher: one(teachers, {
      fields: [scheduleTemplateSlots.teacherId],
      references: [teachers.id],
    }),
    classType: one(classTypes, {
      fields: [scheduleTemplateSlots.classTypeId],
      references: [classTypes.id],
    }),
  })
);

export const usersRelations = relations(users, ({ many }) => ({
  studioMemberships: many(studioMembers),
}));

export const studioMembersRelations = relations(studioMembers, ({ one }) => ({
  user: one(users, { fields: [studioMembers.userId], references: [users.id] }),
  studio: one(studios, {
    fields: [studioMembers.studioId],
    references: [studios.id],
  }),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  studio: one(studios, {
    fields: [teachers.studioId],
    references: [studios.id],
  }),
  classSessions: many(classSessions),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  studio: one(studios, { fields: [bookings.studioId], references: [studios.id] }),
  classSession: one(classSessions, {
    fields: [bookings.classSessionId],
    references: [classSessions.id],
  }),
  guest: one(guests, { fields: [bookings.guestId], references: [guests.id] }),
}));

export const classSessionsRelations = relations(
  classSessions,
  ({ one, many }) => ({
    studio: one(studios, {
      fields: [classSessions.studioId],
      references: [studios.id],
    }),
    teacher: one(teachers, {
      fields: [classSessions.teacherId],
      references: [teachers.id],
    }),
    classType: one(classTypes, {
      fields: [classSessions.classTypeId],
      references: [classTypes.id],
    }),
    bookings: many(bookings),
    signIns: many(signIns),
  })
);

export const guestsRelations = relations(guests, ({ one, many }) => ({
  studio: one(studios, { fields: [guests.studioId], references: [studios.id] }),
  memberships: many(memberships),
  signIns: many(signIns),
  bookings: many(bookings),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  guest: one(guests, {
    fields: [memberships.guestId],
    references: [guests.id],
  }),
  studio: one(studios, {
    fields: [memberships.studioId],
    references: [studios.id],
  }),
}));

export const signInsRelations = relations(signIns, ({ one }) => ({
  classSession: one(classSessions, {
    fields: [signIns.classSessionId],
    references: [classSessions.id],
  }),
  guest: one(guests, { fields: [signIns.guestId], references: [guests.id] }),
  membership: one(memberships, {
    fields: [signIns.membershipId],
    references: [memberships.id],
  }),
}));

export const vendorBillsRelations = relations(vendorBills, ({ one }) => ({
  studio: one(studios, {
    fields: [vendorBills.studioId],
    references: [studios.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  studio: one(studios, { fields: [payments.studioId], references: [studios.id] }),
  guest: one(guests, { fields: [payments.guestId], references: [guests.id] }),
  booking: one(bookings, {
    fields: [payments.bookingId],
    references: [bookings.id],
  }),
  membership: one(memberships, {
    fields: [payments.membershipId],
    references: [memberships.id],
  }),
}));
