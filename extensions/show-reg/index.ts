import { Type, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
<<<<<<< HEAD
<<<<<<< HEAD
import { type Config, DEFAULT_MANUAL, OUTPUT_RULES, cleanFilePath, createManualLoader, lookup, readConfig, renderPage, saveConfig, showRegSystemPrompt, sourceExcerpt, validateConfig } from "./core.ts";
=======
import { type Config, type Hint, type Register, DEFAULT_MANUAL, OUTPUT_RULES, cleanFilePath, createManualLoader, defaultPdfToText, deviceFromPath, discoverHints, discoverManuals, expandHome, listBrowsable, lookup, normalizeFieldBreaks, rankManuals, readConfig, renderPage, saveConfig, sourceExcerpt, storeManualPath, validateConfig } from "./core.ts";
>>>>>>> 18f2e4e (Add skill-driven register lookup and persistent cache)
=======
import { type Config, type DeviceProfile, type DeviceSelection, type HelperThinking, type Hint, type ManualIdentity, type Register, DEFAULT_MANUAL, OUTPUT_RULES, THINKING_LEVELS, cleanFilePath, createManualLoader, defaultPdfToText, discoverHints, discoverManuals, expandHome, listBrowsable, lookup, normalizeFieldBreaks, profileForTarget, rankManuals, readConfig, renderPage, resolveDeviceProfile, saveConfig, sourceExcerpt, storeManualPath, validateConfig, validateManualForDevice } from "./core.ts";
>>>>>>> 339c927 (Add device-safe setup and configurable helper assistant)

function projectRoot(cwd: string): string {
  let root = resolve(cwd);
  while (true) {
    if (existsSync(join(root, ".git")) || existsSync(join(root, ".pi/show-reg.json")) || existsSync(join(root, ".pi/show-me.json"))) return root;
    const parent = dirname(root);
    if (parent === root) return resolve(cwd);
    root = parent;
  }
}
function availableModels(ctx: ExtensionContext) {
  const available = ctx.modelRegistry.getAvailable();
  return ctx.scopedModels.length ? available.filter((m) => ctx.scopedModels.some(
    (s) => s.model.provider === m.provider && s.model.id === m.id,
  )) : available;
}

function pdfLabel(path: string, all: string[], current?: string): string {
  const name = basename(path);
  const clash = all.filter((p) => basename(p).toLowerCase() === name.toLowerCase()).length > 1;
  const label = clash ? `${name} — ${dirname(path)}` : name;
  return current && resolve(expandHome(current)) === resolve(path) ? `${label} (current)` : label;
}

async function browsePdfs(ctx: ExtensionCommandContext, root: string, start: string): Promise<string | undefined> {
  let dir = resolve(expandHome(start));
  for (;;) {
    const { dirs, pdfs } = await listBrowsable(dir);
    const dirLabels = dirs.map((d) => `${basename(d)}/`);
    const pdfLabels = pdfs.map((p) => basename(p));
    const choice = await ctx.ui.select(`PDFs in ${dir}`, [
      ...pdfLabels, ...dirLabels, ...(dirname(dir) !== dir ? [".."] : []), "Enter a filepath…",
    ]);
    if (!choice) return;
    if (choice === "Enter a filepath…") {
      const typed = await ctx.ui.input("PDF filepath", dir);
      return typed === undefined ? undefined : storeManualPath(root, typed);
    }
    if (choice === "..") { dir = dirname(dir); continue; }
    const nested = dirs[dirLabels.indexOf(choice)];
    if (nested) { dir = nested; continue; }
    const pdf = pdfs[pdfLabels.indexOf(choice)];
    if (pdf) return storeManualPath(root, pdf);
  }
}

function preferFirst<T>(items: T[], pred: (item: T) => boolean): T[] {
  return [...items.filter(pred), ...items.filter((item) => !pred(item))];
}

async function pickHint(ctx: ExtensionCommandContext, title: string, hints: Hint[], fallback = ""): Promise<string | undefined> {
  if (!hints.length) {
    const typed = await ctx.ui.input(title, fallback);
    return typed === undefined ? undefined : typed;
  }
  const labels = hints.map((hint) => `${hint.value} — ${hint.source}`);
  const choice = await ctx.ui.select(title, [...labels, "Enter a different value…"]);
  if (!choice) return;
  if (choice === "Enter a different value…") {
    const typed = await ctx.ui.input(title, hints[0]?.value ?? fallback);
    return typed === undefined ? undefined : typed;
  }
  return hints[labels.indexOf(choice)]?.value;
}

async function pickManual(ctx: ExtensionCommandContext, root: string, current?: string, extra: string[] = [], profile?: DeviceProfile): Promise<string | undefined> {
  const discovered = rankManuals(await discoverManuals(root, current, extra), profile?.target, current, profile);
  const labels = discovered.map((p) => pdfLabel(p, discovered, current));
  const choice = await ctx.ui.select("Datasheet / reference manual PDF", [
    ...labels, "Browse another folder…", "Enter a filepath…",
  ]);
  if (!choice) return;
  if (choice === "Enter a filepath…") {
    const typed = await ctx.ui.input("PDF filepath (absolute, ~/\u2026, or relative to repository root)",
      current ?? join(homedir(), "Documents", "CG2271-Labs", "datasheets"));
    return typed === undefined ? undefined : storeManualPath(root, typed);
  }
  if (choice === "Browse another folder…") {
    const fromCurrent = current ? dirname(resolve(root, expandHome(current))) : "";
    const lab = join(homedir(), "Documents", "CG2271-Labs", "datasheets");
    const start = existsSync(fromCurrent) ? fromCurrent : existsSync(lab) ? lab : homedir();
    const folder = await ctx.ui.input("Folder to browse", start);
    return folder === undefined ? undefined : browsePdfs(ctx, root, folder);
  }
  return storeManualPath(root, discovered[labels.indexOf(choice)]!);
}

export default function showReg(pi: ExtensionAPI) {
  const loadManual = createManualLoader();
  let running: AbortController | undefined;
  let completionRegisters: Register[] = [];
  pi.on("session_shutdown", async () => running?.abort());
  pi.on("before_agent_start", (event) => {
    const systemPrompt = showRegSystemPrompt(event.prompt, event.systemPrompt);
    return systemPrompt === undefined ? undefined : { systemPrompt };
  });
  pi.registerMessageRenderer("show-reg", (message) => new Markdown(String(message.content), 0, 0, getMarkdownTheme()));
  const show = (text: string, model?: string) => pi.sendMessage({ customType: "show-reg", display: true,
    content: `${text}\n\n— ${model ?? "show-reg (local lookup; no model called)"}` }, { triggerTurn: false });

  const recommend = async (root: string, ctx: ExtensionContext, old?: Config, allowEnv = false, signal?: AbortSignal): Promise<Recommendation> => {
    const models = availableModels(ctx);
    const current = resolvedModel(models, ctx.model, old?.model ?? "current");
    if (!current) throw new Error("The configured/active Helper Assistant model is unavailable or outside this session's model scope.");
    const hints = await discoverHints(root, { allowEnv, current: old ? {
      target: resolveDeviceProfile(old.device).target, manual: old.manual, pdftotext: old.pdftotext,
    } : undefined, env: process.env });
    const hintedProfiles = [...new Map(hints.targets.map((hint) => profileForTarget(hint.value)).filter(Boolean)
      .map((profile) => [profile!.id, profile!] as const)).values()];
    const profile = old ? resolveDeviceProfile(old.device) : hintedProfiles.length === 1 ? hintedProfiles[0] : undefined;
    if (!profile || profile.status === "preview") {
      throw new Error(hintedProfiles.length > 1
        ? "Project device hints conflict. Run /show-reg-config and select the device explicitly."
        : "I could not confidently identify a validated device profile. Run /show-reg-config.");
    }
    const manuals = rankManuals(await discoverManuals(root, old?.manual, hints.manuals.map((hint) => hint.value)),
      profile.target, old?.manual, profile);
    const manual = manuals[0];
    if (!manual) throw new Error("I could not find a local reference-manual PDF. Run /show-reg-config.");
    const pdftotext = old?.pdftotext ?? hints.pdftotext[0]?.value ?? defaultPdfToText();
    const thinking = old ? helperThinking(current, old.thinking) : recommendedThinking(current);
    const config = validateConfig({ version: 2, device: old?.device ?? { profile: profile.id },
      manual: storeManualPath(root, manual), pdftotext, model: old?.model ?? "current", thinking,
      preference: old?.preference ?? "accuracy" });
    const indexed = await loadManual(root, config, signal);
    const identity = validateManualForDevice(indexed, config.device);
    return { config, profile, identity, count: indexed.registers.length, model: current, thinking };
  };

  const quickConfig = async (root: string, ctx: ExtensionContext): Promise<Config> => {
    if (!ctx.hasUI) throw new Error("Run /show-reg-config once in interactive Pi, then retry.");
    ctx.ui.setStatus("show-reg", "Building and validating a first-use recommendation…");
    try {
      const proposed = await recommend(root, ctx);
      const accepted = await ctx.ui.confirm("Use this validated show-reg setup?",
        `${recommendationText(proposed)}\n\nThe PDF stays local; only the exact matched register section is sent. Choose No to review fields with /show-reg-config.`);
      if (!accepted) throw new Error("Setup was not saved. Run /show-reg-config to choose each setting.");
      await saveConfig(root, proposed.config);
      completionRegisters = (await loadManual(root, proposed.config)).registers;
      ctx.ui.notify(`Ready: ${proposed.count} sections for ${proposed.profile.target}; Helper Assistant ${modelId(proposed.model)} (${proposed.thinking}).`, "success");
      return proposed.config;
    } finally { ctx.ui.setStatus("show-reg", undefined); }
  };

  const performLookup = async (rawQuery: string, ctx: ExtensionContext, signal: AbortSignal): Promise<{ text: string; model?: string }> => {
    const root = projectRoot(ctx.cwd);
    const config = await readConfig(root) ?? await quickConfig(root, ctx);
    const query = rawQuery.trim();
    if (!query) throw new Error("Provide a register: /show-reg <register>.");
    if (query.length > 200) throw new Error("Register query is limited to 200 characters.");
    ctx.ui.setStatus("show-reg", "Searching the local manual index…");
    const manual = await loadManual(root, config, signal);
    const profile = resolveDeviceProfile(config.device);
    completionRegisters = manual.registers;
    const result = lookup(manual.registers, query);
    if (!result.exact) {
      return { text: `No unique exact match for ${JSON.stringify(query)}.${result.candidates.length
        ? "\n\nDid you mean:\n" + result.candidates.map((r) => `- \`${r.id}\` — ${r.title} (PDF p. ${r.page})`).join("\n")
        : " No plausible indexed candidates found; the manual may use another identifier."}` };
    }
    const excerpt = sourceExcerpt(manual, result.exact);
    const models = availableModels(ctx);
    let model = models.find((candidate) => `${candidate.provider}/${candidate.id}` === config.model);
    if (config.model === "current" || config.model === "automatic") {
      model = models.find((candidate) => ctx.model?.provider === candidate.provider && ctx.model?.id === candidate.id);
      if (config.model === "automatic" && config.preference === "cost") {
        model = models.filter((candidate) => candidate.cost.input > 0 && candidate.cost.output > 0
          && candidate.contextWindow >= Math.ceil(excerpt.length / 4) + 8192)
          .filter((candidate) => config.thinking === "auto" || getSupportedThinkingLevels(candidate).includes(config.thinking))
          .sort((a, b) => (a.cost.input * excerpt.length / 4 + a.cost.output * 4096)
            - (b.cost.input * excerpt.length / 4 + b.cost.output * 4096))[0];
      }
    }
    if (!model) throw new Error("Configured Helper Assistant model is unavailable, outside the session scope, or has no usable price estimate. Run /show-reg-config; no substitute was called.");
    if (model.contextWindow < Math.ceil(excerpt.length / 4) + 8192) throw new Error("Selected model's context limit is too small for this section. Choose another model in /show-reg-config.");
    const thinking = helperThinking(model, config.thinking);
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    if (model.input.includes("image")) {
      try {
        for (let page = result.exact.page; page <= result.exact.endPage; page++) {
          images.push({ type: "image", data: await renderPage(resolve(root, expandHome(config.manual)), page, signal), mimeType: "image/png" });
        }
      } catch {
        if (signal.aborted) throw new Error("Cancelled.");
        images.length = 0;
      }
    }
    const sourceMode = images.length ? "Text and page images, in PDF page order; verify table alignment against images."
      : "Text only; page images unavailable. Explicitly flag any ambiguous diagram or field alignment.";
    if (!images.length) ctx.ui.notify("Using extracted text only; page images are unavailable for this tool/model.", "warning");
    const attempted = `Helper Assistant ${modelId(model)} · thinking ${thinking} (request attempted)`;
    ctx.ui.setStatus("show-reg", `${result.exact.id} → ${attempted}`);
    ctx.ui.notify(`Reading PDF pages ${result.exact.page}–${result.exact.endPage} with ${attempted}`, "info");
    const response = await completeHelper(ctx, model, {
      systemPrompt: OUTPUT_RULES,
      messages: [{ role: "user", timestamp: Date.now(), content: [{ type: "text", text:
        JSON.stringify({ target: profile.target, deviceProfile: profile.id, query, register: result.exact, document: config.manual, sourceMode, source: excerpt }) }, ...images] }],
    }, thinking, signal);
    if (response.stopReason === "error" || response.stopReason === "aborted") throw new Error("Model request failed or was cancelled. Check Pi provider status and retry; no fallback model was called.");
    if (response.stopReason === "length") throw new Error("Model response was truncated; no incomplete register breakdown was displayed. Try a model with a larger output limit.");
    const answer = normalizeFieldBreaks(response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim());
    if (!answer) throw new Error("The model returned no register explanation.");
    return { text: answer, model: `Helper Assistant ${response.provider ?? model.provider}/${response.model ?? model.id} · thinking ${thinking}` };
  };

  pi.registerCommand("show-reg-config", {
    description: "Configure local register lookup and its model; use 'show' to inspect settings",
    handler: async (args, ctx) => {
      try {
        const root = projectRoot(ctx.cwd);
        let old: Config | undefined;
        try { old = await readConfig(root); } catch { ctx.ui.notify("Existing settings are invalid; configuration will replace them.", "warning"); }
        if (args.trim() === "show") {
          show(old ? `Saved in .pi/show-reg.json:\n\n\`\`\`json\n${JSON.stringify(old, null, 2)}\n\`\`\`` : "Not configured. Run /show-reg-config.");
          return;
        }
        if (args.trim()) throw new Error("Use /show-reg-config or /show-reg-config show.");
        if (!ctx.hasUI) throw new Error("Configuration requires interactive Pi. Run /show-reg-config there first.");
        const models = availableModels(ctx);
        if (!models.length) throw new Error("No authenticated models available in Pi. Configure a provider first.");
        try {
          ctx.ui.setStatus("show-reg", "Building a validated recommendation…");
          const proposed = await recommend(root, ctx, old);
          ctx.ui.setStatus("show-reg", undefined);
          if (await ctx.ui.confirm("Accept all recommended settings?", `${recommendationText(proposed)}\n\nChoose No to review every field. Nothing is saved unless you confirm.`)) {
            await saveConfig(root, proposed.config);
            show("Saved the validated recommendation in `.pi/show-reg.json`. Try `/show-reg MCG->C1`.");
            return;
          }
        } catch (error) {
          ctx.ui.setStatus("show-reg", undefined);
          ctx.ui.notify(`No one-click recommendation: ${error instanceof Error ? error.message : "detection failed"}`, "warning");
        }
        const allowEnv = await ctx.ui.confirm(
          "Search environment variables?",
          "Read SHOW_REG_* / MCU / DEVICE and .env for autofill. Declining still locates datasheets and infers hardware from project files. You can edit every field. Nothing is saved until the last step.",
        );
        ctx.ui.setStatus("show-reg", "Looking for device and datasheet hints…");
        let hints = { targets: [] as Hint[], manuals: [] as Hint[], pdftotext: [] as Hint[] };
        try {
          hints = await discoverHints(root, { allowEnv, current: old ? {
            target: resolveDeviceProfile(old.device).target, manual: old.manual, pdftotext: old.pdftotext,
          } : undefined, env: process.env });
        } catch {
          ctx.ui.notify("Autofill scan failed; fill the fields manually.", "warning");
        } finally {
          ctx.ui.setStatus("show-reg", undefined);
        }
        const oldProfile = old ? resolveDeviceProfile(old.device) : undefined;
        const guessedProfile = oldProfile ?? hints.targets.map((hint) => profileForTarget(hint.value)).find(Boolean);
        const profileChoices = preferFirst([
          "MCXC444 — CG2271 Labs (validated)",
          "ESP32-S3-WROOM-1 (preview; lookup disabled)",
          "Custom device profile…",
        ], (choice) => choice.startsWith(guessedProfile?.target ?? "__none__") || (oldProfile?.id === "custom" && choice.startsWith("Custom")));
        const profileChoice = await ctx.ui.select("Device profile", profileChoices);
        if (!profileChoice) return;
        let device: DeviceSelection;
        if (profileChoice.startsWith("MCXC444")) device = { profile: "mcxc444-cg2271" };
        else if (profileChoice.startsWith("ESP32")) device = { profile: "esp32-s3-wroom-1" };
        else {
          const previous = old?.device.profile === "custom" ? old.device : undefined;
          const label = await ctx.ui.input("Custom device label", previous?.label ?? hints.targets[0]?.value ?? "");
          if (label === undefined) return;
          const target = await ctx.ui.input("Canonical MCU target", previous?.target ?? hints.targets[0]?.value ?? "");
          if (target === undefined) return;
          const aliases = await ctx.ui.input("Device/board aliases (comma-separated; optional)", previous?.aliases.join(", ") ?? "");
          if (aliases === undefined) return;
          const evidence = await ctx.ui.input("Required manual identity text (comma-separated)", previous?.evidence.join(", ") ?? "");
          if (evidence === undefined) return;
          const identity = await ctx.ui.input("Required register IDs (comma-separated)", previous?.identityRegisters.join(", ") ?? "");
          if (identity === undefined) return;
          const links = await ctx.ui.input("Official/custom source links (comma-separated; optional)", previous?.sourceLinks.join(", ") ?? "");
          if (links === undefined) return;
          const split = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
          device = { profile: "custom", label: label.trim(), target: target.trim(), aliases: split(aliases),
            manualHints: previous?.manualHints ?? [], sourceLinks: split(links), evidence: split(evidence), identityRegisters: split(identity) };
        }
        const profile = resolveDeviceProfile(device);
        const extraManuals = hints.manuals.map((hint) => hint.value).filter((path) => path !== old?.manual);
        const manual = await pickManual(ctx, root, old?.manual ?? DEFAULT_MANUAL, extraManuals, profile);
        if (manual === undefined) return;
        if (device.profile === "custom" && !device.manualHints.length) device.manualHints = [basename(manual)];
        const pdftotext = await pickHint(ctx, "pdftotext executable (path or command)", hints.pdftotext, old?.pdftotext ?? defaultPdfToText());
        if (pdftotext === undefined) return;
        const preference = await ctx.ui.select("Lookup preference", preferFirst(["accuracy", "speed", "cost"], (p) => p === old?.preference));
        if (!preference) return;
        const choices = preferFirst([
          "current — use the active chat model",
          "automatic — cheapest listed text price for cost; current model otherwise",
          ...models.map((m) => `${m.provider}/${m.id}`),
        ], (choice) => {
          const id = choice.startsWith("current —") ? "current" : choice.startsWith("automatic —") ? "automatic" : choice;
          return id === old?.model;
        });
        const selected = await ctx.ui.select(`Lookup model (previous: ${old?.model ?? "unset"})`, choices);
        if (!selected) return;
        const model = selected.startsWith("current —") ? "current" : selected.startsWith("automatic —") ? "automatic" : selected;
        const selectionModel = resolvedModel(models, ctx.model, model);
        if (!selectionModel) throw new Error("Selected Helper Assistant model is unavailable.");
        const thinkingModels = model === "automatic" && preference === "cost"
          ? models.filter((candidate) => candidate.cost.input > 0 && candidate.cost.output > 0)
          : [selectionModel];
        if (!thinkingModels.length) throw new Error("Automatic cost selection has no models with usable price metadata.");
        const supported = THINKING_LEVELS.filter((level) => thinkingModels.every((candidate) => getSupportedThinkingLevels(candidate).includes(level)));
        const defaultThinking = supported.includes(old?.thinking as any) ? old!.thinking : supported.includes("medium") ? "medium" : supported[0];
        const thinking = await ctx.ui.select("Helper Assistant thinking level", preferFirst(supported, (level) => level === defaultThinking));
        if (!thinking) return;
        const config = validateConfig({ version: 2, device, manual: cleanFilePath(manual), pdftotext: cleanFilePath(pdftotext), model, thinking, preference });
        let identity: ManualIdentity = { profile: profile.id, evidence: ["preview metadata only"], registers: [] };
        let count = 0;
        if (profile.status !== "preview") {
          ctx.ui.notify("Checking document identity and PDF extraction locally…", "info");
          const indexed = await loadManual(root, config);
          identity = validateManualForDevice(indexed, config.device);
          count = indexed.registers.length;
        }
        const summary: Recommendation = { config, profile, identity, count, model: selectionModel, thinking };
        if (!await ctx.ui.confirm("Save these show-reg settings?", `${recommendationText(summary)}\n\n${profile.status === "preview" ? "Preview profiles cannot dispatch lookups. " : ""}Automatic selection is a price heuristic, not a quality or speed benchmark.`)) return;
        await saveConfig(root, config);
        show(`Saved personal settings in `.pi/show-reg.json`. Keep this file out of Git.${profile.status === "preview" ? " This preview cannot run lookups yet." : " Try `/show-reg MCG->C1`."}`);
      } catch (error) { show(`Configuration failed: ${error instanceof Error ? error.message : "Unknown error"}`); }
    },
  });

  pi.registerTool({
    name: "show_register",
    label: "Show register",
    description: "Look up one MCU hardware register in the project's configured reference manual. Return the complete source-grounded bit table, every documented field encoding, constraints and citations; use the exact peripheral/register identifier when known.",
    promptSnippet: "Look up an MCU register in the project's local reference manual",
    parameters: Type.Object({ register: Type.String({ minLength: 1, maxLength: 200,
      description: "Register identifier or official title, for example MCG_C1 or MCG->C1" }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (running) return { content: [{ type: "text", text: "A register lookup is already running." }], details: {}, isError: true };
      running = new AbortController();
      const controller = running;
      const timeout = setTimeout(() => controller.abort(), 180_000);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        const result = await performLookup(params.register, ctx, combined);
        return { content: [{ type: "text", text: `${result.text}\n\n— ${result.model ?? "show-reg (local lookup; no model called)"}` }],
          details: { model: result.model } };
      } catch (error) {
        return { content: [{ type: "text", text: combined.aborted ? "Lookup cancelled or timed out."
          : `Lookup failed: ${error instanceof Error ? error.message : "Unknown error"}` }], details: {}, isError: true };
      } finally {
        clearTimeout(timeout);
        running = undefined;
        ctx.ui.setStatus("show-reg", undefined);
      }
    },
  });

  pi.registerTool({
    name: "show_register_setup",
    label: "Inspect show-reg setup",
    description: "Inspect and locally validate the recommended show-reg device, manual, extractor, Helper Assistant model, and thinking level. Does not save settings or call a model.",
    promptSnippet: "Inspect the project's recommended register-lookup setup",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      try {
        const root = projectRoot(ctx.cwd);
        const old = await readConfig(root);
        const proposed = await recommend(root, ctx, old, false, signal);
        if (signal?.aborted) throw new Error("Cancelled.");
        return { content: [{ type: "text", text: `Validated recommended answers:\n\n${recommendationText(proposed)}\n\nRun /show-reg-config to accept once or review each field. No settings were saved and no Helper Assistant model was called.` }],
          details: { profile: proposed.profile.id, manual: proposed.config.manual, model: modelId(proposed.model), thinking: proposed.thinking } };
      } catch (error) {
        return { content: [{ type: "text", text: `Setup inspection failed: ${error instanceof Error ? error.message : "Unknown error"}` }], details: {}, isError: true };
      }
    },
  });

  pi.registerCommand("show-reg", {
    description: "Show a register: /show-reg MCG->C1 · /show-reg show · /show-reg cancel",
    getArgumentCompletions: (prefix) => {
      const key = prefix.trim().toLowerCase();
      const actions = ["show", "cancel"].filter((value) => value.startsWith(key))
        .map((value) => ({ value, label: value }));
      const registers = completionRegisters.filter((register) => register.id.toLowerCase().includes(key)
        || register.title.toLowerCase().includes(key)).slice(0, 20)
        .map((register) => ({ value: register.id, label: `${register.id} — ${register.title}` }));
      return actions.length || registers.length ? [...actions, ...registers] : null;
    },
    handler: async (args, ctx) => {
      if (args.trim() === "cancel") {
        if (!running) ctx.ui.notify("No lookup is running.", "info");
        else running.abort();
        return;
      }
      if (args.trim() === "show") {
        const root = projectRoot(ctx.cwd);
        let old: Config | undefined;
        try { old = await readConfig(root); } catch { show("Saved settings are invalid. Run /show-reg-config to replace them."); return; }
        show(old ? `Saved in .pi/show-reg.json:\n\n\`\`\`json\n${JSON.stringify(old, null, 2)}\n\`\`\`` : "Not configured. The next lookup can auto-detect a setup, or run /show-reg-config.");
        return;
      }
      if (running) { ctx.ui.notify("A lookup is running. Use /show-reg cancel first.", "warning"); return; }
      let query = args.trim();
      if (!query) {
        if (!ctx.hasUI) { show("Lookup failed: Provide a register: /show-reg <register>."); return; }
        query = (await ctx.ui.input("Register identifier or manual title"))?.trim() ?? "";
        if (!query) return;
      }
      running = new AbortController();
      const controller = running;
      const timeout = setTimeout(() => controller.abort(), 180_000);
      try {
        const result = await performLookup(query, ctx, controller.signal);
        show(result.text, result.model);
      } catch (error) {
        show(controller.signal.aborted ? "Lookup cancelled or timed out."
          : `Lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        clearTimeout(timeout);
        running = undefined;
        ctx.ui.setStatus("show-reg", undefined);
      }
    },
  });
}

function modelId(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function helperThinking(model: any, requested: HelperThinking): Exclude<HelperThinking, "auto"> {
  const supported = getSupportedThinkingLevels(model) as Exclude<HelperThinking, "auto">[];
  if (requested === "auto") return supported.includes("medium") ? "medium" : supported[0] ?? "off";
  if (!supported.includes(requested)) {
    throw new Error(`${modelId(model)} does not support Helper Assistant thinking=${requested}. Supported: ${supported.join(", ")}. Run /show-reg-config.`);
  }
  return requested;
}

function recommendedThinking(model: any): Exclude<HelperThinking, "auto"> {
  return helperThinking(model, "auto");
}

function resolvedModel(models: any[], current: any, configured: string): any | undefined {
  if (configured === "current" || configured === "automatic") {
    return models.find((candidate) => current?.provider === candidate.provider && current?.id === candidate.id);
  }
  return models.find((candidate) => modelId(candidate) === configured);
}

async function completeHelper(ctx: ExtensionContext, model: any, context: any, thinking: Exclude<HelperThinking, "auto">, signal: AbortSignal) {
  const registry = ctx.modelRegistry;
  const provider = registry.getProvider(model.provider);
  if (!provider) throw new Error(`Helper Assistant provider is unavailable: ${model.provider}.`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`Helper Assistant authentication failed: ${auth.error}`);
  const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
  return provider.streamSimple(requestModel, context, {
    signal,
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    reasoning: thinking === "off" ? undefined : thinking,
    maxTokens: Math.min(8192, model.maxTokens),
    cacheRetention: "none",
    sessionId: randomUUID(),
  }).result();
}

type Recommendation = { config: Config; profile: DeviceProfile; identity: ManualIdentity; count: number; model: any; thinking: Exclude<HelperThinking, "auto"> };

function recommendationText(value: Recommendation): string {
  const links = value.profile.sourceLinks.length ? value.profile.sourceLinks.map((link) => `- ${link}`).join("\n") : "- none";
  return `Device: ${value.profile.label} (${value.profile.target})\nManual: ${value.config.manual}\nIdentity evidence: ${value.identity.evidence.join("; ")}\nIdentity registers: ${value.identity.registers.join(", ")}\nExtractor: ${value.config.pdftotext}\nHelper Assistant policy: ${value.config.model}\nResolved Helper Assistant: ${modelId(value.model)}\nThinking: ${value.thinking}\nPreference: ${value.config.preference}\nIndexed sections: ${value.count}\nSource links:\n${links}`;
}
