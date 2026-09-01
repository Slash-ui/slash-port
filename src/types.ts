/** Transport protocol of a listening socket. */
export type Protocol = 'tcp' | 'udp';

/** IP family. Kept numeric so it sorts and formats without a lookup. */
export type Family = 4 | 6;

/**
 * How much explanation the interface offers. Beginner is the default because
 * the person who does not know what is on port 3000 is the person who reached
 * for this tool; someone who already knows can ask for less.
 */
export type Mode = 'beginner' | 'advanced';

/**
 * What kind of thing is holding the port. Coarse on purpose: the point is to
 * answer "can I close this" in one word, not to classify software.
 */
export type Category =
  /** Applications or Sites that you need a browser to view. */
  | 'web'
  /** Postgres, MySQL, Mongo, Redis - state you can lose. */
  | 'database'
  /** A published container port, or the engine that publishes it. */
  | 'container'
  /** Brokers and queues. */
  | 'messaging'
  /** Test runners, bundlers, debuggers, package registries. */
  | 'tooling'
  /** Local model servers. */
  | 'ai'
  /** Operating-system services. */
  | 'system'
  /** SSH, VNC, tunnels - the ways in from elsewhere. */
  | 'remote'
  /** A desktop application that happens to listen. */
  | 'desktop'
  /** A bare runtime that could not be pinned to a framework. */
  | 'runtime'
  /** Nothing could be worked out. */
  | 'unknown';

/**
 * The answer to "can I close this", decided before a confirmation is offered
 * rather than after. Ordered from least to most alarming, which is also the
 * order the UI colours them in.
 */
export type Risk =
  /** Yours, reproducible, and it will come back when you start it again. */
  | 'safe'
  /** Yours, but closing it can lose work or interrupt something. */
  | 'caution'
  /** Part of the system or someone's session. Closing it breaks things. */
  | 'risky'
  /** Refused outright: a guardrail covers it. */
  | 'protected'
  /** Not yours to signal without elevating first. */
  | 'blocked';

/** Where a description came from, so the UI can say how sure it is. */
export type DescriptionSource =
  /** A framework or daemon matched in the command line. */
  | 'signature'
  /** The IANA-ish registry of ports a developer actually meets. */
  | 'registry'
  /** The application bundle or install directory the binary lives in. */
  | 'application'
  /** The local Docker engine, asked which container publishes the port. */
  | 'docker'
  /** Only the shape of the path - "a system service", "a desktop app". */
  | 'location'
  /** Nothing matched. */
  | 'none';

/**
 * One listening socket exactly as a platform scanner found it. Several of
 * these usually describe the same server: a process bound to `::` and to
 * `0.0.0.0` produces two rows for one port.
 */
export interface RawSocket {
  protocol: Protocol;
  family: Family;
  /** Bind address, already formatted for humans (`*`, `127.0.0.1`, `::1`). */
  address: string;
  port: number;
  /**
   * `null` when the scanner could see the socket but not its owner, which
   * happens for other users' processes without elevated privileges.
   */
  pid: number | null;
  /** Short process name, e.g. `node`. */
  processName: string | null;
  /** Full command line when the platform can supply one, else `null`. */
  command: string | null;
  /** Owning user name, or the numeric uid when no name could be resolved. */
  user: string | null;
}

/**
 * A port after collapsing its sockets, describing, and guarding. This is what
 * the UI renders and what `--json` prints.
 */
export interface PortEntry {
  /** Stable identity for React keys and for `--port` matching. */
  id: string;
  protocol: Protocol;
  port: number;
  /** Every address this process listens on for this port, sorted. */
  addresses: string[];
  families: Family[];
  pid: number | null;
  processName: string | null;
  command: string | null;
  user: string | null;
  /**
   * What is holding the port, in words the process name does not already
   * supply. `null` when nothing could be worked out - which is information,
   * where echoing the process name back is not.
   */
  label: string | null;
  /** How `label` was arrived at. */
  source: DescriptionSource;
  category: Category;
  /** Extra distinguishing detail: the project, or the runtime underneath. */
  hint: string | null;
  /** One sentence a beginner can act on. Never repeats `label`. */
  summary: string;
  /** How to bring it back after closing it, when that is knowable. */
  restart: string | null;
  /** Where to open it, for the things that answer a browser. */
  url: string | null;
  /** Whether it is safe to close, once guards and ownership are folded in. */
  risk: Risk;
  /** Why `risk` is what it is, phrased for display. */
  riskReason: string;
  /**
   * Non-null when killing this is refused outright. The string is the reason,
   * phrased for display.
   */
  guard: string | null;
  /**
   * Non-null when a signal is expected to bounce off this process because it
   * belongs to somebody else. The string is the reason, phrased for display.
   * It is an advisory and nothing else: the kill is still attempted, and the
   * kernel still has the last word.
   */
  elevation: string | null;
}

export interface ScanOptions {
  /** Include UDP sockets. Off by default: UDP is noisy and rarely the answer. */
  udp?: boolean;
}

/** A scan failure the user can act on, as opposed to a crash. */
export class ScanError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'ScanError';
    this.hint = hint;
  }
}
