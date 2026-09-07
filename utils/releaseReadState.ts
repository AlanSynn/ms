export const RELEASE_READ_KEY = 'motionsmith.releaseNotes.viewed.v1';
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;

const parseViewed = (raw: string | null): string[] => {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string =>
    typeof id === 'string' && id.length > 0 && id.length <= 120,
  );
};

/** Device preference only. Storage failures never reach project/history code. */
export const createReleaseReadState = (
  persistent: StorageAccess,
  session: StorageAccess,
) => {
  const memory = new Set<string>();
  const read = () => {
    for (const access of [persistent, session]) {
      try {
        parseViewed(access()?.getItem(RELEASE_READ_KEY) ?? null)
          .forEach(id => memory.add(id));
      } catch { /* Denied/corrupt storage falls back to session and memory. */ }
    }
    return new Set(memory);
  };
  const persist = () => {
    read();
    const encoded = JSON.stringify([...memory].sort());
    for (const access of [persistent, session]) {
      try {
        const storage = access();
        if (storage && storage.getItem(RELEASE_READ_KEY) !== encoded) storage.setItem(RELEASE_READ_KEY, encoded);
      }
      catch { /* Keep this session's memory even if both stores are denied. */ }
    }
    return read();
  };
  const markViewed = (id: string) => { memory.add(id); return persist(); };
  const merge = (raw: string | null) => {
    try { parseViewed(raw).forEach(id => memory.add(id)); } catch { /* Corrupt event. */ }
    return persist();
  };
  return { read, markViewed, merge };
};

export const releaseReadState = createReleaseReadState(
  () => typeof window === 'undefined' ? undefined : window.localStorage,
  () => typeof window === 'undefined' ? undefined : window.sessionStorage,
);
