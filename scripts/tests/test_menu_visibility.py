"""Dependency-free tests of actual bot functions; no Telegram/network/data writes."""
import ast
import asyncio
import itertools
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

SOURCE = Path(os.environ.get("BOT_MENU_SOURCE", Path(__file__).resolve().parents[2] / "bot.py"))
FLAGS = ("support_enabled", "gift_enabled", "intro_enabled")
BUTTONS = ("btn_support", "btn_gift", "btn_check_order", "btn_shop", "btn_chat_support", "btn_intro")


def load_functions(settings, language="vi"):
    names = {"main_keyboard", "handle_support_menu", "menu_router"}
    tree = ast.parse(SOURCE.read_text())
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    if len(nodes) != len(names):
        raise AssertionError("Missing actual bot functions")
    for node in nodes:
        node.returns = None
        for arg in node.args.args:
            arg.annotation = None
    db = SimpleNamespace(
        get_settings=lambda: settings,
        get_user_lang=lambda _: language,
        set_user_lang=Mock(),
        set_user_state=Mock(),
    )
    ns = {
        "db": db,
        "lang": lambda _: language,
        "t": lambda language, key: f"{language}:{key}",
        "ReplyKeyboardMarkup": lambda rows, **kw: SimpleNamespace(keyboard=rows),
        "_route_assigned_admin_direct": AsyncMock(return_value=False),
        "_route_admin_chat_reply": AsyncMock(return_value=False),
        "detect_lang_from_text": lambda _: None,
        "maintenance_reply": AsyncMock(return_value=False),
        "handle_gift": AsyncMock(),
        "handle_intro": AsyncMock(),
        "handle_check_order": AsyncMock(),
        "handle_shop": AsyncMock(),
        "handle_chat_support_start": AsyncMock(),
        "show_main_menu": AsyncMock(),
        "support_menu_keyboard": Mock(return_value="support-menu"),
        "ParseMode": SimpleNamespace(HTML="HTML"),
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), ns)
    return ns


def update(text):
    return SimpleNamespace(
        effective_user=SimpleNamespace(id=123),
        message=SimpleNamespace(text=text, reply_to_message=None, reply_text=AsyncMock()),
    )


class MenuVisibilityTests(unittest.TestCase):
    def test_every_flag_combination_in_both_languages(self):
        for language, values in itertools.product(("vi", "en"), itertools.product((True, False), repeat=3)):
            settings = dict(zip(FLAGS, values))
            ns = load_functions(settings, language)
            rows = ns["main_keyboard"](123).keyboard
            visible = [text for row in rows for text in row]
            expected = [
                f"{language}:{key}" for key in BUTTONS
                if key not in {"btn_support", "btn_gift", "btn_intro"}
                or settings[{"btn_support": FLAGS[0], "btn_gift": FLAGS[1], "btn_intro": FLAGS[2]}[key]]
            ]
            self.assertEqual(visible, expected)
            self.assertTrue(all(rows))
            for row in rows:
                self.assertLessEqual(len(row), 2)

    def test_missing_settings_keep_existing_menu(self):
        self.assertEqual(
            load_functions({})["main_keyboard"](123).keyboard,
            [["vi:btn_support", "vi:btn_gift"], ["vi:btn_check_order", "vi:btn_shop"], ["vi:btn_chat_support", "vi:btn_intro"]],
        )

    def test_toggle_off_and_back_on_without_restart(self):
        settings = {}
        ns = load_functions(settings)
        for flag, key in zip(FLAGS, ("btn_support", "btn_gift", "btn_intro")):
            settings[flag] = False
            self.assertNotIn(f"vi:{key}", sum(ns["main_keyboard"](123).keyboard, []))
            settings[flag] = True
            self.assertIn(f"vi:{key}", sum(ns["main_keyboard"](123).keyboard, []))

    def test_stale_buttons_refresh_keyboard_without_executing_features(self):
        for language, key, flag in itertools.product(("vi", "en"), ("btn_support", "btn_gift", "btn_intro"), FLAGS):
            expected_flag = {"btn_support": FLAGS[0], "btn_gift": FLAGS[1], "btn_intro": FLAGS[2]}[key]
            if flag != expected_flag:
                continue
            ns = load_functions({flag: False}, language)
            u = update(f"{language}:{key}")
            asyncio.run(ns["menu_router"](u, None))
            u.message.reply_text.assert_awaited_once()
            markup = u.message.reply_text.await_args.kwargs["reply_markup"]
            self.assertNotIn(f"{language}:{key}", sum(markup.keyboard, []))
            ns["handle_gift"].assert_not_awaited()
            ns["handle_intro"].assert_not_awaited()
            ns["db"].set_user_state.assert_not_called()

    def test_support_command_cannot_open_disabled_menu(self):
        ns = load_functions({"support_enabled": False})
        u = update("/support")
        asyncio.run(ns["handle_support_menu"](u, None))
        self.assertEqual(u.message.reply_text.await_args.args[0], "vi:support_disabled")
        self.assertNotIn("vi:btn_support", sum(u.message.reply_text.await_args.kwargs["reply_markup"].keyboard, []))
        ns["db"].set_user_state.assert_not_called()

    def test_enabled_support_still_opens_original_submenu(self):
        ns = load_functions({"support_enabled": True})
        u = update("/support")
        asyncio.run(ns["handle_support_menu"](u, None))
        ns["db"].set_user_state.assert_called_once_with(123, "conv_state", None)
        self.assertEqual(u.message.reply_text.await_args.kwargs["reply_markup"], "support-menu")

    def test_other_buttons_are_unchanged_when_all_configured_features_disabled(self):
        for key, handler in (("btn_check_order", "handle_check_order"), ("btn_shop", "handle_shop"), ("btn_chat_support", "handle_chat_support_start")):
            ns = load_functions(dict.fromkeys(FLAGS, False))
            u = update("vi:" + key)
            asyncio.run(ns["menu_router"](u, None))
            ns[handler].assert_awaited_once_with(u, None)
            u.message.reply_text.assert_not_awaited()

    def test_home_works_even_with_disabled_features(self):
        ns = load_functions(dict.fromkeys(FLAGS, False))
        u = update("vi:btn_home")
        asyncio.run(ns["menu_router"](u, None))
        ns["show_main_menu"].assert_awaited_once_with(u, None)


if __name__ == "__main__":
    unittest.main()
