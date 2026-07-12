// IndexedDB wrapper — documents library + key/value store
const DB_NAME = 'upsc-companion';
const DB_VER = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export const DB = {
  // study notes only (documents without a kind, or kind:'notes')
  async allDocs() {
    const db = await openDB();
    const docs = await req(db.transaction('docs').objectStore('docs').getAll());
    return docs.filter(d => d.kind !== 'model').sort((a, b) => a.title.localeCompare(b.title));
  },
  // model-answer documents (kind:'model') — used by the Answer drill
  async allModelDocs() {
    const db = await openDB();
    const docs = await req(db.transaction('docs').objectStore('docs').getAll());
    return docs.filter(d => d.kind === 'model').sort((a, b) => a.title.localeCompare(b.title));
  },
  async getDoc(id) {
    const db = await openDB();
    return req(db.transaction('docs').objectStore('docs').get(id));
  },
  async putDoc(doc) {
    const db = await openDB();
    doc.updatedAt = Date.now();
    return req(db.transaction('docs', 'readwrite').objectStore('docs').put(doc));
  },
  async delDoc(id) {
    const db = await openDB();
    return req(db.transaction('docs', 'readwrite').objectStore('docs').delete(id));
  },
  async getKV(key, fallback = null) {
    const db = await openDB();
    const v = await req(db.transaction('kv').objectStore('kv').get(key));
    return v === undefined ? fallback : v;
  },
  async setKV(key, val) {
    const db = await openDB();
    return req(db.transaction('kv', 'readwrite').objectStore('kv').put(val, key));
  },
};

export function uid() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
