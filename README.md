# assay

A test harness for LLM prompts and models. Write a YAML suite that lists your
prompts, the inputs to try them with, and the assertions that must hold; run it
across providers; diff one run against another so a prompt tweak or a model
upgrade that quietly made things worse shows up as a failure instead of a
surprise in production.

**Status: early development (phase A1: foundation).** What works today is the
suite file format with strict validation, the prompt template engine, the
provider interface with deterministic mock providers, the planner, and an
`assay validate` command. There are no real provider calls, no network access
and no API keys anywhere in this phase. The runner, the assertion engine, real
providers and `assay diff` are next — see the
[roadmap](docs/DESIGN.md#8-roadmap).

## Planned usage

A suite is a single YAML file:

```yaml
version: 1
name: support-replies

providers:
  - id: anthropic:claude-opus-5
  - id: openai:gpt-5

prompts:
  - id: reply
    system: You are a concise support agent.
    template: |
      Write a one-paragraph reply to this customer message.

      {{ message }}

tests:
  - name: refund-request
    vars:
      message: I was charged twice for March. Can I get a refund?
    assert:
      - type: icontains
        value: refund
      - type: max-latency
        ms: 5000
```

Then, from the command line:

```bash
assay validate suite.yaml    # works today
assay plan suite.yaml        # works today - lists the cases the suite expands to
assay run suite.yaml         # planned (phase A3)
assay diff before.json after.json   # planned (phase A6)
```

`validate` reports every problem in the file at once, with a path to each one:

```
suite.yaml: 2 validation errors
  providers[1].id: must look like "kind:model", e.g. "mock:echo"
  tests[0] "refund-request" prompt "reply": missing variable "message"
```

The bundled [`examples/basic.yaml`](examples/basic.yaml) uses mock providers
only, so it runs with no credentials:

```bash
node dist/cli.js validate examples/basic.yaml
# OK basic-demo: 4 tests, 2 prompts, 3 providers, 21 cases
```

## Development

Requires Node 20 or newer.

```bash
npm install
npm run check
```

`npm run check` runs the typecheck, the test suite, the formatting check and the
build, which is exactly what CI runs on Node 20 and 22. Individual scripts:

| Script                 | What it does                                 |
| ---------------------- | -------------------------------------------- |
| `npm run build`        | Compile `src` to `dist`                      |
| `npm run typecheck`    | Type-check `src` and `test` without emitting |
| `npm test`             | Run the vitest suite                         |
| `npm run format`       | Format everything with prettier              |
| `npm run format:check` | Check formatting without writing             |

## Documentation

[`docs/DESIGN.md`](docs/DESIGN.md) is the full design document: the suite file
format with every validation rule, the template language, the architecture, the
provider contract, the reasoning behind the main decisions, and the roadmap.

## License

MIT — see [LICENSE](LICENSE).
