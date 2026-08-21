#!/usr/bin/env python3
"""Deterministic validation for the AI support reliability upgrade."""

from __future__ import annotations

import argparse
import asyncio
import copy
import importlib.util
import json
import sys
import types
from pathlib import Path


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class DummyMessage:
    def __init__(self, text: str = "", reply_to_message=None):
        self.text = text
        self.caption = ""
        self.photo = []
        self.reply_to_message = reply_to_message
        self.message_id = 700
        self.chat_id = 800
        self.replies: list[str] = []

    async def reply_text(self, text, **kwargs):
        self.replies.append(text)
        return types.SimpleNamespace(message_id=701)


class DummyBot:
    def __init__(self):
        self.sent: list[dict] = []
        self.next_id = 900

    async def send_message(self, **kwargs):
        self.sent.append(kwargs)
        self.next_id += 1
        return types.SimpleNamespace(message_id=self.next_id)

    async def send_photo(self, **kwargs):
        self.sent.append(kwargs)
        self.next_id += 1
        return types.SimpleNamespace(message_id=self.next_id)

    async def send_chat_action(self, **kwargs):
        return None

    async def edit_message_text(self, **kwargs):
        return None

    async def edit_message_reply_markup(self, **kwargs):
        return None


class DummyQuery:
    def __init__(self, data: str, user_id: int):
        self.data = data
        self.from_user = types.SimpleNamespace(id=user_id)
        self.message = types.SimpleNamespace(chat_id=user_id, message_id=999)
        self.answers: list[tuple] = []

    async def answer(self, *args, **kwargs):
        self.answers.append((args, kwargs))

    async def edit_message_reply_markup(self, **kwargs):
        return None

    async def edit_message_text(self, *args, **kwargs):
        return None


def update_for(user_id: int, text: str, query=None):
    return types.SimpleNamespace(
        effective_user=types.SimpleNamespace(
            id=user_id, username=f"user{user_id}", first_name=f"User {user_id}"
        ),
        message=DummyMessage(text),
        callback_query=query,
    )


def assert_intents(bot):
    def msgs(*texts):
        return [{"role": "user", "text": text} for text in texts]

    cases = {
        "purchase": msgs("Tài khoản bị lỗi", "Mua"),
        "order": msgs("Kiểm tra mã ORDABC123 giúp tôi"),
        "refund": msgs("Tôi muốn hoàn tiền"),
        "warranty": msgs("Đơn này còn bảo hành không?"),
        "error": msgs("Tài khoản không đăng nhập được"),
        "activation": msgs("Cách kích hoạt sản phẩm?"),
        "usage": msgs("Hướng dẫn sử dụng giúp tôi"),
        "general": msgs("Xin chào"),
    }
    observed = {expected: bot._detect_ai_intent(messages) for expected, messages in cases.items()}
    for expected, actual in observed.items():
        assert actual == expected, (expected, actual)
    return observed


def assert_history(bot):
    long_history = []
    for i in range(10):
        long_history.extend([
            {"role": "user", "text": f"Câu hỏi cũ số {i} với nội dung không liên quan"},
            {"role": "assistant", "text": f"Trả lời cũ số {i}"},
        ])
    long_history.append({"role": "user", "text": "Cho tôi biết trạng thái hiện tại của dịch vụ"})
    assert len(bot._build_relevant_ai_history(long_history)) == 1
    long_history.extend([
        {"role": "assistant", "text": "Đã trả lời"},
        {"role": "user", "text": "Còn cái đó?"},
    ])
    assert 1 < len(bot._build_relevant_ai_history(long_history)) <= 4
    assert bot._build_relevant_ai_history([{"role": "user", "text": "[Ảnh]"}]) == []


def assert_spam(bot):
    original_cfg = bot._spam_cfg
    bot._spam_cfg = lambda: (5, 60, 4, 60)
    bot._chat_msg_timestamps.clear()
    try:
        sequence = [bot._support_rate_check("u1", 100 + i)[0] for i in range(5)]
        assert sequence == ["ok", "ok", "ok", "warned", "locked"], sequence
        assert bot._support_rate_check("u2", 104)[0] == "ok"
        assert bot._support_rate_message("warned") == bot._SUPPORT_SPAM_WARNING_MSG
        assert bot._support_rate_message("locked") == bot._SUPPORT_SPAM_LOCK_MSG
        return sequence
    finally:
        bot._spam_cfg = original_cfg
        bot._chat_msg_timestamps.clear()


def assert_order_ownership(bot):
    store = {
        "users": {
            "1": {"username": "owner"},
            "2": {"username": "other"},
        },
        "orders": {
            "ORDEROWN123": {
                "orderId": "ORDEROWN123",
                "telegramUsername": "@owner",
                "productName": "Owned Product",
                "status": "active",
                "warrantyDays": 0,
            },
            "ORDERSEC123": {
                "orderId": "ORDERSEC123",
                "telegramUsername": "@other",
                "productName": "Secret Product",
                "status": "active",
                "warrantyDays": 0,
            },
        },
        "order_items": {},
        "warranty_requests": [],
    }

    class MemoryDB:
        @staticmethod
        def load(name, default=None):
            return copy.deepcopy(store.get(name, {} if default is None else default))

        @staticmethod
        def get_product_guide_by_name(name):
            return None

        @staticmethod
        def get_refund_record(order_id):
            return None

    original_db = bot.db
    bot.db = MemoryDB
    try:
        owned = bot._build_ai_order_context(
            "1", [{"role": "user", "text": "Kiểm tra ORDEROWN123"}], "order"
        )
        denied = bot._build_ai_order_context(
            "1", [{"role": "user", "text": "Kiểm tra ORDERSEC123"}], "order"
        )
        repeated = bot._build_ai_order_context(
            "1",
            [
                {"role": "user", "text": "Kiểm tra ORDEROWN123"},
                {"role": "user", "text": "Tôi nhắc ORDERSEC123"},
                {"role": "user", "text": "Quay lại ORDEROWN123"},
            ],
            "order",
        )
        assert "Owned Product" in owned
        assert "Secret Product" not in denied
        assert "Khong tim thay" in denied
        assert "Owned Product" in repeated and "Secret Product" not in repeated
        return "pass"
    finally:
        bot.db = original_db


def assert_budget(bot):
    store: dict = {}

    class MemoryDB:
        @staticmethod
        def load(name, default=None):
            return copy.deepcopy(store.get(name, {} if default is None else default))

        @staticmethod
        def save(name, data):
            store[name] = copy.deepcopy(data)

    original_db = bot.db
    original_settings = bot._load_ai_settings
    original_today = bot._ai_budget_today
    bot.db = MemoryDB
    bot._load_ai_settings = lambda: {
        "daily_token_budget": 20_000,
        "daily_request_budget": 20,
    }
    bot._ai_budget_today = lambda: "2026-08-19"
    try:
        for _ in range(20):
            reservation_date = bot._ai_budget_reserve_request("budget-user", 1000)
            assert reservation_date == "2026-08-19"
            bot._ai_budget_finalize_request(
                "budget-user", reservation_date, 1000, actual_tokens=123
            )
        assert bot._ai_budget_reserve_request("budget-user") is False
        record = store["ai_usage"]["budget-user"]
        assert record == {
            "date": "2026-08-19",
            "tokens": 2460,
            "requests": 20,
        }

        store["ai_usage"]["strict-user"] = {
            "date": "2026-08-19",
            "tokens": 19_999,
            "requests": 0,
        }
        assert bot._ai_budget_reserve_request("strict-user", 2) is False
        strict_date = bot._ai_budget_reserve_request("strict-user", 1)
        assert strict_date == "2026-08-19"
        bot._ai_budget_finalize_request("strict-user", strict_date, 1, actual_tokens=1)
        assert bot._ai_budget_check("strict-user")[0] is True

        # Simulate a process restart: in-memory lock/state changes, persisted JSON remains.
        bot._AI_BUDGET_LOCK = bot.Lock()
        assert bot._ai_budget_check("budget-user")[0] is True
        return record
    finally:
        bot.db = original_db
        bot._load_ai_settings = original_settings
        bot._ai_budget_today = original_today


async def assert_handoff_handlers(bot):
    sessions = {
        "101": {
            "status": "active",
            "handoff_state": "WAITING_ADMIN",
            "messages": [],
            "msg_count": 0,
        },
        "102": {
            "status": "active",
            "handoff_state": "ADMIN_ACCEPTED",
            "accepting_admin_id": 501,
            "assigned_admin_id": 502,
            "messages": [],
            "msg_count": 0,
        },
        "103": {
            "status": "active",
            "handoff_state": "AI_ACTIVE",
            "messages": [],
            "msg_count": 0,
        },
    }
    data = {"sessions": sessions, "msg_map": {}, "queue": ["101"]}
    saved: list[dict] = []
    ai_calls: list[str] = []
    budget_calls: list[str] = []

    async def forbidden_ai(*args, **kwargs):
        ai_calls.append("called")
        return "unexpected"

    original = {
        "_load_chat_sessions": bot._load_chat_sessions,
        "_save_chat_sessions": bot._save_chat_sessions,
        "_support_rate_check": bot._support_rate_check,
        "_ai_chat_reply": bot._ai_chat_reply,
        "_ai_budget_check": bot._ai_budget_check,
        "_chat_keyboard": bot._chat_keyboard,
        "lang": bot.lang,
    }
    bot._load_chat_sessions = lambda: data
    bot._save_chat_sessions = lambda value: saved.append(copy.deepcopy(value))
    bot._support_rate_check = lambda uid, now: ("ok", 0)
    bot._ai_chat_reply = forbidden_ai
    bot._ai_budget_check = lambda uid: (budget_calls.append(uid) or (False, None))
    bot._chat_keyboard = lambda uid: None
    bot.lang = lambda uid: "vi"
    context = types.SimpleNamespace(bot=DummyBot())
    try:
        waiting_update = update_for(101, "Thông tin bổ sung khi đang chờ")
        await bot.handle_live_chat_message(waiting_update, context)
        assert not ai_calls and not budget_calls
        assert sessions["101"]["messages"][-1]["text"].startswith("Thông tin bổ sung")

        accepted_update = update_for(102, "Tin nhắn cho Admin phụ trách")
        await bot.handle_live_chat_message(accepted_update, context)
        assert context.bot.sent[-1]["chat_id"] == 502
        assert not ai_calls and not budget_calls

        bot._support_rate_check = lambda uid, now: ("warned", 0)
        spam_update = update_for(103, "Tin nhắn bị cảnh báo")
        await bot.handle_live_chat_message(spam_update, context)
        assert spam_update.message.replies == [bot._SUPPORT_SPAM_WARNING_MSG]
        assert not ai_calls and not budget_calls
    finally:
        for name, value in original.items():
            setattr(bot, name, value)

    # Competing accept actions: only the first WAITING_ADMIN -> ADMIN_ACCEPTED wins.
    accept_data = {
        "sessions": {
            "201": {
                "status": "active",
                "handoff_state": "WAITING_ADMIN",
                "messages": [],
            }
        },
        "msg_map": {},
        "queue": ["201"],
    }
    original = {
        "_load_chat_sessions": bot._load_chat_sessions,
        "_save_chat_sessions": bot._save_chat_sessions,
        "_get_all_admin_ids": bot._get_all_admin_ids,
        "_get_support_admins": bot._get_support_admins,
        "_update_queue_positions": bot._update_queue_positions,
        "_build_transfer_markup": bot._build_transfer_markup,
    }
    bot._load_chat_sessions = lambda: accept_data
    bot._save_chat_sessions = lambda value: None
    bot._get_all_admin_ids = lambda: [10, 11]
    bot._get_support_admins = lambda enabled_only=False: []

    async def no_queue_updates(*args, **kwargs):
        return None

    bot._update_queue_positions = no_queue_updates
    bot._build_transfer_markup = lambda uid: None
    context = types.SimpleNamespace(bot=DummyBot())
    try:
        first = update_for(10, "", DummyQuery("accept_session:201", 10))
        second = update_for(11, "", DummyQuery("accept_session:201", 11))
        await bot.callback_accept_session(first, context)
        await bot.callback_accept_session(second, context)
        session = accept_data["sessions"]["201"]
        assert session["handoff_state"] == "ADMIN_ACCEPTED"
        assert session["accepting_admin_id"] == 10
        assert "201" not in accept_data["queue"]
    finally:
        for name, value in original.items():
            setattr(bot, name, value)

    # A transferred waiting session must become accepted and leave the queue.
    transfer_data = {
        "sessions": {
            "301": {
                "status": "active",
                "handoff_state": "WAITING_ADMIN",
                "messages": [],
                "transfer_pending": {
                    "to_admin_id": 22,
                    "to_admin_name": "Admin B",
                    "admin_a_id": 10,
                    "admin_a_chat_id": 10,
                    "admin_a_msg_id": 333,
                    "request_msg_id": 444,
                },
            }
        },
        "msg_map": {},
        "queue": ["301"],
    }
    original = {
        "_load_chat_sessions": bot._load_chat_sessions,
        "_save_chat_sessions": bot._save_chat_sessions,
        "_update_queue_positions": bot._update_queue_positions,
        "_get_all_admin_ids": bot._get_all_admin_ids,
    }
    bot._load_chat_sessions = lambda: transfer_data
    bot._save_chat_sessions = lambda value: None
    bot._get_all_admin_ids = lambda: [10]

    async def no_queue_updates(*args, **kwargs):
        return None

    bot._update_queue_positions = no_queue_updates
    context = types.SimpleNamespace(bot=DummyBot())
    try:
        transfer = update_for(22, "", DummyQuery("spt_ok:301", 22))
        await bot.callback_spt_ok(transfer, context)
        session = transfer_data["sessions"]["301"]
        assert session["handoff_state"] == "ADMIN_ACCEPTED"
        assert session["assigned_admin_id"] == 22
        assert session["accepting_admin_id"] == 22
        assert session["admin_engaged"] is True
        assert "301" not in transfer_data["queue"]

        # Simulate an old accept button clicked after queue cancellation.
        transfer_data["sessions"]["302"] = {
            "status": "active",
            "handoff_state": "AI_ACTIVE",
            "messages": [],
            "transfer_pending": {
                "to_admin_id": 22,
                "to_admin_name": "Admin B",
                "admin_a_id": 10,
                "admin_a_chat_id": 10,
                "admin_a_msg_id": 335,
                "request_msg_id": 445,
            },
        }
        stale = update_for(22, "", DummyQuery("spt_ok:302", 22))
        await bot.callback_spt_ok(stale, context)
        stale_session = transfer_data["sessions"]["302"]
        assert stale_session["handoff_state"] == "AI_ACTIVE"
        assert "assigned_admin_id" not in stale_session
        assert "transfer_pending" not in stale_session
    finally:
        for name, value in original.items():
            setattr(bot, name, value)


async def assert_ai_payload(bot):
    import httpx

    captured: list[dict] = []
    reserved: list[tuple[str, int]] = []
    finalized: list[tuple[str, str, int, int]] = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "usage": {"total_tokens": 321},
                "choices": [{"message": {"content": "✅ Trả lời ngắn."}}],
            }

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            captured.append(kwargs["json"])
            return FakeResponse()

    class FailingClient(FakeClient):
        async def post(self, *args, **kwargs):
            captured.append(kwargs["json"])
            raise TimeoutError("ambiguous timeout after send")

    original = {
        "client": httpx.AsyncClient,
        "_load_ai_settings": bot._load_ai_settings,
        "_build_ai_order_context": bot._build_ai_order_context,
        "_find_product_guide_from_messages": bot._find_product_guide_from_messages,
        "_ai_budget_reserve_request": bot._ai_budget_reserve_request,
        "_ai_budget_finalize_request": bot._ai_budget_finalize_request,
    }
    httpx.AsyncClient = FakeClient
    bot._load_ai_settings = lambda: {
        "enabled": True,
        "apiKey": "validation-only",
        "model": "gpt-4o-mini",
        "systemPrompt": bot._DEFAULT_AI_SYSTEM_PROMPT,
    }
    bot._build_ai_order_context = lambda *args, **kwargs: ""
    bot._find_product_guide_from_messages = lambda *args, **kwargs: ""
    bot._ai_budget_reserve_request = lambda uid, tokens: (
        reserved.append((uid, tokens)) or "2026-08-19"
    )
    bot._ai_budget_finalize_request = (
        lambda uid, date, reserved_tokens, actual_tokens=0:
        finalized.append((uid, date, reserved_tokens, actual_tokens))
    )
    try:
        result = await bot._ai_chat_reply(
            [{"role": "user", "text": "Xin chào, tôi cần hỗ trợ chung"}],
            uid_str="payload-user",
        )
        assert result == "✅ Trả lời ngắn."
        payload = captured[-1]
        assert payload["max_tokens"] == 500
        assert payload["temperature"] == 0.3
        assert len(payload["messages"]) == 2
        assert len(reserved) == 1 and reserved[0][0] == "payload-user"
        assert reserved[0][1] > payload["max_tokens"]
        assert finalized == [
            ("payload-user", "2026-08-19", reserved[0][1], 321)
        ]

        httpx.AsyncClient = FailingClient
        failed = await bot._ai_chat_reply(
            [{"role": "user", "text": "Yêu cầu có kết quả usage không xác định"}],
            uid_str="timeout-user",
        )
        assert failed is None
        assert len(reserved) == 2
        # Unknown usage must retain its conservative reservation.
        assert len(finalized) == 1
        return {
            "message_count": len(payload["messages"]),
            "input_chars": sum(len(item["content"]) for item in payload["messages"]),
        }
    finally:
        httpx.AsyncClient = original["client"]
        for name, value in original.items():
            if name != "client":
                setattr(bot, name, value)


def measure_inputs(bot, head, old_prompt: str):
    new_base = bot._DEFAULT_AI_SYSTEM_PROMPT + "\n\n" + bot._AI_RESPONSE_STYLE_GUARDRAIL
    old_messages = []
    for i in range(10):
        old_messages.extend([
            {"role": "user", "text": f"Câu hỏi lịch sử {i}: " + "x" * 70},
            {"role": "assistant", "text": f"Trả lời lịch sử {i}: " + "y" * 90},
        ])

    simple_messages = old_messages + [
        {"role": "user", "text": "Shop có thể hỗ trợ gì?"}
    ]
    simple_before = len(old_prompt) + sum(len(m["text"]) for m in simple_messages[-20:])
    simple_after = len(new_base) + sum(
        len(m["text"]) for m in bot._build_relevant_ai_history(simple_messages)
    )

    real_db = bot.db
    orders = real_db.load("orders", {})
    users = real_db.load("users", {})
    username_to_uid = {
        str(user.get("username") or "").strip().lstrip("@").casefold(): str(uid)
        for uid, user in users.items()
        if str(user.get("username") or "").strip()
    }
    order_id = None
    owner_uid = None
    for candidate_id, order in orders.items():
        order_username = (
            str(order.get("telegramUsername") or "").strip().lstrip("@").casefold()
        )
        candidate_uid = username_to_uid.get(order_username)
        if candidate_uid and real_db.get_product_guide_by_name(order.get("productName", "")):
            order_id = candidate_id
            owner_uid = candidate_uid
            break

    measurements = {
        "simple": {
            "before_chars": simple_before,
            "after_chars": simple_after,
        }
    }
    if order_id and owner_uid:
        for intent, question in {
            "activation": f"Tôi cần kích hoạt đơn {order_id}, hướng dẫn giúp tôi",
            "error": f"Đơn {order_id} không đăng nhập được, xử lý thế nào?",
            "warranty": f"Đơn {order_id} còn bảo hành không?",
            "refund": f"Kiểm tra hoàn tiền của đơn {order_id}",
            "order": f"Kiểm tra trạng thái đơn {order_id}",
        }.items():
            messages = old_messages + [{"role": "user", "text": question}]
            old_context = head._build_ai_order_context(owner_uid, messages)
            new_context = bot._build_ai_order_context(owner_uid, messages, intent)
            before = (
                len(old_prompt)
                + len(old_context)
                + sum(len(m["text"]) for m in messages[-20:])
            )
            after = (
                len(new_base)
                + len(new_context)
                + sum(len(m["text"]) for m in bot._build_relevant_ai_history(messages))
            )
            measurements[intent] = {
                "before_chars": before,
                "after_chars": after,
            }

    for values in measurements.values():
        values["before_approx_tokens"] = (values["before_chars"] + 3) // 4
        values["after_approx_tokens"] = (values["after_chars"] + 3) // 4
        values["reduction_percent"] = round(
            100 * (1 - values["after_chars"] / values["before_chars"]), 1
        )
    return measurements


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--head", type=Path, required=True)
    parser.add_argument("--old-prompt", type=Path, required=True)
    args = parser.parse_args()

    bot = load_module("candidate_bot", args.candidate)
    head = load_module("head_bot", args.head)
    old_prompt = args.old_prompt.read_text(encoding="utf-8").rstrip("\n")

    report = {
        "intents": assert_intents(bot),
        "history": "pass",
        "spam": assert_spam(bot),
        "order_ownership": assert_order_ownership(bot),
        "budget": assert_budget(bot),
    }
    assert_history(bot)
    asyncio.run(assert_handoff_handlers(bot))
    report["handoff"] = "pass"
    report["payload"] = asyncio.run(assert_ai_payload(bot))
    report["input_measurements"] = measure_inputs(bot, head, old_prompt)
    report["result"] = "PASS"
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()