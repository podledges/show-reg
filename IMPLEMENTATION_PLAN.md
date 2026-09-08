# show-reg implementation plan

## Goal

Make register lookup reliably choose the correct device/manual, keep repeat lookups fast, and make setup understandable without turning the package into a large framework. Acceptance work is centered on the MCXC444 reference manual used by `CG2271-Labs`. `ESP32-S3-WROOM-1` is the next supported profile, not a reason to weaken MCXC444 correctness.

## Success measures

- A query never crosses device profiles or silently selects an ambiguous register.
- Setup shows its detected device, manual, Helper Assistant model, and thinking level before anything is saved.
- A user can accept a complete recommendation in one confirmation or review each field.
- A fresh loader reading the compressed cache for the 1,012-page MCXC444 manual has a median below 500 ms across five runs on the current Windows machine; report cold extraction and in-memory hits separately. This is a measured target, not an end-to-end model-latency promise.
- The model-facing skill still needs one tool call and no file navigation for a normal lookup.
- Windows, macOS, Linux, and WSL use native path/config logic. Verify Windows here and document the other platforms as unverified unless actually run; WSL uses Linux paths such as `/mnt/c/...`, not automatic Windows-path translation.

## Review decisions and Pi 0.85.1 constraints

- Keep the existing skill, single `show_register` tool, local parser/cache, and isolated model call. The Helper Assistant is a named specialist with its own prompt and request settings; it does not require another Pi process, a tool-using agent loop, or its own conversation history.
- Installed Pi 0.85.1 exposes `modelRegistry.complete(model, context, options)` with provider-specific `ModelsApiStreamOptions`. Generic `reasoning` is a `SimpleStreamOptions` field and must not be assumed to work through this method. Inspect each supported adapter before mapping levels; reject an API that cannot be mapped correctly before dispatch. Pi's exported `getSupportedThinkingLevels(model)` is the capability source, not a hard-coded list inferred only from `model.reasoning`.
- A model cannot reliably assist while the extension is awaiting an interactive dialog. Show the recommendation and evidence in the extension itself. The skill may explain surfaced values before/after setup, but must not promise concurrent conversation during a modal flow or invent unseen recommendations.
- A device alias, family manual, module, and board are different identities. Accept MCXC444 package variants only with explicit known aliases; MCX-C44X identifies a manual family, not evidence that every detected family member is MCXC444. ESP DEVKIT 1 must not alias ESP32-S3-WROOM-1. The user's updated secondary choice is the ESP32-S3-WROOM-1 module, whose register manual describes its ESP32-S3 SoC.
- Links are configurable source metadata in this iteration; local PDFs remain the executable lookup source. Do not introduce fetching, remote caches, or a second indexing format in this implementation.

## Phase 1 — device identity and configuration

1. Add a small device-profile model with:
   - stable ID, label, canonical target, and aliases;
   - reference-manual filename hints and optional official/custom source links;
   - expected document/device text and representative identity registers that must be present before the profile is accepted.
2. Ship a strict `mcxc444-cg2271` profile. Keep `esp32-s3-wroom-1` as a selectable preview profile with official source metadata, but do not claim its parser is validated until a real ESP32-S3 manual fixture passes.
3. Support a `custom` profile in validated project JSON so another MCU can define its target, aliases, manual link/path, expected document text, and identity registers without editing TypeScript. Include a complete example and preserve custom fields through setup round trips. Configuring a device does not imply its PDF layout is supported by the current parser.
4. Migrate version-1 settings in memory and write version 2 only after user confirmation. Preserve the legacy `.pi/show-me.json` read path.
5. Validate the indexed manual against the selected profile before any model request, including memory and disk cache hits and after profile edits. Require matching document/device evidence as well as register checks: shared register names alone cannot distinguish related NXP devices. Treat a profile/manual mismatch, empty index, unknown profile, or preview profile as a hard error with the observed and expected identifiers. Preview profiles may be inspected/configured but must not dispatch.
6. Version 2 keeps the existing preference/model semantics and adds a selected profile plus Helper Assistant thinking choice. Migrate a known version-1 MCXC444 target to the built-in profile in memory. Preserve unknown legacy targets as unverified/custom settings requiring explicit identity configuration; never silently label them MCXC444. Invalid versions or incomplete custom profiles fail with repair instructions. Reads never rewrite settings.
7. Rank by selected-profile compatibility before prior selection or reference-manual filename bonuses. Treat project evidence as stronger than a random PDF filename. When strong project hints conflict, require explicit device selection. Keep filename ranking separate from content validation so compatible unknown filenames remain selectable.

## Phase 2 — confidence-building setup

1. Detect project hints locally, rank manuals by the chosen profile, validate the best candidate locally, and display a recommendation card containing every proposed answer: profile/target, manual path and identity evidence, extractor, model policy and resolved Helper Assistant model, thinking level, preference, and source links if present. If the best candidate fails, do not confidently recommend it; allow another selection.
2. Let the user accept the recommendation once or enter the existing field-by-field setup.
3. Name the nested specialist `Helper Assistant` in UI/status output.
4. Keep environment-variable scanning opt-in and never save credentials.
5. Update the skill so that, when setup is needed, the chat agent explains the proposed values and why they match the project instead of manually searching PDFs.
6. Reuse the same recommendation builder for first use and explicit configuration. Cancel at any point leaves saved settings unchanged. A first-use acceptance is the single write confirmation, after local validation; editing fields receives the same final summary. Headless use reports actionable setup instructions without opening dialogs or saving settings.

## Phase 3 — configurable Helper Assistant

1. Add a per-project thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
2. Choose `medium` if supported, otherwise a supported Pi capability default and show that choice explicitly. For migrated settings, retain an automatic default in memory until the user saves; do not claim all reasoning models support `off` or `medium`.
3. Pass the selected level using Pi's provider-specific request option while leaving the main chat model/thinking level unchanged.
4. Show the exact Helper Assistant model and thinking level before the request and in the answer identity footer.
5. Reject unsupported model/level combinations during setup rather than silently downgrading.
6. Revalidate after resolving `current`/`automatic` on every request, since the active model or registry can change after setup. Preserve Pi authentication, scoped models, cancellation, no fallback, bounded inputs, output-length errors, and response-reported model identity. The footer identifies the configured/requested thinking level, not an unverifiable amount of actual internal reasoning. Never display chain-of-thought.

## Phase 4 — correctness and performance tests

1. Test configuration migration, custom profiles, profile/manual mismatch, duplicate register IDs, and device-aware ranking.
2. Use the real MCXC444 manual read-only to verify identity evidence and representative peripherals: MCG_C1, SIM_SCGC5, PORT_PCRn, GPIO_PDOR, and TPM_SC where present. Record actual section/page expectations from the supplied manual. Test arrow/underscore forms, ambiguous short names, typos, and a related-device manual containing overlapping registers. Do not copy full vendor PDFs into Git.
3. Test that no provider call occurs for mismatches, typos, ambiguous names, invalid profiles, or unsupported thinking levels.
4. Retain the compressed project cache and invalidate it when the PDF, extractor, or parser version changes.
5. Re-run a lower-capability model probe with no implementation hints and record typing, interactions, tool calls, navigation, and likely wait time.
6. Add extension-level mocked checks that assert the actual dispatched reasoning options for supported APIs, reject unsupported combinations before any provider call, and preserve the main model/settings. Core tests alone cannot establish the integration contract. Exercise setup accept/edit/cancel, migration without write, profile changes against warm caches, and corrupted-cache recovery.
7. Include all parser/source bounds used during dispatch in cache validation: valid page ranges, line bounds, section/id/title types, and nonempty index. Never let malformed cached metadata broaden an excerpt. Existing page images include full boundary pages and may visually contain neighboring registers; retain exact text-section bounds and explicitly identify which register to read. Do not claim image contents are section-cropped.
8. Benchmark using a temporary root inside show-reg or the OS temporary directory, with the original PDF as a read-only input. Do not create `.pi` settings/cache inside CG2271-Labs. Compare Windows path quoting and project-relative paths; preserve case-sensitive identities on POSIX instead of unconditionally lowercasing filesystem paths.
9. The usability probe is not permission to change models in another user task. Use the available probe mechanism, or record a scripted extension/skill test and the lack of a live weaker-model run. Label simulated interactions and unmeasured latency honestly.

## Phase 5 — ESP32-S3 follow-up

1. Bind the `esp32-s3-wroom-1` profile to Espressif's official ESP32-S3 technical reference material.
2. Add parser fixtures for ESP32-S3 heading/register-table conventions.
3. Promote the profile from preview to validated only after exact-match and bounded-source tests pass across multiple peripherals.

## Scope boundaries

- Do not download manuals silently. A user-selected remote source may be cached only after an explicit setup action.
- Do not send an entire manual to a model; send only the validated register section.
- Do not modify, stage, or commit `CG2271-Labs` or any repository other than `podledges/show-reg`.
- Do not add runtime dependencies unless the standard library and Pi peer packages are insufficient.

## Implementation order

1. Review and improve this plan with GPT-6-Astra High. Completed: plan-only review against the existing extension, core tests, and installed Pi 0.85.1 declarations.
2. Implement Phase 1 and the setup/Helper Assistant portions needed for MCXC444.
3. Add tests and benchmark the cached path.
4. Run the independent lower-capability usability probe.
5. Update documentation and commit only the explicit `show-reg` files.

## Completion boundary

The current deliverable is MCXC444 correctness, profile/custom-link configuration, visible setup recommendations, and a configurable Helper Assistant, with automated tests and measured cache performance. Phase 5 parser support remains a clearly documented follow-up. Before the commit, inspect the worktree and staged diff, preserve pre-existing changes, stage only explicit files in `podledges/show-reg`, and include this plan. Report what was validated with the real PDF and mock providers separately from any actual live-provider exercise.

## Implementation results

- Implemented the MCXC444/CG2271 profile, version-2/custom configuration, strict cold/disk/memory identity gates, setup recommendation tool/UI, Helper Assistant model/thinking isolation, hardened cache bounds, and preview-only ESP32-S3-WROOM-1 metadata.
- The supplied 1,012-page MCX C44X manual produced 318 bounded register sections and passed identity and representative-register checks.
- Windows benchmark: 12,658 ms cold extraction; five fresh-loader disk-cache reads of 85, 157, 138, 129, and 171 ms; 138 ms median.
- Pi loader plus real-PDF/mock-provider suite: 12/12 passing. No live provider was called.
- Lower-capability usability probe: pass; the CG2271 natural-language scenario needs one `show_register` call, no model file navigation, no extra typing when configured, and one confirmation click on successful first use.
- `npm pack --dry-run`: 22.5 kB compressed, 74.6 kB unpacked, six runtime files.
