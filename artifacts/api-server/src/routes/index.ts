import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botAdminRouter from "./botAdmin";
import ocrRouter from "./ocr";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botAdminRouter);
router.use(ocrRouter);

export default router;
