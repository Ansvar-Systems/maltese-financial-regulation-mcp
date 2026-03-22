/**
 * Seed the MFSA database with sample provisions for testing.
 *
 * Inserts representative provisions from MFSA_Rules, MFSA_Guidance_Notes,
 * and MFSA_Circulars so MCP tools can be tested without a full ingestion run.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["MFSA_DB_PATH"] ?? "data/mfsa.db";
const force = process.argv.includes("--force");

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

interface SourcebookRow {
  id: string;
  name: string;
  description: string;
}

const sourcebooks: SourcebookRow[] = [
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

const insertSourcebook = db.prepare(
  "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
);

for (const sb of sourcebooks) {
  insertSourcebook.run(sb.id, sb.name, sb.description);
}

console.log(`Inserted ${sourcebooks.length} sourcebooks`);

interface ProvisionRow {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string;
  chapter: string;
  section: string;
}

const provisions: ProvisionRow[] = [
  // ── MFSA Rules — Investment Services ───────────────────────────────────
  {
    sourcebook_id: "MFSA_RULES",
    reference: "MFSA_RULES ISL.1.1",
    title: "Licence Requirement — Investment Services",
    text: "No person shall provide or hold itself out as providing an investment service in or from Malta unless it is in possession of a valid licence granted under the Investment Services Act and issued by the MFSA.",
    type: "rule",
    status: "in_force",
    effective_date: "2021-01-01",
    chapter: "ISL",
    section: "ISL.1",
  },
  {
    sourcebook_id: "MFSA_RULES",
    reference: "MFSA_RULES ISL.2.1",
    title: "Fit and Proper Requirements",
    text: "A licence holder must ensure that persons who effectively direct its business are of good repute and possess sufficient knowledge, skills and experience to perform their duties. The MFSA shall assess fit and proper requirements on an ongoing basis.",
    type: "rule",
    status: "in_force",
    effective_date: "2021-01-01",
    chapter: "ISL",
    section: "ISL.2",
  },
  {
    sourcebook_id: "MFSA_RULES",
    reference: "MFSA_RULES ISL.3.1",
    title: "Organisational Requirements",
    text: "A licence holder shall establish adequate policies and procedures sufficient to ensure compliance with its obligations under applicable law, and shall implement effective arrangements for the management of conflicts of interest.",
    type: "rule",
    status: "in_force",
    effective_date: "2021-01-01",
    chapter: "ISL",
    section: "ISL.3",
  },
  {
    sourcebook_id: "MFSA_RULES",
    reference: "MFSA_RULES CGC.1.1",
    title: "Corporate Governance — Board Responsibilities",
    text: "The board of directors of a licence holder is collectively responsible for the proper management and oversight of the licence holder. The board shall define, oversee and be accountable for the implementation of governance arrangements that ensure effective and prudent management of the licence holder.",
    type: "rule",
    status: "in_force",
    effective_date: "2022-01-01",
    chapter: "CGC",
    section: "CGC.1",
  },
  {
    sourcebook_id: "MFSA_RULES",
    reference: "MFSA_RULES CGC.2.1",
    title: "Risk Management Framework",
    text: "A licence holder shall establish and maintain a risk management framework proportionate to the nature, scale and complexity of its activities. The risk management function shall be independent from business-line management and shall have sufficient authority, resources and access to the board.",
    type: "rule",
    status: "in_force",
    effective_date: "2022-01-01",
    chapter: "CGC",
    section: "CGC.2",
  },

  // ── MFSA Guidance Notes — AML ──────────────────────────────────────────
  {
    sourcebook_id: "MFSA_GUIDANCE_NOTES",
    reference: "MFSA_GUIDANCE_NOTES AML.1.1",
    title: "Customer Due Diligence — General Principles",
    text: "Subject persons must apply customer due diligence measures when establishing a business relationship. CDD measures include identifying and verifying the customer's identity, identifying the beneficial owner, and obtaining information on the purpose and intended nature of the business relationship.",
    type: "guidance",
    status: "in_force",
    effective_date: "2020-06-01",
    chapter: "AML",
    section: "AML.1",
  },
  {
    sourcebook_id: "MFSA_GUIDANCE_NOTES",
    reference: "MFSA_GUIDANCE_NOTES AML.2.1",
    title: "Enhanced Due Diligence — Politically Exposed Persons",
    text: "Where a customer or beneficial owner is a politically exposed person, subject persons shall apply enhanced customer due diligence measures. This includes obtaining senior management approval for establishing the relationship, taking adequate measures to establish the source of wealth and source of funds, and conducting enhanced ongoing monitoring.",
    type: "guidance",
    status: "in_force",
    effective_date: "2020-06-01",
    chapter: "AML",
    section: "AML.2",
  },
  {
    sourcebook_id: "MFSA_GUIDANCE_NOTES",
    reference: "MFSA_GUIDANCE_NOTES AML.3.1",
    title: "Suspicious Transaction Reporting",
    text: "Subject persons shall report to the Financial Intelligence Analysis Unit (FIAU) any knowledge or suspicion that funds are the proceeds of criminal activity or are related to money laundering or the financing of terrorism. Reports shall be made promptly and without tipping off the customer.",
    type: "guidance",
    status: "in_force",
    effective_date: "2020-06-01",
    chapter: "AML",
    section: "AML.3",
  },

  // ── MFSA Circulars ─────────────────────────────────────────────────────
  {
    sourcebook_id: "MFSA_CIRCULARS",
    reference: "MFSA_CIRCULARS CIR.2023.01",
    title: "Circular on Digital Assets and Virtual Financial Assets",
    text: "The MFSA reminds all Virtual Financial Assets (VFA) service providers of their obligations under the VFA Act and the MFSA VFA Rules. Licence holders must ensure that their systems and controls remain adequate to manage the risks associated with digital asset activities, including cybersecurity, custody, and AML/CFT risks.",
    type: "circular",
    status: "in_force",
    effective_date: "2023-03-15",
    chapter: "CIR",
    section: "CIR.2023",
  },
  {
    sourcebook_id: "MFSA_CIRCULARS",
    reference: "MFSA_CIRCULARS CIR.2022.03",
    title: "Circular on Outsourcing Arrangements",
    text: "The MFSA sets out its expectations regarding outsourcing arrangements entered into by licence holders. Licence holders remain fully responsible for all outsourced functions and must ensure adequate oversight, contractual protections, and business continuity measures are in place. Material outsourcing arrangements must be notified to the MFSA in advance.",
    type: "circular",
    status: "in_force",
    effective_date: "2022-09-01",
    chapter: "CIR",
    section: "CIR.2022",
  },
];

const insertProvision = db.prepare(`
  INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const p of provisions) {
    insertProvision.run(
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
  }
});

insertAll();

console.log(`Inserted ${provisions.length} sample provisions`);

interface EnforcementRow {
  firm_name: string;
  reference_number: string;
  action_type: string;
  amount: number;
  date: string;
  summary: string;
  sourcebook_references: string;
}

const enforcements: EnforcementRow[] = [
  {
    firm_name: "Nexia BT",
    reference_number: "MFSA-ENF-2020-001",
    action_type: "fine",
    amount: 100_000,
    date: "2020-11-20",
    summary:
      "The MFSA imposed an administrative penalty on Nexia BT for failures in its AML/CFT compliance function related to the Panama Papers matter. The firm failed to apply adequate customer due diligence and failed to identify and report suspicious transactions in connection with certain clients.",
    sourcebook_references: "MFSA_GUIDANCE_NOTES AML.1.1, MFSA_GUIDANCE_NOTES AML.3.1",
  },
  {
    firm_name: "Pilatus Bank plc",
    reference_number: "MFSA-ENF-2018-001",
    action_type: "ban",
    amount: 0,
    date: "2018-11-05",
    summary:
      "The MFSA withdrew the banking licence of Pilatus Bank plc following the indictment of its chairman in the United States on money laundering charges and subsequent findings of serious AML/CFT deficiencies. The bank was placed under a competent person scheme pending resolution.",
    sourcebook_references: "MFSA_RULES ISL.2.1, MFSA_GUIDANCE_NOTES AML.1.1",
  },
];

const insertEnforcement = db.prepare(`
  INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEnforcementsAll = db.transaction(() => {
  for (const e of enforcements) {
    insertEnforcement.run(
      e.firm_name,
      e.reference_number,
      e.action_type,
      e.amount,
      e.date,
      e.summary,
      e.sourcebook_references,
    );
  }
});

insertEnforcementsAll();

console.log(`Inserted ${enforcements.length} sample enforcement actions`);

const provisionCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions").get() as { cnt: number }
).cnt;
const sourcebookCount = (
  db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as { cnt: number }
).cnt;
const enforcementCount = (
  db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as { cnt: number }
).cnt;
const ftsCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Sourcebooks:          ${sourcebookCount}`);
console.log(`  Provisions:           ${provisionCount}`);
console.log(`  Enforcement actions:  ${enforcementCount}`);
console.log(`  FTS entries:          ${ftsCount}`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
