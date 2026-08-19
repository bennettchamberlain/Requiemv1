/**
 * key — the stack identity every dev-stack script agrees on.
 *
 * The key names the Caddy route (<key>.localhost), the compose project, and the
 * overmind tmux session. The Makefile passes it as --key PROJECT_NAME; falling
 * back to the environment and then to the git worktree layout keeps the scripts
 * runnable on their own (`yarn tsx scripts/dev-stack/urls.ts`).
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

export function sanitize(value: string): string {
  return value.toLowerCase().replace(/[/.]/g, '-');
}

/** Repo stem, plus a linked worktree's own directory name, mirroring the
 * Makefile's PROJECT_NAME derivation. */
function gitKey(): string {
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';
  const common = git('rev-parse', '--git-common-dir');
  const top = git('rev-parse', '--show-toplevel');

  if (!common || !top) {
    throw new Error('not a git worktree; pass --key to name the stack');
  }

  const repo = sanitize(path.basename(path.dirname(path.resolve(ROOT, common))));
  const worktree = sanitize(path.basename(top));

  return worktree === repo ? repo : `${repo}-${worktree}`;
}

export function resolveKey(explicit?: string): string {
  if (explicit) {
    return sanitize(explicit);
  }

  if (process.env.PROJECT_NAME) {
    return sanitize(process.env.PROJECT_NAME);
  }

  return gitKey();
}

/** Read `--key <name>` out of an argv slice. */
export function keyFromArgv(argv: string[]): string {
  const i = argv.indexOf('--key');

  return resolveKey(i !== -1 ? argv[i + 1] : undefined);
}
