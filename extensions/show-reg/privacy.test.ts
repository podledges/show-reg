import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readConfig, saveConfig, type Config } from "./core.ts";

const packagePath = process.env.PI_PACKAGE_PATH ?? dirname(dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent")));
const { loadExtensions } = await import(pathToFileURL(join(packagePath, "dist/core/extensions/loader.js")).href);
const { convertToLlm } = await import(pathToFileURL(join(packagePath, "dist/core/messages.js")).href);
const aiPath = [join(packagePath, "node_modules/@earendil-works/pi-ai/dist/index.js"), join(packagePath, "../pi-ai/dist/index.js")].find(existsSync);
assert.ok(aiPath, "Installed Pi must provide pi-ai");
const { createModels, createAssistantMessageEventStream } = await import(pathToFileURL(aiPath).href);
const root = resolve(import.meta.dirname, "../..");
const config: Config = { version: 2, device: { profile: "custom", label: "Synthetic MCU", target: "SYNTH1", aliases: [], manualHints: [], sourceLinks: [], evidence: ["Synthetic Manual"], identityRegisters: ["TEST_CTRL"] }, manual: "datasheets/manual.pdf", pdftotext: "pdftotext", model: "current", thinking: "medium", preference: "accuracy" };

// Entirely invented public fixture, including adjacent content on the same page.
function syntheticPdf(): string {
  const lines = ["Synthetic Manual", "UNREQUESTED_PAGE_PREFIX", "1.1 Test Control Register (TEST_CTRL)", "Address: 0", "TEST_CTRL field descriptions", "SYNTHETIC_LOCAL_MARKER enable flag", "1.2 Test Status Register (TEST_STATUS)", "Address: 1", "TEST_STATUS field descriptions", "UNREQUESTED_ADJACENT_MARKER"];
  const stream = `BT /F1 12 Tf 50 750 Td 18 TL ${lines.map((line, i) => `${i ? "T* " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  return pdf + `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), "show-reg-privacy-"));
  await mkdir(join(cwd, "datasheets"));
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "datasheets/manual.pdf"), syntheticPdf());
  await saveConfig(cwd, config);
  const loaded = await loadExtensions([join(root, "extensions/show-reg/index.ts")], cwd);
  assert.deepEqual(loaded.errors, []);
  const transcript: any[] = [];
  const displays: string[] = [];
  loaded.runtime.sendMessage = (message: any) => transcript.push({ role: "custom", ...message, timestamp: 1 });
  const model = { provider: "test", id: "chosen", input: ["text", "image"], reasoning: true, contextWindow: 128000, maxTokens: 8192, cost: { input: 1, output: 1 } };
  const requests: any[] = [];
  let respond = async (_options: any): Promise<any> => ({ stopReason: "stop", provider: "test", model: "chosen", content: [{ type: "text", text: "Synthetic explanation" }] });
  const runtime = createModels();
  runtime.setProvider({ id: "test", name: "Offline mock", auth: { apiKey: { name: "Synthetic key", resolve: async () => ({ auth: { apiKey: "mock-key" } }) } }, getModels: () => [model],
    streamSimple(chosen: unknown, context: any, options: any) {
      assert.equal(chosen, model);
      assert.equal(options.apiKey, "mock-key");
      assert.equal(options.cacheRetention, "none");
      requests.push({ context, options });
      const stream = createAssistantMessageEventStream();
      void respond(options).then((message) => { stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message); }, (error) => {
        const message = { role: "assistant", stopReason: "aborted", content: [], errorMessage: String(error) };
        stream.push({ type: "error", reason: "aborted", error: message }); stream.end(message);
      });
      return stream;
    }, stream() { throw new Error("Unexpected non-simple request"); },
  });
  const ctx: any = { cwd: join(cwd, "src"), mode: "tui", hasUI: true, scopedModels: [], model,
    ui: { notify: (text: string) => displays.push(text), setStatus() {}, confirm: async () => true, select: async () => undefined, input: async () => undefined },
    modelRegistry: { getAvailable: () => [model], streamSimple: runtime.streamSimple.bind(runtime) } };
  const extension = loaded.extensions[0];
  const command = (name: string, args: string) => extension.commands.get(name).handler(args, ctx);
  const tool = async (name: string, params: any) => {
    const result = await extension.tools.get(name).definition.execute("test", params, undefined, undefined, ctx);
    transcript.push({ role: "toolResult", toolCallId: "test", toolName: name, ...result, timestamp: 1 });
    return result;
  };
  return { cwd, ctx, transcript, displays, requests, command, tool, completions: extension.commands.get("show-reg").getArgumentCompletions, respond: (fn: typeof respond) => { respond = fn; }, cleanup: () => rm(cwd, { recursive: true, force: true }) };
}

test("settings display stays out of actual Pi subsequent context", async () => {
  const h = await harness();
  try {
    await h.command("show-reg-config", "show");
    const next = { role: "user", content: "Unrelated question", timestamp: 2 };
    assert.deepEqual(convertToLlm([...h.transcript, next]), [next]);
    assert.match(h.displays.at(-1)!, /Saved in/);
  } finally { await h.cleanup(); }
});

test("local command and tools exclude source, settings and errors; explanation is opt-in bounded text", async () => {
  const h = await harness();
  try {
    await h.command("show-reg", "TEST_CTRL");
    assert.equal(h.requests.length, 0);
    assert.match(h.displays.at(-1)!, /SYNTHETIC_LOCAL_MARKER/);
    await h.tool("show_register", { register: "TEST_CTRL" });
    await h.tool("show_register_setup", {});
    assert.match(h.displays.at(-1)!, /Validated recommended answers/);
    await h.command("show-reg", "TEST_CTRX");
    assert.match(h.displays.at(-1)!, /Did you mean/);
    await h.command("show-reg", "show");
    await h.command("show-reg", "explain TEST_CTRL");
    assert.equal(h.requests.length, 1, h.displays.at(-1));
    const { context } = h.requests[0];
    assert.equal(context.messages[0].role, "system", "Installed Pi normalizes helper instructions");
    assert.deepEqual(context.messages[1].content.map((p: any) => p.type), ["text"]);
    const payload = JSON.parse(context.messages[1].content[0].text);
    assert.equal(payload.document, "manual.pdf");
    assert.match(payload.source, /SYNTHETIC_LOCAL_MARKER/);
    assert.doesNotMatch(JSON.stringify(context), /UNREQUESTED_|datasheets\/|show-reg-privacy-/);
    assert.match(context.messages[0].content, /supplied bounded register text/);
    assert.match(h.displays.at(-1)!, /Synthetic explanation/);
    await saveConfig(h.cwd, { ...config, device: { ...config.device, evidence: ["MISSING_IDENTITY"] } } as Config);
    await h.tool("show_register", { register: "TEST_CTRL" });
    assert.match(h.displays.at(-1)!, /Manual\/profile mismatch.*Observed:.*Synthetic Manual/);
    await h.tool("show_register_setup", {});
    await saveConfig(h.cwd, { ...config, pdftotext: "show-reg-no-such-extractor" });
    await h.tool("show_register", { register: "TEST_CTRL" });
    assert.match(h.displays.at(-1)!, /PDF extraction failed \(ENOENT\)/);
    await h.command("show-reg", "explain TEST_CTRL");
    assert.match(h.displays.at(-1)!, /PDF extraction failed \(ENOENT\)/);
    const contextText = JSON.stringify(convertToLlm([...h.transcript, { role: "user", content: "Unrelated next turn", timestamp: 2 }]));
    assert.doesNotMatch(contextText, /SYNTHETIC_LOCAL_MARKER|Synthetic Manual|TEST_CTRL|manual.pdf|MISSING_IDENTITY|ENOENT|datasheets|Observed:/);
    assert.equal(h.requests.length, 1);
    assert.ok(h.completions("exp").some((item: any) => item.value === "explain"));
    assert.ok(h.completions("TEST_C").some((item: any) => item.value === "TEST_CTRL"));
  } finally { await h.cleanup(); }
});

test("explanation preserves model scope, thinking checks, failures and cancellation", async () => {
  const h = await harness();
  try {
    for (const change of [{ thinking: "max" }, { model: "missing/model" }]) {
      await saveConfig(h.cwd, { ...config, ...change } as Config);
      await h.command("show-reg", "explain TEST_CTRL");
      assert.match(h.displays.at(-1)!, /does not support|unavailable/);
      assert.equal(h.requests.length, 0);
      await h.command("show-reg", "TEST_CTRL");
      assert.match(h.displays.at(-1)!, /SYNTHETIC_LOCAL_MARKER/);
    }
    await saveConfig(h.cwd, config);
    h.ctx.scopedModels = [{ model: { provider: "other", id: "scoped" } }];
    await h.command("show-reg", "explain TEST_CTRL");
    assert.match(h.displays.at(-1)!, /unavailable/);
    assert.equal(h.requests.length, 0);
    h.ctx.scopedModels = [];
    h.respond(async () => ({ stopReason: "length", content: [{ type: "text", text: "Incomplete answer" }] }));
    await h.command("show-reg", "explain TEST_CTRL");
    assert.match(h.displays.at(-1)!, /truncated/);
    assert.doesNotMatch(h.displays.at(-1)!, /Incomplete answer/);
    h.respond(async () => ({ stopReason: "error", content: [], errorMessage: "PRIVATE_PROVIDER_ERROR" }));
    await h.command("show-reg", "explain TEST_CTRL");
    assert.match(h.displays.at(-1)!, /Model request failed/);
    assert.doesNotMatch(h.displays.at(-1)!, /PRIVATE_PROVIDER_ERROR/);
    let started!: () => void;
    const start = new Promise<void>((done) => { started = done; });
    h.respond((options) => { started(); return new Promise((_accept, reject) => options.signal.addEventListener("abort", () => reject(new Error("synthetic cancellation")), { once: true })); });
    const pending = h.command("show-reg", "explain TEST_CTRL");
    await start;
    await h.command("show-reg", "cancel");
    await pending;
    assert.match(h.displays.at(-1)!, /cancelled/i);
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[0].options.reasoning, "medium");
    assert.deepEqual(convertToLlm(h.transcript), []);
  } finally { await h.cleanup(); }
});

test("configuration saves both recommendation and field-by-field custom profile without leaking", async () => {
  const h = await harness();
  try {
    await h.command("show-reg-config", "");
    assert.match(h.displays.at(-1)!, /Saved the validated recommendation/);
    const saved = await readConfig(h.cwd);
    assert.deepEqual(saved, config);
    h.ctx.ui.confirm = async (title: string) => title.startsWith("Save these");
    h.ctx.ui.select = async (_title: string, choices: string[]) => choices[0];
    h.ctx.ui.input = async (_title: string, initial: string) => initial;
    await h.command("show-reg-config", "");
    assert.match(h.displays.at(-1)!, /Saved personal settings in `\.pi\/show-reg.json`/);
    assert.equal((await readConfig(h.cwd))?.device.profile, "custom");
    assert.equal((await readConfig(h.cwd))?.manual, config.manual);
    h.ctx.ui.confirm = async () => false;
    h.ctx.ui.select = async () => undefined;
    const before = await readConfig(h.cwd);
    await h.command("show-reg-config", "");
    assert.deepEqual(await readConfig(h.cwd), before);
    assert.deepEqual(convertToLlm(h.transcript), []);
    assert.equal(h.requests.length, 0);
  } finally { await h.cleanup(); }
});

test("headless tool entry points fail closed without claiming source display or calling provider", async () => {
  const h = await harness();
  try {
    h.ctx.hasUI = false;
    const result = await h.tool("show_register", { register: "TEST_CTRL" });
    assert.match(result.content[0].text, /failed/);
    const setup = await h.tool("show_register_setup", {});
    assert.match(setup.content[0].text, /requires interactive Pi/);
    await h.command("show-reg", "explain TEST_CTRL");
    assert.equal(h.requests.length, 0);
    assert.doesNotMatch(JSON.stringify(convertToLlm(h.transcript)), /SYNTHETIC_LOCAL_MARKER|datasheets|manual.pdf/);
  } finally { await h.cleanup(); }
});
