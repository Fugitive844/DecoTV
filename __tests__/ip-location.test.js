/** @jest-environment node */
/* global describe, it, expect, jest, afterEach */
const {
  normalizeIp,
  getClientIp,
  mapLocation,
  chineseIsp,
  resolveIpLocation,
} = require('../src/lib/ip-location');
const {
  recordUserIp,
  getUserIpHistory,
  getLatestUserIps,
} = require('../src/lib/user-ip-history');
const { MemoryStorage } = require('../src/lib/memory.db');
const location = {
  ip: '1.2.3.4',
  country: '中国',
  region: '广东省',
  city: '广州',
  isp: '中国电信',
  status: 'resolved',
};

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.CLIENT_IP_HEADER;
  delete process.env.CLIENT_IP_TRUSTED_HOPS;
});

describe('client IP and Chinese GeoLite data', () => {
  it('validates and canonicalizes IPv4, IPv6 and mapped IPv4', () => {
    expect(normalizeIp('1.2.3.4:123')).toBe('1.2.3.4');
    expect(normalizeIp('[2001:4860:0000::8888]:443')).toBe('2001:4860::8888');
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('::ffff:0102:0304')).toBe('1.2.3.4');
    expect(normalizeIp('garbage')).toBe('');
    expect(normalizeIp('999.1.1.1')).toBe('');
  });
  it('uses the last proxy-appended address, rejecting spoofed leftmost values', () => {
    expect(
      getClientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' })),
    ).toBe('1.2.3.4');
    process.env.CLIENT_IP_TRUSTED_HOPS = '2';
    expect(
      getClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })),
    ).toBe('1.2.3.4');
    process.env.CLIENT_IP_HEADER = 'x-real-ip';
    expect(
      getClientIp(
        new Headers({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }),
      ),
    ).toBe('1.2.3.4');
  });
  it('prefers Chinese names and retains ASN organization and stable codes', () => {
    const result = mapLocation(
      '1.2.3.4',
      {
        country: { iso_code: 'CN', names: { 'zh-CN': '中国', en: 'China' } },
        subdivisions: [{ iso_code: 'GD', names: { 'zh-CN': '广东省' } }],
        city: { names: { 'zh-CN': '广州' } },
      },
      {
        autonomous_system_number: 4134,
        autonomous_system_organization: 'CHINANET-BACKBONE',
      },
    );
    expect(result).toMatchObject({
      ...location,
      countryCode: 'CN',
      regionCode: 'GD',
      asn: 4134,
      organization: 'CHINANET-BACKBONE',
    });
    expect(
      mapLocation(
        '1.2.3.4',
        { country: { iso_code: 'US', names: { en: 'United States' } } },
        null,
      ).country,
    ).toBe('美国');
    expect(chineseIsp('Unknown Network Ltd')).toBe('Unknown Network Ltd');
  });
  it('marks private and absent addresses without pretending they are geographic locations', async () => {
    expect(await resolveIpLocation(new Headers())).toMatchObject({
      ip: '',
      status: 'unknown',
    });
    expect(
      await resolveIpLocation(new Headers({ 'x-real-ip': '192.168.1.1' })),
    ).toMatchObject({ status: 'private' });
  });
});

describe('IP history storage', () => {
  function storage() {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    return new MemoryStorage();
  }
  it('deduplicates consecutive observations and records IP, location, ISP changes and returns', async () => {
    const db = storage();
    await recordUserIp(db, 'alice', location, 1);
    await recordUserIp(db, 'alice', location, 2);
    await recordUserIp(db, 'alice', { ...location, ip: '2.3.4.5' }, 3);
    await recordUserIp(db, 'alice', location, 4);
    await recordUserIp(db, 'alice', { ...location, region: '北京市' }, 5);
    await recordUserIp(
      db,
      'alice',
      { ...location, region: '北京市', isp: '中国联通' },
      6,
    );
    const result = await getUserIpHistory(db, 'alice');
    expect(result.total).toBe(5);
    expect(result.items[4]).toMatchObject({ firstSeen: 1, lastSeen: 2 });
    expect((await getLatestUserIps(db, ['alice'])).alice.isp).toBe('中国联通');
    expect((await getUserIpHistory(db, 'alice', 1, 2)).items).toHaveLength(2);
  });
  it('handles concurrent identical requests and never overwrites with an older request', async () => {
    const db = storage();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        recordUserIp(db, 'alice', location, 100),
      ),
    );
    await recordUserIp(db, 'alice', { ...location, ip: '2.3.4.5' }, 50);
    expect((await getUserIpHistory(db, 'alice')).total).toBe(1);
    expect((await getLatestUserIps(db, ['alice'])).alice.lastSeen).toBe(100);
  });
  it('retains historical snapshots after history and user deletion', async () => {
    const db = storage();
    await db.registerUser('alice', 'pw');
    await recordUserIp(db, 'alice', location, 1);
    await db.addSearchAudit('alice', '电影', location);
    await db.deleteUser('alice');
    expect((await getUserIpHistory(db, 'alice')).total).toBe(1);
    expect(
      (await db.getSearchAudits('alice', 0, 50)).items[0].location,
    ).toEqual(location);
  });
});

describe('user IP admin endpoint permissions', () => {
  it('rejects ordinary users and prevents admins reading owner history', async () => {
    jest.resetModules();
    const auth = {
      isValid: true,
      username: 'alice',
      isOwner: false,
      isLocalMode: false,
    };
    jest.doMock('@/lib/auth', () => ({ verifyApiAuth: () => auth }));
    jest.doMock('@/lib/db', () => ({
      db: {
        kvGet: async () => null,
        kvMGet: async (keys) => keys.map(() => null),
      },
    }));
    jest.doMock('@/lib/config', () => ({
      getConfig: async () => ({
        UserConfig: {
          Users: [
            { username: 'alice', role: 'user' },
            { username: 'manager', role: 'admin' },
            { username: 'owner', role: 'owner' },
          ],
        },
      }),
    }));
    const { GET } = require('../src/app/api/admin/user-ips/route');
    const { NextRequest } = require('next/server');
    try {
      expect(
        (await GET(new NextRequest('http://localhost/api/admin/user-ips')))
          .status,
      ).toBe(403);
      auth.username = 'manager';
      expect(
        (
          await GET(
            new NextRequest(
              'http://localhost/api/admin/user-ips?username=owner',
            ),
          )
        ).status,
      ).toBe(403);
      const response = await GET(
        new NextRequest('http://localhost/api/admin/user-ips'),
      );
      expect(await response.json()).toEqual({
        latest: { alice: null, manager: null },
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      auth.username = 'owner';
      auth.isOwner = true;
      expect(
        (
          await GET(
            new NextRequest(
              'http://localhost/api/admin/user-ips?username=alice',
            ),
          )
        ).status,
      ).toBe(200);
    } finally {
      jest.dontMock('@/lib/auth');
      jest.dontMock('@/lib/db');
      jest.dontMock('@/lib/config');
    }
  });
});
