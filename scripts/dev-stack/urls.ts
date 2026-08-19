/**
 * urls — print where this worktree's running stack is reachable.
 *
 * `make dev` prints this once at startup and then hands the terminal to
 * overmind, so the address scrolls away. This reads it back out of live state
 * rather than remembering anything: the host and the vite port both come from
 * this stack's route in Caddy's admin API, so what it prints is what is actually
 * serving right now — including the ephemeral port a second worktree lands on.
 *
 * Only the web entry point is listed. The route also proxies /api, /graphql,
 * /api/mcp and /static, but those are not all independently reachable, and a
 * list that prints dead addresses is worse than a short one.
 *
 * Stacks from other worktrees share the same Caddy, so they are named too — as
 * bare URLs, since their ports belong to a checkout that isn't this one.
 */
import { CaddyClient, OAUTH_ROUTE_ID, routeId, type CaddyRoute } from './caddy';
import { keyFromArgv } from './key';
import { fail, info, link, note, ok, table } from './log';

const caddy = new CaddyClient();

// --- reading the caddy route ------------------------------------------------

type Handler = { handler?: string; upstreams?: { dial?: string }[] };
type SubRoute = { match?: unknown; handle?: Handler[] };

/** The proxied leg of a stack route: buildRoute() wraps every path rule in one
 * `subroute` handler, so that is where the upstreams live. */
function subRoutes(route: CaddyRoute): SubRoute[] {
  const handlers = (route.handle ?? []) as Handler[];
  const subroute = handlers.find((h) => h.handler === 'subroute') as { routes?: SubRoute[] } | undefined;

  return subroute?.routes ?? [];
}

/** Host port the vite dev server is on. Every path rule in the route carries a
 * matcher; the catch-all that falls through to vite is the one that doesn't. */
function webPort(route: CaddyRoute): number | undefined {
  const catchAll = subRoutes(route).find((sub) => sub.match === undefined);
  const proxy = (catchAll?.handle ?? []).find((h) => h.handler === 'reverse_proxy');
  const port = Number(proxy?.upstreams?.[0]?.dial?.split(':').pop());

  return Number.isFinite(port) && port > 0 ? port : undefined;
}

function hostOf(route: CaddyRoute): string | undefined {
  const match = route.match as { host?: string[] }[] | undefined;

  return match?.[0]?.host?.[0];
}

// --- rendering --------------------------------------------------------------

/** This stack's address, plus the direct one behind it for the times the proxy
 * hop is in the way (curling vite, attaching a debugger). */
function describe(key: string, route: CaddyRoute): void {
  const host = hostOf(route) ?? `${key}.localhost`;
  const base = `https://${host}`;
  const port = webPort(route);

  ok(`Stack \`${key}\` is up at ${link(base)}`);

  console.log('');

  table(['Service', 'URL', 'Direct'], [['web', link(base), port ? link(`http://localhost:${port}`) : '—']]);
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const key = keyFromArgv(process.argv.slice(2));

  console.log('');

  if (!(await caddy.reachable())) {
    fail('Caddy admin API not reachable on :2019. Start it with `brew services start caddy`.');

    console.log('');
    process.exit(1);
  }

  const routes = await caddy.routes();
  const mine = routes.find((r) => r['@id'] === routeId(key));

  if (mine) {
    describe(key, mine);
  } else {
    note(`No stack routed for \`${key}\`. Start it with \`make dev\`.`);
  }

  // Every worktree shares this Caddy, so name the neighbours — it explains a
  // port that looks taken, and saves guessing another worktree's hostname.
  const others = routes
    .filter((r) => typeof r['@id'] === 'string' && r['@id'] !== routeId(key))
    .filter((r) => (r['@id'] as string).startsWith('stack-'));

  if (others.length) {
    console.log('');

    info(`Other stacks routed on this Caddy (${others.length}):`);

    for (const route of others) {
      const host = hostOf(route) ?? `${(route['@id'] as string).replace(/^stack-/, '')}.localhost`;

      console.log(`     ${link(`https://${host}`)}`);
    }
  }

  const oauth = routes.find((r) => r['@id'] === OAUTH_ROUTE_ID);

  if (oauth) {
    const host = hostOf(oauth);
    const handlers = (oauth.handle ?? []) as { headers?: { Location?: string[] } }[];
    const target = handlers[0]?.headers?.Location?.[0]?.replace('{http.request.uri}', '') ?? '';

    console.log('');

    info(`OAuth host ${link(`https://${host}`)} redirects to ${target}`);
  }

  console.log('');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
