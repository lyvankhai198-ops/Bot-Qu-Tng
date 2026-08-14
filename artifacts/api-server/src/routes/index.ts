import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botAdminRouter from "./botAdmin";
import ocrRouter from "./ocr";
import marketOrdersRouter from "./marketOrders";
import warrantySheetsRouter from "./warrantySheets";
import exportSheetRouter from "./exportSheet";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botAdminRouter);
router.use(ocrRouter);
router.use(marketOrdersRouter);
router.use(warrantySheetsRouter);
router.use(exportSheetRouter);

export default router;
