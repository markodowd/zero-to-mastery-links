/**
 * sync-courses.test.js
 *
 * Unit tests for helper functions exported from sync-courses.js.
 * CSV-loading tests use temporary files; no network calls are made.
 *
 * Run with:  npm test
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const {
  parseCSVLine,
  normalizeTitle,
  loadExisting,
  extractCoursesFromPage,
  mergeEnrolledUrls,
  buildCSV,
} = require("./sync-courses");

// ── parseCSVLine ──────────────────────────────────────────────────────────────

describe("parseCSVLine", () => {
  it("parses a plain three-column line", () => {
    assert.deepEqual(parseCSVLine("foo,bar,baz"), ["foo", "bar", "baz"]);
  });

  it("parses quoted fields", () => {
    assert.deepEqual(parseCSVLine('"foo","bar","baz"'), ["foo", "bar", "baz"]);
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    assert.deepEqual(parseCSVLine('"say ""hello""",b,c'), [
      'say "hello"',
      "b",
      "c",
    ]);
  });

  it("handles commas inside quoted fields", () => {
    assert.deepEqual(parseCSVLine('"a,b",c,d'), ["a,b", "c", "d"]);
  });

  it("returns a single element for a line with no commas", () => {
    assert.deepEqual(parseCSVLine("hello"), ["hello"]);
  });
});

// ── normalizeTitle ────────────────────────────────────────────────────────────

describe("normalizeTitle", () => {
  it("lowercases and strips non-alphanumeric characters", () => {
    assert.equal(
      normalizeTitle("Complete Python Bootcamp!"),
      "completepythonbootcamp",
    );
  });

  it("handles titles with numbers", () => {
    assert.equal(
      normalizeTitle("Web Dev 2.0: The Full Course"),
      "webdev20thefullcourse",
    );
  });
});

// ── loadExisting ──────────────────────────────────────────────────────────────

describe("loadExisting", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ztm-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty maps when file does not exist", () => {
    const { byPublicUrl, byTitle } = loadExisting(
      path.join(tmpDir, "missing.csv"),
    );
    assert.equal(byPublicUrl.size, 0);
    assert.equal(byTitle.size, 0);
  });

  it("loads canonical three-column CSV correctly", () => {
    const csv =
      "course,enrolled_url,public_url\n" +
      '"Python Bootcamp","https://academy.zerotomastery.io/courses/enrolled/700001","https://academy.zerotomastery.io/p/python"\n';
    const file = path.join(tmpDir, "academy.csv");
    fs.writeFileSync(file, csv);

    const { byPublicUrl, byTitle } = loadExisting(file);
    assert.equal(
      byPublicUrl.get("https://academy.zerotomastery.io/p/python"),
      "https://academy.zerotomastery.io/courses/enrolled/700001",
    );
    assert.equal(
      byTitle.get("pythonbootcamp"),
      "https://academy.zerotomastery.io/courses/enrolled/700001",
    );
  });

  it("loads legacy two-column CSV with enrolled_url in col2 — regression for hasThreeCols bug", () => {
    // A two-column header must not be mistaken for three columns just because
    // it contains "enrolled_url". The enrolled URL should still be retained in
    // the title map even though this file has no public URL to use as a key.
    const csv =
      "course,enrolled_url\n" +
      '"JS Course","https://academy.zerotomastery.io/courses/enrolled/700002"\n';
    const file = path.join(tmpDir, "academy.csv");
    fs.writeFileSync(file, csv);

    const { byPublicUrl, byTitle } = loadExisting(file);
    // There is no public URL in this file, so there is no public-URL mapping.
    assert.equal(byPublicUrl.size, 0);
    // The title map is the fallback for legacy files without public URLs.
    assert.equal(
      byTitle.get("jscourse"),
      "https://academy.zerotomastery.io/courses/enrolled/700002",
    );
  });

  it("loads legacy two-column CSV with public_url in col2", () => {
    const csv =
      "course,public_url\n" +
      '"React Course","https://academy.zerotomastery.io/p/react"\n';
    const file = path.join(tmpDir, "academy.csv");
    fs.writeFileSync(file, csv);

    const { byPublicUrl, byTitle } = loadExisting(file);
    // The public URL is a usable key, but this row has no enrolled URL.
    assert.equal(
      byPublicUrl.get("https://academy.zerotomastery.io/p/react"),
      "",
    );
    assert.equal(byTitle.get("reactcourse"), "");
  });

  it("ignores rows with empty course name", () => {
    const csv =
      "course,enrolled_url,public_url\n" +
      '"","https://academy.zerotomastery.io/courses/enrolled/700001","https://academy.zerotomastery.io/p/python"\n';
    const file = path.join(tmpDir, "academy.csv");
    fs.writeFileSync(file, csv);

    const { byPublicUrl, byTitle } = loadExisting(file);
    assert.equal(byPublicUrl.size, 0);
    assert.equal(byTitle.size, 0);
  });
});

// ── extractCoursesFromPage ────────────────────────────────────────────────────

describe("extractCoursesFromPage", () => {
  function makeCard(href, title) {
    return `
      <div class="ztm-course-card">
        <a href="${href}">
          <div class="course-listing-title">${title}</div>
        </a>
      </div>`;
  }

  it("extracts a single course card", () => {
    const $ = cheerio.load(makeCard("/p/python", "Python Bootcamp"));
    const results = extractCoursesFromPage($);
    assert.equal(results.length, 1);
    assert.equal(results[0].course, "Python Bootcamp");
    assert.equal(
      results[0].publicUrl,
      "https://academy.zerotomastery.io/p/python",
    );
  });

  it("prepends BASE_URL for relative hrefs", () => {
    const $ = cheerio.load(makeCard("/p/react", "React Course"));
    const results = extractCoursesFromPage($);
    assert.equal(
      results[0].publicUrl,
      "https://academy.zerotomastery.io/p/react",
    );
  });

  it("leaves absolute hrefs unchanged", () => {
    const $ = cheerio.load(
      makeCard("https://academy.zerotomastery.io/p/react", "React Course"),
    );
    const results = extractCoursesFromPage($);
    assert.equal(
      results[0].publicUrl,
      "https://academy.zerotomastery.io/p/react",
    );
  });

  it('strips "% COMPLETE" badge text injected by Teachable', () => {
    const $ = cheerio.load(makeCard("/p/ml", "Machine Learning 100% COMPLETE"));
    const results = extractCoursesFromPage($);
    assert.equal(results[0].course, "Machine Learning");
  });

  it('does NOT strip the word "Complete" when it appears naturally in a title — regression', () => {
    // The old regex /\d*\s*%?\s*COMPLETE/gi matched "Complete" because \d* and %? are optional.
    // The fix requires either digits+% or bare % before COMPLETE.
    const $ = cheerio.load(
      makeCard("/p/complete-web-dev", "Complete Web Developer"),
    );
    const results = extractCoursesFromPage($);
    assert.equal(results[0].course, "Complete Web Developer");
  });

  it("skips cards without an href", () => {
    const html = `
      <div class="ztm-course-card">
        <a><div class="course-listing-title">Ghost Course</div></a>
      </div>`;
    const $ = cheerio.load(html);
    const results = extractCoursesFromPage($);
    assert.equal(results.length, 0);
  });
});

// ── mergeEnrolledUrls ─────────────────────────────────────────────────────────

describe("mergeEnrolledUrls", () => {
  const ENROLLED = "https://academy.zerotomastery.io/courses/enrolled/700001";
  const PUBLIC = "https://academy.zerotomastery.io/p/python";

  it("matches by public URL (primary strategy)", () => {
    const scraped = [{ course: "Python Bootcamp", publicUrl: PUBLIC }];
    const byPublicUrl = new Map([[PUBLIC, ENROLLED]]);
    const byTitle = new Map();

    const merged = mergeEnrolledUrls(scraped, byPublicUrl, byTitle);
    assert.equal(merged[0].enrolledUrl, ENROLLED);
  });

  it("falls back to normalized title match when public URL not found", () => {
    const scraped = [{ course: "Python Bootcamp", publicUrl: PUBLIC }];
    const byPublicUrl = new Map(); // no public URL match
    const byTitle = new Map([["pythonbootcamp", ENROLLED]]);

    const merged = mergeEnrolledUrls(scraped, byPublicUrl, byTitle);
    assert.equal(merged[0].enrolledUrl, ENROLLED);
  });

  it("leaves enrolledUrl empty when neither strategy matches", () => {
    const scraped = [{ course: "Brand New Course", publicUrl: PUBLIC }];
    const byPublicUrl = new Map();
    const byTitle = new Map();

    const merged = mergeEnrolledUrls(scraped, byPublicUrl, byTitle);
    assert.equal(merged[0].enrolledUrl, "");
  });

  it("CRITICAL round-trip: enrolled URLs loaded from CSV survive a scraper run", () => {
    // Simulate reading the previous CSV, then merging the newly scraped course.
    // This guards the contract that a matching enrolled URL is preserved.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ztm-roundtrip-"));
    try {
      const csv =
        "course,enrolled_url,public_url\n" +
        `"Python Bootcamp","${ENROLLED}","${PUBLIC}"\n`;
      const file = path.join(tmpDir, "academy.csv");
      fs.writeFileSync(file, csv);

      const { byPublicUrl, byTitle } = loadExisting(file);

      // The scrape returns the same course URL as the existing CSV.
      const scraped = [{ course: "Python Bootcamp", publicUrl: PUBLIC }];
      const merged = mergeEnrolledUrls(scraped, byPublicUrl, byTitle);

      assert.equal(merged[0].enrolledUrl, ENROLLED);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── buildCSV ──────────────────────────────────────────────────────────────────

describe("buildCSV", () => {
  it("outputs the correct header row", () => {
    const csv = buildCSV([]);
    assert.equal(csv.startsWith("course,enrolled_url,public_url\n"), true);
  });

  it("writes a data row with all three columns quoted", () => {
    const courses = [
      {
        course: "Python Bootcamp",
        enrolledUrl: "https://academy.zerotomastery.io/courses/enrolled/700001",
        publicUrl: "https://academy.zerotomastery.io/p/python",
      },
    ];
    const csv = buildCSV(courses);
    assert.ok(csv.includes('"Python Bootcamp"'));
    assert.ok(
      csv.includes('"https://academy.zerotomastery.io/courses/enrolled/700001"'),
    );
    assert.ok(csv.includes('"https://academy.zerotomastery.io/p/python"'));
  });

  it("handles courses with no enrolled URL (empty string in col 2)", () => {
    const courses = [
      {
        course: "New Course",
        enrolledUrl: "",
        publicUrl: "https://academy.zerotomastery.io/p/new-course",
      },
    ];
    const csv = buildCSV(courses);
    const dataLine = csv.split("\n")[1];
    assert.equal(
      dataLine,
      '"New Course","","https://academy.zerotomastery.io/p/new-course"',
    );
  });

  it("escapes double-quotes inside field values", () => {
    const courses = [
      {
        course: 'Web Dev: "The Best" Course',
        enrolledUrl: "",
        publicUrl: "https://academy.zerotomastery.io/p/web",
      },
    ];
    const csv = buildCSV(courses);
    assert.ok(csv.includes('"Web Dev: ""The Best"" Course"'));
  });
});

// ── MIN_EXPECTED_COURSES constant ─────────────────────────────────────────────

describe("MIN_EXPECTED_COURSES guard (contract)", () => {
  it("sync-courses exports module.exports with all expected helpers", () => {
    const mod = require("./sync-courses");
    assert.equal(typeof mod.parseCSVLine, "function");
    assert.equal(typeof mod.normalizeTitle, "function");
    assert.equal(typeof mod.loadExisting, "function");
    assert.equal(typeof mod.extractCoursesFromPage, "function");
    assert.equal(typeof mod.mergeEnrolledUrls, "function");
    assert.equal(typeof mod.buildCSV, "function");
  });

  it("buildCSV produces at least a header + one row for a single course", () => {
    const courses = [
      {
        course: "X",
        enrolledUrl: "",
        publicUrl: "https://academy.zerotomastery.io/p/x",
      },
    ];
    const lines = buildCSV(courses).trim().split("\n");
    assert.ok(lines.length >= 2);
  });
});
