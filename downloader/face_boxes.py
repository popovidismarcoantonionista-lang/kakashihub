"""Detecção de rosto grátis para o blur do estilo XRacing.

Roda antes do ffmpeg (fora da codificação) e imprime JSON com regiões:
[{"x":..,"y":..,"w":..,"h":..,"start":..,"end":..}]
Os tempos são relativos ao início do corte, porque o ffmpeg usa -ss antes de -i.
O Haar cascade vem dentro do próprio opencv-python-headless; sem modelo externo.
"""
import json
import sys

try:
    import cv2
except Exception:
    print('[]')
    raise SystemExit(0)


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0


def main():
    if len(sys.argv) < 4:
        print('[]')
        return
    video = sys.argv[1]
    start = max(0.0, float(sys.argv[2] or 0))
    duration = max(1.0, float(sys.argv[3] or 1))
    cam = None
    if len(sys.argv) > 4 and sys.argv[4].strip():
        try:
            cam = json.loads(sys.argv[4])
        except Exception:
            cam = None

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print('[]')
        return
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if frame_w <= 0 or frame_h <= 0:
        cap.release()
        print('[]')
        return

    ox = oy = 0
    roi_w, roi_h = frame_w, frame_h
    if cam:
        ox = max(0, min(frame_w - 1, int(float(cam.get('x', 0)))))
        oy = max(0, min(frame_h - 1, int(float(cam.get('y', 0)))))
        roi_w = max(32, min(frame_w - ox, int(float(cam.get('w', frame_w)))))
        roi_h = max(32, min(frame_h - oy, int(float(cam.get('h', frame_h)))))

    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )
    if cascade.empty():
        cap.release()
        print('[]')
        return

    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    step = 0.5
    hold = 1.2
    skip = max(1, int(round(step * fps)))
    samples = []
    t = 0.0
    min_face = (max(20, int(roi_w * 0.06)), max(20, int(roi_h * 0.06)))
    while t < duration:
        ok, frame = cap.read()
        if not ok:
            break
        roi = frame[oy:oy + roi_h, ox:ox + roi_w] if cam else frame
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=3, minSize=min_face
        )
        boxes = []
        for (x, y, w, h) in faces:
            pad = 0.28
            x0 = max(0, ox + int(x - w * pad))
            y0 = max(0, oy + int(y - h * pad))
            x1 = min(frame_w, ox + int(x + w * (1 + pad)))
            y1 = min(frame_h, oy + int(y + h * (1 + pad)))
            boxes.append([x0, y0, x1 - x0, y1 - y0])
        samples.append((t, boxes))
        for _ in range(skip):
            cap.read()
        t += step
    cap.release()

    regions = []
    for t, boxes in samples:
        for box in boxes:
            for region in regions:
                if region['end'] >= t - 0.05 and iou(box, [region['x'], region['y'], region['w'], region['h']]) > 0.3:
                    x2 = max(region['x'] + region['w'], box[0] + box[2])
                    y2 = max(region['y'] + region['h'], box[1] + box[3])
                    region['x'] = min(region['x'], box[0])
                    region['y'] = min(region['y'], box[1])
                    region['w'] = x2 - region['x']
                    region['h'] = y2 - region['y']
                    region['end'] = min(duration, t + hold)
                    break
            else:
                regions.append({
                    'x': box[0], 'y': box[1], 'w': box[2], 'h': box[3],
                    'start': round(t, 2), 'end': round(min(duration, t + hold), 2),
                })

    regions.sort(key=lambda r: -(r['w'] * r['h']))
    print(json.dumps(regions[:6]))


if __name__ == '__main__':
    main()
