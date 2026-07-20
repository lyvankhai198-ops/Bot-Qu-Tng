/**
 * ChatGPT checker — logs in via chatgpt.com using Playwright.
 *
 * OpenAI login flow (2024/2025):
 *   1. https://chatgpt.com  →  click "Log in"
 *   2. auth0/openai sign-in page  →  enter email  →  Continue
 *   3. Enter password  →  Continue
 *   4. Redirected back to chatgpt.com  →  check subscription tier
 *
 * Subscription detection:
 *   - "ChatGPT Plus" or "Pro" label in sidebar / account menu  →  ACTIVE
 *   - Logged in but no paid plan found  →  PACKAGE_LOST
 *
 * Standardised result codes:
 *   ACTIVE           — logged in, paid plan still active
 *   PACKAGE_LOST     — logged in but subscription expired / downgraded to free
 *   PASSWORD_INVALID — wrong email or password
 *   ACCOUNT_BANNED   — account deactivated / banned
 *   ACCOUNT_LOCKED   — account locked (requires verification)
 *   REQUIRE_EMAIL    — needs email verification
 *   REQUIRE_PHONE    — needs phone / 2FA verification
 *   CAPTCHA          — rate-limited / bot-detection block
 *   NETWORK_ERROR    — could not connect
 *   TIMEOUT          — Playwright timed out
 *   UNKNOWN          — unrecognised state
 */

import type { CheckerPlugin, CheckResult, CheckOptions } from "./index.js";

const chatgptPlugin: CheckerPlugin = {
  id: "chatgpt",
  name: "ChatGPT (OpenAI)",

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
    const log = (msg: string) => logs.push(`[${elapsed()}ms] ${msg}`);

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

      // ── 1. Navigate to chatgpt.com ──────────────────────────────────────────
      log("Navigating to chatgpt.com");
      await page.goto("https://chatgpt.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(2_000);

      const landingUrl = page.url();
      log(`Landing URL: ${landingUrl}`);

      // Already logged in (session cookie still valid)?
      if (
        landingUrl.includes("chatgpt.com") &&
        !landingUrl.includes("/auth/") &&
        !landingUrl.includes("auth0") &&
        !landingUrl.includes("login")
      ) {
        const alreadyLoggedIn =
          (await page.locator('[data-testid="profile-button"], nav, [aria-label="Chat history"]')
            .first()
            .isVisible({ timeout: 4_000 })
            .catch(() => false));
        if (alreadyLoggedIn) {
          log("Session already active — checking subscription");
          return await checkSubscription(page, elapsed, logs);
        }
      }

      // ── 2. Click "Log in" button ────────────────────────────────────────────
      log("Clicking Log in");
      const loginBtn = page.locator(
        'button:has-text("Log in"), a:has-text("Log in"), [data-testid="login-button"]',
      ).first();
      const btnVisible = await loginBtn.isVisible({ timeout: 8_000 }).catch(() => false);
      if (btnVisible) {
        await loginBtn.click();
        await page.waitForTimeout(2_000);
      }

      // ── 3. Enter email ──────────────────────────────────────────────────────
      log("Entering email");
      const emailInput = page.locator(
        'input[type="email"], input[name="email"], input[name="username"], ' +
        'input[autocomplete="email"], input[autocomplete="username"]',
      ).first();
      await emailInput.waitFor({ state: "visible", timeout: 15_000 });
      await emailInput.click();
      await page.waitForTimeout(300);
      await emailInput.fill(email);
      await page.waitForTimeout(400);

      // Click Continue / Next
      const continueBtn = page.locator(
        'button[type="submit"], button:has-text("Continue"), button:has-text("Next")',
      ).first();
      await continueBtn.click();
      await page.waitForTimeout(2_500);

      // ── 4. Enter password ───────────────────────────────────────────────────
      log("Entering password");
      const pwInput = page.locator('input[type="password"]').first();
      const pwVisible = await pwInput.isVisible({ timeout: 15_000 }).catch(() => false);

      if (!pwVisible) {
        const url = page.url();
        log(`Password field not visible — URL: ${url}`);

        // Could be error: email not found
        const errText = await page.locator('[class*="error"], [class*="alert"], [role="alert"]')
          .first()
          .textContent({ timeout: 2_000 })
          .catch(() => "");
        if (errText && /wrong|incorrect|not find|can't find|no account/i.test(errText)) {
          return {
            code: "PASSWORD_INVALID",
            message: `Email không tồn tại hoặc sai: ${errText.trim().slice(0, 120)}`,
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }

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

      const pwSubmit = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Sign in")').first();
      if (await pwSubmit.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await pwSubmit.click();
      } else {
        await pwInput.press("Enter");
      }

      // ── 5. Wait for result ──────────────────────────────────────────────────
      log("Waiting for login result");
      await page.waitForTimeout(7_000);

      const finalUrl = page.url();
      log(`Final URL: ${finalUrl}`);

      // ── Error: still on auth page ───────────────────────────────────────────
      if (
        finalUrl.includes("auth0") ||
        finalUrl.includes("/authorize") ||
        finalUrl.includes("/u/login") ||
        finalUrl.includes("errors=")
      ) {
        const errEl = page.locator('[class*="error"], [role="alert"], [class*="invalid"]').first();
        const errText = await errEl.textContent({ timeout: 2_000 }).catch(() => "");
        log(`Auth error text: ${errText}`);

        if (/wrong|incorrect|invalid/i.test(errText)) {
          return {
            code: "PASSWORD_INVALID",
            message: "Sai email hoặc mật khẩu",
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }
        if (/blocked|too many/i.test(errText)) {
          return {
            code: "CAPTCHA",
            message: `Bị chặn: ${errText.trim().slice(0, 120)}`,
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }

        return {
          code: "PASSWORD_INVALID",
          message: errText
            ? `Đăng nhập thất bại: ${errText.trim().slice(0, 150)}`
            : `Đăng nhập thất bại — vẫn ở trang auth`,
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      // ── Verification required ───────────────────────────────────────────────
      if (finalUrl.includes("challenge") || finalUrl.includes("verify")) {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (/email/i.test(bodyText)) {
          return {
            code: "REQUIRE_EMAIL",
            message: `Yêu cầu xác minh email — ${finalUrl.split("?")[0]}`,
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }
        return {
          code: "REQUIRE_PHONE",
          message: `Yêu cầu xác minh số điện thoại / 2FA — ${finalUrl.split("?")[0]}`,
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      // ── Account deactivated / banned ────────────────────────────────────────
      if (finalUrl.includes("deactivated") || finalUrl.includes("banned")) {
        return {
          code: "ACCOUNT_BANNED",
          message: "Tài khoản bị vô hiệu hóa",
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      // ── Successfully landed on chatgpt.com ──────────────────────────────────
      if (finalUrl.includes("chatgpt.com") || finalUrl.includes("chat.openai.com")) {
        return await checkSubscription(page, elapsed, logs);
      }

      return {
        code: "UNKNOWN",
        message: `Không xác định được trạng thái — URL: ${finalUrl.split("?")[0]}`,
        responseTime: elapsed(),
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
      if (/Executable doesn't exist|browserType\.launch|Cannot find browser|browser.*not.*found|Failed to launch|spawn.*ENOENT/i.test(msg)) {
        return {
          code: "NETWORK_ERROR",
          message: "Chromium chưa được cài / không tìm thấy binary. Chạy trên VPS: cd artifacts/api-server && npx playwright install chromium --with-deps",
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

/**
 * After successful login, check if the account has an active paid plan.
 * Navigates to the account / settings page to inspect the subscription.
 */
async function checkSubscription(
  page: any,
  elapsed: () => number,
  logs: string[],
): Promise<CheckResult> {
  const log = (msg: string) => logs.push(`[${elapsed()}ms] ${msg}`);

  try {
    // Wait a bit for the page to fully render
    await page.waitForTimeout(3_000);

    // Strategy 1: Check the sidebar for "Plus" / "Pro" badge
    log("Checking sidebar for subscription badge");
    const sidebarText = await page
      .locator('nav, [class*="sidebar"], [class*="Sidebar"]')
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => "");

    if (/\bPro\b/i.test(sidebarText)) {
      log("Found 'Pro' in sidebar");
      return {
        code: "ACTIVE",
        message: "Tài khoản ChatGPT Pro — đang hoạt động",
        responseTime: elapsed(),
        playwrightLog: logs.join("\n"),
      };
    }
    if (/\bPlus\b/i.test(sidebarText)) {
      log("Found 'Plus' in sidebar");
      return {
        code: "ACTIVE",
        message: "Tài khoản ChatGPT Plus — đang hoạt động",
        responseTime: elapsed(),
        playwrightLog: logs.join("\n"),
      };
    }

    // Strategy 2: Navigate to subscription settings
    log("Navigating to settings to check subscription");
    await page.goto("https://chatgpt.com/settings", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(3_000);

    const settingsUrl = page.url();
    log(`Settings URL: ${settingsUrl}`);

    // Redirected away from settings — still check body
    const pageBody = await page.locator("body").innerText().catch(() => "");

    if (/ChatGPT Pro/i.test(pageBody)) {
      log("ChatGPT Pro subscription found in settings");
      return {
        code: "ACTIVE",
        message: "Tài khoản ChatGPT Pro — đang hoạt động",
        responseTime: elapsed(),
        playwrightLog: logs.join("\n"),
      };
    }
    if (/ChatGPT Plus|Plus plan|Plus subscription/i.test(pageBody)) {
      log("ChatGPT Plus subscription found in settings");
      return {
        code: "ACTIVE",
        message: "Tài khoản ChatGPT Plus — đang hoạt động",
        responseTime: elapsed(),
        playwrightLog: logs.join("\n"),
      };
    }
    if (/Team|Enterprise/i.test(pageBody)) {
      log("ChatGPT Team/Enterprise subscription found");
      return {
        code: "ACTIVE",
        message: "Tài khoản ChatGPT Team/Enterprise — đang hoạt động",
        responseTime: elapsed(),
        playwrightLog: logs.join("\n"),
      };
    }

    // Strategy 3: Check model selector for GPT-4o / GPT-4 access
    log("Going back to chat to check model selector");
    await page.goto("https://chatgpt.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(3_000);

    // Try to open the model picker
    const modelPicker = page.locator(
      '[data-testid="model-switcher-button"], [aria-label*="Model"], button:has-text("GPT")',
    ).first();
    const pickerVisible = await modelPicker.isVisible({ timeout: 3_000 }).catch(() => false);
    if (pickerVisible) {
      await modelPicker.click();
      await page.waitForTimeout(1_500);
      const pickerText = await page.locator('[role="menu"], [role="listbox"], [data-testid*="model"]')
        .first()
        .textContent({ timeout: 3_000 })
        .catch(() => "");
      log(`Model picker text: ${pickerText?.slice(0, 200)}`);

      if (/GPT-4o|GPT-4|o3|o4/i.test(pickerText ?? "")) {
        return {
          code: "ACTIVE",
          message: "Tài khoản ChatGPT có GPT-4o — đang hoạt động",
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }
    }

    // Logged in but no paid plan detected
    log("Logged in but no paid subscription detected");
    return {
      code: "PACKAGE_LOST",
      message: "Đăng nhập thành công nhưng không phát hiện gói trả phí (Plus/Pro)",
      responseTime: elapsed(),
      playwrightLog: logs.join("\n"),
    };
  } catch (e: any) {
    log(`checkSubscription error: ${e?.message?.slice(0, 200)}`);
    // We know login worked (we're here after successful auth), but subscription check failed
    return {
      code: "ACTIVE",
      message: "Đăng nhập thành công (không kiểm tra được gói — coi là còn hoạt động)",
      responseTime: elapsed(),
      playwrightLog: logs.join("\n"),
    };
  }
}

export default chatgptPlugin;
