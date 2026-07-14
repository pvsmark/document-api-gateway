const fs = require('fs/promises');
const { createHttpError } = require('./httpError');

async function freeBytes(targetPath, dependencies = {}) {
  const statfs = dependencies.statfs || fs.statfs;
  if (typeof statfs !== 'function') return null;
  const stat = await statfs(targetPath, { bigint: true });
  return stat.bavail * stat.bsize;
}

async function assertDiskReserve(targetPath, minimumBytes, dependencies = {}) {
  let available;
  try {
    available = await freeBytes(targetPath, dependencies);
  } catch (error) {
    throw createHttpError(503, 'Temporary storage is unavailable.', 'ZIP_TEMP_STORAGE_UNAVAILABLE');
  }
  if (available !== null && available < BigInt(minimumBytes)) {
    throw createHttpError(503, 'Temporary storage does not have enough free space.', 'ZIP_DISK_RESERVE_LOW');
  }
  return available;
}

module.exports = { assertDiskReserve, freeBytes };
