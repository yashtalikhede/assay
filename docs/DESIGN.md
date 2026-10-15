# assay — design

`assay` is a test harness for large language model prompts and models. You
write a YAML **suite** that lists the prompts you care about, the inputs to try
them with, and the assertions that must hold. `assay` runs that suite across one
or more providers, records the results, and diffs one run against another so a
prompt or model change that quietly made things worse shows up as a failure.

This document describes the whole system, and marks clearly which parts exist
today. The current phase is **A1 (foundation)**: the suite format, the template
engine, the planner, deterministic mock providers and a `validate` command.

## 1. Purpose and goals

Prompts are code with no compiler. A reworded instruction, a model upgrade or a
temperature change can improve nine cases and break the tenth, and nothing tells
you. `assay` makes that visible the way a unit test suite does.

Goals:

- **Prompts under test.** A suite is a plain file in your repository, reviewed
  in pull requests and run in CI.
- **Deterministic structure.** The same suite always expands to the same cases,
  in the same order, with the same identifiers — the precondition for diffing.
- **Multi-provider by construction.** The same test runs against several
  providers and models, so comparisons are the normal case, not a special mode.
- **Fast feedback.** Caching, concurrency and a terse console report, so running
  a suite is cheap enough to do on every change.
- **Honest failures.** Every validation problem in a suite is reported at once,
  with a path to the offending key, rather than one error per run.
- **No secrets in suites.** API keys come from the environment only.

Non-goals:

- Not a hosted service. `assay` is a CLI and a library; there is no server, no
  account and no dashboard to log into.
- Not a prompt-optimisation tool. It tells you whether a prompt meets your
  assertions; it does not rewrite prompts for you.
- No UI beyond a static, single-file HTML report you can open or attach to a
  build.
- No telemetry. `assay` reports nothing anywhere.

## 2. Concepts

- **Suite** — one YAML file: the providers, prompts, tests and defaults that
  belong together. The unit you run.
- **Provider** — somewhere a prompt can be sent, named `kind:model` (for example
  `anthropic:claude-opus-5` or `mock:echo`).
- **Prompt** — a named template with `{{ variable }}` placeholders, plus an
  optional system message.
- **Test** — a name, a set of variable values, and the assertions that must hold
  for the output. Optionally pinned to one prompt.
- **Assertion** — one check on a result, such as `contains`, `regex` or
  `max-latency`. A typed object; the `type` key selects the check.
- **Case** — one test, against one prompt, on one provider: the smallest unit of
  work, with a stable `caseId`.
- **Run** — the execution of every case in a suite, and the record of what came
  back.
- **Diff** — the comparison of two runs, case by case, which turns "this used to
  pass" into a failing exit code.

## 3. The suite file format

A suite is a YAML mapping with the keys below. Unknown keys are errors
everywhere except inside an assertion and inside `providers[].config`, so a typo
such as `assrt:` is caught instead of silently ignored.

### Annotated example

```yaml
# The format version. Must be the literal 1.
version: 1

# Required. Appears in reports and in the `validate` output.
name: basic-demo

# Optional free text.
description: Demonstrates the suite format with deterministic mock providers.

# Optional generation defaults, applied to every case (phase A3 onward).
defaults:
  temperature: 0 # 0..2
  maxTokens: 512 # positive integer
  timeoutMs: 30000 # positive integer
  retries: 1 # integer 0..10

# At least one provider. `id` is `kind:model`; `config` is free-form and is
# validated by the provider itself, not by the suite schema.
providers:
  - id: mock:echo
  - id: mock:fixed
    config:
      response: Paris is the capital of France.

# At least one prompt. `id` must be safe for use in case ids.
prompts:
  - id: summarize
    system: You are a terse assistant. Answer in one sentence.
    template: |
      Summarise the following text in one sentence.

      {{ text }}
  - id: qa
    template: 'Answer the question as briefly as possible: {{ question }}'

# At least one test, each with at least one assertion.
tests:
  # No `prompt:` key, so this test runs against every prompt in the suite and
  # must supply the variables all of them need.
  - name: caching-note
    vars:
      text: Caching responses avoids repeated work.
      question: What does caching avoid?
    assert:
      - type: contains
        value: caching
      - type: max-latency
        ms: 2000

  # No `name:` key: the loader assigns "test-2" from the 1-based position.
  - vars:
      text: Paris has been the capital of France for centuries.
      question: What is the capital of France?
    assert:
      - type: contains
        value: Paris

  # Pinned to one prompt, so only that prompt's variables are needed.
  - name: json-shape
    prompt: qa
    vars:
      question: Return a JSON object with the keys "city" and "country".
    assert:
      - type: json-schema
        schema:
          type: object
          required: [city, country]
```

### Validation rules

Structural rules, checked by the schema. Every failure is collected; the loader
never stops at the first one.

| Rule                                                                                                |
| --------------------------------------------------------------------------------------------------- |
| The top level must be a YAML mapping.                                                               |
| `version` must be the number `1`.                                                                   |
| `name` must be a non-empty string.                                                                  |
| `description`, when present, must be a string.                                                      |
| `providers` must be an array with at least one entry.                                               |
| `providers[].id` must be a non-empty string matching `^[a-z][a-z0-9-]*:[^\s]+$`.                    |
| `providers[].config`, when present, must be a mapping; its contents are free.                       |
| `prompts` must be an array with at least one entry.                                                 |
| `prompts[].id` must be a non-empty string matching `^[A-Za-z0-9_-]+$`.                              |
| `prompts[].template` must be a string.                                                              |
| `prompts[].system`, when present, must be a string.                                                 |
| `tests` must be an array with at least one entry.                                                   |
| `tests[].name`, when present, must be a non-empty string.                                           |
| `tests[].prompt`, when present, must be a non-empty string.                                         |
| `tests[].vars`, when present, must map names to strings, numbers or booleans.                       |
| `tests[].assert` must be an array with at least one entry.                                          |
| Every assertion must have a non-empty string `type`; other keys are free.                           |
| `defaults.temperature` must be a number from 0 to 2.                                                |
| `defaults.maxTokens` must be a positive integer.                                                    |
| `defaults.timeoutMs` must be a positive integer.                                                    |
| `defaults.retries` must be an integer from 0 to 10.                                                 |
| Unknown keys at the top level and inside `providers`, `prompts`, `tests` and `defaults` are errors. |

Cross-field rules, checked once the structure is sound:

| Rule                                                                    |
| ----------------------------------------------------------------------- |
| Provider ids must be unique.                                            |
| Prompt ids must be unique.                                              |
| Test names must be unique, after unnamed tests are given `test-<n>`.    |
| `tests[].prompt` must name a prompt that exists.                        |
| Every prompt a test applies to must be fully satisfiable by its `vars`. |
| Every prompt template must be well formed.                              |

Each problem becomes one line, path first, then message:

```
examples/broken.yaml: 3 validation errors
  version: must be 1
  providers[1]: duplicate provider id "mock:echo"
  tests[0] "t" prompt "qa": missing variable "question"
```

### Defaulting and normalisation

A loaded `Suite` is normalised, so later phases never deal with absent values:

- A test with no `name` gets `test-<n>`, where `n` is its 1-based position.
  Uniqueness is checked **after** this, so a literal `test-1` colliding with a
  defaulted `test-1` is an error.
- A test with no `vars` gets `{}`.
- A test with no `prompt` applies to every prompt in the suite.

The loader never mutates its input; it builds a fresh object.

## 4. The template language

Prompts use a deliberately small template language.

- A placeholder is `{{ name }}`. Spaces around the name are optional:
  `{{name}}`, `{{ name }}` and `{{  name  }}` are the same.
- Names match `^[A-Za-z_][A-Za-z0-9_.-]*$`. Dots and dashes are allowed **as
  part of the name**; they do not mean nesting. Lookup is flat: `{{ a.b }}`
  looks for a variable literally called `a.b`.
- No expressions, no conditionals, no loops, no filters, no partials.
- Values are converted with `String()`, so `42` renders as `42` and `true` as
  `true`.
- Variables not referenced by the template are ignored.
- Rendering with variables missing throws, listing **all** missing names at
  once, sorted — not just the first.
- A malformed placeholder is an error, not literal text: an unclosed `{{`, an
  empty `{{ }}` and an invalid name such as `{{ 1bad }}` all throw. A stray
  `}}` with no opening `{{` is ordinary text and is left alone.

**Limitation: there is no escape syntax in this version.** A template cannot
contain a literal `{{` that is not a placeholder. If you need to emit `{{`,
pass it in as a variable value for now. An escape form (most likely `{{{{`) will
be added when something real needs it; adding it later is a compatible change,
because every template that is valid today has no literal `{{`.

A prompt's `system` string is **not** templated in phase A1; it is passed to the
provider verbatim. Templating it is part of the runner work in A3, and will be
validated the same way `template` is.

## 5. Architecture

The pipeline is a chain of small, independently testable stages:

```
  suite.yaml
      |
      v
  +----------+     Suite      +---------+   PlannedCase[]   +--------+
  |  loader  | -------------> | planner | ----------------> | runner |
  +----------+                +---------+                   +--------+
   YAML parse                  tests x                     concurrency,
   strict schema               prompts x                   timeouts,
   all errors at once          providers                   retries, cache
                               stable caseIds                   |
                                                                | CaseResult[]
                                                                v
                                                        +--------------+
                                                        |  assertions  |
                                                        +--------------+
                                                                |
                                                                | Run
                                                                v
                                                        +--------------+
                                                        |  reporters   |
                                                        +--------------+
                                                         console / JSON / HTML

  run A (run.json) ---+
                      +--> diff --> changed cases, new failures, exit code
  run B (run.json) ---+
```

A **provider** sits beside the runner, not inside it: the runner asks a
`Provider` for text and knows nothing about HTTP, authentication or pricing.

What exists today (phase A1):

- **loader** — `src/core/suite.ts`: YAML parsing, strict schema, all errors at
  once, cross-field checks.
- **template engine** — `src/core/template.ts`.
- **planner** — `src/core/plan.ts`.
- **provider interface and registry** — `src/core/types.ts`,
  `src/providers/registry.ts`.
- **mock providers** — `src/providers/mock.ts`.
- **CLI** — `assay validate` and `assay plan`.

What comes later: the runner and `assay run` (A3), the assertion engine (A2),
real providers (A4), reporters and `assay diff` (A6). See the roadmap.

## 6. The provider interface contract

```ts
interface Provider {
  readonly id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
```

A `generate` implementation must:

- **Return text or throw.** On success, resolve with `text` (possibly empty) and
  a `latencyMs`. There is no error channel in the result.
- **Measure its own latency.** `latencyMs` is wall-clock time measured inside
  the provider with `performance.now()`, covering everything the provider did,
  including retries it handled internally. It is never copied from
  configuration, and the runner does not overwrite it — a provider is the only
  thing that knows what it actually spent.
- **Report usage when it knows it.** `usage.inputTokens` and
  `usage.outputTokens` come from the API when it reports them; `costUsd` is
  filled in when the provider can price the call. Both are optional, because
  some providers report neither.
- **Throw `ProviderError` for provider-level failures.** `retryable` is the
  provider's judgement, not the runner's: `true` for timeouts, 429s and 5xxs,
  `false` for authentication failures, malformed requests and content refusals.
  The runner retries only when `retryable` is `true`, so a wrong answer here is
  either a wasted minute or a spurious failure. `status` carries the HTTP status
  when there is one, for reports.
- **Honour `req.signal`.** If the signal is already aborted, reject immediately;
  if it aborts mid-flight, abandon the work and reject. Reject **with the
  signal's `reason`**, not with a `ProviderError`, so a cancellation is never
  mistaken for a provider failure and is never retried. Cancellation is how the
  runner implements timeouts and how `Ctrl-C` stops a run promptly.
- **Be constructible without side effects.** A factory validates its config and
  throws `AssayError` on bad config at creation time, so a mistyped suite fails
  before any request is sent.

`ProviderSpec.config` is deliberately untyped in the schema: each provider
validates its own config, because only it knows what it accepts.

### Mock provider semantics

The mocks exist so the rest of the system can be tested without a network.
`mock:echo` returns the prompt, `mock:fixed` returns a configured string,
`mock:script` cycles a list of responses with a per-instance counter, and
`mock:fail` always throws a `ProviderError` with a configurable `retryable` and
`status`. Token usage is estimated as `ceil(characters / 4)` — the input being
the prompt plus the system message when one is given — and `costUsd` is derived
from `inputCostPer1k` and `outputCostPer1k` when both are configured. Nothing in
the mocks calls `Math.random` or `Date.now`; `performance.now()` appears only to
measure latency.

## 7. Design decisions

**A strict schema that catches typos.** Unknown keys are errors, not ignored
input. The failure mode of a permissive schema is the worst one available: a
suite with `assrt:` instead of `assert:` passes validation, runs, and reports
success for a test that checks nothing. Assertion bodies and provider configs
are the two deliberate exceptions, because their shape is owned by the assertion
type and the provider, not by the suite schema.

**Collect every validation error.** Suites are edited by hand, often in bulk.
One-error-per-run turns a five-mistake file into five edit-run cycles. The
loader therefore validates structurally, collects every schema issue, and only
then runs cross-field checks — which need a structurally sound suite to be
meaningful at all.

**Deterministic case order and ids.** Cases are generated tests-then-prompts-
then-providers in file order, and a `caseId` is
`<test>::<prompt>::<provider>` — derived from names, never from positions or
hashes. This is what makes `assay diff` possible: two runs of the same suite
line up by id, a renamed test shows up as one removal and one addition rather
than shifting every result after it, and adding a test does not renumber
anything. It is also why prompt ids and test names are constrained and must be
unique.

**Mock providers rather than recorded network traffic.** Cassette-style
recordings drift from the API, are large, carry secrets, and have to be
re-recorded when a prompt changes by a character. The mocks are a few dozen
lines, cover the cases that actually matter to the runner (fixed output, varying
output, failure, slowness, cancellation) and are exactly reproducible. Real
providers (A4) get tested against an injected `fetch`, so request construction
and response parsing are still covered without a network.

**API keys come only from the environment.** This is a rule for every later
phase: `assay` reads credentials from environment variables only. A suite file
must never hold a key, and there is no config field to put one in — suites live
in git. Keys are never written to a run record, a cache entry, a report or a log
line, and provider errors are constructed so that request headers cannot leak
into a message.

**A CLI that is a function.** `run(argv, io)` takes its streams and working
directory as arguments and returns an exit code instead of calling
`process.exit`. The whole CLI is therefore testable in-process, with no
subprocesses and no global state, and `src/cli.ts` is three lines.

**Zero runtime dependencies beyond parsing and validation.** Only `yaml` and
`zod`. A test harness that is slow or awkward to install does not get used.

## 8. Roadmap

| Phase  | Scope                                                                                                                                                     | Status   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **A1** | Foundation: project scaffold, suite format with strict validation, template engine, provider interface, mock providers, planner, `assay validate`, CI     | **done** |
| **A2** | Deterministic assertions: `equals`, `contains`, `icontains`, `regex`, `starts-with`, `json-valid`, `json-schema`, `max-latency`, `max-cost`, `max-tokens` | planned  |
| **A3** | Runner: concurrency, timeouts, retries with backoff, on-disk cache keyed by a hash of provider + prompt + params, cancellation; `assay run`               | planned  |
| **A4** | Real providers over `fetch`: Anthropic, OpenAI, Google Gemini, Ollama, with a price table; tested with an injected `fetch`                                | planned  |
| **A5** | LLM-as-judge and similarity assertions                                                                                                                    | planned  |
| **A6** | Reporters (console table, JSON, single-file HTML) and `assay diff` with regression exit codes                                                             | planned  |
| **A7** | GitHub Action, more examples, README polish, v0.1.0 release                                                                                               | planned  |
