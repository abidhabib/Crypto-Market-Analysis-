"""Exercise the deployment receiver with fake Docker/curl, never the host daemon."""
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REVISION = 'a' * 40
ROOT = Path(__file__).resolve().parents[1]

MOCK_DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, re, sys
a = sys.argv[1:]
base = pathlib.Path(os.environ['MOCK_BASE'])
with (base / 'calls.jsonl').open('a') as f: f.write(json.dumps(a) + '\n')
if a[0] == 'load':
    sys.stdin.buffer.read(); print('Loaded release')
elif a[:2] == ['image', 'inspect']:
    print('wrong' if os.environ.get('MOCK_WRONG_REVISION') else os.environ['MOCK_REVISION'])
elif a[0] == 'inspect':
    if '.Config.Image' in a[2]: print('tradizone-dashboard:previous' if a[-1] == 'dashboard-id' else 'tradizone-stream:previous')
    else:
        override = (base / 'compose.override.yaml').read_text()
        bad = os.environ.get('MOCK_FAIL_NEW') and os.environ['MOCK_REVISION'] in override
        print('unhealthy' if bad else 'healthy')
elif a[0] == 'compose':
    if 'ps' in a and '-q' in a: print(a[-1] + '-id')
    elif 'config' in a: pass
    elif 'up' in a: pass
    elif 'logs' in a: print('failed fixture')
else:
    raise SystemExit('Unexpected Docker command: ' + repr(a))
'''

class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.write_executable('docker', MOCK_DOCKER)
        self.write_executable('sleep', '#!/bin/sh\nexit 0\n')
        self.write_executable('curl', '#!/bin/sh\nprintf \'0{"sid":"test"}\'\n')
        source = (ROOT / 'deploy/receive-release.sh').read_text()
        source = source.replace('BASE=/opt/tradizone', f'BASE={self.base}')
        source = source.replace('export PATH=/usr/local/sbin:', f'export PATH={self.bin}:/usr/local/sbin:')
        self.receiver = self.base / 'receiver.sh'
        self.receiver.write_text(source)
        (self.base / 'compose.yaml').write_text('services: {}\n')

    def write_executable(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def run_receiver(self, command, **options):
        env = dict(os.environ, SSH_ORIGINAL_COMMAND=command, MOCK_BASE=str(self.base), MOCK_REVISION=REVISION, **options)
        return subprocess.run(['bash', str(self.receiver)], input=gzip.compress(b'image fixture'), capture_output=True, env=env, timeout=15)

    def calls(self):
        path = self.base / 'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_ui_release_only_recreates_dashboard_and_preserves_stream_image(self):
        result = self.run_receiver(f'deploy {REVISION} dashboard')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn('tradizone-stream:previous', (self.base / 'compose.override.yaml').read_text())
        updates = [a for a in self.calls() if 'up' in a]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0][-1], 'dashboard')
        self.assertIn('--no-deps', updates[0])
        self.assertEqual((self.base / 'current-release').read_text().strip(), REVISION)

    def test_failed_health_restores_previous_image(self):
        result = self.run_receiver(f'deploy {REVISION} dashboard', MOCK_FAIL_NEW='1')
        self.assertNotEqual(result.returncode, 0)
        override = (self.base / 'compose.override.yaml').read_text()
        self.assertIn('tradizone-dashboard:previous', override)
        self.assertIn('tradizone-stream:previous', override)
        self.assertFalse((self.base / 'current-release').exists())
        self.assertEqual(len([a for a in self.calls() if 'up' in a]), 2)

    def test_wrong_revision_does_not_change_running_services(self):
        result = self.run_receiver(f'deploy {REVISION} dashboard', MOCK_WRONG_REVISION='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in a for a in self.calls()))
        self.assertFalse((self.base / 'compose.override.yaml').exists())

    def test_forced_key_rejects_arbitrary_commands(self):
        for command in ['bash', f'deploy {REVISION} dashboard; touch nope', 'deploy ../../etc both']:
            result = self.run_receiver(command)
            self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_explicit_stream_release_updates_both_services(self):
        result = self.run_receiver(f'deploy {REVISION} both')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        updates = [a for a in self.calls() if 'up' in a]
        self.assertEqual(updates[0][-2:], ['dashboard', 'stream'])

    def test_unmanaged_override_is_not_overwritten(self):
        original = 'services:\n  custom: {}\n'
        (self.base / 'compose.override.yaml').write_text(original)
        result = self.run_receiver(f'deploy {REVISION} dashboard')
        self.assertEqual(result.returncode, 4)
        self.assertEqual((self.base / 'compose.override.yaml').read_text(), original)
        self.assertFalse(any('up' in a for a in self.calls()))

if __name__ == '__main__':
    unittest.main()
