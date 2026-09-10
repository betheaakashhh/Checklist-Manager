import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, checklistItemsTable, checklistsTable } from "@workspace/db";
import {
  CreateChecklistBody,
  CreateChecklistResponse,
  DeleteChecklistParams,
  GetChecklistParams,
  GetChecklistResponse,
  GetChecklistStatsResponse,
  ListChecklistsResponse,
  UpdateChecklistBody,
  UpdateChecklistItemBody,
  UpdateChecklistItemParams,
  UpdateChecklistItemResponse,
  UpdateChecklistParams,
  UpdateChecklistResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const statusValues = ["todo", "in_progress", "done", "blocked"] as const;
type ChecklistStatus = (typeof statusValues)[number];

function parsePastedItems(sourceText: string): string[] {
  const workflowCodes = sourceText.match(/\b\d{3}_[a-z0-9]+(?:_[a-z0-9]+)*\b/gi);
  if (workflowCodes && workflowCodes.length > 1) {
    return workflowCodes;
  }

  return sourceText
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•◦▪·]|\d+[.)])\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

async function getChecklistPayload(id: number) {
  const [checklist] = await db
    .select()
    .from(checklistsTable)
    .where(eq(checklistsTable.id, id));

  if (!checklist) return undefined;

  const items = await db
    .select()
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.checklistId, id))
    .orderBy(asc(checklistItemsTable.position));
  const completedItems = items.filter((item) => item.status === "done").length;

  return {
    ...checklist,
    totalItems: items.length,
    completedItems,
    progress: items.length ? Math.round((completedItems / items.length) * 100) : 0,
    items: items.map((item) => ({
      ...item,
      status: item.status as ChecklistStatus,
    })),
  };
}

router.get("/checklists", async (_req, res): Promise<void> => {
  const checklists = await db
    .select()
    .from(checklistsTable)
    .orderBy(desc(checklistsTable.updatedAt));
  const items = await db.select().from(checklistItemsTable);

  const summary = checklists.map((checklist) => {
    const checklistItems = items.filter((item) => item.checklistId === checklist.id);
    const completedItems = checklistItems.filter((item) => item.status === "done").length;
    return {
      id: checklist.id,
      title: checklist.title,
      createdAt: checklist.createdAt,
      updatedAt: checklist.updatedAt,
      totalItems: checklistItems.length,
      completedItems,
      progress: checklistItems.length
        ? Math.round((completedItems / checklistItems.length) * 100)
        : 0,
    };
  });

  res.json(ListChecklistsResponse.parse(summary));
});

router.post("/checklists", async (req, res): Promise<void> => {
  const parsed = CreateChecklistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const itemTitles = parsePastedItems(parsed.data.sourceText);
  if (!itemTitles.length) {
    res.status(400).json({ error: "Paste at least one checklist item." });
    return;
  }

  const title =
    parsed.data.title?.trim() ||
    `Checklist · ${new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })}`;

  const checklist = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(checklistsTable)
      .values({ title, sourceText: parsed.data.sourceText })
      .returning();

    await tx.insert(checklistItemsTable).values(
      itemTitles.map((itemTitle, position) => ({
        checklistId: created.id,
        position,
        title: itemTitle,
        status: "todo",
      })),
    );

    return created;
  });

  const payload = await getChecklistPayload(checklist.id);
  res.status(201).json(CreateChecklistResponse.parse(payload));
});

router.get("/checklists/stats", async (_req, res): Promise<void> => {
  const [checklists, items] = await Promise.all([
    db.select().from(checklistsTable),
    db.select().from(checklistItemsTable),
  ]);
  const completedItems = items.filter((item) => item.status === "done").length;
  const inProgressItems = items.filter((item) => item.status === "in_progress").length;
  const blockedItems = items.filter((item) => item.status === "blocked").length;
  const todoItems = items.filter((item) => item.status === "todo").length;
  const titleById = new Map(checklists.map((checklist) => [checklist.id, checklist.title]));
  const recentItems = [...items]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 6);

  res.json(
    GetChecklistStatsResponse.parse({
      totalChecklists: checklists.length,
      totalItems: items.length,
      completedItems,
      inProgressItems,
      blockedItems,
      todoItems,
      completionRate: items.length ? Math.round((completedItems / items.length) * 100) : 0,
      recentActivity: recentItems.map((item) => ({
        checklistId: item.checklistId,
        checklistTitle: titleById.get(item.checklistId) ?? "Checklist",
        itemTitle: item.title,
        status: item.status as ChecklistStatus,
        updatedAt: item.updatedAt,
      })),
    }),
  );
});

router.get("/checklists/:id", async (req, res): Promise<void> => {
  const params = GetChecklistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const payload = await getChecklistPayload(params.data.id);
  if (!payload) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }

  res.json(GetChecklistResponse.parse(payload));
});

router.patch("/checklists/:id", async (req, res): Promise<void> => {
  const params = UpdateChecklistParams.safeParse(req.params);
  const parsed = UpdateChecklistBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid checklist update." });
    return;
  }

  const [updated] = await db
    .update(checklistsTable)
    .set({ title: parsed.data.title.trim(), updatedAt: new Date() })
    .where(eq(checklistsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }

  const payload = await getChecklistPayload(updated.id);
  res.json(UpdateChecklistResponse.parse(payload));
});

router.delete("/checklists/:id", async (req, res): Promise<void> => {
  const params = DeleteChecklistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(checklistsTable)
    .where(eq(checklistsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }

  res.sendStatus(204);
});

router.patch(
  "/checklists/:checklistId/items/:itemId",
  async (req, res): Promise<void> => {
    const params = UpdateChecklistItemParams.safeParse(req.params);
    const parsed = UpdateChecklistItemBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid checklist item update." });
      return;
    }

    const [existing] = await db
      .select()
      .from(checklistItemsTable)
      .where(
        and(
          eq(checklistItemsTable.id, params.data.itemId),
          eq(checklistItemsTable.checklistId, params.data.checklistId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Checklist item not found" });
      return;
    }

    const [updated] = await db
      .update(checklistItemsTable)
      .set({
        ...(parsed.data.title === undefined ? {} : { title: parsed.data.title.trim() }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        updatedAt: new Date(),
      })
      .where(eq(checklistItemsTable.id, existing.id))
      .returning();

    await db
      .update(checklistsTable)
      .set({ updatedAt: new Date() })
      .where(eq(checklistsTable.id, existing.checklistId));

    res.json(
      UpdateChecklistItemResponse.parse({
        ...updated,
        status: updated.status as ChecklistStatus,
      }),
    );
  },
);

export default router;