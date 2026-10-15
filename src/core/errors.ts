/** Error classes used across assay. Every thrown error extends AssayError. */

/** Base class for every error assay raises deliberately. */
export class AssayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AssayError';
  }
}

/**
 * A suite file could not be read, parsed or validated. `message` is a single
 * header line; `issues` holds one human-readable line per problem found.
 */
export class SuiteError extends AssayError {
  readonly issues: string[];

  constructor(message: string, issues: string[], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SuiteError';
    this.issues = issues;
  }
}

/** A template was malformed, or variables it references were not supplied. */
export class TemplateError extends AssayError {
  readonly missing: string[];

  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = 'TemplateError';
    this.missing = missing;
  }
}

/** Options accepted by the ProviderError constructor. */
export interface ProviderErrorOptions {
  retryable?: boolean;
  status?: number;
  cause?: unknown;
}

/** A provider failed. `retryable` tells the runner whether to try again. */
export class ProviderError extends AssayError {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, opts: ProviderErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'ProviderError';
    this.retryable = opts.retryable ?? false;
    if (opts.status !== undefined) this.status = opts.status;
  }
}

/** A provider id named a kind that is not registered. */
export class UnknownProviderError extends AssayError {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownProviderError';
  }
}
