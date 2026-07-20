/**
 * Grok AI checker — logs in via X.com (Twitter) using Playwright.
 *
 * Grok is tied to an X/Twitter account, so "checking a Grok account" means
 * verifying the underlying X account credentials still work.
 *
 * Login flow (X.com, 2024/2025 layout):
 *   1. https://x.com/login  →  email input  →  Next
 *   2. (optional) username-confirmation step
 *   3. password input  →  Log in
 *   4. Expect redirect to /home  or  primaryColumn visible
 *
 * Recognised outcomes:
 *   healthy   — logged in successfully
 *   unhealthy — wrong password / suspended / needs-verification
 *   error     — network issue / timeout / browser not installed
 */

import type { CheckerPlugin, CheckResult, CheckOptions } from "./index.js";

const grokPlugin: CheckerPlugin = {
  id: "grok",
  name: "Grok AI (X / Twitter)",

  async check(
    email: string,
    password: string,
    options: CheckOptions = {},
  ): Promise<CheckResult> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const start = Date.now();
    let browser: any = null;

    const elapsed = () => Date.now() - start;

    try {
      // Dynamic import keeps playwright out of the esbuild bundle;
      // it must be installed in node_modules at runtime.
      const { chromium } = await import("playwright");

      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,800",
        ],
      });

      const ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        timezoneId: "America/New_York",
      });

      // Mask common automation fingerprints
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
        // @ts-ignore
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        // @ts-ignore
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        // @ts-ignore
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      });

      const page = await ctx.newPage();
      page.setDefaultTimeout(timeoutMs);

      // ── 1. Navigate to login ───────────────────────────────────────────────
      await page.goto("https://x.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(2_000);

      // ── 2. Enter email ────────────────────────────────────────────────────
      const emailSel =
        'input[autocomplete="username"], input[name="text"], input[type="text"]';
      const emailInput = page.locator(emailSel).first();
      await emailInput.waitFor({ state: "visible", timeout: 15_000 });
      await emailInput.click();
      await page.waitForTimeout(400);
      await emailInput.fill(email);
      await page.waitForTimeout(400);

      // Click the "Next" button (text may vary by locale)
      await page
        .locator(
          '[data-testid="LoginForm_Forward_Button"], ' +
          '[role="button"]:has-text("Next"), ' +
          'button:has-text("Next")',
        )
        .first()
        .click();
      await page.waitForTimeout(2_500);

      // ── 3. Optional username-confirmation step ────────────────────────────
      // X sometimes shows "Enter your phone or username" to prevent bots.
      const usernameConfirmInput = page.locator(
        'input[data-testid="ocfEnterTextTextInput"]',
      );
      if (
        await usernameConfirmInput
          .isVisible({ timeout: 2_500 })
          .catch(() => false)
      ) {
        const username = email.includes("@") ? email.split("@")[0] : email;
        await usernameConfirmInput.fill(username);
        await page.waitForTimeout(400);
        await page
          .locator('[data-testid="ocfEnterTextNextButton"]')
          .click()
          .catch(() => page.keyboard.press("Enter"));
        await page.waitForTimeout(2_500);
      }

      // ── 4. Enter password ─────────────────────────────────────────────────
      const pwInput = page.locator('input[type="password"]').first();
      const pwVisible = await pwInput
        .isVisible({ timeout: 12_000 })
        .catch(() => false);

      if (!pwVisible) {
        const url = page.url();
        // Maybe we're already at home (e.g. cookie-based session)
        if (url.includes("/home")) {
          return {
            status: "healthy",
            message: "Đã đăng nhập (phiên còn hiệu lực)",
            responseTime: elapsed(),
          };
        }
        return {
          status: "error",
          message: `Không tìm thấy ô nhập mật khẩu — URL: ${url.split("?")[0]}`,
          responseTime: elapsed(),
        };
      }

      await pwInput.click();
      await page.waitForTimeout(300);
      await pwInput.fill(password);
      await page.waitForTimeout(400);

      // Click "Log in" button
      const loginBtn = page.locator('[data-testid="LoginForm_Login_Button"]');
      if (await loginBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await loginBtn.click();
      } else {
        await pwInput.press("Enter");
      }

      // ── 5. Wait for the result ────────────────────────────────────────────
      await page.waitForTimeout(6_000);

      const finalUrl = page.url();
      const responseTime = elapsed();

      // ── Success: landed on home feed ──────────────────────────────────────
      if (
        finalUrl.includes("/home") ||
        finalUrl.match(/x\.com\/?$/) ||
        finalUrl.match(/twitter\.com\/?$/)
      ) {
        return {
          status: "healthy",
          message: `Đăng nhập thành công (${responseTime}ms)`,
          responseTime,
        };
      }

      const hasFeed = await page
        .locator('[data-testid="primaryColumn"]')
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (hasFeed) {
        return {
          status: "healthy",
          message: `Đăng nhập thành công (${responseTime}ms)`,
          responseTime,
        };
      }

      // ── Failure analysis ───────────────────────────────────────────────────
      const toastText = await page
        .locator('[data-testid="toast"], [role="alert"]')
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => "");

      // Still on login page
      if (
        finalUrl.includes("/login") ||
        finalUrl.includes("/i/flow/login")
      ) {
        if (toastText && /wrong|incorrect|didn't match/i.test(toastText)) {
          return {
            status: "unhealthy",
            message: "Sai mật khẩu",
            responseTime,
            detail: toastText.trim(),
          };
        }
        if (toastText && /too many|rate limit|unusual/i.test(toastText)) {
          return {
            status: "error",
            message: `Rate-limited / Hoạt động bất thường — ${toastText.trim().slice(0, 100)}`,
            responseTime,
          };
        }
        return {
          status: "unhealthy",
          message: toastText
            ? `Đăng nhập thất bại: ${toastText.trim().slice(0, 120)}`
            : "Đăng nhập thất bại (không rõ lý do)",
          responseTime,
        };
      }

      // Phone / 2FA verification required
      if (
        finalUrl.includes("challenge") ||
        finalUrl.includes("verification") ||
        finalUrl.includes("/i/flow/")
      ) {
        return {
          status: "unhealthy",
          message: `Yêu cầu xác minh (2FA / số điện thoại) — ${finalUrl.split("?")[0]}`,
          responseTime,
        };
      }

      // Account suspended
      const bodySnippet = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (/suspended|account has been suspended/i.test(bodySnippet)) {
        return {
          status: "unhealthy",
          message: "Tài khoản bị tạm ngừng (suspended)",
          responseTime,
        };
      }

      return {
        status: "error",
        message: `Không xác định được trạng thái — URL: ${finalUrl.split("?")[0]}`,
        responseTime,
      };
    } catch (e: any) {
      const responseTime = elapsed();
      const msg: string = e?.message ?? String(e);

      if (/timeout/i.test(msg)) {
        return {
          status: "error",
          message: `Timeout sau ${timeoutMs}ms`,
          responseTime,
        };
      }
      if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
        return {
          status: "error",
          message:
            "Chromium chưa được cài đặt. Chạy: npx playwright install chromium --with-deps",
          responseTime,
        };
      }
      return {
        status: "error",
        message: `Playwright error: ${msg.slice(0, 200)}`,
        responseTime,
      };
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};

export default grokPlugin;
