# Documentation

This folder is the system-of-record for everything that doesn't live in code:

| File                       | Purpose                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| [`RUNBOOK.md`](RUNBOOK.md) | Step-by-step operational tasks: setup, deploy, rollback, secret rotation |
| [`CHANGELOG.md`](CHANGELOG.md) | Per-version log of what shipped                                    |
| [`schema.md`](schema.md)   | Database schema reference — every table and column                     |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 contract for every public API route                    |
| [`adr/`](adr/)             | Architecture Decision Records — one per major decision                 |

When the answer to "why did we do X?" is non-obvious from the code, it belongs here.
