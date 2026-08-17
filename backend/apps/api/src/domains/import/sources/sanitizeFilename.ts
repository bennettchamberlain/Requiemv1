/**
 * Reduce an uploaded filename to something safe to use as a real filesystem
 * name under the uploads staging directory: no path separators (a `../` in
 * the name would otherwise escape the upload's own directory), no control
 * characters, and bounded length. The name is attacker-controlled text — a
 * browser sends whatever it likes as `originalname` — landing on a disk the
 * importer later moves and deletes from, so this is containment, not
 * cosmetics.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f]/g, '').replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = cleaned.replace(/^\.+/, '').slice(0, 180);

  return trimmed.length > 0 ? trimmed : 'upload.zip';
}

/**
 * A folder-upload relative path, kept as a tree under the drop directory.
 *
 * Each segment is run through {@link sanitizeFilename} so a `../` or a slash
 * inside one component cannot escape the drop. The result always has at least
 * two segments (a folder and a file) — a bare filename is wrapped in `export/`
 * so the staged source can be a real directory the unpack stage can move.
 */
export function sanitizeRelativePath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part.length > 0 && part !== '.');

  if (parts.some((part) => part === '..')) {
    throw new Error('path escapes the upload directory');
  }

  const cleaned = parts.map((part) => sanitizeFilename(part));

  if (cleaned.length === 0) {
    throw new Error('a relative path is required');
  }

  if (cleaned.length === 1) {
    cleaned.unshift('export');
  }

  return cleaned.join('/');
}
