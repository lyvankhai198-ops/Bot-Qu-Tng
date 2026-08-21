import { Router } from "express";
import {
  requireAuth, verifyPassword, generateToken, revokeToken, loginRateLimiter,
} from "../lib/auth";

const router = Router();

// ── POST /bot/auth ────────────────────────────────────────────────────────────
router.post("/bot/auth", loginRateLimiter, async (req: any, res: any) => {
  const { password } = req.body ?? {};
  const ok = await verifyPassword(password ?? "");
  if (!ok) {
    res.status(401).json({ error: "Mật khẩu không đúng" });
    return;
  }
  const token = generateToken();
  // HttpOnly, Secure (prod only), SameSite=Strict, scoped to /api
  res.cookie("admin_token", token, {
    httpOnly:  true,
    secure:    process.env.NODE_ENV === "production",
    sameSite:  "strict",
    maxAge:    8 * 60 * 60 * 1000, // 8h
    path:      "/api",
  });
  // Also return token in body for backwards-compat (admin panel localStorage)
  res.json({ token });
});

// ── POST /bot/auth/logout ─────────────────────────────────────────────────────
router.post("/bot/auth/logout", (req: any, res: any) => {
  const cookieToken  = req.cookies?.admin_token ?? "";
  const authHeader   = (req.headers["authorization"] as string) ?? "";
  const bearerToken  = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const token = cookieToken || bearerToken;
  if (token) revokeToken(token);
  res.clearCookie("admin_token", { path: "/api" });
  res.json({ ok: true });
});

export default router;
