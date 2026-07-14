const fs = require('fs/promises');
const path = require('path');

const MANAGED_PREFIXES = ['pvs-doc-', 'pvs-archive-', 'pvs-report-'];

async function ensureTempRoot(tempRoot) {
  await fs.mkdir(tempRoot, { recursive: true });
  const stat = await fs.stat(tempRoot);
  if (!stat.isDirectory()) throw new Error('Temporary path is not a directory.');
}

async function cleanupManagedTempEntries(tempRoot, options = {}) {
  const maxAgeMs = options.maxAgeMs || 0;
  let entries = [];
  try {
    entries = await fs.readdir(tempRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: 0 };
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!MANAGED_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
    const target = path.join(tempRoot, entry.name);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) continue;
    if (maxAgeMs > 0 && Date.now() - stat.mtimeMs < maxAgeMs) continue;
    await fs.rm(target, { recursive: true, force: true });
    removed += 1;
  }
  return { removed };
}

async function assertDirectoryReadable(directory) {
  await fs.access(directory);
  const stat = await fs.stat(directory);
  if (!stat.isDirectory()) throw new Error('Configured path is not a directory.');
}

async function assertDirectoryWritable(directory) {
  await ensureTempRoot(directory);
  const probe = path.join(directory, `.pvs-health-${process.pid}-${Date.now()}`);
  await fs.writeFile(probe, 'ok', { flag: 'wx' });
  await fs.rm(probe, { force: true });
}

module.exports = {
  MANAGED_PREFIXES,
  ensureTempRoot,
  cleanupManagedTempEntries,
  assertDirectoryReadable,
  assertDirectoryWritable,
};
