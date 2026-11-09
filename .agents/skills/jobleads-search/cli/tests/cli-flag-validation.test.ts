import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("jobleads CLI flag validation", () => {
  describe("numeric flag validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--jobage", "foo"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ARG");
      expect(err.error).toMatch(/jobage/);
    });

    test("boolean flag (no value) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--jobage"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    // Fractional values must be rejected, not truncated: parseInt("1.5") is 1, and a
    // silently-truncated jobage/page/limit would change what the search returns with no
    // error at all.
    for (const name of ["jobage", "page", "limit"]) {
      test(`--${name} fractional exits 1 with BAD_ARG instead of truncating`, async () => {
        const result = await runCLI(["search", `--${name}`, "1.5"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }

    for (const name of ["jobage", "page", "limit"]) {
      test(`--${name} 0 exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", `--${name}`, "0"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });
    }
  });

  describe("detail command", () => {
    test("missing id exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_ID");
    });

    test("unparseable id exits 1 with BAD_ID", async () => {
      const result = await runCLI(["detail", "not-a-valid-id-or-url"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_ID");
    });
  });

  describe("unknown command", () => {
    test("exits 1 with BAD_CMD", async () => {
      const result = await runCLI(["frobnicate"]);
      expect(result.exitCode).not.toBe(0);
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("BAD_CMD");
    });
  });
});

describe("unknown flag rejection", () => {
  // add-portal.md's contract: "a bogus flag or missing required arg exits 1 with a JSON
  // error on stderr". Rejection happens before dispatch, so these are network-free.
  test("a bogus --flag on search exits 1 with a JSON error instead of being silently discarded", async () => {
    const result = await runCLI(["search", "-q", "test", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("UNKNOWN_FLAG");
    expect(error.error).toContain("--bogus-flag");
  });

  test("a bogus --flag on detail exits 1 with a JSON error instead of being silently discarded", async () => {
    const result = await runCLI(["detail", "abc123def456", "--bogus-flag", "xyz"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error.code).toBe("UNKNOWN_FLAG");
  });
});
