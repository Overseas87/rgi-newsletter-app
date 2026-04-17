import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const newsletterSubscribersTable = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  topics: text("topics").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const newsletterDigestsTable = pgTable("newsletter_digests", {
  id: serial("id").primaryKey(),
  weekOf: text("week_of").notNull(),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
  topicTags: text("topic_tags").array().notNull().default([]),
  subscriberCount: integer("subscriber_count").notNull().default(0),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NewsletterSubscriber = typeof newsletterSubscribersTable.$inferSelect;
export type NewsletterDigest = typeof newsletterDigestsTable.$inferSelect;
