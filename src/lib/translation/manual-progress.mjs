import { clearTimeout, setTimeout } from 'node:timers';

export const manualProgressKey = (id) => `tr:manual:progress:${id}`;

// Bounded, short-lived journal bridges the background worker and the HTTP SSE instance.
export async function createManualProgress(kv, id) {
  const key = manualProgressKey(id);
  let snapshot;
  try {
    snapshot = JSON.parse(await kv.kvGet(key));
  } catch {
    /* new journal */
  }
  let seq = snapshot?.seq || 0;
  let events = snapshot?.events || [];
  let size = JSON.stringify(events).length;
  let timer;
  let writes = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const raw = JSON.stringify({ seq, events });
    writes = writes
      .catch(() => {})
      .then(() => kv.kvSet(key, raw, { px: 3_600_000 }));
    return writes;
  };
  return {
    emit(event) {
      events.push({ seq: ++seq, event });
      size += JSON.stringify(event).length;
      if (events.length > 400 || size > 600_000) {
        events = events.slice(-150);
        size = JSON.stringify(events).length;
      }
      if (!timer)
        timer = setTimeout(() => {
          void flush().catch(() => {});
        }, 150);
    },
    flush,
  };
}
