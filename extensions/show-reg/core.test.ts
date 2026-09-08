import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
<<<<<<< HEAD
import { type Config, OUTPUT_RULES, TURN_INSTRUCTIONS, cleanFilePath, createManualLoader, indexManual, lookup, matchesShowRegTrigger, readConfig, runText, saveConfig, showRegSystemPrompt, sourceExcerpt, validateConfig } from "./core.ts";
=======
import { type Config, OUTPUT_RULES, canonicalDevice, cleanFilePath, createManualLoader, defaultManualFolders, deviceFromPath, devicesFromText, discoverHints, discoverManuals, expandHome, indexManual, listPdfFiles, lookup, mergeHints, normalizeFieldBreaks, parseDotEnv, rankManuals, readConfig, runText, saveConfig, sourceExcerpt, storeManualPath, validateConfig } from "./core.ts";
>>>>>>> 18f2e4e (Add skill-driven register lookup and persistent cache)

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config: Config = { version: 1, target: "MCXC444", manual: process.env.SHOW_REG_TEST_MANUAL ?? "manual.pdf", pdftotext: "pdftotext", model: "current", preference: "accuracy" };
test("turn gate matches only explicit show-reg names", () => {
  for (const prompt of [
    "show-reg", "/show-reg MCG->C1", "please use show-reg-config", "Try (SHOW-REG).",
    "/show-reg-config", "Try /SHOW-REG-CONFIG.",
  ]) assert.equal(matchesShowRegTrigger(prompt), true, prompt);

  for (const prompt of [
    "showreg", "show_reg", "myshow-reg", "show-registry", "show-reg-configure",
    "/show-reg-extra", "//show-reg", "PERIPH->REG", "ordinary register question",
  ]) assert.equal(matchesShowRegTrigger(prompt), false, prompt);
});

test("turn gate rejects trailing slash path continuations without guidance", () => {
  for (const prompt of [
    "Inspect show-reg/core.ts", "Inspect show-reg-config/example",
    "Inspect /show-reg/core.ts", "Inspect /show-reg-config/example",
  ]) {
    assert.equal(matchesShowRegTrigger(prompt), false, prompt);
    assert.equal(showRegSystemPrompt(prompt, "Original system prompt"), undefined, prompt);
  }
});

test("turn gate preserves the base prompt, isolates output rules, and never accumulates", () => {
  const base = "Original system prompt\nwith configured instructions.";
  assert.equal(showRegSystemPrompt("unrelated turn", base), undefined);
  const hit = showRegSystemPrompt("Use show-reg for this", base);
  assert.equal(hit, `${base}\n\n${TURN_INSTRUCTIONS}`);
  assert.ok(TURN_INSTRUCTIONS.length < 400);
  assert.equal(hit?.split(TURN_INSTRUCTIONS).length, 2);
  assert.equal(showRegSystemPrompt("Use /show-reg again", hit!), hit);
  assert.equal(showRegSystemPrompt("next unrelated turn", base), undefined);
  assert.doesNotMatch(TURN_INSTRUCTIONS, new RegExp(OUTPUT_RULES.slice(0, 40), "i"));
});

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

test("output rules name fields and keep the first encoding on the header line", () => {
  assert.match(OUTPUT_RULES, /EREFS0 \(BIT 2\):/);
  assert.match(OUTPUT_RULES, /RANGE0 \(BIT 5:4\):/);
  assert.match(OUTPUT_RULES, /<br>/);
  assert.match(OUTPUT_RULES, /same line as the header/);
  const single = normalizeFieldBreaks("EREFS0 (BIT 2):   - 0 = external clock input; <br>\n                            - 1 = crystal oscillator.");
  const [erefsHeader, erefsCont] = single.split("\n");
  assert.equal(erefsCont.indexOf("- "), erefsHeader.replace(/ {2}$/, "").indexOf("- "));
  const multi = normalizeFieldBreaks([
    "RANGE0 (BIT 5:4):  - 00 = low <br>",
    "        - 01 = high <br>",
    "- 10 = very-high oscillator frequency range <br>",
    "                                - 11 = very-high oscillator frequency range",
  ].join("\n"));
  const rangeLines = multi.split("\n");
  const column = rangeLines[0].replace(/ {2}$/, "").indexOf("- ");
  assert.ok(column >= 0);
  for (const line of rangeLines) assert.equal(line.replace(/ {2}$/, "").indexOf("- "), column);
  const two = normalizeFieldBreaks("EREFS0 (BIT 2): - 0 = external clock input; <br>\n                - 1 = crystal oscillator.\nRANGE0 (BIT 5:4): - 00 = low <br>\n                 - 01 = high");
  assert.match(two, /crystal oscillator\.\n\nRANGE0/);
  assert.doesNotMatch(two, /crystal oscillator\.\n\n\nRANGE0/);
  assert.equal(normalizeFieldBreaks("Notes:\n- not a field"), "Notes:\n- not a field");
});

test("PDF discovery expands ~ and lists manuals from datasheets folders", async () => {
  assert.equal(expandHome("~"), homedir());
  assert.equal(expandHome("~/chip.pdf"), join(homedir(), "chip.pdf"));
  const directory = await mkdtemp(join(tmpdir(), "show-reg-pdfs-"));
  try {
    await mkdir(join(directory, "datasheets"));
    await writeFile(join(directory, "datasheets", "chip.pdf"), "%PDF");
    await writeFile(join(directory, "datasheets", "notes.txt"), "x");
    const pdfs = await listPdfFiles(join(directory, "datasheets"));
    assert.equal(pdfs.length, 1);
    assert.equal(basename(pdfs[0]), "chip.pdf");
    assert.equal(storeManualPath(directory, pdfs[0]), join("datasheets", "chip.pdf"));
    const found = await discoverManuals(directory);
    assert.ok(found.some((p) => p.startsWith(directory) && basename(p) === "chip.pdf"));
    await mkdir(join(directory, "docs"));
    await writeFile(join(directory, "docs", "MCX-C44X-RM.pdf"), "%PDF");
    await mkdir(join(directory, "node_modules", "other"), { recursive: true });
    await writeFile(join(directory, "node_modules", "other", "secret.pdf"), "%PDF");
    const broader = await discoverManuals(directory);
    assert.ok(broader.some((p) => basename(p) === "MCX-C44X-RM.pdf"));
    assert.ok(!broader.some((p) => p.toLowerCase().includes("node_modules")));
    assert.ok(defaultManualFolders(directory).some((p) => /CG2271-Labs[/\\]datasheets$/i.test(p)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("autofill reads env, project files and datasheets independently", async () => {
  assert.equal(canonicalDevice("frdm-mcxc444"), "MCXC444");
  assert.equal(canonicalDevice("MCX-C44X"), "MCXC444");
  assert.equal(deviceFromPath("docs/MCX-C44X-RM.pdf"), "MCXC444");
  assert.deepEqual(devicesFromText('set(MCU MCXC444)\nMCU = MK64FN1M0\n-DCPU_STM32F407xx\n#include "RP2040.h"'), ["MCXC444", "MK64FN1M0", "STM32F407XX", "RP2040"]);
  assert.equal(parseDotEnv('MCU=MCXC444\n# ignore\nSECRET=nope\nDEVICE="nRF52840"\n').MCU, "MCXC444");
  assert.equal(mergeHints([{ value: "MCXC444", source: "env MCU" }, { value: "mcxc444", source: "CMakeLists.txt" }])[0].source, "env MCU, CMakeLists.txt");
  assert.equal(basename(rankManuals(["FRDM-MCXC444-Schematic.pdf", "FRDM-MCXC444 Board User Manual.pdf", "MCX-C44X-Sub-Family-Reference-Manual.pdf"], "MCXC444")[0]), "MCX-C44X-Sub-Family-Reference-Manual.pdf");

  const directory = await mkdtemp(join(tmpdir(), "show-reg-hints-"));
  try {
    await mkdir(join(directory, "docs"));
    await writeFile(join(directory, "CMakeLists.txt"), "set(MCU MCXC444)\n");
    await writeFile(join(directory, "docs", "MCX-C44X-RM.pdf"), "%PDF");
    await writeFile(join(directory, ".env"), "MCU=nRF52840\nSHOW_REG_MANUAL=docs/MCX-C44X-RM.pdf\nAPI_KEY=secret\n");
    await writeFile(join(directory, "broken.cmake"), "set(MCU");
    await mkdir(join(directory, "unreadable-dir"));

    const denied = await discoverHints(directory, { allowEnv: false, env: { MCU: "STM32F407" } });
    assert.equal(denied.targets[0]?.value, "MCXC444");
    assert.ok(!denied.targets.some((hint) => hint.value === "STM32F407" || hint.value === "NRF52840"));
    assert.ok(denied.manuals.every((hint) => hint.source !== "env SHOW_REG_MANUAL"));
    assert.ok(denied.pdftotext.length >= 1);

    const allowed = await discoverHints(directory, {
      allowEnv: true,
      current: { target: "MCXC444", pdftotext: "pdftotext" },
      env: { MCU: "STM32F407", SHOW_REG_TARGET: "MCXC444" },
    });
    assert.equal(allowed.targets[0]?.value, "MCXC444");
    assert.ok(allowed.targets.some((hint) => hint.value === "STM32F407"));
    assert.ok(allowed.targets.some((hint) => hint.value === "NRF52840"));
    assert.ok(allowed.manuals.some((hint) => hint.value.replaceAll("\\", "/").endsWith("docs/MCX-C44X-RM.pdf")));
    assert.ok(!JSON.stringify(allowed).includes("secret"));

    await rm(join(directory, "CMakeLists.txt"));
    const fromPdf = await discoverHints(directory, { allowEnv: false, env: { MCU: "should-not-appear" } });
    assert.ok(fromPdf.targets.some((hint) => hint.value === "MCXC444"));
    assert.ok(!fromPdf.targets.some((hint) => /shouldnotappear/i.test(hint.value)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("PDF paths accept Explorer quotes and report invalid files clearly", async () => {
  assert.equal(cleanFilePath('  "C:\\My Documents\\chip.pdf"  '), "C:\\My Documents\\chip.pdf");
  assert.equal(cleanFilePath("'datasheets/chip.pdf'"), "datasheets/chip.pdf");
  assert.equal(cleanFilePath("datasheets/chip.pdf"), "datasheets/chip.pdf");
  const load = createManualLoader();
  await assert.rejects(load(root, { ...config, manual: "no-such-datasheet.pdf" }), /Cannot access PDF/);
  await assert.rejects(load(root, { ...config, manual: "." }), /not a directory/);
});

test("manual cache survives extension reload and invalidates with the PDF", async () => {
  const directory = await mkdtemp(join(tmpdir(), "show-reg-cache-"));
  const pdf = join(directory, "manual.pdf");
  const local = { ...config, manual: pdf };
  let extractions = 0;
  const extract = async () => { extractions++; return fixture; };
  try {
    await writeFile(pdf, "%PDF first");
    const first = await createManualLoader(extract)(directory, local);
    assert.equal(first.registers.length, 3);
    assert.equal(extractions, 1);
    const files = await readdir(join(directory, ".pi", "show-reg-cache"));
    assert.equal(files.length, 1);
    assert.match(files[0], /\.json\.gz$/);

    const second = await createManualLoader(async () => { throw new Error("disk cache missed"); })(directory, local);
    assert.equal(second.registers.length, 3);
    assert.equal(extractions, 1);

    await writeFile(pdf, "%PDF changed");
    const future = new Date(Date.now() + 2_000);
    await utimes(pdf, future, future);
    await createManualLoader(extract)(directory, local);
    assert.equal(extractions, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
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
<<<<<<< HEAD
  const extension = loaded.extensions[0];
  const commands = extension.commands;
  assert.deepEqual([...commands.keys()].sort(), ["show-reg", "show-reg-config"]);
  const gate = extension.handlers.get("before_agent_start");
  assert.equal(gate?.length, 1);
  const basePrompt = "Pi base prompt";
  const miss = await gate![0]({ type: "before_agent_start", prompt: "unrelated", images: undefined,
    systemPrompt: basePrompt, systemPromptOptions: { cwd: root } }, {} as any);
  assert.equal(miss, undefined);
  const hit = await gate![0]({ type: "before_agent_start", prompt: "please use show-reg", images: undefined,
    systemPrompt: basePrompt, systemPromptOptions: { cwd: root } }, {} as any);
  assert.deepEqual(hit, { systemPrompt: `${basePrompt}\n\n${TURN_INSTRUCTIONS}` });
  assert.doesNotMatch(hit!.systemPrompt!, /Explain the requested MCU register using ONLY/);
=======
  const commands = loaded.extensions[0].commands;
  const tools = loaded.extensions[0].tools;
  assert.deepEqual([...commands.keys()].sort(), ["show-reg", "show-reg-config"]);
  assert.deepEqual([...tools.keys()], ["show_register"]);
  assert.ok(!commands.has("show-me") && !commands.has("show-me-config"));
>>>>>>> 18f2e4e (Add skill-driven register lookup and persistent cache)
  if (!process.env.SHOW_REG_TEST_MANUAL) { t.diagnostic("Pi command loading passed; set SHOW_REG_TEST_MANUAL to also exercise real-PDF model mocks."); return; }
  const directory = await mkdtemp(join(tmpdir(), "show-reg-command-"));
  const messages: any[] = [];
  // Runtime message injection is replaced; no provider or active Pi session is used.
  loaded.runtime.sendMessage = (message: unknown) => messages.push(message);
  let calls = 0;
  const model = { provider: "test", id: "chosen", input: ["text"], contextWindow: 128000, maxTokens: 8192, cost: { input: 1, output: 1 } };
  const ctx: any = { cwd: directory, scopedModels: [], model, hasUI: true,
    ui: { setStatus() {}, notify() {}, confirm: async () => true, select: async () => undefined, input: async () => undefined },
    modelRegistry: { getAvailable: () => [model], complete: async (chosen: unknown, context: any) => {
      calls++;
      assert.equal(chosen, model);
      assert.equal(context.messages.length, 1);
      assert.equal(context.systemPrompt, OUTPUT_RULES);
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
    assert.equal((await readConfig(directory))?.target, "MCXC444");
    assert.match(messages.at(-1).content, /— test\/reported-model/);
    assert.equal(calls, 1);
    await commands.get("show-reg").handler("MCG_C9", ctx);
    assert.match(messages.at(-1).content, /Did you mean/);
    assert.equal(calls, 1);
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.equal(calls, 2);
    assert.match(messages.at(-1).content, /— test\/reported-model/);
    assert.ok(commands.get("show-reg").getArgumentCompletions("MCG_C").some((item: any) => item.value === "MCG_C1"));
    const toolResult = await tools.get("show_register").definition.execute("test-call", { register: "MCG_C1" }, undefined, undefined, ctx);
    assert.equal(calls, 3);
    assert.match(toolResult.content[0].text, /Register answer/);
    assert.match(toolResult.content[0].text, /— test\/reported-model/);
    await saveConfig(directory, { ...config, manual: resolve(root, config.manual), model: "missing/model" });
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.match(messages.at(-1).content, /unavailable/);
    assert.equal(calls, 3);
    // Cancelled setup must not overwrite existing preferences.
    ctx.ui.input = async () => undefined;
    await commands.get("show-reg-config").handler("", ctx);
    assert.equal((await readConfig(directory))?.model, "missing/model");
    await saveConfig(directory, { ...config, manual: resolve(root, config.manual) });
    ctx.scopedModels = [{ model: { provider: "other", id: "scoped" } }];
    await commands.get("show-reg").handler("MCG_C1", ctx);
    assert.match(messages.at(-1).content, /unavailable/);
    assert.equal(calls, 3);
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
