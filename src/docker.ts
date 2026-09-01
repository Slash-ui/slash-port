import { request } from 'node:http';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { browserUrl, matchSignatureEntry, redundantHint } from './describe.js';
import type { PortEntry } from './types.js';

/**
 * What Docker knows about a container that slash-port cannot work out from the
 * socket table: which container published the port, from which image, and
 * which compose project it belongs to.
 */
export interface ContainerPort {
  name: string;
  image: string;
  /** The `com.docker.compose.project` label, when the container has one. */
  project: string | null;
  service: string | null;
}

/**
 * Where the engine listens, in the order worth trying. Docker Desktop, Colima,
 * Rancher, and a plain Linux install each put the socket somewhere different,
 * and the alternative to knowing all four is telling a Colima user their
 * containers do not exist.
 */
export function socketCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  const host = env['DOCKER_HOST'];
  // A TCP DOCKER_HOST is somebody else's machine, and slash-port does not make
  // network connections. Falling through to the local sockets would answer a
  // question about the wrong host, so it is left unanswered instead.
  if (host?.startsWith('unix://')) return [host.slice('unix://'.length)];
  // Docker Desktop on Windows sets `npipe:////./pipe/docker_engine`, which is
  // the same pipe written the other way round.
  if (host?.startsWith('npipe://')) {
    return [host.slice('npipe://'.length).replace(/\//g, '\\')];
  }
  if (host) return [];

  if (platform === 'win32') return ['\\\\.\\pipe\\docker_engine'];
  return [
    '/var/run/docker.sock',
    join(home, '.docker/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.rd/docker.sock'),
  ];
}

function plausibleSockets(candidates: readonly string[]): string[] {
  // A named pipe is not a file, so on Windows the only way to find out is to
  // try it - which the request below does, and gives up on quickly.
  return candidates.filter((path) => path.startsWith('\\\\') || existsSync(path));
}

interface DockerContainer {
  Names?: string[];
  Image?: string;
  Labels?: Record<string, string>;
  Ports?: Array<{ PublicPort?: number; Type?: string }>;
}

/**
 * Ask the local engine over its unix socket. Nothing here touches the network:
 * this is a file on this machine, the same as `/proc/net/tcp` is.
 *
 * Every failure is the same failure - no annotations - because a machine
 * without Docker, a machine whose user is not in the `docker` group, and a
 * machine whose engine is starting up are all cases where the right thing to
 * do is describe the port the way it would have been described anyway.
 */
/** Enough of a container list to name a port; a bigger reply is not one. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function listContainers(socketPath: string, timeoutMs: number): Promise<DockerContainer[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DockerContainer[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      call.destroy();
      resolve(value);
    };

    const call = request(
      {
        socketPath,
        path: '/containers/json',
        method: 'GET',
        // Not the global agent: its keep-alive would park a connection to the
        // engine for the life of the interface.
        agent: false,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish([]);
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) finish([]);
        });
        response.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(body);
            finish(Array.isArray(parsed) ? (parsed as DockerContainer[]) : []);
          } catch {
            finish([]);
          }
        });
      },
    );

    // A deadline, not `timeout`, which arms `socket.setTimeout` and so only
    // fires after that long with no traffic at all. An engine dribbling out a
    // reply would keep resetting it and hold the scan open indefinitely.
    const deadline = setTimeout(() => finish([]), timeoutMs);

    call.on('error', () => finish([]));
    call.end();
  });
}

/** Published port to the container behind it. */
export function indexPorts(containers: readonly DockerContainer[]): Map<number, ContainerPort> {
  const index = new Map<number, ContainerPort>();

  for (const container of containers) {
    const name = container.Names?.[0]?.replace(/^\//, '') ?? null;
    const image = container.Image ?? null;
    if (!name || !image) continue;

    const info: ContainerPort = {
      name,
      image,
      project: container.Labels?.['com.docker.compose.project'] ?? null,
      service: container.Labels?.['com.docker.compose.service'] ?? null,
    };

    for (const published of container.Ports ?? []) {
      // An unpublished port is not reachable from here and will not appear in
      // the socket table, so indexing it would only invite a false match.
      if (typeof published.PublicPort === 'number') index.set(published.PublicPort, info);
    }
  }

  return index;
}

/** `postgres:16-alpine` and `ghcr.io/org/api:sha-1234` are both one word. */
export function imageName(image: string): string {
  const withoutTag = image.replace(/@sha256:[\da-f]+$/i, '').replace(/:[^:/]+$/, '');
  return withoutTag.split('/').pop() || image;
}

/**
 * Fold what the container knows into the row.
 *
 * This is the difference between "Docker published port" - true, and useless -
 * and "PostgreSQL in Docker (shop)", which names the thing and the project it
 * belongs to. The image is run through the same signatures as a command line,
 * so `postgres:16` reads as PostgreSQL and inherits everything that goes with
 * being a database, including how carefully to treat it.
 */
export function annotate(entry: PortEntry, container: ContainerPort): PortEntry {
  const signature = matchSignatureEntry(`${imageName(container.image)} ${container.name}`);
  const what = signature?.label ?? imageName(container.image);
  const label = `${what} in Docker`;
  // A compose project called `docker` is Docker's own honest answer and still
  // tells nobody anything, so the container's name takes over when the project
  // would only repeat the label.
  const project =
    container.project && !redundantHint(container.project, label)
      ? container.project
      : container.name;

  const category = signature?.category ?? 'container';
  const annotated = {
    ...entry,
    label,
    source: 'docker' as const,
    category,
    hint: project,
    // The compose project is only mentioned when it survived the redundancy
    // check above; naming a project called `docker` helps nobody.
    summary:
      project === container.project
        ? `The container ${container.name}, from the ${container.project} compose project, running ${container.image}.`
        : `The container ${container.name}, running ${container.image}.`,
    // The compose form only makes sense when the project name survived the
    // redundancy check; `docker start` names the container and always does.
    restart:
      project === container.project
        ? `Bring it back with \`${['docker compose up -d', container.service].filter(Boolean).join(' ')}\`.`
        : `Bring it back with \`docker start ${container.name}\`.`,
    // Killing docker-proxy leaves the container running and the port
    // unpublished, which is a stranger state than either stopping or leaving
    // it. Saying so is worth more than a signal ever is.
    riskReason: `stop the container instead: \`docker stop ${container.name}\``,
    risk: 'caution' as const,
  };

  // The category may have changed - a `container` row that turned out to be
  // Adminer is a web page now - so whether a browser is the right thing to
  // point at it has to be decided again.
  return { ...annotated, url: browserUrl(annotated) };
}

/**
 * Name the containers behind published ports, when there is a local engine to
 * ask. Best effort and quick to give up: a machine with no Docker pays one
 * `existsSync` for this, and one that has it pays a request to a unix socket.
 */
export async function annotateContainers(
  entries: readonly PortEntry[],
  options: { timeoutMs?: number; candidates?: readonly string[] } = {},
): Promise<PortEntry[]> {
  const wanted = entries.some((entry) => entry.category === 'container');
  if (!wanted) return [...entries];

  // Every socket that might be there is tried in turn, not just the first that
  // exists: a stopped Docker Desktop leaves /var/run/docker.sock behind, and
  // giving up on it would hide a Colima engine that is running perfectly well.
  let index = new Map<number, ContainerPort>();
  for (const socketPath of plausibleSockets(options.candidates ?? socketCandidates())) {
    index = indexPorts(await listContainers(socketPath, options.timeoutMs ?? 500));
    if (index.size > 0) break;
  }
  if (index.size === 0) return [...entries];

  return entries.map((entry) => {
    // Only rows Docker was already credited with: a coincidence between a
    // published port and an unrelated process must not be dressed up as a
    // container.
    if (entry.category !== 'container') return entry;
    const container = index.get(entry.port);
    return container ? annotate(entry, container) : entry;
  });
}
