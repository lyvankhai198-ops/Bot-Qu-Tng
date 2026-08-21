# AI Support Reliability Validation

Validation date: 2026-08-19 UTC

## Backup and deployment

- Pre-change VPS archive: `/root/Bot-Qu-Tng-backup-20260819T052058Z.tar.gz`
- Backup size at creation: approximately 839 MB.
- Deployed project: `/root/Bot-Qu-Tng`
- Service: `gift-bot.service`
- Restarted successfully at `2026-08-19 05:43:51 UTC`.
- Final state: `active (running)`, `NRestarts=0`, Python process listening on port 5000.
- The restore condition was not triggered because syntax, scenario, live-model, and service checks passed.

## Effective safeguards

### Per-user spam gate

- Rolling window: 60 seconds.
- Messages 1-3: allowed.
- Message 4: fixed warning response; message is blocked before storage, intent detection, budget checks, or AI.
- Message 5: fixed temporary-lock response; message is blocked before storage, intent detection, budget checks, or AI.
- Counters are independent by Telegram user ID. A second user remained allowed while the first user reached warning and lock.
- The same pre-processing gate applies to text and image traffic.

### Daily AI budget

- Token limit: 20,000 per user per UTC day.
- Request limit: 20 per user per UTC day.
- Usage remains in `data/ai_usage.json`, so limits survive process restarts.
- A request and a conservative maximum token cost are persisted immediately before an API call.
- Confirmed API usage replaces the conservative reservation without incrementing the request count twice.
- If API usage is uncertain after a timeout, the conservative reservation remains charged so the 20,000-token ceiling cannot be bypassed.
- Validation allowed requests 1-20, denied request 21, denied a reservation that would cross 20,000 tokens, and confirmed the persisted limit after replacing the in-memory lock.

## Input-size comparison

Method:

1. The before payload used the previously deployed 13,807-character configured prompt, up to 20 recent messages, and the previous full order/product-guide context.
2. The after payload used the 1,919-character compact prompt, the 649-character grounding/style guardrail, intent-specific backend/guide context, and either the latest message or at most four messages for a reference follow-up.
3. Both versions were measured against the same deployed order/product-guide dataset and synthetic 20-message history.
4. Approximate input tokens use the deployed logger's deterministic `ceil(characters / 4)` method. This is a comparison metric, not provider billing.

| Scenario | Before chars | After chars | Before approx. tokens | After approx. tokens | Reduction |
|---|---:|---:|---:|---:|---:|
| Simple | 15,720 | 2,592 | 3,930 | 648 | 83.5% |
| Activation | 16,147 | 2,780 | 4,037 | 695 | 82.8% |
| Product error | 16,146 | 3,146 | 4,037 | 787 | 80.5% |
| Warranty | 16,129 | 3,129 | 4,033 | 783 | 80.6% |
| Refund | 16,132 | 2,808 | 4,033 | 702 | 82.6% |
| Order | 16,129 | 2,755 | 4,033 | 689 | 82.9% |

Purchase-channel data is appended only for purchase intent. Image placeholders are excluded. An order ID is included only when it belongs to the current Telegram account; an unowned or unverifiable ID is reported as not found and no order/refund details are exposed.

## Scenario results

The deterministic validator completed with `PASS` against the deployed `bot.py` supplied as `--candidate`. The pre-change `bot.py` supplied as `--head` was loaded only to calculate the before/after input-size comparison.

| Scenario | Result |
|---|---|
| Simple/general intent | PASS - sends only the latest independent question |
| Order intent, including legacy `ORD...` IDs | PASS - sends minimal owned-order status fields |
| Repeated order reference | PASS - the most recently mentioned owned order remains active |
| Activation | PASS - sends activation guide only |
| Usage | PASS - sends usage guide only |
| Product error | PASS - sends error guide and required warranty facts only |
| Warranty | PASS - sends backend warranty facts and relevant request history only |
| Refund | PASS - sends backend refund/order facts only; no promise is invented |
| Purchase | PASS - preserves product reference and adds active shop-channel instructions only for this intent |
| Image placeholders | PASS - `[Anh]` and `[Ảnh]` are excluded from AI input |
| Spam isolation | PASS - user 1 warned on message 4 and locked on message 5; user 2 remained allowed |
| `WAITING_ADMIN` | PASS - customer messages are stored without intent, budget, or AI calls |
| Direct `ADMIN_ACCEPTED` | PASS - customer messages route to the responsible Admin without AI |
| Waiting-session transfer | PASS - transition, assignment, dequeue, persistence, and customer notification occur before later forwarding |
| Stale transfer accept | PASS - a stale accept action cannot route an `AI_ACTIVE` session and the expired pending transfer is cleared |
| Budget request cap | PASS - request 21 denied |
| Budget token cap | PASS - a reservation that would cross 20,000 denied before API |
| Budget restart persistence | PASS |
| Ambiguous API timeout | PASS - conservative reservation retained |

## Live-model style and grounding checks

Two low-token checks used the configured model and deployed prompt without customer data:

1. `Xin chào, shop hỗ trợ gì?`
   - One-line, 118-character reply.
   - Concisely described the supported categories and asked what help was needed.
2. `Đơn của tôi khi nào giao?`
   - One-line, 120-character reply.
   - Stated that delivery data was unavailable and requested the order ID.
   - Did not invent a delivery date, status, or service promise.

The deployed request settings are `temperature=0.3` and `max_tokens=500`. The prompt requires short natural replies, no more than two useful icons, and backend/product-guide data as the only source for operational claims.

## Final checks

- `python -m py_compile bot.py translations.py validate_ai_support_reliability.py`: PASS.
- Deterministic deployed scenario suite: PASS.
- Independent reliability/security review: PASS with no remaining critical or high task-relevant findings.
- Config update verification:
  - `daily_token_budget = 20000`
  - `daily_request_budget = 20`
  - configured prompt exactly matches the compact prompt in source
  - canonical hash of every non-targeted config field remained unchanged
- Service restart and port check: PASS.