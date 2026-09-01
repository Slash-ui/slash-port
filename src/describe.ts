import { basename } from 'node:path';
import type { RawSocket } from './types.js';

/**
 * A command-line signature. Order in the array is the priority: a Vite server
 * is `node .../vite`, so Vite has to be tested before Node or every dev server
 * on the machine reports itself as "Node.js".
 */
interface Signature {
  pattern: RegExp;
  label: string;
}

export const SIGNATURES: readonly Signature[] = [
  // Node frameworks and dev servers, ahead of the runtime that hosts them.
  { pattern: /\bnext(-server)?\b|[/\\]next[/\\]dist[/\\]/i, label: 'Next.js' },
  { pattern: /\bnuxt\b/i, label: 'Nuxt' },
  { pattern: /[/\\]vite[/\\]|\bvite\b/i, label: 'Vite dev server' },
  { pattern: /\bastro\b/i, label: 'Astro' },
  { pattern: /\bremix\b/i, label: 'Remix' },
  { pattern: /\bsvelte-kit\b|\bsveltekit\b/i, label: 'SvelteKit' },
  { pattern: /\bgatsby\b/i, label: 'Gatsby' },
  { pattern: /\bnest\b|\bnestjs\b/i, label: 'NestJS' },
  { pattern: /\breact-scripts\b/i, label: 'Create React App' },
  { pattern: /\bwebpack(-dev-server)?\b/i, label: 'webpack dev server' },
  { pattern: /\bparcel\b/i, label: 'Parcel' },
  { pattern: /\bstorybook\b/i, label: 'Storybook' },
  { pattern: /\bexpo\b/i, label: 'Expo' },
  { pattern: /\bmetro\b/i, label: 'Metro bundler' },
  { pattern: /\bvitest\b/i, label: 'Vitest' },
  { pattern: /\bjest\b/i, label: 'Jest' },
  { pattern: /\bnodemon\b/i, label: 'nodemon' },
  { pattern: /\btsx\b|\bts-node\b/i, label: 'TypeScript dev process' },
  // Deliberately narrow: a bare "serve" appears in half the daemons on a
  // machine, so only the npm package's own paths count.
  { pattern: /\bhttp-server\b|npx\s+serve\b|node_modules[/\\]\.bin[/\\]serve\b/i, label: 'static file server' },
  { pattern: /\bpm2\b/i, label: 'PM2' },

  // Python.
  { pattern: /\bgunicorn\b/i, label: 'Gunicorn' },
  { pattern: /\buvicorn\b/i, label: 'Uvicorn' },
  { pattern: /\bhypercorn\b/i, label: 'Hypercorn' },
  { pattern: /manage\.py\s+runserver/i, label: 'Django dev server' },
  { pattern: /\bdjango\b/i, label: 'Django' },
  { pattern: /\bflask\b/i, label: 'Flask' },
  { pattern: /\bfastapi\b/i, label: 'FastAPI' },
  { pattern: /\bstreamlit\b/i, label: 'Streamlit' },
  { pattern: /\bjupyter\b|\bipykernel\b/i, label: 'Jupyter' },
  { pattern: /\bcelery\b/i, label: 'Celery' },
  { pattern: /\bhttp\.server\b|SimpleHTTPServer/i, label: 'Python http.server' },

  // Ruby, PHP, Java, Go, .NET.
  { pattern: /\bpuma\b/i, label: 'Puma' },
  { pattern: /\bunicorn\b/i, label: 'Unicorn' },
  { pattern: /\bsidekiq\b/i, label: 'Sidekiq' },
  { pattern: /\brails\b/i, label: 'Rails' },
  { pattern: /\bjekyll\b/i, label: 'Jekyll' },
  { pattern: /artisan\s+serve/i, label: 'Laravel dev server' },
  { pattern: /\bphp\b.*\s-S\s/i, label: 'PHP built-in server' },
  { pattern: /\bspring-boot\b|\borg\.springframework\b/i, label: 'Spring Boot' },
  { pattern: /\bgradle\b/i, label: 'Gradle' },
  { pattern: /\btomcat\b|\bcatalina\b/i, label: 'Tomcat' },
  { pattern: /(?:^|[/\\])air(?:\s|$)/i, label: 'Air (Go live reload)' },
  { pattern: /\bdotnet\b/i, label: '.NET' },

  // Datastores and queues, matched on the binary name.
  { pattern: /\bpostgres(ql)?\b/i, label: 'PostgreSQL' },
  { pattern: /\bmysqld\b|\bmariadbd\b/i, label: 'MySQL / MariaDB' },
  { pattern: /\bmongod\b/i, label: 'MongoDB' },
  { pattern: /\bredis-(server|stack)\b/i, label: 'Redis' },
  { pattern: /\bvalkey\b/i, label: 'Valkey' },
  { pattern: /\bmemcached\b/i, label: 'Memcached' },
  { pattern: /\belasticsearch\b|\bopensearch\b/i, label: 'Elasticsearch / OpenSearch' },
  { pattern: /\bclickhouse\b/i, label: 'ClickHouse' },
  { pattern: /\brabbitmq\b|\bbeam\.smp\b/i, label: 'RabbitMQ' },
  { pattern: /\bkafka\b/i, label: 'Kafka' },
  { pattern: /\bzookeeper\b/i, label: 'ZooKeeper' },
  { pattern: /\betcd\b/i, label: 'etcd' },
  { pattern: /\bminio\b/i, label: 'MinIO' },
  { pattern: /\blocalstack\b/i, label: 'LocalStack' },
  { pattern: /\bollama\b/i, label: 'Ollama' },
  { pattern: /\blm-?studio\b/i, label: 'LM Studio' },
  { pattern: /\bsupabase\b/i, label: 'Supabase' },

  // Containers, proxies, and system services.
  { pattern: /\bdocker-proxy\b/i, label: 'Docker published port' },
  { pattern: /com\.docker\./i, label: 'Docker Desktop' },
  { pattern: /\bcontainerd\b/i, label: 'containerd' },
  { pattern: /\bkubelet\b|\bk3s\b|\bminikube\b/i, label: 'Kubernetes' },
  { pattern: /\bnginx\b/i, label: 'nginx' },
  { pattern: /\bcaddy\b/i, label: 'Caddy' },
  { pattern: /\btraefik\b/i, label: 'Traefik' },
  { pattern: /\bhttpd\b|\bapache2\b/i, label: 'Apache' },
  { pattern: /\bngrok\b|\bcloudflared\b/i, label: 'tunnel client' },
  { pattern: /\bsshd\b/i, label: 'OpenSSH server' },
  { pattern: /\bmDNSResponder\b|\bavahi\b/i, label: 'mDNS / Bonjour' },
  { pattern: /\brapportd\b/i, label: 'macOS Handoff' },
  { pattern: /\bControlCe(nter|ntre)\b/i, label: 'macOS Control Center' },
  { pattern: /\bcupsd\b/i, label: 'CUPS printing' },
  { pattern: /\bsystemd-resolve/i, label: 'systemd-resolved' },
  { pattern: /\bdnsmasq\b/i, label: 'dnsmasq' },

  // Runtimes last: they only win when nothing more specific matched.
  { pattern: /\bdeno\b/i, label: 'Deno' },
  { pattern: /\bbun\b/i, label: 'Bun' },
  { pattern: /\bnode(js)?\b/i, label: 'Node.js' },
  { pattern: /\bpython[\d.]*\b/i, label: 'Python' },
  { pattern: /\bruby\b/i, label: 'Ruby' },
  { pattern: /\bjava\b/i, label: 'Java' },
  { pattern: /\bphp\b/i, label: 'PHP' },
  { pattern: /\bperl\b/i, label: 'Perl' },
];

interface RegistryEntry {
  label: string;
  /**
   * Generic entries add nothing a reader did not already know — "dev server"
   * on 3000 is noise — so they are recorded for completeness but suppressed.
   */
  generic?: boolean;
}

/**
 * Well-known ports, biased towards the ones a developer actually meets rather
 * than the full IANA list. Only consulted when the process could not be
 * identified, which is mostly other users' processes.
 */
export const PORT_REGISTRY: Readonly<Record<number, RegistryEntry>> = {
  20: { label: 'FTP data' },
  21: { label: 'FTP' },
  22: { label: 'SSH' },
  25: { label: 'SMTP' },
  53: { label: 'DNS' },
  80: { label: 'HTTP' },
  110: { label: 'POP3' },
  111: { label: 'rpcbind' },
  123: { label: 'NTP' },
  143: { label: 'IMAP' },
  389: { label: 'LDAP' },
  443: { label: 'HTTPS' },
  445: { label: 'SMB' },
  465: { label: 'SMTPS' },
  514: { label: 'syslog' },
  548: { label: 'Apple Filing Protocol' },
  587: { label: 'SMTP submission' },
  631: { label: 'CUPS printing' },
  853: { label: 'DNS over TLS' },
  993: { label: 'IMAPS' },
  1080: { label: 'SOCKS proxy' },
  1433: { label: 'SQL Server' },
  1521: { label: 'Oracle database' },
  1883: { label: 'MQTT' },
  1900: { label: 'SSDP / UPnP' },
  2049: { label: 'NFS' },
  2375: { label: 'Docker daemon (unencrypted)' },
  2376: { label: 'Docker daemon (TLS)' },
  3000: { label: 'dev server', generic: true },
  3001: { label: 'dev server', generic: true },
  3306: { label: 'MySQL / MariaDB' },
  3478: { label: 'STUN / TURN' },
  4200: { label: 'Angular dev server' },
  4321: { label: 'Astro dev server' },
  4873: { label: 'Verdaccio npm registry' },
  5000: { label: 'AirPlay receiver or Flask' },
  5173: { label: 'Vite dev server' },
  5432: { label: 'PostgreSQL' },
  5601: { label: 'Kibana' },
  5672: { label: 'RabbitMQ (AMQP)' },
  5900: { label: 'VNC / screen sharing' },
  6006: { label: 'Storybook or TensorBoard' },
  6379: { label: 'Redis' },
  7000: { label: 'AirPlay' },
  8000: { label: 'dev server', generic: true },
  8025: { label: 'Mailpit / MailHog' },
  8080: { label: 'HTTP alternate', generic: true },
  8081: { label: 'HTTP alternate', generic: true },
  8443: { label: 'HTTPS alternate' },
  8888: { label: 'Jupyter' },
  9000: { label: 'PHP-FPM or MinIO' },
  9090: { label: 'Prometheus' },
  9092: { label: 'Kafka' },
  9200: { label: 'Elasticsearch' },
  9229: { label: 'Node.js inspector' },
  11211: { label: 'Memcached' },
  15672: { label: 'RabbitMQ management' },
  27017: { label: 'MongoDB' },
  50000: { label: 'DB2 or SIP' },
  54321: { label: 'Supabase / H2O' },
};

/** The text the heuristics run against: full command line, else process name. */
function searchable(socket: Pick<RawSocket, 'command' | 'processName'>): string {
  return socket.command?.trim() || socket.processName?.trim() || '';
}

export function matchSignature(text: string): string | null {
  if (!text) return null;
  for (const signature of SIGNATURES) {
    if (signature.pattern.test(text)) return signature.label;
  }
  return null;
}

/**
 * The project a dev server belongs to, taken as the directory above
 * `node_modules` in its command line. Without it two Vite servers on 5173 and
 * 5174 are indistinguishable, which is exactly when you need to tell them
 * apart.
 */
export function projectHint(command: string | null): string | null {
  if (!command) return null;

  const modules = /([^\s"']+)[/\\]node_modules[/\\]/.exec(command);
  if (modules?.[1]) {
    const name = basename(modules[1]);
    if (name && name !== '.' && name !== '/') return name;
  }

  // Python and Ruby have no node_modules; fall back to the directory of the
  // script argument when the command line names one.
  const script = /(?:^|\s)([^\s"']*[/\\][^\s"']+\.(?:py|rb|js|ts|mjs|cjs))(?:\s|$)/.exec(command);
  if (script?.[1]) {
    const directory = script[1].replace(/[/\\][^/\\]+$/, '');
    const name = basename(directory);
    if (name && name !== '.' && name !== '/') return name;
  }

  return null;
}

export interface Description {
  label: string;
  hint: string | null;
}

/**
 * Describe a port from three sources, in priority order: what the command line
 * says it is, then the project it belongs to, then the well-known port
 * registry as a fallback for processes that could not be identified at all.
 */
export function describe(socket: Pick<RawSocket, 'command' | 'processName' | 'port' | 'pid'>): Description {
  const text = searchable(socket);
  const signature = matchSignature(text);
  const hint = projectHint(socket.command);

  if (signature) return { label: signature, hint };

  const registered = PORT_REGISTRY[socket.port];
  if (registered && !registered.generic) return { label: registered.label, hint };

  if (socket.processName) return { label: socket.processName, hint };
  if (socket.pid === null) return { label: 'owner not visible', hint };
  return { label: 'unknown', hint };
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
  sshd: 'the SSH daemon — killing it locks you out of a remote machine',
  'ssh-agent': 'the SSH agent',
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
  svchost: 'a Windows service host — it runs many unrelated services',
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
