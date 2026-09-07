import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { type Config, DEFAULT_MANUAL, OUTPUT_RULES, cleanFilePath, createManualLoader, lookup, readConfig, renderPage, saveConfig, sourceExcerpt, validateConfig } from "./core.ts";

function projectRoot(cwd: string): string {
  let root = resolve(cwd);
  while (true) {
    if (existsSync(join(root, ".git")) || existsSync(join(root, ".pi/show-me.json"))) return root;
    const parent = dirname(root);
    if (parent === root) return resolve(cwd);
    root = parent;
  }
}
function availableModels(ctx: ExtensionCommandContext) {
  const available = ctx.modelRegistry.getAvailable();
  return ctx.scopedModels.length ? available.filter((m) => ctx.scopedModels.some(
    (s) => s.model.provider === m.provider && s.model.id === m.id,
  )) : available;
}

function findPdfText(): string {
  const candidates = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git/mingw64/bin/pdftotext.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs/Git/mingw64/bin/pdftotext.exe"),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? "pdftotext";
}

export default function showMe(pi: ExtensionAPI) {
  const loadManual = createManualLoader();
  let running: AbortController | undefined;
  pi.on("session_shutdown", async () => running?.abort());
  pi.registerMessageRenderer("show-me", (message) => new Markdown(String(message.content), 0, 0, getMarkdownTheme()));
  const show = (text: string, model?: string) => pi.sendMessage({ customType: "show-me", display: true,
    content: `${text}\n\n— ${model ?? "show-me (local lookup; no model called)"}` }, { triggerTurn: false });

  pi.registerCommand("show-me-config", {
    description: "Configure local register lookup and its model; use 'show' to inspect settings",
    handler: async (args, ctx) => {
      try {
        const root = projectRoot(ctx.cwd);
        let old: Config | undefined;
        try { old = await readConfig(root); } catch { ctx.ui.notify("Existing settings are invalid; configuration will replace them.", "warning"); }
        if (args.trim() === "show") {
          show(old ? `Saved in .pi/show-me.json:\n\n\`\`\`json\n${JSON.stringify(old, null, 2)}\n\`\`\`` : "Not configured. Run /show-me-config.");
          return;
        }
        if (args.trim()) throw new Error("Use /show-me-config or /show-me-config show.");
        if (!ctx.hasUI) throw new Error("Configuration requires interactive Pi. Run /show-me-config there first.");
        const models = availableModels(ctx);
        if (!models.length) throw new Error("No authenticated models available in Pi. Configure a provider first.");
        const target = await ctx.ui.input("Target device", old?.target ?? "");
        if (target === undefined) return;
        const manual = await ctx.ui.input("Datasheet / reference manual PDF filepath (absolute or relative to repository root)", old?.manual ?? DEFAULT_MANUAL);
        if (manual === undefined) return;
        const pdftotext = await ctx.ui.input("pdftotext executable (path or command)", old?.pdftotext ?? findPdfText());
        if (pdftotext === undefined) return;
        const preference = await ctx.ui.select("Lookup preference", ["accuracy", "speed", "cost"]);
        if (!preference) return;
        const choices = ["current — use the active chat model", "automatic — cheapest listed text price for cost; current model otherwise",
          ...models.map((m) => `${m.provider}/${m.id}`)];
        const selected = await ctx.ui.select(`Lookup model (previous: ${old?.model ?? "unset"})`, choices);
        if (!selected) return;
        const model = selected.startsWith("current —") ? "current" : selected.startsWith("automatic —") ? "automatic" : selected;
        const config = validateConfig({ version: 1, target: target.trim(), manual: cleanFilePath(manual), pdftotext: cleanFilePath(pdftotext), model, preference });
        ctx.ui.notify("Checking manual and PDF extraction locally…", "info");
        const indexed = await loadManual(root, config);
        if (!await ctx.ui.confirm("Save personal lookup settings?", `${indexed.registers.length} register sections found. Model: ${model}. Preference: ${preference}. Each successful lookup sends only the matched source pages to that provider. Automatic selection is a price heuristic, not a quality or speed benchmark.`)) return;
        await saveConfig(root, config);
        show("Saved personal settings in `.pi/show-me.json`. Keep this file out of Git. Try `/show-me MCG->C1`.");
      } catch (error) { show(`Configuration failed: ${error instanceof Error ? error.message : "Unknown error"}`); }
    },
  });

  pi.registerCommand("show-me", {
    description: "Show a register's bits and encodings: /show-me MCG->C1 (or /show-me cancel)",
    handler: async (args, ctx) => {
      if (args.trim() === "cancel") { running?.abort(); return; }
      if (running) { ctx.ui.notify("A lookup is running. Use /show-me cancel first.", "warning"); return; }
      running = new AbortController();
      const controller = running;
      const timeout = setTimeout(() => controller.abort(), 180_000);
      let modelIdentity: string | undefined;
      try {
        const root = projectRoot(ctx.cwd);
        const config = await readConfig(root);
        if (!config) throw new Error("Run /show-me-config before the first lookup.");
        let query = args.trim();
        if (!query) {
          if (!ctx.hasUI) throw new Error("Provide a register: /show-me <register>.");
          query = (await ctx.ui.input("Register identifier or manual title"))?.trim() ?? "";
          if (!query) return;
        }
        if (query.length > 200) throw new Error("Register query is limited to 200 characters.");
        ctx.ui.setStatus("show-me", "Searching manual locally…");
        const manual = await loadManual(root, config, controller.signal);
        const result = lookup(manual.registers, query);
        if (!result.exact) {
          show(`No unique exact match for ${JSON.stringify(query)}.${result.candidates.length ? "\n\nDid you mean:\n" + result.candidates.map((r) => `- \`${r.id}\` — ${r.title} (PDF p. ${r.page})`).join("\n") : " No plausible indexed candidates found; the manual may use another identifier."}`);
          return;
        }
        const excerpt = sourceExcerpt(manual, result.exact);
        const models = availableModels(ctx);
        let model = models.find((m) => `${m.provider}/${m.id}` === config.model);
        if (config.model === "current" || config.model === "automatic") {
          model = models.find((m) => ctx.model?.provider === m.provider && ctx.model?.id === m.id);
          if (config.model === "automatic" && config.preference === "cost") {
            model = models.filter((m) => m.cost.input > 0 && m.cost.output > 0 && m.contextWindow >= excerpt.length + 8192)
              .sort((a, b) => (a.cost.input * excerpt.length / 4 + a.cost.output * 4096) - (b.cost.input * excerpt.length / 4 + b.cost.output * 4096))[0];
          }
        }
        if (!model) throw new Error("Configured model is unavailable, outside the session scope, or has no usable price estimate. Run /show-me-config; no substitute was called.");
        if (model.contextWindow < excerpt.length + 8192) throw new Error("Selected model's context limit is too small for this section. Choose another model in /show-me-config.");
        if (typeof ctx.modelRegistry.complete !== "function") throw new Error("This extension requires Pi's modelRegistry.complete API (tested with Pi 0.84.1).");
        const images: { type: "image"; data: string; mimeType: string }[] = [];
        if (model.input.includes("image")) {
          try {
            for (let page = result.exact.page; page <= result.exact.endPage; page++) {
              images.push({ type: "image", data: await renderPage(resolve(root, config.manual), page, controller.signal), mimeType: "image/png" });
            }
          } catch {
            if (controller.signal.aborted) throw new Error("Cancelled.");
            images.length = 0;
          }
        }
        const sourceMode = images.length ? "Text and page images, in PDF page order; verify table alignment against images." : "Text only; page images unavailable. Explicitly flag any ambiguous diagram or field alignment.";
        if (!images.length) ctx.ui.notify("Using extracted text only; page images are unavailable for this tool/model.", "warning");
        modelIdentity = `${model.provider}/${model.id} (request attempted)`;
        ctx.ui.setStatus("show-me", `${result.exact.id} → ${modelIdentity}`);
        ctx.ui.notify(`Reading PDF pages ${result.exact.page}–${result.exact.endPage} with ${modelIdentity}`, "info");
        const response = await ctx.modelRegistry.complete(model, {
          systemPrompt: OUTPUT_RULES,
          messages: [{ role: "user", timestamp: Date.now(), content: [{ type: "text", text:
            JSON.stringify({ target: config.target, query, register: result.exact, document: config.manual, sourceMode, source: excerpt }) }, ...images] }],
        }, { signal: controller.signal, maxTokens: Math.min(8192, model.maxTokens), cacheRetention: "none", sessionId: randomUUID() });
        if (response.stopReason === "error" || response.stopReason === "aborted") throw new Error("Model request failed or was cancelled. Check Pi provider status and retry; no fallback model was called.");
        if (response.stopReason === "length") throw new Error("Model response was truncated; no incomplete register breakdown was displayed. Try a model with a larger output limit.");
        const answer = response.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        if (!answer) throw new Error("The model returned no register explanation.");
        show(answer, `${response.provider}/${response.model}`);
      } catch (error) {
        show(controller.signal.aborted ? "Lookup cancelled or timed out." : `Lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`, modelIdentity);
      } finally {
        clearTimeout(timeout);
        running = undefined;
        ctx.ui.setStatus("show-me", undefined);
      }
    },
  });
}
