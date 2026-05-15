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

export function createLogger(opts: { debug?: boolean } = {}): Logger {
  const debugEnabled = opts.debug ?? process.env["AGNOS_DEBUG"] === "1";
  return {
    info(msg) {
      console.log(msg);
    },
    success(msg) {
      console.log(paint("green", "✓ ") + msg);
    },
    warn(msg) {
      console.warn(paint("yellow", "! ") + msg);
    },
    error(msg) {
      console.error(paint("red", "✗ ") + msg);
    },
    debug(msg) {
      if (!debugEnabled) return;
      console.error(paint("gray", "· " + msg));
    },
  };
}
