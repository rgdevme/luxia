import type { Logger } from "./types/public.js";

const COLORS = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

function paint(color: keyof typeof COLORS, msg: string): string {
  if (!process.stdout.isTTY) return msg;
  return `${COLORS[color]}${msg}${COLORS.reset}`;
}

/** Dim/grey secondary text (e.g. an inline description). No-op off a TTY. */
export function dim(msg: string): string {
  return paint("gray", msg);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Run `fn` while an animated spinner ticks on stderr. Skipped (so `fn` just
 * runs) when stderr isn't a TTY or `quiet` is set, keeping scripts, CI, and the
 * test suite free of escape codes.
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  opts: { quiet?: boolean } = {},
): Promise<T> {
  if (opts.quiet || !process.stderr.isTTY) return fn();
  let frame = 0;
  const render = (): void => {
    const glyph = SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length];
    process.stderr.write(`\r${COLORS.cyan}${glyph}${COLORS.reset} ${message}`);
  };
  process.stderr.write("\x1b[?25l"); // hide cursor
  render();
  const timer = setInterval(render, 80);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    process.stderr.write("\r\x1b[2K\x1b[?25h"); // clear line + restore cursor
  }
}

export interface CreateLoggerOptions {
  debug?: boolean;
  quiet?: boolean;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const debugEnabled = opts.debug ?? process.env["AGNOS_DEBUG"] === "1";
  const quiet = opts.quiet ?? false;
  const noop = () => {};
  return {
    info: quiet
      ? noop
      : (msg) => {
          console.log(msg);
        },
    success: quiet
      ? noop
      : (msg) => {
          console.log(paint("green", "✓ ") + msg);
        },
    warn(msg) {
      console.warn(paint("yellow", "! ") + msg);
    },
    error(msg) {
      console.error(paint("red", "✗ ") + msg);
    },
    debug: quiet
      ? noop
      : (msg) => {
          if (!debugEnabled) return;
          console.error(paint("gray", "· " + msg));
        },
  };
}

/**
 * Wrap a logger to prepend `indent` to every message. Used by the orchestrator
 * to keep nested hook output visually aligned (e.g., 4-space indent inside an
 * agent's per-domain handler).
 */
export function indentedLogger(base: Logger, indent: string): Logger {
  if (!indent) return base;
  return {
    info: (msg) => base.info(`${indent}${msg}`),
    success: (msg) => base.success(`${indent}${msg}`),
    warn: (msg) => base.warn(`${indent}${msg}`),
    error: (msg) => base.error(`${indent}${msg}`),
    debug: (msg) => base.debug(`${indent}${msg}`),
  };
}
