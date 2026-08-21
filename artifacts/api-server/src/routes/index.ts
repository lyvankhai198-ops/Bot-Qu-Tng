import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botAdminRouter from "./botAdmin";
import ocrRouter from "./ocr";
import marketOrdersRouter from "./marketOrders";
import exportSheetRouter from "./exportSheet";
import chatSupportRouter from "./chatSupport";
import aiUsageRouter from "./aiUsage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botAdminRouter);
router.use(ocrRouter);
router.use(marketOrdersRouter);
router.use(exportSheetRouter);
router.use(chatSupportRouter);
router.use(aiUsageRouter);

export default router;
