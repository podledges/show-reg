import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { TURN_INSTRUCTIONS, OUTPUT_RULES } from "./core.ts";

const pkg = process.env.PI_PACKAGE_PATH ?? dirname(dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent")));
const { SessionManager } = await import(pathToFileURL(join(pkg, "dist/index.js")).href);
const { loadExtensions } = await import(pathToFileURL(join(pkg, "dist/core/extensions/loader.js")).href);
const { ExtensionRunner } = await import(pathToFileURL(join(pkg, "dist/core/extensions/runner.js")).href);

test("installed Pi runner preserves chained turn-local guidance without context messages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "show-reg-runner-"));
  try {
    const loaded = await loadExtensions([resolve(import.meta.dirname, "index.ts")], cwd);
    assert.deepEqual(loaded.errors, []);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), {});
    const errors: unknown[] = [];
    runner.onError((error: unknown) => errors.push(error));
    const base = "Pi base instructions\nInstructions supplied by another extension.";
    for (const [prompt, hit] of [
      ["ordinary register question", false], ["Please use SHOW-REG.", true],
      ["next unrelated turn", false], ["Try /show-reg TEST_CTRL", true],
      ["please use show-reg-config", true], ["Try /SHOW-REG-CONFIG.", true],
      ["Inspect show-reg/core.ts", false], ["Inspect /show-reg-config/example", false],
      ["show-registry /show-reg-extra //show-reg PERIPH->REG", false],
    ] as const) {
      const result = await runner.emitBeforeAgentStart(prompt, undefined, { cwd, forceSystemPrompt: base });
      const effective = result.systemPromptOptions.forceSystemPrompt;
      assert.equal(effective, hit ? `${base}\n\n${TURN_INSTRUCTIONS}` : base, prompt);
      assert.deepEqual(result.messages, []);
      assert.ok(!effective.includes(OUTPUT_RULES));
      if (hit) {
        const repeated = await runner.emitBeforeAgentStart(prompt, undefined, result.systemPromptOptions);
        assert.equal(repeated.systemPromptOptions.forceSystemPrompt, effective);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
