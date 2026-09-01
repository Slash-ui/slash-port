import { userInfo } from 'node:os';
import type { Category, DescriptionSource, PortEntry, RawSocket, Risk } from './types.js';

/**
 * The last component of a path, splitting on both separators whatever platform
 * this is running on. `node:path`'s own `basename` follows the host, so on
 * Linux it reads a Windows command line as one long directory name - and the
 * CI legs that would catch that are the ones where it cannot happen.
 */
function lastComponent(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? '';
}

/**
 * What a category means to somebody who does not already know, and how much
 * care closing one deserves. Signatures inherit these and override them only
 * where the specific program has something more useful to say, which keeps the
 * table below about recognition rather than about prose.
 */
interface CategoryInfo {
  /**
   * One sentence about this kind of thing, written to follow a headline that
   * has already named it - so it says what closing it means rather than
   * repeating the noun.
   */
  summary: string;
  risk: Risk;
  /** True when a browser is the right thing to point at it. */
  browsable?: boolean;
}

export const CATEGORY_INFO: Readonly<Record<Category, CategoryInfo>> = {
  web: {
    summary: 'Point a browser at it - that is what it is there for.',
    risk: 'safe',
    browsable: true,
  },
  database: {
    summary: 'Anything connected to it loses its connection when it stops.',
    risk: 'caution',
  },
  container: {
    summary: 'The container behind it keeps running unless you stop that too.',
    risk: 'caution',
  },
  messaging: {
    summary: 'Whatever is producing and consuming messages will drop off.',
    risk: 'caution',
  },
  tooling: {
    summary: 'Closing it stops the tool and nothing else.',
    risk: 'safe',
  },
  ai: {
    summary: 'Requests already in flight will fail.',
    risk: 'caution',
  },
  system: {
    summary: 'Part of the operating system rather than anything you started.',
    risk: 'risky',
  },
  remote: {
    summary: 'Closing it can lock you out of this machine from elsewhere.',
    risk: 'risky',
  },
  desktop: {
    summary: 'Quitting it from the app itself is tidier than signalling it.',
    risk: 'caution',
  },
  runtime: {
    summary: 'slash-port could name the runtime but not the project it belongs to.',
    risk: 'caution',
  },
  unknown: {
    summary: 'slash-port could not work out what this is.',
    risk: 'caution',
  },
};

/**
 * A command-line signature. Order in the array is the priority: a Vite server
 * is `node .../vite`, so Vite has to be tested before Node or every dev server
 * on the machine reports itself as "Node.js".
 */
export interface Signature {
  pattern: RegExp;
  label: string;
  category: Category;
  /** Overrides the category's sentence when the program deserves its own. */
  summary?: string;
  /** How to bring it back, when that is knowable without guessing. */
  restart?: string;
  /** Overrides the category's default. */
  risk?: Risk;
  /**
   * A runtime rather than a program: true of `node` and `python`, which say
   * what something is written in and not what it is. These lose to an
   * application name, and become the parenthetical hint instead of the label.
   */
  runtime?: boolean;
}

const DEV_SERVER_RESTART = 'Start it again with your dev command, usually `npm run dev`.';

export const SIGNATURES: readonly Signature[] = [
  // Node frameworks and dev servers, ahead of the runtime that hosts them.
  { pattern: /\bnext(-server)?\b|[/\\]next[/\\]dist[/\\]/i, label: 'Next.js', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bnuxt\b/i, label: 'Nuxt', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /[/\\]vite[/\\]|\bvite\b/i, label: 'Vite dev server', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bastro\b/i, label: 'Astro', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bremix\b/i, label: 'Remix', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bsvelte-kit\b|\bsveltekit\b/i, label: 'SvelteKit', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bgatsby\b/i, label: 'Gatsby', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bnest\b|\bnestjs\b/i, label: 'NestJS', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\breact-scripts\b/i, label: 'Create React App', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bwebpack(-dev-server)?\b/i, label: 'webpack dev server', category: 'web', restart: DEV_SERVER_RESTART },
  { pattern: /\bparcel\b/i, label: 'Parcel', category: 'web', restart: DEV_SERVER_RESTART },
  {
    pattern: /\bstorybook\b/i,
    label: 'Storybook',
    category: 'web',
    summary: 'Nothing but the component catalogue depends on it.',
    restart: 'Start it again with `npm run storybook`.',
  },
  { pattern: /\bexpo\b/i, label: 'Expo', category: 'web', restart: 'Start it again with `npx expo start`.' },
  { pattern: /\bmetro\b/i, label: 'Metro bundler', category: 'tooling', restart: 'It restarts with the React Native app.' },
  {
    pattern: /\bvitest\b/i,
    label: 'Vitest',
    category: 'tooling',
    summary: 'A test runner in watch mode: closing it abandons the run in progress.',
    restart: 'Start it again with `npm test`.',
  },
  {
    pattern: /\bjest\b/i,
    label: 'Jest',
    category: 'tooling',
    summary: 'A test runner in watch mode: closing it abandons the run in progress.',
    restart: 'Start it again with `npm test`.',
  },
  { pattern: /\bnodemon\b/i, label: 'nodemon', category: 'tooling', restart: DEV_SERVER_RESTART },
  { pattern: /\btsx\b|\bts-node\b/i, label: 'TypeScript dev process', category: 'tooling', restart: DEV_SERVER_RESTART },
  // Deliberately narrow: a bare "serve" appears in half the daemons on a
  // machine, so only the npm package's own paths count.
  {
    pattern: /\bhttp-server\b|npx\s+serve\b|node_modules[/\\]\.bin[/\\]serve\b/i,
    label: 'static file server',
    category: 'web',
    restart: 'Start it again with `npx serve`.',
  },
  {
    pattern: /\bpm2\b/i,
    label: 'PM2',
    category: 'tooling',
    summary: 'It restarts the apps it supervises, so stopping it stops them too.',
    risk: 'caution',
    restart: 'Bring it back with `pm2 resurrect`.',
  },

  // Python.
  { pattern: /\bgunicorn\b/i, label: 'Gunicorn', category: 'web' },
  { pattern: /\buvicorn\b/i, label: 'Uvicorn', category: 'web' },
  { pattern: /\bhypercorn\b/i, label: 'Hypercorn', category: 'web' },
  {
    pattern: /manage\.py\s+runserver/i,
    label: 'Django dev server',
    category: 'web',
    restart: 'Start it again with `python manage.py runserver`.',
  },
  { pattern: /\bdjango\b/i, label: 'Django', category: 'web' },
  { pattern: /\bflask\b/i, label: 'Flask', category: 'web', restart: 'Start it again with `flask run`.' },
  { pattern: /\bfastapi\b/i, label: 'FastAPI', category: 'web' },
  { pattern: /\bstreamlit\b/i, label: 'Streamlit', category: 'web', restart: 'Start it again with `streamlit run`.' },
  {
    pattern: /\bjupyter\b|\bipykernel\b/i,
    label: 'Jupyter',
    category: 'tooling',
    summary: 'Unsaved cells in an open notebook are lost when it stops.',
    risk: 'caution',
    restart: 'Start it again with `jupyter lab`.',
  },
  { pattern: /\bcelery\b/i, label: 'Celery', category: 'messaging' },
  { pattern: /\bhttp\.server\b|SimpleHTTPServer/i, label: 'Python http.server', category: 'web' },

  // Ruby, PHP, Java, Go, .NET.
  { pattern: /\bpuma\b/i, label: 'Puma', category: 'web' },
  { pattern: /\bunicorn\b/i, label: 'Unicorn', category: 'web' },
  { pattern: /\bsidekiq\b/i, label: 'Sidekiq', category: 'messaging' },
  { pattern: /\brails\b/i, label: 'Rails', category: 'web', restart: 'Start it again with `bin/rails server`.' },
  { pattern: /\bjekyll\b/i, label: 'Jekyll', category: 'web' },
  { pattern: /artisan\s+serve/i, label: 'Laravel dev server', category: 'web', restart: 'Start it again with `php artisan serve`.' },
  { pattern: /\bphp\b.*\s-S\s/i, label: 'PHP built-in server', category: 'web' },
  { pattern: /\bspring-boot\b|\borg\.springframework\b/i, label: 'Spring Boot', category: 'web' },
  { pattern: /\bgradle\b/i, label: 'Gradle', category: 'tooling', summary: 'A build daemon: the next build starts it again.' },
  { pattern: /\btomcat\b|\bcatalina\b/i, label: 'Tomcat', category: 'web' },
  { pattern: /(?:^|[/\\])air(?:\s|$)/i, label: 'Air (Go live reload)', category: 'web', restart: 'Start it again with `air`.' },
  { pattern: /\bdotnet\b/i, label: '.NET', category: 'web' },

  // Datastores and queues, matched on the binary name.
  {
    pattern: /\bpostgres(ql)?\b/i,
    label: 'PostgreSQL',
    category: 'database',
    summary: 'Open transactions are rolled back when it stops.',
  },
  { pattern: /\bmysqld\b|\bmariadbd\b/i, label: 'MySQL / MariaDB', category: 'database' },
  { pattern: /\bmongod\b/i, label: 'MongoDB', category: 'database' },
  {
    pattern: /\bredis(-(server|stack))?\b/i,
    label: 'Redis',
    category: 'database',
    summary: 'Anything it holds only in memory is gone when it stops.',
  },
  { pattern: /\bvalkey\b/i, label: 'Valkey', category: 'database' },
  {
    pattern: /\bmemcached\b/i,
    label: 'Memcached',
    category: 'database',
    summary: 'Losing its contents is survivable by design.',
    risk: 'safe',
  },
  { pattern: /\belasticsearch\b|\bopensearch\b/i, label: 'Elasticsearch / OpenSearch', category: 'database' },
  { pattern: /\bclickhouse\b/i, label: 'ClickHouse', category: 'database' },
  { pattern: /\brabbitmq\b|\bbeam\.smp\b/i, label: 'RabbitMQ', category: 'messaging' },
  { pattern: /\bkafka\b/i, label: 'Kafka', category: 'messaging' },
  { pattern: /\bzookeeper\b/i, label: 'ZooKeeper', category: 'messaging' },
  { pattern: /\betcd\b/i, label: 'etcd', category: 'database' },
  { pattern: /\bminio\b/i, label: 'MinIO', category: 'database' },
  { pattern: /\blocalstack\b/i, label: 'LocalStack', category: 'tooling' },
  {
    pattern: /\bollama\b/i,
    label: 'Ollama',
    category: 'ai',
    restart: 'Start it again with `ollama serve`, or by opening the app.',
  },
  { pattern: /\blm-?studio\b/i, label: 'LM Studio', category: 'ai' },
  {
    pattern: /\bsupabase\b/i,
    label: 'Supabase',
    category: 'database',
    summary: 'Several containers rather than one process.',
    restart: 'Bring it back with `supabase start`.',
  },

  // Containers, proxies, and system services.
  {
    pattern: /\bdocker-proxy\b/i,
    label: 'Docker published port',
    category: 'container',
    summary: 'The forwarder Docker puts in front of a container port, not the container itself.',
    restart: 'It comes back on its own when the container is restarted.',
  },
  {
    pattern: /com\.docker\./i,
    label: 'Docker Desktop',
    category: 'container',
    summary: 'Publishing a port on behalf of a container.',
    restart: 'Stopping the container that owns the port is the change you probably want.',
  },
  { pattern: /\bcontainerd\b/i, label: 'containerd', category: 'container' },
  { pattern: /\bkubelet\b|\bk3s\b|\bminikube\b/i, label: 'Kubernetes', category: 'container' },
  { pattern: /\bnginx\b/i, label: 'nginx', category: 'web', risk: 'caution' },
  { pattern: /\bcaddy\b/i, label: 'Caddy', category: 'web', risk: 'caution' },
  { pattern: /\btraefik\b/i, label: 'Traefik', category: 'web', risk: 'caution' },
  { pattern: /\bhttpd\b|\bapache2\b/i, label: 'Apache', category: 'web', risk: 'caution' },
  {
    pattern: /\bngrok\b|\bcloudflared\b/i,
    label: 'tunnel client',
    category: 'remote',
    summary: 'A tunnel exposing something on this machine to the internet.',
    risk: 'caution',
  },
  { pattern: /\bsshd\b/i, label: 'OpenSSH server', category: 'remote' },
  { pattern: /\bmDNSResponder\b|\bavahi\b/i, label: 'mDNS / Bonjour', category: 'system' },
  { pattern: /\brapportd\b/i, label: 'macOS Handoff', category: 'system' },
  { pattern: /\bControlCe(nter|ntre)\b/i, label: 'macOS Control Center', category: 'system' },
  { pattern: /\bcupsd\b/i, label: 'CUPS printing', category: 'system' },
  { pattern: /\bsystemd-resolve/i, label: 'systemd-resolved', category: 'system' },
  { pattern: /\bdnsmasq\b/i, label: 'dnsmasq', category: 'system' },

  // Runtimes last: they only win when nothing more specific matched, and even
  // then they lose their place as the label to an application name.
  { pattern: /\bdeno\b/i, label: 'Deno', category: 'runtime', runtime: true },
  { pattern: /\bbun\b/i, label: 'Bun', category: 'runtime', runtime: true },
  { pattern: /\bnode(js)?\b/i, label: 'Node.js', category: 'runtime', runtime: true },
  { pattern: /\bpython[\d.]*\b/i, label: 'Python', category: 'runtime', runtime: true },
  { pattern: /\bruby\b/i, label: 'Ruby', category: 'runtime', runtime: true },
  { pattern: /\bjava\b/i, label: 'Java', category: 'runtime', runtime: true },
  { pattern: /\bphp\b/i, label: 'PHP', category: 'runtime', runtime: true },
  { pattern: /\bperl\b/i, label: 'Perl', category: 'runtime', runtime: true },
];

interface RegistryEntry {
  label: string;
  category: Category;
  /**
   * Generic entries add nothing a reader did not already know - "dev server"
   * on 3000 is noise - so they are only used when nothing else at all matched.
   */
  generic?: boolean;
}

/**
 * Well-known ports, biased towards the ones a developer actually meets rather
 * than the full IANA list. Only consulted when the process could not be
 * identified, which is mostly other users' processes.
 */
export const PORT_REGISTRY: Readonly<Record<number, RegistryEntry>> = {
  20: { label: 'FTP data', category: 'system' },
  21: { label: 'FTP', category: 'system' },
  22: { label: 'SSH', category: 'remote' },
  25: { label: 'SMTP', category: 'system' },
  53: { label: 'DNS', category: 'system' },
  80: { label: 'HTTP', category: 'web' },
  110: { label: 'POP3', category: 'system' },
  111: { label: 'rpcbind', category: 'system' },
  123: { label: 'NTP', category: 'system' },
  143: { label: 'IMAP', category: 'system' },
  389: { label: 'LDAP', category: 'system' },
  443: { label: 'HTTPS', category: 'web' },
  445: { label: 'SMB', category: 'system' },
  465: { label: 'SMTPS', category: 'system' },
  514: { label: 'syslog', category: 'system' },
  548: { label: 'Apple Filing Protocol', category: 'system' },
  587: { label: 'SMTP submission', category: 'system' },
  631: { label: 'CUPS printing', category: 'system' },
  853: { label: 'DNS over TLS', category: 'system' },
  993: { label: 'IMAPS', category: 'system' },
  1080: { label: 'SOCKS proxy', category: 'remote' },
  1433: { label: 'SQL Server', category: 'database' },
  1521: { label: 'Oracle database', category: 'database' },
  1883: { label: 'MQTT', category: 'messaging' },
  1900: { label: 'SSDP / UPnP', category: 'system' },
  2049: { label: 'NFS', category: 'system' },
  2375: { label: 'Docker daemon (unencrypted)', category: 'container' },
  2376: { label: 'Docker daemon (TLS)', category: 'container' },
  3000: { label: 'dev server', category: 'web', generic: true },
  3001: { label: 'dev server', category: 'web', generic: true },
  3306: { label: 'MySQL / MariaDB', category: 'database' },
  3478: { label: 'STUN / TURN', category: 'system' },
  4200: { label: 'Angular dev server', category: 'web' },
  4321: { label: 'Astro dev server', category: 'web' },
  4873: { label: 'Verdaccio npm registry', category: 'tooling' },
  5000: { label: 'AirPlay receiver or Flask', category: 'web' },
  5173: { label: 'Vite dev server', category: 'web' },
  5432: { label: 'PostgreSQL', category: 'database' },
  5601: { label: 'Kibana', category: 'web' },
  5672: { label: 'RabbitMQ (AMQP)', category: 'messaging' },
  5900: { label: 'VNC / screen sharing', category: 'remote' },
  6006: { label: 'Storybook or TensorBoard', category: 'web' },
  6379: { label: 'Redis', category: 'database' },
  7000: { label: 'AirPlay', category: 'system' },
  8000: { label: 'dev server', category: 'web', generic: true },
  8025: { label: 'Mailpit / MailHog', category: 'web' },
  8080: { label: 'HTTP alternate', category: 'web', generic: true },
  8081: { label: 'HTTP alternate', category: 'web', generic: true },
  8443: { label: 'HTTPS alternate', category: 'web' },
  8888: { label: 'Jupyter', category: 'tooling' },
  9000: { label: 'PHP-FPM or MinIO', category: 'web' },
  9090: { label: 'Prometheus', category: 'web' },
  9092: { label: 'Kafka', category: 'messaging' },
  9200: { label: 'Elasticsearch', category: 'database' },
  9229: { label: 'Node.js inspector', category: 'tooling' },
  11211: { label: 'Memcached', category: 'database' },
  15672: { label: 'RabbitMQ management', category: 'web' },
  27017: { label: 'MongoDB', category: 'database' },
  50000: { label: 'DB2 or SIP', category: 'database' },
  54321: { label: 'Supabase / H2O', category: 'web' },
};

/** The text the heuristics run against: full command line, else process name. */
function searchable(socket: Pick<RawSocket, 'command' | 'processName'>): string {
  return socket.command?.trim() || socket.processName?.trim() || '';
}

function findSignature(text: string): Signature | null {
  if (!text) return null;
  for (const signature of SIGNATURES) {
    if (signature.pattern.test(text)) return signature;
  }
  return null;
}

export function matchSignature(text: string): string | null {
  return findSignature(text)?.label ?? null;
}

/**
 * The whole record, for callers that have their own text to identify - a
 * container image, say - and want the category and the advice that come with
 * a match rather than only its name.
 */
export function matchSignatureEntry(text: string): Signature | null {
  return findSignature(text);
}

/**
 * Directory names that name a convention rather than a thing. Seeing `lib` as
 * the project a server belongs to is worse than seeing nothing, because it
 * reads like an answer.
 */
const ANONYMOUS_DIRECTORIES = new Set([
  'app',
  'apps',
  'bin',
  'build',
  'cellar',
  'code',
  'contents',
  'current',
  'dev',
  'dist',
  'docs',
  'home',
  'homebrew',
  'lib',
  'lib64',
  'libexec',
  'linuxbrew',
  'local',
  'macos',
  'opt',
  'out',
  'packages',
  'projects',
  'repos',
  'resources',
  'sbin',
  'scripts',
  'server',
  'share',
  'site-packages',
  'source',
  'src',
  'srv',
  'tmp',
  'usr',
  'users',
  'var',
  'work',
  'workspace',
]);

function meaningfulDirectory(name: string | undefined): string | null {
  if (!name || name === '.' || name === '/' || name === '..') return null;
  if (ANONYMOUS_DIRECTORIES.has(name.toLowerCase())) return null;
  return name;
}

/**
 * The project a dev server belongs to, taken as the directory above
 * `node_modules` in its command line. Without it two Vite servers on 5173 and
 * 5174 are indistinguishable, which is exactly when you need to tell them
 * apart.
 *
 * A script under a directory that only names a convention - `lib`, `src`,
 * `bin` - falls back to the script itself, because `gcloud` says more about
 * what is running than `lib` does.
 */
export function projectHint(command: string | null): string | null {
  if (!command) return null;

  // Anchored on the marker and read backwards, never split on whitespace: a
  // project at `/Users/amin/My Project/node_modules/...` is called `My
  // Project`, and a capture that stops at the space calls it `Project`.
  const modules = /[/\\]node_modules[/\\]/.exec(command);
  if (modules) {
    const name = meaningfulDirectory(enclosingDirectory(command.slice(0, modules.index)));
    if (name) return name;
  }

  // Python and Ruby have no node_modules; fall back to the directory of the
  // script argument when the command line names one. The file name may not
  // contain spaces, but every directory above it may.
  const script = /[/\\]([^/\\\s"']+\.(?:py|rb|js|ts|mjs|cjs))(?=$|[\s"'])/.exec(command);
  if (script?.[1]) {
    const directory = meaningfulDirectory(enclosingDirectory(command.slice(0, script.index)));
    if (directory) return directory;
    // `.../google-cloud-sdk/lib/gcloud.py` is gcloud, whatever `lib` says.
    const file = script[1].replace(/\.\w+$/, '');
    if (file && file !== 'main' && file !== 'index' && file !== '__main__') return file;
  }

  return null;
}

/**
 * The directory a marker sits in, given everything to the left of it. Its own
 * last component is the answer, spaces and all - which is the whole reason
 * this reads backwards from the marker instead of matching a path forwards.
 */
function enclosingDirectory(prefix: string): string | undefined {
  const trimmed = prefix.replace(/[/\\]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const name = (separator === -1 ? trimmed : trimmed.slice(separator + 1)).replace(/^["']/, '').trim();
  return name || undefined;
}

/**
 * The product a binary belongs to, read off the path it was installed at.
 *
 * This is the answer to the commonest kind of unhelpful row: a process called
 * `figma_agent` described as "figma_agent". A path says which application put
 * it there, which is the thing the reader wanted and the process name was
 * never going to give them.
 */
export function applicationName(command: string | null): string | null {
  if (!command) return null;

  // Vendor directories are more specific than bundles: `Figma/FigmaAgent.app`
  // is Figma's, and saying so beats repeating the helper's own name.
  const support = /[/\\]Application Support[/\\]([^/\\]+)[/\\]/.exec(command);
  if (support?.[1]) {
    const name = meaningfulDirectory(support[1].replace(/\.localized$/, ''));
    if (name) return name;
  }

  // The outermost bundle, so a helper nested inside Visual Studio Code reports
  // the editor rather than the helper.
  const bundle = /([^/\\]+)\.app[/\\]/.exec(command);
  if (bundle?.[1]) {
    const name = meaningfulDirectory(bundle[1]);
    if (name) return name;
  }

  const windows = /[/\\]Program Files(?: \(x86\))?[/\\]([^/\\]+)[/\\]/i.exec(command);
  if (windows?.[1]) {
    const name = meaningfulDirectory(windows[1]);
    if (name) return name;
  }

  const unix = /[/\\](?:opt|snap)[/\\]([^/\\]+)[/\\]/.exec(command);
  if (unix?.[1]) {
    const name = meaningfulDirectory(unix[1]);
    if (name) return name;
  }

  return null;
}

/**
 * What the shape of a path says when its name says nothing: a binary under
 * `/usr/libexec` is a system service whoever wrote it, and that is worth more
 * to a reader than its own name repeated back at them.
 */
export function locationCategory(command: string | null): Category | null {
  if (!command) return null;
  if (/^\/(?:System|usr\/libexec|sbin|usr\/sbin)\//.test(command)) return 'system';
  if (/[/\\](?:LaunchDaemons|LaunchAgents)[/\\]/.test(command)) return 'system';
  if (/^\/(?:lib|usr\/lib)\/systemd\//.test(command)) return 'system';
  if (/[/\\]Windows[/\\]System32[/\\]/i.test(command)) return 'system';
  if (/\.app[/\\]/.test(command) || /^\/Applications\//.test(command)) return 'desktop';
  if (/[/\\]Program Files(?: \(x86\))?[/\\]/i.test(command)) return 'desktop';
  return null;
}

const LOCATION_LABEL: Partial<Record<Category, string>> = {
  system: 'system service',
  desktop: 'desktop app',
};

export interface Description {
  label: string | null;
  source: DescriptionSource;
  category: Category;
  hint: string | null;
  summary: string;
  restart: string | null;
}

type Describable = Pick<RawSocket, 'command' | 'processName' | 'port' | 'pid'>;

/**
 * Describe a port from everything that is knowable without asking anything to
 * identify itself, in priority order: what the command line says it is, the
 * application it was installed as, the well-known port registry, and finally
 * the shape of its path.
 *
 * The one rule the order exists to enforce is that the description never
 * repeats the process name. A column that says `figma_agent` next to a column
 * that says `figma_agent` is a column that has told the reader nothing, and it
 * is better to say so than to fill the space.
 */
export function describe(socket: Describable): Description {
  const text = searchable(socket);
  const signature = findSignature(text);
  const application = applicationName(socket.command);
  const registered = PORT_REGISTRY[socket.port];
  const located = locationCategory(socket.command);

  const project = projectHint(socket.command);

  const build = (
    label: string | null,
    source: DescriptionSource,
    category: Category,
    hint: string | null,
  ): Description => {
    const info = CATEGORY_INFO[category];
    return {
      label,
      source,
      category,
      // "Docker Desktop (Docker)" is one fact wearing two hats. A hint only
      // earns its brackets by saying something the label did not.
      hint: hint !== null && redundantHint(hint, label) ? null : hint,
      summary: signature?.summary ?? info.summary,
      restart: signature?.restart ?? null,
    };
  };

  // A named framework or daemon beats everything: it is the one source that
  // says what the program does rather than where it came from.
  if (signature && !signature.runtime) {
    return build(signature.label, 'signature', signature.category, project ?? application);
  }

  if (registered && !registered.generic && !signature) {
    return build(registered.label, 'registry', registered.category, project ?? application);
  }

  // An application name outranks a bare runtime: "Visual Studio Code (Node.js)"
  // is the useful way round, not "Node.js (Visual Studio Code)". But a runtime
  // installed at `Program Files\nodejs` is not an application that happens to
  // use Node - it is Node - so a directory that only spells the runtime out
  // again loses to the signature, which at least knows how to capitalise it.
  if (
    application &&
    !sameName(application, socket.processName) &&
    !sameName(application, signature?.label ?? null)
  ) {
    return build(
      application,
      'application',
      // Where it is installed beats what it is written in: once the label is
      // the application, "Visual Studio Code - a desktop app" says more than
      // "Visual Studio Code - a program", and the runtime moves to the hint.
      located ?? signature?.category ?? registered?.category ?? 'desktop',
      project ?? signature?.label ?? null,
    );
  }

  if (signature) {
    return build(signature.label, 'signature', signature.category, project);
  }

  if (registered) {
    return build(registered.label, 'registry', registered.category, project);
  }

  if (located) {
    return build(LOCATION_LABEL[located] ?? null, 'location', located, project);
  }

  // Nothing matched. Saying nothing is the honest answer; the process name is
  // already in its own column, and repeating it there would be a lie about how
  // much slash-port worked out.
  return build(null, 'none', 'unknown', project);
}

/**
 * A name reduced to what it is, for comparing two of them. The extension goes
 * first: stripping separators first turns `node.exe` into `nodeexe`, which
 * matches nothing, and Windows then gets the duplicated columns the whole
 * never-repeat-the-process-name rule exists to prevent.
 */
const bareName = (value: string): string =>
  value.toLowerCase().replace(/\.exe$/, '').replace(/[\s._-]/g, '');

/** Whether two names would only say the same thing twice. */
function sameName(candidate: string, other: string | null): boolean {
  if (!other) return false;
  return bareName(candidate) === bareName(other);
}

/**
 * Whether a hint is already contained in its label. "Docker Desktop (Docker)"
 * passes an equality test and still says one thing twice.
 */
export function redundantHint(hint: string, label: string | null): boolean {
  if (!label) return false;
  const [a, b] = [bareName(hint), bareName(label)];
  return a.includes(b) || b.includes(a);
}

/** Loopback and wildcard binds are the ones a browser here can actually reach. */
function reachableLocally(addresses: readonly string[]): boolean {
  return addresses.some(
    (address) => address === '*' || address === '127.0.0.1' || address === '::1' || address === 'localhost',
  );
}

/**
 * Where to point a browser, for the ports that answer one. Offered only for
 * TCP that is reachable from this machine, because a URL you cannot open is
 * worse than no URL at all.
 */
export function browserUrl(
  entry: Pick<PortEntry, 'category' | 'protocol' | 'port' | 'addresses' | 'label'>,
): string | null {
  if (entry.protocol !== 'tcp') return null;
  if (!reachableLocally(entry.addresses)) return null;
  // The port has the last word on this. A container publishing 8080 is almost
  // certainly HTTP whatever its image is called, and mailpit's 1025 is almost
  // certainly not, whatever the web UI on 8025 might suggest.
  const browsable =
    CATEGORY_INFO[entry.category].browsable === true || PORT_REGISTRY[entry.port]?.category === 'web';
  if (!browsable) return null;
  const scheme = entry.port === 443 || entry.port === 8443 ? 'https' : 'http';
  return `${scheme}://localhost:${entry.port}`;
}

export interface RiskVerdict {
  risk: Risk;
  reason: string;
}

/**
 * Whether this can be closed, folding together what it is, who owns it, and
 * whether a guardrail already refuses it.
 *
 * Guards and ownership outrank the category, because they are facts about this
 * machine rather than guesses about the software: a Postgres you do not own is
 * blocked whatever anybody thinks of closing databases.
 */
export function assessRisk(
  entry: Pick<PortEntry, 'category' | 'guard' | 'elevation' | 'pid' | 'processName' | 'command'>,
): RiskVerdict {
  if (entry.guard) {
    return { risk: 'protected', reason: `slash-port will not kill ${entry.guard}` };
  }
  if (entry.elevation) {
    return {
      risk: 'blocked',
      reason: `not yours to signal - ${entry.elevation}`,
    };
  }
  if (entry.pid === null) {
    return { risk: 'blocked', reason: 'there is no owner to signal' };
  }

  const signature = findSignature(entry.command?.trim() || entry.processName?.trim() || '');
  const risk = signature?.risk ?? CATEGORY_INFO[entry.category].risk;

  switch (risk) {
    case 'safe':
      return { risk, reason: 'yours, and as easy to start again as it was to start' };
    case 'caution':
      return { risk, reason: 'yours, but something may be relying on it' };
    default:
      return { risk: 'risky', reason: 'the system’s, not part of your work' };
  }
}

/**
 * Processes that are never worth killing from here. Compared on the bare
 * process name, lowercased and with any `.exe` removed.
 */
const PROTECTED_NAMES: Readonly<Record<string, string>> = {
  init: 'the init process',
  systemd: 'the init process',
  launchd: 'the init process',
  kernel_task: 'the kernel',
  sshd: 'the SSH daemon - killing it locks you out of a remote machine',
  'ssh-agent': 'the SSH agent',
  'dbus-daemon': 'the D-Bus message bus - the desktop session is built on it',
  // `/proc/[pid]/comm` is capped at fifteen characters, so the resolver
  // arrives with its last letter missing. Both spellings are the same daemon.
  'systemd-resolve': 'the systemd DNS resolver - killing it takes DNS down for everything',
  'systemd-resolved': 'the systemd DNS resolver - killing it takes DNS down for everything',
  'systemd-logind': 'the systemd login manager - killing it ends every session on the machine',
  loginwindow: 'the macOS session',
  windowserver: 'the macOS window server',
  systemuiserver: 'the macOS session',
  dock: 'the macOS session',
  finder: 'the macOS session',
  csrss: 'a Windows session process',
  wininit: 'a Windows session process',
  winlogon: 'a Windows session process',
  services: 'the Windows service controller',
  lsass: 'the Windows security subsystem',
  smss: 'a Windows session process',
  svchost: 'a Windows service host - it runs many unrelated services',
  system: 'the Windows kernel',
};

export interface GuardContext {
  /** slash-port's own pid. */
  self: number;
  /** The shell that launched slash-port. */
  parent: number;
}

/**
 * The reason killing this process is refused, or `null` when it is allowed.
 * Refusal happens before any dialog is offered: there is no confirmation that
 * lets you kill your own shell.
 */
export function guardReason(
  socket: Pick<RawSocket, 'pid' | 'processName'>,
  context: GuardContext = { self: process.pid, parent: process.ppid },
): string | null {
  const { pid } = socket;

  if (pid === 1) return 'the init process';
  if (pid !== null && pid === context.self) return 'slash-port itself';
  if (pid !== null && pid === context.parent) return 'the shell that launched slash-port';

  const name = socket.processName?.trim().toLowerCase().replace(/\.exe$/, '');
  if (name && name in PROTECTED_NAMES) return PROTECTED_NAMES[name]!;

  return null;
}

export interface OwnerContext {
  /** The uid slash-port is running as, or `null` on a platform without uids. */
  uid: number | null;
  /** The user name slash-port is running as. */
  user: string | null;
  platform: NodeJS.Platform;
}

function currentOwner(): OwnerContext {
  return {
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    // A uid with no passwd entry - a container running as a bare number -
    // makes this throw rather than return anything useful.
    user: ((): string | null => {
      try {
        return userInfo().username;
      } catch {
        return null;
      }
    })(),
    platform: process.platform,
  };
}

/** Windows writes `MACHINE\amin`, and is not case sensitive about either half. */
function sameUser(a: string, b: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return a === b;
  const bare = (name: string): string => (name.split('\\').pop() ?? name).toLowerCase();
  return bare(a) === bare(b);
}

/** Whether the process belongs to whoever is running slash-port. */
export function ownedByCurrentUser(
  socket: Pick<RawSocket, 'user'>,
  context: OwnerContext = currentOwner(),
): boolean {
  if (socket.user === null || context.user === null) return false;
  return sameUser(socket.user, context.user, context.platform);
}

/**
 * What to do about a process you cannot signal. `sudo` is the answer almost
 * everywhere and the wrong word on Windows, so the remedy is named per
 * platform while the badge stays the same in every terminal.
 */
export function elevationRemedy(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'an elevated terminal' : 'sudo';
}

/**
 * Why a signal to this process is expected to be refused, or `null` when it
 * should land.
 *
 * The scan already knows who owns every socket, so this is settled while the
 * list is built rather than discovered after a confirmation. That is the whole
 * point: "sudo" is worth knowing before you decide, not after. Nothing here
 * refuses anything - `killEntry` still asks the kernel, which is the only
 * authority on the answer.
 */
export function elevationReason(
  socket: Pick<RawSocket, 'pid' | 'user'>,
  context: OwnerContext = currentOwner(),
): string | null {
  // Root can signal anything.
  if (context.uid === 0) return null;

  if (socket.pid === null) {
    // Windows reports pid 0 for the idle process rather than hiding an owner,
    // so an unresolved pid there is not a permission wall.
    return context.platform === 'win32' ? null : 'its owner is not visible';
  }

  if (socket.user === null || context.user === null) return null;
  if (sameUser(socket.user, context.user, context.platform)) return null;
  // The scanners fall back to the numeric uid when /etc/passwd has no name.
  if (context.uid !== null && socket.user === String(context.uid)) return null;

  return `it belongs to ${socket.user}`;
}
