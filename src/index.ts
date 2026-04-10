#!/usr/bin/env node

/**
 * Maltese Financial Regulation MCP — stdio entry point.
 *
 * Provides MCP tools for querying MFSA Rules, Guidance Notes, and Circulars:
 * provisions, sourcebooks, enforcement actions, and currency checks.
 *
 * Tool prefix: mt_fin_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
} from "./db.js";
import { buildCitation } from "./utils/citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "maltese-financial-regulation-mcp";

const TOOLS = [
  {
    name: "mt_fin_search_regulations",
    description:
      "Full-text search across MFSA Rules, Guidance Notes, and Circulars. Returns matching provisions from the Malta Financial Services Authority regulatory framework.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'investment services', 'AML obligations', 'corporate governance')",
        },
        sourcebook: {
          type: "string",
          description: "Filter by sourcebook ID (e.g., MFSA_Rules, MFSA_Guidance_Notes, MFSA_Circulars). Optional.",
        },
        status: {
          type: "string",
          enum: ["in_force", "deleted", "not_yet_in_force"],
          description: "Filter by provision status. Defaults to all statuses.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "mt_fin_get_regulation",
    description:
      "Get a specific MFSA provision by sourcebook and reference. Accepts references like 'MFSA_Rules ISL.1.2' or 'MFSA_Guidance_Notes AML.3.1'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourcebook: {
          type: "string",
          description: "Sourcebook identifier (e.g., MFSA_Rules, MFSA_Guidance_Notes, MFSA_Circulars)",
        },
        reference: {
          type: "string",
          description: "Full provision reference (e.g., 'MFSA_Rules ISL.1.2', 'MFSA_Guidance_Notes AML.3.1')",
        },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "mt_fin_list_sourcebooks",
    description:
      "List all MFSA sourcebooks with their names and descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "mt_fin_search_enforcement",
    description:
      "Search MFSA enforcement actions — administrative penalties, licence withdrawals, and public warnings. Returns matching enforcement decisions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., firm name, type of breach, 'AML failures')",
        },
        action_type: {
          type: "string",
          enum: ["fine", "ban", "restriction", "warning"],
          description: "Filter by action type. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "mt_fin_check_currency",
    description:
      "Check whether a specific MFSA provision reference is currently in force. Returns status and effective date.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "Full provision reference to check (e.g., 'MFSA_Rules ISL.1.2')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "mt_fin_about",
    description: "Return metadata about this MCP server: version, data source, tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "mt_fin_list_sources",
    description: "List all data sources used by this MCP server, with URLs and descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "mt_fin_check_data_freshness",
    description: "Return the data age and freshness information for this MCP server's regulatory corpus.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["in_force", "deleted", "not_yet_in_force"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["fine", "ban", "restriction", "warning"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

function responseMeta() {
  return {
    disclaimer:
      "This data is provided for informational purposes only and does not constitute legal or regulatory advice. Always verify with official MFSA sources before acting.",
    data_age: process.env["MFSA_DATA_AGE"] ?? "2024-01-01",
    copyright: "Malta Financial Services Authority (MFSA)",
    source_url: "https://www.mfsa.mt/",
  };
}

function textContent(data: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ _meta: responseMeta(), ...data }, null, 2),
      },
    ],
  };
}

function errorContent(
  message: string,
  errorType: "not_found" | "internal_error" | "invalid_input" = "internal_error",
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { error: message, _meta: responseMeta(), _error_type: errorType },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  };
}

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "mt_fin_search_regulations": {
        const parsed = SearchRegulationsArgs.parse(args);
        const results = searchProvisions({
          query: parsed.query,
          sourcebook: parsed.sourcebook,
          status: parsed.status,
          limit: parsed.limit,
        });
        const resultsWithCitations = results.map((r) => {
          const rec = r as Record<string, unknown>;
          return {
            ...rec,
            _citation: buildCitation(
              String(rec["reference"] ?? ""),
              String(rec["title"] ?? rec["reference"] ?? ""),
              "mt_fin_get_regulation",
              {
                sourcebook: String(rec["sourcebook_id"] ?? ""),
                reference: String(rec["reference"] ?? ""),
              },
            ),
          };
        });
        return textContent({ results: resultsWithCitations, count: results.length });
      }

      case "mt_fin_get_regulation": {
        const parsed = GetRegulationArgs.parse(args);
        const provision = getProvision(parsed.sourcebook, parsed.reference);
        if (!provision) {
          return errorContent(
            `Provision not found: ${parsed.sourcebook} ${parsed.reference}`,
            "not_found",
          );
        }
        const p = provision as Record<string, unknown>;
        return textContent({
          ...p,
          _citation: buildCitation(
            String(p["reference"] ?? parsed.reference),
            String(p["title"] ?? p["reference"] ?? parsed.reference),
            "mt_fin_get_regulation",
            { sourcebook: parsed.sourcebook, reference: parsed.reference },
            p["source_url"] as string | undefined,
          ),
        });
      }

      case "mt_fin_list_sourcebooks": {
        const sourcebooks = listSourcebooks();
        return textContent({ sourcebooks, count: sourcebooks.length });
      }

      case "mt_fin_search_enforcement": {
        const parsed = SearchEnforcementArgs.parse(args);
        const results = searchEnforcement({
          query: parsed.query,
          action_type: parsed.action_type,
          limit: parsed.limit,
        });
        const resultsWithCitations = results.map((r) => {
          const rec = r as Record<string, unknown>;
          const ref = String(rec["reference_number"] ?? rec["firm_name"] ?? "");
          return {
            ...rec,
            _citation: buildCitation(
              ref,
              String(rec["firm_name"] ?? ref),
              "mt_fin_search_enforcement",
              { query: ref },
            ),
          };
        });
        return textContent({ results: resultsWithCitations, count: results.length });
      }

      case "mt_fin_check_currency": {
        const parsed = CheckCurrencyArgs.parse(args);
        const currency = checkProvisionCurrency(parsed.reference);
        return textContent(currency as Record<string, unknown>);
      }

      case "mt_fin_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Malta Financial Services Authority (MFSA) MCP server. Provides access to MFSA Rules, Guidance Notes, Circulars, and enforcement actions.",
          data_source: "MFSA (https://www.mfsa.mt/)",
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      case "mt_fin_list_sources": {
        return textContent({
          sources: [
            {
              name: "MFSA",
              url: "https://www.mfsa.mt/",
              description:
                "Malta Financial Services Authority — the single regulator for financial services in Malta. Source of all rules, guidance notes, circulars, and enforcement actions in this corpus.",
            },
          ],
        });
      }

      case "mt_fin_check_data_freshness": {
        const dataAge = process.env["MFSA_DATA_AGE"] ?? "2024-01-01";
        return textContent({
          data_age: dataAge,
          status:
            "Data was ingested from MFSA publications up to the data_age date. Re-run the ingest script to refresh.",
          source: "https://www.mfsa.mt/",
        });
      }

      default:
        return errorContent(`Unknown tool: ${name}`, "invalid_input");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`, "internal_error");
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
