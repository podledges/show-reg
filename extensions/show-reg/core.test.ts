import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { gzipSync, gunzipSync } from "node:zlib";
import { type Config, OUTPUT_RULES, TURN_INSTRUCTIONS, canonicalDevice, cleanFilePath, createManualLoader, defaultManualFolders, deviceFromPath, devicesFromText, discoverHints, discoverManuals, expandHome, indexManual, listPdfFiles, lookup, matchesShowRegTrigger, mergeHints, normalizeFieldBreaks, parseDotEnv, rankManuals, readConfig, resolveDeviceProfile, runText, saveConfig, showRegSystemPrompt, sourceExcerpt, storeManualPath, validateConfig, validateManualForDevice } from "./core.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config: Config = { version: 2, device: { profile: "mcxc444-cg2271" }, manual: "manual.pdf", pdftotext: "pdftotext", model: "current", thinking: "medium", preference: "accuracy" };
const fixtureConfig: Config = { ...config, device: { profile: "custom", label: "Synthetic MCU", target: "SYNTH1", aliases: [], manualHints: [], sourceLinks: [], evidence: ["Synthetic Manual"], identityRegisters: ["MCG_C1"] } };
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

const fixture = `Synthetic Manual
Contents
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
    assert.equal(storeManualPath(directory, "datasheets/chip.pdf"), join("datasheets", "chip.pdf"));
    const found = await discoverManuals(directory);
    assert.ok(found.some((p) => p.startsWith(directory) && basename(p) === "chip.pdf"));
    await mkdir(join(directory, "docs"));
    await writeFile(join(directory, "docs", "MCX-C44X-RM.pdf"), "%PDF");
    await mkdir(join(directory, "node_modules", "other"), { recursive: true });
    await writeFile(join(directory, "node_modules", "other", "secret.pdf"), "%PDF");
    const broader = await discoverManuals(directory);
    assert.ok(broader.some((p) => basename(p) === "MCX-C44X-RM.pdf"));
    assert.ok(!broader.some((p) => p.toLowerCase().includes("node_modules")));
    assert.ok(defaultManualFolders(directory).every((p) => p.startsWith(directory)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("saved project-relative manual beats production profile filename scores", async () => {
  const directory = await mkdtemp(join(tmpdir(), "show-reg-priority-"));
  try {
    await mkdir(join(directory, "datasheets"));
    const current = "datasheets/chosen.pdf";
    await writeFile(join(directory, current), "%PDF");
    await writeFile(join(directory, "datasheets/MCX-C44X-Sub-Family-Reference-Manual.pdf"), "%PDF");
    const files = await discoverManuals(directory, current);
    assert.equal(rankManuals(files, "MCXC444", current, resolveDeviceProfile({ profile: "mcxc444-cg2271" }), directory)[0], join(directory, current));
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
  const local = { ...fixtureConfig, manual: pdf };
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

    await writeFile(join(directory, ".pi", "show-reg-cache", files[0]), "corrupt");
    await createManualLoader(extract)(directory, local);
    assert.equal(extractions, 2);

    await writeFile(pdf, "%PDF changed");
    const future = new Date(Date.now() + 2_000);
    await utimes(pdf, future, future);
    await createManualLoader(extract)(directory, local);
    assert.equal(extractions, 3);
    const cacheFile = join(directory, ".pi", "show-reg-cache", files[0]);
    const cache = JSON.parse(gunzipSync(await readFile(cacheFile)).toString());
    assert.equal(cache.version, 3);
    // Even otherwise matching v2 cache data must be reindexed after the caption fix.
    await writeFile(cacheFile, gzipSync(JSON.stringify({ ...cache, version: 2 })));
    await createManualLoader(extract)(directory, local);
    assert.equal(extractions, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("device identity is enforced on cold, disk and warm cache paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "show-reg-identity-"));
  const pdf = join(directory, "manual.pdf");
  const local = { ...fixtureConfig, manual: pdf };
  try {
    await writeFile(pdf, "%PDF synthetic");
    const load = createManualLoader(async () => fixture);
    const manual = await load(directory, local);
    assert.equal(validateManualForDevice(manual, local.device).profile, "custom");
    const wrong = { ...local, device: { ...local.device, evidence: ["Different Device"] } } as Config;
    await assert.rejects(load(directory, wrong), /Manual\/profile mismatch/);
    await assert.rejects(createManualLoader(async () => { throw new Error("must use disk cache"); })(directory, wrong), /Manual\/profile mismatch/);
    await assert.rejects(createManualLoader(async () => fixture)(directory, { ...local, device: { profile: "esp32-s3-wroom-1" } }), /preview/);
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
  const caption = indexManual("9.3.1 Synthetic Control Register\n  Table 9-3. Invented assignments\n  Bit Name\n  0 Enable");
  assert.equal(lookup(caption.registers, "Synthetic Control Register").exact?.page, 1);
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
    const migrated = validateConfig({ version: 1, target: "MCXC444", manual: "manual.pdf", pdftotext: "pdftotext", model: "current", preference: "accuracy" });
    assert.equal(migrated.device.profile, "mcxc444-cg2271");
    assert.equal(migrated.thinking, "auto");
    assert.throws(() => validateConfig({ version: 1, target: "UNKNOWN123", manual: "manual.pdf", pdftotext: "pdftotext", model: "current", preference: "accuracy" }), /unknown device/);
    assert.throws(() => validateConfig({ ...config, version: 3 }));
    assert.throws(() => validateConfig({ ...config, device: { profile: "not-real" } }), /Unknown device profile/);
    assert.throws(() => validateConfig({ ...config, manual: "" }));
    assert.throws(() => validateConfig({ ...config, device: { profile: "custom", label: "x", target: "x", aliases: [], manualHints: [], sourceLinks: [], evidence: [], identityRegisters: [] } }));
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

function piPackage(): string | undefined {
  if (process.env.PI_PACKAGE_PATH) return process.env.PI_PACKAGE_PATH;
  try { return dirname(dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent"))); } catch {}
  const global = process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules/@earendil-works/pi-coding-agent");
  return global && existsSync(global) ? global : undefined;
}

test("Pi extension loads and preserves the turn gate", async () => {
  const packagePath = piPackage();
  assert.ok(packagePath, "Set PI_PACKAGE_PATH to the installed Pi package; loader coverage is required.");
  const { loadExtensions } = await import(pathToFileURL(join(packagePath, "dist/core/extensions/loader.js")).href);
  const loaded = await loadExtensions([join(root, "extensions/show-reg/index.ts")], root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const commands = extension.commands;
  const tools = extension.tools;
  assert.deepEqual([...commands.keys()].sort(), ["show-reg", "show-reg-config"]);
  assert.deepEqual([...tools.keys()].sort(), ["show_register", "show_register_setup"]);
  assert.ok(!commands.has("show-me") && !commands.has("show-me-config"));
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
  // Command/tool payloads use mandatory synthetic-PDF coverage in privacy.test.ts.
});
