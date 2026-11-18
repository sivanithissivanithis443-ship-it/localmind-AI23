import { AppSettings, Conversation } from '../types';

const DB_NAME = 'localmind_db';
const DB_VERSION = 1;
const STORE_CONVERSATIONS = 'conversations';
const STORE_SETTINGS = 'settings';
const SETTINGS_KEY = 'app_settings_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'auto',
  explanationDepth: 'standard',
  speechLang: 'en-US',
  autoSpeak: false,
  ttsMuted: false,
  ttsRate: 1.0,
  theme: 'dark',
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        const store = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

export class ChatStorage {
  static async getAllConversations(): Promise<Conversation[]> {
    try {
      const db = await openDB();
      return await new Promise<Conversation[]>((resolve, reject) => {
        const tx = db.transaction(STORE_CONVERSATIONS, 'readonly');
        const store = tx.objectStore(STORE_CONVERSATIONS);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = (req.result as Conversation[]) || [];
          items.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  static async saveConversation(conv: Conversation): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
      const store = tx.objectStore(STORE_CONVERSATIONS);
      store.put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  static async deleteConversation(id: string): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
      const store = tx.objectStore(STORE_CONVERSATIONS);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  static async clearAllConversations(): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CONVERSATIONS, 'readwrite');
      const store = tx.objectStore(STORE_CONVERSATIONS);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  static async getSettings(): Promise<AppSettings> {
    try {
      const db = await openDB();
      const stored = await new Promise<AppSettings | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readonly');
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.get(SETTINGS_KEY);
        req.onsuccess = () => resolve(req.result as AppSettings | undefined);
        req.onerror = () => reject(req.error);
      });
      return { ...DEFAULT_SETTINGS, ...(stored || {}) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  static async saveSettings(settings: AppSettings): Promise<void> {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        const store = tx.objectStore(STORE_SETTINGS);
        store.put(settings, SETTINGS_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore storage errors
    }
  }

  static deriveTitle(firstMessageText: string): string {
    const cleaned = firstMessageText.replace(/\s+/g, ' ').trim();
    if (!cleaned) return 'Image Analysis';
    return cleaned.length > 42 ? `${cleaned.slice(0, 42)}...` : cleaned;
  }
}
