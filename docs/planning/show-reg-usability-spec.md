# show-reg usability specification

Status: **approved product direction; implementation pending**  
Stable path: [`docs/planning/show-reg-usability-spec.md`](./show-reg-usability-spec.md)  
Implementation baseline: repository revision [`d6878406556118fe75e2fb3e6842af7f88cd6445`](https://github.com/podledges/show-reg/commit/d6878406556118fe75e2fb3e6842af7f88cd6445)

This document is the public implementation contract for improving show-reg lookup, setup, accuracy, and latency. It intentionally contains no reference-manual text, private PDFs, machine-specific paths, credentials, or private test/session metadata.

## Goals

1. Accept natural register/module and field lookup, including:
   - `/show-reg MCG->C1`
   - `/show-reg MCG->C1, CLKS`
   - `/show-reg TPM0,TOF`
2. Let an agent or skill choose evidence-grounded search terms while keeping actual PDF lookup deterministic.
3. Support one or more configured PDF documents without repeatedly extracting unchanged documents.
4. Preserve the existing full-register output shape while focusing prose on the requested field(s) and important, evidenced caveats.
5. Inherit the invoking session's current provider, exact model, and effective thinking/effort rather than pinning a second model in configuration.
6. Make setup easy by packaging or automatically provisioning a coordinate-capable PDF extractor. The exact packaging and licensing strategy is not yet decided.

## Non-goals and safety boundaries

- Do not fabricate a unique register, bit position, encoding, reset, access type, reserved-bit behavior, relationship, or cross-manual precedence.
- Do not combine terms found in unrelated registers or documents into a synthetic AND match.
- Do not upload page images without a separate explicit product decision. Local table parsing is the approved accuracy direction.
- Do not commit PDFs, extracted manual text, indexes, or caches. Do not expose local absolute paths in generated answers, diagnostics intended for sharing, or tests.
- Do not bundle copyrighted manuals or use private manuals in CI.
- Preserve the existing answer format unless this specification explicitly changes its selection/focus behavior.

## User experience

### Configuration

The manual setting is a **comma-separated value containing one or more PDF paths**.

Parsing follows standard CSV quoting rules:

```text
reference.pdf,peripheral-guide.pdf
"manual, rev2.pdf",other.pdf
```

- Trim whitespace outside an unquoted or quoted CSV field.
- Preserve whitespace inside quotes.
- Represent a literal quote inside a quoted field with `""`.
- Preserve configured document order.
- A single unquoted path remains backward compatible, including paths containing spaces.
- A path containing a literal comma must be quoted.
- Never split on spaces, Windows drive colons, or platform path separators.
- Reject an empty list, empty entries, malformed quoting, unreadable/non-file entries, duplicate resolved files, and extraction/indexing failures with an error naming the document ordinal and a privacy-safe display name.
- Validate every document before replacing a previously valid configuration.

The normal wizard should ask only for information the extension cannot safely derive. Model and speed/accuracy prompts must not remain if lookup always inherits the current session and the preference has no behavioral effect. Users should not have to locate or type an extractor executable in the ordinary setup path.

The requested outcome is that a compatible `pdftotext`-class extractor is packaged or automatically provisioned. It must support word coordinates equivalent to Poppler TSV/bounding-box output, work offline after installation, and have a maintainable Windows, Linux, and NixOS story. **Open decision:** exact distribution mechanism, supported platform matrix, binary provenance, update/verification process, package-size budget, and license/source-offer compliance. Approval to pursue packaging is not approval for an unreviewed binary redistribution or downloader.

### Query semantics

The user may supply free-form terms; punctuation such as `->`, commas, and whitespace are separators/aliases rather than a rigid command grammar. An agent/skill may derive better register, module, and field terms from the request, but it must call the deterministic local lookup rather than searching or interpreting the PDF independently.

1. Normalize each term independently while preserving the original query for display.
2. Search register identifiers/titles/aliases, module or peripheral context, and indexed field names.
3. Evaluate **AND first**. Every term must be grounded in one logical register match within one configured document.
4. If one or more AND matches exist, return only those matches. Never append broader OR results.
5. Only if the AND intersection is empty, return the union as candidates under this exact class of prominent label: **“OR fallback — no intersection match for terms: …”**
6. A module such as `TPM0` is not automatically a register. Resolve `TPM0,TOF` by finding a TOF field in a register belonging to TPM0 in the manual. Never hardcode or invent `TPM0 → TPM0_SC`.
7. If multiple grounded matches remain, ask the user to disambiguate and show document-specific provenance. Do not call a renderer as though one match were unique.

For multiple documents, run these semantics per grounded register/document pair. Do not satisfy `A AND B` with `A` from one document/register and `B` from another. The same register in multiple documents remains multiple provenance-bearing matches. If revisions disagree, identify the conflict and require disambiguation; do not merge their bit maps.

**Open decision:** whether configured order establishes precedence between overlapping manuals. Until decided, order is deterministic display/search order only, not authority.

### Result format

For a unique match, retain the established format:

1. official register title and C expression;
2. complete highest-bit-first map of the matched register, split into descending 8-bit tables when wide;
3. focused explanations for AND-matched fields and important caveats;
4. document, section, and PDF-page citations, distinguishing printed page numbers when known.

Every citation must identify the specific configured document with a privacy-safe display name or ordinal. Cross-document candidates and conflicts cite each source separately.

The full map keeps neighboring bit positions visible. Detailed bullets need not expand every unrelated field. Access restrictions, side effects, operating constraints, and other important caveats relevant to safe use must remain visible when evidenced. Never infer unspecified reset/access/reserved behavior.

**Open decision:** “related bits” may mean only fields explicitly named by the matched field's description (recommended), but this policy is not yet approved. No adjacency, same-byte, naming, or hardcoded peripheral heuristic may establish relatedness.

## Architecture contract

### Deterministic extraction and index

Each document gets an independent extraction/index entry containing provenance and parser metadata. Extraction must provide word positions; plain text alone is insufficient for robust local table parsing.

The parser may index field names from grounded table/description structure, but must not infer bit ranges from unreliable geometry. A match carries its containing register and source span forward to rendering.

Persistent cache entries are:

- keyed and verified by a cryptographic digest of PDF bytes;
- invalidated by extractor identity/version/flags and explicit extraction, index-format, and field-parser versions;
- optionally checked against an extracted-text digest;
- written atomically and rebuilt after corruption or any verification mismatch;
- independent per document, so changing one PDF does not re-extract the others;
- private, uncommitted, and outside installed package source.

File size and modification time may be a fast precheck but are not sufficient invalidation. **Open decision:** project-local `.pi/` cache versus a user-level content-addressed cache. Either location must be private by default and documented for deletion.

### Agent and rendering paths

- **Chat:** the current agent selects evidence-grounded query terms, calls the deterministic tool, and renders the returned evidence in the required shape. Do not add an unnecessary isolated model request.
- **Slash command:** `/show-reg …` performs the same deterministic lookup and uses one dedicated rendering request because no main-agent turn is otherwise running.

Both paths inherit the provider, exact model, and effective thinking/effort active at invocation, including changes made during the session. Saved configuration must not pin a lookup model.

For the dedicated slash request, the supported direction is to use Pi's registry authentication and selected provider's `streamSimple` path with the session reasoning level. This preserves custom providers and Pi's normal effort clamping/mapping. The absence of a convenience `complete()` effort option is not evidence that inheritance is impossible. Do not use a deprecated compatibility helper that bypasses registry credentials or custom providers.

## Verified current defects versus requested features

These defects were verified against the baseline revision during earlier synthetic investigation; they are **not fixed by this specification**, and the historical test results below were not freshly rerun for this document.

| Verified defect | Baseline behavior | Required disposition |
|---|---|---|
| Raw image bytes | `renderPage` receives default UTF-8 string output and then treats it as a byte buffer, so PNG validation/rendering fails. | Add a regression test and correct byte handling only if an image path is retained. Do not enable image upload without permission. |
| Query normalization / field index | The whole query is stripped into one token; there is no term split or field index. | Replace with the deterministic semantics above. |
| Inert speed setting | `speed` does not change extraction, lookup, prompt, renderer, or model choice. | Remove inert configuration or define tested behavior; session inheritance makes removal the expected direction. |
| Blank executable prompt | The suggested extractor command is placeholder text, but submitting blank is invalid. | Eliminate the ordinary executable prompt through the approved easy-setup outcome. |

Requested features, not existing behavior: coordinate-aware local parsing, skill-guided term selection, multi-document CSV configuration, persistent per-document caches, AND-first field lookup, focused explanations, and split chat/slash rendering with session inheritance.

A historical synthetic run reported nine passing tests and one optional real-manual test skipped. It also demonstrated mangled 32-bit layout text and cheap in-process fixture extraction. These results are evidence for planning only, not a current test run, production benchmark, or delivered fix.

## Smallest safe implementation order

1. **Resolve packaging and policy decisions.** Select a legally supportable extractor distribution, cache location, supported platforms, related-bit rule, and cross-manual precedence behavior. Record licenses/provenance and threat/privacy considerations.
2. **Build local foundations.** Simplify config, parse CSV paths, validate all documents, implement coordinate extraction/parser and private per-document persistent cache, and address applicable verified defects. No model calls.
3. **Implement deterministic lookup.** Add register/module/field indexes, AND-first and labeled-OR behavior, grounded ambiguity/conflict results, and document-specific provenance.
4. **Integrate agent and renderers.** Add skill/tool guidance for chat, dedicated slash rendering, session provider/model/effort inheritance, and frozen output-shape checks. Avoid duplicate chat requests.
5. **Run bounded compatibility checks.** Only after synthetic tests pass, opt in locally to a small, documented set of legally available/manual-owner-supplied real manuals. Never upload or commit them.

Each step must preserve the last working single-PDF flow or be guarded by a documented migration.

## Acceptance and test plan

All required CI fixtures are synthetic and generated or permissively licensed.

### Correctness

- CSV tests cover one path, multiple paths, spaces, Windows drive syntax, quoted commas, escaped quotes, surrounding whitespace, malformed quoting, empty entries, duplicates, and atomic all-document validation.
- `/show-reg MCG->C1, CLKS` uniquely returns the grounded `MCG_C1` fixture and focuses CLKS.
- `/show-reg TPM0,TOF` uniquely returns the fixture register that actually contains TOF; sibling `TPM0` registers and another module's TOF do not become the result.
- `TOF` with two valid containing registers returns two cited candidates and makes no rendering call.
- A zero-intersection query returns a visibly labeled OR fallback; any non-empty AND result suppresses OR.
- Multi-document tests prove terms cannot be joined across documents/registers, same-name results retain separate provenance, conflicts are not merged, and configured order is stable.
- A complete matched-register map is emitted while detailed prose focuses on selected/evidenced related fields and caveats.
- Tests assert that unspecified reserved/reset/access semantics never appear as facts.
- Cache tests change PDF bytes while preserving size/mtime, extractor/parser versions, and one of several documents; only stale entries rebuild. Corrupt/partial entries rebuild safely.
- Chat makes no isolated rendering request. Slash makes at most one. Both observe the current provider/model/effective effort at invocation, including mid-session changes and custom providers.
- No test invokes a paid provider, includes a private PDF, or snapshots nondeterministic model prose.

### Latency and observability

Measure extraction, index load/rebuild, deterministic search, and rendering separately.

- A warm lookup over the synthetic multi-document fixture starts **zero extractor child processes** and completes local cache-load plus search in **≤250 ms p95** over at least 20 runs on CI's reference runner.
- Changing one document invokes extraction exactly once for that document and zero times for unchanged documents.
- Chat uses the existing agent turn only; slash uses one dedicated request. Tests fail on duplicate model requests.
- Provider wall time is reported separately and is not disguised as extraction/search time. A 180-second safety timeout remains an upper bound, not an acceptable latency target.

After synthetic acceptance, maintainers may run bounded checks against a small set of local real manuals: expected register/page fixtures, no source upload, warm local lookup target **≤1 second**, and no copyrighted output committed. Record only aggregate timing and pass/fail data.

## Privacy, security, and licensing

- Treat queries, PDF text, filenames, and extracted metadata as untrusted data.
- Use argument arrays, never shell interpolation.
- Send only bounded matched source spans to the selected renderer; do not send unrelated documents/pages.
- Cache permissions should be user-only where supported. Cache paths and contents stay out of Git, package artifacts, logs, and error reports.
- Document cache removal and migration. Never place mutable cache data inside the installed extension clone.
- Before distributing any extractor, publish its license, source/provenance, checksums/signature policy, supported versions/platforms, update policy, and offline behavior. Do not assume Poppler is a small standalone binary or that redistribution obligations are satisfied.

## Implementation issues

No pre-existing issues were present when this specification was prepared. The sequenced issue set will be linked here after publication:

1. Resolve extractor packaging and open policy decisions — pending
2. Build multi-document extraction, configuration, and cache foundations — pending
3. Implement grounded natural AND-first lookup across documents — pending
4. Integrate skill-guided chat and session-inheriting slash rendering — pending

## Remaining product decisions

1. Exact extractor packaging/provisioning, licensing compliance, supported platforms, and size/security budget.
2. Project-local versus user-level private cache location.
3. Evidence rule for “related bits.”
4. Whether document order establishes precedence for overlapping/conflicting manuals; until resolved, it does not.
