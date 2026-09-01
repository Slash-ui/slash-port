import { CATEGORY_INFO, elevationRemedy, ownedByCurrentUser } from './describe.js';
import type { ProcessDetail } from './inspect.js';
import type { Category, PortEntry, Risk } from './types.js';

/**
 * A labelled line in the detail panel. Both modes render the same shape; they
 * differ only in which lines they think are worth the space.
 */
export interface Field {
  label: string;
  value: string;
}

/** The category as a noun phrase, so it can follow "is". */
const CATEGORY_NOUN: Readonly<Record<Category, string>> = {
  web: 'a web server',
  database: 'a database',
  container: 'a container port',
  messaging: 'a message broker',
  tooling: 'a development tool',
  ai: 'a local model server',
  system: 'a system service',
  remote: 'a way in from another machine',
  desktop: 'a desktop app',
  runtime: 'a program',
  unknown: 'something slash-port could not identify',
};

/**
 * The short answer for the "can I close it" column. One or two words, because
 * the column has to survive an eighty-column terminal, with the whole reason
 * waiting in the panel underneath.
 */
export function riskWord(risk: Risk, platform: NodeJS.Platform = process.platform): string {
  switch (risk) {
    case 'safe':
      return 'Yes';
    case 'caution':
      return 'Probably';
    case 'risky':
      return 'Better not';
    case 'protected':
      return 'No';
    default:
      return platform === 'win32' ? 'Not as you' : 'Needs sudo';
  }
}

/**
 * The same answer with its reason, short enough for a table column. A table
 * that wraps is a table that has stopped being one.
 */
export function riskSentence(entry: PortEntry): string {
  // ASCII, deliberately. This string reaches `--plain`, which is what a pipe
  // and a batch script read, and an em dash under a legacy Windows code page
  // is not a dash.
  return `${riskWord(entry.risk)} - ${entry.riskReason}`;
}

/**
 * The answer with the way back, for the one place that has room for a sentence
 * and no room for a second line.
 */
export function riskAdvice(entry: PortEntry): string {
  const restart = entry.risk === 'safe' || entry.risk === 'caution' ? entry.restart : null;
  return [`${riskSentence(entry)}.`, restart].filter(Boolean).join(' ');
}

/**
 * The one-line answer to "what is this", built so that it never repeats the
 * process name back at the reader. When nothing was identified it says so,
 * because "unidentified" is a fact and `figma_agent` next to `figma_agent` is
 * not.
 */
export function headline(entry: PortEntry): string {
  const noun = CATEGORY_NOUN[entry.category];
  if (!entry.label) {
    return entry.processName ? `${entry.processName} - not identified` : 'Not identified';
  }
  const named = entry.hint ? `${entry.label} (${entry.hint})` : entry.label;
  // "Redis - a database" earns its dash; "a desktop app - a desktop app" does
  // not, so a label that already is the noun does not get it twice.
  return entry.label.toLowerCase() === noun.replace(/^an? /, '') ? named : `${named} - ${noun}`;
}

function ownerPhrase(entry: PortEntry): string {
  const parts: string[] = [];
  if (entry.user) parts.push(ownedByCurrentUser(entry) ? `you (${entry.user})` : entry.user);
  else parts.push('an owner slash-port cannot see');
  if (entry.processName) parts.push(entry.processName);
  if (entry.pid !== null) parts.push(`pid ${entry.pid}`);
  return parts.join(' · ');
}

export interface Brief {
  headline: string;
  /** A full sentence about what this kind of thing is. */
  summary: string;
  fields: Field[];
}

export interface ExplainOptions {
  /** Whether the container lookup ran, so its absence can be explained. */
  docker?: boolean;
}

/**
 * What beginner mode puts under the list: what it is, where to look at it, who
 * started it, and whether closing it is a good idea. Everything a person needs
 * to decide, and nothing that only matters once they have decided.
 */
export function beginnerBrief(entry: PortEntry, options: ExplainOptions = {}): Brief {
  const fields: Field[] = [];

  if (entry.hint && entry.label) {
    fields.push({ label: entry.source === 'docker' ? 'Container' : 'Project', value: entry.hint });
  } else if (entry.category === 'container' && options.docker !== true) {
    // Otherwise the default quietly costs the answer: "Docker Desktop" on 5432
    // is true, useless, and one flag away from naming the container.
    fields.push({ label: 'Container', value: 'not looked up - re-run with --docker to name it' });
  }
  if (entry.url) fields.push({ label: 'Open', value: entry.url });
  fields.push({ label: 'Started by', value: ownerPhrase(entry) });
  fields.push({ label: 'Close it', value: riskSentence(entry) });

  // The way back gets its own line rather than trailing the verdict, because
  // it is the half of the answer that would be truncated away, and it is the
  // half that turns "you can close this" into something a person will do.
  const restart = entry.risk === 'safe' || entry.risk === 'caution' ? entry.restart : null;
  if (restart) fields.push({ label: 'Afterwards', value: restart });

  if (entry.risk === 'blocked' && entry.pid !== null) {
    fields.push({
      label: 'To signal it',
      value: `Run slash-port again with ${elevationRemedy()}.`,
    });
  }

  return {
    headline: headline(entry),
    summary: entry.summary,
    fields,
  };
}

/** `2h 11m`, `4d 3h`, `38s` - the coarsest two units that are still true. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/** Bytes as the unit a person would have said out loud. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const SOURCE_PHRASE = {
  signature: 'command line',
  docker: 'the Docker engine',
  registry: 'well-known port',
  application: 'install path',
  location: 'path shape only',
  none: 'nothing matched',
} as const;

/**
 * What advanced mode puts under the list. The extra facts here are the ones
 * you want once you have decided something is in the way and are working out
 * which of two identical-looking processes it is: the working directory, the
 * parent, how long it has been up, and whether anything is actually talking
 * to it.
 *
 * `detail` is filled in asynchronously for the selected row only, so the lines
 * it feeds appear a moment after the rest rather than holding up the list.
 */
export function advancedFields(entry: PortEntry, detail: ProcessDetail | null): Field[] {
  const fields: Field[] = [];

  const process = [
    entry.processName ?? 'unknown',
    entry.pid === null ? null : `pid ${entry.pid}`,
    detail?.parentPid === undefined
      ? null
      : `parent ${detail.parentPid}${detail.parentName ? ` ${detail.parentName}` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
  fields.push({ label: 'Process', value: process });

  fields.push({ label: 'User', value: entry.user ?? 'not visible' });

  const listen = `${entry.addresses.join(', ')} · ${entry.protocol.toUpperCase()} · IPv${entry.families.join('/IPv')}`;
  fields.push({ label: 'Listening', value: listen });

  if (detail?.established !== undefined) {
    fields.push({
      label: 'Clients',
      value:
        detail.established === 0
          ? 'nothing connected'
          : `${detail.established} connection${detail.established === 1 ? '' : 's'} open`,
    });
  }

  if (detail?.uptimeSeconds !== undefined) {
    const started = detail.startedAt ? ` (since ${detail.startedAt})` : '';
    fields.push({ label: 'Running', value: `${formatDuration(detail.uptimeSeconds)}${started}` });
  }

  if (detail?.rssBytes !== undefined) {
    const cpu = detail.cpuPercent === undefined ? '' : ` · ${detail.cpuPercent.toFixed(1)}% CPU`;
    fields.push({ label: 'Memory', value: `${formatBytes(detail.rssBytes)}${cpu}` });
  }

  if (detail?.cwd) fields.push({ label: 'Directory', value: detail.cwd });
  else if (detail?.cwdDenied) {
    fields.push({ label: 'Directory', value: `not visible - re-run with ${elevationRemedy()}` });
  }

  if (entry.command) fields.push({ label: 'Command', value: entry.command });

  fields.push({
    label: 'Identified',
    value: `${entry.label ?? 'not identified'} · ${entry.category} · from ${SOURCE_PHRASE[entry.source]}`,
  });

  fields.push({ label: 'Kill', value: riskAdvice(entry) });

  return fields;
}
