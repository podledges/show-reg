---
name: show-reg
description: Look up MCU hardware registers from the project's configured local reference manual. Use when the user asks what a register or bit field means, requests encodings or access behavior, or names forms such as MCG_C1 or MCG->C1.
---

# Show Register

For a register question, call `show_register` directly with the most specific peripheral/register identifier present in the request. Do this even when setup may be new: `show_register` owns the one-confirm first-use flow, so do not inspect setup first.

- The tool displays bounded source locally and returns only status. Acknowledge that local display; the source is not available to the chat model for interpretation. Let the user select any locally displayed candidates.
- For an online explanation, tell the user to invoke `/show-reg explain <register>` themselves. That command permits only the matched register text, not pages/images. Ordinary tool calls never authorize online explanation.
- Call `show_register_setup` only for explicit setup questions or after a lookup failure requiring setup. It displays recommendations locally, not in its model-facing result. Tell the user `/show-reg-config` accepts or reviews them. Preserve this boundary rather than searching files or reading the PDF through other tools.
- Do not claim an ESP32-S3-WROOM-1 lookup works while its profile says preview; that profile is metadata-only until parser fixtures pass.
- For multiple registers, call the tool once per register so each result stays bounded to its own manual section.
- On failure, direct the user to the local diagnostic or `/show-reg-config`; avoid inventing source evidence.
