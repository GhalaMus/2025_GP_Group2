import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Check,
  ExternalLink,
  GraduationCap,
  LayoutDashboard,
  List,
  MessageCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const API_BASE = import.meta.env.PROD
  ? "https://wecast.onrender.com"
  : "http://localhost:5000";

const STYLE_FILTER_ORDER = ["interview", "educational", "storytelling", "conversational"];

const STYLE_ICON_BY_KEY = {
  interview: Mic,
  educational: GraduationCap,
  storytelling: BookOpenText,
  conversational: MessageCircle,
  unknown: List,
};

function getEpisodeStyleRaw(ep) {
  return String(ep?.scriptStyle || ep?.style || ep?.script_style || "").trim();
}

function normalizeStyleKey(rawStyle) {
  const source = String(rawStyle || "").trim().toLowerCase();
  if (!source) return "unknown";
  if (source.includes("interview") || source.includes("مقاب")) return "interview";
  if (source.includes("educat") || source.includes("تعليم")) return "educational";
  if (source.includes("story") || source.includes("سرد")) return "storytelling";
  if (source.includes("convers") || source.includes("حوار")) return "conversational";
  return source.replace(/\s+/g, "_");
}

function EpisodeCover({ title, coverUrl, coverThumbB64 }) {
  const [imageFailed, setImageFailed] = useState(false);

  const initials = String(title || "EP")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

  const fallbackDataUrl = coverThumbB64
    ? `data:image/jpeg;base64,${coverThumbB64}`
    : "";
  const resolvedCover = !imageFailed && coverUrl ? coverUrl : fallbackDataUrl;

  if (resolvedCover) {
    return (
      <img
        src={resolvedCover}
        alt={`${title || "Episode"} cover`}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 text-sm font-bold text-neutral-700 dark:from-neutral-800 dark:to-neutral-700 dark:text-neutral-100">
      {initials || "EP"}
    </div>
  );
}

export default function Episodes() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const [q, setQ] = useState("");
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionInfo, setActionInfo] = useState("");
  const [playerError, setPlayerError] = useState("");
  const [activeAudioId, setActiveAudioId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState("");
  const [pendingDeleteEpisode, setPendingDeleteEpisode] = useState(null);
  const [recycleBin, setRecycleBin] = useState([]);
  const [isEmptyingBin, setIsEmptyingBin] = useState(false);
  const audioRef = useRef(null);

  const emptyBrief = t("episodes.briefFallback");
  const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const handleUnauthorized = () => {
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    window.dispatchEvent(new StorageEvent("storage", { key: "token", newValue: "" }));
    window.location.hash = "#/login?redirect=episodes";
  };

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        setLoading(true);
        setLoadError("");
        const res = await fetch(`${API_BASE}/api/episodes`, {
          headers: authHeaders,
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!res.ok) throw new Error(data?.error || "Failed to load episodes");
        if (isMounted) {
          setEpisodes(Array.isArray(data?.items) ? data.items : []);
          setRecycleBin(Array.isArray(data?.recycleBin) ? data.recycleBin : []);
        }
      } catch {
        if (isMounted) setLoadError(t("episodes.loadError"));
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [t, token, authHeaders]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const resolveAudioUrl = (raw) => {
    const src = String(raw || "").trim();
    if (!src) return "";
    if (src.startsWith("http://") || src.startsWith("https://")) return src;
    return `${API_BASE}${src}`;
  };

  const styleCounts = useMemo(() => {
    const counts = new Map();
    const labels = new Map();
    for (const ep of episodes) {
      const rawStyle = getEpisodeStyleRaw(ep);
      const key = normalizeStyleKey(rawStyle);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (rawStyle && !labels.has(key)) labels.set(key, rawStyle);
    }
    return { counts, labels };
  }, [episodes]);

  const styleFilters = useMemo(() => {
    const known = STYLE_FILTER_ORDER.map((key) => {
      const labelByKey = {
        interview: t("create.styles.interview.title"),
        educational: t("create.styles.educational.title"),
        storytelling: t("create.styles.storytelling.title"),
        conversational: t("create.styles.conversational.title"),
      };
      const rawLabel = styleCounts.labels.get(key);
      return {
        key,
        label: labelByKey[key] || rawLabel || key,
        count: styleCounts.counts.get(key) || 0,
      };
    });

    const custom = [...styleCounts.counts.entries()]
      .filter(([key]) => !STYLE_FILTER_ORDER.includes(key))
      .map(([key, count]) => ({
        key,
        label:
          key === "unknown"
            ? t("episodes.styles.unknown", "Other")
            : (styleCounts.labels.get(key) || key.replace(/_/g, " ")),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return [...known, ...custom];
  }, [styleCounts, t]);

  const filtered = useMemo(() => {
    if (activeFilter === "deleted") {
      const query = q.trim().toLowerCase();
      if (!query) return recycleBin;
      return recycleBin.filter((e) =>
        String(e.title || "").toLowerCase().includes(query) ||
        String(e.brief || "").toLowerCase().includes(query)
      );
    }

    const query = q.trim().toLowerCase();
    let base = episodes;
    if (activeFilter.startsWith("style:")) {
      const filterStyle = activeFilter.slice(6);
      base = base.filter((e) => normalizeStyleKey(getEpisodeStyleRaw(e)) === filterStyle);
    }

    if (!query) return base;
    return base.filter((e) =>
      String(e.title || "").toLowerCase().includes(query) ||
      String(e.brief || "").toLowerCase().includes(query)
    );
  }, [q, episodes, activeFilter, recycleBin]);

  const visibleEpisodes = filtered;
  const selectedEpisode = useMemo(
    () => [...episodes, ...recycleBin].find((e) => e.id === selectedEpisodeId) || null,
    [episodes, recycleBin, selectedEpisodeId]
  );

  useEffect(() => {
    if (!selectedEpisodeId) return;
    const exists = [...episodes, ...recycleBin].some((e) => e.id === selectedEpisodeId);
    if (!exists) setSelectedEpisodeId("");
  }, [episodes, recycleBin, selectedEpisodeId]);

  useEffect(() => {
    if (selectedEpisodeId) return;
    if (filtered.length > 0) {
      setSelectedEpisodeId(filtered[0].id);
    }
  }, [filtered, selectedEpisodeId]);

  const getEpisodeBrief = (ep) => {
    const brief = String(ep?.brief || "").trim();
    if (!brief) return emptyBrief;
    if (brief.length <= 160) return brief;
    return `${brief.slice(0, 160).trimEnd()}...`;
  };

  const openEpisode = (id) => {
    sessionStorage.setItem("preview_from", "episodes");
    window.location.hash = `#/preview?id=${encodeURIComponent(id)}&from=episodes`;
  };

  const startCreate = () => {
    window.location.hash = "#/create?from=studio";
  };

  const startEditEpisode = (ep) => {
      const editData = {
    podcastId: ep.id,
    script: ep.script || "",
    scriptTemplate: ep.scriptTemplate || "",
    showTitle: ep.title || "Podcast Show",
    episodeTitle: ep.title || "Podcast Show",
    scriptStyle: ep.scriptStyle || "",
    speakersCount: ep.speakersCount || 0,
    speakers: ep.speakers || [],
    description: ep.description || "",
    introMusic: ep.introMusic || "",
    bodyMusic: ep.bodyMusic || "",
    outroMusic: ep.outroMusic || "",
    category: ep.category || "",
  };
  sessionStorage.setItem("editData", JSON.stringify(editData));
  window.location.hash = "#/edit-podcast?id=" + encodeURIComponent(ep.id);
  };

  const formatClock = (value) => {
    const sec = Math.max(0, Math.floor(Number(value) || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const remainingSec = Math.max(0, Math.floor((playbackDuration || 0) - (playbackTime || 0)));

  const handleSeekEpisode = (ep, value) => {
    if (!audioRef.current || activeAudioId !== ep?.id) return;
    const nextTime = Number(value);
    if (!Number.isFinite(nextTime)) return;
    audioRef.current.currentTime = nextTime;
    setPlaybackTime(nextTime);
  };

  const renderProgress = (ep) => {
    if (activeAudioId !== ep?.id) return null;
    return (
      <div className="mt-2">
        <input
          type="range"
          min={0}
          max={Math.max(1, playbackDuration || 0)}
          value={Math.min(playbackTime, Math.max(1, playbackDuration || 0))}
          step="0.1"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onChange={(e) => handleSeekEpisode(ep, e.target.value)}
          className="w-full accent-purple-600 cursor-pointer"
          aria-label="Episode progress"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-black/55 dark:text-white/55">
          <span>{formatClock(playbackTime)}</span>
          <span>{t("episodes.timeLeft", { time: formatClock(remainingSec) })}</span>
        </div>
      </div>
    );
  };

  const togglePlayEpisode = async (ep) => {
    setPlayerError("");

    if (audioRef.current && activeAudioId === ep.id) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch {
          setPlayerError(t("episodes.playError"));
        }
      }
      return;
    }

    if (audioRef.current) audioRef.current.pause();

    let src = "";
    if (ep?.audioKey) {
      try {
        const res = await fetch(`${API_BASE}/api/audio/${ep.id}`, {
          headers: authHeaders,
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!res.ok || !data?.url) {
          throw new Error(data?.error || "Failed to load audio");
        }
        src = resolveAudioUrl(data.url);
        setEpisodes((prev) =>
          prev.map((item) => (item.id === ep.id ? { ...item, audioUrl: data.url } : item))
        );
      } catch {
        setPlayerError(t("episodes.playError"));
        return;
      }
    }

    if (!src) {
      src = resolveAudioUrl(ep?.audioUrl);
    }

    if (!src) return;

    const nextAudio = new Audio(src);
    nextAudio.ontimeupdate = () => setPlaybackTime(nextAudio.currentTime || 0);
    nextAudio.onloadedmetadata = () => {
      setPlaybackDuration(Number.isFinite(nextAudio.duration) ? nextAudio.duration : 0);
    };
    nextAudio.onended = () => {
      setIsPlaying(false);
      setActiveAudioId("");
      setPlaybackTime(0);
      setPlaybackDuration(0);
    };
    nextAudio.onpause = () => setIsPlaying(false);
    nextAudio.onplay = () => setIsPlaying(true);

    audioRef.current = nextAudio;
    setActiveAudioId(ep.id);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    try {
      await nextAudio.play();
      setIsPlaying(true);
    } catch {
      setPlayerError(t("episodes.playError"));
      setActiveAudioId("");
      setIsPlaying(false);
      setPlaybackTime(0);
      setPlaybackDuration(0);
    }
  };

  const requestDeleteEpisode = (ep) => {
    const id = ep?.id;
    if (!id) return;
    setPendingDeleteEpisode({
      id,
      title: ep?.title || t("episodes.thisEpisode"),
    });
  };

  const moveEpisodeToRecycleBin = async (ep) => {
    const id = ep?.id;
    if (!id) return;
    const episodePayload = episodes.find((item) => item.id === id) || ep;

    setActionInfo("");
    setActionError("");
    try {
      const res = await fetch(`${API_BASE}/api/episodes/${encodeURIComponent(id)}/trash`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to move episode to recycle bin");

      if (activeAudioId === id && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setActiveAudioId("");
        setIsPlaying(false);
        setPlaybackTime(0);
        setPlaybackDuration(0);
      }

      setEpisodes((prev) => prev.filter((item) => item.id !== id));
      setRecycleBin((prev) => [{ ...episodePayload, deletedAt: data?.deletedAt || new Date().toISOString() }, ...prev.filter((x) => x.id !== id)]);
      setActionInfo(t("episodes.recycle.moved", { title: episodePayload?.title || t("episodes.thisEpisode") }));
    } catch {
      setActionError(t("episodes.deleteError"));
    }
  };

  const restoreFromRecycleBin = async (id) => {
    const target = recycleBin.find((ep) => ep.id === id);
    if (!target) return;
    setActionInfo("");
    setActionError("");
    try {
      const res = await fetch(`${API_BASE}/api/episodes/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to restore episode");

      const { deletedAt, deleteAfter, ...restoredEpisode } = target;
      setRecycleBin((prev) => prev.filter((ep) => ep.id !== id));
      setEpisodes((prev) => [restoredEpisode, ...prev]);
      setActionInfo(t("episodes.recycle.restored", { title: target?.title || t("episodes.thisEpisode") }));
    } catch {
      setActionError(t("episodes.deleteError"));
    }
  };

  const permanentlyDeleteFromRecycleBin = async (ep) => {
    const id = ep?.id;
    if (!id) return;
    setActionInfo("");
    setActionError("");
    try {
      const res = await fetch(`${API_BASE}/api/episodes/${encodeURIComponent(id)}/delete`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to delete episode");
      setRecycleBin((prev) => prev.filter((x) => x.id !== id));
      setActionInfo(t("Episode deleted successfully", { title: ep?.title || t("episodes.thisEpisode") }));
    } catch {
      setActionError(t("episodes.deleteError"));
    }
  };

  const emptyRecycleBin = async () => {
    if (!recycleBin.length || isEmptyingBin) return;
    setIsEmptyingBin(true);
    setActionInfo("");
    setActionError("");

    const failed = [];
    for (const ep of recycleBin) {
      try {
        const res = await fetch(`${API_BASE}/api/episodes/${encodeURIComponent(ep.id)}/delete`, {
          method: "POST",
          headers: authHeaders,
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          setIsEmptyingBin(false);
          return;
        }
        if (!res.ok) throw new Error(data?.error || "Failed to delete episode");
      } catch {
        failed.push(ep);
      }
    }

    if (failed.length) {
      setRecycleBin(failed);
      setActionError(t("episodes.recycle.emptyError", { count: failed.length }));
    } else {
      const removedCount = recycleBin.length;
      setRecycleBin([]);
      setActionInfo(t("episodes.recycle.emptied", { count: removedCount }));
    }
    setIsEmptyingBin(false);
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-cream dark:bg-[#0a0a1a] text-black dark:text-white flex flex-col">
      <main className="w-full flex-1 min-h-0 pt-0 pb-0">
        <div className="mx-auto w-full h-full min-h-0 overflow-hidden border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/45 shadow-[0_10px_30px_rgba(0,0,0,0.08)] backdrop-blur-sm">
          <div className="h-full min-h-0 md:flex md:items-stretch">
            <aside className="border-b md:border-b-0 md:border-r border-black/10 dark:border-white/10 bg-white/45 dark:bg-neutral-950/30 backdrop-blur-sm p-4 sm:p-5 md:w-80 md:shrink-0 md:overflow-y-auto">
              <div className="mb-4 rounded-2xl border border-white/60 dark:border-white/10 bg-white/55 dark:bg-neutral-900/60 backdrop-blur-md p-3 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.2em] text-black/55 dark:text-white/60">{t("episodes.sidebar.library")}</p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFilter("all");
                      setQ("");
                    }}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                      activeFilter === "all"
                        ? "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-500/25 dark:text-purple-100 dark:border-purple-400/40"
                        : "bg-white/70 text-black/85 dark:bg-neutral-900/80 dark:text-white border-black/10 dark:border-white/10 hover:bg-white/90 dark:hover:bg-white/10"
                    }`}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    {t("episodes.sidebar.viewAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("deleted")}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                      activeFilter === "deleted"
                        ? "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-500/25 dark:text-purple-100 dark:border-purple-400/40"
                        : "bg-white/70 text-black/85 dark:bg-neutral-900/80 dark:text-white border-black/10 dark:border-white/10 hover:bg-white/90 dark:hover:bg-white/10"
                    }`}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("episodes.sidebar.recycleBin")}
                    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full border border-current/20 px-1.5 text-[11px] leading-5">
                      {recycleBin.length}
                    </span>
                  </button>

                  <div className="mt-2 border-t border-black/10 dark:border-white/10 pt-2">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-black/50 dark:text-white/55">
                      {t("create.step4.style")}
                    </p>
                    <div className="grid gap-2">
                      {styleFilters.map((styleItem) => {
                        const filterKey = `style:${styleItem.key}`;
                        const StyleIcon = STYLE_ICON_BY_KEY[styleItem.key] || List;
                        return (
                          <button
                            key={styleItem.key}
                            type="button"
                            onClick={() => setActiveFilter(filterKey)}
                            className={`inline-flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${
                              activeFilter === filterKey
                                ? "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-500/25 dark:text-purple-100 dark:border-purple-400/40"
                                : "bg-white/70 text-black/85 dark:bg-neutral-900/80 dark:text-white border-black/10 dark:border-white/10 hover:bg-white/90 dark:hover:bg-white/10"
                            }`}
                          >
                            <span className="inline-flex items-center gap-2">
                              <StyleIcon className="h-4 w-4" />
                              {styleItem.label}
                            </span>
                            <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-current/20 px-1.5 text-[11px] leading-5">
                              {styleItem.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/60 dark:border-white/10 bg-white/55 dark:bg-neutral-900/60 backdrop-blur-md p-3 shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.2em] text-black/55 dark:text-white/60">{t("episodes.sidebar.actions")}</p>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={startCreate}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-semibold hover:opacity-95"
                  >
                    <Plus className="h-4 w-4" />
                    {t("episodes.sidebar.createNew")}
                  </button>
            
                </div>
              </div>

            </aside>

            <section dir={isRTL ? "rtl" : "ltr"} className="min-w-0 flex-1 bg-white/35 dark:bg-neutral-900/20 p-4 sm:p-6 lg:p-7 md:flex md:min-h-0 md:flex-col md:overflow-hidden">
              <div className={`flex flex-wrap items-center justify-between gap-3 ${isRTL ? "text-right" : ""}`}>
                <div>
                  <div className={`flex items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
                    <h1 className="heading-md text-black dark:text-white">{t("episodes.pageTitle")}</h1>
                    <div className="relative h-6 w-6 shrink-0" aria-hidden="true">
                      <span className="absolute inset-0 rounded-full border border-purple-400/70 dark:border-purple-300/60 animate-spin-slow" />
                      <span className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 animate-pulse" />
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-yellow-400 animate-bounce" />
                    </div>
                  </div>
                  <p className="body-sm mt-2 text-black/65 dark:text-white/65">{t("episodes.pageSubtitle")}</p>
                </div>
                <div className="inline-flex h-10 items-center rounded-full border border-black/10 dark:border-white/10 bg-white/90 dark:bg-neutral-900 px-4 text-sm font-semibold">
                  {t("episodes.resultsCount", { count: filtered.length })}
                </div>
              </div>

              <div className="mt-4 max-w-4xl">
                <div className="group flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 bg-white/85 dark:bg-neutral-900/85 backdrop-blur-md px-4 py-2.5 shadow-sm focus-within:border-purple-300 dark:focus-within:border-purple-400/60">
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-100 via-purple-100 to-indigo-100 text-purple-700 ring-1 ring-purple-200/80 shadow-sm dark:from-purple-500/30 dark:via-fuchsia-500/20 dark:to-indigo-500/25 dark:text-purple-100 dark:ring-purple-300/30">
                    <Search className="h-[18px] w-[18px] transition-transform duration-200 ease-out group-hover:scale-110" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={t("episodes.searchPlaceholder")}
                      className="w-full bg-transparent text-sm text-black dark:text-white outline-none placeholder:text-black/40 dark:placeholder:text-white/40"
                    />
                  </div>
                  {q && (
                    <button
                      type="button"
                      onClick={() => setQ("")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-black/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10"
                      title={t("episodes.clearSearch", "Clear search")}
                      aria-label={t("episodes.clearSearch", "Clear search")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {actionInfo && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{actionInfo}</p>}
              {actionError && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{actionError}</p>}
              {playerError && <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{playerError}</p>}

              <div className="mt-6 min-h-0 flex-1 rounded-2xl border border-black/10 dark:border-white/10 bg-white/45 dark:bg-neutral-900/35 p-2 sm:p-3">
                <div className="episodes-scrollbar h-full overflow-y-auto overscroll-contain pr-2">
                  <div className="grid gap-3">
                {loading ? (
                  <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/90 dark:bg-neutral-900/70 p-5 text-sm text-black/70 dark:text-white/70">{t("episodes.loading")}</div>
                ) : loadError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{loadError}</div>
                ) : filtered.length === 0 ? (
                  <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/90 dark:bg-neutral-900/70 p-5 text-sm text-black/70 dark:text-white/70">
                    {q.trim()
                      ? t("episodes.searchEmpty")
                      : activeFilter === "deleted"
                        ? t("episodes.recycle.empty")
                      : t("episodes.empty")}
                  </div>
                ) : (
                  visibleEpisodes.map((ep) => (
                    <div
                      key={ep.id}
                      onClick={() => setSelectedEpisodeId(ep.id)}
                      className={`min-h-[128px] overflow-hidden rounded-2xl border bg-white/95 dark:bg-neutral-900/80 transition hover:border-purple-500 dark:hover:border-purple-400 hover:bg-purple-100/55 dark:hover:bg-purple-900/25 hover:shadow-md cursor-pointer ${
                        selectedEpisodeId === ep.id
                          ? "border-purple-500 ring-2 ring-purple-300/70 dark:ring-purple-500/45 bg-purple-50/45 dark:bg-purple-900/20"
                          : "border-black/10 dark:border-white/10"
                      } ${isRTL ? "text-right" : "text-left"}`}
                    >
                      <div className="flex flex-col items-stretch sm:flex-row">
                        <div className={`flex flex-1 min-w-0 ${isRTL ? "text-right" : "text-left"}`}>
                          <div className={`min-h-[112px] w-full sm:w-[7.5rem] md:w-32 shrink-0 overflow-hidden bg-neutral-100/80 dark:bg-white/10 ${isRTL ? "sm:border-l border-black/10 dark:border-white/15" : "sm:border-r border-black/10 dark:border-white/15"}`}>
                            <EpisodeCover title={ep.title} coverUrl={ep.coverUrl} coverThumbB64={ep.coverThumbB64} />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col justify-center p-3.5 sm:p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/50 dark:text-white/50">{t("episodes.itemLabel")}</p>
                            {ep.hasEditDraft && (
                              <div className={`mt-1 inline-flex w-fit items-center gap-2 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-400/30 dark:bg-amber-900/15 dark:text-amber-200 ${isRTL ? "self-end" : ""}`}>
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                Editing In Progress
                              </div>
                            )}
                            <div
                              className="text-base font-semibold leading-snug mt-1"
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 2,
                                overflow: "hidden",
                              }}
                            >
                              {ep.title || t("episodes.untitledEpisode")}
                            </div>
                            <p
                              className="body-sm mt-1 min-h-[3.2rem] text-black/70 dark:text-white/70 leading-relaxed"
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 2,
                                overflow: "hidden",
                              }}
                            >
                              {getEpisodeBrief(ep)}
                            </p>
                            {renderProgress(ep)}
                          </div>
                        </div>

                        <div className={`flex flex-wrap items-start gap-2 border-t border-black/5 p-3.5 sm:border-t-0 sm:p-4 ${isRTL ? "sm:pr-0" : "sm:pl-0"}`}>
                          {selectedEpisodeId === ep.id && (
                            <span className={`inline-flex h-9 items-center gap-1 px-1 text-xs font-semibold text-purple-500 ${isRTL ? "sm:order-5" : ""}`}>
                              <Check className="h-3 w-3" />
                              {t("episodes.card.selected")}
                            </span>
                          )}
                          {activeFilter === "deleted" ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  restoreFromRecycleBin(ep.id);
                                }}
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 dark:border-white/15 px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
                                title={t("episodes.recycle.undoLatest")}
                              >
                                <Undo2 className="h-4 w-4" />
                                <span className="hidden sm:inline">{t("episodes.recycle.restore")}</span>
                              </button>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await permanentlyDeleteFromRecycleBin(ep);
                                }}
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 dark:border-red-400/30 px-3 text-sm font-semibold text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                                title={t("episodes.recycle.emptyNow")}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="hidden sm:inline">{t("episodes.recycle.emptyNow")}</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEpisode(ep.id);
                                }}
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-black bg-black px-3 text-sm font-semibold text-white hover:bg-black/90 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white/90"
                                title={t("episodes.card.view")}
                              >
                                <ExternalLink className="h-4 w-4" />
                                <span className="hidden sm:inline">{t("episodes.card.view")}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditEpisode(ep);
                                }}
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 dark:border-white/15 px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
                                title={ep.hasEditDraft ? "Continue Editing" : t("episodes.card.edit")}
                              >
                                <Pencil className="h-4 w-4" />
                                <span className="hidden sm:inline">{ep.hasEditDraft ? "Continue Editing" : t("episodes.card.edit")}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePlayEpisode(ep);
                                }}
                                disabled={!Boolean(ep.audioKey || resolveAudioUrl(ep.audioUrl))}
                                className="inline-flex h-9 items-center gap-1 rounded-lg border border-black/10 dark:border-white/15 px-3 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={activeAudioId === ep.id && isPlaying ? t("episodes.card.pause") : t("episodes.card.play")}
                              >
                                {activeAudioId === ep.id && isPlaying ? (
                                  <Pause className="h-4 w-4" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                                <span className="hidden sm:inline">
                                  {activeAudioId === ep.id && isPlaying ? t("episodes.card.pause") : t("episodes.card.play")}
                                </span>
                              </button>
                              <button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    requestDeleteEpisode(ep);
  }}
  className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 dark:border-red-400/30 px-3 text-sm font-semibold text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
  title={t("episodes.deleteEpisode")}
>
  <Trash2 className="h-4 w-4" />
  <span className="hidden sm:inline">{t("episodes.deleteEpisode")}</span>
</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
      {pendingDeleteEpisode && (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-[min(92vw,480px)] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl p-6">
            <div className="flex items-center gap-4">
              <img
                src="/logo.png"
                alt="WeCast logo"
                className="h-12 w-12 rounded-full object-contain animate-[spin_6s_linear_infinite]"
              />
              <div>
                <h2 className="font-extrabold text-black dark:text-white">
                  {t("episodes.modal.deleteTitle")}
                </h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {t("episodes.modal.deleteBody")}
                </p>
              </div>
            </div>
            <p className="mt-5 text-sm text-black/70 dark:text-white/70">
              {t("episodes.modal.deletePrompt", { title: pendingDeleteEpisode.title })}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDeleteEpisode(null)}
                className="mt-5 px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/5 transition"
              >
                {t("episodes.modal.cancel")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = pendingDeleteEpisode;
                  setPendingDeleteEpisode(null);
                  await moveEpisodeToRecycleBin(target);
                }}
                className="mt-5 px-4 py-2 rounded-xl border border-red-300 dark:border-red-400/30 bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition"
              >
                {t("episodes.recycle.moveAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
