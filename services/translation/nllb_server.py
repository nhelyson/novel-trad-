import os
import sys
import json
import time
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

# Configure stdout/stderr UTF-8
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

MODEL_PATH = os.getenv("NLLB_MODEL_PATH", r"F:\Modèles Traduction\models\nllb-200-distilled-600M")
HOST = os.getenv("NLLB_HOST", "127.0.0.1")
PORT = int(os.getenv("NLLB_SERVER_PORT", "5002"))

tokenizer = None
model = None
is_loading = False
load_error = None
device_str = "cpu"

def load_nllb_model():
    global tokenizer, model, is_loading, load_error, device_str
    if model is not None:
        return True
    
    if is_loading:
        while is_loading:
            time.sleep(0.5)
        return model is not None

    is_loading = True
    load_error = None
    print(f"[NLLB Server] Chargement du modèle NLLB depuis: {MODEL_PATH}...", flush=True)
    start_t = time.time()
    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

        if torch.cuda.is_available():
            device_str = "cuda"
        else:
            device_str = "cpu"

        print(f"[NLLB Server] Dispositif d'exécution: {device_str.upper()}", flush=True)

        tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, local_files_only=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(
            MODEL_PATH,
            local_files_only=True,
            low_cpu_mem_usage=True,
            torch_dtype=torch.float32 if device_str == "cpu" else torch.float16
        )
        if device_str == "cuda":
            model = model.to("cuda")

        elapsed = time.time() - start_t
        print(f"[NLLB Server] Modèle NLLB-200 chargé avec succès en {elapsed:.2f}s !", flush=True)
        is_loading = False
        return True
    except Exception as e:
        load_error = str(e)
        is_loading = False
        print(f"[NLLB Server ERROR] Échec du chargement: {e}", flush=True)
        traceback.print_exc()
        return False

def translate_texts(texts, target_lang_code="fra_Latn", source_lang_code="eng_Latn"):
    if not load_nllb_model():
        raise RuntimeError(f"Impossible de charger le modèle NLLB: {load_error}")

    import torch

    target_lang_id = tokenizer.convert_tokens_to_ids(target_lang_code)
    results = []

    for text in texts:
        if not text or not isinstance(text, str) or not text.strip():
            results.append(str(text or ''))
            continue

        clean_text = text.strip()
        # Troncature de sécurité à 500 caractères par bloc pour la rapidité CPU
        if len(clean_text) > 500:
            clean_text = clean_text[:500]

        try:
            inputs = tokenizer(clean_text, return_tensors="pt")
            if device_str == "cuda":
                inputs = {k: v.to("cuda") for k, v in inputs.items()}

            with torch.no_grad():
                tokens = model.generate(
                    **inputs,
                    forced_bos_token_id=target_lang_id,
                    max_length=256,
                    num_beams=1,  # Greedy decoding rapide sur CPU (1-2s par paragraphe)
                    length_penalty=1.0
                )
            translated = tokenizer.batch_decode(tokens, skip_special_tokens=True)[0]
            results.append(translated)
        except Exception as err:
            print(f"[NLLB Server Warning] Échec traduction bloc: {err}", flush=True)
            results.append(clean_text)

    return results

class NLLBRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        if self.path in ['/health', '/status', '/api/status']:
            exists = os.path.exists(MODEL_PATH)
            self._send_json(200, {
                "status": "OK" if exists else "ERROR",
                "available": exists,
                "model_loaded": model is not None,
                "is_loading": is_loading,
                "model_path": MODEL_PATH,
                "device": device_str.upper(),
                "error": load_error
            })
        else:
            self._send_json(404, {"error": "Endpoint introuvable"})

    def do_POST(self):
        if self.path == '/load':
            success = load_nllb_model()
            if success:
                self._send_json(200, {"success": True, "message": "Modèle chargé en mémoire."})
            else:
                self._send_json(500, {"success": False, "error": load_error})
            return

        if self.path in ['/translate', '/api/translate']:
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                raw_body = self.rfile.read(content_len).decode('utf-8')
                payload = json.loads(raw_body)

                texts = payload.get('texts', [])
                if isinstance(texts, str):
                    texts = [texts]

                target_lang = payload.get('target_lang', 'fra_Latn')
                source_lang = payload.get('source_lang', 'eng_Latn')

                translations = translate_texts(texts, target_lang_code=target_lang, source_lang_code=source_lang)
                self._send_json(200, {
                    "success": True,
                    "translations": translations,
                    "count": len(translations),
                    "device": device_str.upper()
                })
            except Exception as e:
                print(f"[NLLB Server Error] {e}", flush=True)
                traceback.print_exc()
                self._send_json(500, {"success": False, "error": str(e)})
            return

        self._send_json(404, {"error": "Endpoint introuvable"})

def run_server():
    print(f"============================================================", flush=True)
    print(f" 🤖 NOVELTRAD NLLB-200 LOCAL TRANSLATION SERVER", flush=True)
    print(f"============================================================", flush=True)
    print(f" Modèle : {MODEL_PATH}", flush=True)
    print(f" Serveur local : http://{HOST}:{PORT}", flush=True)
    print(f"============================================================", flush=True)

    httpd = HTTPServer((HOST, PORT), NLLBRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[NLLB Server] Arrêt du serveur local NLLB.", flush=True)

if __name__ == '__main__':
    run_server()
