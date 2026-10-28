# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x (including 1.0.0 beta releases) | Yes |
| Earlier development builds | No |

Security fixes are released for the latest 1.x version. Upgrade to it before reporting.

## Reporting a vulnerability

Please report vulnerabilities **privately**, not in public issues:

1. Preferred: GitHub private vulnerability reporting, at
   [Security → Report a vulnerability](https://github.com/IliasSami/prism-geo/security/advisories/new).
2. Or email the maintainer at **iliassami57@gmail.com**.

Include the version (or commit), how PrismGEO is deployed (local, Docker, behind a proxy), the steps to reproduce and the impact. You will get an acknowledgement within a few days. Please give us a reasonable time to release a fix before disclosing it.

## Security model, in short

PrismGEO is a self-hosted, single-user tool and **has no login**. It listens on `127.0.0.1` by default, only answers to allowed host names (DNS-rebinding protection), and only accepts same-origin JSON for changes. Exposing it to a network without your own authentication in front is not a supported configuration. The MCP endpoint (`/api/mcp`) is protected by a random token.

API keys, the proxy password, the MCP connector token and signed-in browser sessions are stored unencrypted in the local `data/` folder, and a database backup contains them. See the README's "Security model" section.

PrismGEO sends no telemetry, analytics or crash reports. Data leaves your machine only as the queries the crawler sends to the AI engines and APIs you enable, and the pages they cite that it fetches.

Reports in scope include: bypasses of the Host allowlist or same-origin checks, reading secrets through the API or MCP tools (including `query_database`), server-side request forgery through the crawler, and code execution. Findings that require someone already able to reach an unauthenticated, publicly exposed instance are expected behaviour of that misconfiguration.
