import { describe, test, expect } from "bun:test";
import { runCLI } from "./helpers";

const BOARD = "jobs.menlovc.com";

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

describe("Getro CLI flag validation (network-free)", () => {
  describe("--board", () => {
    test("missing --board exits 1 with NO_BOARD", async () => {
      const result = await runCLI(["search", "-q", "test"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("NO_BOARD");
    });

    test("a board value with no dot (not a hostname) exits 1 with NO_BOARD", async () => {
      const result = await runCLI(["search", "--board", "menlovc", "-q", "test"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("NO_BOARD");
    });
  });

  describe("unknown flag rejection", () => {
    // add-portal.md's contract: "a bogus flag or missing required arg exits 1 with a JSON
    // error on stderr" - a silently discarded flag is worse than an error (jobdanmark
    // precedent: a wrong flag name once returned the entire database as if it matched).
    test("a bogus --flag exits 1 with a JSON error instead of being silently discarded", async () => {
      const result = await runCLI(["search", "--board", BOARD, "-q", "test", "--bogus-flag", "xyz"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const error = JSON.parse(result.stderr);
      expect(error.code).toBe("UNKNOWN_FLAG");
      expect(error.error).toContain("--bogus-flag");
    });

    test("an unknown detail flag is also rejected", async () => {
      const result = await runCLI(["detail", "123", "--board", BOARD, "--nope", "x"]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).code).toBe("UNKNOWN_FLAG");
    });
  });

  describe("--page", () => {
    test("--page 2 exits 1 with PAGE_UNSUPPORTED rather than returning duplicate results", async () => {
      const result = await runCLI(["search", "--board", BOARD, "-q", "test", "--page", "2"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const err = parsedStderr(result.stderr);
      expect(err.code).toBe("PAGE_UNSUPPORTED");
      expect(err.error).toMatch(/api\.getro\.com/);
    });

    test("--page 1 (the default) passes flag validation", async () => {
      const result = await runCLI(["search", "--board", "not-a-real-board.invalid.test", "-q", "test", "--page", "1"]);
      // Fails later at fetch time (unreachable host), never at flag validation.
      expect(parsedStderr(result.stderr).code).not.toBe("PAGE_UNSUPPORTED");
      expect(parsedStderr(result.stderr).code).not.toBe("BAD_ARG");
    });
  });

  describe("numeric flag validation", () => {
    for (const name of ["jobage", "limit"]) {
      test(`--${name} non-numeric exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", "--board", BOARD, `--${name}`, "foo"]);
        expect(result.exitCode).not.toBe(0);
        const err = parsedStderr(result.stderr);
        expect(err.code).toBe("BAD_ARG");
        expect(err.error).toMatch(new RegExp(name));
      });

      test(`--${name} fractional exits 1 with BAD_ARG instead of truncating`, async () => {
        const result = await runCLI(["search", "--board", BOARD, `--${name}`, "1.5"]);
        expect(result.exitCode).not.toBe(0);
        expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
      });

      test(`--${name} 0 exits 1 with BAD_ARG`, async () => {
        const result = await runCLI(["search", "--board", BOARD, `--${name}`, "0"]);
        expect(result.exitCode).not.toBe(0);
        expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
      });
    }
  });

  describe("--format", () => {
    test("an invalid --format exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--board", BOARD, "--format", "xml"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });

    test("detail rejects table format (only json/plain)", async () => {
      const result = await runCLI(["detail", "1", "--board", BOARD, "--format", "table"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("--remote", () => {
    test("an invalid --remote value exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--board", BOARD, "--remote", "moon-base"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("--facet", () => {
    test("a --facet without '=' exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "--board", BOARD, "--facet", "justakey"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ARG");
    });
  });

  describe("detail", () => {
    test("missing <id> exits 1 with NO_ID", async () => {
      const result = await runCLI(["detail", "--board", BOARD]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("NO_ID");
    });

    test("a non-numeric, non-URL id exits 1 with BAD_ID", async () => {
      const result = await runCLI(["detail", "not-a-job-id", "--board", BOARD]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("BAD_ID");
    });

    test("a bare numeric id with no --board and no URL exits 1 with NO_BOARD", async () => {
      const result = await runCLI(["detail", "12345"]);
      expect(result.exitCode).not.toBe(0);
      expect(parsedStderr(result.stderr).code).toBe("NO_BOARD");
    });
  });

  describe("help", () => {
    test("no command prints help to stdout and exits 1", async () => {
      const result = await runCLI([]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("getro-cli");
    });

    test("--help exits 0 and prints usage", async () => {
      const result = await runCLI(["search", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("USAGE");
    });
  });
});
