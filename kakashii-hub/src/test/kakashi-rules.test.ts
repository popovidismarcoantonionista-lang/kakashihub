import { describe, expect, it } from "vitest";
import {
  acceptedVideo,
  canCut,
  initialState,
  proposeRanges,
  readState,
  validRange,
  youtubeId,
} from "@/lib/kakashi-model";

describe("Regras do estúdio", () => {
  it("aceita MP4, MOV e WEBM e rejeita outros arquivos", () => {
    expect(["a.mp4", "a.MOV", "a.webm"].every(acceptedVideo)).toBe(true);
    expect(acceptedVideo("a.exe")).toBe(false);
  });
  it("exige pelo menos um segundo por trecho", () => {
    expect(validRange(1, 1.99, 10)).toBe(false);
    expect(validRange(1, 2, 10)).toBe(true);
    expect(validRange(1, 11, 10)).toBe(false);
  });
  it("cortes vêm de vídeos enviados, nunca de lives", () => {
    const source = initialState().sources[0];
    expect(canCut(source)).toBe(true);
    expect(canCut(source ? { ...source, kind: "live" } : undefined)).toBe(false);
  });
  it("lives aceitam somente URLs de vídeos do YouTube", () => {
    expect(youtubeId("https://youtube.com/live/abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeId("https://youtube.com.evil.test/watch?v=abcdefghijk")).toBe(null);
    expect(youtubeId("https://twitch.tv/test")).toBe(null);
  });
  it("começa com o intervalo de 18 a 38 segundos", () => {
    expect(initialState().settings.min).toBe(18);
    expect(initialState().settings.max).toBe(38);
    expect(proposeRanges(84, 18, 38)).toEqual([
      { start: 0, end: 28 },
      { start: 28, end: 56 },
      { start: 56, end: 84 },
    ]);
  });
  it("preserva fontes, hooks, agenda e conexões em localStorage", () => {
    const state = initialState();
    state.settings.workspace = "Estúdio Marco";
    state.connections["YouTube"] = true;
    state.clips = state.clips.map((c) => ({ ...c, title: "Meu hook" }));
    expect(readState(JSON.stringify(state))).toEqual(state);
    expect(readState("inválido").version).toBe(2);
  });
});
