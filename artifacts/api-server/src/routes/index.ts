import { Router, type IRouter } from "express";
import healthRouter from "./health";
import checklistsRouter from "./checklists";
import collectionsRouter from "./collections";

const router: IRouter = Router();

router.use(healthRouter);
router.use(checklistsRouter);
router.use(collectionsRouter);

export default router;
