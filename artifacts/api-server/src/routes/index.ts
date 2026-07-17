import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botAdminRouter from "./botAdmin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botAdminRouter);

export default router;
