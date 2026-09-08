import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TURN_INSTRUCTIONS, OUTPUT_RULES } from "./core.ts";

// Development-only protocol evidence through Pi's installed-package consumer and runner.
// Set PI_PACKAGE_PATH and SHOW_REG_ISOLATED_AGENT to an isolated installed agent home.
test("installed package emits turn-local prompts through Pi's runner", async (t) => {
  const pkg = process.env.PI_PACKAGE_PATH;
  const agentDir = process.env.SHOW_REG_ISOLATED_AGENT;
  if (!pkg || !agentDir) { t.skip("Requires PI_PACKAGE_PATH and SHOW_REG_ISOLATED_AGENT"); return; }
  const { DefaultResourceLoader, SessionManager } = await import(pathToFileURL(resolve(pkg, "dist/index.js")).href);
  const { ExtensionRunner } = await import(pathToFileURL(resolve(pkg, "dist/core/extensions/runner.js")).href);
  const cwd = process.cwd();
  const loader = new DefaultResourceLoader({ cwd, agentDir, noContextFiles: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.deepEqual(loader.getSkills().skills, []);
  const extension = loaded.extensions[0];
  assert.deepEqual([...extension.commands.keys()].sort(), ["show-reg", "show-reg-config"]);
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), {});
  const errors: unknown[] = [];
  runner.onError((error: unknown) => errors.push(error));
  const base = "Pi base instructions\n\nInstructions already supplied by another extension.";
  const transcript: unknown[] = [];
  for (const [prompt, hit] of [
    ["ordinary register question", false],
    ["Please use SHOW-REG for this register.", true],
    ["next unrelated turn", false],
    ["Try /show-reg MCG->C1", true],
    ["please use show-reg-config", true],
    ["Try /SHOW-REG-CONFIG.", true],
    ["Inspect show-reg/core.ts", false],
    ["Inspect show-reg-config/example", false],
    ["Inspect /show-reg/core.ts", false],
    ["Inspect /show-reg-config/example", false],
    ["show-registry /show-reg-extra //show-reg PERIPH->REG", false],
    ["showreg show_reg myshow-reg show-reg-configure", false],
  ] as const) {
    const result = await runner.emitBeforeAgentStart(prompt, undefined, base, { cwd });
    assert.equal(result?.systemPrompt, hit ? `${base}\n\n${TURN_INSTRUCTIONS}` : undefined, prompt);
    assert.equal(result?.messages, undefined);
    assert.ok(!result?.systemPrompt?.includes(OUTPUT_RULES));
    transcript.push({ prompt, hookResult: result ?? null, effectiveSystemPrompt: result?.systemPrompt ?? base });
    if (hit) {
      const repeated = await runner.emitBeforeAgentStart(prompt, undefined, result.systemPrompt, { cwd });
      assert.equal(repeated.systemPrompt, result.systemPrompt);
      transcript.push({ repeatedHandling: prompt, hookResult: repeated });
    }
  }
  assert.deepEqual(errors, []);
  const messages: unknown[] = [];
  loaded.runtime.sendMessage = (message: unknown) => messages.push(message);
  const ctx = { cwd, hasUI: false, ui: { setStatus() {}, notify() {} } };
  await extension.commands.get("show-reg-config").handler("show", ctx);
  await extension.commands.get("show-reg").handler("MCG->C1", ctx);
  assert.equal(messages.length, 2);
  assert.match((messages[0] as any).content, /Not configured\. Run \/show-reg-config/);
  assert.match((messages[1] as any).content, /Run \/show-reg-config before the first lookup/);
  transcript.push({ commandMessages: messages });
  if (process.env.SHOW_REG_EVIDENCE_PATH) {
    await writeFile(process.env.SHOW_REG_EVIDENCE_PATH, JSON.stringify({
      interface: "Actual Pi installed-package discovery, ExtensionRunner before_agent_start results, and command messages; no live model calls",
      commands: [...extension.commands.keys()], skills: loader.getSkills().skills, transcript,
    }, null, 2) + "\n");
  }
});
