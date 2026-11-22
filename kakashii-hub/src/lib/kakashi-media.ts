import { acceptedVideo, validRange, type Frame } from "./kakashi-model";

function waitEvent(target: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Esse vídeo não abriu. Tente outro arquivo MP4 ou WEBM."));
    }, 12000);
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, ready);
      target.removeEventListener("error", fail);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("Esse vídeo não abriu. Tente outro arquivo MP4 ou WEBM."));
    };
    target.addEventListener(event, ready, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}
export async function inspectVideo(
  file: File,
): Promise<{ url: string; duration: number; thumbnail: string }> {
  if (!acceptedVideo(file.name)) throw new Error("Escolha um arquivo MP4, MOV ou WEBM.");
  const url = URL.createObjectURL(file),
    video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const loaded = waitEvent(video, "loadeddata");
  video.src = url;
  try {
    await loaded;
    if (!Number.isFinite(video.duration) || video.duration < 1)
      throw new Error("Escolha um vídeo com pelo menos 1 segundo.");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    canvas.getContext("2d")?.drawImage(video, 0, 0, 320, 180);
    return { url, duration: video.duration, thumbnail: canvas.toDataURL("image/jpeg", 0.65) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
export async function videoDuration(url: string): Promise<number> {
  const video = document.createElement("video");
  const ready = waitEvent(video, "loadedmetadata");
  video.src = url;
  try {
    await ready;
    return video.duration;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
export type MediaSegment = {
  url: string;
  start: number;
  end: number;
  hook: string;
  frame: Frame;
  captions: boolean;
};
export async function createVideo(
  segments: MediaSegment[],
  wide: boolean,
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream)
    throw new Error(
      "Este navegador não consegue gerar o vídeo. Tente o Chrome ou Edge no computador.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = wide ? 1280 : 540;
  canvas.height = wide ? 720 : 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível abrir a prévia.");
  const audio = new AudioContext();
  await audio.resume();
  const destination = audio.createMediaStreamDestination();
  const stream = canvas.captureStream(30);
  destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const mimeType = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/mp4",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    stream.getTracks().forEach((track) => track.stop());
    await audio.close();
    throw new Error("Este navegador não consegue salvar esse formato. Tente o Chrome ou Edge.");
  }
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("O vídeo foi interrompido. Tente novamente."));
  });
  const total = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  let done = 0;
  // Resolve colors from semantic tokens, not from feature-local color literals.
  const styles = getComputedStyle(document.documentElement),
    background = styles.getPropertyValue("--background").trim(),
    foreground = styles.getPropertyValue("--foreground").trim(),
    shade = styles.getPropertyValue("--media-shade").trim();
  const cover = (video: HTMLVideoElement, x: number, y: number, width: number, height: number) => {
    const ratio = Math.max(width / video.videoWidth, height / video.videoHeight),
      sw = width / ratio,
      sh = height / ratio;
    ctx.drawImage(
      video,
      (video.videoWidth - sw) / 2,
      (video.videoHeight - sh) / 2,
      sw,
      sh,
      x,
      y,
      width,
      height,
    );
  };
  let activeVideo: HTMLVideoElement | null = null;
  let frameId = 0;
  try {
    if (!segments.length) throw new Error("Selecione pelo menos um corte.");
    for (const segment of segments) {
      if (signal.aborted) throw new Error("Geração cancelada.");
      const video = document.createElement("video");
      activeVideo = video;
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.playsInline = true;
      const loaded = waitEvent(video, "loadeddata");
      video.src = segment.url;
      await loaded;
      if (!validRange(segment.start, segment.end, video.duration))
        throw new Error("Escolha um trecho com pelo menos 1 segundo, dentro do vídeo.");
      const input = audio.createMediaElementSource(video);
      input.connect(destination);
      if (segment.start > 0) {
        const seeked = waitEvent(video, "seeked");
        video.currentTime = segment.start;
        await seeked;
      }
      const draw = () => {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (wide) {
          const ratio = Math.min(
            canvas.width / video.videoWidth,
            canvas.height / video.videoHeight,
          );
          const w = video.videoWidth * ratio,
            h = video.videoHeight * ratio;
          ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        } else if (segment.frame === "Webcam acima · jogo abaixo") {
          const camWidth = video.videoWidth * 0.32,
            camHeight = video.videoHeight * 0.42;
          ctx.drawImage(video, 0, 0, camWidth, camHeight, 0, 0, canvas.width, canvas.height * 0.28);
          cover(video, 0, canvas.height * 0.28, canvas.width, canvas.height * 0.72);
        } else if (segment.frame === "Fundo desfocado") {
          ctx.filter = "blur(22px)";
          cover(video, 0, 0, canvas.width, canvas.height);
          ctx.filter = "none";
          const h = (canvas.width * video.videoHeight) / video.videoWidth;
          ctx.drawImage(video, 0, (canvas.height - h) / 2, canvas.width, h);
        } else cover(video, 0, 0, canvas.width, canvas.height);
        if (segment.captions && segment.hook) {
          ctx.font = `700 ${wide ? 34 : 30}px "Space Grotesk Variable", sans-serif`;
          ctx.textAlign = "center";
          const words = segment.hook.split(/\s+/),
            lines: string[] = [];
          let line = "";
          for (const word of words) {
            const next = `${line} ${word}`.trim();
            if (ctx.measureText(next).width > canvas.width - 60 && line) {
              lines.push(line);
              line = word;
            } else line = next;
          }
          if (line) lines.push(line);
          const top = canvas.height * 0.7;
          ctx.fillStyle = shade;
          ctx.fillRect(20, top - 35, canvas.width - 40, Math.min(lines.length, 4) * 38 + 35);
          ctx.fillStyle = foreground;
          lines
            .slice(0, 4)
            .forEach((text, index) =>
              ctx.fillText(text, canvas.width / 2, top + index * 38, canvas.width - 60),
            );
        }
      };
      draw();
      if (recorder.state === "inactive") recorder.start(250);
      await video.play();
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          cancelAnimationFrame(frameId);
          signal.removeEventListener("abort", abort);
          reject(new Error("Geração cancelada."));
        };
        signal.addEventListener("abort", abort, { once: true });
        const tick = () => {
          if (signal.aborted) {
            abort();
            return;
          }
          draw();
          progress(
            Math.min(99, ((done + Math.max(0, video.currentTime - segment.start)) / total) * 100),
          );
          if (video.error) {
            signal.removeEventListener("abort", abort);
            reject(new Error("O vídeo foi interrompido. Tente novamente."));
            return;
          }
          if (video.currentTime >= segment.end || video.ended) {
            video.pause();
            signal.removeEventListener("abort", abort);
            resolve();
            return;
          }
          frameId = requestAnimationFrame(tick);
        };
        tick();
      });
      done += segment.end - segment.start;
      input.disconnect();
      video.removeAttribute("src");
      video.load();
      activeVideo = null;
    }
    recorder.stop();
    await stopped;
    progress(100);
    return new Blob(chunks, { type: mimeType });
  } finally {
    cancelAnimationFrame(frameId);
    activeVideo?.pause();
    activeVideo?.removeAttribute("src");
    activeVideo?.load();
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audio.close();
  }
}
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "Kakashi"}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 20000);
}
