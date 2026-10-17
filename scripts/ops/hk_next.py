"""Read-only diagnostics for the WQT new-release HK deployment.

Connect once, dispatch once. Fallback is allowed only before dispatch; a lost
response must never silently cause a production command to run twice.
Requires the locally managed credential and an already pinned host key.
"""
import argparse
import json
import logging
import os
from pathlib import Path
import socket
import time
import threading
from urllib.parse import urlsplit

import paramiko

HOST = '8.217.44.101'
NAMESPACE = 'environment-6ad2657554d74b84a5bd1e57'
DEPLOYMENT = 'service-6ad26b6b38f4286bd6df6332'
SECRETS = Path.home() / '.codex' / 'secrets'


def connect():
    credentials = json.loads((SECRETS / 'wqt-hk-server-access.json').read_text())
    known_hosts = SECRETS / 'wqt-hk-known-hosts'
    if not known_hosts.exists():
        raise RuntimeError('Pinned HK host key missing; restore the trusted deployment host-key file')
    logging.getLogger('paramiko.transport').setLevel(logging.CRITICAL)
    failures = []
    for transport in ('direct', 'proxy'):
        client = paramiko.SSHClient()
        client.load_host_keys(str(known_hosts))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        sock = None
        try:
            if transport == 'proxy':
                proxy = urlsplit(os.environ.get('HTTPS_PROXY', 'http://127.0.0.1:7897'))
                if proxy.scheme != 'http' or proxy.username or not proxy.hostname:
                    raise RuntimeError('Expected a local HTTP CONNECT proxy')
                sock = socket.create_connection((proxy.hostname, proxy.port or 80), timeout=8)
                sock.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
                response = b''
                while not response.endswith(b'\r\n\r\n'):
                    chunk = sock.recv(1)
                    if not chunk or len(response) > 8192:
                        raise OSError('Proxy closed connection')
                    response += chunk
                if b' 200 ' not in response.split(b'\r\n', 1)[0]:
                    raise OSError('Proxy refused connection')
            client.connect(HOST, username='root', password=credentials['revealManagedServerInitialPassword'],
                           sock=sock, look_for_keys=False, allow_agent=False,
                           timeout=8, banner_timeout=8, auth_timeout=8, channel_timeout=10)
            client.get_transport().set_keepalive(5)
            # Check the session channel before returning; no production work yet.
            channel = client.get_transport().open_session(timeout=10)
            return client, channel, transport
        except (paramiko.AuthenticationException, paramiko.BadHostKeyException):
            client.close()
            if sock: sock.close()
            raise RuntimeError('HK authentication or pinned host-key verification failed') from None
        except (OSError, paramiko.SSHException, EOFError) as error:
            client.close()
            if sock: sock.close()
            failures.append({'transport': transport, 'errorType': type(error).__name__})
    raise RuntimeError('HK connection unavailable: ' + json.dumps(failures))


def run_remote(command, data=None, timeout=30):
    client, channel, transport = connect()
    started = time.monotonic()
    output, errors = bytearray(), bytearray()
    # Paramiko's exec-request acknowledgement can block independently of socket
    # read timeouts. Close the transport at the overall deadline as well.
    deadline = threading.Timer(timeout, client.close)
    deadline.daemon = True
    deadline.start()
    try:
        channel.settimeout(10)
        channel.exec_command(command)
        if data is not None:
            channel.sendall(data.encode())
        channel.shutdown_write()
        while True:
            while channel.recv_ready(): output.extend(channel.recv(65536))
            while channel.recv_stderr_ready(): errors.extend(channel.recv_stderr(65536))
            if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                return channel.recv_exit_status(), output.decode(), errors.decode(), transport
            if time.monotonic() - started > timeout:
                raise TimeoutError('Remote result unknown; inspect state before retrying')
            time.sleep(0.05)
    except (EOFError, OSError, paramiko.SSHException):
        if time.monotonic() - started >= timeout:
            raise TimeoutError('Remote result unknown; inspect state before retrying') from None
        raise
    finally:
        deadline.cancel()
        client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'https'])
    action = parser.parse_args().action
    if action == 'status':
        command = f'kubectl get pods -n {NAMESPACE} -o wide'
        source = None
    else:
        command = 'python3 -'
        # Resolve HTTPS on the HK server, avoiding the workstation fake-IP DNS.
        # TLS hostname verification remains enabled. This never sends an SMS.
        source = '''import json,urllib.request,urllib.error
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
failed=False
for host in ['scoring.ai5000days.com','admin.ai5000days.com']:
 for path in ['/api/auth/verification-options','/shared/browser/sms-cooldown.js']:
  try:
   with opener.open('https://'+host+path,timeout=10) as response: status=response.status
   result={'status':status}
  except urllib.error.HTTPError as error:
   failed=True;result={'status':error.code}
  except (OSError,urllib.error.URLError) as error:
   failed=True;result={'errorType':type(error).__name__}
  print(json.dumps({'host':host,'path':path,**result}))
raise SystemExit(1 if failed else 0)
'''
    code, output, errors, transport = run_remote(command, source, timeout=45)
    print(json.dumps({'transport': transport, 'exitCode': code}))
    print(output, end='')
    if errors: print(errors, end='')
    raise SystemExit(code)


if __name__ == '__main__':
    main()
