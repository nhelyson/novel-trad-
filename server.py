import http.server
import socketserver
import webbrowser
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

if __name__ == "__main__":
    os.chdir(DIRECTORY)
    print("=" * 60)
    print(" 📖 NOVELTRAD AI - STUDIO DE TRADUCTION DE LIVRES & EBOOKS")
    print("=" * 60)
    print(f" Serveur local lancé sur : http://localhost:{PORT}")
    print(f" Dossier de l'application : {DIRECTORY}")
    print("=" * 60)
    
    webbrowser.open(f"http://localhost:{PORT}")

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur local NovelTrad AI.")
