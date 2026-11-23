import { z } from "zod";

export const STORAGE_KEY = "kakashi-hub-v2";
export const LIVE_CAPTION = "";
export type Section = "Vídeos" | "Cortes" | "Estúdio" | "Uploads" | "IA";
export type Frame = "Split" | "Fundo desfocado" | "9:16 automático";
const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel: z.string(),
  kind: z.enum(["video", "live"]),
  duration: z.number().nonnegative(),
  thumbnail: z.string(),
  url: z.string().optional(),
  fileName: z.string().optional(),
  size: z.number().optional(),
  demo: z.boolean().optional(),
  moments: z.array(z.number()).default([]),
});
const clipSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  score: z.number(),
  type: z.string(),
  frame: z.enum(["Split", "Fundo desfocado", "9:16 automático"]),
  approved: z.boolean(),
  createdAt: z.number(),
});
const longSchema = z.object({
  id: z.string(),
  title: z.string(),
  clipIds: z.array(z.string()),
  createdAt: z.number(),
});
const scheduleSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  title: z.string(),
  platform: z.string(),
  when: z.string(),
  status: z.enum(["Na fila", "Lembrete", "Publicado"]),
});
export const stateSchema = z.object({
  version: z.literal(2),
  sources: z.array(sourceSchema),
  clips: z.array(clipSchema),
  longs: z.array(longSchema),
  schedule: z.array(scheduleSchema),
  connections: z.record(z.string(), z.boolean()),
  settings: z.object({
    workspace: z.string(),
    min: z.number().min(1).max(120),
    max: z.number().min(1).max(120),
    style: z.string(),
    frameAgent: z.boolean(),
    approvalAgent: z.boolean(),
    captionAgent: z.boolean(),
    rankingAgent: z.boolean(),
  }),
});
export type Source = z.infer<typeof sourceSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type LongVideo = z.infer<typeof longSchema>;
export type HubState = z.infer<typeof stateSchema>;
export const DEMO_VIDEO = "/site-assets/bdea23661e9a6a94.mp4";
export function initialState(): HubState {
  return {
    version: 2,
    sources: [
      {
        id: "demo-1",
        title: "A fuga que ninguém esperava",
        channel: "Meu estúdio",
        kind: "video",
        duration: 60,
        thumbnail: "/site-assets/a2bd191c29cd3d2d.jpg",
        demo: true,
        moments: [],
      },
      {
        id: "demo-2",
        title: "Só mais uma partida…",
        channel: "Meu estúdio",
        kind: "video",
        duration: 60,
        thumbnail: "/site-assets/9f543090ed87d0cf.jpg",
        demo: true,
        moments: [],
      },
    ],
    clips: [
      {
        id: "clip-1",
        sourceId: "demo-1",
        title: "NINGUÉM ACREDITOU NESSA FUGA",
        start: 0,
        end: 18,
        score: 96,
        type: "Perseguição",
        frame: "Split",
        approved: true,
        createdAt: 4,
      },
      {
        id: "clip-2",
        sourceId: "demo-2",
        title: "ERA SÓ UMA PARTIDA TRANQUILA…",
        start: 4,
        end: 28,
        score: 92,
        type: "Games",
        frame: "9:16 automático",
        approved: true,
        createdAt: 3,
      },
      {
        id: "clip-3",
        sourceId: "demo-1",
        title: "O FINAL MUDOU TUDO",
        start: 10,
        end: 38,
        score: 89,
        type: "Perseguição",
        frame: "Fundo desfocado",
        approved: false,
        createdAt: 2,
      },
      {
        id: "clip-4",
        sourceId: "demo-2",
        title: "VOCÊ TAMBÉM FARIA ISSO?",
        start: 18,
        end: 56,
        score: 85,
        type: "Games",
        frame: "9:16 automático",
        approved: false,
        createdAt: 1,
      },
    ],
    longs: [],
    schedule: [],
    connections: { YouTube: false, Twitch: false, Kick: false, TikTok: false },
    settings: {
      workspace: "Meu estúdio",
      min: 18,
      max: 38,
      style: "Games",
      frameAgent: true,
      approvalAgent: false,
      captionAgent: true,
      rankingAgent: true,
    },
  };
}
export function readState(raw: string | null): HubState {
  if (!raw) return initialState();
  try {
    return stateSchema.parse(JSON.parse(raw));
  } catch {
    return initialState();
  }
}
export function youtubeId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    ) {
      const parts = url.pathname.split("/");
      id =
        url.searchParams.get("v") ??
        (["live", "embed", "shorts"].includes(parts[1] ?? "") ? (parts[2] ?? null) : null);
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function canCut(source: Source | undefined): boolean {
  return source?.kind === "video";
}
export function validRange(start: number, end: number, duration: number): boolean {
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end <= duration &&
    end - start >= 1
  );
}
export function acceptedVideo(name: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(name);
}
export function formatTime(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
}
export function proposeRanges(
  duration: number,
  min: number,
  max: number,
): Array<{ start: number; end: number }> {
  if (duration < 1) return [];
  const length = Math.min(duration, Math.max(1, Math.min(max, (min + max) / 2)));
  const count = Math.min(6, Math.max(1, Math.floor(duration / length)));
  return Array.from({ length: count }, (_, index) => ({
    start: index * length,
    end: Math.min(duration, (index + 1) * length),
  }));
}
