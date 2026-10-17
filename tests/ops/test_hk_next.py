"""Bounded SSH command dispatch; uses no network or credentials."""
import importlib.util
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hk_next', Path(__file__).resolve().parents[2] / 'scripts/ops/hk_next.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class CommandDeadline(unittest.TestCase):
    def test_lost_exec_acknowledgement_is_bounded_and_never_replayed(self):
        closed = threading.Event()
        dispatched = []

        class Client:
            def close(self): closed.set()

        class Channel:
            def settimeout(self, value): pass
            def exec_command(self, command):
                dispatched.append(command)
                if not closed.wait(2): raise AssertionError('Deadline failed to close transport')
                raise EOFError()

        with patch.object(ops, 'connect', return_value=(Client(), Channel(), 'fixture')) as connection:
            with self.assertRaisesRegex(TimeoutError, 'result unknown'):
                ops.run_remote('fixture read-only command', timeout=0.05)
            connection.assert_called_once()
        self.assertEqual(dispatched, ['fixture read-only command'])

    def test_a_successful_command_dispatches_once_and_closes_the_connection(self):
        closed = threading.Event()
        dispatched = []

        class Client:
            def close(self): closed.set()

        class Channel:
            def settimeout(self, value): pass
            def exec_command(self, command): dispatched.append(command)
            def shutdown_write(self): pass
            def recv_ready(self): return False
            def recv_stderr_ready(self): return False
            def exit_status_ready(self): return True
            def recv_exit_status(self): return 0

        with patch.object(ops, 'connect', return_value=(Client(), Channel(), 'fixture')):
            self.assertEqual(ops.run_remote('fixture read-only command'), (0, '', '', 'fixture'))
        self.assertTrue(closed.is_set())
        self.assertEqual(len(dispatched), 1)


if __name__ == '__main__':
    unittest.main()
