import { Router, type IRouter } from "express";
import healthRouter from "./health";
import checklistsRouter from "./checklists";

const router: IRouter = Router();

router.use(healthRouter);
router.use(checklistsRouter);

export default router;
