/**
 * @jest-environment node
 */
/* global afterEach, beforeEach, describe, expect, it, jest */

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

const originalEnv = {
  NEXT_PUBLIC_STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE,
  NEXT_PUBLIC_AUTH_MODE: process.env.NEXT_PUBLIC_AUTH_MODE,
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD,
};

function createRequest(url, { username, ...options } = {}) {
  const { NextRequest } = require('next/server');
  const headers = { ...(options.headers || {}) };
  if (username) {
    headers.cookie = `auth=${encodeURIComponent(
      JSON.stringify({ username, signature: 'signed', timestamp: Date.now() }),
    )}`;
  }
  return new NextRequest(url, { ...options, headers });
}

function createRecord(overrides = {}) {
  return {
    title: '流浪地球',
    source_name: '测试源',
    cover: '',
    year: '2019',
    index: 1,
    total_episodes: 1,
    play_time: 30,
    total_time: 7200,
    save_time: 1000,
    search_title: '流浪地球',
    ...overrides,
  };
}

function createMemoryStorage() {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const { MemoryStorage } = require('../src/lib/memory.db');
  return new MemoryStorage();
}

describe('audit storage (memory)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps one play audit per user and video, preserving first play time', async () => {
    const storage = createMemoryStorage();
    await storage.registerUser('alice', 'pw');

    await storage.setPlayRecord('alice', 'src+1', createRecord());
    await storage.upsertPlayAudit('alice', 'src+1', createRecord());

    // 用户删除自己的播放记录后再次观看同一视频
    await storage.deletePlayRecord('alice', 'src+1');
    await storage.upsertPlayAudit(
      'alice',
      'src+1',
      createRecord({ play_time: 600, index: 2, save_time: 5000 }),
    );

    expect(await storage.getAllPlayRecords('alice')).toEqual({});
    const audits = await storage.getPlayAudits('alice');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      key: 'src+1',
      source: 'src',
      id: '1',
      index: 2,
      play_time: 600,
      first_play_time: 1000,
      last_play_time: 5000,
    });
  });

  it('records every search and survives history and user deletion', async () => {
    const storage = createMemoryStorage();
    await storage.registerUser('bob', 'pw');

    await storage.addSearchHistory('bob', '三体');
    await storage.addSearchAudit('bob', '三体');
    await storage.addSearchHistory('bob', '三体');
    await storage.addSearchAudit('bob', '三体');
    await storage.upsertPlayAudit('bob', 'src+2', createRecord());

    await storage.deleteSearchHistory('bob');
    await storage.deleteUser('bob');

    expect(await storage.getSearchHistory('bob')).toEqual([]);
    const searches = await storage.getSearchAudits('bob', 0, 10);
    expect(searches.total).toBe(2);
    expect(searches.items.map((item) => item.keyword)).toEqual([
      '三体',
      '三体',
    ]);
    expect(await storage.getPlayAudits('bob')).toHaveLength(1);
    expect(await storage.getAuditUsers()).toEqual(['bob']);
  });

  it('caps search audits per user', async () => {
    const storage = createMemoryStorage();
    const { SEARCH_AUDIT_LIMIT } = require('../src/lib/audit');
    for (let i = 0; i < SEARCH_AUDIT_LIMIT + 3; i++) {
      await storage.addSearchAudit('carol', `kw${i}`);
    }
    const result = await storage.getSearchAudits('carol', 0, 1);
    expect(result.total).toBe(SEARCH_AUDIT_LIMIT);
    expect(result.items[0].keyword).toBe(`kw${SEARCH_AUDIT_LIMIT + 2}`);
  });
});

describe('audit routes', () => {
  let mockDb;

  function loadRoute(path) {
    jest.resetModules();
    mockDb = {
      savePlayRecord: jest.fn(async () => undefined),
      upsertPlayAudit: jest.fn(async () => undefined),
      deletePlayRecord: jest.fn(async () => undefined),
      deletePlayRecordByKey: jest.fn(async () => undefined),
      getAllPlayRecords: jest.fn(async () => ({ 'src+1': createRecord() })),
      addSearchHistory: jest.fn(async () => undefined),
      addSearchAudit: jest.fn(async () => undefined),
      getSearchHistory: jest.fn(async () => ['三体']),
      deleteSearchHistory: jest.fn(async () => undefined),
      getAuditUsers: jest.fn(async () => ['alice', 'ghost']),
      getPlayAudits: jest.fn(async () => []),
      getSearchAudits: jest.fn(async () => ({ total: 0, items: [] })),
    };
    jest.doMock('@/lib/db', () => ({ db: mockDb }));
    jest.doMock('@/lib/config', () => ({
      getConfig: jest.fn(async () => ({
        UserConfig: {
          Users: [
            { username: 'admin', role: 'owner' },
            { username: 'alice', role: 'user', banned: false },
            { username: 'manager', role: 'admin', banned: false },
          ],
        },
      })),
    }));
    return require(path);
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'kvrocks';
    process.env.NEXT_PUBLIC_AUTH_MODE = 'password';
    process.env.USERNAME = 'admin';
    process.env.PASSWORD = 'test_password';
  });

  afterEach(() => {
    jest.dontMock('@/lib/db');
    jest.dontMock('@/lib/config');
    jest.restoreAllMocks();
    Object.entries(originalEnv).forEach(([name, value]) =>
      restoreEnv(name, value),
    );
  });

  it('writes a play audit when a play record is saved', async () => {
    const route = loadRoute('../src/app/api/playrecords/route');
    const response = await route.POST(
      createRequest('http://localhost/api/playrecords', {
        username: 'alice',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'src+1', record: createRecord() }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDb.upsertPlayAudit).toHaveBeenCalledWith(
      'alice',
      'src+1',
      expect.objectContaining({ title: '流浪地球' }),
    );
  });

  it('keeps saving play records when the audit write fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const route = loadRoute('../src/app/api/playrecords/route');
    mockDb.upsertPlayAudit.mockRejectedValueOnce(new Error('audit down'));
    const response = await route.POST(
      createRequest('http://localhost/api/playrecords', {
        username: 'alice',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'src+1', record: createRecord() }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDb.savePlayRecord).toHaveBeenCalled();
  });

  it('user deletion of play records does not touch audits', async () => {
    const route = loadRoute('../src/app/api/playrecords/route');
    const response = await route.DELETE(
      createRequest('http://localhost/api/playrecords', {
        username: 'alice',
        method: 'DELETE',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDb.deletePlayRecord).toHaveBeenCalled();
    expect(mockDb.upsertPlayAudit).not.toHaveBeenCalled();
  });

  it('writes a search audit for every search', async () => {
    const route = loadRoute('../src/app/api/searchhistory/route');
    const response = await route.POST(
      createRequest('http://localhost/api/searchhistory', {
        username: 'alice',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: ' 三体 ' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDb.addSearchAudit).toHaveBeenCalledWith('alice', '三体');
  });

  it('only allows the owner to read audit logs', async () => {
    const route = loadRoute('../src/app/api/admin/audit/route');

    const asAdmin = await route.GET(
      createRequest('http://localhost/api/admin/audit', {
        username: 'manager',
      }),
    );
    expect(asAdmin.status).toBe(403);

    const asOwner = await route.GET(
      createRequest('http://localhost/api/admin/audit', { username: 'admin' }),
    );
    expect(asOwner.status).toBe(200);
    expect(await asOwner.json()).toMatchObject({
      users: [
        { username: 'admin', playCount: 0, searchCount: 0, deleted: false },
        { username: 'alice', playCount: 0, searchCount: 0, deleted: false },
        { username: 'ghost', deleted: true },
        { username: 'manager', playCount: 0, searchCount: 0, deleted: false },
      ],
    });

    const plays = await route.GET(
      createRequest(
        'http://localhost/api/admin/audit?username=alice&type=play',
        { username: 'admin' },
      ),
    );
    expect(plays.status).toBe(200);
    expect(mockDb.getPlayAudits).toHaveBeenCalledWith('alice');
  });

  it('merges audits of all users when no username is given', async () => {
    const route = loadRoute('../src/app/api/admin/audit/route');
    mockDb.getPlayAudits.mockImplementation(async (name) =>
      name === 'alice'
        ? [{ key: 'src+1', title: 'A', last_play_time: 100 }]
        : [{ key: 'src+1', title: 'A', last_play_time: 200 }],
    );
    mockDb.getSearchAudits.mockImplementation(async (name, offset, limit) => {
      const all =
        name === 'alice'
          ? [
              { keyword: 'a2', time: 40 },
              { keyword: 'a1', time: 10 },
            ]
          : [{ keyword: 'g1', time: 30 }];
      return { total: all.length, items: all.slice(offset, offset + limit) };
    });

    const plays = await route.GET(
      createRequest('http://localhost/api/admin/audit?type=play', {
        username: 'admin',
      }),
    );
    expect(await plays.json()).toMatchObject({
      total: 2,
      items: [
        { username: 'ghost', last_play_time: 200 },
        { username: 'alice', last_play_time: 100 },
      ],
    });

    const searches = await route.GET(
      createRequest(
        'http://localhost/api/admin/audit?type=search&offset=1&limit=2',
        { username: 'admin' },
      ),
    );
    expect(await searches.json()).toEqual({
      total: 3,
      items: [
        { keyword: 'g1', time: 30, username: 'ghost' },
        { keyword: 'a1', time: 10, username: 'alice' },
      ],
    });
  });
});
