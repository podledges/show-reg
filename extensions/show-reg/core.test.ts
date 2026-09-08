import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { type Config, cleanFilePath, createManualLoader, indexManual, lookup, readConfig, runText, saveConfig, sourceExcerpt, validateConfig } from "./core.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config: Config = { version: 1, target: "MCXC444", manual: process.env.SHOW_REG_TEST_MANUAL ?? "manual.pdf", pdftotext: "pdftotext", model: "current", preference: "accuracy" };
const fixture = `Contents
27.2.1 MCG Control Register 1 (MCG_C1)........451
\f27.2 Memory map and register definition
Introduction
\f27.2.1 MCG Control Register 1 (MCG_C1)
Address: 0
Bit 7 6 5 4 3 2 1 0
MCG_C1 field descriptions
CLKS clock source
\fContinued
IREFSTEN stop enable
27.2.2 MCG Control Register 2 (MCG_C2)
Address: 1
MCG_C2 field descriptions
IRCS clock selection
\f28.1.1 UART Control Register 1 (UARTx_C1)
Address: 2
UARTx_C1 field descriptions
Enable bits
\f`;

test("PDF paths accept Explorer quotes and report invalid files clearly", async () => {
  assert.equal(cleanFilePath('  "C:\\My Documents\\chip.pdf"  '), "C:\\My Documents\\chip.pdf");
  assert.equal(cleanFilePath("'datasheets/chip.pdf'"), "datasheets/chip.pdf");
  assert.equal(cleanFilePath("datasheets/chip.pdf"), "datasheets/chip.pdf");
  const load = createManualLoader();
  await assert.rejects(load(root, { ...config, manual: "no-such-datasheet.pdf" }), /Cannot access PDF/);
  await assert.rejects(load(root, { ...config, manual: "." }), /not a directory/);
});

test("index excludes TOC and parent headings, retains continuation before next register", () => {
  const manual = indexManual(fixture);
  assert.equal(manual.registers.length, 3);
  const result = lookup(manual.registers, "mcg -> c1");
  assert.equal(result.exact?.id, "MCG_C1");
  assert.equal(result.exact?.page, 3);
  const excerpt = sourceExcerpt(manual, result.exact!);
  assert.match(excerpt, /IREFSTEN/);
  assert.doesNotMatch(excerpt, /IRCS clock selection|MCG_C2/);
  assert.equal(lookup(manual.registers, "MCG Control Register 1").exact?.id, "MCG_C1");
});

test("ambiguous abbreviations and typos never silently resolve", () => {
  const { registers } = indexManual(fixture);
  assert.equal(lookup(registers, "C1").exact, undefined);
  assert.equal(lookup(registers, "C1").candidates.length, 2);
  assert.equal(lookup(registers, "MCG_C9").exact, undefined);
  assert.equal(lookup(registers, "MCG_C9").candidates[0].id, "MCG_C1");
  assert.equal(lookup(registers, "completely unrelated purple elephant").candidates.length, 0);
  assert.throws(() => lookup(registers, ""));
  assert.throws(() => indexManual("Unreadable scan"), /OCR/);
});

test("config survives restart, replaces cleanly, validates and rejects corrupt data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "show-reg-config-"));
  try {
    assert.equal(await readConfig(directory), undefined);
    await saveConfig(directory, config);
    assert.deepEqual(await readConfig(directory), config);
    await saveConfig(directory, { ...config, model: "example/model" });
    assert.equal((await readConfig(directory))?.model, "example/model");
    assert.deepEqual(await readdir(join(directory, ".pi")), ["show-reg.json"]);
    await unlink(join(directory, ".pi/show-reg.json"));
    await writeFile(join(directory, ".pi/show-me.json"), JSON.stringify({ ...config, model: "legacy/model" }) + "\n");
    assert.equal((await readConfig(directory))?.model, "legacy/model");
    await saveConfig(directory, { ...config, model: "example/model" });
    assert.equal((await readConfig(directory))?.model, "example/model");
    assert.throws(() => validateConfig({ ...config, version: 2 }));
    assert.throws(() => validateConfig({ ...config, manual: "" }));
    await writeFile(join(directory, ".pi/show-reg.json"), "broken");
    await assert.rejects(readConfig(directory), /repair/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("process arguments are literal, not shell input", async () => {
  const value = "spaces; $(not-a-command) & quoted";
  const output = await runText(process.execPath, ["-e", "process.stdout.write(process.argv[1])", value]);
  assert.equal(output, value);
  await assert.rejects(runText("show-reg-no-such-executable", []), /extraction failed/);
  const controller = new AbortController();
  const pending = runText(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], controller.signal);
  controller.abort();
  await assert.rejects(pending, /extraction failed/);
});

test("real manual: different peripherals, title aliases and bounded source", async (t) => {
  if (!process.env.SHOW_REG_TEST_MANUAL) { t.skip("Set SHOW_REG_TEST_MANUAL to the MCX-C44X reference PDF for this optional integration test."); return; }
  const manual = await createManualLoader()(root, config);
  for (const [query, page] of [["MCG->C1", 451], ["MCG_C2", 452], ["SIM_SCGC5", 172], ["PORTx_PCRn", 149], ["UARTx_C2", 701], ["MDM-AP Control Register", 111]] as const) {
    const result = lookup(manual.registers, query);
    assert.equal(result.exact?.page, page, query);
    const source = sourceExcerpt(manual, result.exact!);
    assert.ok(source.length < 60_000, query);
    assert.match(source, /PDF page/);
  }
  const c1 = lookup(manual.registers, "MCG->C1").exact!;
  assert.doesNotMatch(sourceExcerpt(manual, c1), /MCG_C2/);
});

function piPackage(): string | undefined {
  if (process.env.PI_PACKAGE_PATH) return process.env.PI_PACKAGE_PATH;
  try { return dirname(dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent"))); } catch {}
  const global = process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules/@earendil-works/pi-coding-agent");
  return global && existsSync(global) ? global : undefined;
}

test("Pi extension loads; mocks verify no-call failures, isolated request and identity", async (t) => {
  const packagePath = piPackage();
  if (!packagePath) { t.skip("Set PI_PACKAGE_PATH to the installed Pi package to test its loader."); return; }
  const { loadExtensions } = await import(pathToFileURL(join(packagePath, "dist/core/extensions/loader.js")).href);
  const loaded = await loadExtensions([join(root, "extensions/show-reg/index.ts")], root);
  assert.deepEqual(loaded.errors, []);
  const commands = loaded.extensions[0].commands;
  assert.deepEqual([...commands.keys()].sort(), ["show-reg", "show-reg-config"]);
  if (!process.env.SHOW_REG_TEST_MANUAL) { t.diagnostic("Pi command loading passed; set SHOW_REG_TEST_MANUAL to also exercise real-PDF model mocks."); return; }
  const directory = await mkdtemp(join(tmpdir(), "show-reg-command-"));
  const messages: any[] = [];
  // Runtime message injection is replaced; no provider or active Pi session is used.
  loaded.runtime.sendMessage = (message: unknown) => messages.push(message);
  let calls = 0;
  const model = { provider: "test", id: "chosen", input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 1, output: 1 } };
  const ctx: any = { cwd: directory, scopedModels: [], model, hasUI: true,
    ui: { setStatus() {}, notify() {} },
    modelRegistry: { getAvailable: () => [model], complete: async (chosen: unknown, context: any) => {
      calls++;
      assert.equal(chosen, model);
      assert.equal(context.messages.length, 1);
      assert.equal(context.tools, undefined);
      assert.ok(context.messages[0].content[0].text.length < 10000);
      assert.match(context.messages[0].content[0].text, /MCG_C1/);
      assert.doesNotMatch(context.messages[0].content[0].text, /MCG_C2/);
      return { stopReason: "stop", provider: "test", model: "reported-model", content: [{ type: "text", text: "Register answer" }] };
    } } };
  try {
    // Locate repository via a minimal temporary root without copying the manual.
    await writeFile(join(directory, "AGENTS.md"), "Test root");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(directory, "datasheets"));
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.match(messages.at(-1).content, /show-reg-config/);
    assert.equal(calls, 0);
    await saveConfig(directory, { ...config, manual: resolve(root, config.manual) });
    await commands.get("show-reg").handler("MCG_C9", ctx);
    assert.match(messages.at(-1).content, /Did you mean/);
    assert.equal(calls, 0);
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.equal(calls, 1);
    assert.match(messages.at(-1).content, /— test\/reported-model/);
    await saveConfig(directory, { ...config, manual: resolve(root, config.manual), model: "missing/model" });
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.match(messages.at(-1).content, /unavailable/);
    assert.equal(calls, 1);
    // Cancelled setup must not overwrite existing preferences.
    ctx.ui.input = async () => undefined;
    await commands.get("show-reg-config").handler("", ctx);
    assert.equal((await readConfig(directory))?.model, "missing/model");
    await saveConfig(directory, { ...config, manual: resolve(root, config.manual) });
    ctx.scopedModels = [{ model: { provider: "other", id: "scoped" } }];
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.match(messages.at(-1).content, /unavailable/);
    assert.equal(calls, 1);
    ctx.scopedModels = [];
    ctx.modelRegistry.complete = async () => ({ stopReason: "length", content: [{ type: "text", text: "Incomplete answer" }] });
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.match(messages.at(-1).content, /truncated/);
    assert.doesNotMatch(messages.at(-1).content, /Incomplete answer/);
    let requestStarted!: () => void;
    const started = new Promise<void>((done) => { requestStarted = done; });
    ctx.modelRegistry.complete = async (_model: unknown, _context: unknown, options: any) => {
      requestStarted();
      return new Promise((_accept, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    };
    const pending = commands.get("show-reg").handler("MCG_C1", ctx);
    await started;
    await commands.get("show-reg").handler("cancel", ctx);
    await pending;
    assert.match(messages.at(-1).content, /cancelled/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
