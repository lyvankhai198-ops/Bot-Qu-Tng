/**
 * Grok AI checker — đăng nhập trực tiếp tại grok.com bằng email/mật khẩu
 *
 * Flow:
 *   1. Vào https://grok.com → click "Sign in"
 *   2. Chọn "Continue with email" (không dùng X OAuth)
 *   3. Nhập email → Next → nhập mật khẩu → Login
 *   4. Xử lý CAPTCHA (Cloudflare Turnstile) nếu xuất hiện — chờ auto-solve
 *   5. Sau khi đăng nhập thành công → reload grok.com
 *   6. Kiểm tra gói SuperGrok qua nhiều indicator
 *
 * Result codes:
 *   ACTIVE           — đăng nhập OK, gói SuperGrok còn hiệu lực
 *   PACKAGE_LOST     — đăng nhập OK nhưng không có / hết SuperGrok
 *   PASSWORD_INVALID — sai mật khẩu
 *   ACCOUNT_BANNED   — tài khoản bị suspended
 *   ACCOUNT_LOCKED   — tài khoản bị khóa tạm thời
 *   REQUIRE_2FA      — cần xác minh 2FA / email
 *   CAPTCHA          — bị CAPTCHA chặn không thể tự giải
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
    const timeoutMs = options.timeoutMs ?? 120_000;
    const start = Date.now();
    let browser: any = null;
    const logs: string[] = [];

    const elapsed = () => Date.now() - start;
    const log = (msg: string) => {
      logs.push(`[${elapsed()}ms] ${msg}`);
      console.log(`[grok-checker] ${msg}`);
    };

    const safeText = async (page: any, sel: string, t = 5_000) =>
      page.locator(sel).first().textContent({ timeout: t }).catch(() => "");

    const safeVisible = async (page: any, sel: string, t = 5_000) =>
      page.locator(sel).first().isVisible({ timeout: t }).catch(() => false);

    const bodyText = async (page: any) =>
      page.locator("body").innerText().catch(() => "");

    try {
      const { chromium } = await import("playwright");

      log("Launching Chromium (stealth mode)");
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900",
          "--disable-web-security",
          "--allow-running-insecure-content",
        ],
      });

      const ctx = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      // Stealth: ẩn webdriver fingerprint
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // @ts-ignore
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });
      });

      const page = await ctx.newPage();
      // Không set defaultTimeout quá thấp — các bước sẽ dùng timeout riêng
      page.setDefaultTimeout(timeoutMs);

      // ── 1. Vào grok.com ──────────────────────────────────────────────────────
      log("Navigating to https://grok.com");
      await page.goto("https://grok.com", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(3_000);

      let url = page.url();
      log(`After grok.com load — URL: ${url}`);

      // Nếu đã ở trang login (redirect tự động)
      const atLoginAlready =
        url.includes("grok.com/auth") ||
        url.includes("/login") ||
        url.includes("/signin");

      if (!atLoginAlready) {
        // Tìm nút Sign in / Log in trên trang chủ grok.com
        const signInSels = [
          'a[href*="sign-in"]',
          'a[href*="login"]',
          'a[href*="auth"]',
          'button:has-text("Sign in")',
          'button:has-text("Log in")',
          'a:has-text("Sign in")',
          'a:has-text("Log in")',
          '[data-testid*="login"]',
          '[data-testid*="signin"]',
        ];

        let clicked = false;
        for (const sel of signInSels) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            log(`Clicking sign-in via selector: ${sel}`);
            await btn.click();
            await page.waitForTimeout(3_000);
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // Thử navigate trực tiếp đến trang auth của grok.com
          log("Sign in button not found → navigating to /auth/login");
          await page.goto("https://grok.com/auth/login", {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
          await page.waitForTimeout(3_000);
        }
      }

      url = page.url();
      log(`After sign-in navigation — URL: ${url}`);

      // ── 2. Tìm và chọn "Continue with Email" (không dùng X OAuth) ────────────
      // grok.com thường hiển thị nhiều lựa chọn đăng nhập
      const emailLoginSels = [
        'button:has-text("Continue with email")',
        'button:has-text("Sign in with email")',
        'button:has-text("Email")',
        'a:has-text("Continue with email")',
        'a:has-text("Sign in with email")',
        '[data-provider="email"]',
        'button[type="button"]:has-text("email")',
      ];

      let emailLoginClicked = false;
      for (const sel of emailLoginSels) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 4_000 }).catch(() => false)) {
          log(`Clicking email login option: ${sel}`);
          await btn.click();
          await page.waitForTimeout(2_500);
          emailLoginClicked = true;
          break;
        }
      }

      if (!emailLoginClicked) {
        log("Email login button not found — may already be on email form");
      }

      url = page.url();
      log(`After email option — URL: ${url}`);

      // ── 3. Điền email ────────────────────────────────────────────────────────
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[autocomplete="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="Email" i]',
        'input[type="text"]',
      ];

      let emailInput: any = null;
      for (const sel of emailSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 5_000 }).catch(() => false)) {
          emailInput = el;
          log(`Found email input: ${sel}`);
          break;
        }
      }

      if (!emailInput) {
        // Screenshot để debug
        const bodySnip = (await bodyText(page)).slice(0, 500);
        log(`Email input not found. Body: ${bodySnip}`);
        return {
          code: "UNKNOWN",
          message: `Không tìm thấy ô nhập email trên grok.com — URL: ${url.split("?")[0]}`,
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      log("Filling email");
      await emailInput.click();
      await page.waitForTimeout(300);
      await emailInput.fill(email);
      await page.waitForTimeout(500);

      // Click Next / Continue
      const nextBtns = [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button[type="submit"]',
        'input[type="submit"]',
      ];

      let nextClicked = false;
      for (const sel of nextBtns) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          log(`Clicking Next: ${sel}`);
          await btn.click();
          nextClicked = true;
          break;
        }
      }
      if (!nextClicked) {
        log("Next button not found — pressing Enter");
        await emailInput.press("Enter");
      }

      await page.waitForTimeout(3_000);
      url = page.url();
      log(`After email submit — URL: ${url}`);

      // ── 4. Điền mật khẩu ────────────────────────────────────────────────────
      const pwSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[autocomplete="current-password"]',
      ];

      let pwInput: any = null;
      for (const sel of pwSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 10_000 }).catch(() => false)) {
          pwInput = el;
          log(`Found password input: ${sel}`);
          break;
        }
      }

      if (!pwInput) {
        const bt = (await bodyText(page)).slice(0, 600);
        log(`Password input not found. Body: ${bt}`);

        // Kiểm tra xem có thông báo lỗi không
        if (/invalid|not found|no account|doesn't exist/i.test(bt)) {
          return {
            code: "PASSWORD_INVALID",
            message: "Email không tồn tại hoặc không hợp lệ",
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

      log("Filling password");
      await pwInput.click();
      await page.waitForTimeout(300);
      await pwInput.fill(password);
      await page.waitForTimeout(500);

      // ── 5. Submit login ──────────────────────────────────────────────────────
      const loginBtns = [
        'button:has-text("Sign in")',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button[type="submit"]',
        'input[type="submit"]',
      ];

      let loginClicked = false;
      for (const sel of loginBtns) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          log(`Clicking login button: ${sel}`);
          await btn.click();
          loginClicked = true;
          break;
        }
      }
      if (!loginClicked) {
        log("Login button not found — pressing Enter");
        await pwInput.press("Enter");
      }

      log("Waiting for login result (up to 30s)...");
      await page.waitForTimeout(5_000);

      // ── 6. Xử lý CAPTCHA (Cloudflare Turnstile / hCaptcha) ──────────────────
      // Turnstile thường tự giải trong headless nếu browser đủ stealth
      // Chờ tối đa 30s để captcha tự solve
      const captchaIndicators = [
        'iframe[src*="challenges.cloudflare.com"]',
        'iframe[src*="turnstile"]',
        'iframe[src*="hcaptcha"]',
        '[class*="captcha"]',
        '[id*="captcha"]',
        'input[name="cf-turnstile-response"]',
      ];

      let hasCaptcha = false;
      for (const sel of captchaIndicators) {
        if (await safeVisible(page, sel, 3_000)) {
          hasCaptcha = true;
          log(`CAPTCHA detected: ${sel} — waiting for auto-solve (30s)...`);
          break;
        }
      }

      if (hasCaptcha) {
        // Chờ CAPTCHA tự giải và form submit
        let captchaResolved = false;
        for (let i = 0; i < 6; i++) {
          await page.waitForTimeout(5_000);
          url = page.url();
          // Nếu đã redirect sang trang khác → captcha đã giải
          if (!url.includes("/login") && !url.includes("/auth/login")) {
            captchaResolved = true;
            log(`CAPTCHA resolved — redirected to: ${url}`);
            break;
          }
          // Thử click nút submit nếu captcha đã tích xong
          const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Continue")').first();
          if (await submitBtn.isEnabled({ timeout: 1_000 }).catch(() => false)) {
            const isLoading = await submitBtn.getAttribute("data-loading").catch(() => null);
            if (!isLoading) {
              log(`Retrying submit after captcha (attempt ${i + 1})`);
              await submitBtn.click().catch(() => {});
              await page.waitForTimeout(3_000);
            }
          }
        }

        if (!captchaResolved) {
          url = page.url();
          if (url.includes("/login") || url.includes("/auth")) {
            return {
              code: "CAPTCHA",
              message: "Grok.com yêu cầu CAPTCHA và không thể tự giải trong headless mode",
              responseTime: elapsed(),
              playwrightLog: logs.join("\n"),
            };
          }
        }
      }

      // ── 7. Kiểm tra kết quả đăng nhập ───────────────────────────────────────
      url = page.url();
      log(`After login attempt — URL: ${url}`);

      // Chờ thêm để redirect hoàn tất
      if (url.includes("/login") || url.includes("/auth/login")) {
        try {
          await page.waitForURL((u: string) => !u.includes("/login") && !u.includes("/auth/login"), { timeout: 15_000 });
          url = page.url();
          log(`Redirected after login — URL: ${url}`);
        } catch {
          url = page.url();
          log(`Still on login page — URL: ${url}`);
        }
      }

      // Kiểm tra lỗi đăng nhập
      const bt = await bodyText(page);
      if (url.includes("/login") || url.includes("/auth/login")) {
        if (/invalid.*password|wrong.*password|incorrect.*password|password.*incorrect/i.test(bt) ||
            /invalid.*email|wrong.*email|email.*not.*found/i.test(bt)) {
          return {
            code: "PASSWORD_INVALID",
            message: "Sai email hoặc mật khẩu",
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }
        if (/verify.*email|confirm.*email|check.*email/i.test(bt)) {
          return {
            code: "REQUIRE_2FA",
            message: "Cần xác minh email",
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }
        if (/two.factor|2fa|authenticator|verification code/i.test(bt)) {
          return {
            code: "REQUIRE_2FA",
            message: "Cần xác minh 2FA",
            responseTime: elapsed(),
            playwrightLog: logs.join("\n"),
          };
        }
        return {
          code: "UNKNOWN",
          message: `Đăng nhập không thành công — vẫn ở trang login: ${url.split("?")[0]}`,
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      // ── 8. Đã vào grok.com — reload và kiểm tra SuperGrok ───────────────────
      log("Login successful — reloading grok.com to check subscription");
      await page.goto("https://grok.com", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForTimeout(4_000);

      url = page.url();
      log(`After reload — URL: ${url}`);

      // Kiểm tra có bị đá ra login không
      if (url.includes("/login") || url.includes("/auth/login")) {
        return {
          code: "UNKNOWN",
          message: "Đăng nhập bị reset sau reload — session không giữ được",
          responseTime: elapsed(),
          playwrightLog: logs.join("\n"),
        };
      }

      // ── 9. Phát hiện SuperGrok subscription ─────────────────────────────────
      let isSuper = false;
      let subscriptionPlan = "";

      // a) Body text của trang chính
      const pageBody = await bodyText(page);
      log(`Body snippet (500): ${pageBody.slice(0, 500)}`);

      if (/supergrok|super\s*grok|grok\s*super|SuperGrok/i.test(pageBody)) {
        isSuper = true;
        subscriptionPlan = "SuperGrok";
        log("Found SuperGrok in page body");
      }

      // b) API session check
      if (!isSuper) {
        try {
          const sessionData: any = await page.evaluate(async () => {
            const r = await fetch("/api/auth/session", { credentials: "include" }).catch(() => null);
            return r ? r.json().catch(() => null) : null;
          });
          if (sessionData) {
            const sessionStr = JSON.stringify(sessionData);
            log(`Session API: ${sessionStr.slice(0, 400)}`);
            if (/super|pro|premium|subscription|active/i.test(sessionStr)) {
              isSuper = true;
              const m = sessionStr.match(/(SuperGrok|super_grok|grok_pro|grokPro|premium)/i);
              if (m) subscriptionPlan = m[0];
              log(`Found subscription in session: ${subscriptionPlan}`);
            }
          }
        } catch (err: any) {
          log(`Session API error: ${err?.message?.slice(0, 80)}`);
        }
      }

      // c) Trang /settings
      if (!isSuper) {
        try {
          log("Checking /settings for subscription info");
          await page.goto("https://grok.com/settings", {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });
          await page.waitForTimeout(3_000);

          const settingsText = await bodyText(page);
          log(`Settings body (800): ${settingsText.slice(0, 800)}`);

          const planMatch = settingsText.match(
            /(SuperGrok|Super\s*Grok|Grok\s*Super|annual|monthly|subscriber|Premium|Pro Plan)/i,
          );
          if (planMatch) {
            subscriptionPlan = planMatch[0];
            isSuper = true;
            log(`Found subscription in settings: ${subscriptionPlan}`);
          }

          // Kiểm tra badge/class
          const badges = await page
            .locator('[class*="badge"], [class*="plan"], [class*="tier"], [class*="subscription"], [class*="premium"]')
            .allTextContents()
            .catch(() => [] as string[]);
          if (badges.some((b: string) => /super|pro|premium/i.test(b))) {
            isSuper = true;
            subscriptionPlan = badges.find((b: string) => /super|pro|premium/i.test(b)) ?? "SuperGrok";
            log(`Found subscription badge: ${subscriptionPlan}`);
          }
        } catch (err: any) {
          log(`Settings error: ${err?.message?.slice(0, 80)}`);
        }
      }

      // d) Quay về trang chính — kiểm tra sidebar / profile menu
      if (!isSuper) {
        try {
          await page.goto("https://grok.com", {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });
          await page.waitForTimeout(3_000);

          const planSels = [
            '[class*="SuperGrok"], [class*="supergrok"]',
            'span:has-text("SuperGrok"), div:has-text("SuperGrok")',
            '[data-testid*="plan"], [data-testid*="subscription"]',
            'nav span, aside span',
          ];
          for (const sel of planSels) {
            const texts = await page.locator(sel).allTextContents().catch(() => [] as string[]);
            const hit = texts.find((t: string) => /super|pro/i.test(t));
            if (hit) {
              isSuper = true;
              subscriptionPlan = hit.trim();
              log(`Found via selector "${sel}": ${subscriptionPlan}`);
              break;
            }
          }

          // Profile menu
          const profileBtn = page.locator(
            '[data-testid="user-menu"], [aria-label*="menu" i], ' +
            'button[aria-label*="profile" i], [data-testid*="avatar"]',
          ).first();
          if (!isSuper && await profileBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await profileBtn.click().catch(() => {});
            await page.waitForTimeout(1_500);
            const menuText = await bodyText(page);
            if (/SuperGrok|super\s*grok|super\s*plan/i.test(menuText)) {
              isSuper = true;
              const m = menuText.match(/SuperGrok|super\s*grok|super\s*plan/i);
              subscriptionPlan = m?.[0] ?? "SuperGrok";
              log(`Found SuperGrok in profile menu: ${subscriptionPlan}`);
            }
          }
        } catch (err: any) {
          log(`Home page check error: ${err?.message?.slice(0, 80)}`);
        }
      }

      // ── 10. Kết quả ──────────────────────────────────────────────────────────
      const finalTime = elapsed();
      if (isSuper) {
        return {
          code: "ACTIVE",
          message: `Đăng nhập OK — Gói ${subscriptionPlan || "SuperGrok"} còn hiệu lực`,
          responseTime: finalTime,
          playwrightLog: logs.join("\n"),
        };
      }

      return {
        code: "PACKAGE_LOST",
        message: "Đăng nhập OK nhưng không phát hiện gói SuperGrok (hết hạn hoặc chưa đăng ký)",
        responseTime: finalTime,
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
      if (/Executable doesn't exist|browserType\.launch|Cannot find browser|browser.*not.*found|Failed to launch|spawn.*ENOENT|Cannot find package.*playwright/i.test(msg)) {
        return {
          code: "NETWORK_ERROR",
          message: "Chromium / playwright chưa cài. Chạy: npx playwright install chromium --with-deps",
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
