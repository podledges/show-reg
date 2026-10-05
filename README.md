# show-reg
> Embedded Programming

Lightweight Pi skill + TypeScript extension for exact, source-grounded MCU register lookup from a local reference manual. The first supported profile targets MCXC444.

## Install

```sh
pi install git:github.com/podledges/show-reg
```

## Use

```text
/show-reg MCG->C1
/show-reg explain MCG->C1
/show-reg-config
/show-reg-config show
/show-reg cancel
```

On the first lookup, show-reg scans project-local manual folders (not personal course folders) and offers a complete recommendation to accept once. It shows the device, manual identity evidence, extractor, Helper Assistant model, thinking level, preference, and source links before saving. `/show-reg-config` offers the same one-confirm path, followed by field-by-field review when declined. Absolute and project-root-relative PDF paths work, including quoted Windows paths. A saved manual takes priority over automatic filename/profile heuristics. Nothing is downloaded automatically.

Settings live in `.pi/show-reg.json` in the working project's Git root, or the current directory outside a Git repository. Keep that file out of version control. No credentials are saved in it. Existing `.pi/show-me.json` settings are still read until new settings are saved.

Ordinary `/show-reg <register>` displays the exact bounded source locally without calling a model. Settings, recommendations, candidates and errors also stay in display-only notifications, not chat messages. The `show_register` and `show_register_setup` agent tools use the same local display boundary and return only minimal status with no source, settings or diagnostic details. The bundled skill recognizes register/setup questions and selects those tools; the active chat model does not receive their local output to interpret.

Only the user's explicit `/show-reg explain <register>` action sends the matched register text to the configured Helper Assistant. It sends a document basename, section/page metadata and bounded text (maximum 12 pages and 60,000 characters), never full PDF pages or images, other sections, or configured machine paths. It requests a bit table, field meanings, binary encodings and citations. Extracted diagrams/tables may be ambiguous; explanations must flag uncertainty. Typos, ambiguous names, device/manual mismatches, and unsupported explanation thinking levels stop before a provider call. A bare `/show-reg` prompts for a register; completions appear after indexing.

Local output requires interactive Pi or an RPC client that displays notifications. Notifications are not durable Markdown chat messages. Print/JSON modes have no local UI; tools fail closed and explicit explanation is not dispatched there. Existing session messages are not retroactively scrubbed. Copying local output into chat or using other file tools can disclose it; this package is not a sandbox for the active model.

Parsed manual text is compressed under `.pi/show-reg-cache/`. The cache is project-local, ignored by Git, and invalidates automatically when the PDF, extractor or parser changes. It avoids rerunning `pdftotext` after Pi restarts.

## Turn keyword gate

Normal agent prompts get show-reg guidance only when their text contains the explicit, case-insensitive name `show-reg` or `show-reg-config`, optionally prefixed with `/`. The complete name, including any leading `/`, must not be adjacent to ASCII letters, digits, `_`, `/`, or `-`; near misses such as `show-registry`, `/show-reg-extra`, `show-reg/core.ts`, `show-reg-config/example`, and `PERIPH->REG` do not activate the gate.

A miss returns no hook result. A hit preserves Pi's current chained system prompt and appends one short instruction block for that agent run. The block is not stored as a message or carried to the next turn, and repeated handling does not accumulate copies. Slash commands remain extension commands and are dispatched before agent processing. The main agent never receives the lookup model's `OUTPUT_RULES`; those rules remain the system prompt only for the isolated Helper Assistant request.

This explicit-name gate is implemented by the extension and coexists with the bundled skill, which handles natural-language register intent and tool selection.

`current` uses your active model as the separate Helper Assistant request. `automatic` estimates text cost from positive registry prices when you choose cost; otherwise it uses the current model. The Helper Assistant thinking level is independently configurable and checked against Pi's model capability metadata before every request. The main chat model and its thinking setting are not changed. The footer reports the requested level, never hidden chain-of-thought.

The built-in `mcxc444-cg2271` profile requires the NXP MCX C44X document title, document number, supported-device marker, and representative registers on every cache path. The `esp32-s3-wroom-1` profile includes official Espressif source metadata but is intentionally preview-only until its PDF layout has fixtures. ESP DEVKIT 1 is not treated as an alias for that module.

Custom devices use a version-2 project config with required document text and identity registers; see [examples/show-reg.custom.json](examples/show-reg.custom.json). Links are metadata in this release—a local PDF remains required, and configuring a custom profile does not guarantee that its layout matches the current parser.

Requires Pi 0.87.1+ and `pdftotext` (Poppler; install `poppler-utils` on Debian/Ubuntu). `pdftoppm` is not needed; online explanation is text-only even for image-capable models. Public regressions run on Linux with synthetic PDFs and installed Pi 0.87.1. Quoted Windows paths have unit coverage, not a current Windows end-to-end run; macOS/WSL UI is not validated. WSL paths should use `/mnt/c/...`. Scanned PDFs need OCR first. Saved-configuration lookup is local even if its Helper Assistant is unavailable; first-use recommendation/configuration still requires Pi model metadata.

[Commands and setup](extensions/show-reg/index.ts) · [PDF search](extensions/show-reg/core.ts) · [Usability specification and roadmap](docs/planning/show-reg-usability-spec.md)

## Tests

With Node.js 22.19+, `pdftotext` on PATH and installed Pi 0.87.1:

```sh
# Set this to your installed @earendil-works/pi-coding-agent package directory.
PI_PACKAGE_PATH="$PI_PACKAGE_PATH" npm test
```

Pi loader, runner, provider-context conversion and offline provider request tests are mandatory, not silently skipped when dependencies are absent. CI explicitly provisions Pi and Poppler. Tests generate invented PDFs, including adjacent-section markers, and verify text-only request bounds, local context exclusion, settings save, model validation, cancellation and missing extractor behavior. No manuals are bundled or required. These tests do not establish historical/live disclosure, real-manual layout correctness, or full interactive/RPC UI and compaction behavior.

Measure a cold extraction and five fresh-loader disk-cache reads with:

```sh
npm run benchmark:cache
```
