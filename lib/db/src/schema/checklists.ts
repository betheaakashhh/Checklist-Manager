import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const checklistsTable = pgTable("checklists", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id"),
  title: text("title").notNull(),
  sourceText: text("source_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const checklistItemsTable = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  checklistId: integer("checklist_id")
    .notNull()
    .references(() => checklistsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("todo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const checklistRelationsTable = pgTable(
  "checklist_relations",
  {
    id: serial("id").primaryKey(),
    parentChecklistId: integer("parent_checklist_id")
      .notNull()
      .references(() => checklistsTable.id, { onDelete: "cascade" }),
    childChecklistId: integer("child_checklist_id")
      .notNull()
      .references(() => checklistsTable.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("supports"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("checklist_relations_parent_child_unique").on(
      table.parentChecklistId,
      table.childChecklistId,
    ),
  ],
);

export const collectionsTable = pgTable("collections", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const collectionChecklistsTable = pgTable(
  "collection_checklists",
  {
    id: serial("id").primaryKey(),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collectionsTable.id, { onDelete: "cascade" }),
    checklistId: integer("checklist_id")
      .notNull()
      .references(() => checklistsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("collection_checklists_collection_checklist_unique").on(
      table.collectionId,
      table.checklistId,
    ),
  ],
);

export const insertChecklistSchema = createInsertSchema(checklistsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChecklistItemSchema = createInsertSchema(checklistItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Checklist = typeof checklistsTable.$inferSelect;
export type ChecklistItem = typeof checklistItemsTable.$inferSelect;
export type ChecklistRelation = typeof checklistRelationsTable.$inferSelect;
export type InsertChecklist = z.infer<typeof insertChecklistSchema>;
export type InsertChecklistItem = z.infer<typeof insertChecklistItemSchema>;