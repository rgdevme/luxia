import colors from "yoctocolors-cjs";
import type { DomainColor, Logger, LogInput, LogParts, LogTask } from "./types/public.js";

/** Dim/grey secondary text (e.g. an inline description). No-op off a TTY. */
export function dim(msg: string): string {
  return colors.dim(msg);
}

/** Width of the padded `[domain]` prefix field (longest builtin fits: `[agents]`). */
const DOMAIN_FIELD = 9;

type LogLevel = "info" | "success" | "warn" | "error" | "debug";

// The level determines the message color; the domain determines the (dimmed)
// prefix color. See the standardized shape: `[domain] message [status]`.
const LEVEL_COLOR: Record<LogLevel, (s: string) => string> = {
  info: colors.white,
  success: colors.green,
  warn: colors.yellow,
  error: colors.red,
  debug: colors.blue,
};

const DOMAIN_PAINT: Record<DomainColor, (s: string) => string> = {
  cyan: colors.cyan,
  magenta: colors.magenta,
  green: colors.green,
  blue: colors.blue,
  yellow: colors.yellow,
  gray: colors.gray,
  white: colors.white,
  red: colors.red,
};

function toParts(input: LogInput): LogParts {
  return typeof input === "string" ? { message: input } : input;
}

/** The dimmed, domain-colored `[domain]` prefix, padded to a fixed field width. */
function formatPrefix(domain?: string, color?: DomainColor): string {
  const label = `[${domain ?? "agnos"}]`.padEnd(DOMAIN_FIELD);
  return colors.dim(DOMAIN_PAINT[color ?? "gray"](label));
}

/**
 * The reusable log-line component. Renders one standardized line
 * `[domain] message [status]` (plus any `extra` detail lines) with domain- and
 * level-based coloring. Pure — returns the string to print.
 */
export function formatLog(
  level: LogLevel,
  input: LogInput,
  opts: { domain?: string; color?: DomainColor } = {},
): string {
  const { message, status, extra } = toParts(input);
  let line = `${formatPrefix(opts.domain, opts.color)} ${LEVEL_COLOR[level](message)}`;
  if (status) line += ` ${colors.dim(colors.italic(status))}`;
  const detail = extra === undefined ? [] : Array.isArray(extra) ? extra : [extra];
  for (const d of detail) line += `\n${colors.white(d)}`;
  return line;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// At most one spinner animates at a time. `active` holds the pre-rendered prefix
// and level-colored message so each frame only swaps the glyph; the logger wipes
// this line before printing so log output never lands mid-frame.
let active: { color: DomainColor; prefix: string; message: string } | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let frame = 0;

function renderActive(): void {
  if (!active) return;
  const glyph = SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]!;
  process.stderr.write(`\r${active.prefix} ${DOMAIN_PAINT[active.color](glyph)} ${active.message}`);
}

/**
 * Erase the current spinner frame from the stderr line so the next write starts
 * clean. No-op when no spinner is running (which includes every non-TTY run, so
 * scripts/tests are unaffected). The spinner redraws itself on its next tick.
 */
function clearActiveLine(): void {
  if (active) process.stderr.write("\r\x1b[2K");
}

interface SpinnerHandle {
  stop(): void;
}

/**
 * Start an animated spinner on stderr for a pending `waitFor`, rendered in the
 * standardized shape (domain prefix + domain-colored glyph + level-colored
 * message). A no-op when `quiet` or stderr isn't a TTY (keeping scripts, CI, and
 * tests free of escape codes). Only one spinner runs at a time — a new one
 * supersedes any prior; a superseded handle's `stop` is inert (guarded by
 * identity) so a late stop can't wipe the newer spinner.
 */
function startSpinner(
  level: LogLevel,
  parts: LogParts,
  fmt: { domain?: string; color?: DomainColor },
  quiet: boolean,
): SpinnerHandle {
  if (quiet || !process.stderr.isTTY) return { stop() {} };
  if (timer) clearInterval(timer); // supersede any running spinner
  let message = LEVEL_COLOR[level](parts.message);
  if (parts.status) message += ` ${colors.dim(colors.italic(parts.status))}`;
  const self = { color: fmt.color ?? "gray", prefix: formatPrefix(fmt.domain, fmt.color), message };
  active = self;
  process.stderr.write("\x1b[?25l"); // hide cursor
  renderActive();
  timer = setInterval(renderActive, 80);
  return {
    stop(): void {
      if (active !== self) return; // a newer spinner took over; leave it alone
      if (timer) clearInterval(timer);
      timer = undefined;
      active = null;
      process.stderr.write("\r\x1b[2K\x1b[?25h"); // clear line + restore cursor
    },
  };
}

export interface CreateLoggerOptions {
  debug?: boolean;
  quiet?: boolean;
  /** Domain id for the `[domain]` prefix (default `agnos`). */
  domain?: string;
  /** Domain color for the prefix (default gray). */
  color?: DomainColor;
}

interface LoggerState {
  debugEnabled: boolean;
  quiet: boolean;
  domain?: string;
  color?: DomainColor;
}

// Records the config each createLogger/withDomain output was built from, so
// withDomain can re-derive a sibling logger that shares quiet/debug but carries
// a different domain prefix.
const LOGGER_STATE = new WeakMap<Logger, LoggerState>();

function makeLogger(state: LoggerState): Logger {
  const fmt = { domain: state.domain, color: state.color };

  // Whether a level's persistent output is suppressed: quiet drops
  // info/success/debug; debug additionally needs the debug flag. warn/error
  // always print. (The awaited work in a `waitFor` runs regardless.)
  const suppressed = (level: LogLevel): boolean => {
    if (level === "debug") return state.quiet || !state.debugEnabled;
    if (level === "info" || level === "success") return state.quiet;
    return false;
  };

  // Wipe any running spinner frame before each write so the log line lands on a
  // clean row; the spinner redraws below it on its next tick.
  const emit = (level: LogLevel, msg: LogInput): void => {
    if (suppressed(level)) return;
    clearActiveLine();
    const line = formatLog(level, msg, fmt);
    if (level === "warn") console.warn(line);
    else if (level === "error" || level === "debug") console.error(line);
    else console.log(line);
  };

  // `waitFor` path: spin (unless suppressed / non-TTY) until the promise settles,
  // then stop; on success optionally print `done`, and always return the value.
  const spin = async <T>(level: LogLevel, task: LogTask<T>): Promise<T> => {
    const handle = startSpinner(level, task, fmt, suppressed(level));
    try {
      const value = await task.waitFor;
      handle.stop();
      if (task.done !== undefined) {
        emit(level, typeof task.done === "function" ? task.done(value) : task.done);
      }
      return value;
    } catch (err) {
      handle.stop();
      throw err;
    }
  };

  // A single implementation backs both overloads: a `waitFor` payload takes the
  // spinner path (returns a promise), everything else prints synchronously.
  const make =
    (level: LogLevel) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: any): any => {
      if (msg !== null && typeof msg === "object" && "waitFor" in msg) return spin(level, msg);
      emit(level, msg);
    };

  const logger = {
    info: make("info"),
    success: make("success"),
    warn: make("warn"),
    error: make("error"),
    debug: make("debug"),
  } as Logger;
  LOGGER_STATE.set(logger, state);
  return logger;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  return makeLogger({
    debugEnabled: opts.debug ?? process.env["AGNOS_DEBUG"] === "1",
    quiet: opts.quiet ?? false,
    domain: opts.domain,
    color: opts.color,
  });
}

/**
 * Re-bind a logger to a domain so its lines (and spinners) carry that domain's
 * `[domain]` prefix and color, sharing the base's quiet/debug wiring. Used by
 * the run pipeline to scope `ctx.logger` per domain without threading a domain
 * argument through every call. A logger not produced by {@link createLogger}
 * (e.g. a test stub) is returned unchanged.
 */
export function withDomain(base: Logger, domain: { id: string; color?: DomainColor }): Logger {
  const state = LOGGER_STATE.get(base);
  if (!state) return base;
  return makeLogger({ ...state, domain: domain.id, color: domain.color });
}

/**
 * Wrap a logger to prepend `indent` to every message. Used by the orchestrator
 * to keep nested hook output visually aligned (e.g., 4-space indent inside an
 * agent's per-domain handler). Passes `waitFor`/`done` through unchanged.
 */
export function indentedLogger(base: Logger, indent: string): Logger {
  if (!indent) return base;
  const pad = (msg: string | LogParts | LogTask<unknown>): string | LogParts | LogTask<unknown> =>
    typeof msg === "string" ? `${indent}${msg}` : { ...msg, message: `${indent}${msg.message}` };
  const wrap =
    (fn: Logger[keyof Logger]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (msg: any): any =>
      (fn as (m: unknown) => unknown)(pad(msg));
  return {
    info: wrap(base.info),
    success: wrap(base.success),
    warn: wrap(base.warn),
    error: wrap(base.error),
    debug: wrap(base.debug),
  } as Logger;
}
