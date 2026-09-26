import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db, checklistItemsTable, checklistRelationsTable, checklistsTable } from "@workspace/db";
import {
  CreateChecklistItemBody,
  CreateChecklistItemParams,
  CreateChecklistItemResponse,
  CreateChecklistRelationBody,
  CreateChecklistRelationParams,
  CreateChecklistRelationResponse,
  CreateChecklistBody,
  CreateChecklistResponse,
  DeleteChecklistParams,
  DeleteChecklistRelationParams,
  GetChecklistParams,
  GetChecklistResponse,
  GetChecklistStatsResponse,
  ListChecklistsResponse,
  ListChecklistRelationsResponse,
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
type ChecklistRelationType = "supports" | "queue" | "belongs_to";

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

async function getChecklistContext(ownerId: string | null) {
  const [checklists, items, relations] = await Promise.all([
    db.select().from(checklistsTable).where(ownerCondition(ownerId)),
    db.select().from(checklistItemsTable),
    db.select().from(checklistRelationsTable),
  ]);
  const checklistIds = new Set(checklists.map((checklist) => checklist.id));
  return {
    checklists,
    items: items.filter((item) => checklistIds.has(item.checklistId)),
    relations: relations.filter(
      (relation) =>
        checklistIds.has(relation.parentChecklistId) &&
        checklistIds.has(relation.childChecklistId),
    ),
  };
}

function createSummaryBuilder(
  checklists: Awaited<ReturnType<typeof getChecklistContext>>["checklists"],
  items: Awaited<ReturnType<typeof getChecklistContext>>["items"],
  relations: Awaited<ReturnType<typeof getChecklistContext>>["relations"],
) {
  const itemsByChecklist = new Map<number, typeof items>();
  for (const item of items) {
    const bucket = itemsByChecklist.get(item.checklistId) ?? [];
    bucket.push(item);
    itemsByChecklist.set(item.checklistId, bucket);
  }
  const childrenByParent = new Map<number, typeof relations>();
  for (const relation of relations) {
    const bucket = childrenByParent.get(relation.parentChecklistId) ?? [];
    bucket.push(relation);
    childrenByParent.set(relation.parentChecklistId, bucket);
  }
  const checklistById = new Map(checklists.map((checklist) => [checklist.id, checklist]));
  const progressCache = new Map<number, number>();

  const calculateProgress = (id: number, visiting = new Set<number>()): number => {
    const cached = progressCache.get(id);
    if (cached !== undefined) return cached;
    const checklistItems = itemsByChecklist.get(id) ?? [];
    const childRelations = childrenByParent.get(id) ?? [];
    const completedItems = checklistItems.filter((item) => item.status === "done").length;
    const units = checklistItems.length + childRelations.length;
    if (!units) return 0;
    if (visiting.has(id)) return checklistItems.length
      ? Math.round((completedItems / checklistItems.length) * 100)
      : 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const childProgress = childRelations.reduce(
      (total, relation) => total + calculateProgress(relation.childChecklistId, nextVisiting) / 100,
      0,
    );
    const progress = Math.round(((completedItems + childProgress) / units) * 100);
    progressCache.set(id, progress);
    return progress;
  };

  const getSummary = (id: number) => {
    const checklist = checklistById.get(id);
    if (!checklist) return undefined;
    const checklistItems = itemsByChecklist.get(id) ?? [];
    const completedItems = checklistItems.filter((item) => item.status === "done").length;
    const progress = calculateProgress(id);
    return {
      id: checklist.id,
      title: checklist.title,
      createdAt: checklist.createdAt,
      updatedAt: checklist.updatedAt,
      totalItems: checklistItems.length,
      completedItems,
      progress,
      isComplete: progress === 100,
      childChecklistCount: childrenByParent.get(id)?.length ?? 0,
    };
  };

  return { getSummary, childrenByParent, checklistById, relations };
}

function relationHasPath(
  startId: number,
  targetId: number,
  relations: Array<{ parentChecklistId: number; childChecklistId: number }>,
  visited = new Set<number>(),
): boolean {
  if (startId === targetId) return true;
  if (visited.has(startId)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(startId);
  return relations
    .filter((relation) => relation.parentChecklistId === startId)
    .some((relation) => relationHasPath(relation.childChecklistId, targetId, relations, nextVisited));
}

async function getChecklistPayload(id: number, ownerId: string | null) {
  const context = await getChecklistContext(ownerId);
  const checklist = context.checklists.find((item) => item.id === id);
  if (!checklist) return undefined;
  const items = context.items
    .filter((item) => item.checklistId === id)
    .sort((a, b) => a.position - b.position);
  const builder = createSummaryBuilder(context.checklists, context.items, context.relations);
  const summary = builder.getSummary(id);
  if (!summary) return undefined;
  const relatedChecklists = context.relations
    .filter((relation) => relation.parentChecklistId === id)
    .map((relation) => ({
      ...relation,
      relationType: relation.relationType as ChecklistRelationType,
      checklist: builder.getSummary(relation.childChecklistId),
    }))
    .filter((relation) => relation.checklist);

  return {
    ...checklist,
    ...summary,
    relatedChecklists,
    items: items.map((item) => ({
      ...item,
      status: item.status as ChecklistStatus,
    })),
  };
}

router.get("/checklists", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const context = await getChecklistContext(ownerId);
  const builder = createSummaryBuilder(context.checklists, context.items, context.relations);
  const summary = context.checklists
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((checklist) => builder.getSummary(checklist.id));

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
        note: "",
        status: "todo",
      })),
    );

    return created;
  });

  const payload = await getChecklistPayload(checklist.id, ownerId);
  res.status(201).json(CreateChecklistResponse.parse(payload));
});

router.get("/checklists/:id/relations", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = CreateChecklistRelationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid checklist." });
    return;
  }
  const context = await getChecklistContext(ownerId);
  if (!context.checklists.some((checklist) => checklist.id === params.data.id)) {
    res.status(404).json({ error: "Checklist not found." });
    return;
  }
  const builder = createSummaryBuilder(context.checklists, context.items, context.relations);
  const payload = context.relations
    .filter((relation) => relation.parentChecklistId === params.data.id)
    .map((relation) => ({
      ...relation,
      relationType: relation.relationType as ChecklistRelationType,
      checklist: builder.getSummary(relation.childChecklistId),
    }))
    .filter((relation) => relation.checklist);
  res.json(ListChecklistRelationsResponse.parse(payload));
});

router.post("/checklists/:id/relations", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = CreateChecklistRelationParams.safeParse(req.params);
  const parsed = CreateChecklistRelationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose a child checklist and relation type." });
    return;
  }
  const context = await getChecklistContext(ownerId);
  const parent = context.checklists.find((checklist) => checklist.id === params.data.id);
  const child = context.checklists.find((checklist) => checklist.id === parsed.data.childChecklistId);
  if (!parent || !child) {
    res.status(404).json({ error: "Parent or child checklist not found." });
    return;
  }
  if (parent.id === child.id || relationHasPath(child.id, parent.id, context.relations)) {
    res.status(400).json({ error: "That connection would create a circular checklist chain." });
    return;
  }

  const [created] = await db
    .insert(checklistRelationsTable)
    .values({
      parentChecklistId: parent.id,
      childChecklistId: child.id,
      relationType: parsed.data.relationType ?? "supports",
    })
    .onConflictDoNothing()
    .returning();
  const relation = created ?? (await db
    .select()
    .from(checklistRelationsTable)
    .where(and(
      eq(checklistRelationsTable.parentChecklistId, parent.id),
      eq(checklistRelationsTable.childChecklistId, child.id),
    )))[0];
  if (!relation) {
    res.status(500).json({ error: "Could not create the checklist connection." });
    return;
  }
  const updatedContext = await getChecklistContext(ownerId);
  const builder = createSummaryBuilder(
    updatedContext.checklists,
    updatedContext.items,
    updatedContext.relations,
  );
  res.status(201).json(CreateChecklistRelationResponse.parse({
    ...relation,
    relationType: relation.relationType as ChecklistRelationType,
    checklist: builder.getSummary(child.id),
  }));
});

router.delete("/checklists/:id/relations/:relationId", async (req, res): Promise<void> => {
  const ownerId = getOwnerId(req);
  const params = DeleteChecklistRelationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid checklist connection." });
    return;
  }
  const context = await getChecklistContext(ownerId);
  if (!context.checklists.some((checklist) => checklist.id === params.data.id)) {
    res.status(404).json({ error: "Checklist not found." });
    return;
  }
  const [deleted] = await db
    .delete(checklistRelationsTable)
    .where(and(
      eq(checklistRelationsTable.id, params.data.relationId),
      eq(checklistRelationsTable.parentChecklistId, params.data.id),
    ))
    .returning({ id: checklistRelationsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Checklist connection not found." });
    return;
  }
  res.sendStatus(204);
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
        note: parsed.data.note?.trim() ?? "",
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
        ...(parsed.data.note === undefined ? {} : { note: parsed.data.note.trim() }),
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