# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

We support only the latest minor version. Please upgrade to receive security patches.

## Security Scanning

This project uses automated security scanning in CI/CD:

### Dependency Vulnerabilities
- **Dependabot**: Automated dependency updates (weekly, npm + GitHub Actions)
- **npm audit**: Run manually before releases

### Container Security
- **Docker image**: Built via `ghcr-build.yml` with multi-stage build and non-root user
- **Gitleaks**: Secret detection configured via `.gitleaks.toml`

### Data Freshness
- **check-freshness.yml**: Weekly automated check for new MFSA publications

> **Note:** Additional scanning layers (CodeQL, Semgrep, Trivy, Socket.dev, OSSF Scorecard)
> are planned but not yet implemented in CI. Contributions welcome — see CONTRIBUTING.md.

### What We Scan For
- Hardcoded secrets and credentials (Gitleaks)
- Known CVEs in dependencies (Dependabot + npm audit)
- SQL injection vulnerabilities (code review + prepared statements)

## Reporting a Vulnerability

If you discover a security vulnerability:

1. **Do NOT open a public GitHub issue**
2. Email: hello@ansvar.ai
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if you have one)

We will respond within 48 hours and provide a timeline for a fix.

## Security Best Practices

This project follows security best practices:

- All database queries use prepared statements (no SQL injection)
- Input validation on all user-provided parameters
- Read-only database access (no write operations at runtime)
- No execution of user-provided code
- Automated security testing in CI/CD
- Regular dependency updates via Dependabot

## Database Security

### Regulatory Database (SQLite)

The regulatory database is:
- Pre-built and version-controlled (tamper evident)
- Opened in read-only mode at runtime (no write risk)
- Source data from official regulatory authorities (auditable)
- Ingestion scripts require manual execution (no auto-download at runtime)

## Third-Party Dependencies

We minimize dependencies and regularly audit:
- Core runtime: Node.js, TypeScript
- MCP SDK: Official Anthropic package (`@modelcontextprotocol/sdk`)
- SQLite: `better-sqlite3`
- No unnecessary dependencies

All dependencies are tracked via `package-lock.json` and scanned for vulnerabilities.

---

**Last Updated**: 2026-04-10
