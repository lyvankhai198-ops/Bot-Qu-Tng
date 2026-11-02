"""Exercise actual bot functions without polling Telegram or touching customer data."""
import ast
import asyncio
import importlib.util
import itertools
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(os.environ["GIFT_SOURCE_ROOT"])
FLAGS = ("support_enabled", "gift_enabled", "check_order_enabled",
         "shop_enabled", "chat_support_enabled", "intro_enabled")
KEYS = ("btn_support", "btn_gift", "btn_check_order",
        "btn_shop", "btn_chat_support", "btn_intro")


def namespace(settings, language="vi", state=None, sessions=None):
    names = {
        "main_keyboard", "menu_router", "handle_check_order", "handle_shop",
        "handle_chat_support_start", "handle_order_lookup", "_show_welcome_and_menu",
        "show_main_menu", "_chat_keyboard",
    }
    tree = ast.parse((ROOT / "bot.py").read_text())
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert len(nodes) == len(names)
    for node in nodes:
        node.returns = None
        for arg in node.args.args:
            arg.annotation = None
    translations = {}
    exec(compile((ROOT / "translations.py").read_text(), "translations.py", "exec"), translations)
    user_state = {"conv_state": state}
    session_data = sessions if sessions is not None else {"sessions": {}}
    db = SimpleNamespace(
        get_settings=lambda: settings, get_user_lang=lambda _: language,
        get_user_state=lambda _: user_state,
        set_user_state=Mock(side_effect=lambda _, key, value: user_state.update({key: value})),
        set_user_lang=Mock(),
        clear_user_state=Mock(side_effect=lambda _, key: user_state.pop(key, None)),
    )
    ns = {
        "db": db, "lang": lambda _: language, "t": translations["t"],
        "ReplyKeyboardMarkup": lambda keyboard, **_: SimpleNamespace(keyboard=keyboard),
        "ReplyKeyboardRemove": lambda: SimpleNamespace(keyboard=[], remove_keyboard=True),
        "ParseMode": SimpleNamespace(HTML="HTML"),
        "_route_assigned_admin_direct": AsyncMock(return_value=False),
        "_route_admin_chat_reply": AsyncMock(return_value=False),
        "detect_lang_from_text": lambda _: None,
        "maintenance_reply": AsyncMock(return_value=False),
        "handle_gift": AsyncMock(), "handle_intro": AsyncMock(),
        "handle_support_menu": AsyncMock(), "show_main_menu": AsyncMock(),
        "get_active_shop_channels": Mock(return_value=[{"id": "fixture"}]),
        "shop_channels_inline": Mock(return_value="shop-channels"),
        "is_admin": lambda _: False, "back_keyboard": lambda _: "back",
        "_load_chat_sessions": lambda: session_data,
        "_save_chat_sessions": Mock(),
        "_check_working_hours": lambda: (True, ""),
        "_get_chat_ban": Mock(return_value=None),
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "bot.py", "exec"), ns)
    return ns


def update(text=""):
    return SimpleNamespace(
        effective_user=SimpleNamespace(id=123, first_name="Fixture", username="fixture"),
        message=SimpleNamespace(text=text, reply_to_message=None, reply_text=AsyncMock()),
    )


class MenuTests(unittest.TestCase):
    def test_all_64_combinations_in_vi_and_en_and_default_enabled(self):
        for language in ("vi", "en"):
            for values in itertools.product((False, True), repeat=6):
                ns = namespace(dict(zip(FLAGS, values)), language)
                markup = ns["main_keyboard"](123)
                visible = sum(markup.keyboard, [])
                self.assertEqual(visible, [ns["t"](language, key) for key, on in zip(KEYS, values) if on])
                self.assertTrue(all(markup.keyboard))
                if not any(values):
                    self.assertTrue(markup.remove_keyboard)
            ns = namespace({}, language)
            self.assertEqual(sum(ns["main_keyboard"](123).keyboard, []), [ns["t"](language, key) for key in KEYS])

    def test_no_restart_needed_to_toggle_each_button(self):
        settings = {}
        ns = namespace(settings)
        for key, flag in zip(KEYS, FLAGS):
            settings[flag] = False
            self.assertNotIn(ns["t"]("vi", key), sum(ns["main_keyboard"](123).keyboard, []))
            settings[flag] = True
            self.assertIn(ns["t"]("vi", key), sum(ns["main_keyboard"](123).keyboard, []))

    def test_old_buttons_of_both_languages_are_blocked_and_keyboard_replaced(self):
        for language, (key, flag) in itertools.product(("vi", "en"), zip(KEYS, FLAGS)):
            ns = namespace({flag: False}, language)
            u = update(ns["t"](language, key))
            asyncio.run(ns["menu_router"](u, None))
            u.message.reply_text.assert_awaited_once()
            self.assertEqual(u.message.reply_text.await_args.args[0], ns["t"](language, "feature_disabled"))
            markup = u.message.reply_text.await_args.kwargs["reply_markup"]
            self.assertNotIn(ns["t"](language, key), sum(markup.keyboard, []))
            ns["db"].set_user_state.assert_not_called()
            ns["db"].clear_user_state.assert_not_called()

    def test_direct_handlers_do_not_bypass_disabled_buttons(self):
        for flag, handler in [
            ("check_order_enabled", "handle_check_order"), ("shop_enabled", "handle_shop"),
            ("chat_support_enabled", "handle_chat_support_start"),
        ]:
            ns = namespace({flag: False})
            u = update("/orders")
            asyncio.run(ns[handler](u, None))
            u.message.reply_text.assert_awaited_once()
            ns["db"].set_user_state.assert_not_called()

    def test_lookup_prompt_opened_before_disable_cannot_continue(self):
        ns = namespace({"check_order_enabled": False}, state="check_lookup")
        u = update("fixture-order")
        asyncio.run(ns["handle_order_lookup"](u, None))
        self.assertEqual(u.message.reply_text.await_args.args[0], ns["t"]("vi", "feature_disabled"))
        ns["db"].clear_user_state.assert_not_called()

    def test_shop_is_not_shown_automatically_when_disabled(self):
        for enabled in (False, True):
            ns = namespace({"shop_enabled": enabled})
            bot = SimpleNamespace(send_message=AsyncMock())
            asyncio.run(ns["_show_welcome_and_menu"](bot, update().effective_user, "vi"))
            self.assertEqual(bot.send_message.await_count, 2 if enabled else 1)
            self.assertEqual(ns["get_active_shop_channels"].call_count, 1 if enabled else 0)

    def test_enabled_order_handler_unchanged(self):
        ns = namespace({})
        u = update("/orders")
        asyncio.run(ns["handle_check_order"](u, None))
        ns["db"].set_user_state.assert_called_once_with(123, "conv_state", "check_lookup")

    def test_real_json_settings_roundtrip_without_other_data_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            fixture = {"gift_enabled": True, "unrelated": {"keep": "unchanged"}}
            (directory / "settings.json").write_text(json.dumps(fixture))
            for name in ("orders", "chat_sessions", "users"):
                (directory / f"{name}.json").write_text('{"fixture":"preserve"}')
            before = {name: (directory / f"{name}.json").read_bytes() for name in ("orders", "chat_sessions", "users")}
            with patch.dict(os.environ, {"DATA_DIR": str(directory)}):
                spec = importlib.util.spec_from_file_location("gift_fixture_data_manager", ROOT / "data_manager.py")
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                for flag in FLAGS:
                    self.assertTrue(module.get_settings()[flag])
                for flag in FLAGS[2:5]:
                    for enabled in (False, True):
                        module.update_setting(flag, enabled)
                        self.assertIs(module.get_settings()[flag], enabled)
                self.assertEqual(module.get_settings()["unrelated"], fixture["unrelated"])
            for name, content in before.items():
                self.assertEqual((directory / f"{name}.json").read_bytes(), content)

    def test_active_chat_home_then_resume_after_switch_is_disabled(self):
        for language in ("vi", "en"):
            settings = {"chat_support_enabled": True}
            sessions = {"sessions": {"123": {
                "status": "active", "started_at": "fixture",
                "messages": [{"text": "retain existing history"}],
            }}}
            before = json.dumps(sessions, sort_keys=True)
            ns = namespace(settings, language, state="live_chat", sessions=sessions)
            home = update(ns["t"](language, "btn_home"))
            asyncio.run(ns["menu_router"](home, None))
            self.assertNotEqual(ns["db"].get_user_state(123).get("conv_state"), "live_chat")
            settings["chat_support_enabled"] = False
            resume = update(ns["t"](language, "btn_chat_support"))
            asyncio.run(ns["menu_router"](resume, None))
            self.assertEqual(ns["db"].get_user_state(123)["conv_state"], "live_chat")
            self.assertEqual(resume.message.reply_text.await_args.args[0],
                             ns["t"](language, "chat_support_existing"))
            self.assertEqual(json.dumps(sessions, sort_keys=True), before)
            ns["_save_chat_sessions"].assert_not_called()
            ns["_get_chat_ban"].assert_called_once_with("123")

    def test_closed_session_does_not_bypass_disabled_switch(self):
        sessions = {"sessions": {"123": {"status": "closed", "messages": ["keep history"]}}}
        ns = namespace({"chat_support_enabled": False}, sessions=sessions)
        u = update(ns["t"]("vi", "btn_chat_support"))
        asyncio.run(ns["menu_router"](u, None))
        self.assertEqual(u.message.reply_text.await_args.args[0], ns["t"]("vi", "feature_disabled"))
        ns["db"].set_user_state.assert_not_called()
        ns["_save_chat_sessions"].assert_not_called()

    def test_resuming_active_chat_does_not_bypass_existing_chat_ban(self):
        sessions = {"sessions": {"123": {"status": "active"}}}
        ns = namespace({"chat_support_enabled": False}, sessions=sessions)
        ns["_get_chat_ban"].return_value = {"expiresAt": None}
        u = update(ns["t"]("vi", "btn_chat_support"))
        asyncio.run(ns["menu_router"](u, None))
        self.assertNotEqual(u.message.reply_text.await_args.args[0], ns["t"]("vi", "chat_support_existing"))
        ns["db"].set_user_state.assert_not_called()
        ns["_save_chat_sessions"].assert_not_called()

    def test_visible_home_keyboard_resumes_active_chat_with_switch_off(self):
        for language in ("vi", "en"):
            settings = {"chat_support_enabled": False}
            sessions = {"sessions": {"123": {"status": "active", "messages": ["preserve"]}}}
            ns = namespace(settings, language, state="live_chat", sessions=sessions)
            home = update(ns["t"](language, "btn_home"))
            asyncio.run(ns["menu_router"](home, None))
            keyboard = home.message.reply_text.await_args.kwargs["reply_markup"].keyboard
            visible = sum(keyboard, [])
            self.assertNotIn(ns["t"](language, "btn_chat_support"), visible)
            self.assertIn(ns["t"](language, "btn_resume_chat"), visible)
            # Select a button actually returned to Telegram, not an invented
            # press of the now-hidden new-chat menu entry.
            button = next(label for row in keyboard for label in row
                          if label == ns["t"](language, "btn_resume_chat"))
            resume = update(button)
            asyncio.run(ns["menu_router"](resume, None))
            self.assertEqual(ns["db"].get_user_state(123)["conv_state"], "live_chat")
            self.assertEqual(resume.message.reply_text.await_args.args[0],
                             ns["t"](language, "chat_support_existing"))
            self.assertEqual(sessions["sessions"]["123"]["messages"], ["preserve"])
            ns["_save_chat_sessions"].assert_not_called()

    def test_start_menu_has_visible_continue_button_for_active_chat(self):
        for language in ("vi", "en"):
            ns = namespace(
                {"chat_support_enabled": False}, language,
                sessions={"sessions": {"123": {"status": "active"}}},
            )
            bot = SimpleNamespace(send_message=AsyncMock())
            asyncio.run(ns["_show_welcome_and_menu"](bot, update().effective_user, language))
            keyboard = bot.send_message.await_args_list[0].kwargs["reply_markup"].keyboard
            self.assertIn(ns["t"](language, "btn_resume_chat"), sum(keyboard, []))

    def test_stale_continue_button_never_creates_new_session(self):
        for status in (None, "closed"):
            sessions = {"sessions": {} if status is None else {"123": {"status": status}}}
            # The continue action cannot create a session even if the ordinary
            # new-chat switch has since been enabled again.
            ns = namespace({"chat_support_enabled": True}, sessions=sessions)
            u = update(ns["t"]("vi", "btn_resume_chat"))
            asyncio.run(ns["menu_router"](u, None))
            self.assertEqual(u.message.reply_text.await_args.args[0], ns["t"]("vi", "feature_disabled"))
            ns["db"].set_user_state.assert_not_called()
            ns["_save_chat_sessions"].assert_not_called()


if __name__ == "__main__":
    unittest.main()
