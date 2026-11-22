import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

_HERE = os.path.dirname(os.path.abspath(__file__))
_LOCAL_DEPS = os.path.join(os.path.dirname(_HERE), ".pyhost")
if os.path.isdir(_LOCAL_DEPS) and _LOCAL_DEPS not in sys.path:
    sys.path.insert(0, _LOCAL_DEPS)

from flask import Flask, after_this_request, jsonify, request, send_file
from pytubefix import YouTube

app = Flask(__name__)
logging.getLogger("werkzeug").setLevel(logging.WARNING)
API_KEY = os.environ.get("DOWNLOAD_API_KEY", "").strip()
URL_RE = re.compile(
    r"^(https?://)?(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|live/|embed/)[\w-]{6,}|youtu\.be/[\w-]{6,})"
)


def authorized():
    if not API_KEY:
        return True
    return request.headers.get("X-Api-Key") == API_KEY or request.headers.get("Authorization") == f"Api-Key {API_KEY}"


def valid(url):
    return isinstance(url, str) and URL_RE.match(url) is not None


def body_url():
    data = request.get_json(silent=True) or {}
    return data.get("url")


def height(stream):
    match = re.sub(r"\D", "", stream.resolution or "")
    return int(match) if match else 0


CLIENTS = [c.strip() for c in os.environ.get("YT_CLIENTS", "WEB,VISION_OS,IOS,TV,ANDROID_VR").split(",") if c.strip()]


def parse_proxy_list():
    raw = os.environ.get("FUGA_PROXY_LIST") or os.environ.get("FUGA_PROXIES") or ""
    items = [p.strip() for p in re.split(r"[\s,;\n\r]+", raw) if p.strip()]
    single = os.environ.get("FUGA_PROXY", "").strip()
    if single and single not in items:
        items.append(single)
    # dedupe preservando ordem
    seen = set()
    out = []
    for p in items:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


PROXY_LIST = parse_proxy_list()
_PROXY_LOCK = threading.Lock()
_PROXY_IDX = 0


def proxy_dict(proxy_url):
    if not proxy_url:
        return None
    return {"http": proxy_url, "https": proxy_url}


def proxy_candidates():
    if not PROXY_LIST:
        return [None]
    with _PROXY_LOCK:
        start = _PROXY_IDX
    n = len(PROXY_LIST)
    return [PROXY_LIST[(start + i) % n] for i in range(n)]


def mark_proxy_good(proxy_url):
    global _PROXY_IDX
    if not proxy_url or not PROXY_LIST:
        return
    with _PROXY_LOCK:
        try:
            _PROXY_IDX = PROXY_LIST.index(proxy_url)
        except ValueError:
            pass


def open_youtube(url):
    errors = []
    for proxy_url in proxy_candidates():
        proxies = proxy_dict(proxy_url)
        label = proxy_url or "direct"
        for name in CLIENTS:
            try:
                yt = YouTube(url, client=name, proxies=proxies)
                mark_proxy_good(proxy_url)
                return yt
            except Exception as exc:
                msg = str(exc).strip().splitlines()[0][:140]
                errors.append(f"{label}/{name}: {msg}")
    raise RuntimeError(" | ".join(errors[-12:])[:900])


def pick_video(yt, resolution):
    want = int(re.sub(r"\D", "", resolution) or 0)
    progressive = yt.streams.filter(progressive=True, file_extension="mp4")
    stream = progressive.filter(resolution=resolution).first()
    if stream:
        return stream, None
    best = progressive.get_highest_resolution()
    if best:
        return best, None
    adaptive = [s for s in yt.streams.filter(adaptive=True, file_extension="mp4", only_video=True) if s.resolution]
    adaptive.sort(key=height)
    fit = [s for s in adaptive if want and height(s) <= want] or adaptive[:1]
    return (fit[-1] if fit else None), yt.streams.get_audio_only()


def mux(video_path, audio_path, out_path):
    ffmpeg = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg unavailable")
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", video_path, "-i", audio_path, "-c", "copy", "-shortest", out_path],
        check=True,
        timeout=900,
    )


@app.route("/download/<resolution>", methods=["POST"])
def download_by_resolution(resolution):
    if not authorized():
        return jsonify({"error": "Unauthorized."}), 401
    url = body_url()
    if not url:
        return jsonify({"error": "Missing 'url' parameter in the request body."}), 400
    if not valid(url):
        return jsonify({"error": "Invalid YouTube URL."}), 400
    tmp_dir = None
    try:
        yt = open_youtube(url)
        video, audio = pick_video(yt, resolution)
        if not video:
            return jsonify({"error": "Video with the specified resolution not found."}), 404
        tmp_dir = tempfile.mkdtemp(prefix="ytdl-")
        video_path = video.download(output_path=tmp_dir, filename="video.mp4")
        if not video_path or not os.path.exists(video_path):
            return jsonify({"error": "Download failed."}), 502
        final_path = video_path
        if audio is not None:
            audio_path = audio.download(output_path=tmp_dir, filename="audio.m4a")
            final_path = os.path.join(tmp_dir, "final.mp4")
            mux(video_path, audio_path, final_path)
        if not os.path.exists(final_path) or os.path.getsize(final_path) < 1024:
            return jsonify({"error": "Download failed."}), 502

        @after_this_request
        def cleanup(response):
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass
            return response

        return send_file(final_path, mimetype="video/mp4", as_attachment=True, download_name="video.mp4")
    except Exception as exc:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        return jsonify({"error": str(exc)}), 502


@app.route("/video_info", methods=["POST"])
def video_info():
    if not authorized():
        return jsonify({"error": "Unauthorized."}), 401
    url = body_url()
    if not url:
        return jsonify({"error": "Missing 'url' parameter in the request body."}), 400
    if not valid(url):
        return jsonify({"error": "Invalid YouTube URL."}), 400
    try:
        yt = open_youtube(url)
        return jsonify(
            {
                "title": yt.title,
                "author": yt.author,
                "length": yt.length,
                "views": yt.views,
                "description": yt.description,
                "publish_date": yt.publish_date.isoformat() if yt.publish_date else None,
            }
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.route("/available_resolutions", methods=["POST"])
def available_resolutions():
    if not authorized():
        return jsonify({"error": "Unauthorized."}), 401
    url = body_url()
    if not url:
        return jsonify({"error": "Missing 'url' parameter in the request body."}), 400
    if not valid(url):
        return jsonify({"error": "Invalid YouTube URL."}), 400
    try:
        yt = open_youtube(url)
        progressive = sorted(
            {s.resolution for s in yt.streams.filter(progressive=True, file_extension="mp4") if s.resolution},
            key=lambda r: int(re.sub(r"\D", "", r) or 0),
        )
        all_res = sorted(
            {s.resolution for s in yt.streams.filter(file_extension="mp4") if s.resolution},
            key=lambda r: int(re.sub(r"\D", "", r) or 0),
        )
        return jsonify({"progressive": progressive, "all": all_res})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8080")), threaded=True)
