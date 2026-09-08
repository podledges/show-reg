---
name: show-reg
description: Look up MCU hardware registers from the project's configured local reference manual. Use when the user asks what a register or bit field means, requests encodings or access behavior, or names forms such as MCG_C1 or MCG->C1.
---

# Show Register

For a register question, call `show_register` directly with the most specific peripheral/register identifier present in the request. Do this even when setup may be new: `show_register` owns the one-confirm first-use flow, so do not inspect setup first.

- Return the tool's sourced explanation directly. Do not rewrite bit values, access rules, reset values, side effects, or citations from memory.
- If the tool returns several candidates, ask the user to choose one; do not silently pick an ambiguous abbreviation.
- Call `show_register_setup` only when the user explicitly asks to preview/explain setup, or after `show_register` reports that setup needs attention. Present its recommended answers and evidence, then tell the user `/show-reg-config` accepts them in one confirmation or lets them review each field. Do not search the repository or parse the PDF manually first.
- Do not claim an ESP32-S3-WROOM-1 lookup works while its profile says preview; that profile is metadata-only until parser fixtures pass.
- For multiple registers, call the tool once per register so each result stays bounded to its own manual section.
- If the tool reports missing or uncertain source evidence, preserve that uncertainty.
