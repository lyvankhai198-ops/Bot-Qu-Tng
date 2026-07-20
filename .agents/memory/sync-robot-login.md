---
    name: Sync robot login & navigation fixes
    description: canboso.com Playwright robot — confirmed working auth + sidebar nav approach
    ---

    ## sec-ch-ua override
    Add `extra_http_headers` to browser context (both sync + test-login contexts):
    ```python
    extra_http_headers={
      "sec-ch-ua": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.8",
    }
    ```
    **Why:** Playwright Chromium 149 sends HeadlessChrome in sec-ch-ua; canboso.com server rejects headless.

    ## Session detection — goto root, not /login
    `loginAndWaitReady`: goto(`site_url`) (root), wait networkidle 8s, check URL:
    - URL NOT at /login → session valid → return
    - URL at /login → no session → fill form

    **Why:** goto(/login) triggers SPA client-router to immediately redirect to / (before auth API call),
    causing false-positive session detection.

    ## Post-submit wait — wait_for_url, not networkidle
    After clicking submit button, use `page.wait_for_url(lambda url: not /login in url, timeout=20s)`.
    Do NOT use `wait_for_load_state("networkidle")` — it fires ~23ms after click, before POST response.

    **Why:** networkidle fires too fast; URL still shows /login when checked even though server accepted login.

    ## Navigation to "Đơn hàng" — NO hamburger needed
    canboso.com uses `<aside class="app-sidebar">` that is ALWAYS VISIBLE at desktop (1280x800).
    Menu items are `<button class="sidebar-tab">` inside the aside.
    - "Đơn hàng" button is at position (20, 357), size 235x44
    - Hamburger at (20, 20) COLLAPSES the sidebar (hides text labels) — do NOT click it

    **Fix:** Skip hamburger. Check `aside.app-sidebar` is visible, then find button inside it:
    ```python
    aside.locator("button").filter(has_text=re.compile(r"Đơn hàng", re.IGNORECASE)).first
    ```

    ## Confirmed working result
    - 863 rows downloaded, import succeeds with 0 errors
    