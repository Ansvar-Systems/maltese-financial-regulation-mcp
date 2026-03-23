#!/usr/bin/env tsx
/**
 * MFSA Ingestion Crawler
 *
 * Crawls the Malta Financial Services Authority website (mfsa.mt) and populates
 * the local SQLite database with:
 *   - Sourcebook definitions (rules, guidance notes, circulars)
 *   - Provisions scraped from circular and rulebook listing pages
 *   - Enforcement actions from the administrative measures page
 *
 * The crawler targets HTML listing pages on the WordPress-based mfsa.mt site,
 * follows pagination, and extracts detail page content. PDF rulebooks are
 * catalogued by URL but not parsed inline (marked as type "rulebook_pdf").
 *
 * Usage:
 *   npx tsx scripts/ingest-mfsa.ts                     # full crawl
 *   npx tsx scripts/ingest-mfsa.ts --dry-run            # preview without DB writes
 *   npx tsx scripts/ingest-mfsa.ts --resume              # skip already-ingested refs
 *   npx tsx scripts/ingest-mfsa.ts --force               # drop existing data first
 *   npx tsx scripts/ingest-mfsa.ts --dry-run --resume    # combine flags
 *
 * Environment:
 *   MFSA_DB_PATH   — SQLite path (default: data/mfsa.db, matches src/db.ts)
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const DB_PATH = process.env["MFSA_DB_PATH"] ?? "data/mfsa.db";
const BASE_URL = "https://www.mfsa.mt";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const MAX_PAGES_PER_CATEGORY = 80;

// ─── CLI flags ───────────────────────────────────────────────────────────────

interface CliFlags {
  dryRun: boolean;
  resume: boolean;
  force: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    resume: args.includes("--resume"),
    force: args.includes("--force"),
  };
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<{ status: number; body: string }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Ansvar-MFSA-Crawler/1.0 (+https://ansvar.eu; compliance research)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });

      const body = await res.text();

      if (res.status === 429) {
        const wait = RETRY_BACKOFF_MS * attempt * 2;
        console.warn(`  429 rate-limited on ${url}, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      return { status: res.status, body };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        const wait = RETRY_BACKOFF_MS * attempt;
        console.warn(
          `  Attempt ${attempt}/${retries} failed for ${url}: ${msg} — retrying in ${wait}ms`,
        );
        await sleep(wait);
      } else {
        console.error(`  All ${retries} attempts failed for ${url}: ${msg}`);
        return { status: 0, body: "" };
      }
    }
  }
  return { status: 0, body: "" };
}

// ─── Sourcebook definitions ─────────────────────────────────────────────────

interface SourcebookDef {
  id: string;
  name: string;
  description: string;
}

const SOURCEBOOKS: SourcebookDef[] = [
  {
    id: "MFSA_RULES",
    name: "MFSA Rules",
    description:
      "Binding rules issued by the Malta Financial Services Authority covering investment services, banking, insurance, and funds.",
  },
  {
    id: "MFSA_GUIDANCE_NOTES",
    name: "MFSA Guidance Notes",
    description:
      "Non-binding guidance issued by the MFSA to assist licence holders in interpreting and complying with regulatory requirements.",
  },
  {
    id: "MFSA_CIRCULARS",
    name: "MFSA Circulars",
    description:
      "Circulars issued by the MFSA to communicate regulatory expectations, supervisory priorities, and industry updates.",
  },
];

// ─── Circular category URLs ─────────────────────────────────────────────────
// Each category page on mfsa.mt lists circulars with title, date, and a link
// to a detail page or PDF. WordPress pagination appends /page/N/.

interface CircularCategory {
  slug: string;
  name: string;
  url: string;
  sourcebookId: string;
  chapter: string;
}

const CIRCULAR_CATEGORIES: CircularCategory[] = [
  // ── Banking ──
  {
    slug: "banking-supervision",
    name: "Banking Supervision",
    url: "/publications/circulars/banking-supervision/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "BANKING",
  },
  // ── Investment Services ──
  {
    slug: "investment-services-supervision",
    name: "Investment Services Supervision",
    url: "/publications/circulars/investment-services-supervision/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "ISS",
  },
  // ── Insurance & Pensions ──
  {
    slug: "insurance-and-pensions",
    name: "Insurance and Pensions Supervision",
    url: "/publications/circulars/insurance-and-pensions-supervision/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "INS_PENS",
  },
  // ── Conduct of Business ──
  {
    slug: "conduct-of-business",
    name: "Conduct of Business",
    url: "/publications/circulars/conduct-of-business/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "COB",
  },
  // ── AML ──
  {
    slug: "anti-money-laundering",
    name: "Anti-Money Laundering",
    url: "/publications/circulars/anti-money-laundering/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "AML",
  },
  // ── Authorisations ──
  {
    slug: "authorisations",
    name: "Authorisations",
    url: "/publications/circulars/authorisations/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "AUTH",
  },
  // ── FinTech / VFA ──
  {
    slug: "fintech",
    name: "FinTech",
    url: "/publications/circulars/fintech/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "FINTECH",
  },
  // ── Capital Markets ──
  {
    slug: "capital-markets-supervision",
    name: "Capital Markets Supervision",
    url: "/publications/circulars/capital-markets-supervision/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "CAPMKT",
  },
  // ── ICT / Cyber ──
  {
    slug: "supervisory-ict-risk-and-cybersecurity-circulars",
    name: "Supervisory ICT Risk and Cybersecurity",
    url: "/publications/circulars/supervisory-ict-risk-and-cybersecurity-circulars/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "ICT_CYBER",
  },
  // ── Sustainable Finance ──
  {
    slug: "sustainable-finance-circulars",
    name: "Sustainable Finance",
    url: "/publications/circulars/sustainable-finance-circulars/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "SUSTFIN",
  },
  // ── Company Service Providers ──
  {
    slug: "company-service-providers",
    name: "Company Service Providers",
    url: "/publications/circulars/company-service-providers/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "CSP",
  },
  // ── Crypto Assets ──
  {
    slug: "crypto-assets-circulars",
    name: "Crypto-Assets",
    url: "/publications/circulars/crypto-assets-circulars/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "CRYPTO",
  },
  // ── Trust and Fiduciaries ──
  {
    slug: "trust-and-fiduciaries",
    name: "Trust and Fiduciaries",
    url: "/publications/circulars/trust-and-fiduciaries/",
    sourcebookId: "MFSA_CIRCULARS",
    chapter: "TRUST",
  },
];

// ── Notices and Decisions (rules / guidance character) ──

const NOTICES_URLS = [
  {
    url: "/publications/notices-and-decisions/",
    sourcebookId: "MFSA_GUIDANCE_NOTES",
    chapter: "NOTICES",
    slug: "notices-and-decisions",
  },
  {
    url: "/publications/notices-and-decisions-archive/",
    sourcebookId: "MFSA_GUIDANCE_NOTES",
    chapter: "NOTICES_ARCHIVE",
    slug: "notices-and-decisions-archive",
  },
];

// ── Rulebook PDF index pages (rules) ──

interface RulebookIndex {
  slug: string;
  name: string;
  url: string;
  chapter: string;
}

const RULEBOOK_INDICES: RulebookIndex[] = [
  {
    slug: "investment-services-rules",
    name: "Investment Services Rules",
    url: "/firms/regulated-firms/rules/",
    chapter: "ISR",
  },
  {
    slug: "financial-institutions-regulation",
    name: "Financial Institutions Regulation",
    url: "/firms/regulated-firms/financial-institutions/regulation/",
    chapter: "FIR",
  },
  {
    slug: "vfa-rules",
    name: "Virtual Financial Assets Rules",
    url: "/our-work/virtual-financial-assets/rules/",
    chapter: "VFA",
  },
];

// ── Enforcement ──

const ENFORCEMENT_URL = "/news/administrative-measures-and-penalties/";
const ENFORCEMENT_ARCHIVE_URL =
  "/news/administrative-measures-and-penalties/administrative-measures-and-penalties-archive/";

// ─── Extracted types ─────────────────────────────────────────────────────────

interface CrawledProvision {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string | null;
  chapter: string;
  section: string;
  url: string;
}

interface CrawledEnforcement {
  firm_name: string;
  reference_number: string | null;
  action_type: string | null;
  amount: number | null;
  date: string | null;
  summary: string;
  sourcebook_references: string | null;
}

// ─── Counters ────────────────────────────────────────────────────────────────

interface Stats {
  pagesVisited: number;
  provisionsFound: number;
  provisionsInserted: number;
  provisionsSkipped: number;
  enforcementsFound: number;
  enforcementsInserted: number;
  errors: number;
}

function newStats(): Stats {
  return {
    pagesVisited: 0,
    provisionsFound: 0,
    provisionsInserted: 0,
    provisionsSkipped: 0,
    enforcementsFound: 0,
    enforcementsInserted: 0,
    errors: 0,
  };
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/**
 * Normalise whitespace: collapse runs of spaces/newlines, trim.
 */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Try to extract a date from common MFSA formats.
 * Returns ISO date string (YYYY-MM-DD) or null.
 */
function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ISO date already
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // "DD Month YYYY" or "DD/MM/YYYY"
  const slashMatch = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }

  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  const longMatch = trimmed.match(
    /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
  );
  if (longMatch) {
    const [, d, monthStr, y] = longMatch;
    const m = months[monthStr!.toLowerCase()];
    if (m) return `${y}-${m}-${d!.padStart(2, "0")}`;
  }

  // "Month DD, YYYY"
  const usMatch = trimmed.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
  );
  if (usMatch) {
    const [, monthStr, d, y] = usMatch;
    const m = months[monthStr!.toLowerCase()];
    if (m) return `${y}-${m}-${d!.padStart(2, "0")}`;
  }

  // "Month YYYY" — use first of month
  const monthYearMatch = trimmed.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
  );
  if (monthYearMatch) {
    const [, monthStr, y] = monthYearMatch;
    const m = months[monthStr!.toLowerCase()];
    if (m) return `${y}-${m}-01`;
  }

  return null;
}

/**
 * Build a stable reference string from category slug and item title/date.
 */
function buildReference(
  sourcebookId: string,
  chapter: string,
  slug: string,
  index: number,
): string {
  // e.g. MFSA_CIRCULARS AML.0001
  const num = String(index + 1).padStart(4, "0");
  return `${sourcebookId} ${chapter}.${num}`;
}

/**
 * Build a reference for rulebook PDFs.
 */
function buildRulebookRef(chapter: string, index: number): string {
  const num = String(index + 1).padStart(4, "0");
  return `MFSA_RULES ${chapter}.${num}`;
}

/**
 * Classify enforcement action type from text.
 */
function classifyActionType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("administrative penalty") || lower.includes("fine"))
    return "fine";
  if (lower.includes("licence") && lower.includes("withdraw")) return "ban";
  if (lower.includes("licence") && lower.includes("suspend"))
    return "suspension";
  if (lower.includes("reprimand") || lower.includes("warning"))
    return "reprimand";
  if (lower.includes("settlement")) return "settlement";
  if (lower.includes("cancellation") || lower.includes("cancel"))
    return "cancellation";
  return "other";
}

/**
 * Try to extract a monetary amount from text (EUR).
 */
function extractAmount(text: string): number | null {
  // Patterns: €100,000 or EUR 100,000 or 100,000 euro
  const match = text.match(
    /(?:€|EUR)\s*([\d,]+(?:\.\d{2})?)|(?:([\d,]+(?:\.\d{2})?)\s*euro)/i,
  );
  if (match) {
    const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
    const num = parseFloat(raw);
    return isNaN(num) ? null : num;
  }
  return null;
}

// ─── Page scrapers ───────────────────────────────────────────────────────────

/**
 * Scrape a circular listing page (one page of a paginated WordPress category).
 *
 * MFSA circular listing pages typically contain items in a variety of formats:
 *   - <article> blocks with h2/h3 headings and date spans
 *   - <li> items inside .mfsa-publications or similar containers
 *   - Table rows with title, date, PDF link columns
 *   - Simple <a> links inside paragraph or list containers
 *
 * We try multiple selectors to cover these variants.
 */
function parseCircularListingPage(
  html: string,
  category: CircularCategory | { slug: string; sourcebookId: string; chapter: string },
): { items: CrawledProvision[]; nextPageUrl: string | null } {
  const $ = cheerio.load(html);
  const items: CrawledProvision[] = [];
  let itemIndex = 0;

  // Strategy 1: article elements (common WordPress post listing)
  $("article, .post, .type-post, .hentry").each((_i, el) => {
    const titleEl = $(el).find("h2 a, h3 a, .entry-title a, h2, h3").first();
    const title = normalise(titleEl.text());
    if (!title) return;

    const href = titleEl.attr("href") ?? titleEl.closest("a").attr("href") ?? "";
    const dateText =
      normalise(
        $(el)
          .find(
            "time, .entry-date, .date, .post-date, span.meta-date, .published",
          )
          .first()
          .text(),
      ) ||
      normalise(
        $(el).find("time").attr("datetime") ?? "",
      );
    const snippet = normalise(
      $(el).find(".entry-content, .entry-summary, .excerpt, p").first().text(),
    );

    items.push({
      sourcebook_id: category.sourcebookId,
      reference: buildReference(
        category.sourcebookId,
        category.chapter,
        category.slug,
        itemIndex,
      ),
      title,
      text: snippet || title,
      type: "circular",
      status: "in_force",
      effective_date: parseDate(dateText),
      chapter: category.chapter,
      section: category.slug,
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
    itemIndex++;
  });

  // Strategy 2: table rows (some listing pages use tables)
  if (items.length === 0) {
    $("table tbody tr, table tr").each((_i, el) => {
      const cells = $(el).find("td");
      if (cells.length < 1) return;

      const linkEl = $(el).find("a").first();
      const title = normalise(linkEl.text() || cells.first().text());
      if (!title || title.length < 5) return;

      const href = linkEl.attr("href") ?? "";
      const dateCell = cells.length > 1 ? normalise($(cells[1]).text()) : "";

      items.push({
        sourcebook_id: category.sourcebookId,
        reference: buildReference(
          category.sourcebookId,
          category.chapter,
          category.slug,
          itemIndex,
        ),
        title,
        text: title,
        type: "circular",
        status: "in_force",
        effective_date: parseDate(dateCell),
        chapter: category.chapter,
        section: category.slug,
        url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      });
      itemIndex++;
    });
  }

  // Strategy 3: list items with links (simple <ul>/<ol> lists)
  if (items.length === 0) {
    $(
      ".entry-content li a, .page-content li a, .content-area li a, .wp-block-list li a, main li a",
    ).each((_i, el) => {
      const title = normalise($(el).text());
      if (!title || title.length < 10) return;

      const href = $(el).attr("href") ?? "";
      // Skip navigation / menu links
      if (
        href.includes("#") ||
        href.includes("javascript:") ||
        href === "/" ||
        href === BASE_URL
      )
        return;

      const parentText = normalise($(el).parent().text());
      const dateInParent = parseDate(parentText);

      items.push({
        sourcebook_id: category.sourcebookId,
        reference: buildReference(
          category.sourcebookId,
          category.chapter,
          category.slug,
          itemIndex,
        ),
        title,
        text: parentText || title,
        type: "circular",
        status: "in_force",
        effective_date: dateInParent,
        chapter: category.chapter,
        section: category.slug,
        url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      });
      itemIndex++;
    });
  }

  // Detect next page (WordPress pagination)
  let nextPageUrl: string | null = null;
  const nextLink = $(
    "a.next, .pagination a.next, .nav-links a.next, a.page-numbers.next, .wp-pagenavi a.nextpostslink, a[rel='next']",
  ).first();
  if (nextLink.length) {
    const href = nextLink.attr("href");
    if (href) {
      nextPageUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    }
  }

  return { items, nextPageUrl };
}

/**
 * Scrape a detail page for its full text content.
 * Returns the main body text (cleaned of nav, sidebar, footer, scripts).
 */
function parseDetailPage(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $(
    "nav, header, footer, aside, script, style, .sidebar, .menu, .navigation, .breadcrumb, .social-share, .comments, #comments, .related-posts",
  ).remove();

  // Try specific content containers first
  const contentSelectors = [
    ".entry-content",
    ".post-content",
    ".page-content",
    "article .content",
    ".content-area article",
    "main article",
    "main .content",
    "main",
  ];

  for (const sel of contentSelectors) {
    const el = $(sel).first();
    if (el.length) {
      const text = normalise(el.text());
      if (text.length > 100) return text;
    }
  }

  // Fallback: body text
  return normalise($("body").text()).slice(0, 10_000);
}

/**
 * Scrape rulebook index pages for PDF links.
 * These pages list rulebook chapters as links to PDF documents.
 */
function parseRulebookPage(html: string): Array<{ title: string; url: string }> {
  const $ = cheerio.load(html);
  const pdfs: Array<{ title: string; url: string }> = [];

  $("a[href$='.pdf'], a[href*='wp-content/uploads']").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.includes(".pdf")) return;

    const title = normalise($(el).text());
    if (!title || title.length < 5) return;

    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    // Avoid duplicates
    if (!pdfs.some((p) => p.url === fullUrl)) {
      pdfs.push({ title, url: fullUrl });
    }
  });

  return pdfs;
}

/**
 * Scrape the enforcement page for administrative measures.
 */
function parseEnforcementPage(html: string): CrawledEnforcement[] {
  const $ = cheerio.load(html);
  const actions: CrawledEnforcement[] = [];

  // Strategy 1: article/post items
  $("article, .post, .type-post, .hentry").each((_i, el) => {
    const titleEl = $(el).find("h2 a, h3 a, .entry-title a, h2, h3").first();
    const title = normalise(titleEl.text());
    if (!title) return;

    const dateText = normalise(
      $(el)
        .find("time, .entry-date, .date, .post-date, .published")
        .first()
        .text(),
    );
    const snippet = normalise(
      $(el).find(".entry-content, .entry-summary, .excerpt, p").first().text(),
    );
    const combined = `${title} ${snippet}`;

    actions.push({
      firm_name: title,
      reference_number: null,
      action_type: classifyActionType(combined),
      amount: extractAmount(combined),
      date: parseDate(dateText),
      summary: snippet || title,
      sourcebook_references: null,
    });
  });

  // Strategy 2: list items
  if (actions.length === 0) {
    $(
      ".entry-content li, .page-content li, main li, .content-area li",
    ).each((_i, el) => {
      const text = normalise($(el).text());
      if (!text || text.length < 20) return;

      const linkEl = $(el).find("a").first();
      const title = normalise(linkEl.text()) || text.slice(0, 120);

      actions.push({
        firm_name: title,
        reference_number: null,
        action_type: classifyActionType(text),
        amount: extractAmount(text),
        date: parseDate(text),
        summary: text,
        sourcebook_references: null,
      });
    });
  }

  // Strategy 3: table rows
  if (actions.length === 0) {
    $("table tbody tr, table tr").each((_i, el) => {
      const cells = $(el).find("td");
      if (cells.length < 2) return;

      const firmName = normalise($(cells[0]).text());
      if (!firmName || firmName.length < 3) return;

      const rest = normalise($(el).text());

      actions.push({
        firm_name: firmName,
        reference_number: null,
        action_type: classifyActionType(rest),
        amount: extractAmount(rest),
        date: parseDate(rest),
        summary: rest,
        sourcebook_references: null,
      });
    });
  }

  return actions;
}

// ─── Crawl orchestration ─────────────────────────────────────────────────────

/**
 * Crawl all pages of a single circular category, following pagination.
 */
async function crawlCircularCategory(
  category: CircularCategory | { slug: string; url: string; sourcebookId: string; chapter: string; name?: string },
  stats: Stats,
): Promise<CrawledProvision[]> {
  const allItems: CrawledProvision[] = [];
  let currentUrl: string | null = `${BASE_URL}${category.url}`;
  let pageNum = 1;

  const catName = ("name" in category && category.name) ? category.name : category.slug;
  console.log(`\n  Category: ${catName}`);

  while (currentUrl && pageNum <= MAX_PAGES_PER_CATEGORY) {
    await sleep(RATE_LIMIT_MS);
    const { status, body } = await fetchWithRetry(currentUrl);
    stats.pagesVisited++;

    if (status !== 200) {
      console.warn(`    Page ${pageNum}: HTTP ${status} — stopping.`);
      stats.errors++;
      break;
    }

    const { items, nextPageUrl } = parseCircularListingPage(body, category);
    console.log(`    Page ${pageNum}: ${items.length} items found`);

    // Re-number references to be globally unique within the category
    for (const item of items) {
      item.reference = buildReference(
        category.sourcebookId,
        category.chapter,
        category.slug,
        allItems.length,
      );
      allItems.push(item);
    }

    if (items.length === 0 || !nextPageUrl) break;
    currentUrl = nextPageUrl;
    pageNum++;
  }

  console.log(`    Total: ${allItems.length} items from ${catName}`);
  return allItems;
}

/**
 * For each provision that has a detail URL (not a PDF), fetch the full text.
 */
async function enrichProvisionText(
  provisions: CrawledProvision[],
  stats: Stats,
): Promise<void> {
  let enriched = 0;
  const toEnrich = provisions.filter(
    (p) =>
      p.url &&
      !p.url.endsWith(".pdf") &&
      p.url.startsWith("http") &&
      p.text.length < 200,
  );

  console.log(`\n  Enriching ${toEnrich.length} provisions with detail page content...`);

  for (let i = 0; i < toEnrich.length; i++) {
    const prov = toEnrich[i]!;
    await sleep(RATE_LIMIT_MS);

    const { status, body } = await fetchWithRetry(prov.url);
    stats.pagesVisited++;

    if (status !== 200) {
      stats.errors++;
      continue;
    }

    const fullText = parseDetailPage(body);
    if (fullText.length > prov.text.length) {
      prov.text = fullText;
      enriched++;
    }

    if ((i + 1) % 25 === 0) {
      console.log(`    Enriched ${i + 1}/${toEnrich.length}...`);
    }
  }

  console.log(`    Enriched ${enriched} provisions with full text`);
}

/**
 * Crawl rulebook index pages for PDF references.
 */
async function crawlRulebooks(stats: Stats): Promise<CrawledProvision[]> {
  const provisions: CrawledProvision[] = [];

  console.log("\n=== Phase 2: Rulebook PDFs ===");

  for (const rb of RULEBOOK_INDICES) {
    console.log(`\n  Rulebook: ${rb.name}`);
    await sleep(RATE_LIMIT_MS);

    const { status, body } = await fetchWithRetry(`${BASE_URL}${rb.url}`);
    stats.pagesVisited++;

    if (status !== 200) {
      console.warn(`    HTTP ${status} — skipping.`);
      stats.errors++;
      continue;
    }

    const pdfs = parseRulebookPage(body);
    console.log(`    Found ${pdfs.length} PDF documents`);

    for (let i = 0; i < pdfs.length; i++) {
      const pdf = pdfs[i]!;
      provisions.push({
        sourcebook_id: "MFSA_RULES",
        reference: buildRulebookRef(rb.chapter, i),
        title: pdf.title,
        text: `${pdf.title}. Available at: ${pdf.url}`,
        type: "rulebook_pdf",
        status: "in_force",
        effective_date: null,
        chapter: rb.chapter,
        section: rb.slug,
        url: pdf.url,
      });
    }
  }

  return provisions;
}

/**
 * Crawl enforcement pages.
 */
async function crawlEnforcement(stats: Stats): Promise<CrawledEnforcement[]> {
  const allActions: CrawledEnforcement[] = [];

  console.log("\n=== Phase 3: Enforcement Actions ===");

  for (const url of [ENFORCEMENT_URL, ENFORCEMENT_ARCHIVE_URL]) {
    let currentUrl: string | null = `${BASE_URL}${url}`;
    let pageNum = 1;

    console.log(`\n  Source: ${url}`);

    while (currentUrl && pageNum <= MAX_PAGES_PER_CATEGORY) {
      await sleep(RATE_LIMIT_MS);
      const { status, body } = await fetchWithRetry(currentUrl);
      stats.pagesVisited++;

      if (status !== 200) {
        console.warn(`    Page ${pageNum}: HTTP ${status} — stopping.`);
        stats.errors++;
        break;
      }

      const actions = parseEnforcementPage(body);
      console.log(`    Page ${pageNum}: ${actions.length} actions found`);
      allActions.push(...actions);

      if (actions.length === 0) break;

      // Check for next page
      const $ = cheerio.load(body);
      const nextLink = $(
        "a.next, .pagination a.next, a.page-numbers.next, a[rel='next']",
      ).first();
      const nextHref = nextLink.attr("href");

      if (nextHref) {
        currentUrl = nextHref.startsWith("http")
          ? nextHref
          : `${BASE_URL}${nextHref}`;
        pageNum++;
      } else {
        break;
      }
    }
  }

  console.log(`\n  Total enforcement actions: ${allActions.length}`);
  return allActions;
}

// ─── Database writes ─────────────────────────────────────────────────────────

function initDb(flags: CliFlags): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (flags.force && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  return db;
}

function insertSourcebooks(db: Database.Database): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
  );
  for (const sb of SOURCEBOOKS) {
    stmt.run(sb.id, sb.name, sb.description);
  }
  console.log(`Inserted ${SOURCEBOOKS.length} sourcebooks`);
}

function getExistingRefs(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT reference FROM provisions")
    .all() as Array<{ reference: string }>;
  return new Set(rows.map((r) => r.reference));
}

function insertProvisions(
  db: Database.Database,
  provisions: CrawledProvision[],
  existingRefs: Set<string>,
  flags: CliFlags,
  stats: Stats,
): void {
  const stmt = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.transaction((batch: CrawledProvision[]) => {
    for (const p of batch) {
      if (flags.resume && existingRefs.has(p.reference)) {
        stats.provisionsSkipped++;
        continue;
      }
      stmt.run(
        p.sourcebook_id,
        p.reference,
        p.title,
        p.text,
        p.type,
        p.status,
        p.effective_date,
        p.chapter,
        p.section,
      );
      stats.provisionsInserted++;
    }
  });

  // Insert in batches of 500 for efficiency
  const batchSize = 500;
  for (let i = 0; i < provisions.length; i += batchSize) {
    const batch = provisions.slice(i, i + batchSize);
    insertBatch(batch);
  }
}

function insertEnforcement(
  db: Database.Database,
  actions: CrawledEnforcement[],
  flags: CliFlags,
  stats: Stats,
): void {
  const stmt = db.prepare(`
    INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Simple dedup: check existing firm_name + date pairs if resuming
  let existingKeys = new Set<string>();
  if (flags.resume) {
    const rows = db
      .prepare("SELECT firm_name, date FROM enforcement_actions")
      .all() as Array<{ firm_name: string; date: string | null }>;
    existingKeys = new Set(rows.map((r) => `${r.firm_name}::${r.date ?? ""}`));
  }

  const insertBatch = db.transaction((batch: CrawledEnforcement[]) => {
    for (const e of batch) {
      const key = `${e.firm_name}::${e.date ?? ""}`;
      if (flags.resume && existingKeys.has(key)) continue;

      stmt.run(
        e.firm_name,
        e.reference_number,
        e.action_type,
        e.amount,
        e.date,
        e.summary,
        e.sourcebook_references,
      );
      stats.enforcementsInserted++;
    }
  });

  insertBatch(actions);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags();
  const stats = newStats();

  console.log("MFSA Ingestion Crawler");
  console.log("======================");
  console.log(`  Database:  ${DB_PATH}`);
  console.log(`  Dry run:   ${flags.dryRun}`);
  console.log(`  Resume:    ${flags.resume}`);
  console.log(`  Force:     ${flags.force}`);
  console.log(`  Rate limit: ${RATE_LIMIT_MS}ms`);

  // ── Phase 1: Circulars + Notices ───────────────────────────────────────

  console.log("\n=== Phase 1: Circulars & Notices ===");

  const allProvisions: CrawledProvision[] = [];

  for (const category of CIRCULAR_CATEGORIES) {
    const items = await crawlCircularCategory(category, stats);
    allProvisions.push(...items);
    stats.provisionsFound += items.length;
  }

  // Notices and decisions
  for (const notice of NOTICES_URLS) {
    const items = await crawlCircularCategory(
      { ...notice, name: notice.slug },
      stats,
    );
    allProvisions.push(...items);
    stats.provisionsFound += items.length;
  }

  // ── Enrich short provisions with detail page text ──
  await enrichProvisionText(allProvisions, stats);

  // ── Phase 2: Rulebook PDFs ─────────────────────────────────────────────

  const rulebookProvisions = await crawlRulebooks(stats);
  allProvisions.push(...rulebookProvisions);
  stats.provisionsFound += rulebookProvisions.length;

  // ── Phase 3: Enforcement ───────────────────────────────────────────────

  const enforcementActions = await crawlEnforcement(stats);
  stats.enforcementsFound = enforcementActions.length;

  // ── Database writes ────────────────────────────────────────────────────

  if (flags.dryRun) {
    console.log("\n=== Dry Run Summary ===");
    console.log(`  Pages visited:       ${stats.pagesVisited}`);
    console.log(`  Provisions found:    ${stats.provisionsFound}`);
    console.log(`  Enforcement found:   ${stats.enforcementsFound}`);
    console.log(`  Errors:              ${stats.errors}`);
    console.log("\nNo database writes performed (--dry-run).");
    return;
  }

  console.log("\n=== Phase 4: Database Writes ===");

  const db = initDb(flags);
  insertSourcebooks(db);

  const existingRefs = flags.resume ? getExistingRefs(db) : new Set<string>();
  if (flags.resume) {
    console.log(`  ${existingRefs.size} existing provisions in DB (will skip)`);
  }

  insertProvisions(db, allProvisions, existingRefs, flags, stats);
  insertEnforcement(db, enforcementActions, flags, stats);

  // ── Verify ─────────────────────────────────────────────────────────────

  const provisionCount = (
    db.prepare("SELECT count(*) as cnt FROM provisions").get() as {
      cnt: number;
    }
  ).cnt;
  const sourcebookCount = (
    db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as {
      cnt: number;
    }
  ).cnt;
  const enforcementCount = (
    db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as {
      cnt: number;
    }
  ).cnt;
  const ftsCount = (
    db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as {
      cnt: number;
    }
  ).cnt;

  console.log("\n=== Final Summary ===");
  console.log(`  Pages visited:           ${stats.pagesVisited}`);
  console.log(`  Provisions found:        ${stats.provisionsFound}`);
  console.log(`  Provisions inserted:     ${stats.provisionsInserted}`);
  console.log(`  Provisions skipped:      ${stats.provisionsSkipped}`);
  console.log(`  Enforcement found:       ${stats.enforcementsFound}`);
  console.log(`  Enforcement inserted:    ${stats.enforcementsInserted}`);
  console.log(`  Errors:                  ${stats.errors}`);
  console.log(`\nDatabase totals:`);
  console.log(`  Sourcebooks:             ${sourcebookCount}`);
  console.log(`  Provisions:              ${provisionCount}`);
  console.log(`  Enforcement actions:     ${enforcementCount}`);
  console.log(`  FTS entries:             ${ftsCount}`);
  console.log(`\nDone. Database at ${DB_PATH}`);

  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
