import { createWebOnnxCacheStatus, type WebOnnxCacheStatus } from "./webOnnxProtocol";

let status = createWebOnnxCacheStatus("checking", 0);
const listeners = new Set<() => void>();

export type StatusUpdater =
  | WebOnnxCacheStatus
  | ((previous: WebOnnxCacheStatus) => WebOnnxCacheStatus);

export const getWebOnnxCacheStatus = () => status;

export const subscribeWebOnnxCacheStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setWebOnnxCacheStatus = (update: StatusUpdater) => {
  status = typeof update === "function" ? update(status) : update;
  listeners.forEach((listener) => listener());
};
