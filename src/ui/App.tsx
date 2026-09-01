import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  elevationRemedy,
  formatAddresses,
  formatDescription,
  formatPid,
  formatPort,
  formatProcess,
  formatUser,
  matchesFilter,
} from '../format.js';
import { killEntry } from '../kill.js';
import { scan } from '../scan/index.js';
import type { KillOptions, KillResult } from '../kill.js';
import type { PortEntry, ScanOptions } from '../types.js';
import { cell, color, layout, truncate } from './theme.js';

/** Header, column titles, filter line, status line, and the two help lines. */
const CHROME_ROWS = 7;

export interface AppProps {
  /** Skips the scan on mount. Used by tests and by `--port` pre-seeding. */
  initialEntries?: readonly PortEntry[];
  initialFilter?: string;
  udp?: boolean;
  scanner?: (options: ScanOptions) => Promise<PortEntry[]>;
  killer?: (entry: PortEntry, options?: KillOptions) => Promise<KillResult>;
}

type StatusKind = 'info' | 'ok' | 'warn' | 'error';

interface Status {
  kind: StatusKind;
  text: string;
}

function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  // A stdout that reports zero columns is one that does not know its own
  // size, not a terminal zero characters wide.
  const read = useCallback(
    () => ({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 }),
    [stdout],
  );
  const [size, setSize] = useState(read);

  useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') return;
    const onResize = (): void => setSize(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off?.('resize', onResize);
    };
  }, [stdout, read]);

  return size;
}

const STATUS_COLOR: Record<StatusKind, Parameters<typeof color>[0]> = {
  info: 'muted',
  ok: 'ok',
  warn: 'warn',
  error: 'danger',
};

function statusFor(result: KillResult): Status {
  switch (result.status) {
    case 'terminated':
      return { kind: 'ok', text: result.message };
    case 'gone':
      return { kind: 'info', text: result.message };
    case 'failed':
      return { kind: 'error', text: result.message };
    default:
      return { kind: 'warn', text: result.message };
  }
}

export function App({
  initialEntries,
  initialFilter = '',
  udp: initialUdp = false,
  scanner = scan,
  killer = killEntry,
}: AppProps): ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [entries, setEntries] = useState<readonly PortEntry[]>(initialEntries ?? []);
  const [loading, setLoading] = useState(initialEntries === undefined);
  const [udp, setUdp] = useState(initialUdp);
  const [filter, setFilter] = useState(initialFilter);
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<PortEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const refresh = useCallback(
    async (options: ScanOptions) => {
      setLoading(true);
      try {
        setEntries(await scanner(options));
      } catch (error) {
        setStatus({ kind: 'error', text: (error as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [scanner],
  );

  useEffect(() => {
    if (initialEntries !== undefined) return;
    void refresh({ udp });
    // Re-scanning is driven by `r` and `u`; this effect only covers the first load.
  }, []);

  const visible = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );

  const viewport = Math.max(3, rows - CHROME_ROWS);

  // The list can shrink underneath the cursor - a filter keystroke, or a
  // rescan after a kill - so the selection is clamped rather than left dangling.
  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    setOffset((current) => {
      if (selected < current) return selected;
      if (selected >= current + viewport) return selected - viewport + 1;
      return Math.min(current, Math.max(0, visible.length - viewport));
    });
  }, [selected, viewport, visible.length]);

  const current = visible[selected];

  const performKill = useCallback(
    async (entry: PortEntry, signal: 'SIGTERM' | 'SIGKILL') => {
      setDialog(null);
      setBusy(true);
      try {
        setStatus(statusFor(await killer(entry, { signal })));
      } catch (error) {
        setStatus({ kind: 'error', text: (error as Error).message });
      } finally {
        setBusy(false);
      }
      await refresh({ udp });
    },
    [killer, refresh, udp],
  );

  useInput((input, key) => {
    if (busy) return;

    if (dialog) {
      if (input === 'y') void performKill(dialog, 'SIGTERM');
      else if (input === 'f') void performKill(dialog, 'SIGKILL');
      else if (input === 'n' || key.escape) {
        setDialog(null);
        setStatus({ kind: 'info', text: 'Cancelled. Nothing was signalled.' });
      }
      return;
    }

    if (filtering) {
      if (key.escape) {
        setFiltering(false);
        setFilter('');
      } else if (key.return) {
        setFiltering(false);
      } else if (key.backspace || key.delete) {
        setFilter((value) => value.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setFilter((value) => value + input);
      }
      return;
    }

    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    if (key.upArrow || input === 'k') setSelected((value) => Math.max(0, value - 1));
    else if (key.downArrow || input === 'j') setSelected((value) => Math.min(visible.length - 1, value + 1));
    else if (key.pageUp) setSelected((value) => Math.max(0, value - viewport));
    else if (key.pageDown) setSelected((value) => Math.min(visible.length - 1, value + viewport));
    else if (input === 'g') setSelected(0);
    else if (input === 'G') setSelected(Math.max(0, visible.length - 1));
    else if (input === '/') {
      setFiltering(true);
      setStatus(null);
    } else if (input === 'r') void refresh({ udp });
    else if (input === 'u') {
      const next = !udp;
      setUdp(next);
      setStatus({ kind: 'info', text: next ? 'Showing UDP as well as TCP.' : 'Showing TCP only.' });
      void refresh({ udp: next });
    } else if (input === 'x' || key.return) {
      if (!current) return;
      // Protected rows are refused here, before any dialog: there is no
      // confirmation that lets you kill your own shell.
      if (current.guard) {
        setStatus({ kind: 'warn', text: `Refusing to kill ${current.guard}.` });
        return;
      }
      setStatus(null);
      setDialog(current);
    }
  });

  const columnLayout = layout(columns);
  const window = visible.slice(offset, offset + viewport);

  // A zero-width column is one the terminal is too narrow for, and is dropped
  // entirely rather than rendered as an empty gap.
  const columnise = (values: { port: string; pid: string; user: string; process: string; address: string }): string =>
    [
      cell(values.port, columnLayout.port),
      columnLayout.pid && cell(values.pid, columnLayout.pid),
      columnLayout.user && cell(values.user, columnLayout.user),
      columnLayout.process && cell(values.process, columnLayout.process),
      columnLayout.address && cell(values.address, columnLayout.address),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');

  const header = columnise({
    port: 'PORT',
    pid: 'PID',
    user: 'USER',
    process: 'PROCESS',
    address: 'ADDRESS',
  });

  return (
    <Box flexDirection="column" width={columnLayout.total}>
      <Box justifyContent="space-between">
        <Text color={color('heading')} bold>
          slash-port
        </Text>
        <Text color={color('muted')}>
          {loading
            ? 'scanning…'
            : `${visible.length}/${entries.length} ${udp ? 'tcp+udp' : 'tcp'}`}
        </Text>
      </Box>

      <Box>
        <Text color={color('muted')}>{header} </Text>
        <Text color={color('muted')}>{cell('DESCRIPTION', columnLayout.description)}</Text>
      </Box>

      {window.map((entry, index) => {
        const isSelected = offset + index === selected;
        // Muted means "you can look at this but not touch it": either the
        // owner is somebody else, or there is no owner to signal at all.
        const rowColor = entry.guard
          ? color('warn')
          : entry.elevation || entry.pid === null
            ? color('muted')
            : undefined;
        const left = columnise({
          port: formatPort(entry),
          pid: formatPid(entry),
          user: formatUser(entry),
          process: formatProcess(entry),
          address: formatAddresses(entry),
        });

        return (
          <Box key={entry.id}>
            <Text inverse={isSelected} color={rowColor}>
              {left}{' '}
            </Text>
            <Text inverse={isSelected} color={rowColor ?? color('accent')}>
              {cell(formatDescription(entry), columnLayout.description)}
            </Text>
          </Box>
        );
      })}

      {!loading && entries.length === 0 && (
        <Text color={color('muted')}>
          Nothing is listening{udp ? '' : ' on TCP'}. Press u to include UDP, r to rescan.
        </Text>
      )}

      {!loading && entries.length > 0 && visible.length === 0 && (
        <Text color={color('muted')}>No port matches “{filter}”. Press Esc to clear the filter.</Text>
      )}

      {dialog && <ConfirmDialog entry={dialog} width={columnLayout.total} />}

      {filtering && (
        <Text>
          <Text color={color('heading')}>filter </Text>
          <Text>{filter}</Text>
          <Text color={color('muted')}>▎</Text>
        </Text>
      )}

      {!filtering && filter !== '' && (
        <Text color={color('muted')}>filter: {truncate(filter, Math.max(8, columnLayout.total - 10))}</Text>
      )}

      {status && (
        <Text color={color(STATUS_COLOR[status.kind])}>
          {truncate(status.text, columnLayout.total)}
        </Text>
      )}

      {!dialog && (
        <Text color={color('muted')}>
          {truncate(
            '↑↓/jk move · PgUp/PgDn/g/G jump · / filter · x kill · r rescan · u udp · q quit',
            columnLayout.total,
          )}
        </Text>
      )}
    </Box>
  );
}

function ConfirmDialog({ entry, width }: { entry: PortEntry; width: number }): ReactElement {
  const inner = Math.max(20, width - 4);
  const owner = [
    entry.processName ?? 'unknown process',
    `pid ${entry.pid ?? 'unknown'}`,
    entry.user ? `user ${entry.user}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color('warn')} paddingX={1}>
      <Text color={color('warn')} bold>
        {truncate(`Kill whatever holds port ${entry.port}/${entry.protocol}?`, inner)}
      </Text>
      <Text>{truncate(formatDescription(entry), inner)}</Text>
      <Text color={color('muted')}>{truncate(owner, inner)}</Text>
      {entry.elevation && (
        <Text color={color('warn')}>
          {truncate(`Without ${elevationRemedy()} this will be refused: ${entry.elevation}.`, inner)}
        </Text>
      )}
      <Text> </Text>
      <Text>
        <Text color={color('ok')}>y</Text> terminate (SIGTERM) ·{' '}
        <Text color={color('danger')}>f</Text> force (SIGKILL) · <Text color={color('heading')}>n</Text> cancel
      </Text>
    </Box>
  );
}
