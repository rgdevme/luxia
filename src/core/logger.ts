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

// At most one spinner animates at a time. `active` is the spinner's mutable
// state (so `update` can swap the message live); the logger consults it to wipe
// the spinner line before printing so log output never lands mid-frame.
let active: { message: string } | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let frame = 0;

function renderActive(): void {
  if (!active) return;
  const glyph = SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length];
  process.stderr.write(`\r${COLORS.cyan}${glyph}${COLORS.reset} ${active.message}`);
}

/**
 * Erase the current spinner frame from the stderr line so the next write starts
 * clean. No-op when no spinner is running (which includes every non-TTY run, so
 * scripts/tests are unaffected). The spinner redraws itself on its next tick.
 */
function clearActiveLine(): void {
  if (active) process.stderr.write("\r\x1b[2K");
}

export interface Spinner {
  /** Swap the displayed message (takes effect on the next frame). */
  update(message: string): void;
  /** Stop animating and clear the line. Idempotent; safe after a newer spinner replaced this one. */
  stop(): void;
}

/**
 * Start an animated spinner on stderr and return a handle to update/stop it.
 * A no-op handle when stderr isn't a TTY or `quiet` is set (keeping scripts, CI,
 * and tests free of escape codes). Only one spinner runs at a time — starting a
 * new one supersedes any prior; the superseded handle's `update`/`stop` become
 * inert (guarded by identity) so a late `stop()` can't wipe the newer spinner.
 */
export function createSpinner(message: string, opts: { quiet?: boolean } = {}): Spinner {
  if (opts.quiet || !process.stderr.isTTY) {
    return { update() {}, stop() {} };
  }
  if (timer) clearInterval(timer); // supersede any running spinner
  const self = { message };
  active = self;
  process.stderr.write("\x1b[?25l"); // hide cursor
  renderActive();
  timer = setInterval(renderActive, 80);
  return {
    update(next: string): void {
      if (active === self) self.message = next;
    },
    stop(): void {
      if (active !== self) return; // a newer spinner took over; leave it alone
      if (timer) clearInterval(timer);
      timer = undefined;
      active = null;
      process.stderr.write("\r\x1b[2K\x1b[?25h"); // clear line + restore cursor
    },
  };
}

/**
 * Run `fn` while a spinner ticks on stderr (convenience wrapper over
 * {@link createSpinner}); the spinner is always stopped when `fn` settles.
 * Skipped (so `fn` just runs) when stderr isn't a TTY or `quiet` is set.
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  opts: { quiet?: boolean } = {},
): Promise<T> {
  const spinner = createSpinner(message, opts);
  try {
    return await fn();
  } finally {
    spinner.stop();
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
  // Wipe any running spinner frame before each write so the log line lands on a
  // clean row; the spinner redraws below it on its next tick.
  return {
    info: quiet
      ? noop
      : (msg) => {
          clearActiveLine();
          console.log(msg);
        },
    success: quiet
      ? noop
      : (msg) => {
          clearActiveLine();
          console.log(paint("green", "✓ ") + msg);
        },
    warn(msg) {
      clearActiveLine();
      console.warn(paint("yellow", "! ") + msg);
    },
    error(msg) {
      clearActiveLine();
      console.error(paint("red", "✗ ") + msg);
    },
    debug: quiet
      ? noop
      : (msg) => {
          if (!debugEnabled) return;
          clearActiveLine();
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
