import { describe, test, expect } from "bun:test";
import {
  buildSearchUrl,
  parseJobCards,
  normalizeDate,
  matchesJobage,
  parseDetailPage,
  decodeHtmlEntities,
} from "../src/helpers";
import { normalizeInput } from "../src/commands/detail";

describe("buildSearchUrl", () => {
  test("no query/location -> browse-all path", () => {
    expect(buildSearchUrl(undefined, undefined, 1)).toBe("https://www.jobleads.com/us/jobs");
  });

  test("query only", () => {
    expect(buildSearchUrl("business development", undefined, 1)).toBe(
      "https://www.jobleads.com/us/jobs/q/business%20development",
    );
  });

  test("location only", () => {
    expect(buildSearchUrl(undefined, "Denver CO", 1)).toBe("https://www.jobleads.com/us/jobs/l/Denver%20CO");
  });

  test("query and location combined", () => {
    expect(buildSearchUrl("director", "Austin TX", 1)).toBe(
      "https://www.jobleads.com/us/jobs/q/director/l/Austin%20TX",
    );
  });

  test("page > 1 appends ?page=n; page 1 omits it", () => {
    expect(buildSearchUrl("director", undefined, 3)).toBe("https://www.jobleads.com/us/jobs/q/director?page=3");
    expect(buildSearchUrl("director", undefined, 1)).toBe("https://www.jobleads.com/us/jobs/q/director");
  });

  test("blank query/location strings are treated as absent", () => {
    expect(buildSearchUrl("  ", "  ", 1)).toBe("https://www.jobleads.com/us/jobs");
  });
});

// A minimal but real-shaped search-results fragment, modeled on a live response captured
// during this skill's investigation (2026-09-10) - two cards, one with a salary chip and
// one without, to exercise the optional-field paths.
function searchCardsHtml(): string {
  return `<div class="search-list-content" role="list"><div class="search-job-card" data-testid="search-job-card" role="listitem"><a data-testid="search-job-card-link" href="/us/job/business-development-director--denver--e40c098bc5f9d671b4c65b64530d9c0ba">Business Development Director</a><p data-testid="search-job-card-company"><span data-testid="search-job-card-company-name" data-v-e48c834f>BDO USA</span><span data-v-e48c834f> • Denver (CO)</span></p><div data-testid="search-job-card-chips"><div data-testid="job-card-chip-work-setting" data-v-0ce57a95><span><span data-v-0ce57a95>On-site</span></span></div><div data-testid="job-card-chip-salary" data-v-0ce57a95><span><span data-v-0ce57a95>USD 130,000 - 170,000</span></span></div></div><span data-testid="job-card-date" data-v-73c1e12a>14 days+</span></div><div class="search-job-card" data-testid="search-job-card" role="listitem"><a data-testid="search-job-card-link" href="/us/job/sales-director--louisville--e619a7b2ada998b7383ab9061f89dbff5">Sales Director</a><p data-testid="search-job-card-company"><span data-testid="search-job-card-company-name" data-v-e48c834f>Eldorado Climbing</span><span data-v-e48c834f> • Louisville (CO)</span></p><div data-testid="search-job-card-chips"><div data-testid="job-card-chip-work-setting" data-v-0ce57a95><span><span data-v-0ce57a95>On-site</span></span></div></div><span data-testid="job-card-date" data-v-73c1e12a>3 days ago</span></div></div>`;
}

describe("parseJobCards", () => {
  test("extracts id, title, company, location, and url for each card", () => {
    const cards = parseJobCards(searchCardsHtml());
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      id: "e40c098bc5f9d671b4c65b64530d9c0ba",
      title: "Business Development Director",
      company: "BDO USA",
      location: "Denver (CO)",
      url: "https://www.jobleads.com/us/job/business-development-director--denver--e40c098bc5f9d671b4c65b64530d9c0ba",
      workSetting: "On-site",
      salary: "USD 130,000 - 170,000",
    });
  });

  test("location has the raw bullet character stripped", () => {
    const cards = parseJobCards(searchCardsHtml());
    expect(cards[0].location).not.toContain("•");
  });

  test("a card with no salary chip gets salary: null, not a missing field", () => {
    const cards = parseJobCards(searchCardsHtml());
    expect(cards[1].salary).toBeNull();
    expect(cards[1].workSetting).toBe("On-site");
  });

  test("relative dates are normalized ('N days ago' -> ISO, capped label kept verbatim)", () => {
    const cards = parseJobCards(searchCardsHtml());
    expect(cards[0].date).toBe("14 days+");
    expect(cards[1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("returns an empty array when no card markers are present", () => {
    expect(parseJobCards("<div>no results</div>")).toEqual([]);
  });

  test("one malformed card does not break parsing of the rest", () => {
    const broken =
      `<div data-testid="search-job-card">garbage, no link or id here</div>` + searchCardsHtml();
    const cards = parseJobCards(broken);
    expect(cards).toHaveLength(2);
  });
});

describe("normalizeDate", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  test("'Today' -> today's ISO date", () => {
    expect(normalizeDate("Today", now)).toBe("2026-09-10");
  });

  test("'Yesterday' -> yesterday's ISO date", () => {
    expect(normalizeDate("Yesterday", now)).toBe("2026-09-09");
  });

  test("'N days ago' -> ISO date N days back", () => {
    expect(normalizeDate("9 days ago", now)).toBe("2026-09-01");
  });

  test("the capped '14 days+' label is kept verbatim, not fabricated into a fake ISO date", () => {
    expect(normalizeDate("14 days+", now)).toBe("14 days+");
  });

  test("null passes through as null", () => {
    expect(normalizeDate(null, now)).toBeNull();
  });
});

describe("matchesJobage", () => {
  test("no filter matches everything", () => {
    expect(matchesJobage("14 days+", undefined)).toBe(true);
  });

  test("an unknown/null date is not silently dropped by the filter", () => {
    expect(matchesJobage(null, 7)).toBe(true);
  });

  test("an ISO date within the window passes", () => {
    const recent = new Date().toISOString().slice(0, 10);
    expect(matchesJobage(recent, 7)).toBe(true);
  });

  test("an ISO date outside the window fails", () => {
    expect(matchesJobage("2020-01-01", 7)).toBe(false);
  });

  test("the capped '14 days+' label fails a narrower window (can't possibly qualify)", () => {
    expect(matchesJobage("14 days+", 7)).toBe(false);
  });

  test("the capped '14 days+' label passes a window at or above its own bound", () => {
    expect(matchesJobage("14 days+", 14)).toBe(true);
    expect(matchesJobage("14 days+", 30)).toBe(true);
  });
});

describe("normalizeInput (detail command)", () => {
  test("accepts a bare hex id", () => {
    expect(normalizeInput("e40c098bc5f9d671b4c65b64530d9c0ba")).toEqual({
      id: "e40c098bc5f9d671b4c65b64530d9c0ba",
      url: "https://www.jobleads.com/us/job/job--e40c098bc5f9d671b4c65b64530d9c0ba",
    });
  });

  test("extracts the id from a full job URL and keeps the URL as-is", () => {
    const url = "https://www.jobleads.com/us/job/business-development-director--denver--e40c098bc5f9d671b4c65b64530d9c0ba";
    expect(normalizeInput(url)).toEqual({ id: "e40c098bc5f9d671b4c65b64530d9c0ba", url });
  });

  test("extracts the id even with a deliberately wrong slug (slug is decorative)", () => {
    const url = "https://www.jobleads.com/us/job/totally-wrong-slug--e40c098bc5f9d671b4c65b64530d9c0ba";
    expect(normalizeInput(url)?.id).toBe("e40c098bc5f9d671b4c65b64530d9c0ba");
  });

  test("returns null for unparseable input", () => {
    expect(normalizeInput("not-a-valid-id-or-url")).toBeNull();
  });
});

// A minimal but real-shaped detail-page fragment, modeled on a live posting captured during
// this skill's investigation (2026-09-10).
function detailPageHtml(): string {
  return `<html><body><div><h1 class="jlui-heading-5">Business Development Director</h1></div><h2 data-testid="job-preview-company"><span data-testid="job-preview-company-name">BDO USA</span></h2><div><div data-testid="job-card-chip-location"><span><h2>Denver (CO)</h2></span></div><div data-testid="job-card-chip-work-setting"><span><h2>On-site</h2></span></div><div data-testid="job-card-chip-salary"><span><h2>USD 130,000 - 170,000</h2></span></div><div data-testid="job-card-chip-contract-type"><span><h2>Full time</h2></span></div><span data-testid="job-card-date">14 days+</span></div><div data-testid="job-preview-description"><div><div>Job Summary:</div><p>Great <strong>role</strong> &amp; team.</p><ul><li>Own the pipeline</li></ul></div></div></body></html>`;
}

describe("parseDetailPage", () => {
  test("parses title, company, chips, date, and description from a real-shaped page", () => {
    const detail = parseDetailPage(detailPageHtml());
    expect(detail).not.toBeNull();
    expect(detail?.title).toBe("Business Development Director");
    expect(detail?.company).toBe("BDO USA");
    expect(detail?.location).toBe("Denver (CO)");
    expect(detail?.workSetting).toBe("On-site");
    expect(detail?.salary).toBe("USD 130,000 - 170,000");
    expect(detail?.employmentType).toBe("Full time");
    expect(detail?.date).toBe("14 days+");
  });

  test("description strips tags, decodes entities, and preserves block breaks", () => {
    const detail = parseDetailPage(detailPageHtml());
    expect(detail?.description).toBe("Job Summary:\nGreat role & team.\nOwn the pipeline");
  });

  test("returns null when the page carries no job-preview-company marker (challenge/redirect page)", () => {
    expect(parseDetailPage("<html><body>Just a moment...</body></html>")).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  test("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("Terms &amp; conditions")).toBe("Terms & conditions");
    expect(decodeHtmlEntities("Caf&#xE9;")).toBe("Café");
  });
});
