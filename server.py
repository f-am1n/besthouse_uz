#!/usr/bin/env python3
"""
BestHouse.uz — Локальный сервер и коннектор площадок недвижимости (OLX.uz, Uybor.uz, Uysot.uz, Domtut.uz, Etagi.com).
Запуск:
    python server.py
После запуска откройте: http://localhost:8080
(Сайт также полностью работает без сервера при открытии index.html напрямую в браузере).
"""
import html
import json
import os
import re
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8080))


def extract_meta(page_html: str, prop: str) -> str:
    patterns = [
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
    ]
    for pat in patterns:
        m = re.search(pat, page_html, re.IGNORECASE)
        if m:
            return html.unescape(m.group(1).strip())
    return ""


class BestHouseHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/status":
            self._send_json({
                "ok": True,
                "platforms": ["olx.uz", "uybor.uz", "uysot.uz", "domtut.uz", "tashkent.etagi.com"],
                "mode": "server+client"
            })
            return

        if parsed.path == "/api/parse-url":
            qs = urllib.parse.parse_qs(parsed.query)
            target_url = (qs.get("url") or [""])[0].strip()
            if not target_url.startswith(("http://", "https://")):
                self._send_json({"ok": False, "error": "Invalid URL"}, status=400)
                return

            try:
                req = urllib.request.Request(
                    target_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                        "Accept-Language": "ru-RU,ru;q=0.9,uz;q=0.8,en;q=0.7",
                    },
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    raw_bytes = resp.read(250_000)
                    page = raw_bytes.decode("utf-8", errors="ignore")

                title = extract_meta(page, "og:title")
                if not title:
                    tm = re.search(r"<title[^>]*>(.*?)</title>", page, re.IGNORECASE | re.DOTALL)
                    title = html.unescape(tm.group(1).strip()) if tm else ""

                desc = extract_meta(page, "og:description") or extract_meta(page, "description")
                image = extract_meta(page, "og:image")

                self._send_json({
                    "ok": True,
                    "url": target_url,
                    "title": title,
                    "description": desc,
                    "image": image,
                })
            except Exception as exc:
                # Если целевой сайт закрыт антибот-защитой, фронтенд автоматически разбирает URL-слаг
                self._send_json({
                    "ok": False,
                    "fallback": "url-slug",
                    "url": target_url,
                    "message": str(exc),
                })
            return

        return super().do_GET()

    def _send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), BestHouseHandler)
    print(f"BestHouse.uz сервер запущен: http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")

