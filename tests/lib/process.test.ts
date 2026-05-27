import { describe, expect, it } from "bun:test";

import { buildPlannotatorArgs } from "../../src/lib/process.js";

const BIN = "/usr/local/bin/plannotator";
const PLAN = "/data/plannotator/sessions/s1/plan.md";

describe("buildPlannotatorArgs", () => {
  it("plan mode → `annotate <planPath>` (default mode must open the annotation server)", () => {
    // Regression: plan mode previously produced a bare `[binary]` invocation,
    // which is plannotator's stdin hook-integration mode — it reads EOF and
    // exits 0 immediately, so the HTTP server never binds ("failed to start").
    expect(buildPlannotatorArgs(BIN, "plan", PLAN)).toEqual([
      BIN,
      "annotate",
      PLAN,
    ]);
  });

  it("annotate mode → `annotate <planPath>`", () => {
    expect(buildPlannotatorArgs(BIN, "annotate", PLAN)).toEqual([
      BIN,
      "annotate",
      PLAN,
    ]);
  });

  it("review mode → `review`", () => {
    expect(buildPlannotatorArgs(BIN, "review", PLAN)).toEqual([BIN, "review"]);
  });

  it("archive mode → `archive`", () => {
    expect(buildPlannotatorArgs(BIN, "archive", PLAN)).toEqual([
      BIN,
      "archive",
    ]);
  });

  it("never emits a bare invocation (every mode carries a subcommand)", () => {
    for (const mode of ["plan", "annotate", "review", "archive"] as const) {
      expect(buildPlannotatorArgs(BIN, mode, PLAN).length).toBeGreaterThan(1);
    }
  });
});
