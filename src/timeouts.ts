/**
 * How long the surface waits on a read: a field of the render policy (`timeouts`), read at use
 * time (law 1), and read and merged as every bounded group is (src/bounded-group.ts). The
 * numbers below are the bootstrap defaults.
 *
 * Every wait is bounded, and none may outlast the server's own idle timeout: a handler that
 * outlives its connection reaches its caller as an empty reply, never as its honest error.
 * So the ceiling is derived from that timeout, and a missing or junk value reads as its
 * default, never as "no limit".
 *
 * The ceiling bounds one wait, not a sum: it holds because no request handler awaits two of
 * these in sequence (the gap-status refresh runs off the request path). A handler that chains
 * two must budget them together under the idle timeout.
 *
 * Kept out: the identity check's wait, with the other auth limits (a named law-1 debt: an
 * owner-role row, never the sentence parser's reach).
 */
import { boundedGroup } from "./bounded-group.ts";
import { SERVER_IDLE_TIMEOUT_S } from "./config.ts";

export const DEFAULT_TIMEOUTS = {
  /** A read or write through discovery `/resolve`, unless its caller names a shorter one. */
  resolveMs: 10_000,
  /** A registry's shape vocabulary. */
  shapesMs: 10_000,
  /** The interface issues list. */
  issuesMs: 8_000,
  /** One gap's status, read in the background for the questions list. */
  gapStatusMs: 4_000,
} as const;

export type TimeoutKey = keyof typeof DEFAULT_TIMEOUTS;
export type Timeouts = Readonly<Record<TimeoutKey, number>>;

/** Under the idle timeout by construction, as the event stream's keepalive is. */
const CEILING_MS = (SERVER_IDLE_TIMEOUT_S * 1000 * 5) / 6;

/**
 * The guard. Debts, as for recheck and limits: the floor is the guard's own number; how long a
 * producer takes is its own to advertise, read through discovery; no activity writes timeouts.
 */
export const TIMEOUT_RANGES: Readonly<Record<TimeoutKey, readonly [number, number]>> = {
  resolveMs: [500, CEILING_MS],
  shapesMs: [500, CEILING_MS],
  issuesMs: [500, CEILING_MS],
  gapStatusMs: [500, CEILING_MS],
};

export const TIMEOUTS = boundedGroup<TimeoutKey>("timeouts", DEFAULT_TIMEOUTS, TIMEOUT_RANGES);
