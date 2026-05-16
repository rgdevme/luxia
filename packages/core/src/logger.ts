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
