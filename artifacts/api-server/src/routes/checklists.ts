import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db, checklistItemsTable, checklistsTable } from "@workspace/db";
import {
  CreateChecklistItemBody,
  CreateChecklistItemParams,
  CreateChecklistItemResponse,
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

function getOwnerId(req: Request): string | null {
  const userId = getAuth(req).userId;
  if (userId) return userId;

  const anonymousId = req.get("x-anonymous-id")?.trim();
  if (anonymousId && /^[A-Za-z0-9_-]{1,128}$/.test(anonymousId)) {
    return `anon:${anonymousId}`;
  }

  return null;
}

function ownerCondition(ownerId: string | null) {
  if (ownerId?.startsWith("anon:")) {
    return or(
      eq(checklistsTable.ownerId, ownerId),
      isNull(checklistsTable.ownerId),
    );
  }

  return ownerId === null
    ? isNull(checklistsTable.ownerId)
    : eq(checklistsTable.ownerId, ownerId);
}

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

async function getChecklistPayload(id: number, ownerId: string | null) {
  const [checklist] = await db
    .select()
    .from(checklistsTable)
    .where(and(eq(checklistsTable.id, id), ownerCondition(ownerId)));

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

router.get("/checklists", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const checklists = await db
    .select()
    .from(checklistsTable)
    .where(ownerCondition(ownerId))
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
  const ownerId = getOwnerId(req);
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
      .values({ ownerId, title, sourceText: parsed.data.sourceText })
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

  const payload = await getChecklistPayload(checklist.id, ownerId);
  res.status(201).json(CreateChecklistResponse.parse(payload));
});

router.get("/checklists/stats", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const [checklists, items] = await Promise.all([
    db.select().from(checklistsTable).where(ownerCondition(ownerId)),
    db.select().from(checklistItemsTable),
  ]);
  const checklistIds = new Set(checklists.map((checklist) => checklist.id));
  const scopedItems = items.filter((item) => checklistIds.has(item.checklistId));
  const completedItems = scopedItems.filter((item) => item.status === "done").length;
  const inProgressItems = scopedItems.filter((item) => item.status === "in_progress").length;
  const blockedItems = scopedItems.filter((item) => item.status === "blocked").length;
  const todoItems = scopedItems.filter((item) => item.status === "todo").length;
  const titleById = new Map(checklists.map((checklist) => [checklist.id, checklist.title]));
  const recentItems = [...scopedItems]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 6);

  res.json(
    GetChecklistStatsResponse.parse({
      totalChecklists: checklists.length,
      totalItems: scopedItems.length,
      completedItems,
      inProgressItems,
      blockedItems,
      todoItems,
      completionRate: scopedItems.length ? Math.round((completedItems / scopedItems.length) * 100) : 0,
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
  const ownerId = getOwnerId(req);
  const params = GetChecklistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const payload = await getChecklistPayload(params.data.id, ownerId);
  if (!payload) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }

  res.json(GetChecklistResponse.parse(payload));
});

router.post("/checklists/:id/items", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = CreateChecklistItemParams.safeParse(req.params);
  const parsed = CreateChecklistItemBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid checklist item." });
    return;
  }

  const [checklist] = await db
    .select()
    .from(checklistsTable)
    .where(
      and(
        eq(checklistsTable.id, params.data.id),
        ownerCondition(ownerId),
      ),
    );
  if (!checklist) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }

  const [lastItem] = await db
    .select({ position: checklistItemsTable.position })
    .from(checklistItemsTable)
    .where(eq(checklistItemsTable.checklistId, checklist.id))
    .orderBy(desc(checklistItemsTable.position))
    .limit(1);

  const [created] = await db
    .insert(checklistItemsTable)
    .values({
      checklistId: checklist.id,
      position: (lastItem?.position ?? -1) + 1,
      title: parsed.data.title.trim(),
      status: "todo",
    })
    .returning();

  await db
    .update(checklistsTable)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(checklistsTable.id, checklist.id),
        ownerCondition(ownerId),
      ),
    );

  res.status(201).json(
    CreateChecklistItemResponse.parse({
      ...created,
      status: created.status as ChecklistStatus,
    }),
  );
});

router.patch("/checklists/:id", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = UpdateChecklistParams.safeParse(req.params);
  const parsed = UpdateChecklistBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid checklist update." });
    return;
  }

  const [updated] = await db
    .update(checklistsTable)
    .set({ title: parsed.data.title.trim(), updatedAt: new Date() })
    .where(and(eq(checklistsTable.id, params.data.id), ownerCondition(ownerId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Checklist not found" });
    return;
  }

  const payload = await getChecklistPayload(updated.id, ownerId);
  res.json(UpdateChecklistResponse.parse(payload));
});

router.delete("/checklists/:id", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = DeleteChecklistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(checklistsTable)
    .where(and(eq(checklistsTable.id, params.data.id), ownerCondition(ownerId)))
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
    const ownerId = getOwnerId(req);
    const params = UpdateChecklistItemParams.safeParse(req.params);
    const parsed = UpdateChecklistItemBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid checklist item update." });
      return;
    }

    const [checklist] = await db
      .select()
      .from(checklistsTable)
      .where(
        and(
          eq(checklistsTable.id, params.data.checklistId),
          ownerCondition(ownerId),
        ),
      );
    if (!checklist) {
      res.status(404).json({ error: "Checklist not found" });
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
      .where(
        and(
          eq(checklistsTable.id, existing.checklistId),
          ownerCondition(ownerId),
        ),
      );

    res.json(
      UpdateChecklistItemResponse.parse({
        ...updated,
        status: updated.status as ChecklistStatus,
      }),
    );
  },
);

export default router;