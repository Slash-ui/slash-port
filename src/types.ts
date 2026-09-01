/** Transport protocol of a listening socket. */
export type Protocol = 'tcp' | 'udp';

/** IP family. Kept numeric so it sorts and formats without a lookup. */
export type Family = 4 | 6;

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
  /** Plain description of what is holding the port. */
  label: string;
  /** Extra distinguishing detail, usually the project directory. */
  hint: string | null;
  /**
   * Non-null when killing this is refused outright. The string is the reason,
   * phrased for display.
   */
  guard: string | null;
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
