import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const isDev        = process.env.NODE_ENV !== "production";
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN;

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Security headers (Helmet) ─────────────────────────────────────────────────
// CSP disabled — admin panel served separately; CrossOriginEmbedderPolicy off for API
app.use(
  helmet({
    contentSecurityPolicy:      false,
    crossOriginEmbedderPolicy:  false,
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Production: allow only ADMIN_ORIGIN env var (if set), else same-origin only.
// Development: allow all origins so Vite dev server works without config.
app.use(
  cors({
    origin:      ADMIN_ORIGIN ? ADMIN_ORIGIN : (isDev ? true : false),
    credentials: true,
  }),
);

// ── Cookie parser ─────────────────────────────────────────────────────────────
app.use(cookieParser());

// ── Body limits ───────────────────────────────────────────────────────────────
// Default: 100kb — tight enough to prevent memory-bomb attacks.
// Upload routes (/ocr-extract, /xlsx-import) use multer and are unaffected by this.
// Broadcast endpoint body is text-only — 100kb covers any reasonable message.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

export default app;
