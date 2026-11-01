/**
 * `tsconfig.json` is shared with the Expo client, so its `lib` includes `DOM`;
 * that makes the ambient `setInterval`/`setTimeout` resolve to the browser
 * overload (returns `number`), not Node's (`NodeJS.Timeout`, which has
 * `.unref()`). Background dispatchers import these instead of the globals so
 * they get the real Node return type without casting at every call site.
 */
import * as nodeTimers from 'node:timers';

type NodeSetInterval = (callback: () => void, ms?: number) => NodeJS.Timeout;
type NodeSetTimeout = (callback: () => void, ms?: number) => NodeJS.Timeout;

export const setInterval = nodeTimers.setInterval as unknown as NodeSetInterval;
export const setTimeout = nodeTimers.setTimeout as unknown as NodeSetTimeout;
