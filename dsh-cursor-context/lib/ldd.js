/**
 * LDD 2.0 logger for `dsh-cursor-context`.
 *
 * Every diagnostic in this bundle uses one fixed line grammar:
 *
 * ```
 * [CLASSIFIER][IMP:1-10][FUNCTION_NAME][BLOCK_NAME][OPERATION_TYPE] Description [STATUS]
 * ```
 *
 * The point of the grammar is machine readability. `CLASSIFIER` is the module name,
 * `IMP` marks how expensive a mistake at that line is, `FUNCTION_NAME` and
 * `BLOCK_NAME` locate the source node, `OPERATION_TYPE` says what the line does, and
 * `STATUS` is the outcome. A human reader gets a readable sentence, and an agent
 * that only sees the log file can grep for a block and walk straight to the code.
 *
 * Every write path is wrapped in `try`, because a logger is a diagnostic tool and a
 * broken logger must never break the plugin or a model request.
 *
 * @module dsh-cursor-context/ldd
 */

// START_MODULE_CONTRACT
// FILE: dsh-cursor-context/lib/ldd.js
// VERSION: 1.0.0
// PURPOSE: Format and emit LDD 2.0 diagnostics for one classifier, never throwing into the caller.
// SCOPE: Line formatting, level routing, defensive emission.
// INPUT: A Cordis-like context with an optional `logger`.
// OUTPUT: A frozen logger with `emit`, `info`, `warn`.
// KEYWORDS: DOMAIN(7): diagnostics; CONCEPT(8): ldd-grammar; TECH(5): fail-soft-logging
// LINKS: USES_API(6): ctx.logger
// LINKS_TO_SPECIFICATION: user markup contract, LDD 2.0
// END_MODULE_CONTRACT

// START_CHANGE_SUMMARY
// LAST_CHANGE: 1.0.0 — initial formatter for the bundle diagnostics.
// PREV_CHANGE_SUMMARY: none
// END_CHANGE_SUMMARY

// START_MODULE_MAP:
// CONST [4] Default classifier shown as the first bracket group => CLASSIFIER
// CONST [4] Statuses that must reach the warn level => WARN_STATUSES
// FUNCTION [4] Render one LDD 2.0 line => formatLine
// FUNCTION [7] Build the fail-soft logger bound to one context => createLdd
// END_MODULE_MAP

const CLASSIFIER = 'cursor-context';

const WARN_STATUSES = new Set(['FAIL', 'SKIP', 'REJECT']);

/**
 * Render one LDD 2.0 line.
 *
 * The function tolerates missing fields so that a caller in a hurry can log a bare
 * message: an absent `imp` renders as `0`, an absent `fn`, `block`, or `op` renders as
 * `-`, and the status defaults to `OK`. Numbers are clamped into the documented
 * `1-10` band, so a stray `IMP:15` cannot appear and confuse a grep.
 *
 * @param fields - partial LDD fields: `imp`, `fn`, `block`, `op`, `text`, `status`.
 * @param classifier - optional override of the first bracket group.
 * @returns one bracketed line without a trailing newline.
 */
// START_FUNCTION_formatLine
export function formatLine(fields, classifier = CLASSIFIER) {
  const impRaw = Number(fields?.imp);
  const imp = Number.isFinite(impRaw) ? Math.min(10, Math.max(1, Math.trunc(impRaw))) : 0;
  const fn = typeof fields?.fn === 'string' && fields.fn.length > 0 ? fields.fn : '-';
  const block = typeof fields?.block === 'string' && fields.block.length > 0 ? fields.block : '-';
  const op = typeof fields?.op === 'string' && fields.op.length > 0 ? fields.op : '-';
  const text = typeof fields?.text === 'string' ? fields.text : String(fields?.text);
  const status = typeof fields?.status === 'string' && fields.status.length > 0 ? fields.status : 'OK';
  return `[${classifier}][IMP:${imp}][${fn}][${block}][${op}] ${text} [${status}]`;
}
// END_FUNCTION_formatLine

/**
 * Build the fail-soft logger bound to one plugin context.
 *
 * The returned object is frozen and safe to destructure. `emit` renders the line and
 * routes it: a status in `WARN_STATUSES` goes to `logger.warn`, everything else to
 * `logger.info`. `info` and `warn` are shorthand for a bare prefixed line, which is what
 * a plain note outside the LDD grammar uses. If the context has no usable logger, every
 * method becomes a no-op instead of throwing, and the plugin keeps working without
 * diagnostics.
 *
 * @param ctx - plugin root context.
 * @param classifier - optional override of the first bracket group.
 * @returns a frozen logger with `emit`, `info`, `warn`.
 */
// START_FUNCTION_createLdd
export function createLdd(ctx, classifier = CLASSIFIER) {
  const write = (level, line) => {
    try {
      const target = level === 'warn' ? ctx?.logger?.warn : ctx?.logger?.info;
      if (typeof target === 'function') target.call(ctx.logger, line);
    } catch {
      // a broken logger must never break the plugin
    }
  };

  return Object.freeze({
    emit(fields) {
      write(WARN_STATUSES.has(fields?.status) ? 'warn' : 'info', formatLine(fields, classifier));
    },
    info(text) {
      write('info', `[${classifier}] ${text}`);
    },
    warn(text) {
      write('warn', `[${classifier}] ${text}`);
    },
  });
}
// END_FUNCTION_createLdd
