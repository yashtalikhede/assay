/**
 * Message formatting shared by every assertion. Messages are read by humans
 * in a terminal, so quoted output is bounded and control characters are shown
 * rather than printed.
 */

/** Quoted output longer than this is cut short. */
const MAX_QUOTED_LENGTH = 120;

/** Show newlines and tabs as escapes so a message stays on one line. */
function escapeControl(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r');
}

/**
 * Render text for a message: cut to 120 characters with an ellipsis, with
 * newlines escaped, wrapped in double quotes.
 */
export function quote(text: string): string {
  const head = text.slice(0, MAX_QUOTED_LENGTH);
  const ellipsis = text.length > MAX_QUOTED_LENGTH ? '…' : '';
  return `"${escapeControl(head)}${ellipsis}"`;
}

/** Format a dollar amount for a message. */
export function usd(amount: number): string {
  return `$${amount}`;
}
