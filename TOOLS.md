# Tool Reference

All tools use the `mt_fin_` prefix. Every response includes a `_meta` block with disclaimer, data age, copyright, and source URL.

---

## mt_fin_search_regulations

Full-text search across MFSA Rules, Guidance Notes, and Circulars.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `"investment services"`, `"AML obligations"`) |
| `sourcebook` | string | No | Filter by sourcebook ID (e.g., `MFSA_Rules`, `MFSA_Guidance_Notes`, `MFSA_Circulars`) |
| `status` | enum | No | Filter by status: `in_force`, `deleted`, `not_yet_in_force` |
| `limit` | number | No | Max results (default: 20, max: 100) |

**Response:** `{ _meta, results: [...], count }` — each result includes a `_citation` block.

---

## mt_fin_get_regulation

Get a specific MFSA provision by sourcebook and reference.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourcebook` | string | Yes | Sourcebook ID (e.g., `MFSA_Rules`) |
| `reference` | string | Yes | Provision reference (e.g., `MFSA_Rules ISL.1.2`) |

**Response:** `{ _meta, ...provision fields, _citation }`.

**Error:** `{ error, _meta, _error_type: "not_found" }` if provision does not exist.

---

## mt_fin_list_sourcebooks

List all MFSA sourcebooks with names and descriptions.

**Input:** None.

**Response:** `{ _meta, sourcebooks: [...], count }`.

---

## mt_fin_search_enforcement

Search MFSA enforcement actions — administrative penalties, licence withdrawals, and public warnings.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (firm name, breach type, etc.) |
| `action_type` | enum | No | Filter: `fine`, `ban`, `restriction`, `warning` |
| `limit` | number | No | Max results (default: 20, max: 100) |

**Response:** `{ _meta, results: [...], count }` — each result includes a `_citation` block (best-effort; no singleton lookup tool exists for enforcement actions).

---

## mt_fin_check_currency

Check whether a specific MFSA provision reference is currently in force.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | Provision reference (e.g., `MFSA_Rules ISL.1.2`) |

**Response:** `{ _meta, reference, status, effective_date }`.

---

## mt_fin_about

Return metadata about this MCP server.

**Input:** None.

**Response:** `{ _meta, name, version, description, data_source, tools: [...] }`.

---

## mt_fin_list_sources

List all data sources used by this server. Required meta-tool for non-law MCPs.

**Input:** None.

**Response:** `{ _meta, sources: [{ name, url, description }] }`.

---

## mt_fin_check_data_freshness

Return the data age and freshness information for the regulatory corpus.

**Input:** None.

**Response:** `{ _meta, data_age, status, source }`.

The `data_age` value is controlled by the `MFSA_DATA_AGE` environment variable (default: `2024-01-01`).

---

## _meta block

All responses include a top-level `_meta` object:

```json
{
  "_meta": {
    "disclaimer": "This data is provided for informational purposes only...",
    "data_age": "2024-01-01",
    "copyright": "Malta Financial Services Authority (MFSA)",
    "source_url": "https://www.mfsa.mt/"
  }
}
```

## _citation block

Retrieval responses include a `_citation` object enabling deterministic entity linking:

```json
{
  "_citation": {
    "canonical_ref": "MFSA_Rules ISL.1.2",
    "display_text": "ISL.1.2 MFSA Rules",
    "lookup": {
      "tool": "mt_fin_get_regulation",
      "args": { "sourcebook": "MFSA_Rules", "reference": "MFSA_Rules ISL.1.2" }
    }
  }
}
```

## _error_type values

| Value | When used |
|-------|-----------|
| `not_found` | Provision lookup returned no result |
| `internal_error` | Unexpected exception during tool execution |
| `invalid_input` | Unknown tool name |
