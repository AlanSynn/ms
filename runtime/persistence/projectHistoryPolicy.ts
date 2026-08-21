export const PROJECT_HISTORY_LIMIT = 40;
export const PROJECT_HISTORY_BYTE_BUDGET = 8 * 1024 * 1024;

export type ProjectHistoryEntry<T> = {
  project: T;
  retainedBytes: number;
};

const STRING_OVERHEAD_BYTES = 16;
const OBJECT_OVERHEAD_BYTES = 32;
const ARRAY_OVERHEAD_BYTES = 24;

/**
 * Estimate only data retained by the older state that is not shared with its
 * successor. Project actions preserve unchanged object identities, so this
 * stays proportional to the edited branch instead of serializing the whole
 * ProjectState on every pointer edit.
 */
export const estimateExclusiveHistoryBytes = (
  older: unknown,
  successor: unknown,
  stopAfterBytes = PROJECT_HISTORY_BYTE_BUDGET,
) => {
  let bytes = 0;
  const visited = new WeakSet<object>();
  const add = (amount: number) => {
    bytes = Math.min(stopAfterBytes + 1, bytes + amount);
  };
  const visit = (value: unknown, nextValue: unknown): void => {
    if (bytes > stopAfterBytes || Object.is(value, nextValue)) return;
    if (typeof value === "string") {
      add(STRING_OVERHEAD_BYTES + value.length * 2);
      return;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      add(8);
      return;
    }
    if (typeof value === "boolean") {
      add(4);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      add(ARRAY_OVERHEAD_BYTES + value.length * 8);
      const next = Array.isArray(nextValue) ? nextValue : [];
      for (let index = 0; index < value.length; index += 1) {
        visit(value[index], next[index]);
        if (bytes > stopAfterBytes) return;
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const next = nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
      ? nextValue as Record<string, unknown>
      : {};
    const keys = Object.keys(record);
    add(OBJECT_OVERHEAD_BYTES + keys.length * 16);
    for (const key of keys) {
      visit(record[key], next[key]);
      if (bytes > stopAfterBytes) return;
    }
  };

  visit(older, successor);
  return bytes;
};

export const createProjectHistoryEntry = <T>(
  project: T,
  successor: T,
): ProjectHistoryEntry<T> => ({
  project,
  retainedBytes: estimateExclusiveHistoryBytes(project, successor),
});

export const boundProjectHistory = <T>(
  past: ProjectHistoryEntry<T>[],
  future: ProjectHistoryEntry<T>[],
  prefer: "past" | "future",
) => {
  let retainedBytes = [...past, ...future].reduce(
    (total, entry) => total + entry.retainedBytes,
    0,
  );
  const overBudget = () =>
    past.length + future.length > PROJECT_HISTORY_LIMIT ||
    retainedBytes > PROJECT_HISTORY_BYTE_BUDGET;

  while (overBudget()) {
    const discard = prefer === "past"
      ? future.pop() ?? past.shift()
      : past.shift() ?? future.pop();
    if (!discard) break;
    retainedBytes -= discard.retainedBytes;
  }

  return { past, future, retainedBytes };
};
