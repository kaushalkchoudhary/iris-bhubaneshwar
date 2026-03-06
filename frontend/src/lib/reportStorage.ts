/**
 * Utility for storing and retrieving report PDF blobs in IndexedDB.
 * This is necessary because localStorage is too small for PDF data.
 */

const DB_NAME = 'iris_reports_db';
const DB_VERSION = 1;
const STORE_NAME = 'report_blobs';

export async function openReportsDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

export async function saveReportBlob(id: string, blob: Blob): Promise<void> {
    const db = await openReportsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(blob, id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

export async function getReportBlob(id: string): Promise<Blob | null> {
    const db = await openReportsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
    });
}

export async function deleteReportBlob(id: string): Promise<void> {
    const db = await openReportsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

export async function clearAllReportBlobs(): Promise<void> {
    const db = await openReportsDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}
