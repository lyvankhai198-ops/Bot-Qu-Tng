/**
 * auth.ts — JWT-based authentication service
 *
 * - Mật khẩu lưu dạng bcrypt hash trong ADMIN_PASSWORD_HASH env
 * - Nếu chưa set ADMIN_PASSWORD_HASH, fallback sang so sánh trực tiếp với SESSION_SECRET (legacy)
 * - JWT ký bằng SESSION_SECRET, TTL 8h
 * - In-memory revocation set cho logout
 * - Rate limiter 5 lần / 15 phút per IP
 */
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

// ── Constants ─────────────────────────────────────────────────────────────────
const JWT_SECRET          = process.env.SESSION_SECRET ?? "dev-secret-change-me";
const JWT_TTL             = "8h";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? "";
const ADMIN_SECRET_LEGACY = process.env.SESSION_SECRET ?? "";

if (!process.env.SESSION_SECRET) {
  console.warn("[auth] WARNING: SESSION_SECRET is not set — using insecure default");
}
if (!ADMIN_PASSWORD_HASH && process.env.NODE_ENV === "production") {
  console.warn("[auth] WARNING: ADMIN_PASSWORD_HASH not set — using legacy SESSION_SECRET comparison");
  console.warn("[auth] To migrate: node -e \"require('bcryptjs').hash('YOUR_PASSWORD',12).then(h=>console.log(h))\"");
}

// ── In-memory revocation set ──────────────────────────────────────────────────
// Stores { jti, expiresAt } — cleaned up every hour to prevent unbounded growth
interface RevokedEntry { jti: string; expiresAt: number }
const revokedTokens = new Map<string, RevokedEntry>();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [jti, entry] of revokedTokens) {
    if (entry.expiresAt < now) revokedTokens.delete(jti);
  }
}, 3_600_000);
// Don't block process exit
if (cleanupInterval.unref) cleanupInterval.unref();

// ── Password helpers ──────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcryptjs.hash(password, 12);
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!password) return false;
  if (ADMIN_PASSWORD_HASH) {
    return bcryptjs.compare(password, ADMIN_PASSWORD_HASH);
  }
  // Legacy fallback: plain comparison with SESSION_SECRET
  return password === ADMIN_SECRET_LEGACY && Boolean(ADMIN_SECRET_LEGACY);
}

// ── Token helpers ─────────────────────────────────────────────────────────────
export function generateToken(): string {
  const jti = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return jwt.sign({ jti }, JWT_SECRET, { expiresIn: JWT_TTL });
}

export function verifyToken(token: string): { jti?: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded?.jti && revokedTokens.has(decoded.jti)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function revokeToken(token: string): void {
  try {
    const decoded = jwt.decode(token) as any;
    if (decoded?.jti) {
      const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + 8 * 3_600_000;
      revokedTokens.set(decoded.jti, { jti: decoded.jti, expiresAt });
    }
  } catch {}
}

// ── requireAuth middleware ────────────────────────────────────────────────────
// Reads JWT from: cookie admin_token → Authorization: Bearer <token>
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookieToken  = (req as any).cookies?.admin_token ?? "";
  const authHeader   = (req.headers["authorization"] as string) ?? "";
  const bearerToken  = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const token = cookieToken || bearerToken;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  next();
}

// ── Login rate limiter ────────────────────────────────────────────────────────
export const loginRateLimiter = rateLimit({
  windowMs:              15 * 60 * 1000,  // 15 minutes
  max:                   5,
  standardHeaders:       true,
  legacyHeaders:         false,
  skipSuccessfulRequests: true,
  message: { error: "Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút." },
});
