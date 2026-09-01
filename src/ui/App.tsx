import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { elevationRemedy } from '../describe.js';
import { advancedFields, beginnerBrief, riskSentence, riskWord } from '../explain.js';
import {
  ABSENT,
  formatAddresses,
  formatDescription,
  formatPid,
  formatPort,
  formatProcess,
  formatUser,
  matchesFilter,
} from '../format.js';
import { inspectProcess } from '../inspect.js';
import { killEntry } from '../kill.js';
import { scan } from '../scan/index.js';
import type { Field } from '../explain.js';
import type { ProcessDetail } from '../inspect.js';
import type { KillOptions, KillResult } from '../kill.js';
import type { Mode, PortEntry, Risk, ScanOptions } from '../types.js';
import { cell, color, displayWidth, layout, truncate } from './theme.js';

/**
 * Every row the interface spends on something other than the list, and what it
 * spends them on. These have to be exact rather than generous: the viewport is
 * whatever is left over, and a render one row taller than the terminal scrolls
 * the screen and repaints a frame nobody can read.
 */
const PANEL_ROWS = { beginner: 9, advanced: 11 } as const;
/** How many lines each panel gets before it starts leaving things out. */
const PANEL_FIELDS = { beginner: 5, advanced: 9 } as const;
/** The confirmation at its tallest, and after it drops its optional lines. */
const DIALOG_ROWS = { beginner: 10, advanced: 8 } as const;
const DIALOG_ROWS_COMPACT = { beginner: 7, advanced: 6 } as const;
/** Below this height the confirmation shows the decision and nothing else. */
const COMPACT_ROWS = 20;
/** Fewer rows than this is not a list, so the panel gives way to it. */
const MIN_LIST_ROWS = 3;
/** How long the cursor has to sit still before advanced mode looks a row up. */
const INSPECT_DELAY_MS = 120;

export interface AppProps {
  /** Skips the scan on mount. Used by tests and by `--port` pre-seeding. */
  initialEntries?: readonly PortEntry[];
  initialFilter?: string;
  udp?: boolean;
  docker?: boolean;
  mode?: Mode;
  scanner?: (options: ScanOptions) => Promise<PortEntry[]>;
  killer?: (entry: PortEntry, options?: KillOptions) => Promise<KillResult>;
  inspector?: (entry: PortEntry) => Promise<ProcessDetail>;
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

/** Colour is never the only signal - the word in the column says it too. */
const RISK_COLOR: Record<Risk, Parameters<typeof color>[0]> = {
  safe: 'ok',
  caution: 'warn',
  risky: 'danger',
  protected: 'danger',
  blocked: 'muted',
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
  docker = true,
  mode: initialMode = 'beginner',
  scanner = scan,
  killer = killEntry,
  inspector = inspectProcess,
}: AppProps): ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [entries, setEntries] = useState<readonly PortEntry[]>(initialEntries ?? []);
  const [loading, setLoading] = useState(initialEntries === undefined);
  const [udp, setUdp] = useState(initialUdp);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [panel, setPanel] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<PortEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);

  // `r` and `u` can both be pressed faster than a scan completes, and a scan
  // that started earlier may finish later. Only the newest one is allowed to
  // land, or the header says tcp+udp over a list that is TCP only.
  const scanId = useRef(0);
  const refresh = useCallback(
    async (options: ScanOptions) => {
      const id = (scanId.current += 1);
      setLoading(true);
      try {
        const result = await scanner({ ...options, docker });
        if (scanId.current === id) setEntries(result);
      } catch (error) {
        if (scanId.current === id) setStatus({ kind: 'error', text: (error as Error).message });
      } finally {
        if (scanId.current === id) setLoading(false);
      }
    },
    [scanner, docker],
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

  const compact = rows < COMPACT_ROWS;
  const dialogRows = dialog ? (compact ? DIALOG_ROWS_COMPACT : DIALOG_ROWS)[mode] : 0;

  // Counted rather than estimated, and counted from what is about to be
  // rendered: the title and the column headings always, one of the two
  // mutually exclusive filter lines, the status when there is one, and the
  // help line except while the confirmation has replaced it.
  const fullChrome =
    2 + (filtering || filter !== '' ? 1 : 0) + (status ? 1 : 0) + (dialog ? 0 : 1);

  // A confirmation is a question, and a question has to be readable to be
  // answerable. On a terminal too short to hold it and the furniture around
  // it, the furniture goes: headings, filter line, status, all of it, leaving
  // the title and the decision.
  const cramped = dialog !== null && rows - fullChrome - dialogRows < 0;
  const chromeRows = cramped ? 1 : fullChrome;
  // The panel stands down when paying for it would leave nothing worth calling
  // a list - which depends on the mode, because the two panels are not the
  // same height, and on the confirmation, which replaces it outright.
  const showPanel = panel && !dialog && rows - chromeRows - PANEL_ROWS[mode] >= MIN_LIST_ROWS;
  const reserved = dialog ? dialogRows : showPanel ? PANEL_ROWS[mode] : 0;
  const viewport = Math.max(dialog ? 0 : 1, rows - chromeRows - reserved);

  // The list can shrink underneath the cursor - a filter keystroke, or a
  // rescan after a kill - so the selection is clamped rather than left dangling.
  const clamp = useCallback(
    (index: number) => Math.max(0, Math.min(index, visible.length - 1)),
    [visible.length],
  );

  useEffect(() => {
    setSelected((current) => Math.max(0, Math.min(current, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    setOffset((current) => {
      if (selected < current) return selected;
      if (selected >= current + viewport) return selected - viewport + 1;
      return Math.min(current, Math.max(0, visible.length - viewport));
    });
  }, [selected, viewport, visible.length]);

  const current = visible[selected];

  // Advanced mode's extra facts cost up to three subprocesses each, so they are
  // fetched for the row under the cursor and nowhere else, and only once the
  // cursor has stopped moving - holding `j` down a long list would otherwise
  // spawn one batch per keystroke, none of them cancellable. A reply that
  // arrives after the cursor has moved on is dropped rather than shown against
  // the wrong row.
  const wanted = useRef<string | null>(null);
  useEffect(() => {
    const key = current?.id ?? null;
    wanted.current = key;
    setDetail(null);
    if (!current || mode !== 'advanced' || !showPanel) return;

    const timer = setTimeout(() => {
      inspector(current).then(
        (result) => {
          if (wanted.current === key) setDetail(result);
        },
        // A lookup is a nicety. An unhandled rejection would end the process.
        () => {},
      );
    }, INSPECT_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [current?.id, mode, showPanel, inspector]);

  const performKill = useCallback(
    async (entry: PortEntry, signal: 'SIGTERM' | 'SIGKILL') => {
      setDialog(null);
      setBusy(true);
      try {
        setStatus(statusFor(await killer(entry, { signal })));
        // The rescan is inside the busy window on purpose: until it lands, the
        // rows on screen describe a machine that no longer exists, and a pid
        // in one of them may already belong to something else.
        await refresh({ udp });
      } catch (error) {
        setStatus({ kind: 'error', text: (error as Error).message });
      } finally {
        setBusy(false);
      }
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

    if (key.upArrow || input === 'k') setSelected((value) => clamp(value - 1));
    else if (key.downArrow || input === 'j') setSelected((value) => clamp(value + 1));
    else if (key.pageUp) setSelected((value) => clamp(value - viewport));
    else if (key.pageDown) setSelected((value) => clamp(value + viewport));
    else if (input === 'g') setSelected(0);
    else if (input === 'G') setSelected(clamp(visible.length - 1));
    else if (input === '/') {
      setFiltering(true);
      setStatus(null);
    } else if (input === 'r') void refresh({ udp });
    else if (input === 'm') {
      const next: Mode = mode === 'beginner' ? 'advanced' : 'beginner';
      setMode(next);
      setStatus({
        kind: 'info',
        text:
          next === 'advanced'
            ? 'Advanced mode. Set SLASH_PORT_MODE=advanced to start here.'
            : 'Beginner mode, which explains what each port is.',
      });
    } else if (input === 'd') {
      const next = !panel;
      setPanel(next);
      setStatus({
        kind: 'info',
        text: !next
          ? 'Detail panel hidden. Press d to bring it back.'
          : rows - chromeRows - PANEL_ROWS[mode] >= MIN_LIST_ROWS
            ? 'Detail panel shown.'
            : 'Detail panel shown, but this terminal is too short to fit it.',
      });
    }
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

  const window = visible.slice(offset, offset + viewport);

  // A column of dashes is worse than no column: it spends width saying nothing
  // and pushes the description into an ellipsis to do it. The decision is made
  // across the whole filtered list rather than the rows on screen, so scrolling
  // past a row with a URL does not reflow every column under the cursor.
  const anyUrl = visible.some((entry) => entry.url !== null);
  const full = layout(columns, mode);
  const columnLayout = anyUrl
    ? full
    : { ...full, url: 0, description: full.description + (full.url ? full.url + 1 : 0) };

  // A zero-width column is one the terminal is too narrow for, and is dropped
  // entirely rather than rendered as an empty gap.
  const columnise = (values: {
    port: string;
    pid: string;
    user: string;
    process: string;
    address: string;
  }): string =>
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

  const beginner = mode === 'beginner';

  // With the viewport as small as three rows, "8/40" does not say whether
  // there is anything above or below what is on screen. When the window covers
  // everything, the range would only be the count written twice.
  const position =
    window.length > 0 && window.length < visible.length
      ? `${offset + 1}-${offset + window.length}/${visible.length}`
      : `${visible.length}/${entries.length}`;

  return (
    <Box flexDirection="column" width={columnLayout.total}>
      <Box justifyContent="space-between">
        <Text color={color('heading')} bold>
          slash-port
        </Text>
        <Text color={color('muted')}>
          {loading
            ? 'scanning…'
            : `${position} ${udp ? 'tcp+udp' : 'tcp'} · ${mode}`}
        </Text>
      </Box>

      {!cramped && (
      <Box>
        <Text color={color('muted')}>{header} </Text>
        <Text color={color('muted')}>
          {cell(beginner ? 'WHAT IT IS' : 'DESCRIPTION', columnLayout.description)}
        </Text>
        {columnLayout.url > 0 && (
          <Text color={color('muted')}> {cell('OPEN AT', columnLayout.url)}</Text>
        )}
        {columnLayout.risk > 0 && (
          <Text color={color('muted')}> {cell('CLOSE IT?', columnLayout.risk)}</Text>
        )}
      </Box>
      )}

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
            {columnLayout.url > 0 && (
              <Text inverse={isSelected} color={rowColor ?? color('heading')}>
                {' '}
                {cell(entry.url ?? ABSENT, columnLayout.url)}
              </Text>
            )}
            {columnLayout.risk > 0 && (
              <Text inverse={isSelected} color={color(RISK_COLOR[entry.risk])}>
                {' '}
                {cell(riskWord(entry.risk), columnLayout.risk)}
              </Text>
            )}
          </Box>
        );
      })}

      {!loading && entries.length === 0 && (
        <Text color={color('muted')}>
          {truncate(
            `Nothing is listening${udp ? '' : ' on TCP'}. Press u to include UDP, r to rescan.`,
            columnLayout.total,
          )}
        </Text>
      )}

      {!loading && entries.length > 0 && visible.length === 0 && (
        <Text color={color('muted')}>
          {truncate(
            `No port matches “${filter}”. Press Esc to clear the filter.`,
            columnLayout.total,
          )}
        </Text>
      )}

      {showPanel && current && !dialog && (
        <DetailPanel
          entry={current}
          mode={mode}
          detail={detail}
          docker={docker}
          width={columnLayout.total}
        />
      )}

      {dialog && (
        <ConfirmDialog entry={dialog} mode={mode} compact={compact} width={columnLayout.total} />
      )}

      {!cramped && filtering && (
        <Text>
          <Text color={color('heading')}>filter </Text>
          {/* Bounded while it is being typed, not only once it has settled: an
              unbounded line wraps, and a wrapped line is a row the height
              arithmetic above did not know it was paying for. */}
          <Text>{truncate(filter, Math.max(8, columnLayout.total - 8))}</Text>
          <Text color={color('muted')}>▎</Text>
        </Text>
      )}

      {!cramped && !filtering && filter !== '' && (
        <Text color={color('muted')}>filter: {truncate(filter, Math.max(8, columnLayout.total - 10))}</Text>
      )}

      {!cramped && status && (
        <Text color={color(STATUS_COLOR[status.kind])}>
          {truncate(status.text, columnLayout.total)}
        </Text>
      )}

      {!dialog && <HelpLine mode={mode} width={columnLayout.total} />}
    </Box>
  );
}

/**
 * The keys, kept apart from what they do so the key can be given a colour of
 * its own. In one colour the line reads as a sentence and the reader has to
 * pick the keys back out of it, which is the opposite of what a help line is
 * for.
 */
const HELP: Readonly<Record<Mode, readonly (readonly [string, string])[]>> = {
  beginner: [
    ['↑↓', 'move'],
    ['/', 'find'],
    ['x', 'close it'],
    ['r', 'refresh'],
    ['u', 'udp'],
    ['d', 'details'],
    ['m', 'advanced'],
    ['q', 'quit'],
  ],
  advanced: [
    ['↑↓/jk', 'move'],
    ['PgUp/PgDn/g/G', 'jump'],
    ['/', 'filter'],
    ['x', 'kill'],
    ['r', 'rescan'],
    ['u', 'udp'],
    ['d', 'detail'],
    ['m', 'beginner'],
    ['q', 'quit'],
  ],
};

const HELP_SEPARATOR = ' · ';

/**
 * Measured in cells and trimmed by dropping whole hints, because half a hint
 * helps nobody and an ellipsis costs about what a key does.
 *
 * `q quit` is kept and the hints before it give way, since the one line a
 * reader goes looking for is the one that tells them how to get out - and it
 * is last, which is exactly where trimming from the end would have taken it.
 *
 * Always renders, even with nothing left to show: the row is one the height
 * arithmetic has already paid for, and giving it back would move the list.
 */
function HelpLine({ mode, width }: { mode: Mode; width: number }): ReactElement {
  const hints = HELP[mode];
  const quit = hints[hints.length - 1]!;
  const gap = displayWidth(HELP_SEPARATOR);
  const cost = ([key, label]: readonly [string, string]): number =>
    displayWidth(key) + 1 + displayWidth(label);

  const shown: (readonly [string, string])[] = [];
  let used = cost(quit);
  for (const hint of hints.slice(0, -1)) {
    if (used + gap + cost(hint) > width) break;
    shown.push(hint);
    used += gap + cost(hint);
  }
  if (used <= width) shown.push(quit);

  return (
    <Text color={color('muted')}>
      {shown.map(([key, label], index) => (
        <Text key={key}>
          {index === 0 ? '' : HELP_SEPARATOR}
          <Text color={color('heading')}>{key}</Text> {label}
        </Text>
      ))}
    </Text>
  );
}

/** A `label  value` line, with the labels aligned down the panel. */
function FieldLines({ fields, width }: { fields: Field[]; width: number }): ReactElement | null {
  if (fields.length === 0) return null;
  const labelWidth = Math.max(...fields.map((field) => field.label.length));
  return (
    <>
      {fields.map((field) => (
        <Text key={field.label}>
          <Text color={color('muted')}>{cell(field.label, labelWidth)} </Text>
          {truncate(field.value, Math.max(4, width - labelWidth - 1))}
        </Text>
      ))}
    </>
  );
}

/**
 * What the row under the cursor actually is. Beginner mode reads it as prose
 * and stops at the decision; advanced mode lists the facts that tell two
 * identical-looking processes apart. `d` hides it either way.
 */
function DetailPanel({
  entry,
  mode,
  detail,
  docker,
  width,
}: {
  entry: PortEntry;
  mode: Mode;
  detail: ProcessDetail | null;
  docker: boolean;
  width: number;
}): ReactElement {
  const inner = Math.max(20, width - 4);

  if (mode === 'advanced') {
    // Bounded so a long command line cannot push the list off the screen, and
    // trimmed from the middle: the verdict is the last line and the one line
    // that must never be the one dropped.
    const limit = PANEL_FIELDS.advanced;
    const all = advancedFields(entry, detail);
    const fields = all.length > limit ? [...all.slice(0, limit - 1), all.at(-1)!] : all;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={color('muted')} paddingX={1}>
        <FieldLines fields={fields} width={inner} />
      </Box>
    );
  }

  const brief = beginnerBrief(entry, { docker });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color('heading')} paddingX={1}>
      <Text bold color={color('accent')}>
        {truncate(`Port ${entry.port} · ${brief.headline}`, inner)}
      </Text>
      <Text color={color('muted')}>{truncate(brief.summary, inner)}</Text>
      <FieldLines fields={brief.fields.slice(0, PANEL_FIELDS.beginner)} width={inner} />
    </Box>
  );
}

function ConfirmDialog({
  entry,
  mode,
  compact,
  width,
}: {
  entry: PortEntry;
  mode: Mode;
  /** A terminal too short to hold the whole dialog gets the decision only. */
  compact: boolean;
  width: number;
}): ReactElement {
  const inner = Math.max(20, width - 4);
  const owner = [
    entry.processName ?? 'unknown process',
    `pid ${entry.pid ?? 'unknown'}`,
    entry.user ? `user ${entry.user}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const beginner = mode === 'beginner';


  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color('warn')} paddingX={1}>
      <Text color={color('warn')} bold>
        {truncate(
          beginner
            ? `Close whatever is using port ${entry.port}?`
            : `Kill whatever holds port ${entry.port}/${entry.protocol}?`,
          inner,
        )}
      </Text>
      <Text>{truncate(formatDescription(entry), inner)}</Text>
      <Text color={color('muted')}>{truncate(owner, inner)}</Text>
      {/* Beginner mode says what closing it costs and how to undo it, because
          that is the part of the decision the flags and the pid do not cover. */}
      {beginner && (
        <Text color={color(RISK_COLOR[entry.risk])}>{truncate(riskSentence(entry), inner)}</Text>
      )}
      {!compact && beginner && entry.restart && (
        <Text color={color('muted')}>{truncate(entry.restart, inner)}</Text>
      )}
      {!compact && entry.elevation && (
        <Text color={color('warn')}>
          {truncate(`Without ${elevationRemedy()} this will be refused: ${entry.elevation}.`, inner)}
        </Text>
      )}
      {!compact && <Text> </Text>}
      <Text>
        <Text color={color('ok')}>y</Text>
        {beginner ? ' close it politely · ' : ' terminate (SIGTERM) · '}
        <Text color={color('danger')}>f</Text>
        {beginner ? ' force it · ' : ' force (SIGKILL) · '}
        <Text color={color('heading')}>n</Text>
        {beginner ? ' leave it alone' : ' cancel'}
      </Text>
    </Box>
  );
}
