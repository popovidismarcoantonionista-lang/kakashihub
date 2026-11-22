import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KakashiApp } from "@/routes/index";
import { STORAGE_KEY } from "@/lib/kakashi-model";

vi.mock("@/lib/kakashi-media", () => ({
  inspectVideo: vi.fn(),
  videoDuration: vi.fn().mockResolvedValue(84),
  createVideo: vi.fn(),
  saveBlob: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
});

describe("Kakashi Hub screens", () => {
  it("starts on the clips screen and exposes all five sections", () => {
    render(<KakashiApp />);

    expect(screen.getByRole("heading", { name: /^Cortes/ })).toBeInTheDocument();
    for (const tab of ["Vídeos", "Cortes", "Estúdio", "Uploads", "IA"]) {
      expect(screen.getAllByRole("button", { name: new RegExp(tab) }).length).toBeGreaterThan(0);
    }
  });

  it("navigates to Uploads and shows the local agenda and connections", () => {
    render(<KakashiApp />);

    fireEvent.click(screen.getByRole("button", { name: /^Uploads$/ }));

    expect(screen.getByRole("heading", { name: /^Uploads/ })).toBeInTheDocument();
    expect(screen.getByText("Agenda de publicação")).toBeInTheDocument();
    expect(screen.getByText("Suas conexões")).toBeInTheDocument();
  });

  it("navigates to IA and persists agent settings in the browser", async () => {
    render(<KakashiApp />);

    fireEvent.click(screen.getByRole("button", { name: /^IA$/ }));
    const agent = screen.getByRole("switch", { name: "Enquadramento" });
    const before = agent.getAttribute("aria-checked");
    fireEvent.click(agent);

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      expect(saved.settings).toBeDefined();
      expect(String(saved.settings.frameAgent)).not.toBe(before);
    });
  });
});
