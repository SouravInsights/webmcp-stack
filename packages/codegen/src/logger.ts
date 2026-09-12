/**
 * Logging via pino, pretty-printed through one in-process stream in both
 * TTY and CI: the report is the product's output, and a human reads CI logs
 * too - piped output is the same text with the colors stripped, never JSON
 * envelopes. (If a machine-readable mode is ever needed, it is a --json
 * flag, not a silent format change on pipe.)
 *
 * pino-pretty is passed as a direct in-process stream, not a `transport`.
 * Transports run in a worker thread, which is right for servers but wrong
 * for a short-lived CLI: worker output interleaves out of order with the
 * report renderer's direct console writes, and buffered lines can flush
 * late or twice on exit. In-process keeps every line in order.
 */

import pino from "pino";
import pretty from "pino-pretty";

const logger = pino(
  {
    level: process.env.WEBMCP_LOG_LEVEL ?? (process.argv.includes("--verbose") ? "debug" : "info"),
  },
  pretty({
    colorize: process.stdout.isTTY === true,
    ignore: "pid,hostname,time,level",
    messageFormat: "{msg}",
    translateTime: false,
    hideObject: true,
    sync: true,
  }),
);

export const debug = (msg: string): void => logger.debug(msg);
export const info = (msg: string): void => logger.info(msg);
export const warn = (msg: string): void => logger.warn(msg);
export const error = (msg: string): void => logger.error(msg);
export const success = (msg: string): void => logger.info(msg);

/** Enable debug-level output (the --verbose flag). */
export function enableVerbose(): void {
  logger.level = "debug";
}
