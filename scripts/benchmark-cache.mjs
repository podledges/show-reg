import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createManualLoader } from "../extensions/show-reg/core.ts";

const manual = process.env.SHOW_REG_TEST_MANUAL;
if (!manual) throw new Error("Set SHOW_REG_TEST_MANUAL to the MCX-C44X reference manual PDF.");

const root = await mkdtemp(join(tmpdir(), "show-reg-benchmark-"));
const config = {
  version: 2,
  device: { profile: "mcxc444-cg2271" },
  manual: resolve(manual),
  pdftotext: "pdftotext",
  model: "current",
  thinking: "medium",
  preference: "accuracy",
};

try {
  const start = performance.now();
  const cold = await createManualLoader()(root, config);
  const coldMs = performance.now() - start;
  const warmMs = [];
  for (let run = 0; run < 5; run++) {
    const before = performance.now();
    await createManualLoader()(root, config);
    warmMs.push(performance.now() - before);
  }
  const ordered = [...warmMs].sort((a, b) => a - b);
  console.log(JSON.stringify({ pages: cold.pages.length, registers: cold.registers.length,
    coldMs: Math.round(coldMs), warmMs: warmMs.map(Math.round), medianWarmMs: Math.round(ordered[2]) }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
