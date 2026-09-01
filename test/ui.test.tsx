import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { killEntry } from '../src/kill.js';
import { App } from '../src/ui/App.js';
import { cell, displayWidth, layout, truncate } from '../src/ui/theme.js';
import type { KillResult } from '../src/kill.js';
import type { PortEntry } from '../src/types.js';
import type { Instance } from 'ink';

/** A stdout that reports a width, records frames, and can be resized. */
class FakeStdout extends EventEmitter {
  frames: string[] = [];

  constructor(
    public columns = 100,
    public rows = 24,
  ) {
    super();
  }

  write = (frame: string): void => {
    this.frames.push(frame);
  };

  lastFrame(): string {
    return this.frames.at(-1) ?? '';
  }

  resize(columns: number): void {
    this.columns = columns;
    this.emit('resize');
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  data: string | null = null;

  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}

  read(): string | null {
    const { data } = this;
    this.data = null;
    return data;
  }

  /** Deliver a keystroke the way a raw-mode terminal would. */
  send(data: string): void {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  }
}

const ESCAPE = '\u001B';

const instances: Instance[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.unmount();
});

/**
 * Long enough to cover Ink's 20ms hold on a lone escape byte, which it waits
 * out to tell the Escape key from the start of an escape sequence.
 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

/** Long enough for the debounce in front of advanced mode's row lookup. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 220));

/** Strip SGR sequences so assertions are about text, not about colour. */
const strip = (value: string): string => value.replace(/\u001B\[[0-9;]*m/g, '');

interface Harness {
  stdout: FakeStdout;
  stdin: FakeStdin;
  frame: () => string;
  lines: () => string[];
  press: (input: string) => Promise<void>;
}

function renderApp(
  element: Parameters<typeof inkRender>[0],
  { columns = 100, rows = 24 }: { columns?: number; rows?: number } = {},
): Harness {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const instance = inkRender(element, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  instances.push(instance);

  const frame = (): string => strip(stdout.lastFrame());
  return {
    stdout,
    stdin,
    frame,
    lines: () =>
      frame()
        .split('\n')
        .filter((line) => line.length > 0),
    press: async (input: string) => {
      stdin.send(input);
      await tick();
    },
  };
}

function entry(overrides: Partial<PortEntry> = {}): PortEntry {
  return {
    id: `tcp:${overrides.port ?? 3000}:${overrides.pid ?? 100}`,
    protocol: 'tcp',
    port: 3000,
    addresses: ['*'],
    families: [4],
    pid: 100,
    processName: 'node',
    command: 'node server.js',
    user: 'dev',
    label: 'Node.js',
    source: 'signature',
    category: 'runtime',
    hint: null,
    summary: 'slash-port could name the runtime but not the project it belongs to.',
    restart: null,
    url: null,
    risk: 'caution',
    riskReason: 'yours, but something may be relying on it',
    guard: null,
    elevation: null,
    ...overrides,
  };
}

const sample: PortEntry[] = [
  entry({ id: 'a', port: 3000, pid: 100, label: 'Next.js', hint: 'shop' }),
  entry({ id: 'b', port: 5173, pid: 200, label: 'Vite dev server', hint: 'admin' }),
  entry({
    id: 'c',
    port: 22,
    pid: 300,
    processName: 'sshd',
    label: 'OpenSSH server',
    guard: 'the SSH daemon',
  }),
];

/** A scanner that returns the same rows, so a rescan changes nothing. */
const stable = async (): Promise<PortEntry[]> => sample;

describe('list rendering', () => {
  test('renders a row per port, with what is holding it', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('5173/tcp');
    expect(ui.frame()).toContain('Vite dev server');
    expect(ui.frame()).toContain('(admin)');
  });

  test('marks a protected row in text, not only in colour', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('[protected]');
  });

  test('windows the list to the viewport rather than rendering every row', async () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      entry({ id: `p${index}`, port: 3000 + index, pid: 1000 + index }),
    );
    const ui = renderApp(<App mode="advanced" initialEntries={many} scanner={stable} />, { rows: 24 });
    await tick();

    const rows = ui.lines().filter((line) => /^\d+\/tcp/.test(line));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(24);
  });
});

describe('rows you cannot signal', () => {
  test('a locked row is labelled as well as dimmed', async () => {
    const locked = entry({ id: 'd', port: 5432, pid: 612, user: 'postgres', label: 'PostgreSQL', elevation: 'it belongs to postgres' });
    const ui = renderApp(<App mode="advanced" initialEntries={[locked]} scanner={stable} />);
    await tick();

    // Colour is never the only signal, so the badge has to be in the text.
    expect(ui.frame()).toContain('[locked]');
  });

  test('a protected row is not also labelled locked, which would say the same thing twice', async () => {
    const both = entry({ id: 'e', port: 22, pid: 1, processName: 'sshd', label: 'OpenSSH server', guard: 'the SSH daemon', elevation: 'it belongs to root' });
    const ui = renderApp(<App mode="advanced" initialEntries={[both]} scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('[protected]');
    expect(ui.frame()).not.toContain('[locked]');
  });
});

describe('empty states', () => {
  test('says when nothing is listening at all', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={[]} scanner={async () => []} />);
    await tick();

    expect(ui.frame()).toContain('Nothing is listening');
  });

  test('says when the filter is what emptied the list', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} initialFilter="zzzz" scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('No port matches');
    expect(ui.frame()).not.toContain('Nothing is listening');
  });
});

describe('columns and truncation', () => {
  test('truncate marks a cut value as cut', () => {
    expect(truncate('vite', 10)).toBe('vite');
    expect(truncate('a-very-long-description', 10)).toBe('a-very-lo…');
    expect(truncate('anything', 1)).toBe('…');
    expect(truncate('anything', 0)).toBe('');
  });

  test('cell pads to exactly the requested width', () => {
    expect(cell('node', 8)).toBe('node    ');
    expect(cell('node-with-a-long-name', 8)).toHaveLength(8);
  });

  test('column widths add up to the terminal width, at every width', () => {
    for (const mode of ['beginner', 'advanced'] as const) {
    for (let width = 24; width <= 200; width += 1) {
      const columns = layout(width, mode);
      const shown = [
        columns.pid,
        columns.user,
        columns.process,
        columns.address,
        columns.url,
        columns.risk,
      ].filter((value) => value > 0);
      // One gap before each shown column, and one before the description.
      const gaps = shown.length + 1;
      const total =
        columns.port + shown.reduce((sum, value) => sum + value, 0) + columns.description + gaps;
      expect(total).toBe(width);
    }
    }
  });

  test('drops the least useful columns at 60 and keeps them at 200', () => {
    const narrow = layout(60, 'advanced');
    const wide = layout(200, 'advanced');

    expect(narrow.port).toBeGreaterThan(0);
    expect(narrow.description).toBeGreaterThanOrEqual(12);
    expect(narrow.user).toBe(0);
    expect(narrow.address).toBe(0);

    expect(wide.user).toBeGreaterThan(0);
    expect(wide.address).toBeGreaterThan(0);
    expect(wide.description).toBeGreaterThan(narrow.description);
  });

  test('never renders a line wider than the terminal in beginner mode either', async () => {
    const long = entry({
      id: 'long-b',
      port: 8080,
      label: 'an extremely long description of what is holding this port',
      hint: 'a-very-long-project-directory-name',
      url: 'http://localhost:8080',
      summary: 'A sentence long enough to need cutting at every width tried here.',
      restart: 'Start it again with a command long enough to overflow a narrow panel.',
    });

    for (const width of [40, 60, 80, 200]) {
      const ui = renderApp(<App initialEntries={[long]} scanner={stable} />, { columns: width });
      await tick();
      for (const line of ui.lines()) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });

  test('a short terminal gets the list rather than the panel', async () => {
    // Below sixteen rows the panel is costing more list than it is worth.
    const ui = renderApp(<App initialEntries={sample} scanner={stable} />, { rows: 12 });
    await tick();

    expect(ui.frame()).not.toContain('╭');
    expect(ui.frame()).toContain('3000/tcp');
  });

  test('the render never exceeds the terminal height, in any state', async () => {
    // Every combination that adds a row: both modes, a filter line, a status
    // line, and the confirmation - which is taller than the panel it replaces.
    // The boundaries the arithmetic turns on: too short for anything, either
    // side of each panel standing down, and comfortable.
    for (const mode of ['beginner', 'advanced'] as const) {
      for (const rows of [8, 10, 12, 15, 16, 17, 19, 20, 24, 40]) {
        const ui = renderApp(
          <App mode={mode} initialEntries={sample} initialFilter="3" scanner={stable} />,
          { rows },
        );
        await tick();
        expect(ui.lines().length, `${mode} at ${rows} rows`).toBeLessThanOrEqual(rows);

        // `u` sets a status, and `x` opens the confirmation over the top of it.
        await ui.press('u');
        await ui.press('x');
        expect(ui.lines().length, `${mode} confirming at ${rows} rows`).toBeLessThanOrEqual(rows);
      }
    }
  }, 20_000);

  test('a wide character is measured in cells, not in code units', async () => {
    // A project directory called 店铺 is four cells and two code units. Padding
    // it by code units puts the row two cells over the width, and a row one
    // cell too wide wraps and destroys the alignment of every row below it.
    const wide = entry({
      id: 'w',
      label: 'Vite dev server',
      hint: '店铺店铺店铺店铺店铺',
      command: '/Users/dev/店铺/node_modules/.bin/vite',
    });

    for (const mode of ['beginner', 'advanced'] as const) {
      for (const width of [40, 60, 80, 120]) {
        const ui = renderApp(<App mode={mode} initialEntries={[wide]} scanner={stable} />, {
          columns: width,
        });
        await tick();
        for (const line of ui.lines()) {
          expect(displayWidth(line), `${mode} at ${width}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test('an emoji is never cut in half', () => {
    // Slicing by code unit would leave a lone surrogate at the cut.
    const cut = truncate('🚀🚀🚀🚀', 5);
    for (const character of cut) {
      const code = character.codePointAt(0)!;
      expect(code < 0xd800 || code > 0xdfff).toBe(true);
    }
    expect(displayWidth(cut)).toBeLessThanOrEqual(5);
  });

  test('the cursor cannot leave the list, even when the filter empties it', async () => {
    const ui = renderApp(<App initialEntries={sample} scanner={stable} />);
    await tick();

    // The empty-state message invites keystrokes; they must not strand the
    // cursor below zero and leave the list blank once the filter is cleared.
    await ui.press('/');
    await ui.press('z');
    for (let press = 0; press < 4; press += 1) await ui.press('j');
    await ui.press(ESCAPE);
    await tick();

    expect(ui.frame()).toContain('3000/tcp');
    expect(ui.frame()).toContain('5173/tcp');
  });

  test('never renders a line wider than the terminal', async () => {
    const long = entry({
      id: 'long',
      port: 8080,
      processName: 'a-process-with-a-really-long-name',
      label: 'an extremely long description of what is holding this port',
      hint: 'a-very-long-project-directory-name',
    });

    for (const width of [60, 80, 200]) {
      const ui = renderApp(<App mode="advanced" initialEntries={[long]} scanner={stable} />, { columns: width });
      await tick();
      for (const line of ui.lines()) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });

  test('re-lays out when the terminal is resized', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} scanner={stable} />, { columns: 200 });
    await tick();
    expect(ui.lines().some((line) => line.length > 100)).toBe(true);

    ui.stdout.resize(60);
    await tick();
    for (const line of ui.lines()) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('beginner mode', () => {
  const shop = entry({
    id: 'a',
    port: 3000,
    label: 'Next.js',
    category: 'web',
    hint: 'shop',
    summary: 'Point a browser at it - that is what it is there for.',
    restart: 'Start it again with `npm run dev`.',
    url: 'http://localhost:3000',
    risk: 'safe',
    riskReason: 'yours, and as easy to start again as it was to start',
  });

  test('is what you get when nothing says otherwise', async () => {
    const ui = renderApp(<App initialEntries={[shop]} scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('beginner');
    expect(ui.frame()).toContain('WHAT IT IS');
    expect(ui.frame()).toContain('CLOSE IT?');
  });

  test('answers the question in the row and explains it underneath', async () => {
    const ui = renderApp(<App initialEntries={[shop]} scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('Yes');
    expect(ui.frame()).toContain('http://localhost:3000');
    expect(ui.frame()).toContain('a web server');
    // The way back is part of the decision.
    expect(ui.frame()).toContain('npm run dev');
  });

  test('spends no width on a URL column when no row has a URL', async () => {
    const ui = renderApp(<App initialEntries={[entry({ id: 'x', url: null })]} scanner={stable} />);
    await tick();

    expect(ui.frame()).not.toContain('OPEN AT');
  });

  test('the confirmation says what closing it costs, in words', async () => {
    const ui = renderApp(<App initialEntries={[shop]} scanner={stable} />);
    await tick();
    await ui.press('x');

    expect(ui.frame()).toContain('Close whatever is using port 3000?');
    expect(ui.frame()).toContain('close it politely');
    expect(ui.frame()).toContain('leave it alone');
  });

  test('m switches to advanced and back', async () => {
    const ui = renderApp(<App initialEntries={[shop]} scanner={stable} />);
    await tick();
    await ui.press('m');

    expect(ui.frame()).toContain('advanced');
    expect(ui.frame()).toContain('PID');

    await ui.press('m');
    expect(ui.frame()).toContain('WHAT IT IS');
  });

  test('d hides the panel, for when the list matters more', async () => {
    const ui = renderApp(<App initialEntries={[shop]} scanner={stable} />);
    await tick();
    expect(ui.frame()).toContain('a web server');

    await ui.press('d');
    expect(ui.frame()).not.toContain('a web server');
  });
});

describe('advanced mode', () => {
  test('asks about the selected row only, and never about any other', async () => {
    const inspector = vi.fn(async () => ({ cwd: '/home/dev/shop', established: 2 }));
    const ui = renderApp(
      <App mode="advanced" initialEntries={sample} scanner={stable} inspector={inspector} />,
    );
    await settle();

    // Three rows on screen, one process looked up: the cost is per cursor
    // position, not per socket.
    expect(inspector).toHaveBeenCalledTimes(1);
    expect(inspector).toHaveBeenCalledWith(sample[0]);
    expect(ui.frame()).toContain('/home/dev/shop');
    expect(ui.frame()).toContain('2 connections open');
  });

  test('asks again when the cursor stops somewhere new', async () => {
    const inspector = vi.fn(async () => ({}));
    const ui = renderApp(
      <App mode="advanced" initialEntries={sample} scanner={stable} inspector={inspector} />,
    );
    await settle();
    await ui.press('j');
    await settle();

    expect(inspector).toHaveBeenLastCalledWith(sample[1]);
  });

  test('does not ask about every row the cursor passes through', async () => {
    // Each lookup is up to three uncancellable subprocesses, so holding a
    // movement key down must not spawn one batch per keystroke.
    const inspector = vi.fn(async () => ({}));
    const ui = renderApp(
      <App mode="advanced" initialEntries={sample} scanner={stable} inspector={inspector} />,
    );
    await ui.press('j');
    await ui.press('j');
    await ui.press('k');
    await settle();

    expect(inspector).toHaveBeenCalledTimes(1);
    expect(inspector).toHaveBeenCalledWith(sample[1]);
  });

  test('a lookup that rejects does not take the interface down with it', async () => {
    const inspector = vi.fn(async () => {
      throw new Error('lsof exploded');
    });
    const ui = renderApp(
      <App mode="advanced" initialEntries={sample} scanner={stable} inspector={inspector} />,
    );
    await settle();

    expect(ui.frame()).toContain('3000/tcp');
  });

  test('never asks in beginner mode, which has no room for the answer', async () => {
    const inspector = vi.fn(async () => ({}));
    renderApp(<App initialEntries={sample} scanner={stable} inspector={inspector} />);
    await settle();

    expect(inspector).not.toHaveBeenCalled();
  });
});

describe('killing', () => {
  test('a protected row is refused outright, with no dialog', async () => {
    const killer = vi.fn<typeof killEntry>();
    const ui = renderApp(<App mode="advanced" initialEntries={[sample[2]!]} scanner={stable} killer={killer} />);
    await tick();
    await ui.press('x');

    expect(ui.frame()).toContain('Refusing to kill');
    expect(ui.frame()).not.toContain('terminate (SIGTERM)');
    expect(killer).not.toHaveBeenCalled();
  });

  test('the confirmation names what it is about to kill', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={[sample[0]!]} scanner={stable} />);
    await tick();
    await ui.press('x');

    expect(ui.frame()).toContain('Kill whatever holds port 3000/tcp?');
    expect(ui.frame()).toContain('Next.js');
    expect(ui.frame()).toContain('pid 100');
  });

  test('the confirmation warns when the signal is going to bounce', async () => {
    const locked = entry({ id: 'd', port: 5432, pid: 612, user: 'postgres', label: 'PostgreSQL', elevation: 'it belongs to postgres' });
    const ui = renderApp(<App mode="advanced" initialEntries={[locked]} scanner={stable} />);
    await tick();
    await ui.press('x');

    // The warning has to arrive before the decision, not after it.
    expect(ui.frame()).toMatch(/Without (sudo|an elevated terminal) this will be refused/);
    expect(ui.frame()).toContain('it belongs to postgres');
    expect(ui.frame()).toContain('terminate (SIGTERM)');
  });

  test('cancelling signals nothing', async () => {
    const killer = vi.fn<typeof killEntry>();
    const ui = renderApp(<App mode="advanced" initialEntries={[sample[0]!]} scanner={stable} killer={killer} />);
    await tick();
    await ui.press('x');
    await ui.press('n');

    expect(killer).not.toHaveBeenCalled();
    expect(ui.frame()).toContain('Cancelled');
  });

  test('confirming sends SIGTERM, and f escalates to SIGKILL', async () => {
    const result: KillResult = {
      status: 'terminated',
      signal: 'SIGTERM',
      message: 'node exited after SIGTERM.',
    };
    const killer = vi.fn<typeof killEntry>().mockResolvedValue(result);
    const ui = renderApp(<App mode="advanced" initialEntries={[sample[0]!]} scanner={stable} killer={killer} />);
    await tick();

    await ui.press('x');
    await ui.press('y');
    expect(killer).toHaveBeenCalledWith(sample[0], { signal: 'SIGTERM' });

    await ui.press('x');
    await ui.press('f');
    expect(killer).toHaveBeenLastCalledWith(sample[0], { signal: 'SIGKILL' });
  });
});

describe('filtering', () => {
  test('typing after / narrows the list', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} scanner={stable} />);
    await tick();

    await ui.press('/');
    await ui.press('v');
    await ui.press('i');

    expect(ui.frame()).toContain('5173/tcp');
    expect(ui.frame()).not.toContain('22/tcp');
  });

  // `slash-port 3xxx` opens the list with the pattern already in the filter.
  test('a pattern passed on the command line arrives as the filter', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} initialFilter="3xxx" scanner={stable} />);
    await tick();

    expect(ui.frame()).toContain('3000/tcp');
    expect(ui.frame()).not.toContain('5173/tcp');
  });

  test('a pattern narrows to the ports it matches, not to a substring', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} scanner={stable} />);
    await tick();

    await ui.press('/');
    for (const character of '3xxx') await ui.press(character);

    expect(ui.frame()).toContain('3000/tcp');
    expect(ui.frame()).not.toContain('5173/tcp');
    expect(ui.frame()).not.toContain('22/tcp');
  });

  test('escape clears the filter rather than leaving the list empty', async () => {
    const ui = renderApp(<App mode="advanced" initialEntries={sample} scanner={stable} />);
    await tick();

    await ui.press('/');
    await ui.press('z');
    expect(ui.frame()).toContain('No port matches');

    await ui.press(ESCAPE);
    expect(ui.frame()).toContain('5173/tcp');
  });
});
