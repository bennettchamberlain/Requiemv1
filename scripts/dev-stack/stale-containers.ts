/**
 * Preflight for `compose up`: drop containers that point at a network Docker no
 * longer has.
 *
 * A stopped container keeps the ID of the network it was created on, and
 * `compose up` starts existing containers rather than recreating them. If that
 * network has since been deleted, `up` recreates the network under a NEW id and
 * then fails to start every old container with
 * `failed to set up container networking: network <old id> not found`.
 *
 * The deletion is routine, not exotic: `docker network prune` — and anything
 * that calls the same API, such as the CI-Hub container at boot — removes every
 * network with no RUNNING container attached. A stack stopped by a clean
 * teardown is exactly that. Removing the stale containers costs nothing: they
 * are stateless, every persistent byte lives in a named volume that `docker rm`
 * does not touch, and `up` was about to recreate them anyway.
 */
import { spawnSync } from 'node:child_process';

export interface ContainerNetworks {
  id: string;
  name: string;
  /** Full network IDs from the container's endpoint config. */
  networkIds: string[];
}

/** Containers referencing at least one network that no longer exists. */
export function findStaleContainers(
  containers: ContainerNetworks[],
  liveNetworkIds: Iterable<string>,
): ContainerNetworks[] {
  const live = new Set(liveNetworkIds);

  return containers.filter((c) => c.networkIds.some((id) => !live.has(id)));
}

/** Parse `docker inspect --format '{{.Id}} {{.Name}} {{range ...}}{{.NetworkID}} {{end}}'` lines. */
export function parseInspectLines(output: string): ContainerNetworks[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, ...networkIds] = line.split(/\s+/);

      return { id, name: name.replace(/^\//, ''), networkIds: networkIds.filter(Boolean) };
    });
}

function docker(args: string[]): string {
  const res = spawnSync('docker', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`docker ${args.join(' ')} exited ${res.status}: ${(res.stderr ?? '').trim()}`);
  }

  return res.stdout;
}

/**
 * Remove this compose project's containers whose network is gone. Returns the
 * names removed so the caller can say what happened. Docker errors propagate:
 * if the daemon is unreachable, `compose up` is about to fail more usefully.
 */
export function removeStaleContainers(project: string): string[] {
  const ids = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  const containers = parseInspectLines(
    docker([
      'inspect',
      '--format',
      '{{.Id}} {{.Name}} {{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}',
      ...ids,
    ]),
  );
  const liveNetworks = docker(['network', 'ls', '-q', '--no-trunc'])
    .split('\n')
    .map((s) => s.trim());

  const stale = findStaleContainers(containers, liveNetworks);
  if (stale.length === 0) {
    return [];
  }

  docker(['rm', '-f', ...stale.map((c) => c.id)]);

  return stale.map((c) => c.name);
}
