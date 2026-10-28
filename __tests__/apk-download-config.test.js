/** @jest-environment node */
/* global afterAll, beforeEach, describe, expect, it, jest */

jest.mock('@/lib/auth', () => ({ verifyApiAuth: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getLocalModeConfig: jest.fn(),
}));
jest.mock('@/lib/admin-config-mutation', () => ({
  persistAdminConfigMutation: jest.fn(),
}));

const { NextRequest } = require('next/server');
const { verifyApiAuth } = require('@/lib/auth');
const { getConfig, getLocalModeConfig } = require('@/lib/config');
const { persistAdminConfigMutation } = require('@/lib/admin-config-mutation');
const { POST } = require('../src/app/api/admin/site/route');
const originalOwner = process.env.USERNAME;
const downloadUrl = 'https://downloads.example.com/android/';
let config;

function request(overrides = {}) {
  return new NextRequest('http://localhost/api/admin/site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...config.SiteConfig, ...overrides }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.USERNAME = 'owner';
  config = {
    SiteConfig: {
      SiteName: 'Test',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'auto',
      DoubanProxy: '',
      DoubanImageProxyType: 'auto',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      SearchResultLoadMode: 'infinite',
      ApkDownloadUrl: downloadUrl,
    },
    UserConfig: {
      Users: [{ username: 'admin', role: 'admin', banned: false }],
    },
    TMDBConfig: { ApiKey: '' },
  };
  verifyApiAuth.mockReturnValue({
    isValid: true,
    isLocalMode: false,
    username: 'owner',
  });
  getConfig.mockResolvedValue(config);
  getLocalModeConfig.mockReturnValue(config);
  persistAdminConfigMutation.mockImplementation(async (value) => value);
});

afterAll(() => {
  if (originalOwner === undefined) delete process.env.USERNAME;
  else process.env.USERNAME = originalOwner;
});

describe('APK download configuration permissions', () => {
  it('allows the owner to save the download URL', async () => {
    const response = await POST(
      request({ ApkDownloadUrl: 'https://new.example.com/app/' }),
    );
    expect(response.status).toBe(200);
    expect(persistAdminConfigMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        SiteConfig: expect.objectContaining({
          ApkDownloadUrl: 'https://new.example.com/app/',
        }),
      }),
    );
  });

  it('allows the owner to disable the entry by clearing the URL', async () => {
    expect((await POST(request({ ApkDownloadUrl: '' }))).status).toBe(200);
    expect(config.SiteConfig.ApkDownloadUrl).toBe('');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:password@example.com/',
    'not a URL',
  ])('rejects unsafe or invalid links without persisting: %s', async (url) => {
    expect((await POST(request({ ApkDownloadUrl: url }))).status).toBe(400);
    expect(persistAdminConfigMutation).not.toHaveBeenCalled();
  });

  it('prevents a regular administrator from modifying the download URL', async () => {
    verifyApiAuth.mockReturnValue({
      isValid: true,
      isLocalMode: false,
      username: 'admin',
    });
    expect(
      (await POST(request({ ApkDownloadUrl: 'https://new.example.com/' })))
        .status,
    ).toBe(403);
    expect(persistAdminConfigMutation).not.toHaveBeenCalled();
    expect(config.SiteConfig.ApkDownloadUrl).toBe(downloadUrl);
  });

  it('preserves the URL when an older admin client omits the field', async () => {
    verifyApiAuth.mockReturnValue({
      isValid: true,
      isLocalMode: false,
      username: 'admin',
    });
    expect(
      (await POST(request({ ApkDownloadUrl: undefined, SiteName: 'Updated' })))
        .status,
    ).toBe(200);
    expect(config.SiteConfig.ApkDownloadUrl).toBe(downloadUrl);
    expect(config.SiteConfig.SiteName).toBe('Updated');
  });

  it('lets regular administrators save other settings without changing this field', async () => {
    verifyApiAuth.mockReturnValue({
      isValid: true,
      isLocalMode: false,
      username: 'admin',
    });
    expect((await POST(request({ SiteName: 'Updated' }))).status).toBe(200);
    expect(config.SiteConfig.ApkDownloadUrl).toBe(downloadUrl);
  });

  it('preserves the local-mode URL when the field is omitted', async () => {
    verifyApiAuth.mockReturnValue({ isValid: true, isLocalMode: true });
    expect((await POST(request({ ApkDownloadUrl: undefined }))).status).toBe(
      200,
    );
    expect(config.SiteConfig.ApkDownloadUrl).toBe(downloadUrl);
  });
});
