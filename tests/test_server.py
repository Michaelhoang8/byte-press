import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from run import Handler


class StaticServerTests(unittest.TestCase):
    def test_only_app_assets_are_exposed_and_head_has_no_body(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for path, expected in [('/', 200), ('/worker.js', 200), ('/core.js', 200), ('/.git/config', 404), ('/../run.py', 404)]:
                connection = HTTPConnection(*server.server_address, timeout=3)
                connection.request('GET', path)
                response = connection.getresponse()
                self.assertEqual(response.status, expected)
                self.assertEqual(len(response.read()), int(response.headers['Content-Length']))
                self.assertIn("connect-src 'none'", response.headers['Content-Security-Policy'])
                connection.close()
            connection = HTTPConnection(*server.server_address, timeout=3)
            connection.request('HEAD', '/')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'')
            connection.close()
            connection = HTTPConnection(*server.server_address, timeout=3)
            connection.request('GET', '/', headers={'Host': 'example.invalid'})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

