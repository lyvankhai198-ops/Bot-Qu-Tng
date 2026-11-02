"""Test actual formatting/notification functions without bot/network/customer data."""
import ast
import asyncio
import copy
from html.parser import HTMLParser
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

SOURCE = Path(os.environ.get("GIFT_CHAT_SOURCE", Path(__file__).with_name("bot.py")))


class ValidHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []

    def handle_starttag(self, tag, attrs):
        assert tag in ("b", "i", "code"), tag
        assert not attrs
        self.stack.append(tag)

    def handle_endtag(self, tag):
        assert self.stack.pop() == tag

    def validate(self, text):
        self.feed(text)
        self.close()
        assert not self.stack


def functions():
    names = {"_format_customer_message_for_admin", "_compact_support_history_for_admin",
             "_notify_admin_with_history"}
    nodes = [n for n in ast.parse(SOURCE.read_text()).body
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert len(nodes) == 3
    ns = {
        "ADMIN_ID": 100,
        "_prepare_customer_message_for_admin": AsyncMock(return_value=None),
        "_translate_support_text": AsyncMock(return_value=None),
        "_queue_position": lambda data, uid: 2,
        "_build_accept_transfer_markup": Mock(return_value="existing-accept-transfer"),
        "_save_chat_sessions": Mock(),
        "ParseMode": SimpleNamespace(HTML="HTML"),
        "logger": SimpleNamespace(error=Mock()),
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), ns)
    return ns


class ChatFormatTests(unittest.TestCase):
    def test_translation_is_primary_original_still_visible(self):
        result = functions()["_format_customer_message_for_admin"]("Hello", "Xin chào")
        self.assertEqual(result, "Xin chào\n<i>Gốc: Hello</i>")
        self.assertNotIn("Bản dịch", result)

    def test_duplicate_translation_is_not_repeated(self):
        for original, translation in [("Admin", "Admin"), ("Hello", " hello "), ("Cần hỗ trợ", "Cần   hỗ trợ")]:
            result = functions()["_format_customer_message_for_admin"](original, translation)
            self.assertNotIn("Gốc:", result)
            self.assertEqual(result, original)

    def test_no_translation_and_failed_translation(self):
        fn = functions()["_format_customer_message_for_admin"]
        self.assertEqual(fn("Tin nhắn", None), "Tin nhắn")
        self.assertIn("Chưa dịch được", fn("<nội dung>", None, True))
        self.assertNotIn("<nội dung>", fn("<nội dung>", None, True))

    def test_user_and_ai_text_are_escaped_and_complete_html(self):
        msgs = [{"role": role, "text": '<script>& "text"</script>',
                 "translation_vi": "<b>không phải HTML</b>", "time": "2026-11-02T15:36:00"}
                for role in ("user", "assistant")]
        result = functions()["_compact_support_history_for_admin"](msgs)
        ValidHTML().validate(result)
        self.assertNotIn("<script>", result)
        self.assertIn("&lt;b&gt;không phải HTML&lt;/b&gt;", result)
        self.assertIn("<b>Khách · 15:36</b>", result)
        self.assertIn("<b>AI · 15:36</b>", result)
        self.assertEqual(result.count("2026-11-02"), 1)

    def test_recent_preview_keeps_latest_messages_and_preserves_session(self):
        msgs = [{"role": "user", "text": f"Message {i}", "time": "2026-11-02T15:36:00"} for i in range(20)]
        before = copy.deepcopy(msgs)
        result = functions()["_compact_support_history_for_admin"](msgs)
        self.assertIn("8/20 tin gần nhất", result)
        self.assertIn("Message 19", result)
        self.assertNotIn("Message 11", result)
        self.assertEqual(msgs, before)

    def test_long_and_emoji_text_stays_within_telegram_budget(self):
        for text in ["<&>" * 4000, "😀" * 8000, "Nội dung " * 8000]:
            msgs = [{"role": "assistant", "text": text, "translation_vi": text + " khác",
                     "time": "2026-11-02T15:36:00"} for _ in range(30)]
            result = functions()["_compact_support_history_for_admin"](msgs)
            self.assertLessEqual(len(result.encode("utf-16-le")) // 2, 3000)
            self.assertIn("tin gần nhất", result)
            ValidHTML().validate(result)

    def test_empty_and_multiday_history(self):
        fn = functions()["_compact_support_history_for_admin"]
        self.assertIn("Chưa có", fn([]))
        result = fn([{"role": "user", "text": "One", "time": "2026-11-01T15:36:00"},
                     {"role": "assistant", "text": "Two", "time": "2026-11-02T15:37:00"}])
        self.assertIn("2026-11-01 15:36", result)
        self.assertIn("2026-11-02 15:37", result)

    def test_notification_keeps_actions_reply_mapping_and_full_history(self):
        ns = functions()
        messages = [{"role": "user", "text": "Hello", "translation_vi": "Xin chào", "time": "2026-11-02T15:36:00"},
                    {"role": "assistant", "text": "Admin", "translation_vi": "Admin", "time": "2026-11-02T15:37:00"}]
        session = {"messages": messages}
        before = copy.deepcopy(messages)
        data = {"msg_map": {}}
        context = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock(return_value=SimpleNamespace(message_id=88))))
        user = SimpleNamespace(id=123, username=None, first_name="<Unsafe & name>")
        asyncio.run(ns["_notify_admin_with_history"](context, data, session, "123", user))
        params = context.bot.send_message.await_args.kwargs
        self.assertEqual(params["chat_id"], 100)
        self.assertEqual(params["reply_markup"], "existing-accept-transfer")
        self.assertIn("Chờ #2", params["text"])
        self.assertIn("&lt;Unsafe &amp; name&gt;", params["text"])
        self.assertNotIn("🇻🇳", params["text"])
        ValidHTML().validate(params["text"])
        self.assertEqual(data["msg_map"]["88"], "123")
        self.assertEqual(session["session_notif_mid"], 88)
        self.assertIn(88, session["admin_msg_ids"])
        self.assertEqual(messages, before)
        ns["_save_chat_sessions"].assert_called_once_with(data)
        ns["logger"].error.assert_not_called()

    def test_notification_long_history_does_not_cut_html_or_reply_footer(self):
        ns = functions()
        messages = [{"role": "user", "text": "<&😀>" * 5000, "translation_vi": "😀" * 10000,
                     "time": "2026-11-02T15:36:00"} for _ in range(50)]
        context = SimpleNamespace(bot=SimpleNamespace(send_message=AsyncMock(return_value=SimpleNamespace(message_id=1))))
        asyncio.run(ns["_notify_admin_with_history"](
            context, {"msg_map": {}}, {"messages": messages}, "123",
            SimpleNamespace(id=123, username="u" * 80, first_name=None),
        ))
        body = context.bot.send_message.await_args.kwargs["text"]
        self.assertLess(len(body.encode("utf-16-le")) // 2, 4096)
        self.assertIn("Reply tin này để trả lời khách.", body)
        ValidHTML().validate(body)


if __name__ == "__main__":
    unittest.main()
