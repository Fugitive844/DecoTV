"""Tests for the conservative historical IP matcher. No database/network access."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('backfill', Path(__file__).with_name('backfill-audit-ips.py'))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)

class BackfillTests(unittest.TestCase):
    def test_exact_time_query_string_and_referer(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'site.log'
            log.write_text('1.2.3.4 - - [03/Nov/2026:10:00:00 +0800] "POST /api/playrecords?x=1 HTTP/2.0" 200 36 "https://site/play?source=a&id=b" "ua"\n')
            events = backfill.parse_logs([log])
            timestamp = next(iter(events))[1] * 1000
            entry = {'source': 'a', 'id': 'b'}
            self.assertIsNotNone(backfill.candidate(events, 'play', entry, timestamp + 999))
            self.assertIsNone(backfill.candidate(events, 'play', entry, timestamp + 1000))
            self.assertIsNone(backfill.candidate(events, 'play', {'source': 'wrong', 'id': 'b'}, timestamp))
            self.assertIsNone(backfill.candidate(backfill.parse_logs([log, log]), 'play', entry, timestamp))

    def test_idempotent_history_preserves_latest(self):
        first = {'ip': '1.2.3.4', 'firstSeen': 1, 'lastSeen': 2}
        second = {'ip': '2.3.4.5', 'firstSeen': 3, 'lastSeen': 3}
        merged = backfill.merge_history([second], [first, first])
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]['ip'], '2.3.4.5')
        self.assertEqual(backfill.merge_history(merged, [first]), merged)

    def test_same_ip_isp_change_and_return(self):
        observations = [{'ip': '1.2.3.4', 'isp': isp, 'firstSeen': time, 'lastSeen': time} for time, isp in [(1, 'A'), (2, 'B'), (3, 'A')]]
        self.assertEqual(len(backfill.merge_history([], observations)), 3)

if __name__ == '__main__':
    unittest.main()
