# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run the full test suite with `npm test`; prerequisites and validation limits are in `README.md` and CI provisioning in `.github/workflows/test.yml`. Pi/privacy coverage is mandatory, with synthetic PDFs and offline providers only.
- Treat `README.md` as the portable behavior and installation contract; implementation boundaries live in `extensions/show-reg/core.ts` and `extensions/show-reg/index.ts`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
