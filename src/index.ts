/** Public entry point: everything a consumer of assay needs. */

export type { CliIo } from './cli-run.js';
export { run } from './cli-run.js';
export {
  AssayError,
  ProviderError,
  SuiteError,
  TemplateError,
  UnknownProviderError,
} from './core/errors.js';
export type { ProviderErrorOptions } from './core/errors.js';
export { plan } from './core/plan.js';
export { loadSuite, parseSuite } from './core/suite.js';
export { render, variablesOf } from './core/template.js';
export type {
  AssertionSpec,
  GenerateRequest,
  GenerateResult,
  PlannedCase,
  PromptSpec,
  Provider,
  ProviderFactory,
  ProviderSpec,
  Scalar,
  Suite,
  SuiteDefaults,
  TestSpec,
} from './core/types.js';
export { MOCK_KIND, createMockProvider, estimateTokens } from './providers/mock.js';
export { ProviderRegistry, createDefaultRegistry, splitProviderId } from './providers/registry.js';
