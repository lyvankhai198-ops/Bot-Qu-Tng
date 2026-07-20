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
 * Standardised result codes returned:
 *   ACTIVE           — logged in successfully
 *   PACKAGE_LOST     — logged in but Grok subscription not active
 *   PASSWORD_INVALID — wrong password
 *   ACCOUNT_BANNED   — account suspended
 *   ACCOUNT_LOCKED   — account locked
 *   REQUIRE_EMAIL    — needs email verification
 *   REQUIRE_PHONE    — needs phone / 2FA verification
 *   CAPTCHA          — rate-limited / bot-detection block
 *   NETWORK_ERROR    — could not connect
 *   TIMEOUT          — Playwright timed out
 *   UNKNOWN          — unrecognised state
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
    const logs: string[] = [];

    const elapsed = () => Date.now() - start;
    const log = (msg: string) => {
      logs.push(`[${elapsed()}ms] ${msg}`);
    };

    try {
      const { chromium } = await import("playwright");

      log("Launching Chromium");
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

      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
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
      log("Navigating to x.com/login");
      await page.goto("https://x.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(2_000);

      // ── 2. Enter email ────────────────────────────────────────────────────
      log("Entering email");
      const emailSel =
        'input[autocomplete="username"], input[name="text"], input[type="text"]';
      const emailInput = page.locator(emailSel).first();
      await emailInput.waitFor({ state: "visible", timeout: 15_000 });
      await emailInput.click();
      await page.waitForTimeout(400);
      await emailInput.fill(email);
      await page.waitForTimeout(400);

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
      const usernameConfirmInput = page.locator(
        'input[data-testid="ocfEnterTextTextInput"]',
      );
      if (
        await usernameConfirmInput
          .isVisible({ timeout: 2_500 })
          .catch(() => false)
      ) {
        log("Username confirmation step");
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
      log("Entering password");
      const pwInput = page.locator('input[type="password"]').first();
      const pwVisible = await pwInput
        .isVisible({ timeout: 12_000 })
        .catch(() => false);

      if (!pwVisible) {
        const url = page.url();
        if (url.includes("/home")) {
          log("Already at home (session cookie)");
          return {
            code: "ACTIVE",
            message: "Đã đăng nhập (phiên còn hiệu lực)",
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }
        log(`Password input not found — URL: ${url}`);
        return {
          code: "UNKNOWN",
          message: `Không tìm thấy ô nhập mật khẩu — URL: ${url.split("?")[0]}`,
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      await pwInput.click();
      await page.waitForTimeout(300);
      await pwInput.fill(password);
      await page.waitForTimeout(400);

      const loginBtn = page.locator('[data-testid="LoginForm_Login_Button"]');
      if (await loginBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await loginBtn.click();
      } else {
        await pwInput.press("Enter");
      }

      // ── 5. Wait for the result ────────────────────────────────────────────
      log("Waiting for login result");
      await page.waitForTimeout(6_000);

      const finalUrl = page.url();
      const responseTime = elapsed();
      log(`Final URL: ${finalUrl}`);

      // ── Success: landed on home feed ──────────────────────────────────────
      if (
        finalUrl.includes("/home") ||
        finalUrl.match(/x\.com\/?$/) ||
        finalUrl.match(/twitter\.com\/?$/)
      ) {
        return {
          code: "ACTIVE",
          message: `Đăng nhập thành công (${responseTime}ms)`,
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      const hasFeed = await page
        .locator('[data-testid="primaryColumn"]')
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (hasFeed) {
        return {
          code: "ACTIVE",
          message: `Đăng nhập thành công (${responseTime}ms)`,
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      // ── Failure analysis ───────────────────────────────────────────────────
      const toastText = await page
        .locator('[data-testid="toast"], [role="alert"]')
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => "");

      // Email / phone verification required
      if (
        finalUrl.includes("challenge") ||
        finalUrl.includes("/i/flow/")
      ) {
        if (/email/i.test(finalUrl) || /email/i.test(toastText ?? "")) {
          return {
            code: "REQUIRE_EMAIL",
            message: `Yêu cầu xác minh email — ${finalUrl.split("?")[0]}`,
            responseTime,
            playwrightLog: logs.join("\n"),
          };
        }
        return {
          code: "REQUIRE_PHONE",
          message: `Yêu cầu xác minh số điện thoại / 2FA — ${finalUrl.split("?")[0]}`,
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      // Still on login page
      if (
        finalUrl.includes("/login") ||
        finalUrl.includes("/i/flow/login")
      ) {
        if (toastText && /wrong|incorrect|didn't match/i.test(toastText)) {
          return {
            code: "PASSWORD_INVALID",
            message: "Sai mật khẩu",
            responseTime,
            playwrightLog: logs.join("\n"),
          };
        }
        if (toastText && /too many|rate limit|unusual/i.test(toastText)) {
          return {
            code: "CAPTCHA",
            message: `Bị chặn do hoạt động bất thường — ${toastText.trim().slice(0, 100)}`,
            responseTime,
            playwrightLog: logs.join("\n"),
          };
        }
        return {
          code: "PASSWORD_INVALID",
          message: toastText
            ? `Đăng nhập thất bại: ${toastText.trim().slice(0, 120)}`
            : "Sai mật khẩu hoặc tài khoản không hợp lệ",
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      // Account suspended
      const bodySnippet = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (/suspended|account has been suspended/i.test(bodySnippet)) {
        return {
          code: "ACCOUNT_BANNED",
          message: "Tài khoản bị tạm ngừng (suspended)",
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }
      if (/locked|temporarily locked/i.test(bodySnippet)) {
        return {
          code: "ACCOUNT_LOCKED",
          message: "Tài khoản bị khóa tạm thời",
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      return {
        code: "UNKNOWN",
        message: `Không xác định được trạng thái — URL: ${finalUrl.split("?")[0]}`,
        responseTime,
        playwrightLog: logs.join("\n"),
      };
    } catch (e: any) {
      const responseTime = elapsed();
      const msg: string = e?.message ?? String(e);
      log(`Exception: ${msg.slice(0, 300)}`);

      if (/timeout/i.test(msg)) {
        return {
          code: "TIMEOUT",
          message: `Timeout sau ${timeoutMs}ms`,
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }
      if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
        return {
          code: "NETWORK_ERROR",
          message: "Chromium chưa được cài đặt. Chạy: npx playwright install chromium --with-deps",
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }
      if (/net::|ERR_/i.test(msg)) {
        return {
          code: "NETWORK_ERROR",
          message: `Lỗi kết nối mạng: ${msg.slice(0, 150)}`,
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }
      return {
        code: "UNKNOWN",
        message: `Playwright error: ${msg.slice(0, 200)}`,
        responseTime,
        playwrightLog: logs.join("\n"),
      };
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};

export default grokPlugin;
