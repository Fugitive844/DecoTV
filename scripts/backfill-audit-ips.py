"""Conservative, resumable Nginx -> audit IP backfill. Dry-run by default.

Run on the production host. Credentials are read in memory from the app container.
Only a unique successful request in the exact audit second is eligible. Video
referer IDs, when present, must also agree. No nearest-IP/session extrapolation.
"""
import argparse
import collections
import datetime
import ipaddress
import json
import os
import re
import socket
import subprocess
import urllib.parse
from pathlib import Path


class Redis:
    def __init__(self, container, port):
        info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
        env = dict(v.split('=', 1) for v in info['Config']['Env'] if '=' in v)
        url = urllib.parse.urlparse(env['KVROCKS_URL'])
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=30)
        self.file = self.socket.makefile('rb')
        if url.password:
            self.cmd('AUTH', urllib.parse.unquote(url.password))
        if url.path.strip('/'):
            self.cmd('SELECT', url.path.strip('/'))

    def read(self):
        kind, value = self.file.read(1), self.file.readline()[:-2]
        if kind == b'+': return value.decode()
        if kind == b'-': raise RuntimeError(value.decode())
        if kind == b':': return int(value)
        if kind == b'$':
            size = int(value)
            if size < 0: return None
            result = self.file.read(size); self.file.read(2)
            return result.decode()
        if kind == b'*': return [self.read() for _ in range(int(value))]
        raise RuntimeError('Invalid Redis response')

    def cmd(self, *args):
        args = [str(arg).encode() for arg in args]
        self.socket.sendall(b'*' + str(len(args)).encode() + b'\r\n' + b''.join(b'$' + str(len(arg)).encode() + b'\r\n' + arg + b'\r\n' for arg in args))
        return self.read()


LOG_PATTERN = re.compile(r'^(\S+) \S+ \S+ \[([^]]+)\] "(\S+) (\S+) HTTP/[^"]+" (\d+) \S+ "([^"]*)"')


def parse_logs(paths):
    events = collections.defaultdict(list)
    for path in paths:
        with open(path, encoding='utf-8', errors='replace') as file:
            for number, line in enumerate(file, 1):
                match = LOG_PATTERN.search(line)
                if not match: continue
                ip, time, method, target, status, referer = match.groups()
                route = urllib.parse.urlparse(target).path
                if method != 'POST' or status != '200' or route not in ['/api/playrecords', '/api/searchhistory']:
                    continue
                try:
                    ip = str(ipaddress.ip_address(ip))
                    timestamp = int(datetime.datetime.strptime(time, '%d/%b/%Y:%H:%M:%S %z').timestamp())
                except ValueError: continue
                query = urllib.parse.parse_qs(urllib.parse.urlparse(referer).query)
                events[(route, timestamp)].append({'ip': ip, 'log': Path(path).name, 'line': number, 'time': timestamp * 1000, 'query': query})
    return events


def candidate(events, kind, entry, timestamp):
    route = '/api/playrecords' if kind == 'play' else '/api/searchhistory'
    matches = events.get((route, int(timestamp) // 1000), [])
    if len(matches) != 1: return None
    event = matches[0]
    if kind == 'play':
        for field in ['source', 'id']:
            if field in event['query'] and event['query'][field] != [str(entry.get(field, ''))]: return None
    return {**event, 'match': 'video-and-exact-second' if kind == 'play' and all(k in event['query'] for k in ['source', 'id']) else 'unique-exact-second'}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def history_signature(item):
    return tuple(item.get(field) for field in ['ip', 'country', 'region', 'city', 'isp', 'asn', 'organization'])


def merge_history(existing, observations):
    entries = [dict(item) for item in existing]
    for item in observations:
        if any(history_signature(old) == history_signature(item) and old['firstSeen'] <= item['firstSeen'] <= old['lastSeen'] for old in entries): continue
        entries.append(item)
    entries.sort(key=lambda item: item['firstSeen'])
    merged = []
    for item in entries:
        if merged and history_signature(merged[-1]) == history_signature(item):
            merged[-1]['lastSeen'] = max(merged[-1]['lastSeen'], item['lastSeen'])
        else: merged.append(dict(item))
    return list(reversed(merged))[:5000]


def run(args):
    os.umask(0o077)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    redis = Redis(args.container, args.port)
    events = parse_logs(args.logs)
    records, backup = [], {}
    names = redis.cmd('SMEMBERS', 'audit:users')
    for username in names:
        play_key, search_key = 'audit:play:' + username, 'audit:search:' + username
        values = redis.cmd('HGETALL', play_key)
        plays = dict(zip(values[::2], values[1::2]))
        searches = redis.cmd('LRANGE', search_key, 0, -1)
        backup[play_key] = {'type': 'hash', 'value': plays}
        backup[search_key] = {'type': 'list', 'value': searches}
        ip_key = 'audit:ip:' + username
        backup[ip_key] = {'type': 'string', 'value': redis.cmd('GET', ip_key)}
        for kind, key, pairs in [('play', play_key, plays.items()), ('search', search_key, enumerate(searches))]:
            for identity, raw in pairs:
                entry = json.loads(raw)
                timestamp = entry.get('last_play_time' if kind == 'play' else 'time', 0)
                records.append({'kind': kind, 'key': key, 'identity': identity, 'raw': raw, 'entry': entry, 'username': username, 'timestamp': timestamp})
    claims = collections.defaultdict(set)
    for record in records:
        record['candidate'] = candidate(events, record['kind'], record['entry'], record['timestamp'])
        event = record['candidate']
        if event: claims[(event['log'], event['line'])].add((record['key'], record['identity']))
    counts = collections.Counter()
    eligible = []
    for record in records:
        counts[record['kind'] + 'Total'] += 1
        if record['entry'].get('location', {}).get('ip'):
            counts['alreadyRecorded'] += 1; continue
        event = record['candidate']
        if not event: counts[record['kind'] + 'Unmatched'] += 1; continue
        if len(claims[(event['log'], event['line'])]) > 1:
            counts['ambiguousRecord'] += 1; continue
        eligible.append(record); counts[record['kind'] + 'Eligible'] += 1
    (output / 'ips.json').write_text(compact(sorted({r['candidate']['ip'] for r in eligible})), encoding='utf-8')
    (output / 'plan.json').write_text(compact(eligible), encoding='utf-8')
    counts['usersEligible'] = len({r['username'] for r in eligible})
    if args.apply:
        if not args.geo_map: raise ValueError('--apply requires --geo-map')
        geo = json.loads(Path(args.geo_map).read_text(encoding='utf-8'))
        for record in eligible:
            ip = record['candidate']['ip']
            if ip not in geo or geo[ip].get('status') not in ['resolved', 'partial', 'private']: raise ValueError('Missing resolved geographic data')
        # Unique backup per run; never replace a previous backup.
        backup_path = output / ('backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S%f') + '.json')
        with backup_path.open('x', encoding='utf-8') as file: file.write(compact(backup))
        observations = collections.defaultdict(list)
        # Reconstruct already backfilled observations too, so a rerun heals a
        # process interruption between the audit write and history write.
        for record in records:
            location = record['entry'].get('location', {})
            if location.get('source') == 'nginx-backfill' and location.get('ip'):
                observations[record['username']].append({**location, 'firstSeen': record['timestamp'], 'lastSeen': record['timestamp']})
        for record in eligible:
            event = record['candidate']
            location = {**geo[event['ip']], 'source': 'nginx-backfill', 'evidence': {field: event[field] for field in ['log', 'line', 'time', 'match']}}
            entry = {**record['entry'], 'location': location}
            if record['kind'] == 'play':
                script = "if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); return 1"
                updated = redis.cmd('EVAL', script, 1, record['key'], record['identity'], record['raw'], compact(entry))
            else:
                script = "local a=redis.call('LRANGE',KEYS[1],0,-1); local found=-1; for i,v in ipairs(a) do if v==ARGV[1] then if found~=-1 then return 0 end found=i-1 end end; if found==-1 then return 0 end; redis.call('LSET',KEYS[1],found,ARGV[2]); return 1"
                updated = redis.cmd('EVAL', script, 1, record['key'], record['raw'], compact(entry))
            if not updated: counts['concurrentSkipped'] += 1; continue
            counts[record['kind'] + 'Updated'] += 1
            observations[record['username']].append({**location, 'firstSeen': record['timestamp'], 'lastSeen': record['timestamp']})
        for username, items in observations.items():
            key = 'audit:ip:' + username
            for _ in range(20):
                raw = redis.cmd('GET', key)
                merged = merge_history(json.loads(raw) if raw else [], items)
                script = "local v=redis.call('GET',KEYS[1]); if (ARGV[1]=='nil' and v) or (ARGV[1]=='set' and v~=ARGV[2]) then return 0 end; redis.call('SET',KEYS[1],ARGV[3]); return 1"
                if redis.cmd('EVAL', script, 1, key, 'nil' if raw is None else 'set', raw or '', compact(merged)): break
            else: raise RuntimeError('Concurrent IP history update failed')
        counts['usersUpdated'] = len(observations)
    report = dict(counts)
    report['applied'] = args.apply
    report['matchingRule'] = 'One successful request in exact second across both logs, unique audit claim, referer source/id agrees when present. Inferred, not authenticated identity.'
    (output / ('applied.json' if args.apply else 'dry-run.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='decotv-core')
    parser.add_argument('--port', type=int, default=12106)
    parser.add_argument('--logs', nargs='+', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--geo-map')
    parser.add_argument('--apply', action='store_true')
    run(parser.parse_args())
