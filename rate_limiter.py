"""
rate_limiter.py — Anti-spam rate limiter for Telegram bot actions.

Rules per action:
  gift / check_join:
    - Max 3 requests per 30s  → escalating cooldown on violation
    - Max 10 requests per 10min → stricter check
    - Escalating cooldowns (based on cumulative violation count):
        violations 1-2  → 30s cooldown
        violations 3-5  → 10 min cooldown
        violations 6+   → 24h LOCK (gift feature only)
    - After lock expires: violation count resets automatically

  lookup (tra cứu đơn):
    - Max 5 requests per 60s   → 30s cooldown
    - Max 20 requests per 10min → 5min cooldown
    - No permanent lock

  support (create warranty/report ticket):
    - Max 3 requests per 60s   → 60s cooldown
    - Max 10 requests per 10min → 5min cooldown
    - No permanent lock
"""

import os
import json
import time
import threading
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
RATE_LIMITS_FILE     = os.path.join(DATA_DIR, "rate_limits.json")
RATE_VIOLATIONS_FILE = os.path.join(DATA_DIR, "rate_violations.json")

_lock = threading.Lock()

# ── Configuration ──────────────────────────────────────────────────────────────

RULES: dict = {
    "gift": {
        "windows": [
            {"max": 3,  "seconds": 30},    # short burst
            {"max": 10, "seconds": 600},   # 10-minute window
        ],
        "escalation": [
            {"max_violations": 2,   "cooldown": 30},
            {"max_violations": 5,   "cooldown": 600},
            {"max_violations": 9999, "cooldown": 86400, "lock": True},
        ],
        "allow_lock": True,   # can escalate to 24h feature lock
    },
    "check_join": {
        "windows": [
            {"max": 3,  "seconds": 30},
            {"max": 10, "seconds": 600},
        ],
        "escalation": [
            {"max_violations": 2,   "cooldown": 30},
            {"max_violations": 5,   "cooldown": 600},
            {"max_violations": 9999, "cooldown": 86400, "lock": True},
        ],
        "allow_lock": True,
    },
    "lookup": {
        "windows": [
            {"max": 5,  "seconds": 60},
            {"max": 20, "seconds": 600},
        ],
        "escalation": [
            {"max_violations": 3,   "cooldown": 30},
            {"max_violations": 9999, "cooldown": 300},
        ],
        "allow_lock": False,
    },
    "support": {
        "windows": [
            {"max": 3,  "seconds": 60},
            {"max": 10, "seconds": 600},
        ],
        "escalation": [
            {"max_violations": 3,   "cooldown": 60},
            {"max_violations": 9999, "cooldown": 300},
        ],
        "allow_lock": False,
    },
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def _load(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default if not callable(default) else default()


def _save(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _fmt_wait_vi(seconds: int) -> str:
    if seconds >= 3600:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        return f"{h} giờ {m} phút" if m else f"{h} giờ"
    if seconds >= 60:
        m = seconds // 60
        s = seconds % 60
        return f"{m} phút {s} giây" if s else f"{m} phút"
    return f"{seconds} giây"


def _fmt_wait_en(seconds: int) -> str:
    if seconds >= 3600:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        return f"{h}h {m}m" if m else f"{h}h"
    if seconds >= 60:
        m = seconds // 60
        s = seconds % 60
        return f"{m}m {s}s" if s else f"{m}m"
    return f"{seconds}s"

# ── Public API ─────────────────────────────────────────────────────────────────

class RateLimitResult:
    __slots__ = ("allowed", "wait_seconds", "message_vi", "message_en", "is_locked")

    def __init__(self, allowed: bool, wait_seconds: int,
                 message_vi: str, message_en: str, is_locked: bool = False):
        self.allowed       = allowed
        self.wait_seconds  = wait_seconds
        self.message_vi    = message_vi
        self.message_en    = message_en
        self.is_locked     = is_locked

    def message(self, lang: str) -> str:
        return self.message_vi if lang == "vi" else self.message_en


def check_and_record(user_id: int, action: str, username: str = "") -> RateLimitResult:
    """
    Atomically checks the rate limit and records the request if allowed.
    Thread-safe. Returns RateLimitResult (allowed=True means proceed normally).
    """
    rule = RULES.get(action)
    if not rule:
        # Unknown action → always allow
        return RateLimitResult(True, 0, "", "", False)

    with _lock:
        data = _load(RATE_LIMITS_FILE, {})
        uid  = str(user_id)
        now  = time.time()

        user_data = data.setdefault(uid, {})
        state = user_data.setdefault(action, {
            "timestamps":       [],
            "violation_count":  0,
            "cooldown_until":   None,
            "lock_until":       None,
            "last_violation_at": None,
        })

        # ── 1. Check active 24h lock ──────────────────────────────────────────
        lock_until = state.get("lock_until")
        if lock_until and now < lock_until:
            wait = int(lock_until - now) + 1
            time_str_vi = _fmt_wait_vi(wait)
            time_str_en = _fmt_wait_en(wait)
            msg_vi = f"🔒 Chức năng Nhận Quà bị tạm khóa {time_str_vi} do spam. Vui lòng thử lại sau."
            msg_en = f"🔒 Gift feature is locked for {time_str_en} due to spam. Please try again later."
            return RateLimitResult(False, wait, msg_vi, msg_en, True)

        # Expired lock → reset violation count so user gets a fresh start
        if lock_until and now >= lock_until:
            state["lock_until"]       = None
            state["violation_count"]  = 0
            state["cooldown_until"]   = None

        # ── 2. Check active cooldown ──────────────────────────────────────────
        cooldown_until = state.get("cooldown_until")
        if cooldown_until and now < cooldown_until:
            wait = int(cooldown_until - now) + 1
            msg_vi = f"⏱️ Bạn thao tác quá nhanh. Vui lòng thử lại sau {_fmt_wait_vi(wait)}."
            msg_en = f"⏱️ You're acting too fast. Please try again in {_fmt_wait_en(wait)}."
            return RateLimitResult(False, wait, msg_vi, msg_en, False)

        # Expired cooldown → clear it (violation_count is NOT reset here, only after lock)
        if cooldown_until and now >= cooldown_until:
            state["cooldown_until"] = None

        # ── 3. Prune stale timestamps ─────────────────────────────────────────
        max_window = max(w["seconds"] for w in rule["windows"])
        timestamps: list = [t for t in state.get("timestamps", []) if now - t < max_window]

        # ── 4. Check windows ─────────────────────────────────────────────────
        violated = False
        for w in rule["windows"]:
            count = sum(1 for t in timestamps if now - t < w["seconds"])
            if count >= w["max"]:
                violated = True
                break

        if not violated:
            # ✅ Allowed — record the timestamp and save
            timestamps.append(now)
            state["timestamps"] = timestamps
            data[uid][action]   = state
            _save(RATE_LIMITS_FILE, data)
            return RateLimitResult(True, 0, "", "", False)

        # ── 5. Rate limit hit — compute escalating cooldown ───────────────────
        violation_count = state.get("violation_count", 0) + 1
        state["violation_count"]    = violation_count
        state["last_violation_at"]  = now
        state["timestamps"]         = timestamps  # don't record blocked request

        cooldown_seconds = 30
        is_lock_action   = False
        for esc in rule["escalation"]:
            if violation_count <= esc["max_violations"]:
                cooldown_seconds = esc["cooldown"]
                is_lock_action   = esc.get("lock", False)
                break

        cooldown_until_ts = now + cooldown_seconds
        apply_lock = is_lock_action and rule.get("allow_lock", False)

        if apply_lock:
            state["lock_until"]     = cooldown_until_ts
            state["cooldown_until"] = None
        else:
            state["cooldown_until"] = cooldown_until_ts

        data[uid][action] = state
        _save(RATE_LIMITS_FILE, data)

        # ── 6. Persist violation record ───────────────────────────────────────
        violations: list = _load(RATE_VIOLATIONS_FILE, [])
        violations.append({
            "id":               f"{uid}_{action}_{int(now)}",
            "user_id":          user_id,
            "username":         username or "",
            "action":           action,
            "timestamp":        _iso(now),
            "violation_count":  violation_count,
            "cooldown_seconds": cooldown_seconds,
            "cooldown_until":   _iso(cooldown_until_ts),
            "lock_until":       _iso(cooldown_until_ts) if apply_lock else None,
            "is_locked":        apply_lock,
        })
        # Keep the most recent 5 000 violations to avoid unbounded growth
        if len(violations) > 5000:
            violations = violations[-5000:]
        _save(RATE_VIOLATIONS_FILE, violations)

        # ── 7. Build and return blocked message ───────────────────────────────
        wait = cooldown_seconds
        if apply_lock:
            time_vi = _fmt_wait_vi(wait)
            time_en = _fmt_wait_en(wait)
            msg_vi  = f"🔒 Chức năng Nhận Quà bị tạm khóa {time_vi} do spam liên tục. Vui lòng thử lại sau."
            msg_en  = f"🔒 Gift feature locked for {time_en} due to repeated spam. Please try again later."
        else:
            msg_vi = f"⏱️ Bạn thao tác quá nhanh. Vui lòng thử lại sau {_fmt_wait_vi(wait)}."
            msg_en = f"⏱️ You're acting too fast. Please try again in {_fmt_wait_en(wait)}."

        return RateLimitResult(False, wait, msg_vi, msg_en, apply_lock)


def get_user_status(user_id: int) -> dict:
    """Return current rate-limit status for a user (all actions). Read-only."""
    with _lock:
        data  = _load(RATE_LIMITS_FILE, {})
        now   = time.time()
        uid   = str(user_id)
        result = {}
        for action, state in data.get(uid, {}).items():
            lock_until     = state.get("lock_until")
            cooldown_until = state.get("cooldown_until")
            result[action] = {
                "violation_count":   state.get("violation_count", 0),
                "is_locked":         bool(lock_until and now < lock_until),
                "lock_remaining_s":  max(0, int(lock_until - now)) if lock_until and now < lock_until else 0,
                "is_on_cooldown":    bool(cooldown_until and now < cooldown_until),
                "cooldown_remaining_s": max(0, int(cooldown_until - now)) if cooldown_until and now < cooldown_until else 0,
                "last_violation_at": state.get("last_violation_at"),
            }
        return result
