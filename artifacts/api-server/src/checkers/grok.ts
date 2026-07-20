/**
 * Grok AI checker — đăng nhập trực tiếp tại grok.com
 *
 * Flow:
 *   1. Vào https://grok.com → click "Sign in"
 *   2. Redirect sang X.com OAuth → nhập email → (optional username) → mật khẩu
 *   3. Redirect về grok.com (đã đăng nhập)
 *   4. Kiểm tra gói SuperGrok: profile menu, sidebar, /settings
 *
 * Result codes:
 *   ACTIVE       — đăng nhập OK, gói SuperGrok còn hiệu lực
 *   PACKAGE_LOST — đăng nhập OK nhưng không có / hết SuperGrok
 *   PASSWORD_INVALID — sai mật khẩu
 *   ACCOUNT_BANNED   — tài khoản bị suspended
 *   ACCOUNT_LOCKED   — tài khoản bị khóa tạm thời
 *   REQUIRE_EMAIL    — cần xác minh email
 *   REQUIRE_PHONE    — cần xác minh số / 2FA
 *   CAPTCHA          — bị bot-detection chặn
 *   NETWORK_ERROR    — lỗi kết nối / Chromium chưa cài
 *   TIMEOUT          — hết thời gian
 *   UNKNOWN          — không xác định được
 */

import type { CheckerPlugin, CheckResult, CheckOptions } from "./index.js";

const grokPlugin: CheckerPlugin = {
  id: "grok",
  name: "Grok AI (SuperGrok — grok.com)",

  async check(
    email: string,
    password: string,
    options: CheckOptions = {},
  ): Promise<CheckResult> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const start = Date.now();
    let browser: any = null;
    const logs: string[] = [];

    const elapsed = () => Date.now() - start;
    const log = (msg: string) => logs.push(`[${elapsed()}ms] ${msg}`);

    // Helpers
    const safeText = async (page: any, sel: string, t = 3_000) =>
      page
        .locator(sel)
        .first()
        .textContent({ timeout: t })
        .catch(() => "");

    const safeVisible = async (page: any, sel: string, t = 3_000) =>
      page
        .locator(sel)
        .first()
        .isVisible({ timeout: t })
        .catch(() => false);

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
          "--window-size=1280,900",
        ],
      });

      const ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
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

      // ── 1. Vào grok.com ──────────────────────────────────────────────────────
      log("Navigating to grok.com");
      await page.goto("https://grok.com", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(2_500);

      let url = page.url();
      log(`After grok.com load — URL: ${url}`);

      // Nếu đã ở trang đăng nhập X thì bỏ qua bước click Sign in
      const alreadyAtXLogin =
        url.includes("x.com/i/oauth") ||
        url.includes("x.com/login") ||
        url.includes("accounts.x.com");

      if (!alreadyAtXLogin) {
        // Tìm nút Sign in / Log in
        const signInSel =
          'a[href*="sign-in"], a[href*="login"], ' +
          'button:has-text("Sign in"), button:has-text("Log in"), ' +
          'a:has-text("Sign in"), a:has-text("Log in")';

        const signInBtn = page.locator(signInSel).first();
        const hasSignIn = await signInBtn
          .isVisible({ timeout: 8_000 })
          .catch(() => false);

        if (hasSignIn) {
          log("Clicking Sign in button");
          await signInBtn.click();
          // Chờ redirect sang X OAuth
          try {
            await page.waitForURL(/x\.com|accounts\.x\.com/, {
              timeout: 20_000,
            });
          } catch {
            // Có thể popup, thử waitForNavigation
            await page.waitForTimeout(3_000);
          }
        } else {
          // Thử navigate thẳng đến OAuth endpoint
          log("Sign in button not found — trying direct URL");
          await page.goto(
            "https://x.com/i/oauth2/authorize?client_id=U1RBST1OWkFnT1RFd09EWXlNelEzTmpJNk1UYzFNekk1TkRBd01EYzJPVGMzTWc9OjE6MA&code_challenge=challenge&code_challenge_method=plain&redirect_uri=https://grok.com/auth/callback&response_type=code&scope=tweet.read%20users.read%20offline.access&state=state",
            { waitUntil: "domcontentloaded", timeout: 15_000 },
          );
          await page.waitForTimeout(2_000);
        }

        url = page.url();
        log(`After sign-in click — URL: ${url}`);

        // Nếu vẫn ở grok.com mà không redirect → thử navigate trực tiếp đến /auth
        if (!url.includes("x.com")) {
          await page.goto("https://grok.com/auth/login", {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });
          await page.waitForTimeout(2_000);
          url = page.url();
          log(`Fallback auth URL: ${url}`);
        }
      }

      // ── 2. Điền email trên X.com ─────────────────────────────────────────────
      url = page.url();
      log(`At X.com login — URL: ${url}`);

      if (url.includes("x.com") || url.includes("accounts.x.com")) {
        // Đợi trang load xong trước khi tìm input
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(3_000);

        // Dismiss cookie consent nếu có
        const cookieBtn = page.locator(
          'button:has-text("Accept"), button:has-text("Allow"), ' +
          '[data-testid="cookie-accept"], button:has-text("Agree")',
        ).first();
        if (await cookieBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          log("Dismissing cookie/consent popup");
          await cookieBtn.click().catch(() => {});
          await page.waitForTimeout(1_500);
        }

        // Log HTML snippet để debug khi cần
        const bodySnippetBefore = await page.locator("body").innerHTML().catch(() => "").then(h => h.slice(0, 300));
        log(`Body HTML snippet: ${bodySnippetBefore}`);

        const emailSel =
          'input[autocomplete="username"], input[name="text"], ' +
          'input[type="text"], input[type="email"], ' +
          '[data-testid="LoginForm_InputContainer"] input';
        const emailInput = page.locator(emailSel).first();
        // Tăng timeout lên 30s — X.com OAuth có thể load chậm
        await emailInput.waitFor({ state: "visible", timeout: 30_000 });

        log("Entering email");
        await emailInput.click();
        await page.waitForTimeout(400);
        await emailInput.fill(email);
        await page.waitForTimeout(500);

        // Click Next
        const nextBtn = page.locator(
          '[data-testid="LoginForm_Forward_Button"], ' +
          'button:has-text("Next"), [role="button"]:has-text("Next")',
        ).first();
        await nextBtn.click();
        await page.waitForTimeout(2_500);

        // ── 3. Optional username-confirmation ──────────────────────────────────
        const usernameInput = page.locator(
          'input[data-testid="ocfEnterTextTextInput"]',
        );
        if (await usernameInput.isVisible({ timeout: 2_500 }).catch(() => false)) {
          log("Username confirmation step");
          const username = email.includes("@") ? email.split("@")[0] : email;
          await usernameInput.fill(username);
          await page.waitForTimeout(400);
          await page
            .locator('[data-testid="ocfEnterTextNextButton"]')
            .click()
            .catch(() => page.keyboard.press("Enter"));
          await page.waitForTimeout(2_500);
        }

        // ── 4. Nhập mật khẩu ───────────────────────────────────────────────────
        log("Entering password");
        const pwInput = page.locator('input[type="password"]').first();
        const pwVisible = await pwInput
          .isVisible({ timeout: 12_000 })
          .catch(() => false);

        if (!pwVisible) {
          url = page.url();
          log(`Password input not visible — URL: ${url}`);

          // Kiểm tra toast trước khi trả lỗi
          const toast = await safeText(
            page,
            '[data-testid="toast"], [role="alert"]',
          );
          if (toast && /wrong|incorrect|didn't match/i.test(toast)) {
            return {
              code: "PASSWORD_INVALID",
              message: "Sai mật khẩu",
              responseTime: elapsed(),
              playwrightLog: logs.join("\n"),
            };
          }
          return {
            code: "UNKNOWN",
            message: `Không tìm thấy ô mật khẩu — URL: ${url.split("?")[0]}`,
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }

        await pwInput.click();
        await page.waitForTimeout(300);
        await pwInput.fill(password);
        await page.waitForTimeout(400);

        const loginBtn = page.locator(
          '[data-testid="LoginForm_Login_Button"]',
        );
        if (await loginBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await loginBtn.click();
        } else {
          await pwInput.press("Enter");
        }

        log("Waiting for X.com auth result");
        await page.waitForTimeout(6_000);

        // ── 5. Chờ redirect về grok.com ─────────────────────────────────────
        url = page.url();
        log(`After login submit — URL: ${url}`);

        // Phân tích kết quả khi vẫn còn ở X.com
        if (url.includes("x.com")) {
          const toastText = await safeText(
            page,
            '[data-testid="toast"], [role="alert"]',
          );
          const bodySnippet = await page
            .locator("body")
            .innerText()
            .catch(() => "");

          if (url.includes("challenge") || url.includes("/i/flow/")) {
            if (/email/i.test(url) || /email/i.test(toastText)) {
              return {
                code: "REQUIRE_EMAIL",
                message: "Yêu cầu xác minh email",
                responseTime: elapsed(),
                playwrightLog: logs.join("\n"),
              };
            }
            return {
              code: "REQUIRE_PHONE",
              message: "Yêu cầu xác minh số điện thoại / 2FA",
              responseTime: elapsed(),
              playwrightLog: logs.join("\n"),
            };
          }

          if (url.includes("/login") || url.includes("i/flow/login")) {
            if (
              (toastText && /wrong|incorrect|didn't match/i.test(toastText)) ||
              (bodySnippet && /wrong password|incorrect password/i.test(bodySnippet))
            ) {
              return {
                code: "PASSWORD_INVALID",
                message: "Sai mật khẩu",
                responseTime: elapsed(),
                playwrightLog: logs.join("\n"),
              };
            }
            if (toastText && /too many|rate limit|unusual/i.test(toastText)) {
              return {
                code: "CAPTCHA",
                message: `Bị chặn: ${toastText.trim().slice(0, 100)}`,
                responseTime: elapsed(),
                playwrightLog: logs.join("\n"),
              };
            }
            return {
              code: "PASSWORD_INVALID",
              message: toastText
                ? `Đăng nhập thất bại: ${toastText.trim().slice(0, 120)}`
                : "Sai mật khẩu hoặc tài khoản không hợp lệ",
              responseTime: elapsed(),
              playwrightLog: logs.join("\n"),
            };
          }

          if (/suspended|account has been suspended/i.test(bodySnippet)) {
            return {
              code: "ACCOUNT_BANNED",
              message: "Tài khoản X bị suspended",
              responseTime: elapsed(),
              playwrightLog: logs.join("\n"),
            };
          }
          if (/locked|temporarily locked/i.test(bodySnippet)) {
            return {
              code: "ACCOUNT_LOCKED",
              message: "Tài khoản X bị khóa tạm thời",
              responseTime: elapsed(),
              playwrightLog: logs.join("\n"),
            };
          }

          // Có thể cần xác nhận OAuth (Authorize App)
          const authorizeBtn = page.locator(
            'button:has-text("Authorize"), [data-testid*="authorize"], ' +
            'button:has-text("Allow")',
          ).first();
          if (
            await authorizeBtn.isVisible({ timeout: 3_000 }).catch(() => false)
          ) {
            log("Clicking OAuth Authorize");
            await authorizeBtn.click();
            await page.waitForTimeout(5_000);
            url = page.url();
            log(`After authorize — URL: ${url}`);
          }
        }

        // Chờ thêm để redirect về grok.com
        if (!url.includes("grok.com")) {
          try {
            await page.waitForURL(/grok\.com/, { timeout: 15_000 });
            url = page.url();
            log(`Redirected to grok.com — URL: ${url}`);
          } catch {
            url = page.url();
            log(`Still not at grok.com — URL: ${url}`);
          }
        }
      }

      // ── 6. Kiểm tra đã đăng nhập vào grok.com chưa ──────────────────────────
      url = page.url();
      const responseTime = elapsed();

      if (!url.includes("grok.com")) {
        log(`Login did not reach grok.com — final URL: ${url}`);
        return {
          code: "UNKNOWN",
          message: `Không redirect được về grok.com — URL: ${url.split("?")[0]}`,
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      log("Now at grok.com — checking subscription");
      await page.waitForTimeout(3_000); // Cho UI render

      // ── 7. Kiểm tra SuperGrok subscription ──────────────────────────────────
      // Thử nhiều indicator khác nhau

      // a) Kiểm tra toàn bộ page body text
      const pageBody = await page.locator("body").innerText().catch(() => "");
      log(`Body snippet (first 500): ${pageBody.slice(0, 500)}`);

      const hasSuperGrokInBody =
        /supergrok|super grok|super\s*plan|pro\s*plan|grok\s*pro|grok\s*super|SuperGrok/i.test(
          pageBody,
        );

      // b) Thử navigate đến trang subscription / profile
      let subscriptionPlan = "";
      let isSuper = false;

      try {
        log("Checking /settings for subscription");
        await page.goto("https://grok.com/settings", {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await page.waitForTimeout(2_500);

        const settingsBody = await page.locator("body").innerText().catch(() => "");
        log(`Settings body (first 800): ${settingsBody.slice(0, 800)}`);

        // Tìm plan name trong settings
        const superMatch = settingsBody.match(
          /(SuperGrok|Super Grok|Grok Pro|Grok Super|Super\s*Plan|Pro\s*Plan|annual|monthly|subscriber)/i,
        );
        if (superMatch) {
          subscriptionPlan = superMatch[0];
          isSuper = true;
          log(`Found subscription indicator in settings: ${subscriptionPlan}`);
        }

        // Tìm các badge / tag
        const badges = await page
          .locator('[class*="badge"], [class*="plan"], [class*="tier"], [class*="subscription"]')
          .allTextContents()
          .catch(() => [] as string[]);
        log(`Badges: ${JSON.stringify(badges.slice(0, 10))}`);
        if (badges.some((b) => /super|pro/i.test(b))) {
          isSuper = true;
          subscriptionPlan = badges.find((b) => /super|pro/i.test(b)) ?? "SuperGrok";
        }
      } catch (err: any) {
        log(`Settings navigation error: ${err?.message?.slice(0, 100)}`);
      }

      // c) Quay về trang chính và kiểm tra sidebar / header
      try {
        await page.goto("https://grok.com", {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await page.waitForTimeout(2_500);

        // Kiểm tra các element chứa plan info
        const planSels = [
          '[data-testid*="plan"], [data-testid*="subscription"], [data-testid*="tier"]',
          '[class*="SuperGrok"], [class*="supergrok"], [class*="super-grok"]',
          'span:has-text("SuperGrok"), span:has-text("Super Grok")',
          'div:has-text("SuperGrok")',
          '[aria-label*="SuperGrok"], [title*="SuperGrok"]',
          // Profile / avatar khu vực thường hiện plan
          'nav span, aside span, header span',
        ];

        for (const sel of planSels) {
          const els = await page
            .locator(sel)
            .allTextContents()
            .catch(() => [] as string[]);
          const matched = els.filter((t) => /super|pro/i.test(t));
          if (matched.length > 0) {
            isSuper = true;
            subscriptionPlan = matched[0].trim();
            log(`Found via selector "${sel}": ${subscriptionPlan}`);
            break;
          }
        }

        // d) Thử kiểm tra qua API endpoint nội bộ
        try {
          const resp = await page.evaluate(async () => {
            const r = await fetch("/api/auth/session", {
              credentials: "include",
            }).catch(() => null);
            if (!r) return null;
            return r.json().catch(() => null);
          });
          if (resp) {
            log(`Session API: ${JSON.stringify(resp).slice(0, 300)}`);
            const respStr = JSON.stringify(resp);
            if (/super|pro/i.test(respStr)) {
              isSuper = true;
              const m = respStr.match(/(SuperGrok|super_grok|grok_super|grokPro)/i);
              if (m) subscriptionPlan = m[0];
            }
          }
        } catch {
          // Ignore
        }

        // e) Thử feature-gating: SuperGrok thường có higher message limits hoặc image gen
        // Kiểm tra nếu "SuperGrok" badge hiển thị trong profile menu
        const profileBtn = page.locator(
          '[data-testid="user-menu"], [aria-label="Account menu"], ' +
          'button[aria-label*="profile"], [data-testid*="avatar"]',
        ).first();
        if (await profileBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await profileBtn.click().catch(() => {});
          await page.waitForTimeout(1_500);

          const menuText = await page.locator("body").innerText().catch(() => "");
          if (/SuperGrok|super grok|super plan/i.test(menuText)) {
            isSuper = true;
            const m = menuText.match(/SuperGrok|super grok|super plan/i);
            if (m) subscriptionPlan = m[0];
            log(`Found SuperGrok in profile menu: ${subscriptionPlan}`);
          }
        }
      } catch (err: any) {
        log(`Home page check error: ${err?.message?.slice(0, 100)}`);
      }

      // f) Fallback: kiểm tra body text từ lần đầu vào grok.com sau login
      if (!isSuper && hasSuperGrokInBody) {
        isSuper = true;
        subscriptionPlan = "SuperGrok";
        log("Found SuperGrok indicator in initial page body");
      }

      // ── 8. Kết quả cuối ──────────────────────────────────────────────────────
      const finalResponseTime = elapsed();

      if (isSuper) {
        return {
          code: "ACTIVE",
          message: `Đăng nhập OK — Gói ${subscriptionPlan || "SuperGrok"} còn hiệu lực`,
          responseTime: finalResponseTime,
          playwrightLog: logs.join("\n"),
        };
      }

      // Đã đăng nhập thành công vào grok.com nhưng không phát hiện SuperGrok
      return {
        code: "PACKAGE_LOST",
        message: "Đăng nhập OK nhưng không phát hiện gói SuperGrok (có thể đã hết hạn hoặc chưa đăng ký)",
        responseTime: finalResponseTime,
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
      if (
        /Executable doesn't exist|browserType\.launch|Cannot find browser|browser.*not.*found|Failed to launch|spawn.*ENOENT/i.test(
          msg,
        )
      ) {
        return {
          code: "NETWORK_ERROR",
          message:
            "Chromium chưa cài / không tìm thấy binary. VPS: cd artifacts/api-server && npx playwright install chromium --with-deps",
          responseTime,
          playwrightLog: logs.join("\n"),
        };
      }
      if (/net::|ERR_/i.test(msg)) {
        return {
          code: "NETWORK_ERROR",
          message: `Lỗi kết nối: ${msg.slice(0, 150)}`,
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
