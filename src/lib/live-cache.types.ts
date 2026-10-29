export interface LiveCacheSource {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
}

export interface LiveChannelData {
  channelNumber: number;
  channels: {
    id: string;
    tvgId: string;
    tvgName?: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
  epgUrl: string;
  epgs: Record<string, { start: string; end: string; title: string }[]>;
}

export interface LiveChannelCacheRecord extends LiveChannelData {
  version: 1;
  sourceFingerprint: string;
  fetchedAt: number;
}
