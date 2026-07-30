import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botAdminRouter from "./botAdmin";
import ocrRouter from "./ocr";
import sheetsSettingsRouter from "./sheetsSettings";
import marketOrdersRouter from "./marketOrders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botAdminRouter);
router.use(ocrRouter);
router.use(sheetsSettingsRouter);
router.use(marketOrdersRouter);

export default router;
