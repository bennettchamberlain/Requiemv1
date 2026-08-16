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
