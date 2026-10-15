# assay

A test harness for LLM prompts and models. Write a YAML suite that lists your
prompts, the inputs to try them with, and the assertions that must hold; run it
across providers; diff one run against another so a prompt tweak or a model
upgrade that quietly made things worse shows up as a failure instead of a
surprise in production.

**Status: early development (phases A1 foundation and A2 assertions complete).**
What works today is the suite file format with strict validation, the prompt
template engine, the deterministic assertion engine, the provider interface with
deterministic mock providers, the planner, and the `validate`, `plan` and
`check` commands. There are no real provider calls, no network access and no API
keys anywhere in these phases. The runner (`assay run`), real providers and
`assay diff` are next — see the [roadmap](docs/DESIGN.md#9-roadmap).

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
      topic: refund
    assert:
      - type: contains
        value: '{{ topic }}'
        caseSensitive: false
      - type: length
        min: 40
        max: 800
      - type: max-latency
        value: 5000
```

Then, from the command line:

```bash
assay validate suite.yaml    # works today
assay plan suite.yaml        # works today - lists the cases the suite expands to
assay check suite.yaml --test refund-request --output "..."   # works today
assay run suite.yaml         # planned (phase A3)
assay diff before.json after.json   # planned (phase A6)
```

`validate` reports every problem in the file at once, with a path to each one:

```
suite.yaml: 3 validation errors
  providers[1].id: must look like "kind:model", e.g. "mock:echo"
  tests[0].assert[1] (length): min: "min" must not be greater than "max"
  tests[0] "refund-request" assert[0]: missing variable "topic"
```

## Assertions

Assertions are deterministic: no clock, no randomness, no network, and the same
context always gives the same result. Every type also accepts `description`
(shown in reports) and `not: true` (inverts the check).

| Type                            | Passes when                                       |
| ------------------------------- | ------------------------------------------------- |
| `equals`                        | the whole output equals `value`                   |
| `contains`                      | `value` appears in the output                     |
| `contains-all` / `contains-any` | every / at least one of `values` appears          |
| `starts-with` / `ends-with`     | the output begins / ends with `value`             |
| `regex`                         | `pattern` matches anywhere in the output          |
| `json-valid`                    | the output parses as JSON                         |
| `json-schema`                   | the JSON output satisfies `schema` (via Ajv)      |
| `max-latency`                   | the call was no slower than `value` ms            |
| `max-cost` / `max-tokens`       | the call cost / completion size is within `value` |
| `length`                        | the output length is within `min` and `max`       |

The comparison values of the text assertions are templates, so a test can supply
both the input and the expected answer from one variable. `regex` patterns and
JSON schemas are deliberately **not** interpolated. The full reference is in
[docs/DESIGN.md](docs/DESIGN.md#5-assertions).

## Trying assertions without a model

`assay check` evaluates one test's assertions against output you supply, so you
can get a suite's assertions right before spending anything on a model. Against
the bundled [`examples/basic.yaml`](examples/basic.yaml):

```bash
node dist/cli.js check examples/basic.yaml --test caching-note \
  --output "Caching avoids repeated work, so caching cuts both latency and cost." \
  --latency 18
```

```
PASS (mentions the subject it was asked about) contains "caching"
PASS latency 18ms <= 2000ms
PASS output length 68 >= 1
3/3 assertions passed
```

It exits 0 when everything passes and 1 when anything fails:

````bash
node dist/cli.js check examples/basic.yaml --test json-shape --output 'Sure! Here you go:
```json
{"city": "Paris"}
```'
````

```
FAIL expected output to match the JSON schema, errors: /: must have required property 'country'
PASS output length 48 <= 2000
1/2 assertions passed
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
format with every validation rule, the template language, the assertion
reference, the architecture, the provider contract, the reasoning behind the
main decisions, and the roadmap.

## License

MIT — see [LICENSE](LICENSE).
