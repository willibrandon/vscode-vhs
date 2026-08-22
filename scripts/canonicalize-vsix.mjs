import { Buffer } from "node:buffer";

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectorySignature = 0x02014b50;
const localFileSignature = 0x04034b50;
const canonicalTime = 0;
const canonicalDate = 33;

export function canonicalizeVsix(value) {
  if (!Buffer.isBuffer(value)) throw new TypeError("VSIX input must be a Buffer.");
  const archive = Buffer.from(value);
  const end = findEndOfCentralDirectory(archive);
  const disk = archive.readUInt16LE(end + 4);
  const centralDisk = archive.readUInt16LE(end + 6);
  const diskEntries = archive.readUInt16LE(end + 8);
  const entries = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  const centralOffset = archive.readUInt32LE(end + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entries ||
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error("VSIX must be a single-disk, non-ZIP64 archive.");
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd !== end || centralEnd > archive.length) {
    throw new Error("VSIX central directory is malformed.");
  }

  const parsedEntries = [];
  let offset = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    assertSignature(archive, offset, centralDirectorySignature, "central directory");
    const filenameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const filenameStart = offset + 46;
    const next = filenameStart + filenameLength + extraLength + commentLength;
    if (next > centralEnd || filenameLength === 0) {
      throw new Error("VSIX central directory entry is malformed.");
    }
    assertSignature(archive, localOffset, localFileSignature, "local file");
    const localFilenameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    if (localOffset + 30 + localFilenameLength + localExtraLength > centralOffset) {
      throw new Error("VSIX local file entry is malformed.");
    }
    const filename = Buffer.from(archive.subarray(filenameStart, filenameStart + filenameLength));
    const localFilename = archive.subarray(
      localOffset + 30,
      localOffset + 30 + localFilenameLength,
    );
    if (!filename.equals(localFilename)) {
      throw new Error("VSIX local and central filenames do not match.");
    }
    const directory = archive[filenameStart + filenameLength - 1] === 0x2f;
    parsedEntries.push({
      centralRecord: Buffer.from(archive.subarray(offset, next)),
      directory,
      filename,
      localOffset,
    });
    offset = next;
  }
  if (offset !== centralEnd) throw new Error("VSIX central directory entry count is malformed.");

  const localOrder = [...parsedEntries].sort((left, right) => left.localOffset - right.localOffset);
  if (localOrder[0]?.localOffset !== 0) {
    throw new Error("VSIX must start with a local file entry.");
  }
  for (let index = 0; index < localOrder.length; index += 1) {
    const entry = localOrder[index];
    if (entry === undefined) throw new Error("VSIX local file entry is missing.");
    const localEnd = localOrder[index + 1]?.localOffset ?? centralOffset;
    if (localEnd <= entry.localOffset) {
      throw new Error("VSIX local file entries overlap.");
    }
    entry.localRecord = Buffer.from(archive.subarray(entry.localOffset, localEnd));
    entry.localRecord.writeUInt16LE(canonicalTime, 10);
    entry.localRecord.writeUInt16LE(canonicalDate, 12);
  }

  const canonicalEntries = [...parsedEntries].sort((left, right) =>
    Buffer.compare(left.filename, right.filename),
  );
  for (let index = 1; index < canonicalEntries.length; index += 1) {
    if (canonicalEntries[index - 1]?.filename.equals(canonicalEntries[index]?.filename)) {
      throw new Error("VSIX contains duplicate filenames.");
    }
  }

  const localRecords = [];
  let canonicalCentralOffset = 0;
  for (const entry of canonicalEntries) {
    if (entry.localRecord === undefined) throw new Error("VSIX local file entry is missing.");
    entry.canonicalLocalOffset = canonicalCentralOffset;
    localRecords.push(entry.localRecord);
    canonicalCentralOffset += entry.localRecord.length;
  }

  const centralRecords = canonicalEntries.map((entry) => {
    const record = entry.centralRecord;
    record.writeUInt16LE(canonicalTime, 12);
    record.writeUInt16LE(canonicalDate, 14);
    const unixMode = entry.directory ? 0o40755 : 0o100644;
    record.writeUInt32LE(((unixMode << 16) | (entry.directory ? 0x10 : 0)) >>> 0, 38);
    record.writeUInt32LE(entry.canonicalLocalOffset, 42);
    return record;
  });
  const canonicalCentralSize = centralRecords.reduce((size, record) => size + record.length, 0);
  const endRecord = Buffer.from(archive.subarray(end));
  endRecord.writeUInt32LE(canonicalCentralSize, 12);
  endRecord.writeUInt32LE(canonicalCentralOffset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, endRecord]);
}

function findEndOfCentralDirectory(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) !== endOfCentralDirectorySignature) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  throw new Error("VSIX end-of-central-directory record is missing.");
}

function assertSignature(archive, offset, expected, description) {
  if (offset < 0 || offset + 4 > archive.length || archive.readUInt32LE(offset) !== expected) {
    throw new Error("VSIX " + description + " signature is malformed.");
  }
}
