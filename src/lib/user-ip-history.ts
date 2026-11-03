import type { IpLocation, UserIpEntry } from './ip-location.types';
import type { IStorage } from './types';

type Store = Pick<IStorage, 'kvGet' | 'kvMGet' | 'kvCompareAndSet'>;
export const USER_IP_HISTORY_LIMIT = 5000;
const key = (username: string) => `audit:ip:${username}`;

function signature(location: IpLocation): string {
  return JSON.stringify([
    location.ip,
    location.country,
    location.region,
    location.city,
    location.isp,
    location.asn || null,
    location.organization || '',
  ]);
}

export async function recordUserIp(
  store: Store,
  username: string,
  location: IpLocation,
  now = Date.now(),
): Promise<void> {
  if (!location.ip) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = await store.kvGet(key(username));
    const history: UserIpEntry[] = raw ? JSON.parse(raw) : [];
    const latest = history[0];
    // 不让延迟完成的旧请求覆盖新请求的最近地址。
    if (latest && now < latest.lastSeen) return;
    if (latest && signature(latest) === signature(location)) {
      latest.lastSeen = now;
    } else {
      history.unshift({ ...location, firstSeen: now, lastSeen: now });
    }
    if (
      await store.kvCompareAndSet(
        key(username),
        raw,
        JSON.stringify(history.slice(0, USER_IP_HISTORY_LIMIT)),
      )
    )
      return;
  }
  throw new Error('用户 IP 历史并发更新失败');
}

export async function getUserIpHistory(
  store: Store,
  username: string,
  offset = 0,
  limit = 50,
) {
  const raw = await store.kvGet(key(username));
  const history: UserIpEntry[] = raw ? JSON.parse(raw) : [];
  return {
    total: history.length,
    items: history.slice(offset, offset + limit),
  };
}

export async function getLatestUserIps(
  store: Store,
  usernames: string[],
): Promise<Record<string, UserIpEntry | null>> {
  if (!usernames.length) return {};
  const values = await store.kvMGet(usernames.map(key));
  return Object.fromEntries(
    usernames.map((username, index) => [
      username,
      values[index] ? JSON.parse(values[index] || '[]')[0] || null : null,
    ]),
  );
}
