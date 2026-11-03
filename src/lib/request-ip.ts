/* eslint-disable no-console */
import { db } from './db';
import { resolveIpLocation } from './ip-location';
import { recordUserIp } from './user-ip-history';

export async function captureRequestIp(
  username: string,
  request: { headers: Headers },
) {
  const now = Date.now();
  const location = await resolveIpLocation(request.headers);
  try {
    await recordUserIp(db, username, location, now);
  } catch (error) {
    console.error('记录用户 IP 历史失败', error);
  }
  return location;
}
