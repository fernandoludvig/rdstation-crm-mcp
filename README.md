# rdstation-crm-mcp

[![CI](https://github.com/fernandoludvig/rdstation-crm-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/fernandoludvig/rdstation-crm-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rdstation-crm-mcp.svg)](https://www.npmjs.com/package/rdstation-crm-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An open-source **[MCP](https://modelcontextprotocol.io) server for [RD Station CRM](https://crm.rdstation.com)** — the leading CRM in Brazil and Latin America. Manage contacts, deals, tasks and notes, and get pipeline health reports, straight from Claude or any MCP-compatible client.

> "How's my sales pipeline this month?" → stage-by-stage totals, win rate, and the deals going stale.

## Why

RD Station CRM is huge in the LatAm market, but had no open-source MCP server. This project connects it to the MCP ecosystem so AI agents can work your pipeline: qualifying leads, moving deals, scheduling follow-ups, and answering questions about your sales data in natural language.

## Quick start

1. Get your **instance token** in RD Station CRM: *Profile → Products and integrations → Instance token*.
2. Add the server to your MCP client.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rdstation-crm": {
      "command": "npx",
      "args": ["-y", "rdstation-crm-mcp"],
      "env": {
        "RDSTATION_CRM_TOKEN": "your-instance-token"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add rdstation-crm -e RDSTATION_CRM_TOKEN=your-instance-token -- npx -y rdstation-crm-mcp
```

That's it. Ask Claude something like *"list my open deals"* or *"give me a pipeline overview"*.

## Tools

| Tool | Description |
| --- | --- |
| `rdcrm_search_contacts` | Search contacts by name, email or phone |
| `rdcrm_get_contact` | Contact details, including linked deals |
| `rdcrm_upsert_contact` | Create a contact, or update it if the email already exists |
| `rdcrm_list_deals` | List deals filtered by status, pipeline, stage, owner, dates |
| `rdcrm_get_deal` | Deal details: stage, value, owner, contacts, products |
| `rdcrm_create_deal` | Create a deal — accepts stage by *name*, resolved automatically |
| `rdcrm_update_deal` | Move stage, change owner, rating, close date, pause/resume |
| `rdcrm_close_deal` | Mark won or lost (lost reasons resolved by name) |
| `rdcrm_list_tasks` | List tasks by deal, assignee, status, type, due date |
| `rdcrm_create_task` | Create a task (call, email, meeting, whatsapp...) on a deal |
| `rdcrm_add_note` | Add a note to a deal's timeline |
| `rdcrm_pipeline_overview` | Pipeline health report: totals per stage, win rate, stalled deals |

### Design notes

These tools are designed for LLMs, not as a 1:1 API wrapper:

- **Names instead of IDs.** Stages, pipelines, users and lost reasons can be passed by name; the server resolves them against the account and lists the valid options when something doesn't match.
- **Compact responses.** List tools return one line per record with the fields that matter, plus explicit pagination hints. Large responses are truncated with guidance instead of flooding the context window.
- **Actionable errors.** A 401 tells you which env var to check; an unknown stage lists every stage in every pipeline.
- **Aggregation where it counts.** `rdcrm_pipeline_overview` answers the questions humans actually ask ("where are deals stuck?") with a single tool call.

## Development

```bash
git clone https://github.com/fernandoludvig/rdstation-crm-mcp.git
cd rdstation-crm-mcp
npm install
npm test              # unit tests (API mocked with msw)
npm run typecheck
npm run build
RDSTATION_CRM_TOKEN=xxx npx @modelcontextprotocol/inspector node dist/index.js
```

The HTTP layer (`src/client/`) is isolated from the tools, with retry and exponential backoff for 429/5xx built in.

## Roadmap

- [ ] Organizations and products tools
- [ ] RD Station CRM API v2 support (OAuth) behind the same tool surface
- [ ] Streamable HTTP transport for remote deployments
- [ ] Publish to MCP registries (Glama, PulseMCP, Smithery)

Contributions welcome — open an issue first for anything non-trivial.

## License

[MIT](LICENSE) © Fernando Ludvig

*Not affiliated with or endorsed by RD Station. Uses the public [RD Station CRM API v1](https://developers.rdstation.com/reference/crm-v1-introducao-e-requisitos).*
