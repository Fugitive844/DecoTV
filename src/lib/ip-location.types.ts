export interface IpLocation {
  ip: string;
  country: string;
  countryCode?: string;
  regionCode?: string;
  source?: 'request' | 'nginx-backfill';
  evidence?: { log: string; line: number; time: number; match: string };
  region: string;
  city: string;
  isp: string;
  asn?: number;
  organization?: string;
  status: 'resolved' | 'partial' | 'private' | 'unavailable' | 'unknown';
}

export interface UserIpEntry extends IpLocation {
  firstSeen: number;
  lastSeen: number;
}
