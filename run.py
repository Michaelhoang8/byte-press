"""Serve only the app's static assets on the local loopback interface."""
import argparse
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
ASSETS = {'/worker.js': ('worker.js', 'text/javascript'), '/': ('index.html', 'text/html'), '/style.css': ('style.css', 'text/css'),
          '/app.js': ('app.js', 'text/javascript'), '/core.js': ('core.js', 'text/javascript')}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        hosts = self.headers.get_all('Host', [])
        valid = len(hosts) == 1 and re.fullmatch(r'(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?', hosts[0], re.I)
        asset = ASSETS.get(urlsplit(self.path).path) if valid else None
        status = 200 if asset else 404 if valid else 400
        body = (ROOT / asset[0]).read_bytes() if asset else b'Not found' if valid else b'Use a loopback Host header'
        self.send_response(status)
        self.send_header('Content-Type', (asset[1] if asset else 'text/plain') + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; connect-src 'none'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_HEAD = do_GET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Byte Press: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()



