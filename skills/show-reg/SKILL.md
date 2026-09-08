---
name: show-reg
description: Look up MCU hardware registers from the project's configured local reference manual. Use when the user asks what a register or bit field means, requests encodings or access behavior, or names forms such as MCG_C1 or MCG->C1.
---

# Show Register

Call `show_register` with the most specific peripheral/register identifier present in the request.

- Return the tool's sourced explanation directly. Do not rewrite bit values, access rules, reset values, side effects, or citations from memory.
- If the tool returns several candidates, ask the user to choose one; do not silently pick an ambiguous abbreviation.
- If setup is required, let the extension perform its one-time detection flow. Do not search the repository or parse the PDF manually first.
- For multiple registers, call the tool once per register so each result stays bounded to its own manual section.
- If the tool reports missing or uncertain source evidence, preserve that uncertainty.
