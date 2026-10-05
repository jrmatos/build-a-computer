import { describe, expect, it } from 'vitest';
import { fileKeyFor } from './keys';
import { requestPersistentStorage } from './persistence';
import { hasFileSystemAccess, LocalFileProvider, StorageError, toStorageError, type FileHandleLike, type FilePickers } from './provider';

const domError = (name: string) => Object.assign(new Error(name), { name });

/** In-memory FileSystemFileHandle. */
function fakeHandle(name: string, initial = '') {
  const file = { text: initial, lastModified: 1, exists: true };
  let permission: PermissionState = 'granted';
  let failWrite: Error | null = null;
  const handle: FileHandleLike & {
    file: typeof file;
    setPermission(p: PermissionState): void;
    failNextWrite(e: Error): void;
    externalWrite(text: string): void;
  } = {
    name,
    file,
    setPermission: (p) => (permission = p),
    failNextWrite: (e) => (failWrite = e),
    externalWrite: (text) => {
      file.text = text;
      file.lastModified += 10;
    },
    getFile: async () => {
      if (!file.exists) throw domError('NotFoundError');
      return { text: async () => file.text, lastModified: file.lastModified };
    },
    createWritable: async () => {
      if (!file.exists) throw domError('NotFoundError');
      let buf = '';
      return {
        write: async (d: string) => {
          if (failWrite) {
            const e = failWrite;
            failWrite = null;
            throw e;
          }
          buf += d;
        },
        close: async () => {
          file.text = buf;
          file.lastModified += 1;
        },
        abort: async () => undefined,
      };
    },
    queryPermission: async () => permission,
    requestPermission: async () => {
      if (permission === 'prompt') permission = 'granted';
      return permission;
    },
  };
  return handle;
}

function pickers(handle: FileHandleLike | 'cancel'): FilePickers {
  const pick = async () => {
    if (handle === 'cancel') throw domError('AbortError');
    return handle;
  };
  return {
    showSaveFilePicker: pick,
    showOpenFilePicker: async () => [await pick()],
  };
}

describe('LocalFileProvider (File System Access API, with fakes)', () => {
  it('save picks a file, writes, and later saves go to the same file', async () => {
    const h = fakeHandle('mine.json');
    const p = new LocalFileProvider(pickers(h));
    expect(p.available()).toBe(true);
    await p.save('one', 'suggested.json');
    expect(p.connectedName()).toBe('mine.json');
    await p.save('two');
    expect(h.file.text).toBe('two');
  });

  it('open reads the file and connects it', async () => {
    const h = fakeHandle('w.json', '{"a":1}');
    const p = new LocalFileProvider(pickers(h));
    expect(await p.open()).toEqual({ name: 'w.json', text: '{"a":1}' });
    expect(p.connectedName()).toBe('w.json');
  });

  it('a closed picker is "cancelled", not an error', async () => {
    const p = new LocalFileProvider(pickers('cancel'));
    expect(await p.open()).toBeNull();
    expect(await p.pickSave('x.json')).toBeNull();
    await expect(p.save('x')).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('E-PLAT-02: a deleted or moved file is reported as not-found', async () => {
    const h = fakeHandle('w.json');
    const p = new LocalFileProvider(pickers(h));
    await p.save('one', 'w.json');
    h.file.exists = false;
    await expect(p.write('two')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('E-PLAT-02: revoked permission is reported and can be asked again', async () => {
    const h = fakeHandle('w.json');
    const p = new LocalFileProvider(pickers(h));
    await p.save('one', 'w.json');
    h.setPermission('prompt');
    await expect(p.write('two')).rejects.toMatchObject({ code: 'permission' });
    expect(await LocalFileProvider.permission(h, true)).toBe('granted');
    await p.write('two');
    expect(h.file.text).toBe('two');
  });

  it('E-PLAT-02: a file changed by someone else is never overwritten', async () => {
    const h = fakeHandle('w.json');
    const p = new LocalFileProvider(pickers(h));
    await p.save('mine', 'w.json');
    h.externalWrite('theirs');
    await expect(p.write('mine again')).rejects.toMatchObject({ code: 'changed' });
    expect(h.file.text).toBe('theirs');
  });

  it('E-PLAT-02: a failed write keeps the old contents', async () => {
    const h = fakeHandle('w.json');
    const p = new LocalFileProvider(pickers(h));
    await p.save('good', 'w.json');
    h.failNextWrite(domError('QuotaExceededError'));
    await expect(p.write('bad')).rejects.toMatchObject({ code: 'write-failed' });
    expect(h.file.text).toBe('good');
  });
});

describe('E-PLAT-03 no File System Access API', () => {
  it('E-PLAT-03: detected as unavailable so the app falls back to download/upload', () => {
    expect(hasFileSystemAccess({})).toBe(false);
    expect(new LocalFileProvider({}).available()).toBe(false);
  });
  it('E-PLAT-03: pickers refuse with "unsupported"', async () => {
    await expect(new LocalFileProvider({}).pickOpen()).rejects.toBeInstanceOf(StorageError);
  });
});

describe('error mapping', () => {
  it('maps DOMException names to codes', () => {
    expect(toStorageError(domError('AbortError')).code).toBe('cancelled');
    expect(toStorageError(domError('NotAllowedError')).code).toBe('permission');
    expect(toStorageError(domError('NotFoundError')).code).toBe('not-found');
    expect(toStorageError(new Error('boom')).code).toBe('write-failed');
  });
});

describe('E-PLAT-04 persistent storage', () => {
  it('E-PLAT-04: asks the browser to persist storage when it can', async () => {
    let asked = 0;
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => (asked++, true) })).toBe('granted');
    expect(asked).toBe(1);
  });
  it('E-PLAT-04: already persisted does not ask again', async () => {
    let asked = 0;
    expect(await requestPersistentStorage({ persisted: async () => true, persist: async () => (asked++, true) })).toBe('granted');
    expect(asked).toBe(0);
  });
  it('E-PLAT-04: denied or unsupported is reported (the status shows an export reminder)', async () => {
    expect(await requestPersistentStorage({ persist: async () => false })).toBe('denied');
    expect(await requestPersistentStorage({ persist: () => Promise.reject(new Error('x')) })).toBe('denied');
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(await requestPersistentStorage({})).toBe('unsupported');
  });
});

describe('file shortcuts', () => {
  const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    fileKeyFor({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it('Ctrl/Cmd+S saves, Shift saves as, Ctrl/Cmd+O opens', () => {
    expect(k('s', { ctrlKey: true })).toBe('save');
    expect(k('S', { metaKey: true, shiftKey: true })).toBe('saveAs');
    expect(k('o', { ctrlKey: true })).toBe('open');
  });
  it('ignores plain keys and Alt combos', () => {
    expect(k('s')).toBeNull();
    expect(k('s', { ctrlKey: true, altKey: true })).toBeNull();
    expect(k('o', { ctrlKey: true, shiftKey: true })).toBeNull();
  });
});
