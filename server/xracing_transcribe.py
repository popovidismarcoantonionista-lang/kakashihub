"""Transcrição local usada pelo motor XRacing.

Roda no mesmo serviço do pipeline (sem API paga). Recebe um WAV mono 16 kHz
ou um JSON com vários WAVs (janelas amostradas do vídeo) e escreve no stdout
um JSON com as palavras e seus timestamps absolutos.
O modelo vem de XRACING_MODEL (padrão: tiny) e é baixado no build da imagem.
O free do Render tem ~512 MB: uma thread e o modelo tiny evitam o OOM que
o modelo base causava durante a transcrição.
"""
import os

# Tem de ser definido antes de importar faster_whisper/ctranslate2.
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')

import json
import sys

from faster_whisper import WhisperModel

arg = sys.argv[1] if len(sys.argv) > 1 else ""

# Um único carregamento do modelo para todas as janelas: no Render free o
# custo de iniciar o modelo é alto e vídeos longos estouravam o timeout.
files = []
if arg.lower().endswith('.json'):
    try:
        with open(arg, encoding='utf-8') as fh:
            cfg = json.load(fh)
        for item in cfg.get('files', []):
            wav = item.get('path', '')
            if wav and os.path.isfile(wav):
                files.append((wav, float(item.get('offset', 0) or 0)))
    except Exception:
        files = []
elif arg and os.path.isfile(arg):
    files = [(arg, 0.0)]

if not files:
    print(json.dumps({"error": "wav-not-found"}))
    sys.exit(2)

model_name = os.environ.get("XRACING_MODEL", "tiny").strip() or "tiny"
try:
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        cpu_threads=1,
        num_workers=1,
    )
    words = []
    for wav, offset in files:
        segments, _info = model.transcribe(
            wav,
            language="pt",
            beam_size=1,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            condition_on_previous_text=False,
        )
        for seg in segments:
            for word in seg.words or []:
                text = (word.word or "").strip()
                if not text:
                    continue
                words.append({
                    "w": text,
                    "s": round(float(word.start) + offset, 2),
                    "e": round(float(word.end) + offset, 2),
                    "p": round(float(word.probability), 2),
                })
    words.sort(key=lambda item: item["s"])
    print(json.dumps({"words": words}, ensure_ascii=False))
except Exception as exc:  # diagnóstico fica no log; o front nunca vê este texto
    print(json.dumps({"error": str(exc)[:400]}, ensure_ascii=False))
    sys.exit(1)
