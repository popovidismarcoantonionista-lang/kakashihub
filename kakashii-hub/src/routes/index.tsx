import { useEffect, useState, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import capturedCSS from "../styles/source-layout.css?raw";
import studioCSS from "../styles/kakashi.css?raw";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Bell,
  SlidersHorizontal,
  Plus,
  Play,
  Scissors,
  Clapperboard,
  Upload,
  Sparkles,
  Radio,
  ChevronDown,
  ArrowUpRight,
  Check,
  Clock,
  MoreHorizontal,
  Trash2,
  Bookmark,
  Film,
  Eye,
  ShieldCheck,
  Captions,
  TrendingUp,
  X,
  LoaderCircle,
  Save,
  Pause,
  Layers,
  Video,
  GripHorizontal,
} from "lucide-react";
import {
  initialState,
  readState,
  STORAGE_KEY,
  LIVE_CAPTION,
  DEMO_VIDEO,
  youtubeId,
  acceptedVideo,
  canCut,
  validRange,
  formatTime,
  proposeRanges,
  type HubState,
  type Source,
  type Clip,
  type Section,
  type Frame,
} from "@/lib/kakashi-model";
import {
  inspectVideo,
  videoDuration,
  createVideo,
  saveBlob,
  type MediaSegment,
} from "@/lib/kakashi-media";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kakashi Hub — seu estúdio de cortes" },
      {
        name: "description",
        content: "Estúdio Kakashi Hub para vídeos, cortes, lives e publicação.",
      },
      { property: "og:title", content: "Kakashi Hub — seu estúdio de cortes" },
      {
        property: "og:description",
        content: "Estúdio Kakashi Hub para vídeos, cortes, lives e publicação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  staticData: { importedDocument: { html: { lang: "pt-BR" }, body: {} } },
  component: KakashiApp,
});

function Index() {
  useImportedLayout();
  const [view, setView] = useState("Cortes");
  const [popup, setPopup] = useState("");
  const [sort, setSort] = useState("Score");
  const [sortOpen, setSortOpen] = useState(false);
  const [filter, setFilter] = useState("Todos");
  const [notice, setNotice] = useState("");
  const [date, setDate] = useState("");
  const focusReturn = useRef<HTMLElement | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setDate(
      new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
        .format(new Date())
        .replace(" de ", " DE ")
        .replace(" de ", " · ")
        .replace(".", "")
        .toUpperCase(),
    );
  }, []);
  const close = () => {
    setPopup("");
    focusReturn.current?.focus();
  };
  useEffect(() => {
    if (!popup) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopup("");
        focusReturn.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          overlay.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([hidden]), [tabindex="0"]',
          ) ?? [],
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handler);
    };
  }, [popup]);
  const onAction = (name: string, element: HTMLElement) => {
    if (["Vídeos", "Cortes", "Estúdio", "Uploads", "IA"].includes(name)) {
      setView(name);
      window.scrollTo(0, 0);
      return;
    }
    if (name === "Ajustes" || name.includes("Meu estúdio")) {
      setView("IA");
      return;
    }
    if (name === "Início") {
      setView("Cortes");
      return;
    }
    if (name === "Fechar" || name === "Cancelar") {
      close();
      return;
    }
    if (name === "Notificações" || name === "Perfil") return;
    if (name === "Configurar") {
      const platform =
        element.closest(".conn-card")?.textContent ??
        element.parentElement?.textContent ??
        "YouTube";
      focusReturn.current = element;
      setPopup(
        platform.includes("TikTok")
          ? "Tiktok"
          : platform.includes("Facebook")
            ? "Facebook"
            : "Youtube",
      );
      return;
    }
    if (name === "Agendar publicação") {
      focusReturn.current = element;
      setPopup("Schedule");
      return;
    }
    if (
      name === "Conectar fonte" ||
      name === "Nova fonte" ||
      name === "Adicionar vídeo ou live" ||
      name === "Enviar vídeo" ||
      name === "Monitorar live" ||
      name === "Monitorar"
    ) {
      if (popup) {
        if (name === "Monitorar live" && element.closest(".ingest-tabs")) return;
        if (name === "Enviar vídeo" && element.closest(".ingest-tabs")) return;
        setNotice("Envio e processamento indisponíveis nesta importação.");
        return;
      }
      focusReturn.current = element;
      setPopup("Source");
      return;
    }
    if (name === "Salvar e conectar") {
      setNotice("Conexão de contas indisponível nesta importação.");
      return;
    }
    if (name === "Aplicar estilo") {
      setNotice("O serviço de análise não está conectado nesta importação.");
      return;
    }
  };
  return (
    <>
      <style>{capturedCSS}</style>
      <div id="root">
        <div
          className="pointer-events-none fixed [inset:0px] [overflow:hidden] [z-index:0]"
          aria-hidden="true"
        >
          <video
            className={
              "\x62g-video min-w-[177.78vh] object-cover absolute [inset:50%_auto_auto_50%] [min-height:100vh] [@media(prefers-reduced-motion:reduce)]:hidden"
            }
            autoPlay
            loop
            playsInline
            preload="auto"
            poster="/site-assets/cccd331e96ba367b.jpg"
            muted
          >
            <source src="/site-assets/bdea23661e9a6a94.mp4" type="video/mp4" />
          </video>
          <img
            className={
              "\x62g-still min-w-[177.78vh] object-cover absolute [inset:50%_auto_auto_50%] [min-height:100vh]"
            }
            src="/site-assets/cccd331e96ba367b.jpg"
            alt=""
          />
          <div className={"\x62g-scrim absolute [inset:0px]"} />
        </div>
        <div className="relative [min-height:100vh] [z-index:1]">
          <ImportedHeader onAction={onAction} view={view} date={date} />
          <main className="main max-w-[1540px] [margin:0px_auto]">
            {view === "Vídeos" ? (
              <VideosView onAction={onAction} />
            ) : view === "Estúdio" ? (
              <StudioView onAction={onAction} />
            ) : view === "Uploads" ? (
              <UploadsView onAction={onAction} />
            ) : view === "IA" ? (
              <AgentsView onAction={onAction} />
            ) : (
              <div
                className="[animation:0.45s_cubic-bezier(0.2,0.7,0.2,1)_0s_1_normal_both_running_pageIn]"
                style={{ transform: "translateY(0px)", opacity: "1" }}
              >
                <div className="page-head flex justify-between [@media(max-width:620px)]:flex-col [@media(max-width:860px)]:flex-col">
                  <div>
                    <div className="kicker uppercase [font-family:var(--font-mono)] [font-size:9px] [letter-spacing:0.18em]">
                      ACERVO · 0 CORTES
                    </div>
                    <h1 className="[font-family:var(--font-display)] [letter-spacing:-0.035em] [line-height:1.05] [@media(max-width:620px)]:wrap-anywhere">
                      Cortes
                    </h1>
                  </div>
                  <div className="page-actions items-center flex gap-[9px] [flex-shrink:0] [@media(max-width:620px)]:flex-wrap [@media(max-width:860px)]:flex-wrap">
                    <button
                      className="btn btn-ghost items-center gap-[7px] justify-center whitespace-nowrap [font-size:12px] [font-weight:600] [letter-spacing:0.01em] [transition:transform_0.16s,box-shadow_0.16s,background_0.16s,border-color_0.16s,color_0.16s] [@media(max-width:620px)]:min-h-[38px]"
                      disabled
                    >
                      <svg
                        className="flex-none"
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <path d="M7 3v18" />
                        <path d="M3 7.5h4" />
                        <path d="M3 12h18" />
                        <path d="M3 16.5h4" />
                        <path d="M17 3v18" />
                        <path d="M17 7.5h4" />
                        <path d="M17 16.5h4" />
                      </svg>{" "}
                      Vídeo longo
                    </button>
                    <button
                      onClick={(event) => onAction("Nova fonte", event.currentTarget)}
                      className="btn btn-primary items-center gap-[7px] justify-center whitespace-nowrap [font-size:12px] [font-weight:600] [letter-spacing:0.01em] [transition:transform_0.16s,box-shadow_0.16s,background_0.16s,border-color_0.16s,color_0.16s] [@media(max-width:620px)]:min-h-[38px]"
                    >
                      <svg
                        className="flex-none"
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>{" "}
                      Nova fonte
                    </button>
                  </div>
                </div>
                <div className="stats-row grid">
                  <div className="stat panel flex flex-col gap-[7px] [backdrop-filter:blur(18px)_saturate(125%)] [overflow:hidden]">
                    <div className="items-center flex gap-[8px] justify-between">
                      <span className="stat-label uppercase [font-family:var(--font-mono)]">
                        Cortes no radar
                      </span>
                    </div>
                    <div className="stat-value [font-family:var(--font-display)] [font-weight:600] [letter-spacing:-0.03em] [line-height:1]">
                      00
                    </div>
                    <svg
                      className="spark mt-[2px]"
                      viewBox="0 0 100 30"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polyline
                        points=""
                        fill="none"
                        stroke="var(--tone-violet)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polygon points="0,30  100,30" fill="var(--tone-violet)" opacity=".08" />
                    </svg>
                  </div>
                  <div className="stat panel tone-amber flex flex-col gap-[7px] [backdrop-filter:blur(18px)_saturate(125%)] [overflow:hidden]">
                    <div className="items-center flex gap-[8px] justify-between">
                      <span className="stat-label uppercase [font-family:var(--font-mono)]">
                        Melhor score
                      </span>
                    </div>
                    <div className="stat-value [font-family:var(--font-display)] [font-weight:600] [letter-spacing:-0.03em] [line-height:1]">
                      —
                    </div>
                    <svg
                      className="spark mt-[2px]"
                      viewBox="0 0 100 30"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polyline
                        points=""
                        fill="none"
                        stroke="var(--tone-amber)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polygon points="0,30  100,30" fill="var(--tone-amber)" opacity=".08" />
                    </svg>
                  </div>
                  <div className="stat panel tone-green flex flex-col gap-[7px] [backdrop-filter:blur(18px)_saturate(125%)] [overflow:hidden]">
                    <div className="items-center flex gap-[8px] justify-between">
                      <span className="stat-label uppercase [font-family:var(--font-mono)]">
                        Duração média
                      </span>
                    </div>
                    <div className="stat-value [font-family:var(--font-display)] [font-weight:600] [letter-spacing:-0.03em] [line-height:1]">
                      0s
                    </div>
                    <svg
                      className="spark mt-[2px]"
                      viewBox="0 0 100 30"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polyline
                        points=""
                        fill="none"
                        stroke="var(--tone-green)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polygon points="0,30  100,30" fill="var(--tone-green)" opacity=".08" />
                    </svg>
                  </div>
                  <div className="stat panel tone-red flex flex-col gap-[7px] [backdrop-filter:blur(18px)_saturate(125%)] [overflow:hidden]">
                    <div className="items-center flex gap-[8px] justify-between">
                      <span className="stat-label uppercase [font-family:var(--font-mono)]">
                        Tipos no acervo
                      </span>
                    </div>
                    <div className="stat-value [font-family:var(--font-display)] [font-weight:600] [letter-spacing:-0.03em] [line-height:1]">
                      0
                    </div>
                    <svg
                      className="spark mt-[2px]"
                      viewBox="0 0 100 30"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <polyline
                        points="0,16 12.5,16 25,16 37.5,16 50,16 62.5,16 75,16 87.5,16 100,16"
                        fill="none"
                        stroke="var(--tone-red)"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polygon
                        points="0,30 0,16 12.5,16 25,16 37.5,16 50,16 62.5,16 75,16 87.5,16 100,16 100,30"
                        fill="var(--tone-red)"
                        opacity=".08"
                      />
                    </svg>
                  </div>
                </div>
                <div className="toolbar flex flex-wrap">
                  <div
                    className={
                      "\x66ilter-search items-center flex gap-[7px] [padding:0px_10px] [@media(max-width:620px)]:flex-[1_1_100%]"
                    }
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                    <input placeholder="Filtrar por gancho ou hashtag" defaultValue="" />
                  </div>
                  <div className="segmented scrollable items-center gap-[2px] p-[3px] [max-width:100%] [overflow-x:auto] [scrollbar-width:none] [@media(max-width:620px)]:flex-[1_1_100%]">
                    <button
                      onClick={() => setFilter("Todos")}
                      className={
                        "items-center inline-flex gap-[6px] whitespace-nowrap [font-size:10.5px] [font-weight:500] [transition:0.16s]" +
                        (filter === "Todos" ? " active" : "")
                      }
                    >
                      {"Todos"}{" "}
                      <i className="not-italic [font-family:var(--font-mono)] [font-size:7.5px]">
                        0
                      </i>
                    </button>
                    <button
                      onClick={() => setFilter("Fuga")}
                      className={
                        "items-center inline-flex gap-[6px] whitespace-nowrap [font-size:10.5px] [font-weight:500] [transition:0.16s]" +
                        (filter === "Fuga" ? " active" : "")
                      }
                    >
                      {"Fuga"}{" "}
                      <i className="not-italic [font-family:var(--font-mono)] [font-size:7.5px]">
                        0
                      </i>
                    </button>
                    <button
                      onClick={() => setFilter("Enquadro")}
                      className={
                        "items-center inline-flex gap-[6px] whitespace-nowrap [font-size:10.5px] [font-weight:500] [transition:0.16s]" +
                        (filter === "Enquadro" ? " active" : "")
                      }
                    >
                      {"Enquadro"}{" "}
                      <i className="not-italic [font-family:var(--font-mono)] [font-size:7.5px]">
                        0
                      </i>
                    </button>
                    <button
                      onClick={() => setFilter("Persegui\u00e7\u00e3o")}
                      className={
                        "items-center inline-flex gap-[6px] whitespace-nowrap [font-size:10.5px] [font-weight:500] [transition:0.16s]" +
                        (filter === "Persegui\u00e7\u00e3o" ? " active" : "")
                      }
                    >
                      {"Persegui\u00e7\u00e3o"}{" "}
                      <i className="not-italic [font-family:var(--font-mono)] [font-size:7.5px]">
                        0
                      </i>
                    </button>
                    <button
                      onClick={() => setFilter("Abordagem")}
                      className={
                        "items-center inline-flex gap-[6px] whitespace-nowrap [font-size:10.5px] [font-weight:500] [transition:0.16s]" +
                        (filter === "Abordagem" ? " active" : "")
                      }
                    >
                      {"Abordagem"}{" "}
                      <i className="not-italic [font-family:var(--font-mono)] [font-size:7.5px]">
                        0
                      </i>
                    </button>
                  </div>
                  <div className="flex-1 [@media(max-width:620px)]:hidden" />
                  <span className="tool-label uppercase [font-family:var(--font-mono)] [font-size:8px] [letter-spacing:0.12em] [@media(max-width:620px)]:hidden">
                    Ordenar
                  </span>
                  <div className="select relative [@media(max-width:620px)]:flex-[1_1_100%] [@media(max-width:620px)]:[max-width:100%]">
                    <button
                      onClick={() => setSortOpen(!sortOpen)}
                      aria-expanded={sortOpen}
                      className="select-btn items-center inline-flex gap-[8px] [font-size:11px] [transition:0.16s]"
                      type="button"
                    >
                      <span className="text-ellipsis whitespace-nowrap [overflow:hidden]">
                        {sort}
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {sortOpen && (
                      <div className="select-pop">
                        {["Score", "Recentes", "Duração"].map((option) => (
                          <button
                            className="select-option"
                            key={option}
                            onClick={() => {
                              setSort(option);
                              setSortOpen(false);
                            }}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="empty items-center flex flex-col gap-[8px] text-center [backdrop-filter:blur(12px)_saturate(120%)]">
                  <div className="empty-icon grid mb-[4px] place-items-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="6" cy="6" r="3" />
                      <path d="M8.12 8.12 12 12" />
                      <path d="M20 4 8.12 15.88" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M14.8 14.8 20 20" />
                    </svg>
                  </div>
                  <h3 className="[font-family:var(--font-display)] [font-size:17px] [letter-spacing:-0.02em]">
                    Seu acervo está vazio
                  </h3>
                  <p className="max-w-[360px] [font-size:11.5px] [line-height:1.6]" />
                  <button
                    onClick={(event) => onAction("Conectar fonte", event.currentTarget)}
                    className="btn btn-primary items-center gap-[7px] justify-center mt-[8px] whitespace-nowrap [font-size:12px] [font-weight:600] [letter-spacing:0.01em] [transition:transform_0.16s,box-shadow_0.16s,background_0.16s,border-color_0.16s,color_0.16s] [@media(max-width:620px)]:min-h-[38px]"
                  >
                    <svg
                      className="flex-none"
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
                      <line x1="8" x2="16" y1="12" y2="12" />
                    </svg>{" "}
                    Conectar fonte
                  </button>
                </div>
                <div className="cortes-foot flex justify-between mt-[26px] pt-[16px] [@media(max-width:620px)]:flex-col">
                  <span className="mono [font-family:var(--font-mono)] [font-size:9px] [letter-spacing:0.08em]">
                    0 de 0 cortes
                  </span>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
      {popup && (
        <div
          ref={overlay}
          className="overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          {popup === "Source" ? (
            <SourcePopup onAction={onAction} />
          ) : popup === "Schedule" ? (
            <SchedulePopup onAction={onAction} />
          ) : popup === "Youtube" ? (
            <YoutubePopup onAction={onAction} />
          ) : popup === "Tiktok" ? (
            <TiktokPopup onAction={onAction} />
          ) : (
            <FacebookPopup onAction={onAction} />
          )}
        </div>
      )}
      {notice && (
        <div className="toasts" role="status">
          <div className="toast toast-error">
            <span>{notice}</span>
            <button className="btn-icon" aria-label="Fechar aviso" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        </div>
      )}
      <div className="toasts flex flex-col gap-[8px] fixed [z-index:300] [@media(max-width:620px)]:left-[12px]" />
    </>
  );
}

function ImportedHeader({ onAction, view, date }: ViewProps & { view: string; date: string }) {
  return (
    <header className="head sticky [backdrop-filter:blur(26px)_saturate(140%)] [top:0px] [z-index:60]">
      <div className="topbar items-center flex">
        <button
          onClick={(event) => onAction("In\u00edcio", event.currentTarget)}
          className="brand items-center flex [@media(max-width:620px)]:[min-width:0px]"
          aria-label="Início"
        >
          <div
            className="logo-mark sharingan grid flex-none place-items-center relative"
            style={{ width: "30px", height: "30px" }}
          >
            <svg
              className={"[&]:block"}
              viewBox="0 0 40 40"
              width="30"
              height="30"
              aria-hidden="true"
            >
              <defs>
                <radialGradient id="sharingan-iris" cx="50%" cy="42%" r="62%">
                  <stop offset="0" stopColor="#ff6b5e" />
                  <stop offset="0.5" stopColor="#e03131" />
                  <stop offset="1" stopColor="#8b0f0f" />
                </radialGradient>
              </defs>
              <circle
                cx="20"
                cy="20"
                r="16.2"
                fill="url(#sharingan-iris)"
                stroke="#2a0505"
                strokeWidth="2"
              />
              <circle cx="20" cy="20" r="3.4" fill="#0b0404" />
              <g fill="#0b0404">
                <g transform="translate(20 20) rotate(0) translate(0 -9.4)">
                  <path d="M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z" />
                </g>
                <g transform="translate(20 20) rotate(120) translate(0 -9.4)">
                  <path d="M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z" />
                </g>
                <g transform="translate(20 20) rotate(240) translate(0 -9.4)">
                  <path d="M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z" />
                </g>
              </g>
            </svg>
            <span className="logo-glow inset-[-10px] absolute [filter:blur(4px)] [z-index:-1]" />
          </div>
          <div className="brand-word items-start flex flex-col gap-[3px] [line-height:1]">
            <b className="[font-family:var(--font-display)] [font-weight:700]">KAKASHI</b>
            <span className="[font-family:var(--font-mono)] [font-size:7.5px] [letter-spacing:0.34em]">
              HUB
            </span>
          </div>
        </button>
        <div className={"\x74op-sep [margin:0px_4px]"} />
        <button
          onClick={(event) => onAction("Ajustes", event.currentTarget)}
          className="workspace items-center gap-[9px] [transition:0.18s]"
        >
          <span className="ws-avatar grid flex-none place-items-center [font-family:var(--font-mono)] [font-size:8.5px] [font-weight:600]">
            RF
          </span>
          <span className="ws-text items-start flex flex-col [line-height:1.2]">
            <b className="text-ellipsis whitespace-nowrap [font-size:12px] [font-weight:600] [overflow:hidden]">
              Meu estúdio
            </b>
            <em className="not-italic text-ellipsis whitespace-nowrap [font-family:var(--font-mono)] [font-size:8px] [max-width:100%] [overflow:hidden]">
              Fuga · Enquadro · Perseguição
            </em>
          </span>
          <svg
            className="ws-gear ml-[2px]"
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 7h-9" />
            <path d="M14 17H5" />
            <circle cx="17" cy="17" r="3" />
            <circle cx="7" cy="7" r="3" />
          </svg>
        </button>
        <div className="flex-1" />
        <div className="search items-center gap-[8px] relative [padding:0px_10px] [transition:0.18s]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="flex-1 [min-width:0px]"
            placeholder="Buscar cortes e fontes…"
            defaultValue=""
          />
          <kbd className="[font-family:var(--font-mono)] [font-size:8.5px] [padding:2px_5px]">
            ⌘K
          </kbd>
        </div>
        <div
          className="radar items-center gap-[7px] uppercase whitespace-nowrap [font-family:var(--font-mono)] [font-size:8.5px] [letter-spacing:0.06em] [padding:0px_10px]"
          title="Tudo pronto por aqui"
        >
          <i className="dot inline-block flex-none [animation:2s_ease_0s_infinite_normal_none_running_pulseDot]" />
          Estúdio pronto
        </div>
        <button
          onClick={(event) => onAction("Notifica\u00e7\u00f5es", event.currentTarget)}
          className="btn-icon flex-none place-items-center relative [transition:0.16s]"
          aria-label="Notificações"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.268 21a2 2 0 0 0 3.464 0" />
            <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
          </svg>
          <i className="notif absolute right-[8px] top-[8px]" />
        </button>
        <button
          onClick={(event) => onAction("Ajustes", event.currentTarget)}
          className="btn-icon flex-none place-items-center relative [transition:0.16s]"
          aria-label="Ajustes"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 7h-9" />
            <path d="M14 17H5" />
            <circle cx="17" cy="17" r="3" />
            <circle cx="7" cy="7" r="3" />
          </svg>
        </button>
        <button
          onClick={(event) => onAction("Perfil", event.currentTarget)}
          className="avatar ml-[2px] place-items-center [transition:0.18s]"
          aria-label="Perfil"
        >
          <div
            className="logo-mark sharingan grid flex-none place-items-center relative"
            style={{ width: "22px", height: "22px" }}
          >
            <svg
              className={"[&]:block [transition:transform_0.35s]"}
              viewBox="0 0 40 40"
              width="22"
              height="22"
              aria-hidden="true"
            >
              <defs>
                <radialGradient id="sharingan-iris" cx="50%" cy="42%" r="62%">
                  <stop offset="0" stopColor="#ff6b5e" />
                  <stop offset="0.5" stopColor="#e03131" />
                  <stop offset="1" stopColor="#8b0f0f" />
                </radialGradient>
              </defs>
              <circle
                cx="20"
                cy="20"
                r="16.2"
                fill="url(#sharingan-iris)"
                stroke="#2a0505"
                strokeWidth="2"
              />
              <circle cx="20" cy="20" r="3.4" fill="#0b0404" />
              <g fill="#0b0404">
                <g transform="translate(20 20) rotate(0) translate(0 -9.4)">
                  <path d="M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z" />
                </g>
                <g transform="translate(20 20) rotate(120) translate(0 -9.4)">
                  <path d="M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z" />
                </g>
                <g transform="translate(20 20) rotate(240) translate(0 -9.4)">
                  <path d="M 0 -3 C 3 -3 5 -1 5 1.4 C 5 3.2 3.6 4.4 2 4.2 C 2.6 2.8 2.4 1.4 1.6 0.4 C 0.8 -0.6 -0.6 -1 -2 -0.6 Z" />
                </g>
              </g>
            </svg>
            <span className="logo-glow inset-[-4px] absolute [filter:blur(4px)] [z-index:-1]" />
          </div>
        </button>
        <button
          onClick={(event) => onAction("Adicionar v\u00eddeo ou live", event.currentTarget)}
          className="btn btn-primary btn-sm mobile-new-source items-center gap-[6px] justify-center whitespace-nowrap [font-size:11px] [font-weight:600] [letter-spacing:0.01em] [transition:transform_0.16s,box-shadow_0.16s,background_0.16s,border-color_0.16s,color_0.16s] [@media(max-width:620px)]:min-h-[32px] [@media(max-width:620px)]:[margin-left:auto]"
          aria-label="Adicionar vídeo ou live"
        >
          <svg
            className="flex-none"
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          <span className="[@media(max-width:620px)]:hidden">Adicionar vídeo ou live</span>
          <span className="label-short">Adicionar</span>
        </button>
      </div>
      <div className="tabbar items-center flex justify-between">
        <nav className="tabs items-stretch [overflow-x:auto] [scrollbar-width:none] [@media(max-width:620px)]:justify-between">
          <button
            onClick={(event) => onAction("V\u00eddeos", event.currentTarget)}
            className={
              "tab items-center inline-flex uppercase whitespace-nowrap [transition:color_0.16s] [@media(max-width:620px)]:flex-1 [@media(max-width:620px)]:justify-center [@media(max-width:620px)]:[min-width:0px]" +
              (view === "V\u00eddeos" ? " active" : "")
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
              <path d="m10 15 5-3-5-3z" />
            </svg>
            <span>Vídeos</span>
          </button>
          <button
            onClick={(event) => onAction("Cortes", event.currentTarget)}
            className={
              "tab items-center inline-flex uppercase whitespace-nowrap [transition:color_0.16s] [@media(max-width:620px)]:flex-1 [@media(max-width:620px)]:justify-center [@media(max-width:620px)]:[min-width:0px]" +
              (view === "Cortes" ? " active" : "")
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="6" r="3" />
              <path d="M8.12 8.12 12 12" />
              <path d="M20 4 8.12 15.88" />
              <circle cx="6" cy="18" r="3" />
              <path d="M14.8 14.8 20 20" />
            </svg>
            <span>Cortes</span>
          </button>
          <button
            onClick={(event) => onAction("Est\u00fadio", event.currentTarget)}
            className={
              "tab items-center inline-flex uppercase whitespace-nowrap [transition:color_0.16s] [@media(max-width:620px)]:flex-1 [@media(max-width:620px)]:justify-center [@media(max-width:620px)]:[min-width:0px]" +
              (view === "Est\u00fadio" ? " active" : "")
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
              <path d="m6.2 5.3 3.1 3.9" />
              <path d="m12.4 3.4 3.1 4" />
              <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            <span>Estúdio</span>
          </button>
          <button
            onClick={(event) => onAction("Uploads", event.currentTarget)}
            className={
              "tab items-center inline-flex uppercase whitespace-nowrap [transition:color_0.16s] [@media(max-width:620px)]:flex-1 [@media(max-width:620px)]:justify-center [@media(max-width:620px)]:[min-width:0px]" +
              (view === "Uploads" ? " active" : "")
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 13v8" />
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="m8 17 4-4 4 4" />
            </svg>
            <span>Uploads</span>
          </button>
          <button
            onClick={(event) => onAction("IA", event.currentTarget)}
            className={
              "tab items-center inline-flex uppercase whitespace-nowrap [transition:color_0.16s] [@media(max-width:620px)]:flex-1 [@media(max-width:620px)]:justify-center [@media(max-width:620px)]:[min-width:0px]" +
              (view === "IA" ? " active" : "")
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              <path d="M20 3v4" />
              <path d="M22 5h-4" />
              <path d="M4 17v2" />
              <path d="M5 18H3" />
            </svg>
            <span>IA</span>
          </button>
        </nav>
        <div className="tab-right items-center flex-none gap-[12px]">
          <span className="date-chip mono [font-family:var(--font-mono)] [font-size:8.5px] [letter-spacing:0.1em] [padding:4px_7px]">
            {date}
          </span>
          <button
            onClick={(event) => onAction("Adicionar v\u00eddeo ou live", event.currentTarget)}
            className="btn btn-primary btn-sm items-center gap-[6px] justify-center whitespace-nowrap [font-size:11px] [font-weight:600] [letter-spacing:0.01em] [transition:transform_0.16s,box-shadow_0.16s,background_0.16s,border-color_0.16s,color_0.16s] [@media(max-width:620px)]:min-h-[32px]"
            aria-label="Adicionar vídeo ou live"
          >
            <svg
              className="flex-none"
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span className="[@media(max-width:620px)]:hidden">Adicionar vídeo ou live</span>
            <span className="label-short">Adicionar</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function useImportedLayout() {
  useEffect(() => {
    const loopingVideos = Array.from(
      document.querySelectorAll<HTMLVideoElement>("video[loop]:not([autoplay]):not([controls])"),
    )
      .filter((video) => video.muted && !video.closest("[data-site-import-carousel-store]"))
      .slice(0, 32);
    const videoObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      }
    });
    loopingVideos.forEach((video) => videoObserver.observe(video));
    return () => {
      videoObserver.disconnect();
      loopingVideos.forEach((video) => video.pause());
    };
  }, []);
}

type ViewProps = { onAction: (name: string, element: HTMLElement) => void };
function VideosView({ onAction }: ViewProps) {
  return (
    <>
      <div className={"page"}>
        <div className={"page-head"}>
          <div>
            <h1>{"Vídeos"}</h1>
          </div>
          <div className={"page-actions"}>
            <button
              className={"btn btn-primary"}
              onClick={(event) => onAction("Enviar vídeo", event.currentTarget)}
            >
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"14"}
                height={"14"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-plus"}
              >
                <path d={"M5 12h14"} />
                <path d={"M12 5v14"} />
              </svg>
              {" Enviar vídeo"}
            </button>
          </div>
        </div>
        <section className={"ingest-hero panel"}>
          <div className={"hero-glow"}></div>
          <div className={"hero-copy"}>
            <h2>
              {"Envie o vídeo."}
              <br />
              {"Ou cole a live."}
            </h2>
            <p>{"Envie seus vídeos gravados. Para lives, cole o link."}</p>
            <form className={"hero-form"} onSubmit={(event) => event.preventDefault()}>
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"15"}
                height={"15"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-radio"}
              >
                <path d={"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"} />
                <path d={"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"} />
                <circle cx={"12"} cy={"12"} r={"2"} />
                <path d={"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"} />
                <path d={"M19.1 4.9C23 8.8 23 15.1 19.1 19"} />
              </svg>
              <input
                id={"hero-url"}
                placeholder={"Link da live (YouTube, Twitch ou Kick)"}
                spellCheck={"false"}
                defaultValue={""}
              />
              <button
                className={"btn btn-live"}
                type={"submit"}
                onClick={(event) => onAction("Monitorar live", event.currentTarget)}
              >
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"14"}
                  height={"14"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-radio"}
                >
                  <path d={"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"} />
                  <path d={"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"} />
                  <circle cx={"12"} cy={"12"} r={"2"} />
                  <path d={"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"} />
                  <path d={"M19.1 4.9C23 8.8 23 15.1 19.1 19"} />
                </svg>
                {"Monitorar live"}
              </button>
            </form>
            <div className={"hero-live"}>
              <span className={"hero-live-dot"}></span>
              <div className={"hero-live-copy"}>
                <b>{"Já tem um vídeo gravado?"}</b>
                <span>{"Envie o arquivo e o estúdio faz o resto."}</span>
              </div>
              <button
                className={"btn btn-live"}
                type={"button"}
                onClick={(event) => onAction("Enviar vídeo", event.currentTarget)}
              >
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"14"}
                  height={"14"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-cloud-upload"}
                >
                  <path d={"M12 13v8"} />
                  <path d={"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"} />
                  <path d={"m8 17 4-4 4 4"} />
                </svg>
                {" Enviar vídeo"}
              </button>
            </div>
          </div>
        </section>
        <section className={"panel radar-panel"}>
          <div className={"radar-head"}>
            <div>
              <b>
                {"Canais brasileiros"}
                <em>{"3 ao vivo agora"}</em>
              </b>
            </div>
          </div>
          <div className={"radar-strip"}>
            <article className={"radar-card is-live"}>
              <img
                className={"radar-bg"}
                src={"/site-assets/a2bd191c29cd3d2d.jpg"}
                alt={""}
                loading={"lazy"}
              />
              <div className={"radar-top"}>
                <img
                  className={"radar-avatar"}
                  src={"/site-assets/f57957f84a9cd9a8.png"}
                  alt={""}
                  loading={"lazy"}
                />
                <span className={"radar-live on"}>
                  <i></i>
                  {"ao vivo"}
                </span>
              </div>
              <b className={"radar-name"}>{"alanzoka"}</b>
              <em className={"radar-game"}>{"Grand Theft Auto VI"}</em>
              <div className={"radar-foot"}>
                <span className={"mono"}>{"45,5K"}</span>
                <button
                  className={"btn btn-live btn-sm"}
                  onClick={(event) => onAction("Monitorar", event.currentTarget)}
                >
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"12"}
                    height={"12"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-radio"}
                  >
                    <path d={"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"} />
                    <path d={"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"} />
                    <circle cx={"12"} cy={"12"} r={"2"} />
                    <path d={"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"} />
                    <path d={"M19.1 4.9C23 8.8 23 15.1 19.1 19"} />
                  </svg>
                  {" Monitorar"}
                </button>
              </div>
            </article>
            <article className={"radar-card is-live"}>
              <img
                className={"radar-bg"}
                src={"/site-assets/15d65ab73b3f3818.jpg"}
                alt={""}
                loading={"lazy"}
              />
              <div className={"radar-top"}>
                <img
                  className={"radar-avatar"}
                  src={"/site-assets/99c0207bebd01c0e.png"}
                  alt={""}
                  loading={"lazy"}
                />
                <span className={"radar-live on"}>
                  <i></i>
                  {"ao vivo"}
                </span>
              </div>
              <b className={"radar-name"}>{"Cellbit"}</b>
              <em className={"radar-game"}>{"Grand Theft Auto VI"}</em>
              <div className={"radar-foot"}>
                <span className={"mono"}>{"12,0K"}</span>
                <button
                  className={"btn btn-live btn-sm"}
                  onClick={(event) => onAction("Monitorar", event.currentTarget)}
                >
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"12"}
                    height={"12"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-radio"}
                  >
                    <path d={"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"} />
                    <path d={"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"} />
                    <circle cx={"12"} cy={"12"} r={"2"} />
                    <path d={"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"} />
                    <path d={"M19.1 4.9C23 8.8 23 15.1 19.1 19"} />
                  </svg>
                  {" Monitorar"}
                </button>
              </div>
            </article>
            <article className={"radar-card is-live"}>
              <img
                className={"radar-bg"}
                src={"/site-assets/9f543090ed87d0cf.jpg"}
                alt={""}
                loading={"lazy"}
              />
              <div className={"radar-top"}>
                <img
                  className={"radar-avatar"}
                  src={"/site-assets/6dea9d5b1ed70ba3.png"}
                  alt={""}
                  loading={"lazy"}
                />
                <span className={"radar-live on"}>
                  <i></i>
                  {"ao vivo"}
                </span>
              </div>
              <b className={"radar-name"}>{"Gaules"}</b>
              <em className={"radar-game"}>{"Special Events"}</em>
              <div className={"radar-foot"}>
                <span className={"mono"}>{"279"}</span>
                <button
                  className={"btn btn-live btn-sm"}
                  onClick={(event) => onAction("Monitorar", event.currentTarget)}
                >
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"12"}
                    height={"12"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-radio"}
                  >
                    <path d={"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"} />
                    <path d={"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"} />
                    <circle cx={"12"} cy={"12"} r={"2"} />
                    <path d={"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"} />
                    <path d={"M19.1 4.9C23 8.8 23 15.1 19.1 19"} />
                  </svg>
                  {" Monitorar"}
                </button>
              </div>
            </article>
          </div>
        </section>
        <div className={"section-head"}>
          <h2>
            {"Suas fontes "}
            <span className={"mono"}>{"00"}</span>
          </h2>
        </div>
        <div className={"empty"}>
          <div className={"empty-icon"}>
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"22"}
              height={"22"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-youtube"}
            >
              <path
                d={
                  "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"
                }
              />
              <path d={"m10 15 5-3-5-3z"} />
            </svg>
          </div>
          <h3>{"Nenhuma fonte conectada"}</h3>
          <p></p>
        </div>
      </div>
    </>
  );
}
function StudioView({ onAction }: ViewProps) {
  return (
    <>
      <div className={"page"}>
        <div className={"page-head"}>
          <div>
            <div className={"kicker"}>{"ESTÚDIO"}</div>
            <h1>{"Estúdio de cortes"}</h1>
          </div>
        </div>
        <div className={"empty"}>
          <div className={"empty-icon"}>
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"22"}
              height={"22"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-clapperboard"}
            >
              <path d={"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"} />
              <path d={"m6.2 5.3 3.1 3.9"} />
              <path d={"m12.4 3.4 3.1 4"} />
              <path d={"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"} />
            </svg>
          </div>
          <h3>{"Nada no estúdio ainda"}</h3>
          <p></p>
          <button
            className={"btn btn-primary"}
            onClick={(event) => onAction("Conectar fonte", event.currentTarget)}
          >
            {"Conectar fonte"}
          </button>
        </div>
      </div>
    </>
  );
}
function UploadsView({ onAction }: ViewProps) {
  return (
    <>
      <div className={"page"}>
        <div className={"page-head"}>
          <div>
            <div className={"kicker"}>{"PUBLICAÇÃO"}</div>
            <h1>{"Uploads"}</h1>
          </div>
          <div className={"page-actions"}>
            <button
              className={"btn btn-primary"}
              onClick={(event) => onAction("Agendar publicação", event.currentTarget)}
            >
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"14"}
                height={"14"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-plus"}
              >
                <path d={"M5 12h14"} />
                <path d={"M12 5v14"} />
              </svg>
              {" Agendar publicação"}
            </button>
          </div>
        </div>
        <div className={"conn-grid"}>
          <div className={"conn-card"}>
            <div className={"conn-top"}>
              <span className={"conn-ico youtube"}>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"16"}
                  height={"16"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-youtube"}
                >
                  <path
                    d={
                      "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"
                    }
                  />
                  <path d={"m10 15 5-3-5-3z"} />
                </svg>
              </span>
              <div className={"conn-name"}>
                <b>{"YouTube"}</b>
                <em>{"Shorts e vídeos no canal"}</em>
              </div>
              <span className={"conn-dot"}></span>
            </div>
            <div className={"conn-actions"}>
              <button
                className={"btn btn-primary btn-xs"}
                onClick={(event) => onAction("Configurar", event.currentTarget)}
              >
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"12"}
                  height={"12"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-key-round"}
                >
                  <path
                    d={
                      "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
                    }
                  />
                  <circle cx={"16.5"} cy={"7.5"} r={".5"} fill={"currentColor"} />
                </svg>
                {"Configurar"}
              </button>
            </div>
          </div>
          <div className={"conn-card"}>
            <div className={"conn-top"}>
              <span className={"conn-ico tiktok"}>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"16"}
                  height={"16"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-music2"}
                >
                  <circle cx={"8"} cy={"18"} r={"4"} />
                  <path d={"M12 18V2l7 4"} />
                </svg>
              </span>
              <div className={"conn-name"}>
                <b>{"TikTok"}</b>
                <em>{"Publicação direta no perfil"}</em>
              </div>
              <span className={"conn-dot"}></span>
            </div>
            <div className={"conn-actions"}>
              <button
                className={"btn btn-primary btn-xs"}
                onClick={(event) => onAction("Configurar", event.currentTarget)}
              >
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"12"}
                  height={"12"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-key-round"}
                >
                  <path
                    d={
                      "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
                    }
                  />
                  <circle cx={"16.5"} cy={"7.5"} r={".5"} fill={"currentColor"} />
                </svg>
                {"Configurar"}
              </button>
            </div>
          </div>
          <div className={"conn-card"}>
            <div className={"conn-top"}>
              <span className={"conn-ico facebook"}>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"16"}
                  height={"16"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-facebook"}
                >
                  <path d={"M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"} />
                </svg>
              </span>
              <div className={"conn-name"}>
                <b>{"Facebook"}</b>
                <em>{"Reels e vídeos na página"}</em>
              </div>
              <span className={"conn-dot"}></span>
            </div>
            <div className={"conn-actions"}>
              <button
                className={"btn btn-primary btn-xs"}
                onClick={(event) => onAction("Configurar", event.currentTarget)}
              >
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"12"}
                  height={"12"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-key-round"}
                >
                  <path
                    d={
                      "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
                    }
                  />
                  <circle cx={"16.5"} cy={"7.5"} r={".5"} fill={"currentColor"} />
                </svg>
                {"Configurar"}
              </button>
            </div>
          </div>
        </div>
        <div className={"stats-row"}>
          <div className={"stat panel tone-green"}>
            <div className={"stat-top"}>
              <span className={"stat-label"}>{"Publicados"}</span>
            </div>
            <div className={"stat-value"}>{"00"}</div>
            <svg
              className={"spark"}
              viewBox={"0 0 100 30"}
              preserveAspectRatio={"none"}
              aria-hidden={"true"}
            >
              <polyline
                points={""}
                fill={"none"}
                stroke={"var(--tone-green)"}
                strokeWidth={"1.6"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
              />
              <polygon points={"0,30  100,30"} fill={"var(--tone-green)"} opacity={".08"} />
            </svg>
          </div>
          <div className={"stat panel tone-amber"}>
            <div className={"stat-top"}>
              <span className={"stat-label"}>{"Na fila"}</span>
            </div>
            <div className={"stat-value"}>{"00"}</div>
            <svg
              className={"spark"}
              viewBox={"0 0 100 30"}
              preserveAspectRatio={"none"}
              aria-hidden={"true"}
            >
              <polyline
                points={""}
                fill={"none"}
                stroke={"var(--tone-amber)"}
                strokeWidth={"1.6"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
              />
              <polygon points={"0,30  100,30"} fill={"var(--tone-amber)"} opacity={".08"} />
            </svg>
          </div>
          <div className={"stat panel tone-violet"}>
            <div className={"stat-top"}>
              <span className={"stat-label"}>{"Publicando agora"}</span>
            </div>
            <div className={"stat-value"}>{"00"}</div>
            <svg
              className={"spark"}
              viewBox={"0 0 100 30"}
              preserveAspectRatio={"none"}
              aria-hidden={"true"}
            >
              <polyline
                points={"0,28 33.33333333333333,16 66.66666666666666,16 100,4"}
                fill={"none"}
                stroke={"var(--tone-violet)"}
                strokeWidth={"1.6"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
              />
              <polygon
                points={"0,30 0,28 33.33333333333333,16 66.66666666666666,16 100,4 100,30"}
                fill={"var(--tone-violet)"}
                opacity={".08"}
              />
            </svg>
          </div>
          <div className={"stat panel tone-red"}>
            <div className={"stat-top"}>
              <span className={"stat-label"}>{"Contas conectadas"}</span>
            </div>
            <div className={"stat-value"}>{"0/3"}</div>
            <svg
              className={"spark"}
              viewBox={"0 0 100 30"}
              preserveAspectRatio={"none"}
              aria-hidden={"true"}
            >
              <polyline
                points={"0,16 50,16 100,16"}
                fill={"none"}
                stroke={"var(--tone-red)"}
                strokeWidth={"1.6"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
              />
              <polygon
                points={"0,30 0,16 50,16 100,16 100,30"}
                fill={"var(--tone-red)"}
                opacity={".08"}
              />
            </svg>
          </div>
        </div>
        <div className={"section-head"}>
          <h2>
            {"Agenda "}
            <span className={"mono"}>{"00"}</span>
          </h2>
        </div>
        <div className={"empty"}>
          <div className={"empty-icon"}>
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"22"}
              height={"22"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-cloud-upload"}
            >
              <path d={"M12 13v8"} />
              <path d={"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"} />
              <path d={"m8 17 4-4 4 4"} />
            </svg>
          </div>
          <h3>{"Nada agendado"}</h3>
          <p></p>
          <button
            className={"btn btn-primary"}
            onClick={(event) => onAction("Agendar publicação", event.currentTarget)}
          >
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"14"}
              height={"14"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-plus"}
            >
              <path d={"M5 12h14"} />
              <path d={"M12 5v14"} />
            </svg>
            {" Agendar publicação"}
          </button>
        </div>
      </div>
    </>
  );
}
function AgentsView({ onAction }: ViewProps) {
  const [frame, setFrame] = useState(true);
  const [approve, setApprove] = useState(false);
  const [niche, setNiche] = useState("Perseguições");
  const [resolution, setResolution] = useState("4K");
  const handleAction = (name: string, element: HTMLElement) => {
    if (name === "Enquadramento") {
      setFrame(!frame);
      return;
    }
    if (name === "Aprovação") {
      setApprove(!approve);
      return;
    }
    if (["Perseguições", "Games", "Geral"].includes(name)) {
      setNiche(name);
      return;
    }
    if (["720p", "1080p", "4K"].includes(name)) {
      setResolution(name);
      return;
    }
    onAction(name, element);
  };
  return (
    <>
      <div className={"page"}>
        <div className={"page-head"}>
          <div>
            <div className={"kicker"}>{"IA · FLUXO DO CORTE"}</div>
            <h1>{"Agentes"}</h1>
          </div>
          <div className={"page-actions"}>
            <button
              className={"btn btn-primary"}
              onClick={(event) => handleAction("Aplicar estilo", event.currentTarget)}
            >
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"14"}
                height={"14"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-check"}
              >
                <path d={"M20 6 9 17l-5-5"} />
              </svg>
              {" Aplicar estilo"}
            </button>
          </div>
        </div>
        <section className={"panel pipeline-panel"}>
          <div className={"pipe-head"}>
            <div>
              <span className={"kicker"}>{"FLUXO ATIVO"}</span>
              <b>{"Tudo pronto para o próximo corte"}</b>
            </div>
            <span className={"chip chip-green"}>
              <i className={"live-dot"}>
                <i></i>
              </i>
              {" estável"}
            </span>
          </div>
          <div className={"pipe"}>
            <div className={"pipe-unit"}>
              <div className={"pipe-node"}>
                <span>
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"15"}
                    height={"15"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-youtube"}
                  >
                    <path
                      d={
                        "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"
                      }
                    />
                    <path d={"m10 15 5-3-5-3z"} />
                  </svg>
                </span>
                <b>{"Fonte"}</b>
                <em>{"0 conectadas"}</em>
              </div>
              <div className={"pipe-line"}></div>
            </div>
            <div className={"pipe-unit"}>
              <div className={"pipe-node"}>
                <span>
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"15"}
                    height={"15"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-audio-lines"}
                  >
                    <path d={"M2 10v3"} />
                    <path d={"M6 6v11"} />
                    <path d={"M10 3v18"} />
                    <path d={"M14 8v7"} />
                    <path d={"M18 5v13"} />
                    <path d={"M22 10v3"} />
                  </svg>
                </span>
                <b>{"Leitura"}</b>
                <em>{"0 lidas"}</em>
              </div>
              <div className={"pipe-line"}></div>
            </div>
            <div className={"pipe-unit"}>
              <div className={"pipe-node"}>
                <span>
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"15"}
                    height={"15"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-scissors"}
                  >
                    <circle cx={"6"} cy={"6"} r={"3"} />
                    <path d={"M8.12 8.12 12 12"} />
                    <path d={"M20 4 8.12 15.88"} />
                    <circle cx={"6"} cy={"18"} r={"3"} />
                    <path d={"M14.8 14.8 20 20"} />
                  </svg>
                </span>
                <b>{"Momentos"}</b>
                <em>{"0 cortes"}</em>
              </div>
              <div className={"pipe-line"}></div>
            </div>
            <div className={"pipe-unit"}>
              <div className={"pipe-node"}>
                <span>
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"15"}
                    height={"15"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-crop"}
                  >
                    <path d={"M6 2v14a2 2 0 0 0 2 2h14"} />
                    <path d={"M18 22V8a2 2 0 0 0-2-2H2"} />
                  </svg>
                </span>
                <b>{"Enquadramento"}</b>
                <em>{"9:16 auto"}</em>
              </div>
            </div>
          </div>
        </section>
        <div className={"ia-grid"}>
          <div className={"ia-main"}>
            <div className={"section-head"}>
              <h2>{"Agentes do estúdio"}</h2>
              <span className={"fine"}>{"1 ativos"}</span>
            </div>
            <div className={"agent-cards"}>
              <div className={"agent-card panel on"}>
                <div className={"ac-top"}>
                  <span className={"ac-ico tone-violet"}>
                    <svg
                      xmlns={"http://www.w3.org/2000/svg"}
                      width={"16"}
                      height={"16"}
                      viewBox={"0 0 24 24"}
                      fill={"none"}
                      stroke={"currentColor"}
                      strokeWidth={"2"}
                      strokeLinecap={"round"}
                      strokeLinejoin={"round"}
                      className={"lucide lucide-crop"}
                    >
                      <path d={"M6 2v14a2 2 0 0 0 2 2h14"} />
                      <path d={"M18 22V8a2 2 0 0 0-2-2H2"} />
                    </svg>
                  </span>
                  <button
                    type={"button"}
                    role={"switch"}
                    aria-checked={frame}
                    aria-label={"Enquadramento"}
                    className={"switch" + (frame ? " on" : "")}
                    onClick={(event) => handleAction("Enquadramento", event.currentTarget)}
                    aria-pressed={frame}
                  >
                    <span></span>
                  </button>
                </div>
                <h3>{"Enquadramento"}</h3>
                <p>{"Deixa cada corte em 9:16, seguindo o que acontece na tela."}</p>
                <div className={"ac-foot"}>
                  <span className={"ac-state on"}>{"habilitado"}</span>
                  <span className={"mono muted"}>{"0 cortes enquadrados"}</span>
                </div>
              </div>
              <div className={"agent-card panel"}>
                <div className={"ac-top"}>
                  <span className={"ac-ico tone-red"}>
                    <svg
                      xmlns={"http://www.w3.org/2000/svg"}
                      width={"16"}
                      height={"16"}
                      viewBox={"0 0 24 24"}
                      fill={"none"}
                      stroke={"currentColor"}
                      strokeWidth={"2"}
                      strokeLinecap={"round"}
                      strokeLinejoin={"round"}
                      className={"lucide lucide-circle-check"}
                    >
                      <circle cx={"12"} cy={"12"} r={"10"} />
                      <path d={"m9 12 2 2 4-4"} />
                    </svg>
                  </span>
                  <button
                    type={"button"}
                    role={"switch"}
                    aria-checked={approve}
                    aria-label={"Aprovação"}
                    className={"switch" + (approve ? " on" : "")}
                    onClick={(event) => handleAction("Aprovação", event.currentTarget)}
                    aria-pressed={approve}
                  >
                    <span></span>
                  </button>
                </div>
                <h3>{"Aprovação"}</h3>
                <p>{"Aprova sozinha os cortes com melhor score."}</p>
                <div className={"ac-foot"}>
                  <span className={"ac-state"}>{"desligado"}</span>
                  <span className={"mono muted"}>{"revisão manual"}</span>
                </div>
              </div>
            </div>
            <div className={"section-head"}>
              <h2>{"Atividade"}</h2>
            </div>
            <div className={"panel activity"}>
              <p className={"fine"}>{"Sem atividade recente."}</p>
            </div>
          </div>
          <aside className={"ia-side"}>
            <div className={"panel channel-panel"}>
              <div className={"panel-head"}>
                <h3>{"Seu canal"}</h3>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"14"}
                  height={"14"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-youtube muted"}
                >
                  <path
                    d={
                      "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"
                    }
                  />
                  <path d={"m10 15 5-3-5-3z"} />
                </svg>
              </div>
              <label className={"field-label"}>{"Nome do canal"}</label>
              <input
                className={"input"}
                maxLength={40}
                placeholder={"Ex.: Pelo Olhar do Bombeiro"}
                defaultValue={""}
              />
            </div>
            <div className={"panel style-panel"}>
              <div className={"panel-head"}>
                <h3>{"Estilo de corte"}</h3>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"14"}
                  height={"14"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-sparkles muted"}
                >
                  <path
                    d={
                      "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                    }
                  />
                  <path d={"M20 3v4"} />
                  <path d={"M22 5h-4"} />
                  <path d={"M4 17v2"} />
                  <path d={"M5 18H3"} />
                </svg>
              </div>
              <label className={"field-label"}>{"Nicho do estúdio"}</label>
              <div className={"segmented"}>
                <button
                  className={niche === "Perseguições" ? "active" : ""}
                  onClick={(event) => handleAction("Perseguições", event.currentTarget)}
                >
                  {"Perseguições"}
                </button>
                <button
                  className={niche === "Games" ? "active" : ""}
                  onClick={(event) => handleAction("Games", event.currentTarget)}
                >
                  {"Games"}
                </button>
                <button
                  className={niche === "Geral" ? "active" : ""}
                  onClick={(event) => handleAction("Geral", event.currentTarget)}
                >
                  {"Geral"}
                </button>
              </div>
              <div className={"range-field"}>
                <div className={"rf-head"}>
                  <span>{"Duração mínima"}</span>
                  <b className={"mono"}>{"18s"}</b>
                </div>
                <input type={"range"} min={"10"} max={"45"} defaultValue={"18"} />
              </div>
              <div className={"range-field"}>
                <div className={"rf-head"}>
                  <span>{"Duração máxima"}</span>
                  <b className={"mono"}>{"38s"}</b>
                </div>
                <input type={"range"} min={"20"} max={"90"} defaultValue={"38"} />
              </div>
              <div className={"duration-viz"}>
                <span className={"mono"}>{"18s"}</span>
                <div className={"dv-bar"}>
                  <i></i>
                </div>
                <span className={"mono"}>{"38s"}</span>
              </div>
              <label className={"field-label"}>{"Resolução do corte"}</label>
              <div className={"segmented"}>
                <button
                  className={resolution === "720p" ? "active" : ""}
                  onClick={(event) => handleAction("720p", event.currentTarget)}
                >
                  {"720p"}
                </button>
                <button
                  className={resolution === "1080p" ? "active" : ""}
                  onClick={(event) => handleAction("1080p", event.currentTarget)}
                >
                  {"1080p"}
                </button>
                <button
                  className={resolution === "4K" ? "active" : ""}
                  onClick={(event) => handleAction("4K", event.currentTarget)}
                >
                  {"4K"}
                </button>
              </div>
              <div className={"style-note"}>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"13"}
                  height={"13"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-sparkles"}
                >
                  <path
                    d={
                      "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                    }
                  />
                  <path d={"M20 3v4"} />
                  <path d={"M22 5h-4"} />
                  <path d={"M4 17v2"} />
                  <path d={"M5 18H3"} />
                </svg>
                <span>{"As mudanças valem para os próximos cortes analisados."}</span>
              </div>
            </div>
            <div className={"panel reanalyze"}>
              <div className={"re-head"}>
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"14"}
                  height={"14"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-refresh-cw"}
                >
                  <path d={"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"} />
                  <path d={"M21 3v5h-5"} />
                  <path d={"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"} />
                  <path d={"M8 16H3v5"} />
                </svg>
                <b>{"Analisar uma fonte de novo"}</b>
              </div>
              <p>{"Revise um vídeo com o estilo atual do estúdio."}</p>
              <div className={"select"}>
                <button
                  type={"button"}
                  className={"select-btn"}
                  onClick={(event) => handleAction("Nenhuma fonte ainda", event.currentTarget)}
                >
                  <span>{"Nenhuma fonte ainda"}</span>
                  <svg
                    xmlns={"http://www.w3.org/2000/svg"}
                    width={"13"}
                    height={"13"}
                    viewBox={"0 0 24 24"}
                    fill={"none"}
                    stroke={"currentColor"}
                    strokeWidth={"2"}
                    strokeLinecap={"round"}
                    strokeLinejoin={"round"}
                    className={"lucide lucide-chevron-down"}
                  >
                    <path d={"m6 9 6 6 6-6"} />
                  </svg>
                </button>
              </div>
              <button
                className={"btn btn-soft btn-sm w-full"}
                onClick={(event) => handleAction("Conectar fonte", event.currentTarget)}
              >
                <svg
                  xmlns={"http://www.w3.org/2000/svg"}
                  width={"13"}
                  height={"13"}
                  viewBox={"0 0 24 24"}
                  fill={"none"}
                  stroke={"currentColor"}
                  strokeWidth={"2"}
                  strokeLinecap={"round"}
                  strokeLinejoin={"round"}
                  className={"lucide lucide-clapperboard"}
                >
                  <path
                    d={"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"}
                  />
                  <path d={"m6.2 5.3 3.1 3.9"} />
                  <path d={"m12.4 3.4 3.1 4"} />
                  <path d={"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"} />
                </svg>
                {" Conectar fonte"}
              </button>
            </div>
            <div className={"side-tip"}>
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"14"}
                height={"14"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-lightbulb"}
              >
                <path
                  d={
                    "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
                  }
                />
                <path d={"M9 18h6"} />
                <path d={"M10 22h4"} />
              </svg>
              <span>{"Cortes de 18 a 38 segundos prendem mais a atenção."}</span>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
function SourcePopup({ onAction }: ViewProps) {
  return (
    <div className={"modal imported-modal"} role={"dialog"} aria-modal={"true"}>
      <div className={"modal-head"}>
        <div>
          <div className={"kicker"}>{"NOVA FONTE"}</div>
          <h2>{"Envie o vídeo. O estúdio faz o resto."}</h2>
        </div>
        <button
          className={"btn-icon"}
          aria-label={"Fechar"}
          onClick={(event) => onAction("Fechar", event.currentTarget)}
          autoFocus
        >
          <svg
            xmlns={"http://www.w3.org/2000/svg"}
            width={"16"}
            height={"16"}
            viewBox={"0 0 24 24"}
            fill={"none"}
            stroke={"currentColor"}
            strokeWidth={"2"}
            strokeLinecap={"round"}
            strokeLinejoin={"round"}
            className={"lucide lucide-x"}
          >
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </button>
      </div>
      <div className={"modal-body"}>
        <div className={"segmented ingest-tabs"}>
          <button
            className={"active"}
            onClick={(event) => onAction("Enviar vídeo", event.currentTarget)}
          >
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"12"}
              height={"12"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-cloud-upload"}
            >
              <path d={"M12 13v8"} />
              <path d={"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"} />
              <path d={"m8 17 4-4 4 4"} />
            </svg>
            {" Enviar vídeo"}
          </button>
          <button
            className={""}
            onClick={(event) => onAction("Monitorar live", event.currentTarget)}
          >
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"12"}
              height={"12"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-radio"}
            >
              <path d={"M4.9 19.1C1 15.2 1 8.8 4.9 4.9"} />
              <path d={"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"} />
              <circle cx={"12"} cy={"12"} r={"2"} />
              <path d={"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"} />
              <path d={"M19.1 4.9C23 8.8 23 15.1 19.1 19"} />
            </svg>
            {" Monitorar live"}
          </button>
        </div>
        <div className={"ingest-form"}>
          <label className={"field-label"}>{"Arquivo de vídeo"}</label>
          <div
            className={"upload-drop"}
            role="button"
            tabIndex={0}
            onClick={(event) => event.currentTarget.querySelector("input")?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.querySelector("input")?.click();
            }}
          >
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"19"}
              height={"19"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-cloud-upload"}
            >
              <path d={"M12 13v8"} />
              <path d={"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"} />
              <path d={"m8 17 4-4 4 4"} />
            </svg>
            <b>{"Clique ou arraste um vídeo aqui"}</b>
            <span>{"MP4, MOV, WebM, MKV ou AVI · até 2 GB"}</span>
            <input
              type={"file"}
              accept={"video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"}
              hidden
              onChange={(event) =>
                onAction(event.target.files?.[0]?.name ?? "", event.currentTarget)
              }
            />
          </div>
        </div>
      </div>
      <div className={"modal-foot"}>
        <div className={"grow"}></div>
        <button
          className={"btn btn-ghost"}
          onClick={(event) => onAction("Cancelar", event.currentTarget)}
        >
          {"Cancelar"}
        </button>
        <button
          className={"btn btn-primary"}
          onClick={(event) => onAction("Enviar vídeo", event.currentTarget)}
        >
          <svg
            xmlns={"http://www.w3.org/2000/svg"}
            width={"14"}
            height={"14"}
            viewBox={"0 0 24 24"}
            fill={"none"}
            stroke={"currentColor"}
            strokeWidth={"2"}
            strokeLinecap={"round"}
            strokeLinejoin={"round"}
            className={"lucide lucide-cloud-upload"}
          >
            <path d={"M12 13v8"} />
            <path d={"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"} />
            <path d={"m8 17 4-4 4 4"} />
          </svg>
          {"Enviar vídeo"}
        </button>
      </div>
    </div>
  );
}
function SchedulePopup({ onAction }: ViewProps) {
  return (
    <div className={"modal imported-modal"} role={"dialog"} aria-modal={"true"}>
      <div className={"modal-head"}>
        <div>
          <div className={"kicker"}>{"AGENDAR"}</div>
          <h2>{"Programar publicação"}</h2>
        </div>
        <button
          className={"btn-icon"}
          aria-label={"Fechar"}
          onClick={(event) => onAction("Fechar", event.currentTarget)}
          autoFocus
        >
          <svg
            xmlns={"http://www.w3.org/2000/svg"}
            width={"16"}
            height={"16"}
            viewBox={"0 0 24 24"}
            fill={"none"}
            stroke={"currentColor"}
            strokeWidth={"2"}
            strokeLinecap={"round"}
            strokeLinejoin={"round"}
            className={"lucide lucide-x"}
          >
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </button>
      </div>
      <div className={"modal-body"}>
        <div className={"ingest-form"}>
          <div className={"inline-warn"}>
            <svg
              xmlns={"http://www.w3.org/2000/svg"}
              width={"14"}
              height={"14"}
              viewBox={"0 0 24 24"}
              fill={"none"}
              stroke={"currentColor"}
              strokeWidth={"2"}
              strokeLinecap={"round"}
              strokeLinejoin={"round"}
              className={"lucide lucide-link2"}
            >
              <path d={"M9 17H7A5 5 0 0 1 7 7h2"} />
              <path d={"M15 7h2a5 5 0 1 1 0 10h-2"} />
              <line x1={"8"} x2={"16"} y1={"12"} y2={"12"} />
            </svg>
            {" Conecte uma conta acima para liberar a publicação automática."}
          </div>
          <label className={"field-label"}>{"O que publicar"}</label>
          <div className={"segmented"}>
            <button
              className={"active"}
              disabled
              onClick={(event) => onAction("Corte 9:16", event.currentTarget)}
            >
              {"Corte 9:16"}
            </button>
            <button
              className={""}
              disabled
              onClick={(event) => onAction("Vídeo longo 16:9", event.currentTarget)}
            >
              {"Vídeo longo 16:9"}
            </button>
          </div>
          <div className={"select"}>
            <button
              type={"button"}
              className={"select-btn"}
              onClick={(event) => onAction("Selecionar", event.currentTarget)}
            >
              <span>{"Selecionar"}</span>
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"13"}
                height={"13"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-chevron-down"}
              >
                <path d={"m6 9 6 6 6-6"} />
              </svg>
            </button>
          </div>
          <label className={"field-label"}>{"Conta"}</label>
          <div className={"segmented"}>
            <button
              className={""}
              disabled
              title={"Conecte o YouTube primeiro"}
              onClick={(event) => onAction("YouTube", event.currentTarget)}
            >
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"12"}
                height={"12"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-youtube"}
              >
                <path
                  d={
                    "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"
                  }
                />
                <path d={"m10 15 5-3-5-3z"} />
              </svg>
              {" YouTube"}
            </button>
            <button
              className={"active"}
              disabled
              title={"Conecte o TikTok primeiro"}
              onClick={(event) => onAction("TikTok", event.currentTarget)}
            >
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"12"}
                height={"12"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-music2"}
              >
                <circle cx={"8"} cy={"18"} r={"4"} />
                <path d={"M12 18V2l7 4"} />
              </svg>
              {" TikTok"}
            </button>
            <button
              className={""}
              disabled
              title={"Conecte o Facebook primeiro"}
              onClick={(event) => onAction("Facebook", event.currentTarget)}
            >
              <svg
                xmlns={"http://www.w3.org/2000/svg"}
                width={"12"}
                height={"12"}
                viewBox={"0 0 24 24"}
                fill={"none"}
                stroke={"currentColor"}
                strokeWidth={"2"}
                strokeLinecap={"round"}
                strokeLinejoin={"round"}
                className={"lucide lucide-facebook"}
              >
                <path d={"M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"} />
              </svg>
              {" Facebook"}
            </button>
          </div>
          <label className={"field-label"}>{"Data e hora"}</label>
          <input
            type={"datetime-local"}
            className={"input mono"}
            defaultValue={"2026-11-23T19:00"}
          />
        </div>
      </div>
      <div className={"modal-foot"}>
        <div className={"grow"}></div>
        <button
          className={"btn btn-ghost"}
          onClick={(event) => onAction("Cancelar", event.currentTarget)}
        >
          {"Cancelar"}
        </button>
        <button
          className={"btn btn-primary"}
          disabled
          onClick={(event) => onAction("Agendar", event.currentTarget)}
        >
          {" Agendar"}
        </button>
      </div>
    </div>
  );
}
function YoutubePopup({ onAction }: ViewProps) {
  return (
    <div className={"modal imported-modal"} role={"dialog"} aria-modal={"true"}>
      <div className={"modal-head"}>
        <div>
          <div className={"kicker"}>{"YOUTUBE"}</div>
          <h2>{"Configurar acesso"}</h2>
        </div>
        <button
          className={"btn-icon"}
          aria-label={"Fechar"}
          onClick={(event) => onAction("Fechar", event.currentTarget)}
          autoFocus
        >
          <svg
            xmlns={"http://www.w3.org/2000/svg"}
            width={"16"}
            height={"16"}
            viewBox={"0 0 24 24"}
            fill={"none"}
            stroke={"currentColor"}
            strokeWidth={"2"}
            strokeLinecap={"round"}
            strokeLinejoin={"round"}
            className={"lucide lucide-x"}
          >
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </button>
      </div>
      <div className={"modal-body"}>
        <div className={"ingest-form"}>
          <label className={"field-label"}>{"Identificador do app"}</label>
          <input
            className={"input mono"}
            placeholder={"Client ID / Client key"}
            autoComplete={"off"}
            defaultValue={""}
          />
          <label className={"field-label"}>{"Segredo do app"}</label>
          <input
            className={"input mono"}
            type={"password"}
            placeholder={"Client secret"}
            autoComplete={"off"}
            defaultValue={""}
          />
        </div>
      </div>
      <div className={"modal-foot"}>
        <div className={"grow"}></div>
        <button
          className={"btn btn-ghost"}
          onClick={(event) => onAction("Cancelar", event.currentTarget)}
        >
          {"Cancelar"}
        </button>
        <button
          className={"btn btn-primary"}
          onClick={(event) => onAction("Salvar e conectar", event.currentTarget)}
        >
          {" Salvar e conectar"}
        </button>
      </div>
    </div>
  );
}
function TiktokPopup({ onAction }: ViewProps) {
  return (
    <div className={"modal imported-modal"} role={"dialog"} aria-modal={"true"}>
      <div className={"modal-head"}>
        <div>
          <div className={"kicker"}>{"TIKTOK"}</div>
          <h2>{"Configurar acesso"}</h2>
        </div>
        <button
          className={"btn-icon"}
          aria-label={"Fechar"}
          onClick={(event) => onAction("Fechar", event.currentTarget)}
          autoFocus
        >
          <svg
            xmlns={"http://www.w3.org/2000/svg"}
            width={"16"}
            height={"16"}
            viewBox={"0 0 24 24"}
            fill={"none"}
            stroke={"currentColor"}
            strokeWidth={"2"}
            strokeLinecap={"round"}
            strokeLinejoin={"round"}
            className={"lucide lucide-x"}
          >
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </button>
      </div>
      <div className={"modal-body"}>
        <div className={"ingest-form"}>
          <label className={"field-label"}>{"Identificador do app"}</label>
          <input
            className={"input mono"}
            placeholder={"Client ID / Client key"}
            autoComplete={"off"}
            defaultValue={""}
          />
          <label className={"field-label"}>{"Segredo do app"}</label>
          <input
            className={"input mono"}
            type={"password"}
            placeholder={"Client secret"}
            autoComplete={"off"}
            defaultValue={""}
          />
        </div>
      </div>
      <div className={"modal-foot"}>
        <div className={"grow"}></div>
        <button
          className={"btn btn-ghost"}
          onClick={(event) => onAction("Cancelar", event.currentTarget)}
        >
          {"Cancelar"}
        </button>
        <button
          className={"btn btn-primary"}
          onClick={(event) => onAction("Salvar e conectar", event.currentTarget)}
        >
          {" Salvar e conectar"}
        </button>
      </div>
    </div>
  );
}
function FacebookPopup({ onAction }: ViewProps) {
  return (
    <div className={"modal imported-modal"} role={"dialog"} aria-modal={"true"}>
      <div className={"modal-head"}>
        <div>
          <div className={"kicker"}>{"FACEBOOK"}</div>
          <h2>{"Configurar acesso"}</h2>
        </div>
        <button
          className={"btn-icon"}
          aria-label={"Fechar"}
          onClick={(event) => onAction("Fechar", event.currentTarget)}
          autoFocus
        >
          <svg
            xmlns={"http://www.w3.org/2000/svg"}
            width={"16"}
            height={"16"}
            viewBox={"0 0 24 24"}
            fill={"none"}
            stroke={"currentColor"}
            strokeWidth={"2"}
            strokeLinecap={"round"}
            strokeLinejoin={"round"}
            className={"lucide lucide-x"}
          >
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </button>
      </div>
      <div className={"modal-body"}>
        <div className={"ingest-form"}>
          <label className={"field-label"}>{"Identificador do app"}</label>
          <input
            className={"input mono"}
            placeholder={"Client ID / Client key"}
            autoComplete={"off"}
            defaultValue={""}
          />
          <label className={"field-label"}>{"Segredo do app"}</label>
          <input
            className={"input mono"}
            type={"password"}
            placeholder={"Client secret"}
            autoComplete={"off"}
            defaultValue={""}
          />
        </div>
      </div>
      <div className={"modal-foot"}>
        <div className={"grow"}></div>
        <button
          className={"btn btn-ghost"}
          onClick={(event) => onAction("Cancelar", event.currentTarget)}
        >
          {"Cancelar"}
        </button>
        <button
          className={"btn btn-primary"}
          onClick={(event) => onAction("Salvar e conectar", event.currentTarget)}
        >
          {" Salvar e conectar"}
        </button>
      </div>
    </div>
  );
}

// The working studio stays in the captured route; source screens above remain reference material.
const hubTabs = [
  { name: "Vídeos", icon: Video },
  { name: "Cortes", icon: Scissors },
  { name: "Estúdio", icon: Clapperboard },
  { name: "Uploads", icon: Upload },
  { name: "IA", icon: Sparkles },
] as const;
const frames: Frame[] = ["Split", "Fundo desfocado", "9:16 automático"];
const uid = () => crypto.randomUUID();
type ResultVideo = { blob: Blob; url: string };
type PendingVideo = { file: File; url: string; duration: number; thumbnail: string };

export function KakashiApp() {
  const [hub, setHub] = useState<HubState>(initialState);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<Section>("Cortes");
  const [modal, setModal] = useState("");
  const [ingest, setIngest] = useState<"video" | "live">("video");
  const [pending, setPending] = useState<PendingVideo | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [sort, setSort] = useState("Score");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("clip-1");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(18);
  const [safe, setSafe] = useState(false);
  const [media, setMedia] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ResultVideo>>({});
  const [job, setJob] = useState<{ id: string; progress: number } | null>(null);
  const [watchId, setWatchId] = useState("");
  const [markedSeconds, setMarkedSeconds] = useState(0);
  const [longTitle, setLongTitle] = useState("Meus melhores momentos");
  const [scheduleVideo, setScheduleVideo] = useState("");
  const [platform, setPlatform] = useState("YouTube");
  const [when, setWhen] = useState("");
  const [sourceChoice, setSourceChoice] = useState("demo-1");
  const [playing, setPlaying] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const ownedUrls = useRef(new Set<string>());
  const studioPlayer = useRef<HTMLVideoElement | null>(null);
  const camPlayer = useRef<HTMLVideoElement | null>(null);
  const liveSince = useRef(0);
  const active = hub.clips.find((clip) => clip.id === activeId) ?? hub.clips[0];
  const activeSource = hub.sources.find((source) => source.id === active?.sourceId);
  const watched = hub.sources.find((source) => source.id === watchId);
  const sourceURL = (source: Source | undefined) =>
    source ? (media[source.id] ?? (source.demo ? DEMO_VIDEO : "")) : "";
  const update = (fn: (state: HubState) => HubState) => setHub(fn);
  const announce = (message: string) => {
    setNotice(message);
  };
  const open = (name: string) => {
    setError("");
    setModal(name);
  };
  const navigate = (name: Section) => {
    setView(name);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  useEffect(() => {
    try {
      setHub(readState(localStorage.getItem(STORAGE_KEY)));
      const cached = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-files`) ?? "{}") as Record<
        string,
        unknown
      >;
      const restored: Record<string, string> = {};
      for (const [id, value] of Object.entries(cached))
        if (typeof value === "string" && /^data:video\//.test(value)) restored[id] = value;
      setMedia(restored);
    } catch {
      announce("Não foi possível guardar as alterações neste navegador.");
    }
    setReady(true);
    void videoDuration(DEMO_VIDEO)
      .then((duration) => {
        setHub((state) => ({
          ...state,
          sources: state.sources.map((source) => (source.demo ? { ...source, duration } : source)),
          clips: state.clips.map((clip) =>
            state.sources.find((s) => s.id === clip.sourceId)?.demo
              ? {
                  ...clip,
                  start: Math.min(clip.start, Math.max(0, duration - 1)),
                  end: Math.min(clip.end, duration),
                }
              : clip,
          ),
        }));
      })
      .catch(() => {});
    const urls = ownedUrls.current;
    return () => {
      controller.current?.abort();
      urls.forEach((value) => URL.revokeObjectURL(value));
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hub));
    } catch {
      announce("Sem espaço para guardar as alterações neste navegador.");
    }
  }, [hub, ready]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const activeClipId = active?.id;
  const activeClipStart = active?.start;
  const activeClipEnd = active?.end;
  useEffect(() => {
    if (!activeClipId) return;
    setStart(activeClipStart ?? 0);
    setEnd(activeClipEnd ?? 18);
    setPlaying(false);
  }, [activeClipId, activeClipStart, activeClipEnd]);
  const liveWatchId = watched?.kind === "live" ? watched.id : "";
  useEffect(() => {
    if (!liveWatchId) return;
    liveSince.current = Date.now();
    const timer = window.setInterval(
      () => setMarkedSeconds(Math.floor((Date.now() - liveSince.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [liveWatchId]);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setFileBusy(true);
    setError("");
    try {
      const inspected = await inspectVideo(file);
      ownedUrls.current.add(inspected.url);
      if (pending) {
        URL.revokeObjectURL(pending.url);
        ownedUrls.current.delete(pending.url);
      }
      setPending({ file, ...inspected });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir esse vídeo.");
    } finally {
      setFileBusy(false);
    }
  }
  function sendVideo() {
    if (!pending) {
      setError("Escolha um vídeo para começar.");
      return;
    }
    const existing = hub.sources.find(
      (s) => s.fileName === pending.file.name && s.size === pending.file.size && !s.demo,
    );
    const id = existing?.id ?? uid();
    const source: Source = {
      id,
      title: pending.file.name.replace(/\.[^.]+$/, ""),
      fileName: pending.file.name,
      size: pending.file.size,
      channel: hub.settings.workspace,
      kind: "video",
      duration: pending.duration,
      thumbnail: pending.thumbnail,
      moments: [],
    };
    update((state) => ({
      ...state,
      sources: existing
        ? state.sources.map((s) => (s.id === id ? { ...source, moments: s.moments } : s))
        : [...state.sources, source],
    }));
    setMedia((state) => ({ ...state, [id]: pending.url }));
    if (pending.file.size <= 1000000) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const files = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-files`) ?? "{}") as Record<
            string,
            string
          >;
          if (typeof reader.result === "string") {
            files[id] = reader.result;
            localStorage.setItem(`${STORAGE_KEY}-files`, JSON.stringify(files));
          }
        } catch {
          announce("Vídeo aberto. Ao voltar, selecione o arquivo novamente.");
        }
      };
      reader.readAsDataURL(pending.file);
    } else announce("Vídeo aberto. Ao voltar, selecione o arquivo novamente.");
    setSourceChoice(id);
    setPending(null);
    setModal("");
    setView("Vídeos");
    announce(
      existing
        ? "Seu vídeo está disponível de novo."
        : "Vídeo enviado. Vamos escolher os melhores momentos.",
    );
  }
  function monitorLive(value: string) {
    if (!value.trim()) {
      setError("Cole o link da transmissão ao vivo.");
      return;
    }
    const id = youtubeId(value);
    if (!id) {
      setError("Cole um link de vídeo ou live do YouTube.");
      return;
    }
    const existing = hub.sources.find(
      (source) => source.kind === "live" && youtubeId(source.url ?? "") === id,
    );
    const source: Source = existing ?? {
      id: uid(),
      title: `Live do YouTube · ${id}`,
      channel: "YouTube",
      kind: "live",
      duration: 0,
      thumbnail: "/site-assets/cccd331e96ba367b.jpg",
      url: `https://www.youtube.com/watch?v=${id}`,
      moments: [],
    };
    if (!existing) update((state) => ({ ...state, sources: [...state.sources, source] }));
    setWatchId(source.id);
    setMarkedSeconds(0);
    setModal("watch");
    setView("Vídeos");
    setError("");
    setUrl("");
  }
  function analyze(sourceId: string) {
    const source = hub.sources.find((s) => s.id === sourceId);
    if (!canCut(source) || !source) {
      announce("Envie o vídeo gravado para gerar os cortes.");
      return;
    }
    if (!sourceURL(source)) {
      setIngest("video");
      open("add");
      announce("Selecione novamente o arquivo desse vídeo.");
      return;
    }
    const ranges = proposeRanges(source.duration, hub.settings.min, hub.settings.max);
    const cuts: Clip[] = ranges.map((range, index) => ({
      ...range,
      id: uid(),
      sourceId,
      title: `${source.title} · momento ${index + 1}`,
      score: hub.settings.rankingAgent ? Math.max(70, 95 - index * 4) : 0,
      type: hub.settings.style,
      frame: hub.settings.frameAgent ? "9:16 automático" : "Fundo desfocado",
      approved: hub.settings.approvalAgent,
      createdAt: Date.now() + index,
    }));
    update((state) => ({ ...state, clips: [...cuts, ...state.clips] }));
    if (cuts[0]) {
      setActiveId(cuts[0].id);
      setView("Estúdio");
    }
    announce("Trechos sugeridos. Escolha o seu favorito.");
  }
  function editClip(id: string, patch: Partial<Clip>) {
    update((state) => ({
      ...state,
      clips: state.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)),
    }));
    setResults((state) => {
      const next = { ...state };
      const previous = next[id];
      if (previous) {
        URL.revokeObjectURL(previous.url);
        delete next[id];
      }
      return next;
    });
  }
  function edit(clip: Clip) {
    setActiveId(clip.id);
    setView("Estúdio");
    setModal("");
    window.scrollTo(0, 0);
  }
  function applyRange() {
    if (!active || !activeSource || !validRange(start, end, activeSource.duration)) {
      announce("Escolha um trecho com pelo menos 1 segundo.");
      return;
    }
    editClip(active.id, { start, end });
    announce("Recorte aplicado. Atualizando o vídeo…");
    if (studioPlayer.current) studioPlayer.current.currentTime = start;
  }
  async function generate(id: string, clipIds: string[], wide: boolean) {
    if (job) return;
    const clips = clipIds
      .map((clipId) => hub.clips.find((c) => c.id === clipId))
      .filter((c): c is Clip => Boolean(c));
    if (!clips.length) {
      announce("Selecione pelo menos um corte.");
      return;
    }
    const segments: MediaSegment[] = [];
    for (const clip of clips) {
      const source = hub.sources.find((s) => s.id === clip.sourceId),
        path = sourceURL(source);
      if (!source || !canCut(source) || !path) {
        announce("Selecione novamente o vídeo enviado antes de gerar o corte.");
        return;
      }
      if (!validRange(clip.start, clip.end, source.duration)) {
        announce("Escolha um trecho com pelo menos 1 segundo.");
        return;
      }
      segments.push({
        url: path,
        start: clip.start,
        end: clip.end,
        hook: clip.title,
        frame: clip.frame,
        captions: hub.settings.captionAgent,
      });
    }
    const abort = new AbortController();
    controller.current = abort;
    setJob({ id, progress: 0 });
    announce("Começamos! Acompanhe o progresso aqui.");
    try {
      const blob = await createVideo(
        segments,
        wide,
        (progress) => setJob({ id, progress }),
        abort.signal,
      );
      const path = URL.createObjectURL(blob);
      ownedUrls.current.add(path);
      setResults((state) => ({ ...state, [id]: { blob, url: path } }));
      announce(wide ? "Vídeo longo pronto para salvar." : "Corte final pronto para salvar.");
    } catch (caught) {
      announce(
        caught instanceof Error
          ? caught.message
          : "Não foi possível terminar o vídeo. Tente novamente.",
      );
    } finally {
      setJob(null);
      controller.current = null;
    }
  }
  function toggleSelection(id: string) {
    setSelected((state) =>
      state.includes(id) ? state.filter((value) => value !== id) : [...state, id],
    );
  }
  function assemble() {
    if (!selected.length) {
      setError("Selecione pelo menos um corte.");
      return;
    }
    const id = uid();
    update((state) => ({
      ...state,
      longs: [
        ...state.longs,
        {
          id,
          title: longTitle.trim() || "Meus melhores momentos",
          clipIds: selected,
          createdAt: Date.now(),
        },
      ],
    }));
    setModal("");
    setSelected([]);
    announce("Vamos remontar o vídeo longo.");
    void generate(id, selected, true);
  }
  function saveResult(id: string, title: string) {
    const result = results[id];
    if (!result) {
      announce("Gere o vídeo antes de salvar.");
      return;
    }
    saveBlob(result.blob, title);
  }
  function schedule() {
    if (!scheduleVideo) {
      setError("Escolha um vídeo ou corte.");
      return;
    }
    if (!when || new Date(when).getTime() <= Date.now()) {
      setError("Escolha uma data e um horário no futuro.");
      return;
    }
    const title =
      hub.clips.find((c) => c.id === scheduleVideo)?.title ??
      hub.longs.find((l) => l.id === scheduleVideo)?.title ??
      "Vídeo";
    update((state) => ({
      ...state,
      schedule: [
        ...state.schedule,
        { id: uid(), videoId: scheduleVideo, title, platform, when, status: "Na fila" },
      ],
    }));
    setModal("");
    announce("Lembrete de publicação agendado.");
  }
  const filtered = hub.clips
    .filter(
      (clip) =>
        (filter === "Todos" || clip.type === filter) &&
        `${clip.title} ${clip.type}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "Recentes"
        ? b.createdAt - a.createdAt
        : sort === "Duração"
          ? b.end - b.start - (a.end - a.start)
          : b.score - a.score,
    );
  const thumbnails = (sourceId: string) =>
    hub.sources.find((s) => s.id === sourceId)?.thumbnail ?? "/site-assets/cccd331e96ba367b.jpg";
  const selectSource = (
    <select
      aria-label="Fonte para analisar"
      value={sourceChoice}
      onChange={(e) => setSourceChoice(e.target.value)}
    >
      {hub.sources
        .filter((s) => s.kind === "video")
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
    </select>
  );
  const maxScore = Math.max(0, ...hub.clips.map((c) => c.score));
  const iconButton = (label: string, action: () => void, icon: React.ReactNode) => (
    <Button variant="ghost" size="icon" title={label} aria-label={label} onClick={action}>
      {icon}
    </Button>
  );

  return (
    <>
      <style>{capturedCSS}</style>
      <style>{studioCSS}</style>
      <div className="kakashi">
        <header className="hub-header">
          <div className="hub-topbar">
            <Button
              variant="ghost"
              className="hub-brand"
              onClick={() => navigate("Cortes")}
              aria-label="Kakashi Hub — início"
            >
              <span className="hub-eye">
                <Eye />
                <i />
              </span>
              <span>
                KAKASHI <b>HUB</b>
              </span>
            </Button>
            <span className="hub-divider" />
            <Button variant="ghost" className="hub-workspace" onClick={() => open("workspace")}>
              <span className="hub-initial">ME</span>
              <span>
                <b>{hub.settings.workspace}</b>
                <small>Workspace pessoal</small>
              </span>
              <ChevronDown />
            </Button>
            <div className="hub-global-search">
              <Search />
              <input
                aria-label="Busca global"
                placeholder="Buscar cortes e fontes…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (view !== "Vídeos" && view !== "Cortes") setView("Cortes");
                }}
              />
            </div>
            <Button variant="ghost" className="hub-radar-button" onClick={() => navigate("Vídeos")}>
              <i className="hub-dot" />
              {hub.sources.filter((s) => s.kind === "live").length
                ? `${hub.sources.filter((s) => s.kind === "live").length} NO RADAR`
                : "ESTÚDIO PRONTO"}
            </Button>
            <div className="hub-header-tools">
              {iconButton("Notificações", () => open("notifications"), <Bell />)}
              {iconButton("Ajustes", () => navigate("IA"), <SlidersHorizontal />)}
              <Button
                variant="ghost"
                className="hub-avatar"
                aria-label="Meu perfil"
                title="Meu perfil"
                onClick={() => open("workspace")}
              >
                ME
              </Button>
            </div>
            <Button
              className="hub-add"
              onClick={() => {
                setIngest("video");
                open("add");
              }}
            >
              <Plus />
              <span className="hub-desktop-label">Adicionar vídeo ou live</span>
              <span className="hub-mobile-label">Adicionar</span>
            </Button>
          </div>
          <div className="hub-tabbar">
            <nav aria-label="Seções do estúdio">
              {hubTabs.map((tab) => (
                <Button
                  variant="ghost"
                  key={tab.name}
                  className={`hub-tab ${view === tab.name ? "is-active" : ""}`}
                  aria-current={view === tab.name ? "page" : undefined}
                  onClick={() => navigate(tab.name)}
                >
                  <tab.icon />
                  <span>{tab.name}</span>
                  {tab.name === "Cortes" && <i>{hub.clips.length}</i>}
                </Button>
              ))}
            </nav>
            <span className="hub-studio-status">
              <span className="hub-dot" />
              TUDO NO SEU RITMO
            </span>
          </div>
        </header>
        <main className="hub-main">
          {view === "Cortes" && (
            <>
              <div className="hub-page-head">
                <div>
                  <div className="hub-kicker">SEU ACERVO · {hub.clips.length} MOMENTOS</div>
                  <h1>
                    Cortes<span className="hub-title-dot">.</span>
                  </h1>
                  <p>Os melhores segundos merecem o palco.</p>
                </div>
                <div className="hub-actions">
                  <Button variant="outline" onClick={() => open("long")}>
                    <Film />
                    Montar vídeo longo
                  </Button>
                  <Button
                    onClick={() => {
                      setIngest("video");
                      open("add");
                    }}
                  >
                    <Plus />
                    Nova fonte
                  </Button>
                </div>
              </div>
              <div className="hub-stats">
                <HubStat
                  label="Cortes no radar"
                  value={String(hub.clips.length).padStart(2, "0")}
                  detail="Seus próximos posts"
                  tone="primary"
                  points="0,25 15,20 30,22 45,13 60,15 75,6 100,3"
                />
                <HubStat
                  label="Melhor score"
                  value={String(maxScore)}
                  detail="Potencial de destaque"
                  tone="warning"
                  points="0,25 18,24 30,16 46,18 62,9 78,12 100,4"
                />
                <HubStat
                  label="Duração média"
                  value={`${hub.clips.length ? Math.round(hub.clips.reduce((sum, c) => sum + c.end - c.start, 0) / hub.clips.length) : 0}s`}
                  detail="Direto ao ponto"
                  tone="success"
                  points="0,19 15,18 28,14 40,16 58,12 75,13 100,10"
                />
                <HubStat
                  label="Prontos para salvar"
                  value={String(Object.keys(results).length).padStart(2, "0")}
                  detail="Seu conteúdo, com você"
                  tone="destructive"
                  points="0,26 15,24 30,25 46,21 60,22 76,18 100,15"
                />
              </div>
              <div className="hub-toolbar">
                <label className="hub-search">
                  <Search />
                  <input
                    aria-label="Buscar cortes"
                    placeholder="Buscar por gancho ou tema"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="hub-segments">
                  {["Todos", ...new Set(hub.clips.map((c) => c.type))].map((type) => (
                    <Button
                      key={type}
                      variant="ghost"
                      className={filter === type ? "is-active" : ""}
                      onClick={() => setFilter(type)}
                    >
                      {type}
                      <span>
                        {hub.clips.filter((c) => type === "Todos" || c.type === type).length}
                      </span>
                    </Button>
                  ))}
                </div>
                <select
                  aria-label="Ordenar cortes"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option>Score</option>
                  <option>Recentes</option>
                  <option>Duração</option>
                </select>
              </div>
              {selected.length > 0 && (
                <div className="hub-selection">
                  <Check />
                  <b>{selected.length} cortes selecionados</b>
                  <Button variant="ghost" onClick={() => setSelected([])}>
                    Limpar
                  </Button>
                  <Button onClick={() => open("long")}>
                    <Film />
                    Montar vídeo longo
                  </Button>
                </div>
              )}
              {filtered.length ? (
                <div className="hub-clip-grid">
                  {filtered.map((clip) => (
                    <article
                      className={`hub-clip-card ${selected.includes(clip.id) ? "is-selected" : ""}`}
                      key={clip.id}
                    >
                      <div className="hub-clip-cover">
                        <img src={thumbnails(clip.sourceId)} alt="" />
                        <span className="hub-cover-shade" />
                        <label className="hub-clip-check">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${clip.title}`}
                            checked={selected.includes(clip.id)}
                            onChange={() => toggleSelection(clip.id)}
                          />
                          <span>
                            <Check />
                          </span>
                        </label>
                        <span className="hub-score">
                          <TrendingUp />
                          {clip.score}
                        </span>
                        <Button
                          variant="ghost"
                          className="hub-play"
                          aria-label={`Assistir ${clip.title}`}
                          onClick={() => {
                            setActiveId(clip.id);
                            open("play");
                          }}
                        >
                          <Play fill="currentColor" />
                        </Button>
                        <div className="hub-cover-copy">
                          <span className="hub-mini-badge">
                            {clip.frame === frames[0] ? "WEBCAM SOBRE O JOGO" : "9:16"}
                          </span>
                          <h2>{clip.title}</h2>
                          <div>
                            <span>{clip.type}</span>
                            <b>{formatTime(clip.end - clip.start)}</b>
                          </div>
                        </div>
                      </div>
                      <div className="hub-clip-meta">
                        <span className={results[clip.id] ? "hub-success" : ""}>
                          <i className="hub-dot" />
                          {results[clip.id]
                            ? "Pronto para salvar"
                            : clip.approved
                              ? "Aprovado"
                              : "No radar"}
                        </span>
                        <span>
                          {hub.sources.find((s) => s.id === clip.sourceId)?.demo
                            ? "Exemplo"
                            : "Vídeo enviado"}
                        </span>
                      </div>
                      <div className="hub-clip-actions">
                        <Button variant="ghost" onClick={() => edit(clip)}>
                          <Scissors />
                          Abrir no estúdio
                          <ArrowUpRight />
                        </Button>
                        {iconButton(
                          "Excluir corte",
                          () => {
                            update((state) => ({
                              ...state,
                              clips: state.clips.filter((c) => c.id !== clip.id),
                              longs: state.longs.map((l) => ({
                                ...l,
                                clipIds: l.clipIds.filter((id) => id !== clip.id),
                              })),
                            }));
                            setSelected((state) => state.filter((id) => id !== clip.id));
                          },
                          <Trash2 />,
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <HubEmpty
                  title="Nenhum corte por aqui"
                  text="Seu próximo melhor momento começa com um vídeo."
                  action={() => open("add")}
                  label="Adicionar fonte"
                />
              )}
              <div className="hub-section-heading">
                <h2>
                  <Film />
                  Vídeos longos
                </h2>
                <span>{hub.longs.length} no acervo</span>
              </div>
              {hub.longs.length ? (
                <div className="hub-long-grid">
                  {hub.longs.map((long) => (
                    <article className="hub-long-card" key={long.id}>
                      <div className="hub-long-cover">
                        {results[long.id] ? (
                          <video controls src={results[long.id]?.url} />
                        ) : (
                          <img
                            src={thumbnails(
                              hub.clips.find((c) => c.id === long.clipIds[0])?.sourceId ?? "",
                            )}
                            alt="Prévia do vídeo longo"
                          />
                        )}
                        <span className="hub-mini-badge">16:9 · {long.clipIds.length} cortes</span>
                      </div>
                      <h3>{long.title}</h3>
                      <div className="hub-actions">
                        <Button
                          variant="outline"
                          disabled={Boolean(job)}
                          onClick={() => void generate(long.id, long.clipIds, true)}
                        >
                          <Film />
                          {job?.id === long.id ? "Preparando…" : "Gerar vídeo"}
                        </Button>
                        <Button
                          disabled={!results[long.id]}
                          onClick={() => saveResult(long.id, long.title)}
                        >
                          <Save />
                          Salvar vídeo
                        </Button>
                        {iconButton(
                          "Excluir vídeo longo",
                          () =>
                            update((state) => ({
                              ...state,
                              longs: state.longs.filter((l) => l.id !== long.id),
                            })),
                          <Trash2 />,
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="hub-long-empty">
                  <Layers />
                  <span>Uma história maior, feita dos seus melhores cortes.</span>
                  <Button variant="ghost" onClick={() => open("long")}>
                    Montar vídeo longo
                    <ArrowUpRight />
                  </Button>
                </div>
              )}
              <div className="hub-footer">
                <span>
                  {filtered.length} de {hub.clips.length} cortes
                </span>
                <span>
                  <ShieldCheck />
                  SEU ESTÚDIO. SEU CONTEÚDO.
                </span>
              </div>
            </>
          )}
          {view === "Vídeos" && (
            <>
              <div className="hub-page-head">
                <div>
                  <div className="hub-kicker">O COMEÇO DE UMA BOA HISTÓRIA</div>
                  <h1>
                    Vídeos<span className="hub-title-dot">.</span>
                  </h1>
                </div>
                <Button
                  onClick={() => {
                    setIngest("video");
                    open("add");
                  }}
                >
                  <Plus />
                  Enviar vídeo
                </Button>
              </div>
              <section className="hub-source-intro">
                <div>
                  <h2>
                    Suas fontes,
                    <br />
                    seus melhores momentos.
                  </h2>
                  <p>Envie seus vídeos gravados. Para lives, cole o link.</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      monitorLive(url);
                    }}
                  >
                    <Radio />
                    <input
                      aria-label="Link da live"
                      placeholder="https://youtube.com/live/…"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <Button type="submit">
                      <Radio />
                      Monitorar live
                    </Button>
                  </form>
                  {error && (
                    <p className="hub-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                <div className="hub-intro-art">
                  <img src="/site-assets/cccd331e96ba367b.jpg" alt="Kakashi" />
                  <span>
                    KAKASHI
                    <br />
                    <b>HUB</b>
                  </span>
                </div>
              </section>
              <div className="hub-section-heading">
                <h2>
                  <Radio />
                  Radar de lives
                </h2>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIngest("live");
                    open("add");
                  }}
                >
                  <Plus />
                  Adicionar live
                </Button>
              </div>
              <div className="hub-radar-list">
                {hub.sources.filter((s) => s.kind === "live").length ? (
                  hub.sources
                    .filter((s) => s.kind === "live")
                    .map((source) => (
                      <article className="hub-live-card" key={source.id}>
                        <span className="hub-live-avatar">
                          <Radio />
                        </span>
                        <div>
                          <b>{source.title}</b>
                          <small>YouTube · Acompanhando</small>
                        </div>
                        <span className="hub-live-badge">LIVE</span>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setWatchId(source.id);
                            open("watch");
                          }}
                        >
                          <Play />
                          Assistir
                        </Button>
                        <p>{LIVE_CAPTION}</p>
                      </article>
                    ))
                ) : (
                  <div className="hub-radar-empty">
                    <Radio />
                    <div>
                      <b>Seu radar está pronto.</b>
                      <span>Adicione a transmissão que você quer acompanhar.</span>
                      <small>{LIVE_CAPTION}</small>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIngest("live");
                        open("add");
                      }}
                    >
                      Adicionar live
                      <Plus />
                    </Button>
                  </div>
                )}
              </div>
              <div className="hub-source-layout">
                <section>
                  <div className="hub-section-heading">
                    <h2>Suas fontes</h2>
                    <span>{hub.sources.filter((s) => s.kind === "video").length} vídeos</span>
                  </div>
                  <div className="hub-source-grid">
                    {hub.sources
                      .filter(
                        (s) =>
                          s.kind === "video" && s.title.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((source) => (
                        <article className="hub-source-card" key={source.id}>
                          <div className="hub-source-cover">
                            <img src={source.thumbnail} alt="Prévia do vídeo" />
                            <span className="hub-mini-badge">
                              {source.demo ? "EXEMPLO" : "VÍDEO ENVIADO"}
                            </span>
                            <b>{formatTime(source.duration)}</b>
                          </div>
                          <div className="hub-source-info">
                            <h3>{source.title}</h3>
                            <p>
                              {source.channel} ·{" "}
                              {hub.clips.filter((c) => c.sourceId === source.id).length} cortes
                            </p>
                            <progress max={100} value={sourceURL(source) ? 100 : 0} />
                            <div className="hub-actions">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setWatchId(source.id);
                                  open("watch");
                                }}
                              >
                                <Play />
                                Assistir
                              </Button>
                              <Button onClick={() => analyze(source.id)}>
                                <Scissors />
                                Escolher cortes
                              </Button>
                              {iconButton(
                                "Excluir fonte",
                                () =>
                                  update((state) => ({
                                    ...state,
                                    sources: state.sources.filter((s) => s.id !== source.id),
                                    clips: state.clips.filter((c) => c.sourceId !== source.id),
                                  })),
                                <Trash2 />,
                              )}
                            </div>
                            {!sourceURL(source) && (
                              <small>Selecione novamente o arquivo para continuar.</small>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                  {!hub.sources.some((s) => s.kind === "video") && (
                    <HubEmpty
                      title="Sua primeira fonte"
                      text="Envie o vídeo e encontre seus melhores momentos."
                      action={() => open("add")}
                      label="Enviar vídeo"
                    />
                  )}
                </section>
                <aside className="hub-analysis">
                  <div className="hub-kicker">
                    <Sparkles />
                    ANALISANDO
                  </div>
                  {[
                    "Preparando corte",
                    "Montando vídeo longo",
                    "Monitorando a live",
                    "Lendo o vídeo enviado",
                  ].map((text, i) => (
                    <div key={text}>
                      <span
                        className={
                          (job && i === 0) || (fileBusy && i === 3) ? "hub-dot" : "hub-dot is-idle"
                        }
                      />
                      <span>{text}</span>
                      <small>
                        {job && i === 0
                          ? `${Math.round(job.progress)}%`
                          : hub.sources.some((s) => s.kind === "live") && i === 2
                            ? "Ativo"
                            : "Pronto"}
                      </small>
                    </div>
                  ))}
                  <p>Um bom corte começa no momento certo.</p>
                </aside>
              </div>
            </>
          )}
          {view === "Estúdio" && (
            <>
              <div className="hub-page-head">
                <div>
                  <div className="hub-kicker">DA IDEIA AO PRÓXIMO POST</div>
                  <h1>
                    Estúdio<span className="hub-title-dot">.</span>
                  </h1>
                </div>
                <select
                  aria-label="Corte no estúdio"
                  value={active?.id ?? ""}
                  onChange={(e) => setActiveId(e.target.value)}
                >
                  {hub.clips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              {active ? (
                <div className="hub-editor">
                  <section className="hub-preview-section">
                    <div className="hub-preview-top">
                      <span>
                        <Eye />
                        PRÉVIA DO CORTE
                      </span>
                      <span className="hub-mini-badge">9:16</span>
                    </div>
                    <div
                      className={`hub-preview ${active.frame === frames[0] ? "is-split" : active.frame === frames[1] ? "is-blur" : ""}`}
                    >
                      {sourceURL(activeSource) ? (
                        <>
                          <video
                            ref={studioPlayer}
                            key={`${active.sourceId}-main`}
                            src={sourceURL(activeSource)}
                            poster={activeSource?.thumbnail}
                            playsInline
                            onLoadedMetadata={(e) => {
                              e.currentTarget.currentTime = active.start;
                            }}
                            onPlay={() => setPlaying(true)}
                            onPause={() => setPlaying(false)}
                            onTimeUpdate={(e) => {
                              const main = e.currentTarget;
                              if (
                                camPlayer.current &&
                                Math.abs(camPlayer.current.currentTime - main.currentTime) > 0.2
                              )
                                camPlayer.current.currentTime = main.currentTime;
                              if (main.currentTime >= active.end) {
                                main.pause();
                                camPlayer.current?.pause();
                                main.currentTime = active.start;
                              }
                            }}
                          />
                          {active.frame === frames[0] && (
                            <video
                              ref={camPlayer}
                              className="hub-preview-camera"
                              src={sourceURL(activeSource)}
                              muted
                              playsInline
                            />
                          )}
                        </>
                      ) : (
                        <img src={activeSource?.thumbnail} alt="Prévia do corte" />
                      )}
                      <div className="hub-preview-hook">{active.title}</div>
                      {safe && (
                        <div className="hub-safe-area">
                          <span>ÁREA SEGURA</span>
                        </div>
                      )}
                      <div className="hub-preview-bottom">
                        <span>
                          {formatTime(active.start)} — {formatTime(active.end)}
                        </span>
                        <span>{formatTime(active.end - active.start)}</span>
                      </div>
                    </div>
                    <div className="hub-preview-controls">
                      {iconButton(
                        playing ? "Pausar prévia" : "Reproduzir prévia",
                        () => {
                          const player = studioPlayer.current;
                          if (!player) {
                            announce("Selecione novamente o arquivo do vídeo.");
                            return;
                          }
                          if (player.paused) {
                            void player
                              .play()
                              .catch(() => announce("Não foi possível abrir esse vídeo."));
                            void camPlayer.current?.play().catch(() => {});
                          } else {
                            player.pause();
                            camPlayer.current?.pause();
                          }
                        },
                        playing ? <Pause /> : <Play />,
                      )}
                      <span>
                        {formatTime(active.end - active.start)}
                        <small> / {formatTime(activeSource?.duration ?? 0)}</small>
                      </span>
                      <Button variant="ghost" aria-pressed={safe} onClick={() => setSafe(!safe)}>
                        <ShieldCheck />
                        Área segura
                      </Button>
                    </div>
                    {active.frame === frames[0] && (
                      <span className="hub-preview-caption">Split</span>
                    )}
                    <p className="hub-live-caption">{LIVE_CAPTION}</p>
                  </section>
                  <section className="hub-editor-tools">
                    <div className="hub-section-heading">
                      <h2>
                        <Sparkles />
                        Agentes do estúdio
                      </h2>
                      <span className="hub-status-badge">{job ? "executando" : "prontos"}</span>
                    </div>
                    <div className="hub-agent-mini">
                      {[
                        [Eye, "Enquadramento"],
                        [Captions, "Legenda"],
                        [ShieldCheck, "Aprovação"],
                      ].map(([Icon, label]) => {
                        const I = Icon as typeof Eye;
                        return (
                          <span key={String(label)}>
                            <I />
                            <b>{String(label)}</b>
                            <Check />
                          </span>
                        );
                      })}
                    </div>
                    <div className="hub-tool-section">
                      <label>ENQUADRAMENTO</label>
                      <div className="hub-frame-options">
                        {frames.map((frame) => (
                          <Button
                            key={frame}
                            variant="outline"
                            className={active.frame === frame ? "is-active" : ""}
                            onClick={() => editClip(active.id, { frame })}
                          >
                            <span
                              className={`hub-frame-icon ${frame === frames[0] ? "split" : ""}`}
                            />
                            {frame}
                          </Button>
                        ))}
                      </div>
                      {active.frame === frames[0] && (
                        <small>Webcam no canto superior esquerdo do vídeo original.</small>
                      )}
                    </div>
                    <div className="hub-tool-section">
                      <div className="hub-label-row">
                        <label htmlFor="clip-hook">GANCHO DO CORTE</label>
                        <small>salva ao sair</small>
                      </div>
                      <textarea
                        id="clip-hook"
                        aria-label="Hook do corte"
                        maxLength={160}
                        key={active.id}
                        defaultValue={active.title}
                        onBlur={(e) => {
                          if (e.target.value.trim())
                            editClip(active.id, { title: e.target.value.trim() });
                        }}
                      />
                      <small>Uma primeira frase que dá vontade de ficar.</small>
                    </div>
                    <div className="hub-tool-section">
                      <div className="hub-label-row">
                        <label>TIMELINE</label>
                        <span>{formatTime(activeSource?.duration ?? 0)}</span>
                      </div>
                      <div className="hub-timeline-ruler">
                        {[0, 0.25, 0.5, 0.75, 1].map((value) => (
                          <span key={value}>
                            {formatTime((activeSource?.duration ?? 0) * value)}
                          </span>
                        ))}
                      </div>
                      <div className="hub-timeline">
                        <div className="hub-timeline-track" />
                        <div
                          className="hub-timeline-chosen"
                          style={{
                            left: `${(active.start / (activeSource?.duration || 1)) * 100}%`,
                            width: `${((active.end - active.start) / (activeSource?.duration || 1)) * 100}%`,
                          }}
                        >
                          <GripHorizontal />
                          corte
                        </div>
                      </div>
                      <div className="hub-timeline-legend">
                        <span>
                          <i />
                          corte
                        </span>
                        <span>
                          <i />
                          selecionado
                        </span>
                      </div>
                    </div>
                    <div className="hub-tool-section">
                      <h3>Ajustar o trecho</h3>
                      <div className="hub-range-controls">
                        <label>
                          Início (s)
                          <input
                            aria-label="Início do trecho"
                            type="number"
                            min="0"
                            step="0.1"
                            max={activeSource?.duration}
                            value={start}
                            onChange={(e) => setStart(Number(e.target.value))}
                          />
                        </label>
                        <span>→</span>
                        <label>
                          Fim (s)
                          <input
                            aria-label="Fim do trecho"
                            type="number"
                            min="1"
                            step="0.1"
                            max={activeSource?.duration}
                            value={end}
                            onChange={(e) => setEnd(Number(e.target.value))}
                          />
                        </label>
                        <Button variant="outline" onClick={applyRange}>
                          <Check />
                          Aplicar
                        </Button>
                      </div>
                    </div>
                    {results[active.id] && (
                      <div className="hub-final-preview">
                        <video controls src={results[active.id]?.url} />
                        <span className="hub-success">
                          <Check />
                          Corte final pronto
                        </span>
                      </div>
                    )}
                    <div className="hub-generate-actions">
                      <Button
                        disabled={Boolean(job)}
                        onClick={() => void generate(active.id, [active.id], false)}
                      >
                        {job?.id === active.id ? (
                          <LoaderCircle className="hub-spin" />
                        ) : (
                          <Sparkles />
                        )}
                        {job?.id === active.id ? "Preparando…" : "Gerar corte"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!results[active.id]}
                        onClick={() => saveResult(active.id, active.title)}
                      >
                        <Save />
                        Salvar corte final
                      </Button>
                    </div>
                  </section>
                </div>
              ) : (
                <HubEmpty
                  title="O estúdio está pronto"
                  text="Envie um vídeo e escolha o trecho que merece virar corte."
                  action={() => open("add")}
                  label="Adicionar fonte"
                />
              )}
            </>
          )}
          {view === "Uploads" && (
            <>
              <div className="hub-page-head">
                <div>
                  <div className="hub-kicker">SEU CONTEÚDO NO MUNDO</div>
                  <h1>
                    Uploads<span className="hub-title-dot">.</span>
                  </h1>
                  <p>Uma agenda para não deixar o momento passar.</p>
                </div>
                <Button onClick={() => open("schedule")}>
                  <Plus />
                  Agendar publicação
                </Button>
              </div>
              <div className="hub-stats">
                {[
                  ["Publicados", hub.schedule.filter((s) => s.status === "Publicado").length],
                  ["Na fila", hub.schedule.filter((s) => s.status !== "Publicado").length],
                  ["Publicando agora", 0],
                  ["Contas conectadas", Object.values(hub.connections).filter(Boolean).length],
                ].map(([label, value], i) => (
                  <HubStat
                    key={String(label)}
                    label={String(label)}
                    value={String(value).padStart(2, "0")}
                    detail={i === 3 ? "Preferências do estúdio" : "Sua agenda pessoal"}
                    tone={["success", "warning", "primary", "destructive"][i] ?? "primary"}
                    points="0,25 20,25 40,22 60,22 80,18 100,18"
                  />
                ))}
              </div>
              <div className="hub-section-heading">
                <h2>Agenda de publicação</h2>
                <span className="hub-mini-badge">LEMBRETES</span>
              </div>
              <p className="hub-muted">
                A agenda guarda lembretes. A publicação é feita por você na plataforma.
              </p>
              {hub.schedule.length ? (
                <div className="hub-schedule">
                  <div className="hub-schedule-head">
                    <span>Vídeo</span>
                    <span>Plataforma</span>
                    <span>Quando</span>
                    <span>Status</span>
                    <span>Ações</span>
                  </div>
                  {hub.schedule.map((item) => (
                    <div className="hub-schedule-row" key={item.id}>
                      <b data-label="Vídeo">{item.title}</b>
                      <span data-label="Plataforma">{item.platform}</span>
                      <span data-label="Quando">
                        {new Date(item.when).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <span
                        data-label="Status"
                        className={item.status === "Publicado" ? "hub-success" : "hub-warning"}
                      >
                        {item.status}
                      </span>
                      <div className="hub-actions" data-label="Ações">
                        {iconButton(
                          "Marcar como publicado",
                          () =>
                            update((state) => ({
                              ...state,
                              schedule: state.schedule.map((s) =>
                                s.id === item.id ? { ...s, status: "Publicado" } : s,
                              ),
                            })),
                          <Check />,
                        )}
                        {iconButton(
                          "Remover lembrete",
                          () =>
                            update((state) => ({
                              ...state,
                              schedule: state.schedule.filter((s) => s.id !== item.id),
                            })),
                          <Trash2 />,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <HubEmpty
                  title="Nada agendado"
                  text="Escolha um corte e reserve o melhor horário."
                  action={() => open("schedule")}
                  label="Agendar publicação"
                />
              )}
              <div className="hub-section-heading">
                <h2>Suas conexões</h2>
                <span>4 plataformas</span>
              </div>
              <p className="hub-muted">Conecte uma conta para publicar sozinho</p>
              <small className="hub-muted">
                Preferências visuais · não vinculam contas nem publicam automaticamente.
              </small>
              <div className="hub-connections">
                {Object.entries(hub.connections).map(([name, connected]) => (
                  <article key={name}>
                    <span className={`hub-platform hub-platform-${name.toLowerCase()}`}>
                      {name === "YouTube" ? (
                        <Play />
                      ) : name === "Twitch" ? (
                        <Video />
                      ) : name === "Kick" ? (
                        <b>K</b>
                      ) : (
                        <b>♪</b>
                      )}
                    </span>
                    <div>
                      <h3>{name}</h3>
                      <small className={connected ? "hub-success" : "hub-muted"}>
                        {connected ? "conectada" : "Sem conta selecionada"}
                      </small>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() =>
                        update((state) => ({
                          ...state,
                          connections: { ...state.connections, [name]: !connected },
                        }))
                      }
                    >
                      {connected ? <Check /> : <Plus />}
                      {connected ? "Desconectar" : "Conectar"}
                    </Button>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "IA" && (
            <>
              <div className="hub-page-head">
                <div>
                  <div className="hub-kicker">UM TIME DO SEU LADO</div>
                  <h1>
                    Agentes<span className="hub-title-dot">.</span>
                  </h1>
                  <p>Seu estilo. Seus critérios. Seus melhores momentos.</p>
                </div>
                <span className="hub-status-badge">
                  <Sparkles />
                  Estúdio pronto
                </span>
              </div>
              <div className="hub-pipeline">
                {[
                  [Video, "Fonte"],
                  [Eye, "Leitura"],
                  [Scissors, "Momentos"],
                  [Clapperboard, "Enquadramento"],
                ].map(([Icon, label], i) => {
                  const I = Icon as typeof Eye;
                  return (
                    <div key={String(label)}>
                      <span>
                        <I />
                      </span>
                      <div>
                        <small>0{i + 1}</small>
                        <b>{String(label)}</b>
                      </div>
                      {i < 3 && <span className="hub-pipe-arrow">→</span>}
                    </div>
                  );
                })}
              </div>
              <div className="hub-agent-grid">
                {[
                  {
                    key: "frameAgent" as const,
                    name: "Enquadramento",
                    icon: Eye,
                    description: "Deixa cada corte em 9:16, seguindo o que acontece na tela.",
                    note: "Enquadramento central ou webcam fixa.",
                  },
                  {
                    key: "approvalAgent" as const,
                    name: "Aprovação",
                    icon: ShieldCheck,
                    description: "Aprova sozinha os cortes com melhor score.",
                    note: "Aprovação dos trechos sugeridos.",
                  },
                  {
                    key: "captionAgent" as const,
                    name: "Legenda",
                    icon: Captions,
                    description: "Seu gancho em destaque, do primeiro ao último segundo.",
                    note: "Texto do hook sobre o vídeo.",
                  },
                  {
                    key: "rankingAgent" as const,
                    name: "Trend Ranking",
                    icon: TrendingUp,
                    description: "Organiza os momentos que merecem a sua atenção.",
                    note: "Score sugerido; revise com seu olhar.",
                  },
                ].map((agent) => (
                  <article className="hub-agent-card" key={agent.key}>
                    <div>
                      <span className="hub-agent-symbol">
                        <agent.icon />
                      </span>
                      <Switch
                        aria-label={agent.name}
                        checked={hub.settings[agent.key]}
                        onCheckedChange={(checked) =>
                          update((state) => ({
                            ...state,
                            settings: { ...state.settings, [agent.key]: checked },
                          }))
                        }
                      />
                    </div>
                    <h3>{agent.name}</h3>
                    <p>{agent.description}</p>
                    <small>{agent.note}</small>
                    <span className={hub.settings[agent.key] ? "hub-success" : "hub-muted"}>
                      <i className={`hub-dot ${hub.settings[agent.key] ? "" : "is-idle"}`} />
                      {hub.settings[agent.key] ? "pronto" : "pausado"}
                    </span>
                  </article>
                ))}
              </div>
              <div className="hub-settings-grid">
                <section className="hub-settings-section">
                  <div className="hub-section-heading">
                    <h2>
                      <SlidersHorizontal />
                      Estilo de corte
                    </h2>
                  </div>
                  <label>ESTILO DO ESTÚDIO</label>
                  <div className="hub-segments">
                    {["Perseguição", "Games", "Geral"].map((style) => (
                      <Button
                        key={style}
                        variant="ghost"
                        className={hub.settings.style === style ? "is-active" : ""}
                        onClick={() =>
                          update((state) => ({ ...state, settings: { ...state.settings, style } }))
                        }
                      >
                        {style}
                      </Button>
                    ))}
                  </div>
                  <label className="hub-slider-label">
                    Duração mínima <b>{hub.settings.min}s</b>
                  </label>
                  <input
                    aria-label="Duração mínima"
                    type="range"
                    min="1"
                    max="120"
                    value={hub.settings.min}
                    onChange={(e) => {
                      const min = Number(e.target.value);
                      update((state) => ({
                        ...state,
                        settings: {
                          ...state.settings,
                          min,
                          max: Math.max(min, state.settings.max),
                        },
                      }));
                    }}
                  />
                  <label className="hub-slider-label">
                    Duração máxima <b>{hub.settings.max}s</b>
                  </label>
                  <input
                    aria-label="Duração máxima"
                    type="range"
                    min="1"
                    max="120"
                    value={hub.settings.max}
                    onChange={(e) => {
                      const max = Number(e.target.value);
                      update((state) => ({
                        ...state,
                        settings: {
                          ...state.settings,
                          max,
                          min: Math.min(max, state.settings.min),
                        },
                      }));
                    }}
                  />
                  <p className="hub-insight">
                    <Sparkles />
                    Cortes de 18 a 38 segundos prendem mais a atenção.
                  </p>
                </section>
                <section className="hub-settings-section">
                  <div className="hub-section-heading">
                    <h2>
                      <Scissors />
                      Analisar uma fonte de novo
                    </h2>
                  </div>
                  <p>Revise um vídeo com o estilo atual do estúdio.</p>
                  {selectSource}
                  <Button
                    onClick={() => analyze(sourceChoice)}
                    disabled={!hub.sources.some((s) => s.kind === "video")}
                  >
                    <Sparkles />
                    Sugerir novos trechos
                  </Button>
                  <div className="hub-insight">
                    <Eye />
                    Seu olhar faz o corte. O estúdio cuida do formato.
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
        {job && (
          <div className="hub-job" role="status">
            <LoaderCircle className="hub-spin" />
            <div>
              <b>
                Preparando seu vídeo… <span>{Math.round(job.progress)}%</span>
              </b>
              <progress max="100" value={job.progress} />
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="Cancelar geração"
              aria-label="Cancelar geração"
              onClick={() => controller.current?.abort()}
            >
              <X />
            </Button>
          </div>
        )}
        {notice && (
          <div className="hub-toast" role="status">
            <Check />
            <span>{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Fechar aviso"
              onClick={() => setNotice("")}
            >
              <X />
            </Button>
          </div>
        )}
        <Dialog
          open={Boolean(modal)}
          onOpenChange={(value) => {
            if (!value) {
              setModal("");
              setError("");
            }
          }}
        >
          <DialogContent
            className={`hub-dialog ${modal === "watch" || modal === "play" ? "hub-player-dialog" : ""}`}
          >
            <div className="hub-sheet-handle" />
            <DialogTitle>
              {modal === "add"
                ? "Adicionar fonte"
                : modal === "long"
                  ? "Adicionar cortes ao vídeo longo"
                  : modal === "schedule"
                    ? "Agendar publicação"
                    : modal === "workspace"
                      ? "Meu estúdio"
                      : modal === "notifications"
                        ? "Notificações"
                        : modal === "watch"
                          ? (watched?.title ?? "Sua fonte")
                          : (active?.title ?? "Seu corte")}
            </DialogTitle>
            <DialogDescription className="hub-dialog-description">
              {modal === "add"
                ? "Seu próximo melhor momento começa aqui."
                : modal === "long"
                  ? "Uma história maior, no seu ritmo."
                  : modal === "schedule"
                    ? "Guarde um lembrete para publicar na hora certa."
                    : modal === "workspace"
                      ? "Um espaço com a sua identidade."
                      : modal === "notifications"
                        ? "O que está acontecendo no seu estúdio."
                        : "Seu conteúdo em destaque."}
            </DialogDescription>
            {modal === "add" && (
              <>
                <div className="hub-ingest-tabs">
                  <Button
                    variant="ghost"
                    className={ingest === "video" ? "is-active" : ""}
                    onClick={() => {
                      setIngest("video");
                      setError("");
                    }}
                  >
                    <Upload />
                    Enviar vídeo
                  </Button>
                  <Button
                    variant="ghost"
                    className={ingest === "live" ? "is-active" : ""}
                    onClick={() => {
                      setIngest("live");
                      setError("");
                    }}
                  >
                    <Radio />
                    Colar link da live
                  </Button>
                </div>
                {ingest === "video" ? (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                      hidden
                      onChange={(e) => void chooseFile(e.target.files?.[0])}
                    />
                    <div
                      className="hub-drop-area"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        void chooseFile(e.dataTransfer.files[0]);
                      }}
                    >
                      <Upload />
                      <b>
                        {fileBusy
                          ? "Lendo seu vídeo…"
                          : pending
                            ? pending.file.name
                            : "Arraste seu vídeo para cá"}
                      </b>
                      <span>
                        {pending
                          ? `${(pending.file.size / 1024 / 1024).toFixed(1)} MB · ${formatTime(pending.duration)}`
                          : "MP4, MOV ou WEBM"}
                      </span>
                      <Button
                        variant="outline"
                        disabled={fileBusy}
                        onClick={() => fileInput.current?.click()}
                      >
                        {pending ? "Escolher outro vídeo" : "Escolher arquivo"}
                      </Button>
                    </div>
                    {pending && <video className="hub-upload-preview" controls src={pending.url} />}
                  </>
                ) : (
                  <div className="hub-live-input">
                    <label htmlFor="live-url">LINK DA TRANSMISSÃO</label>
                    <input
                      id="live-url"
                      type="url"
                      placeholder="https://youtube.com/live/…"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <p>Cole o link da live. Acompanhe ao vivo.</p>
                    <small>{LIVE_CAPTION}</small>
                  </div>
                )}
                <div className="hub-dialog-actions">
                  <Button variant="ghost" onClick={() => setModal("")}>
                    Cancelar
                  </Button>
                  <Button
                    disabled={fileBusy}
                    onClick={() => (ingest === "video" ? sendVideo() : monitorLive(url))}
                  >
                    {ingest === "video" ? <Upload /> : <Radio />}
                    {ingest === "video" ? "Enviar vídeo" : "Monitorar live"}
                  </Button>
                </div>
              </>
            )}
            {modal === "play" && active && (
              <>
                <div className="hub-playback">
                  {results[active.id] ? (
                    <video controls autoPlay src={results[active.id]?.url} />
                  ) : sourceURL(activeSource) ? (
                    <video
                      controls
                      autoPlay
                      src={`${sourceURL(activeSource)}#t=${active.start},${active.end}`}
                    />
                  ) : (
                    <p>Selecione novamente o vídeo enviado para assistir.</p>
                  )}
                </div>
                <div className="hub-dialog-actions">
                  <Button variant="outline" onClick={() => edit(active)}>
                    <Scissors />
                    Abrir no estúdio
                  </Button>
                  <Button
                    disabled={!results[active.id]}
                    onClick={() => saveResult(active.id, active.title)}
                  >
                    <Save />
                    Salvar vídeo
                  </Button>
                </div>
              </>
            )}
            {modal === "watch" && watched && (
              <>
                {watched.kind === "live" ? (
                  <>
                    <iframe
                      className="hub-live-embed"
                      src={`https://www.youtube-nocookie.com/embed/${youtubeId(watched.url ?? "")}?rel=0`}
                      title={watched.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                    <p className="hub-live-caption">{LIVE_CAPTION}</p>
                    <div className="hub-live-mark">
                      <span>{formatTime(markedSeconds)} acompanhando</span>
                      <Button
                        onClick={() => {
                          update((state) => ({
                            ...state,
                            sources: state.sources.map((s) =>
                              s.id === watched.id
                                ? { ...s, moments: [...s.moments, markedSeconds] }
                                : s,
                            ),
                          }));
                          announce("Momento marcado. Envie o vídeo gravado para criar o corte.");
                        }}
                      >
                        <Bookmark />
                        Marcar momento
                      </Button>
                    </div>
                    <div className="hub-moments">
                      {watched.moments.map((moment, i) => (
                        <span key={`${moment}-${i}`}>
                          <Bookmark />
                          {formatTime(moment)}
                        </span>
                      ))}
                    </div>
                    <small>
                      Momentos contados desde que você abriu a transmissão. Para criar cortes, envie
                      o vídeo gravado.
                    </small>
                  </>
                ) : sourceURL(watched) ? (
                  <video className="hub-source-player" controls autoPlay src={sourceURL(watched)} />
                ) : (
                  <>
                    <p>Seu vídeo está no acervo. Selecione o arquivo novamente para assistir.</p>
                    <Button
                      onClick={() => {
                        setIngest("video");
                        open("add");
                      }}
                    >
                      <Upload />
                      Selecionar vídeo
                    </Button>
                  </>
                )}
              </>
            )}
            {modal === "long" && (
              <>
                <label className="hub-field-label">
                  TÍTULO
                  <input
                    aria-label="Título do vídeo longo"
                    value={longTitle}
                    onChange={(e) => setLongTitle(e.target.value)}
                  />
                </label>
                <div className="hub-long-selection">
                  {hub.clips.map((clip) => (
                    <label key={clip.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(clip.id)}
                        onChange={() => toggleSelection(clip.id)}
                      />
                      <img src={thumbnails(clip.sourceId)} alt="" />
                      <span>
                        {clip.title}
                        <small>{formatTime(clip.end - clip.start)}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <small>Os cortes seguem a ordem em que você os seleciona.</small>
                <div className="hub-dialog-actions">
                  <Button variant="ghost" onClick={() => setModal("")}>
                    Cancelar
                  </Button>
                  <Button disabled={Boolean(job)} onClick={assemble}>
                    <Film />
                    Montar vídeo longo
                  </Button>
                </div>
              </>
            )}
            {modal === "schedule" && (
              <>
                <label className="hub-field-label">
                  VÍDEO
                  <select
                    aria-label="Vídeo para agendar"
                    value={scheduleVideo}
                    onChange={(e) => setScheduleVideo(e.target.value)}
                  >
                    <option value="">Escolha um corte ou vídeo longo</option>
                    {hub.clips.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.title}
                      </option>
                    ))}
                    {hub.longs.map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="hub-field-label">
                  PLATAFORMA
                  <select
                    aria-label="Plataforma"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                  >
                    {Object.keys(hub.connections).map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="hub-field-label">
                  QUANDO
                  <input
                    aria-label="Quando publicar"
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </label>
                <p className="hub-insight">
                  <Clock />
                  Lembrete pessoal, sem publicação automática.
                </p>
                <div className="hub-dialog-actions">
                  <Button variant="ghost" onClick={() => setModal("")}>
                    Cancelar
                  </Button>
                  <Button onClick={schedule}>
                    <Clock />
                    Agendar
                  </Button>
                </div>
              </>
            )}
            {modal === "workspace" && (
              <>
                <label className="hub-field-label">
                  NOME DO WORKSPACE
                  <input
                    aria-label="Nome do workspace"
                    maxLength={40}
                    value={hub.settings.workspace}
                    onChange={(e) =>
                      update((state) => ({
                        ...state,
                        settings: { ...state.settings, workspace: e.target.value },
                      }))
                    }
                  />
                </label>
                <p>Seu espaço pessoal. Sem conta, sem assinatura.</p>
                <Button
                  onClick={() => {
                    setModal("");
                    announce("Estúdio atualizado.");
                  }}
                >
                  <Check />
                  Salvar
                </Button>
              </>
            )}
            {modal === "notifications" && (
              <div className="hub-notification-list">
                <div>
                  <ShieldCheck />
                  <span>
                    Seu estúdio está pronto.<small>{hub.clips.length} cortes no acervo.</small>
                  </span>
                </div>
                {hub.schedule.map((item) => (
                  <div key={item.id}>
                    <Clock />
                    <span>
                      {item.title}
                      <small>
                        {item.platform} · {new Date(item.when).toLocaleString("pt-BR")}
                      </small>
                    </span>
                  </div>
                ))}
                {Object.keys(results).length > 0 && (
                  <div>
                    <Check />
                    <span>Seu vídeo está pronto para salvar.</span>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p className="hub-error" role="alert">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

function HubStat({
  label,
  value,
  detail,
  tone,
  points,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
  points: string;
}) {
  return (
    <div className={`hub-stat tone-${tone}`}>
      <div className="hub-stat-label">
        {label}
        <ArrowUpRight />
      </div>
      <div className="hub-stat-number">
        {value}
        <svg viewBox="0 0 100 30" aria-hidden="true">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d={`M0 30 L${points.split(" ").join(" L")} L100 30Z`}
            fill="currentColor"
            opacity=".08"
          />
        </svg>
      </div>
      <small>{detail}</small>
    </div>
  );
}
function HubEmpty({
  title,
  text,
  action,
  label,
}: {
  title: string;
  text: string;
  action: () => void;
  label: string;
}) {
  return (
    <div className="hub-empty">
      <Scissors />
      <h3>{title}</h3>
      <p>{text}</p>
      <Button onClick={action}>
        <Plus />
        {label}
      </Button>
    </div>
  );
}
