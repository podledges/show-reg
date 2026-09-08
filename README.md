# show-reg

Pi extension for looking up MCU registers in a local reference manual.

## Install

This repository is private. Your GitHub account needs access, and Git must be authenticated.

```sh
pi install git:github.com/podledges/show-reg
```

Or install a local clone with `pi install /path/to/show-reg`. Run `/reload` in Pi after installation.

## Use

```text
/show-reg-config
/show-reg MCG->C1
/show-reg-config show
/show-reg cancel
```

Setup asks for the target device, PDF filepath, existing `pdftotext` executable, model and preference. Absolute and project-relative PDF paths work, including quoted Windows paths. Nothing is downloaded automatically.

Settings live in `.pi/show-reg.json` in the working project's Git root, or the current directory outside a Git repository. Keep that file out of version control. No credentials are saved in it. Existing `.pi/show-me.json` settings are still read until new settings are saved.

The extension searches the PDF locally, then sends only the matching register pages to the selected model. It returns a bit table, field meanings, binary encodings and citations. Typos or ambiguous names get suggestions before a model is called. A bare `/show-reg` prompts for a register.

`current` uses your active model. `automatic` estimates text cost from positive registry prices when you choose cost; otherwise it uses the current model. It does not benchmark quality or speed. The main chat model is not changed.

Requires Pi (tested with 0.84.1) and `pdftotext`. Optional `pdftoppm` supplies page images to image-capable models. The parser is tested against the MCX-C44X reference manual; other PDF layouts may need parser changes. Scanned PDFs need OCR first.

[Commands and setup](extensions/show-reg/index.ts) · [PDF search](extensions/show-reg/core.ts)

## Tests

With Node.js 22.18+ or 24+:

```sh
npm test
```

For optional real-manual tests, set `SHOW_REG_TEST_MANUAL` to the MCX-C44X reference PDF's absolute path. Set `PI_PACKAGE_PATH` to the installed Pi package directory if it is not detected. Tests do not call a model provider. No datasheets are bundled.
