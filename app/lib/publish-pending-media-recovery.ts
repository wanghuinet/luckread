import { Directory, File, Paths } from 'expo-file-system';

export type PendingMediaRecoveryAsset = {
  localId: string;
  uri: string;
  filename: string;
  mimeType: string;
  size?: number | null;
  width?: number;
  height?: number;
  uploadKey: string;
  altText?: string;
};

export type RecoveredPendingMediaAsset = PendingMediaRecoveryAsset & {
  draftId: string | null;
  uploadedUrl?: string;
};

type PendingMediaRecoveryRecord = {
  version: 2;
  ownerId: string;
  ownerKey: string;
  draftId: string | null;
  fileName: string;
  uploadedUrl?: string;
  asset: Omit<PendingMediaRecoveryAsset, 'uri'>;
};

const RECOVERY_DIRECTORY_NAME = 'luckread-pending-publish-media';

function hashOwnerId(ownerId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash = Math.imul(hash ^ ownerId.charCodeAt(index), 0x01000193);
  }
  return 'owner-' + (hash >>> 0).toString(16).padStart(8, '0');
}

function safeLocalId(localId: string): string {
  const normalized = localId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!normalized || normalized.length > 128) {
    throw new Error('Invalid local media recovery identifier.');
  }
  return normalized;
}

function getFileExtension(filename: string, mimeType: string): string {
  const extension = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
  if (extension) return extension;
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return known[mimeType.toLowerCase()] || 'bin';
}

function getRecoveryDirectory(ownerId: string): Directory {
  return new Directory(
    new Directory(Paths.document, RECOVERY_DIRECTORY_NAME),
    hashOwnerId(ownerId),
  );
}

function getRecordFile(directory: Directory, localId: string): File {
  return new File(directory, safeLocalId(localId) + '.json');
}

const recordMutationQueues = new Map<string, Promise<void>>();

/** Serialize read/modify/write operations for one account-owned media record. */
async function withRecordMutationLock<T>(
  ownerId: string,
  localId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockKey = hashOwnerId(ownerId) + ':' + safeLocalId(localId);
  const previous = recordMutationQueues.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  recordMutationQueues.set(lockKey, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (recordMutationQueues.get(lockKey) === tail) recordMutationQueues.delete(lockKey);
  }
}

function parseRecoveryRecord(value: unknown): PendingMediaRecoveryRecord | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Partial<PendingMediaRecoveryRecord>;
  const asset = record.asset as Partial<PendingMediaRecoveryAsset> | undefined;
  if (
    record.version !== 2 ||
    typeof record.ownerId !== 'string' ||
    !record.ownerId ||
    typeof record.ownerKey !== 'string' ||
    typeof record.fileName !== 'string' ||
    !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,10}$/.test(record.fileName) ||
    (record.draftId !== null && typeof record.draftId !== 'string') ||
    !asset ||
    typeof asset.localId !== 'string' ||
    typeof asset.filename !== 'string' ||
    typeof asset.mimeType !== 'string' ||
    typeof asset.uploadKey !== 'string' ||
    (record.uploadedUrl !== undefined && (typeof record.uploadedUrl !== 'string' || !/^https:\/\//i.test(record.uploadedUrl))) ||
    !asset.localId ||
    !asset.filename ||
    !asset.mimeType ||
    !asset.uploadKey
  ) {
    return null;
  }
  return record as PendingMediaRecoveryRecord;
}

async function ensureDirectory(directory: Directory): Promise<void> {
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
}

async function readRecords(ownerId: string): Promise<{
  directory: Directory;
  records: Array<{ file: File; record: PendingMediaRecoveryRecord }>;
}> {
  const directory = getRecoveryDirectory(ownerId);
  if (!directory.exists) return { directory, records: [] };

  const records: Array<{ file: File; record: PendingMediaRecoveryRecord }> = [];
  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
    try {
      const record = parseRecoveryRecord(await entry.text());
      if (!record) {
        entry.delete();
        continue;
      }
      // Hashes select a compact directory only; the exact account ID is the
      // ownership check. Never delete another account's valid record if two
      // IDs happen to share the same directory hash.
      if (record.ownerId === ownerId && record.ownerKey === hashOwnerId(ownerId)) {
        records.push({ file: entry, record });
      }
    } catch {
      entry.delete();
    }
  }
  return { directory, records };
}

async function writeRecord(
  directory: Directory,
  record: PendingMediaRecoveryRecord,
): Promise<void> {
  const recordFile = getRecordFile(directory, record.asset.localId);
  if (!recordFile.exists) recordFile.create({ intermediates: true });
  await recordFile.write(JSON.stringify(record));
}

/**
 * Copies a selected asset into the app's persistent Documents sandbox before
 * upload starts. The stable URI and the original upload key are retained so a
 * retry after process termination replays the same W01 idempotent operation.
 */
export async function persistPendingMediaRecovery(
  ownerId: string,
  draftId: string | null,
  asset: PendingMediaRecoveryAsset,
): Promise<PendingMediaRecoveryAsset> {
  if (!ownerId.trim() || !asset.uri || !asset.filename || !asset.mimeType || !asset.uploadKey) {
    throw new Error('The selected media is missing information required for local recovery.');
  }

  const localId = safeLocalId(asset.localId);
  return withRecordMutationLock(ownerId, localId, async () => {
    const directory = getRecoveryDirectory(ownerId);
    await ensureDirectory(directory);

    const fileName = localId + '.' + getFileExtension(asset.filename, asset.mimeType);
    const destination = new File(directory, fileName);
    const recordFile = getRecordFile(directory, localId);
    let previousFileName: string | null = null;
    if (recordFile.exists) {
      try {
        const previous = parseRecoveryRecord(await recordFile.text());
        if (previous && previous.ownerId !== ownerId) {
          throw new Error('Unable to safely isolate this media recovery record for the current account.');
        }
        if (previous?.ownerId === ownerId && previous.ownerKey === hashOwnerId(ownerId)) {
          previousFileName = previous.fileName;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unable to safely isolate')) throw error;
        previousFileName = null;
      }
    }
    const source = new File(asset.uri);
    if (!source.exists) {
      throw new Error('The selected media file is no longer available on this device.');
    }

    if (source.uri !== destination.uri) {
      if (destination.exists) destination.delete();
      await source.copy(destination);
    }
    if (!destination.exists) {
      throw new Error('LuckRead could not preserve this media file for recovery.');
    }

    const recoveredAsset: PendingMediaRecoveryAsset = {
      ...asset,
      localId,
      uri: destination.uri,
    };
    const record: PendingMediaRecoveryRecord = {
      version: 2,
      ownerId,
      ownerKey: hashOwnerId(ownerId),
      draftId,
      fileName,
      asset: {
        localId,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size ?? null,
        width: asset.width,
        height: asset.height,
        uploadKey: asset.uploadKey,
        altText: asset.altText,
      },
    };
    await writeRecord(directory, record);
    if (previousFileName && previousFileName !== fileName) {
      const previousFile = new File(directory, previousFileName);
      if (previousFile.exists) previousFile.delete();
    }
    return recoveredAsset;
  });
}

export async function markPendingMediaRecoveryUploaded(
  ownerId: string,
  localId: string,
  uploadedUrl: string,
): Promise<void> {
  if (!/^https:\/\//i.test(uploadedUrl)) {
    throw new Error('A permanent HTTPS media URL is required for recovery metadata.');
  }
  return withRecordMutationLock(ownerId, localId, async () => {
    const directory = getRecoveryDirectory(ownerId);
    if (!directory.exists) return;
    const recordFile = getRecordFile(directory, localId);
    if (!recordFile.exists) return;
    const record = parseRecoveryRecord(await recordFile.text());
    if (!record || record.ownerId !== ownerId || record.ownerKey !== hashOwnerId(ownerId)) return;
    await writeRecord(directory, { ...record, uploadedUrl });
  });
}

export async function listPendingMediaRecovery(
  ownerId: string,
  draftId: string | null,
): Promise<RecoveredPendingMediaAsset[]> {
  const { directory, records } = await readRecords(ownerId);
  const recovered: RecoveredPendingMediaAsset[] = [];
  for (const { file, record } of records) {
    if (record.draftId !== draftId) continue;
    const localFile = new File(directory, record.fileName);
    if (!localFile.exists) {
      file.delete();
      continue;
    }
    recovered.push({
      ...record.asset,
      uri: localFile.uri,
      draftId: record.draftId,
      uploadedUrl: record.uploadedUrl,
    });
  }
  return recovered.sort((left, right) => left.localId.localeCompare(right.localId));
}

export async function bindPendingMediaRecoveryToDraft(
  ownerId: string,
  draftId: string,
  localIds: readonly string[],
): Promise<void> {
  if (!draftId.trim() || localIds.length === 0) return;
  const directory = getRecoveryDirectory(ownerId);
  const wanted = new Set(localIds.map(safeLocalId));
  for (const localId of wanted) {
    await withRecordMutationLock(ownerId, localId, async () => {
      if (!directory.exists) return;
      const recordFile = getRecordFile(directory, localId);
      if (!recordFile.exists) return;
      const record = parseRecoveryRecord(await recordFile.text());
      if (!record || record.ownerId !== ownerId || record.ownerKey !== hashOwnerId(ownerId)) return;
      await writeRecord(directory, { ...record, draftId });
    });
  }
}

/** Delete only the current user's recovery file and its metadata record. */
export async function deletePendingMediaRecovery(
  ownerId: string,
  localId: string,
): Promise<void> {
  return withRecordMutationLock(ownerId, localId, async () => {
    const directory = getRecoveryDirectory(ownerId);
    if (!directory.exists) return;
    const safeId = safeLocalId(localId);
    const recordFile = getRecordFile(directory, safeId);
    if (!recordFile.exists) return;

    let fileName = '';
    try {
      const record = parseRecoveryRecord(await recordFile.text());
      if (record?.ownerId === ownerId && record.ownerKey === hashOwnerId(ownerId)) {
        fileName = record.fileName;
      } else if (record) {
        // Do not delete a different account's record in the unlikely event
        // of a directory-hash collision.
        return;
      }
    } catch {
      // A malformed index is removed below; it cannot authorize another path.
    }
    recordFile.delete();
    if (fileName) {
      const mediaFile = new File(directory, fileName);
      if (mediaFile.exists) mediaFile.delete();
    }
  });
}

export async function deletePendingMediaRecoveryForDraft(
  ownerId: string,
  draftId: string,
): Promise<void> {
  const { records } = await readRecords(ownerId);
  for (const { record } of records) {
    if (record.draftId === draftId) {
      await deletePendingMediaRecovery(ownerId, record.asset.localId);
    }
  }
}
