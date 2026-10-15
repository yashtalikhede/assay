/**
 * Shared types for assay. These shapes are the contract between the loader,
 * the planner, the providers and (in later phases) the runner and reporters.
 */

/** A value that can be substituted into a prompt template. */
export type Scalar = string | number | boolean;

/** A provider as named in a suite file: `kind:model` plus free-form config. */
export interface ProviderSpec {
  id: string;
  config?: Record<string, unknown>;
}

/** One generation request handed to a provider. */
export interface GenerateRequest {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** The outcome of one generation, including provider-measured latency. */
export interface GenerateResult {
  text: string;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
}

/** Anything that can turn a request into a single completion. */
export interface Provider {
  readonly id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** Builds a provider instance from its spec. */
export type ProviderFactory = (spec: ProviderSpec) => Provider;

/**
 * One assertion as written in a suite file. Per-type validation arrives in a
 * later phase; for now only `type` must be a non-empty string.
 */
export interface AssertionSpec {
  type: string;
  [key: string]: unknown;
}

/** A named prompt template, optionally with a system message. */
export interface PromptSpec {
  id: string;
  template: string;
  system?: string;
}

/** One test case: variables to render with, and assertions to apply. */
export interface TestSpec {
  name: string;
  prompt?: string;
  vars: Record<string, Scalar>;
  assert: AssertionSpec[];
}

/** Suite-wide generation defaults. */
export interface SuiteDefaults {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
}

/** A validated suite file. */
export interface Suite {
  version: 1;
  name: string;
  description?: string;
  providers: ProviderSpec[];
  prompts: PromptSpec[];
  tests: TestSpec[];
  defaults?: SuiteDefaults;
}

/** One concrete unit of work: a test, against one prompt, on one provider. */
export interface PlannedCase {
  caseId: string;
  provider: ProviderSpec;
  prompt: PromptSpec;
  test: TestSpec;
  renderedPrompt: string;
}
