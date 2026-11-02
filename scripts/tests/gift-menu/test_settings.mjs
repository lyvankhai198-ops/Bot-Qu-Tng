import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.env.GIFT_SOURCE_ROOT);
const localRequire = createRequire(path.resolve("package.json"));
const ts = localRequire("typescript");
const source = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/botAdmin.ts"), "utf8");
const parsed = ts.createSourceFile("botAdmin.ts", source, ts.ScriptTarget.Latest, true);
const functions = new Set(["readSettings", "settingsToApi"]);
const selected = parsed.statements.filter(node => {
  if (ts.isFunctionDeclaration(node)) return functions.has(node.name?.text);
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
  const call = node.expression;
  return ts.isPropertyAccessExpression(call.expression)
    && call.expression.expression.getText(parsed) === "router"
    && ["get", "put"].includes(call.expression.name.text)
    && call.arguments[0]?.text === "/bot/settings";
}).map(node => node.getText(parsed)).join("\n");
assert.equal(selected.match(/router\.(?:get|put)\(/g)?.length, 2);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gift-settings-"));
const settingsFile = path.join(directory, "settings.json");
fs.writeFileSync(settingsFile, JSON.stringify({ support_enabled: false, unrelated: "keep" }));
const routes = {};
const context = vm.createContext({
  readJson: name => JSON.parse(fs.readFileSync(path.join(directory, name + ".json"))),
  writeJson: (name, value) => fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify(value)),
  addLog: () => {}, requireAuth: () => {},
  router: {
    get: (url, auth, handler) => { assert.equal(url, "/bot/settings"); routes.get = handler; },
    put: (url, auth, handler) => { assert.equal(url, "/bot/settings"); routes.put = handler; },
  },
});
vm.runInContext(ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const call = (method, body) => {
  let status = 200, data;
  const res = { status(code) { status = code; return res; }, json(value) { data = JSON.parse(JSON.stringify(value)); } };
  routes[method]({ body }, res);
  return { status, data };
};
const fields = [
  ["checkOrderEnabled", "check_order_enabled", "btn_check_order"],
  ["shopEnabled", "shop_enabled", "btn_shop"],
  ["chatSupportEnabled", "chat_support_enabled", "btn_chat_support"],
];
try {
  const defaults = call("get").data;
  for (const [field] of fields) assert.equal(defaults[field], true);
  assert.equal(defaults.supportEnabled, false);
  for (const [field, stored] of fields) {
    for (const enabled of [false, true]) {
      const response = call("put", { [field]: enabled });
      assert.equal(response.status, 200);
      assert.equal(response.data[field], enabled);
      assert.equal(call("get").data[field], enabled, "GET/reload must retain saved setting");
      const disk = JSON.parse(fs.readFileSync(settingsFile));
      assert.equal(disk[stored], enabled);
      assert.equal(disk.support_enabled, false);
      assert.equal(disk.unrelated, "keep");
      const python = `
import ast,json,sys
from pathlib import Path
from types import SimpleNamespace
settings=json.loads(Path(sys.argv[2]).read_text())
tree=ast.parse((Path(sys.argv[1])/"bot.py").read_text())
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=="main_keyboard")
fn.returns=None
ns={"db":SimpleNamespace(get_settings=lambda:settings),"lang":lambda _:"en","t":lambda L,key:key,
    "_load_chat_sessions":lambda:{"sessions":{}},
    "ReplyKeyboardMarkup":lambda rows,**_:sum(rows,[]),"ReplyKeyboardRemove":lambda:[]}
exec(compile(ast.Module(body=[fn],type_ignores=[]),"bot.py","exec"),ns)
assert (sys.argv[3] in ns["main_keyboard"](1))==(sys.argv[4]=="true")
`;
      const tested = spawnSync("python3", ["-c", python, root, settingsFile, fields.find(row => row[0] === field)[2], String(enabled)], { encoding: "utf8" });
      assert.equal(tested.status, 0, "Saved web/API flag must control actual Python menu: " + tested.stderr);
    }
    for (const invalid of ["false", 0, null, {}, []]) {
      const before = fs.readFileSync(settingsFile, "utf8");
      assert.equal(call("put", { [field]: invalid }).status, 400);
      assert.equal(fs.readFileSync(settingsFile, "utf8"), before);
    }
  }
  const before = call("get").data;
  call("put", { giftEnabled: false });
  for (const [field] of fields) assert.equal(call("get").data[field], before[field], "Partial old clients must not reset new flags");

  const specText = fs.readFileSync(path.join(root, "lib/api-spec/openapi.yaml"), "utf8");
  const settingsUI = fs.readFileSync(path.join(root, "artifacts/admin-panel/src/pages/settings.tsx"), "utf8");
  const uiAst = ts.createSourceFile("settings.tsx", settingsUI, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(uiAst.parseDiagnostics.length, 0);
  for (const [field] of fields) {
    assert.equal(specText.match(new RegExp("^        " + field + ":", "gm"))?.length, 2);
    assert.ok(settingsUI.includes(`checked={form.${field} !== false}`));
    assert.ok(settingsUI.includes(`onCheckedChange={v => setForm({...form, ${field}: v})}`));
  }
  assert.ok(settingsUI.includes("mutate({ data: form })"));
  assert.ok(settingsUI.includes("setQueryData(getGetBotSettingsQueryKey(), data)"));
  assert.ok(settingsUI.includes("setForm(settings)"));
  for (const p of [
    "lib/api-client-react/src/generated/api.schemas.ts",
    "lib/api-zod/src/generated/types/botSettings.ts",
    "lib/api-zod/src/generated/types/botSettingsInput.ts",
    "lib/api-zod/src/generated/api.ts",
  ]) {
    const generated = fs.readFileSync(path.join(root, p), "utf8");
    for (const [field] of fields) assert.ok(generated.includes(field), p + " must expose " + field);
  }
  console.log("GIFT_WEB_API_JSON_BOT_ROUNDTRIP=passed");
  console.log("GIFT_SETTINGS_UI_CONTRACT=passed");
  console.log("GIFT_SETTINGS_INVALID_BOOLEAN=passed");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
