/**
 * Grok AI checker — đăng nhập trực tiếp tại grok.com bằng email/mật khẩu
 *
 * Flow:
 *   1. Vào https://grok.com → click "Sign in"
 *   2. Chọn "Continue with email" (không dùng X OAuth)
 *   3. Nhập email → Next → nhập mật khẩu → submit
 *   4. Xử lý Cloudflare Managed Challenge nếu xuất hiện
 *   5. Sau login thành công → reload grok.com kiểm tra SuperGrok
 *
 * Result codes:
 *   ACTIVE           — đăng nhập OK, gói SuperGrok còn hiệu lực
 *   PACKAGE_LOST     — đăng nhập OK nhưng không có / hết SuperGrok
 *   PASSWORD_INVALID — sai mật khẩu
 *   REQUIRE_2FA      — cần xác minh 2FA / email
 *   CAPTCHA          — Cloudflare block không thể bypass
 *   NETWORK_ERROR    — lỗi kết nối / Chromium chưa cài
 *   TIMEOUT          — hết thời gian
 *   UNKNOWN          — không xác định được
 */

import type { CheckerPlugin, CheckResult, CheckOptions } from "./index.js";

// ── Cookie-based fast path (bypasses Cloudflare completely) ──────────────────
/**
 * Kiểm tra bằng session cookie lấy từ trình duyệt thật.
 * Không cần Playwright, không bị Cloudflare block.
 * User đăng nhập grok.com thủ công → F12 → Application → Cookies →
 * copy toàn bộ giá trị "__Secure-next-auth.session-token" (hoặc cả Cookie header).
 */
async function checkWithCookie(cookie: string, email: string): Promise<CheckResult> {
  const start = Date.now();
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(`[${Date.now() - start}ms] ${msg}`); console.log(`[grok-cookie] ${msg}`); };

  // Nếu user chỉ dán token (không có tên cookie), tự thêm tên
  const cookieHeader = cookie.includes("=")
    ? cookie
    : `__Secure-next-auth.session-token=${cookie}`;

  const HEADERS: Record<string, string> = {
    Cookie: cookieHeader,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://grok.com/",
  };

  try {
    // ── 1. /api/auth/session — kiểm tra đăng nhập ─────────────────────────
    log("GET /api/auth/session");
    const r1 = await fetch("https://grok.com/api/auth/session", {
      headers: HEADERS,
      redirect: "follow",
    });
    log(`Status: ${r1.status}`);

    if (r1.status === 401 || r1.status === 403) {
      return {
        code: "PASSWORD_INVALID",
        message: "Session cookie hết hạn hoặc không hợp lệ — cần lấy cookie mới từ trình duyệt",
        responseTime: Date.now() - start,
        playwrightLog: logs.join("\n"),
      };
    }

    const text1 = await r1.text();
    log(`Session body: ${text1.slice(0, 600)}`);

    if (!text1 || text1.trim() === "{}" || text1.trim() === "null" || text1.trim() === "") {
      return {
        code: "PASSWORD_INVALID",
        message: "Session cookie không hợp lệ hoặc hết hạn (response rỗng) — cần cập nhật cookie mới",
        responseTime: Date.now() - start,
        playwrightLog: logs.join("\n"),
      };
    }

    let sess: any = null;
    try { sess = JSON.parse(text1); } catch {}

    const loggedIn = !!(sess?.user || sess?.email || sess?.id || sess?.sub);
    if (!loggedIn) {
      return {
        code: "PASSWORD_INVALID",
        message: "Session cookie không hợp lệ — cần đăng nhập lại và lấy cookie mới",
        responseTime: Date.now() - start,
        playwrightLog: logs.join("\n"),
      };
    }

    log(`Logged in: ${sess?.user?.email ?? sess?.email ?? "ok"}`);

    // ── 2. Kiểm tra subscription trong session response ────────────────────
    const sessStr = JSON.stringify(sess);
    const superMatch = sessStr.match(/(SuperGrok|super_grok|grok_plus|grokPlus|superGrok)/i);
    if (superMatch) {
      return {
        code: "ACTIVE",
        message: `Cookie hợp lệ — Gói ${superMatch[0]} đang hoạt động`,
        responseTime: Date.now() - start,
        playwrightLog: logs.join("\n"),
      };
    }

    // ── 3. Thử các endpoint subscription ────────────────────────────────────
    for (const path of ["/api/user/subscription", "/api/subscription", "/api/user", "/api/me"]) {
      try {
        log(`GET ${path}`);
        const r = await fetch(`https://grok.com${path}`, { headers: HEADERS });
        if (r.status === 200) {
          const t = await r.text();
          log(`${path}: ${t.slice(0, 400)}`);
          if (/super|SuperGrok|grok_plus|premium/i.test(t)) {
            return {
              code: "ACTIVE",
              message: "Cookie hợp lệ — Tài khoản có gói SuperGrok",
              responseTime: Date.now() - start,
              playwrightLog: logs.join("\n"),
            };
          }
        }
      } catch {}
    }

    // ── 4. Fetch trang chủ grok.com (HTML) — kiểm tra __NEXT_DATA__ ─────────
    try {
      log("GET grok.com HTML");
      const r3 = await fetch("https://grok.com", {
        headers: { ...HEADERS, Accept: "text/html,*/*" },
        redirect: "follow",
      });
      const html = await r3.text();
      log(`HTML (800): ${html.slice(0, 800)}`);

      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        const nd = nextDataMatch[1];
        log(`__NEXT_DATA__ (600): ${nd.slice(0, 600)}`);
        if (/super|SuperGrok|grok_plus|subscription/i.test(nd)) {
          return {
            code: "ACTIVE",
            message: "Cookie hợp lệ — Gói SuperGrok (từ app state)",
            responseTime: Date.now() - start,
            playwrightLog: logs.join("\n"),
          };
        }
      }

      if (/SuperGrok|super_grok/i.test(html)) {
        return {
          code: "ACTIVE",
          message: "Cookie hợp lệ — Phát hiện gói SuperGrok trên homepage",
          responseTime: Date.now() - start,
          playwrightLog: logs.join("\n"),
        };
      }
    } catch (err: any) { log(`HTML fetch: ${err.message}`); }

    // Đăng nhập OK nhưng không thấy SuperGrok
    return {
      code: "PACKAGE_LOST",
      message: "Cookie hợp lệ (đã đăng nhập) nhưng không phát hiện gói SuperGrok",
      responseTime: Date.now() - start,
      playwrightLog: logs.join("\n"),
    };

  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (/net::|ERR_|ECONNREFUSED/i.test(msg)) {
      return { code: "NETWORK_ERROR", message: `Lỗi mạng: ${msg.slice(0, 150)}`, responseTime: Date.now() - start, playwrightLog: logs.join("\n") };
    }
    return { code: "UNKNOWN", message: `Cookie check error: ${msg.slice(0, 200)}`, responseTime: Date.now() - start, playwrightLog: logs.join("\n") };
  }
}

/** Script chèn vào mọi trang để qua bot-detection */
// IMPORTANT: This script runs as plain JavaScript inside the browser.
// Do NOT use TypeScript syntax (as, : type, !, etc.) — it will throw SyntaxError.
const STEALTH_SCRIPT = `
  (function() {
    // 1. Xoá webdriver flag
    try {
      Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; } });
      delete navigator.__proto__.webdriver;
    } catch(e) {}

    // 2. Chrome runtime giả
    try {
      window.chrome = {
        app: { isInstalled: false },
        csi: function(){},
        loadTimes: function(){},
        runtime: {},
      };
    } catch(e) {}

    // 3. Permissions API
    try {
      var origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = function(parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return origQuery(parameters);
      };
    } catch(e) {}

    // 4. Plugins giả
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          var arr = [
            { name:'Chrome PDF Plugin',    filename:'internal-pdf-viewer',  description:'Portable Document Format', length:1 },
            { name:'Chrome PDF Viewer',    filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', description:'', length:1 },
            { name:'Native Client',        filename:'internal-nacl-plugin',  description:'', length:2 },
          ];
          arr.item = function(i) { return arr[i]; };
          arr.namedItem = function(n) { return arr.find(function(p) { return p.name === n; }) || null; };
          arr.refresh = function() {};
          Object.setPrototypeOf(arr, PluginArray.prototype);
          return arr;
        },
      });
    } catch(e) {}

    // 5. Languages
    try {
      Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US','en']; } });
    } catch(e) {}

    // 6. outerWidth / outerHeight
    try {
      Object.defineProperty(window, 'outerWidth',  { get: function() { return window.innerWidth  + 16; } });
      Object.defineProperty(window, 'outerHeight', { get: function() { return window.innerHeight + 88; } });
    } catch(e) {}

    // 7. Xoá biến Playwright/CDP
    var toDelete = [
      '__playwright','__pw_manual','__webdriver_evaluate','__selenium_evaluate',
      '__fxdriver_evaluate','__driver_evaluate','__webdriver_script_func',
      '__webdriver_script_fn','__webdriver_script_function',
      '__selenium_unwrapped','__webdriverFunc',
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise','cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    ];
    for (var i = 0; i < toDelete.length; i++) {
      try { delete window[toDelete[i]]; } catch(e) {}
    }

    // 8. Iframe contentWindow
    try {
      var desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      var origGet = desc && desc.get;
      if (origGet) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            var w = origGet.call(this);
            if (!w) return w;
            try { Object.defineProperty(w.navigator, 'webdriver', { get: function() { return undefined; } }); } catch(e) {}
            return w;
          }
        });
      }
    } catch(e) {}
  })();
`;

const grokPlugin: CheckerPlugin = {
  id: "grok",
  name: "Grok AI (SuperGrok — grok.com)",

  async check(
    email: string,
    password: string,
    options: CheckOptions = {},
  ): Promise<CheckResult> {
    // ── Fast path: cookie-based check — không cần Playwright, bypass Cloudflare
    if (options.sessionCookie) {
      return checkWithCookie(options.sessionCookie, email);
    }

    const timeoutMs = options.timeoutMs ?? 120_000;
    const start = Date.now();
    let browser: any = null;
    const logs: string[] = [];

    const elapsed = () => Date.now() - start;
    const log = (msg: string) => {
      logs.push(`[${elapsed()}ms] ${msg}`);
      console.log(`[grok] ${msg}`);
    };

    const bodyText = async (page: any): Promise<string> =>
      page.locator("body").innerText().catch(() => "");

    const isVisible = async (page: any, sel: string, t = 5_000): Promise<boolean> =>
      page.locator(sel).first().isVisible({ timeout: t }).catch(() => false);

    /** Đợi Cloudflare challenge tự giải — trả về true nếu qua được */
    const waitCloudflare = async (page: any, maxMs: number): Promise<boolean> => {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        const bt = await bodyText(page);
        const url = page.url() as string;
        // Trang CF challenge
        if (/Performing security verification|Just a moment|checking your browser|security service.*malicious bot/i.test(bt)) {
          log(`Cloudflare challenge active — waiting (${Math.round((deadline - Date.now()) / 1000)}s left)`);
          await page.waitForTimeout(4_000);
          // Thỉnh thoảng CF cần reload
          if (Date.now() + 4_000 < deadline) {
            const stillCf = await bodyText(page);
            if (/Performing security verification|Just a moment/i.test(stillCf)) {
              // Thử reload trang một lần
              if ((deadline - Date.now()) > 20_000) {
                log("CF still active after 4s — reloading page");
                await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
                await page.waitForTimeout(5_000);
              }
            }
          }
          continue;
        }
        // Đã qua challenge
        return true;
      }
      // Hết giờ — kiểm tra lần cuối
      const bt = await bodyText(page);
      return !/Performing security verification|Just a moment|checking your browser/i.test(bt);
    };

    try {
      const { chromium } = await import("playwright");

      log("Launching Chromium");
      const launchProxy = options?.proxy?.server
        ? { server: options.proxy.server, username: options.proxy.username, password: options.proxy.password }
        : undefined;
      if (launchProxy) log(`Using proxy: ${launchProxy.server}`);
      browser = await chromium.launch({
        headless: true,
        proxy: launchProxy,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--disable-extensions",
          "--no-first-run",
          "--ignore-certificate-errors",
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
          "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        },
      });

      await ctx.addInitScript(STEALTH_SCRIPT);

      const page = await ctx.newPage();
      page.setDefaultTimeout(timeoutMs);

      // ── Capture browser console errors ───────────────────────────────────────
      const consoleErrors: string[] = [];
      page.on("console", msg => {
        if (msg.type() === "error") {
          const err = `[console.error] ${msg.text()}`;
          consoleErrors.push(err);
          log(err.slice(0, 200));
        }
      });
      page.on("pageerror", err => {
        const e = `[pageerror] ${err.message}`;
        consoleErrors.push(e);
        log(e.slice(0, 200));
      });

      // ── Helper: lấy raw HTML để debug ────────────────────────────────────────
      const rawHtml = async (chars = 1500): Promise<string> => {
        try {
          const html = await page.evaluate(() => document.documentElement.outerHTML);
          return (html ?? "").slice(0, chars);
        } catch (e: any) { return `(html error: ${e?.message})`; }
      };

      // ── Helper: navigate với retry networkidle ───────────────────────────────
      const gotoWithRetry = async (target: string, label: string) => {
        log(`goto ${label}: ${target}`);
        try {
          await page.goto(target, { waitUntil: "networkidle", timeout: 30_000 });
        } catch {
          log(`networkidle timeout for ${label}, continuing`);
          // Đợi ít nhất load event xong
          await page.waitForLoadState("load").catch(() => {});
        }
        await page.waitForTimeout(2_000);
      };

      // ── Helper: chụp screenshot base64 ───────────────────────────────────────
      const screenshot64 = async (): Promise<string | undefined> => {
        try {
          const buf = await page.screenshot({ type: "jpeg", quality: 60, timeout: 5_000 });
          return buf.toString("base64");
        } catch { return undefined; }
      };

      // ── Helper: CF check ─────────────────────────────────────────────────────
      const checkAndHandleCF = async (waitMs = 50_000): Promise<boolean> => {
        const bt = await bodyText(page);
        if (/Performing security verification|Just a moment|checking your browser|security service.*malicious bot/i.test(bt)) {
          log("Cloudflare challenge detected — waiting up to " + waitMs + "ms");
          return waitCloudflare(page, waitMs);
        }
        return true;
      };

      // ── 1. Vào grok.com root ──────────────────────────────────────────────────
      log("Opening https://grok.com");
      await gotoWithRetry("https://grok.com", "grok.com");
      let url = page.url() as string;
      log(`Loaded — URL: ${url}`);

      // Kiểm tra CF
      if (!await checkAndHandleCF(50_000)) {
        return { code: "CAPTCHA", message: "Cloudflare block tại grok.com root", responseTime: elapsed(), screenshotBase64: await screenshot64(), playwrightLog: logs.join("\n") };
      }

      // ── 2. Tìm OAuth URL qua NextAuth API (không cần click UI) ───────────────
      // NextAuth cung cấp endpoint /api/auth/signin/twitter để bắt đầu OAuth
      log("Getting Twitter OAuth URL via NextAuth API");
      const oauthUrl: string | null = await page.evaluate(async () => {
        try {
          // Lấy CSRF token từ NextAuth
          const csrfRes = await fetch("/api/auth/csrf");
          const csrfData = await csrfRes.json();
          const csrfToken = csrfData.csrfToken;
          // Gọi NextAuth signin endpoint → trả về redirect URL tới X.com OAuth
          const signinRes = await fetch("/api/auth/signin/twitter", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "csrfToken=" + encodeURIComponent(csrfToken) + "&callbackUrl=" + encodeURIComponent("https://grok.com/"),
            redirect: "manual",
          });
          // Nếu redirect → lấy Location header
          const loc = signinRes.headers.get("location") || signinRes.url;
          return loc || null;
        } catch (e) {
          return null;
        }
      }).catch(() => null);

      log(`OAuth URL from NextAuth: ${(oauthUrl || "null").slice(0, 200)}`);

      // ── 3. Navigate tới X.com OAuth ──────────────────────────────────────────
      let onXAuth = false;
      if (oauthUrl && (oauthUrl.includes("x.com") || oauthUrl.includes("twitter.com") || oauthUrl.includes("accounts.x.com"))) {
        log("Navigating to X.com OAuth page");
        await gotoWithRetry(oauthUrl, "x.com-oauth");
        url = page.url() as string;
        log(`X.com OAuth URL: ${url}`);
        onXAuth = true;
      } else {
        // Fallback: click Sign in button trực tiếp trên trang grok.com
        log("OAuth API failed, trying UI click approach");
        await page.waitForTimeout(2_000);

        // Thử tìm và click bằng JS eval (bypass visibility check)
        const clicked = await page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll("*"));
          const signIn = allEls.find(el => {
            const txt = (el.textContent || el.getAttribute("aria-label") || "").toLowerCase().trim();
            return (txt === "sign in" || txt === "login" || txt === "log in") && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button");
          });
          if (signIn) { (signIn as HTMLElement).click(); return true; }
          return false;
        }).catch(() => false);
        log(`UI click result: ${clicked}`);
        await page.waitForTimeout(3_000);
        url = page.url() as string;
        log(`After UI click — URL: ${url}`);

        if (url.includes("x.com") || url.includes("twitter.com")) {
          onXAuth = true;
        } else {
          // Thử navigate trực tiếp tới NextAuth twitter signin
          log("Trying direct /api/auth/signin/twitter navigation");
          try {
            await page.goto("https://grok.com/api/auth/signin/twitter", { waitUntil: "networkidle", timeout: 20_000 });
          } catch {}
          await page.waitForTimeout(2_000);
          url = page.url() as string;
          log(`After direct signin nav — URL: ${url}`);
          if (url.includes("x.com") || url.includes("twitter.com") || url.includes("accounts.x.com")) {
            onXAuth = true;
          }
        }
      }

      // ── 4. Xử lý CF nếu có ───────────────────────────────────────────────────
      if (!await checkAndHandleCF(40_000)) {
        return { code: "CAPTCHA", message: "Cloudflare block tại X.com OAuth", responseTime: elapsed(), screenshotBase64: await screenshot64(), playwrightLog: logs.join("\n") };
      }

      // ── 5. Log trạng thái trang + tìm email input ────────────────────────────
      url = page.url() as string;
      log(`Current URL: ${url}`);

      const allInputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input")).map(el => ({
          type: el.type, name: el.name, placeholder: el.placeholder, visible: el.offsetParent !== null,
        }));
      }).catch(() => [] as any[]);
      log(`All inputs on page: ${JSON.stringify(allInputs)}`);

      const anyText = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, a, h1, h2, label, p"));
        return els.slice(0, 20).map(el => ({
          tag: el.tagName,
          text: (el.textContent || "").trim().slice(0, 60),
          visible: (el as HTMLElement).offsetParent !== null,
        })).filter(e => e.text);
      }).catch(() => [] as any[]);
      log(`Page text elements: ${JSON.stringify(anyText.slice(0, 12))}`);

      // ── 6. Điền email (trên X.com hoặc grok.com) ────────────────────────────
      const emailInputSels = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="text"]',           // X.com dùng name="text" cho username/email
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="phone" i]',
        'input[type="text"]',
      ];

      let emailInput: any = null;
      for (const sel of emailInputSels) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 5_000 }).catch(() => false)) {
          emailInput = el;
          log(`Email input found: ${sel}`);
          break;
        }
      }

      if (!emailInput) {
        const bt = (await bodyText(page)).slice(0, 500);
        const domCount = await page.evaluate(() => document.querySelectorAll("*").length).catch(() => 0);
        log(`Email input not found — DOM: ${domCount} el, onXAuth: ${onXAuth}`);
        log(`Body text: ${bt || "(empty)"}`);
        if (consoleErrors.length) log(`Console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
        const shot = await screenshot64();
        if (/Performing security verification|Just a moment|security service/i.test(bt)) {
          return { code: "CAPTCHA", message: "Cloudflare block — không vào được form đăng nhập", responseTime: elapsed(), screenshotBase64: shot, playwrightLog: logs.join("\n") };
        }
        return {
          code: "UNKNOWN",
          message: `Không tìm thấy ô email — URL: ${url.split("?")[0]} | onXAuth: ${onXAuth} | ${bt.slice(0, 100)}`,
          responseTime: elapsed(),
          screenshotBase64: shot,
          playwrightLog: logs.join("\n"),
        };
      }

      log("Filling email");
      await emailInput.click();
      await page.waitForTimeout(400);
      await emailInput.fill(email);
      await page.waitForTimeout(500);

      // Next / Continue
      const nextSels = [
        'button:has-text("Next")', 'button:has-text("Continue")', 'button[type="submit"]',
      ];
      let nextClicked = false;
      for (const sel of nextSels) {
        if (await isVisible(page, sel, 3_000)) {
          log(`Next: ${sel}`);
          await page.locator(sel).first().click();
          nextClicked = true;
          break;
        }
      }
      if (!nextClicked) await emailInput.press("Enter");
      await page.waitForTimeout(3_000);

      url = page.url() as string;
      log(`After email submit — URL: ${url}`);

      // ── 6. Nhập mật khẩu ────────────────────────────────────────────────────
      let pwInput: any = null;
      for (const sel of ['input[type="password"]', 'input[name="password"]', 'input[autocomplete="current-password"]']) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 12_000 }).catch(() => false)) {
          pwInput = el;
          log(`Password input found: ${sel}`);
          break;
        }
      }

      if (!pwInput) {
        const bt = (await bodyText(page)).slice(0, 600);
        log(`Password not found — body: ${bt}`);
        if (/invalid|not found|no account|doesn't exist/i.test(bt)) {
          return { code: "PASSWORD_INVALID", message: "Email không tồn tại", responseTime: elapsed(), playwrightLog: logs.join("\n") };
        }
        return { code: "UNKNOWN", message: `Không tìm thấy ô mật khẩu — URL: ${url.split("?")[0]}`, responseTime: elapsed(), playwrightLog: logs.join("\n") };
      }

      log("Filling password");
      await pwInput.click();
      await page.waitForTimeout(300);
      await pwInput.fill(password);
      await page.waitForTimeout(500);

      // ── 7. Submit ────────────────────────────────────────────────────────────
      const loginSels = [
        'button:has-text("Sign in")', 'button:has-text("Log in")',
        'button:has-text("Login")',   'button[type="submit"]',
      ];
      let loginClicked = false;
      for (const sel of loginSels) {
        if (await isVisible(page, sel, 3_000)) {
          log(`Login button: ${sel}`);
          await page.locator(sel).first().click();
          loginClicked = true;
          break;
        }
      }
      if (!loginClicked) {
        log("Login button not found — pressing Enter");
        await pwInput.press("Enter");
      }

      log("Waiting for login result...");
      await page.waitForTimeout(5_000);

      // ── 8. Xử lý CAPTCHA / Turnstile sau submit ──────────────────────────────
      {
        const bt = await bodyText(page);
        if (/Performing security verification|Just a moment|security service/i.test(bt)) {
          log("CF challenge after submit — waiting 40s");
          const passed = await waitCloudflare(page, 40_000);
          if (!passed) {
            return { code: "CAPTCHA", message: "Cloudflare block ở bước submit login", responseTime: elapsed(), playwrightLog: logs.join("\n") };
          }
          url = page.url() as string;
          log(`After submit CF — URL: ${url}`);
        }

        // Turnstile trên form (iframe)
        const hasTurnstile =
          await isVisible(page, 'iframe[src*="challenges.cloudflare.com"]', 2_000) ||
          await isVisible(page, 'iframe[src*="turnstile"]', 2_000);
        if (hasTurnstile) {
          log("Turnstile CAPTCHA on form — waiting up to 30s for auto-solve");
          for (let i = 0; i < 6; i++) {
            await page.waitForTimeout(5_000);
            url = page.url() as string;
            if (!url.includes("/login") && !url.includes("/auth")) break;
            // Thử submit lại
            const btn = page.locator('button[type="submit"]:not([disabled])').first();
            if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
              log(`Retrying submit (${i + 1})`);
              await btn.click().catch(() => {});
            }
          }
        }
      }

      // Chờ redirect ra khỏi trang login
      url = page.url() as string;
      if (url.includes("/login") || url.includes("/auth/login")) {
        try {
          await page.waitForURL(
            (u: string) => !u.includes("/login") && !u.includes("/auth/login"),
            { timeout: 20_000 },
          );
          url = page.url() as string;
          log(`Redirected after login — URL: ${url}`);
        } catch {
          url = page.url() as string;
          log(`Still on login page — URL: ${url}`);
        }
      }

      // ── 9. Kiểm tra lỗi đăng nhập ───────────────────────────────────────────
      const afterBt = await bodyText(page);
      if (url.includes("/login") || url.includes("/auth/login")) {
        if (/invalid.*password|wrong.*password|incorrect.*password|password.*incorrect|incorrect.*email/i.test(afterBt)) {
          return { code: "PASSWORD_INVALID", message: "Sai email hoặc mật khẩu", responseTime: elapsed(), playwrightLog: logs.join("\n") };
        }
        if (/verify.*email|confirm.*email|check.*email/i.test(afterBt)) {
          return { code: "REQUIRE_2FA", message: "Cần xác minh email", responseTime: elapsed(), playwrightLog: logs.join("\n") };
        }
        if (/two.factor|2fa|authenticator/i.test(afterBt)) {
          return { code: "REQUIRE_2FA", message: "Cần xác minh 2FA", responseTime: elapsed(), playwrightLog: logs.join("\n") };
        }
        if (/Performing security verification|Just a moment/i.test(afterBt)) {
          return { code: "CAPTCHA", message: "Cloudflare block sau login", responseTime: elapsed(), playwrightLog: logs.join("\n") };
        }
        return { code: "UNKNOWN", message: `Login không thành công — URL: ${url.split("?")[0]}`, responseTime: elapsed(), playwrightLog: logs.join("\n") };
      }

      // ── 10. Reload grok.com và kiểm tra SuperGrok ────────────────────────────
      log("Login OK — reloading grok.com to check subscription");
      await page.goto("https://grok.com", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForTimeout(4_000);

      url = page.url() as string;
      log(`After reload — URL: ${url}`);

      if (url.includes("/login") || url.includes("/auth")) {
        return { code: "UNKNOWN", message: "Session bị reset sau reload", responseTime: elapsed(), playwrightLog: logs.join("\n") };
      }

      let isSuper = false;
      let subscriptionPlan = "";

      // a) Body text trang chủ
      const homeBody = await bodyText(page);
      log(`Home body (500): ${homeBody.slice(0, 500)}`);
      if (/supergrok|super\s*grok|grok\s*super|SuperGrok/i.test(homeBody)) {
        isSuper = true;
        subscriptionPlan = "SuperGrok";
        log("Found SuperGrok in home body");
      }

      // b) Session API
      if (!isSuper) {
        try {
          const sess: any = await page.evaluate(async () => {
            const r = await fetch("/api/auth/session", { credentials: "include" }).catch(() => null);
            return r ? r.json().catch(() => null) : null;
          });
          if (sess) {
            const s = JSON.stringify(sess);
            log(`Session: ${s.slice(0, 400)}`);
            if (/super|pro|premium|subscription/i.test(s)) {
              isSuper = true;
              const m = s.match(/(SuperGrok|super_grok|grok_pro|premium)/i);
              subscriptionPlan = m?.[0] ?? "SuperGrok";
              log(`Found in session: ${subscriptionPlan}`);
            }
          }
        } catch {}
      }

      // c) /settings
      if (!isSuper) {
        try {
          await page.goto("https://grok.com/settings", { waitUntil: "domcontentloaded", timeout: 15_000 });
          await page.waitForTimeout(3_000);
          const st = await bodyText(page);
          log(`Settings (800): ${st.slice(0, 800)}`);
          const m = st.match(/(SuperGrok|Super\s*Grok|annual|monthly|subscriber|Premium|Pro\s*Plan)/i);
          if (m) { isSuper = true; subscriptionPlan = m[0]; log(`Found in settings: ${subscriptionPlan}`); }
          const badges = await page.locator('[class*="badge"],[class*="plan"],[class*="tier"],[class*="subscription"],[class*="premium"]')
            .allTextContents().catch(() => [] as string[]);
          const hit = badges.find((b: string) => /super|pro|premium/i.test(b));
          if (hit) { isSuper = true; subscriptionPlan = hit; log(`Found badge: ${subscriptionPlan}`); }
        } catch (err: any) { log(`Settings err: ${err?.message?.slice(0, 60)}`); }
      }

      // d) Sidebar / profile menu trên trang chủ
      if (!isSuper) {
        try {
          await page.goto("https://grok.com", { waitUntil: "domcontentloaded", timeout: 15_000 });
          await page.waitForTimeout(3_000);
          for (const sel of [
            '[class*="SuperGrok"],[class*="supergrok"]',
            'span:has-text("SuperGrok"),div:has-text("SuperGrok")',
            '[data-testid*="plan"],[data-testid*="subscription"]',
          ]) {
            const txts = await page.locator(sel).allTextContents().catch(() => [] as string[]);
            const hit = txts.find((t: string) => /super|pro/i.test(t));
            if (hit) { isSuper = true; subscriptionPlan = hit.trim(); log(`Found via ${sel}: ${subscriptionPlan}`); break; }
          }
          // Profile menu
          const pBtn = page.locator('[data-testid="user-menu"],[aria-label*="menu" i],button[aria-label*="profile" i]').first();
          if (!isSuper && await pBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await pBtn.click().catch(() => {});
            await page.waitForTimeout(1_500);
            const mt = await bodyText(page);
            const m = mt.match(/SuperGrok|super\s*grok|super\s*plan/i);
            if (m) { isSuper = true; subscriptionPlan = m[0]; log(`Found in profile menu: ${subscriptionPlan}`); }
          }
        } catch (err: any) { log(`Home check err: ${err?.message?.slice(0, 60)}`); }
      }

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
      if (/timeout/i.test(msg)) return { code: "TIMEOUT", message: `Timeout sau ${timeoutMs}ms`, responseTime, playwrightLog: logs.join("\n") };
      if (/Executable doesn't exist|browserType\.launch|Cannot find browser|Failed to launch|spawn.*ENOENT|Cannot find package.*playwright/i.test(msg)) {
        return { code: "NETWORK_ERROR", message: "Chromium/playwright chưa cài. Chạy: npx playwright install chromium --with-deps", responseTime, playwrightLog: logs.join("\n") };
      }
      if (/net::|ERR_/i.test(msg)) return { code: "NETWORK_ERROR", message: `Lỗi kết nối: ${msg.slice(0, 150)}`, responseTime, playwrightLog: logs.join("\n") };
      return { code: "UNKNOWN", message: `Playwright error: ${msg.slice(0, 200)}`, responseTime, playwrightLog: logs.join("\n") };
    } finally {
      await browser?.close().catch(() => {});
    }
  },
};

export default grokPlugin;
