/* eslint-disable no-console */
import { AsnResponse, CityResponse, open, Reader } from 'maxmind';
import { isIP } from 'node:net';
import path from 'node:path';

import type { IpLocation } from './ip-location.types';

export function normalizeIp(input: string): string {
  let value = input.trim();
  if (value.startsWith('['))
    value = value.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1');
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.split(':')[0];
  if (!isIP(value)) return '';
  if (isIP(value) === 6) {
    value = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = value.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
    if (mapped) {
      const high = parseInt(mapped[1], 16),
        low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
  }
  return value;
}

// 反向代理必须覆盖此头；多层代理可显式设置可信跳数，从右向左取客户端地址。
export function getClientIp(headers: Headers): string {
  const header = process.env.CLIENT_IP_HEADER || 'x-forwarded-for';
  const value =
    headers.get(header) ||
    (header === 'x-forwarded-for' ? headers.get('x-real-ip') : '') ||
    '';
  const chain = value.split(',');
  const hops = Math.max(
    1,
    Number.parseInt(process.env.CLIENT_IP_TRUSTED_HOPS || '1', 10) || 1,
  );
  return normalizeIp(chain[Math.max(0, chain.length - hops)] || '');
}

function isPrivate(ip: string): boolean {
  if (ip.includes(':'))
    return /^(::|::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|ff)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function chineseIsp(organization: string): string {
  const names: [RegExp, string][] = [
    [/chinanet|china[\s_-]*telecom/i, '中国电信'],
    [/china[\s_-]*unicom|cncgroup/i, '中国联通'],
    [/china[\s_-]*mobile|cmnet/i, '中国移动'],
    [/china[\s_-]*broadnet/i, '中国广电'],
    [/cernet|china education and research/i, '中国教育和科研计算机网'],
    [/alibaba|aliyun|alicloud/i, '阿里云'],
    [/tencent/i, '腾讯云'],
    [/huawei.*cloud|huaweicloud/i, '华为云'],
    [/amazon|aws/i, '亚马逊云'],
    [/google/i, '谷歌'],
    [/microsoft/i, '微软'],
  ];
  return (
    names.find(([pattern]) => pattern.test(organization))?.[1] || organization
  );
}

const readers = new Map<
  string,
  {
    retryAt: number;
    promise: Promise<Reader<CityResponse | AsnResponse> | null>;
  }
>();
function getReader(filename: string) {
  const file = path.join(
    process.env.GEOIP_DB_DIR || path.join(process.cwd(), 'data', 'geoip'),
    filename,
  );
  const existing = readers.get(file);
  if (existing && Date.now() < existing.retryAt) return existing.promise;
  const entry = {
    retryAt: Infinity,
    promise: open<CityResponse | AsnResponse>(file, {
      watchForUpdates: true,
      watchForUpdatesNonPersistent: true,
    }).catch(() => {
      entry.retryAt = Date.now() + 60_000;
      console.warn(`[GeoIP] 无法读取 ${filename}，请运行 pnpm geoip:update`);
      return null;
    }),
  };
  readers.set(file, entry);
  return entry.promise;
}

export function mapLocation(
  ip: string,
  city: CityResponse | null,
  asn: AsnResponse | null,
): IpLocation {
  const named = (item?: { names?: { 'zh-CN'?: string; en?: string } }) =>
    item?.names?.['zh-CN'] || item?.names?.en || '';
  const countryCode = city?.country?.iso_code;
  let country = named(city?.country);
  if (!city?.country?.names?.['zh-CN'] && countryCode) {
    try {
      country =
        new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(countryCode) ||
        country;
    } catch {
      /* 保留数据库原名 */
    }
  }
  const organization = asn?.autonomous_system_organization || '';
  return {
    ip,
    country,
    countryCode,
    regionCode: city?.subdivisions
      ?.map((part) => part.iso_code)
      .filter(Boolean)
      .join('/'),
    source: 'request',
    region: (city?.subdivisions || []).map(named).filter(Boolean).join(' / '),
    city: named(city?.city),
    isp: chineseIsp(organization),
    organization,
    asn: asn?.autonomous_system_number,
    status: city && asn ? 'resolved' : city || asn ? 'partial' : 'unknown',
  };
}

export async function resolveIpLocation(headers: Headers): Promise<IpLocation> {
  const ip = getClientIp(headers);
  const empty: IpLocation = {
    ip,
    country: '',
    region: '',
    city: '',
    isp: '',
    status: 'unknown',
  };
  if (!ip) return empty;
  if (isPrivate(ip))
    return { ...empty, country: '内网/保留地址', status: 'private' };
  const [cityReader, asnReader] = await Promise.all([
    getReader('GeoLite2-City.mmdb'),
    getReader('GeoLite2-ASN.mmdb'),
  ]);
  try {
    const result = mapLocation(
      ip,
      cityReader?.get(ip) as CityResponse | null,
      asnReader?.get(ip) as AsnResponse | null,
    );
    if (!cityReader && !asnReader) result.status = 'unavailable';
    return result;
  } catch {
    return { ...empty, status: 'unavailable' };
  }
}
