# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run the full test suite with `npm test`; tests load the extension against Pi when `PI_PACKAGE_PATH` points to the installed `@earendil-works/pi-coding-agent` directory.
- Treat `README.md` as the portable behavior and installation contract; implementation boundaries live in `extensions/show-reg/core.ts` and `extensions/show-reg/index.ts`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
