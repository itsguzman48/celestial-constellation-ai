"""API Serverless en Vercel para inferencia del Star Pattern Tracker."""

import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.pattern_matcher import ReconocedorConstelaciones

CAT_PATH = ROOT_DIR / "data" / "processed" / "constellations.json"
reconocedor = None
if CAT_PATH.exists():
    with open(CAT_PATH, "r", encoding="utf-8") as f:
        reconocedor = ReconocedorConstelaciones(json.load(f))


class handler(BaseHTTPRequestHandler):
    """Manejador HTTP para la función serverless de Vercel."""

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        payload = {
            "status": "online",
            "service": "Celestial Constellation AI Serverless API",
            "model": "Star Pattern Tracker",
            "author": "Iñigo Guzmán (@itsguzman48)",
        }
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        try:
            body = json.loads(post_data.decode("utf-8"))
            ra = float(body.get("ra", 0.0))
            dec = float(body.get("dec", 0.0))
            top_k = int(body.get("top_k", 3))

            predicciones = reconocedor.clasificar_posicion(ra, dec, top_k) if reconocedor else []
            resp_body = {
                "ra": ra,
                "dec": dec,
                "predicciones": predicciones,
            }
            self.send_response(200)
        except Exception as e:
            resp_body = {"error": str(e)}
            self.send_response(400)

        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(resp_body, ensure_ascii=False).encode("utf-8"))
