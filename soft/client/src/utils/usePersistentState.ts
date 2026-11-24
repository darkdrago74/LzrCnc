import { useEffect, useState } from 'react';

/** useState backed by localStorage (JSON). Falls back to `initial` when nothing / invalid data is stored. */
export function usePersistentState<T>(key: string, initial: T) {
    const [v, setV] = useState<T>(() => {
        try {
            const raw = localStorage.getItem(key);
            return raw !== null ? JSON.parse(raw) as T : initial;
        } catch { return initial; }
    });
    useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
    return [v, setV] as const;
}
