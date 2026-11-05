import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

const files = new Map();
const directories = new Set(['file:///documents']);

class FakeDirectory {
  constructor(parent, name) {
    const base = parent instanceof FakeDirectory ? parent.uri : String(parent);
    this.uri = base.replace(/\/$/, '') + '/' + name;
    this.name = this.uri.split('/').pop();
  }
  get exists() {
    return directories.has(this.uri);
  }
  create() {
    directories.add(this.uri);
  }
  list() {
    const prefix = this.uri.replace(/\/$/, '') + '/';
    const result = [];
    for (const uri of files.keys()) {
      if (!uri.startsWith(prefix)) continue;
      const tail = uri.slice(prefix.length);
      if (tail && !tail.includes('/')) result.push(new FakeFile(uri));
    }
    for (const uri of directories) {
      if (!uri.startsWith(prefix)) continue;
      const tail = uri.slice(prefix.length);
      if (tail && !tail.includes('/')) result.push(new FakeDirectory(uri.split('/').slice(0, -1).join('/'), tail));
    }
    return result;
  }
  delete() {
    const prefix = this.uri.replace(/\/$/, '') + '/';
    for (const uri of [...files.keys()]) if (uri.startsWith(prefix)) files.delete(uri);
    for (const uri of [...directories]) if (uri === this.uri || uri.startsWith(prefix)) directories.delete(uri);
  }
}

class FakeFile {
  constructor(parent, name) {
    this.uri = name === undefined
      ? String(parent)
      : (parent instanceof FakeDirectory ? parent.uri : String(parent)).replace(/\/$/, '') + '/' + name;
    this.name = this.uri.split('/').pop();
  }
  get exists() {
    return files.has(this.uri);
  }
  get size() {
    const value = files.get(this.uri);
    return value?.size ?? value?.content?.length ?? 0;
  }
  create() {
    if (!files.has(this.uri)) files.set(this.uri, { content: '' });
  }
  async copy(destination) {
    const source = files.get(this.uri);
    if (!source) throw new Error('source missing');
    files.set(destination.uri, { ...source });
  }
  async write(content) {
    files.set(this.uri, { content: String(content), size: String(content).length });
  }
  async text() {
    const value = files.get(this.uri);
    if (!value) throw new Error('file missing');
    return String(value.content);
  }
  delete() {
    files.delete(this.uri);
  }
}

mock.module('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { document: new FakeDirectory('file:///documents', 'root') },
}));

const {
  bindPendingMediaRecoveryToDraft,
  deletePendingMediaRecovery,
  deletePendingMediaRecoveryForDraft,
  listPendingMediaRecovery,
  persistPendingMediaRecovery,
} = await import('../lib/publish-pending-media-recovery.ts');

const asset = {
  localId: 'media-local-1',
  uri: 'content://picker/photo-1',
  filename: 'photo.png',
  mimeType: 'image/png',
  size: 3,
  width: 20,
  height: 20,
  uploadKey: 'same-idempotency-key',
  altText: 'A test photo',
};

beforeEach(() => {
  files.clear();
  directories.clear();
  directories.add('file:///documents');
  directories.add('file:///documents/root');
  files.set(asset.uri, { content: 'abc', size: 3 });
});

afterEach(() => {
  files.clear();
});

test('copies a pending media file to persistent app storage before upload and restores its stable URI', async () => {
  const stored = await persistPendingMediaRecovery('user-1', null, asset);

  expect(stored.uri).toContain('luckread-pending-publish-media');
  expect(stored.uri).toContain('media-local-1.png');
  expect(stored.uri).not.toBe(asset.uri);

  const restored = await listPendingMediaRecovery('user-1', null);
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({
    localId: asset.localId,
    uri: stored.uri,
    uploadKey: asset.uploadKey,
    filename: asset.filename,
    mimeType: asset.mimeType,
    draftId: null,
  });
  expect(files.get(stored.uri)?.content).toBe('abc');
});

test('recovery records are isolated by account and by server draft', async () => {
  await persistPendingMediaRecovery('user-1', null, asset);

  expect(await listPendingMediaRecovery('user-2', null)).toHaveLength(0);
  expect(await listPendingMediaRecovery('user-1', 'draft-1')).toHaveLength(0);

  await bindPendingMediaRecoveryToDraft('user-1', 'draft-1', [asset.localId]);

  expect(await listPendingMediaRecovery('user-1', null)).toHaveLength(0);
  expect(await listPendingMediaRecovery('user-1', 'draft-1')).toHaveLength(1);
});

test('removing an attachment deletes only that recovery record and its local file', async () => {
  const stored = await persistPendingMediaRecovery('user-1', null, asset);

  await deletePendingMediaRecovery('user-1', asset.localId);

  expect(files.has(stored.uri)).toBe(false);
  expect(await listPendingMediaRecovery('user-1', null)).toHaveLength(0);
});

test('deleting a server draft removes all of its locally recovered attachments', async () => {
  const second = {
    ...asset,
    localId: 'media-local-2',
    uri: 'content://picker/photo-2',
    filename: 'other.png',
    uploadKey: 'second-upload-key',
  };
  files.set(second.uri, { content: 'xyz', size: 3 });
  await persistPendingMediaRecovery('user-1', 'draft-9', asset);
  await persistPendingMediaRecovery('user-1', 'draft-9', second);

  await deletePendingMediaRecoveryForDraft('user-1', 'draft-9');

  expect(await listPendingMediaRecovery('user-1', 'draft-9')).toHaveLength(0);
});
