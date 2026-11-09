import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

// These assert on validation error codes that are emitted BEFORE any network
// call, so the suite is network-free.

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("greenhouse CLI flag validation", () => {
  describe("--company is required", () => {
    test("search without --company exits 1 with MISSING_COMPANY", async () => {
      const result = await runCLI(["search", "-q", "engineer"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("MISSING_COMPANY");
    });

    test("detail without --company exits 1 with MISSING_COMPANY", async () => {
      const result = await runCLI(["detail", "123"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("MISSING_COMPANY");
    });

    test("a blank --company exits 1 with MISSING_COMPANY", async () => {
      const result = await runCLI(["search", "--company", "   "]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("MISSING_COMPANY");
    });
  });

  describe("numeric flag validation", () => {
    for (const name of ["jobage", "page", "limit"]) {
      test(`--${name} non-numeric exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", "--company", "anthropic", `--${name}`, "foo"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });

      test(`--${name} fractional exits 1 with BAD_ARG instead of truncating`, async () => {
        const result = await runCLI(["search", "--company", "anthropic", `--${name}`, "1.5"]);
        expect(result.exitCode).not.toBe(0);
        expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
      });

      test(`--${name} 0 exits 1 with BAD_ARG (0 silently disables the filter)`, async () => {
        const result = await runCLI(["search", "--company", "anthropic", `--${name}`, "0"]);
        expect(result.exitCode).not.toBe(0);
        expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
      });
    }

    test("valid integers produce no BAD_ARG (network-independent check)", async () => {
      const result = await runCLI(["search", "--company", "anthropic", "--jobage", "7", "--page", "1", "--limit", "1"]);
      expect(parsedStderr(result.stderr).code).not.toBe("BAD_ARG");
    });
  });

  describe("detail argument validation", () => {
    test("missing id exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail", "--company", "anthropic"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("NO_ID");
    });

    test("an unparseable id exits 1 with BAD_ID (no network)", async () => {
      const result = await runCLI(["detail", "not-an-id", "--company", "anthropic"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
    });
  });

  describe("command dispatch", () => {
    test("unknown command exits 1 with BAD_CMD", async () => {
      const result = await runCLI(["frobnicate"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_CMD");
    });

    test("no command prints help and exits 1", async () => {
      const result = await runCLI([]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toMatch(/USAGE/);
    });
  });

  describe("unknown flag rejection", () => {
    // add-portal.md's contract: "a bogus flag or missing required arg exits 1
    // with a JSON error on stderr." A silently discarded flag is worse than an
    // error — it changes what the search returns with no signal.
    test("a bogus --flag exits 1 with a JSON error instead of being silently discarded", async () => {
      const result = await runCLI(["search", "--company", "anthropic", "--bogus-flag", "xyz"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const error = JSON.parse(result.stderr);
      expect(error.code).toBe("UNKNOWN_FLAG");
      expect(error.error).toContain("--bogus-flag");
    });
  });
});
