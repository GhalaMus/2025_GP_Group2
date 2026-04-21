// Preview.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Mic2, Save } from "lucide-react";
import WeCastAudioPlayer from "./WeCastAudioPlayer";
import {
  clearPendingPreviewDraft,
  clearPendingPreviewSave,
  getPendingPreviewDraft,
  getPendingPreviewSave,
  queuePendingPreviewSave,
  storeAuthRedirectIntent,
  storePendingPreviewDraft,
} from "../utils/authRedirect";

const API_BASE = import.meta.env.PROD
  ? "https://wecast.onrender.com"
  : "http://localhost:5000";

/* -----------------------------
   Summary helpers
------------------------------ */

const generateSimpleSummary = (words) => {
  if (!words || words.length === 0) return "";

  const transcript = words.map((w) => w.w).join(" ");
  const sentences = transcript.split(/[.!?]+/);
  let summarySentences = [];
  let wordCount = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).length;
    if (wordCount + sentenceWords <= 250) {
      summarySentences.push(sentence.trim() + ".");
      wordCount += sentenceWords;
    } else {
      break;
    }
  }

  if (summarySentences.length === 0 && sentences.length > 0) {
    summarySentences = [sentences[0].substring(0, 250) + "..."];
  }

  let summary = summarySentences.join(" ");
  const summaryWords = summary.split(/\s+/);
  if (summaryWords.length > 250) {
    summary = summaryWords.slice(0, 250).join(" ") + "...";
  }

  return summary;
};

const isLikelyArabic = (text = "") => /[\u0600-\u06FF]/.test(text);

const generateSummary = async (words, podcastId, language) => {
  if (!words || words.length === 0) return "";

  const transcript = words.map((w) => w.w).join(" ");

  if (transcript.split(/\s+/).length < 50) {
    return transcript.substring(0, 500) + "...";
  }

  try {
    const response = await fetch(`${API_BASE}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: transcript,
        podcastId,
        ...(language ? { language } : {}),
      }),
      credentials: "include",
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    return data.summary || "";
  } catch (error) {
    console.error("Failed to generate AI summary:", error);
    return generateSimpleSummary(words);
  }
};

function formatMMSS(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* -----------------------------
   Component
------------------------------ */

export default function Preview() {
  const { t, i18n } = useTranslation();
  const [audioUrl, setAudioUrl] = useState("");
  const [audioKey, setAudioKey] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [coverThumbB64, setCoverThumbB64] = useState("");
  const [coverImageFailed, setCoverImageFailed] = useState(false);
  const [words, setWords] = useState([]);
  const [title, setTitle] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [summary, setSummary] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [isChaptersOpen, setIsChaptersOpen] = useState(true);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [transcriptCardHeight, setTranscriptCardHeight] = useState(null);
  const [transcriptBodyHeight, setTranscriptBodyHeight] = useState(null);
  const [podcastLanguage, setPodcastLanguage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveMessageType, setSaveMessageType] = useState("info");
  const [category, setCategory] = useState("");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [episodeNumber, setEpisodeNumber] = useState(null);
  const [summaryLoadedFromDb, setSummaryLoadedFromDb] = useState(false);
  const [showSaveAuthModal, setShowSaveAuthModal] = useState(false);
  const authToken = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
  const isAuthenticated = !!authToken;
  const pendingSaveHandledRef = useRef(false);
  const previewNoticeKey = "wecast:previewSaveNotice";

  const transcriptRef = useRef(null);
  const activeWordRef = useRef(null);
  const audioCardRef = useRef(null);
  const rightColRef = useRef(null);
  const transcriptCardRef = useRef(null);
  const transcriptHeaderRef = useRef(null);
  const transcriptFooterRef = useRef(null);
  const chaptersRecoveryAttemptedRef = useRef(false);

  // user scroll control
  const [userInteracting, setUserInteracting] = useState(false);
  const interactionTimerRef = useRef(null);

  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const episodeId = params.get("id");
  const fromSource = params.get("from") || sessionStorage.getItem("preview_from") || "";
  const isFromDashboardPreview = fromSource === "episodes";
  const isFromStudioCreatePreview = fromSource === "studio_create";
  const useDashboardGlassTone = isFromDashboardPreview || isFromStudioCreatePreview;
  const dashboardShellClass = "w-full border-b border-black/10 bg-white/70 dark:bg-neutral-900/45 shadow-[0_10px_30px_rgba(0,0,0,0.08)] backdrop-blur-sm";
  const dashboardContentClass = "mx-auto w-full max-w-[1400px] px-4 pt-4 pb-8 bg-white/35 dark:bg-neutral-900/20 space-y-6 sm:px-6 sm:pb-10";
  const dashboardCardClass = "rounded-3xl border border-purple-200/90 dark:border-purple-400/30 bg-white/55 dark:bg-neutral-900/60 backdrop-blur-md shadow-sm";
  const previewTitleCardClass = "overflow-hidden rounded-[28px] border border-[#eadcf6] bg-white/78 shadow-[0_12px_36px_rgba(15,23,42,0.10)] backdrop-blur-md dark:border-[#6f5a86]/30 dark:bg-neutral-900/42";
  const previewCardClass = dashboardCardClass;
  const [externalSeek, setExternalSeek] = useState(null);
  const displayTitle = title || t("episodes.untitledEpisode");
  const resolvedCoverSrc = useMemo(() => {
    if (!coverImageFailed && coverUrl) return coverUrl;
    if (coverThumbB64) return `data:image/jpeg;base64,${coverThumbB64}`;
    return "";
  }, [coverImageFailed, coverThumbB64, coverUrl]);
  const titleDir = useMemo(() => {
    if (isLikelyArabic(displayTitle) || podcastLanguage === "ar") return "rtl";
    return "ltr";
  }, [displayTitle, podcastLanguage]);
  const titleMeta = useMemo(() => {
    if (category) return category;
    if (seriesTitle && episodeNumber) {
      return `${seriesTitle} · ${t("preview.episodeNumber", { number: episodeNumber })}`;
    }
    if (seriesTitle) return seriesTitle;
    if (episodeNumber) return t("preview.episodeNumber", { number: episodeNumber });
    return "";
  }, [category, episodeNumber, seriesTitle, t]);
  const hasPreviewContent = useMemo(
    () =>
      Boolean(
        audioUrl ||
          audioKey ||
          words.length ||
          title ||
          summary ||
          chapters.length
      ),
    [audioKey, audioUrl, chapters.length, summary, title, words.length]
  );
  const showPreviewSaveAction = !isFromDashboardPreview && hasPreviewContent;

  const buildPreviewAuthHash = (route = "signup") => {
    const nextParams = new URLSearchParams();
    nextParams.set("redirect", "preview");
    if (episodeId) nextParams.set("id", episodeId);
    if (fromSource) nextParams.set("from", fromSource);
    return `#/${route}?${nextParams.toString()}`;
  };

  const queuePendingGuestSave = () => {
    queuePendingPreviewSave({
      id: episodeId || "",
      from: fromSource || "",
      requestedAt: Date.now(),
    });

    storeAuthRedirectIntent({
      redirect: "preview",
      id: episodeId || "",
      from: fromSource || "",
    });

    if (!episodeId && hasPreviewContent) {
      storePendingPreviewDraft({
        url: audioUrl,
        audioKey,
        words,
        title: displayTitle,
        summary,
        chapters,
        language: podcastLanguage,
        category,
      });
    }
  };

  const redirectForSaveAuth = (route = "signup") => {
    queuePendingGuestSave();
    setShowSaveAuthModal(false);
    window.location.hash = buildPreviewAuthHash(route);
  };

  // load initial preview data
  useEffect(() => {
    if (episodeId) return;
    let saved = sessionStorage.getItem("wecast_preview");
    if (!saved) {
      const backupDraft = getPendingPreviewDraft();
      if (backupDraft) {
        saved = JSON.stringify(backupDraft);
        sessionStorage.setItem("wecast_preview", saved);
      }
    }
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p?.url) setAudioUrl(p.url);
        if (p?.audioKey) setAudioKey(p.audioKey);
        if (Array.isArray(p?.words)) setWords(p.words);
        if (p?.title) setTitle(p.title);
        if (p?.summary) setSummary(p.summary);
        if (Array.isArray(p?.chapters)) setChapters(p.chapters);
        if (p?.language) setPodcastLanguage(p.language);
        if (p?.category) setCategory(p.category);
        if (p?.audioKey) {
          fetch(`${API_BASE}/api/audio/last`, { credentials: "include" })
            .then((r) => r.json())
            .then((d) => {
              if (d?.url) setAudioUrl(d.url);
              if (d?.audioKey) setAudioKey(d.audioKey);
            })
            .catch(() => {});
        }
      } catch {}
    }

    if (!saved) {
      fetch(`${API_BASE}/api/audio/last`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          if (d?.url) setAudioUrl(d.url);
          if (d?.audioKey) setAudioKey(d.audioKey);
        })
        .catch(() => {});

      fetch(`${API_BASE}/api/transcript/last`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d?.words)) setWords(d.words);
        })
        .catch(() => {});
    }
  }, [episodeId]);

  useEffect(() => {
    const savedNotice = sessionStorage.getItem(previewNoticeKey);
    if (!savedNotice) return;
    try {
      const parsed = JSON.parse(savedNotice);
      if (parsed?.message) {
        setSaveMessage(parsed.message);
        setSaveMessageType(parsed.type || "success");
      }
    } catch {}
    sessionStorage.removeItem(previewNoticeKey);
  }, []);

  // load episode data by id
  useEffect(() => {
    if (!episodeId) return;
    let isMounted = true;

    setSummary("");
    setSummaryLoadedFromDb(false);
    setChapters([]);
    setWords([]);
    setAudioUrl("");
    setAudioKey("");
    setCoverUrl("");
    setCoverThumbB64("");
    setCoverImageFailed(false);
    setTitle("");
    setCategory("");
    setSeriesTitle("");
    setEpisodeNumber(null);
    chaptersRecoveryAttemptedRef.current = false;

    const loadEpisode = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/podcasts/${episodeId}`, {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) return;

        const podcast = data?.podcast || {};
        if (!isMounted) return;

        if (podcast.audioKey) {
          setAudioKey(podcast.audioKey);
        }
        setCoverImageFailed(false);
        setCoverUrl(podcast.coverUrl || "");
        setCoverThumbB64(podcast.coverThumbB64 || "");

        if (podcast.audioKey) {
          const audioRes = await fetch(`${API_BASE}/api/audio/${episodeId}`, {
            credentials: "include",
          });
          const audioData = await audioRes.json();

          if (audioRes.ok && audioData?.url) {
            setAudioUrl(audioData.url);
          }
        } else if (podcast.audioUrl) {
          const baseUrl = podcast.audioUrl.startsWith("http")
            ? podcast.audioUrl
            : `${API_BASE}${podcast.audioUrl}`;
          setAudioUrl(baseUrl);
        }

        if (podcast.title) setTitle(podcast.title);

        const savedSummary = podcast.summary;
        const savedChapters = podcast.chapters;
        const podLang = podcast.language || "";
        const sumLang = podcast.summaryLanguage || "";
        const savedCategory = podcast.category || "";
        const seriesName = podcast.seriesTitle || "";
        const episodeNo = podcast.episodeNumber ?? null;

        if (podLang) setPodcastLanguage(podLang);
        if (Array.isArray(savedChapters)) setChapters(savedChapters);
        if (savedCategory) setCategory(savedCategory);
        if (seriesName) setSeriesTitle(seriesName);
        if (episodeNo) setEpisodeNumber(episodeNo);

        if (savedSummary && (!podLang || sumLang === podLang)) {
          setSummary(savedSummary);
          setSummaryLoadedFromDb(true);
        } else {
          setSummary("");
          setSummaryLoadedFromDb(false);
        }
      } catch {}
    };

    const loadTranscript = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/podcasts/${episodeId}/transcript`, {
          credentials: "include",
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data?.words)) {
          if (isMounted) setWords(data.words);
        }
      } catch {}
    };

    loadEpisode();
    loadTranscript();

    return () => {
      isMounted = false;
    };
  }, [episodeId]);

  useEffect(() => {
    if (!episodeId) return;
    if (chaptersRecoveryAttemptedRef.current) return;
    if (chapters.length > 0) return;
    if (!Array.isArray(words) || words.length === 0) return;

    let cancelled = false;
    chaptersRecoveryAttemptedRef.current = true;

    const ensureChapters = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/podcasts/${episodeId}/chapters/ensure`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        if (Array.isArray(data?.chapters) && data.chapters.length > 0) {
          setChapters(data.chapters);
        }
      } catch {}
    };

    ensureChapters();

    return () => {
      cancelled = true;
    };
  }, [episodeId, chapters.length, words]);

  // generate summary for episode when transcript is ready and none saved
  useEffect(() => {
    if (!episodeId) return;
    if (summaryLoadedFromDb) return;
    if (!words || words.length === 0) return;

    const generate = async () => {
      try {
        setIsGeneratingSummary(true);
        const transcriptText = words.map((w) => w.w).join(" ");
        let langToUse = podcastLanguage || undefined;
        if (isLikelyArabic(transcriptText) && langToUse !== "ar") {
          langToUse = "ar";
        }
        const newSummary = await generateSummary(words, episodeId, langToUse);
        setSummary(newSummary);
      } catch (e) {
        console.error("Summary generation failed:", e);
      } finally {
        setIsGeneratingSummary(false);
      }
    };

    generate();
  }, [episodeId, words, summaryLoadedFromDb, podcastLanguage]);

  // generate summary for non-episode preview only
  useEffect(() => {
    if (episodeId) return;
    if (!words || words.length === 0) return;

    const loadOrGenerate = async () => {
      try {
        setIsGeneratingSummary(true);

        const transcriptText = words.map((w) => w.w).join(" ");
        let langToUse = podcastLanguage || undefined;
        if (isLikelyArabic(transcriptText) && langToUse !== "ar") {
          langToUse = "ar";
        }

        const newSummary = await generateSummary(words, episodeId, langToUse);
        setSummary(newSummary);

        try {
          const saved = sessionStorage.getItem("wecast_preview");
          if (saved) {
            const p = JSON.parse(saved);
            p.summary = newSummary;
            sessionStorage.setItem("wecast_preview", JSON.stringify(p));
          }
        } catch {}
      } catch (e) {
        console.error("Summary load/generate failed:", e);
        setSummary(generateSimpleSummary(words));
      } finally {
        setIsGeneratingSummary(false);
      }
    };

    loadOrGenerate();
  }, [episodeId, words, podcastLanguage]);

  // find active word
  const activeIndex = useMemo(() => {
    if (!words.length) return -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (currentTime >= w.start && currentTime < w.end) return i;
    }
    return -1;
  }, [currentTime, words]);

  const transcriptText = useMemo(
    () => words.map((w) => String(w?.w || "")).join(" "),
    [words]
  );
  const transcriptDir = useMemo(() => {
    if (isLikelyArabic(transcriptText)) return "rtl";
    if (podcastLanguage === "ar") return "rtl";
    return "ltr";
  }, [transcriptText, podcastLanguage]);

  const hasSpeakerInfo = useMemo(
    () => words.some((w) => typeof w.speaker === "string" && w.speaker.trim()),
    [words]
  );
  const transcriptTokens = useMemo(() => {
    if (!words.length) return [];
    const tokens = [];
    let lastSpeaker = null;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const speaker =
        typeof w.speaker === "string" ? w.speaker.trim() : "";

      if (speaker && speaker !== lastSpeaker) {
        tokens.push({
          type: "speaker",
          speaker,
          start: w.start,
          key: `sp-${i}-${w.start}`,
        });
        lastSpeaker = speaker;
      }

      tokens.push({
        type: "word",
        word: w,
        index: i,
        key: `w-${i}-${w.start}`,
      });
    }

    return tokens;
  }, [words]);

  // Auto-scroll ONLY when user not interacting
  useEffect(() => {
    if (activeIndex < 0) return;
    if (userInteracting) return;
    if (!activeWordRef.current) return;
    if (!transcriptRef.current) return;

    const container = transcriptRef.current;
    const target = activeWordRef.current;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const above = targetRect.top < containerRect.top + 20;
    const below = targetRect.bottom > containerRect.bottom - 20;

    if (above || below) {
      const offset =
        target.offsetTop - container.offsetTop - container.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, offset),
        behavior: "smooth",
      });
    }
  }, [activeIndex, userInteracting]);

  useEffect(() => {
    const rightEl = rightColRef.current;
    const audioEl = audioCardRef.current;
    const headerEl = transcriptHeaderRef.current;
    const footerEl = transcriptFooterRef.current;

    if (!rightEl || !audioEl || !headerEl) return;

    const gap = 16; // matches gap-4 between audio + transcript
    const minCard = 260;

    const update = () => {
      const rightH = rightEl.offsetHeight || 0;
      const audioH = audioEl.offsetHeight || 0;
      const headerH = headerEl.offsetHeight || 0;
      const footerH = footerEl ? footerEl.offsetHeight || 0 : 0;

      let target = rightH - audioH - gap;
      if (!Number.isFinite(target) || target <= 0) return;
      if (target < minCard) target = minCard;

      const bodyTarget = Math.max(80, target - headerH - footerH - 40);

      setTranscriptCardHeight(target);
      setTranscriptBodyHeight(bodyTarget);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(rightEl);
    ro.observe(audioEl);
    ro.observe(headerEl);
    if (footerEl) ro.observe(footerEl);
    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [isChaptersOpen, isSummaryOpen, summary, chapters]);
  const markUserInteraction = () => {
    setUserInteracting(true);
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);

    interactionTimerRef.current = setTimeout(() => {
      setUserInteracting(false);
    }, 5000);
  };

  const handleWordClick = (sec) => {
    setUserInteracting(false);
    setExternalSeek(sec);
  };

  const handleSaveAll = async () => {
    if (!isAuthenticated) {
      setShowSaveAuthModal(true);
      return;
    }

    setIsSaving(true);
    setSaveMessage("");
    setSaveMessageType("info");

    try {
      const payload = {
        title: displayTitle,
        audioUrl,
        audioKey,
        summary,
        chapters,
        words,
        language: podcastLanguage,
        transcriptText,
      };

      const createSnapshotSave = () =>
        fetch(`${API_BASE}/api/preview/save`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

      let usedSnapshotFallback = false;
      let res = null;

      if (episodeId) {
        res = await fetch(`${API_BASE}/api/podcasts/${episodeId}/save-all`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.status === 401) {
          setShowSaveAuthModal(true);
          return;
        }

        if (!res.ok && (res.status === 403 || res.status === 404) && !isFromDashboardPreview) {
          usedSnapshotFallback = true;
          res = await createSnapshotSave();
        }
      } else {
        res = await createSnapshotSave();
      }

      if (res.status === 401) {
        setShowSaveAuthModal(true);
        return;
      }

      if (!res.ok) throw new Error(`Save failed: ${res.status}`);

      const data = await res.json().catch(() => ({}));

      setSaveMessageType("success");
      setSaveMessage(t("preview.saveSuccess"));

      if ((!episodeId || usedSnapshotFallback) && data?.podcastId) {
        sessionStorage.setItem(
          previewNoticeKey,
          JSON.stringify({ type: "success", message: t("preview.saveSuccess") })
        );
        clearPendingPreviewSave();
        clearPendingPreviewDraft();
        const nextFrom = fromSource || "create";
        window.location.hash = `#/preview?id=${encodeURIComponent(data.podcastId)}&from=${encodeURIComponent(nextFrom)}`;
        return;
      }

      clearPendingPreviewSave();
      clearPendingPreviewDraft();
    } catch (e) {
      console.error("Save failed", e);
      setSaveMessageType("error");
      setSaveMessage(t("preview.saveFailed"));
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(""), 3000);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || pendingSaveHandledRef.current) return;

    const intent = getPendingPreviewSave();
    if (!intent) return;

    if ((intent.id || "") !== (episodeId || "")) return;
    if ((intent.from || "") !== (fromSource || "")) return;
    if (!episodeId && !audioUrl) return;

    pendingSaveHandledRef.current = true;
    clearPendingPreviewSave();
    handleSaveAll();
  }, [isAuthenticated, episodeId, fromSource, audioKey, audioUrl]);

  const handleBack = () => {
    // Preferred behavior: return exactly one navigation step back.
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    if (fromSource === "episodes") {
      window.location.hash = "#/episodes";
      return;
    }
    if (fromSource === "studio_create") {
      window.location.hash = "#/create?from=studio";
      return;
    }

    const currentStep = Number.parseInt(
      sessionStorage.getItem("currentStep") || "1",
      10
    );
    const previousStep = Number.isFinite(currentStep)
      ? Math.max(1, currentStep - 1)
      : 1;

    sessionStorage.setItem("forceStep", String(previousStep));
    window.location.hash = "#/create";
  };

  return (
    <div
      className={[
        "min-h-screen bg-cream dark:bg-[#0a0a1a] text-black dark:text-white transition-colors duration-500",
        i18n.language === "ar" ? "text-right" : "text-left",
      ].join(" ")}
    >
      <div
        className={useDashboardGlassTone ? dashboardShellClass : ""}
      >
      <div
        className={useDashboardGlassTone
          ? dashboardContentClass
          : "max-w-[1400px] mx-auto px-4 py-8 space-y-6 sm:px-6 sm:py-10"}
      >
        <div className="max-w-7xl space-y-5">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition"
              aria-label={t("preview.back")}
              title={t("preview.back")}
            >
              <ChevronLeft className={`w-5 h-5 ${i18n.language === "ar" ? "rotate-180" : ""}`} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-black dark:text-white">
                {t("preview.title")}
              </h1>
              <p className="text-sm text-black/60 dark:text-white/60">
                {t("preview.subtitle")}
              </p>
            </div>
          </div>

          <div className="pt-2">
            <div className={previewTitleCardClass}>
              {resolvedCoverSrc ? (
                <div className="flex flex-col sm:min-h-[118px] sm:flex-row">
                  <div className="min-h-[112px] w-full shrink-0 overflow-hidden bg-neutral-100/80 dark:bg-white/10 sm:w-[7.5rem] sm:border-r sm:border-black/10 md:w-32 dark:sm:border-white/10">
                    <img
                      src={resolvedCoverSrc}
                      alt={`${displayTitle} cover`}
                      className="h-full w-full object-cover object-center"
                      onError={() => setCoverImageFailed(true)}
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 items-center bg-[linear-gradient(115deg,rgba(255,255,255,0.97)_0%,rgba(255,255,255,0.95)_48%,rgba(250,246,253,0.92)_76%,rgba(241,234,247,0.74)_100%)] p-6 dark:bg-[linear-gradient(115deg,rgba(23,23,26,0.92)_0%,rgba(23,23,26,0.9)_46%,rgba(40,32,52,0.82)_76%,rgba(72,57,95,0.58)_100%)]">
                    <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-wider text-black/55 dark:text-white/55">
                          {t("preview.titleLabel")}
                        </p>
                        <h2
                          dir={titleDir}
                          className="mt-1.5 max-w-4xl break-words text-xl font-semibold leading-tight text-black dark:text-white"
                        >
                          {displayTitle}
                        </h2>
                      </div>

                      {titleMeta && !category ? (
                        <div className="flex items-center sm:justify-end">
                          <span className="inline-flex max-w-full items-center rounded-full border border-black/5 bg-white/75 px-4 py-2 text-sm text-black/60 dark:border-white/10 dark:bg-white/10 dark:text-white/60">
                            {titleMeta}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[linear-gradient(115deg,rgba(255,255,255,0.97)_0%,rgba(255,255,255,0.95)_48%,rgba(250,246,253,0.92)_76%,rgba(241,234,247,0.74)_100%)] p-6 dark:bg-[linear-gradient(115deg,rgba(23,23,26,0.92)_0%,rgba(23,23,26,0.9)_46%,rgba(40,32,52,0.82)_76%,rgba(72,57,95,0.58)_100%)]">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white/70 dark:border-white/10 dark:bg-purple-900/30">
                      <Mic2 className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-wider text-black/55 dark:text-white/55">
                        {t("preview.titleLabel")}
                      </p>
                      <h2
                        dir={titleDir}
                        className="mt-1.5 max-w-4xl break-words text-xl font-semibold leading-tight text-black dark:text-white"
                      >
                        {displayTitle}
                      </h2>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {saveMessage && (
          <div className="fixed left-4 right-4 top-20 z-50 sm:left-auto sm:right-6">
            <div
              className={[
                "rounded-xl px-4 py-3 shadow-lg border text-sm font-medium",
                saveMessageType === "success"
                  ? "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-100 dark:border-emerald-800/40"
                  : saveMessageType === "error"
                  ? "bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-900/20 dark:text-rose-100 dark:border-rose-800/40"
                  : "bg-white text-black border-black/10 dark:bg-neutral-900 dark:text-white dark:border-white/10",
              ].join(" ")}
            >
              {saveMessage}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-4">
            <div ref={audioCardRef} className="relative -mt-3 w-full">
              <WeCastAudioPlayer
                src={audioUrl}
                title={displayTitle}
                onTimeUpdate={(sec) => setCurrentTime(sec)}
                externalSeek={externalSeek}
              />
            </div>

            {/* Transcript */}
            <div
              ref={transcriptCardRef}
              className={`${previewCardClass} p-5 w-full min-h-[260px]`}
              style={transcriptCardHeight ? { minHeight: transcriptCardHeight } : undefined}
            >
              <div ref={transcriptHeaderRef} className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold">{t("preview.liveTranscript")}</div>
                <div className="text-xs text-black/50 dark:text-white/50">
                  {userInteracting ? t("preview.manualScroll") : t("preview.autoFollow")}
                </div>
              </div>

              <div
                ref={transcriptRef}
                dir={transcriptDir}
                onWheel={markUserInteraction}
                onTouchStart={markUserInteraction}
                onTouchMove={markUserInteraction}
                onMouseDown={markUserInteraction}
                className={[
                  "overflow-y-auto leading-8 text-[15px]",
                  transcriptDir === "rtl" ? "pl-3 text-right" : "pr-3 text-left",
                ].join(" ")}
                style={transcriptBodyHeight ? { height: transcriptBodyHeight } : undefined}
              >
                <div dir={transcriptDir} className="leading-8 text-[15px]">
                  {transcriptTokens.map((tok) => {
                    if (tok.type === "speaker") {
                      return (
                        <React.Fragment key={tok.key}>
                          <br />
                          <button
                            onClick={() => handleWordClick(tok.start)}
                            className={[
                              "font-extrabold text-black/80 dark:text-white/80 hover:underline",
                              transcriptDir === "rtl" ? "ml-2" : "mr-2",
                            ].join(" ")}
                            title={t("preview.jumpToTime", { time: formatMMSS(tok.start) })}
                          >
                            {tok.speaker}:
                          </button>
                        </React.Fragment>
                      );
                    }

                    const w = tok.word;
                    const active = tok.index === activeIndex;

                    return (
                      <span
                        key={tok.key}
                        ref={active ? activeWordRef : null}
                        onClick={() => handleWordClick(w.start)}
                        title={t("preview.jumpToSeconds", { seconds: w.start.toFixed(2) })}
                        className={[
                          "cursor-pointer rounded px-1.5 py-0.5 transition-all duration-150",
                          active
                            ? "bg-yellow-300 text-black"
                            : "hover:bg-black/5 dark:hover:bg-white/10",
                        ].join(" ")}
                      >
                        {w.w}{" "}
                      </span>
                    );
                  })}
                </div>
              </div>

              {!hasSpeakerInfo && words.length > 0 && (
                <p ref={transcriptFooterRef} className="text-xs mt-3 text-black/50 dark:text-white/40">
                  {t("preview.noSpeakers")}
                </p>
              )}
            </div>
          </div>

          {/* Right rail: chapters + summary */}
          <div ref={rightColRef} className="lg:col-span-5 w-full">
            <div className="w-full lg:sticky lg:top-24 lg:-mt-3 space-y-4">
              {/* Chapters card */}
              <div className={`${previewCardClass} overflow-hidden`}>
                <button
                  type="button"
                  onClick={() => {
                    setIsChaptersOpen((v) => {
                      const next = !v;
                      if (next) setIsSummaryOpen(false);
                      return next;
                    });
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold"
                >
                  <span>{t("preview.chapters")}</span>
                  <span className="text-black/50 dark:text-white/50">v</span>
                </button>
                {isChaptersOpen && (
                  <div className="px-5 pb-5 border-t border-black/5 dark:border-white/10">
                    {!chapters || chapters.length === 0 ? (
                      <p className="text-sm text-black/60 dark:text-white/60 italic">
                        {t("preview.noChapters")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {chapters.map((c, idx) => (
                          <button
                            key={idx}
                            onClick={() => setExternalSeek(c.startSec)}
                            className={[
                              "w-full px-3 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition",
                              i18n.language === "ar" ? "text-right" : "text-left",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{c.title}</span>
                              <span className="text-xs text-black/50 dark:text-white/50">
                                {formatMMSS(c.startSec)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Summary card */}
              <div className={`${previewCardClass} overflow-hidden`}>
                <button
                  type="button"
                  onClick={() => {
                    setIsSummaryOpen((v) => {
                      const next = !v;
                      if (next) setIsChaptersOpen(false);
                      return next;
                    });
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold"
                >
                  <span>{t("preview.summary")}</span>
                  <span className="text-black/50 dark:text-white/50">v</span>
                </button>
                {isSummaryOpen && (
                  <div className="px-5 pb-5 text-sm text-black/60 dark:text-white/60 leading-relaxed border-t border-black/5 dark:border-white/10">
                    {isGeneratingSummary ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-gray-500">
                          {t("preview.creatingSummary")}
                        </span>
                      </div>
                    ) : summary ? (
                      <>
                        <p>{summary}</p>
                        <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
                          {summary.split(/\s+/).length} {t("preview.words")}
                        </p>
                      </>
                    ) : (
                      <p className="italic text-gray-500">
                        {t("preview.summaryPending")}
                      </p>
                    )}
                    {isGeneratingSummary && (
                      <div className="mt-2 text-xs text-blue-500 animate-pulse">
                        {t("preview.generatingSummary")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {showPreviewSaveAction ? (
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={isSaving}
              title={t("preview.saveTooltip")}
              className="inline-flex min-w-[10.5rem] items-center justify-center gap-2 rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
            >
              <Save className="h-4 w-4" />
              {isSaving ? t("preview.saving") : t("preview.save")}
            </button>
          </div>
        ) : null}
          {episodeId ? (
            <div className="flex justify-end pt-2">
              <button
                type="button"
          onClick={() => {
            const link = `https://wecast-frontend.onrender.com/#/share/${episodeId}`;
            navigator.clipboard.writeText(link);
            alert("Share link copied!");
          }}
                className="inline-flex items-center justify-center rounded-2xl bg-purple-600 px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Share Podcast
              </button>
            </div>
          ) : null}
      </div>
      </div>
      <SavePreviewAuthModal
        open={showSaveAuthModal}
        title={t("preview.saveAuthTitle")}
        body={t("preview.saveAuthBody")}
        cancelLabel={t("preview.saveAuthCancel")}
        loginLabel={t("preview.saveAuthLogin")}
        signupLabel={t("preview.saveAuthSignup")}
        onClose={() => setShowSaveAuthModal(false)}
        onLogin={() => redirectForSaveAuth("login")}
        onSignup={() => redirectForSaveAuth("signup")}
      />
    </div>
  );
}

function SavePreviewAuthModal({
  open,
  title,
  body,
  cancelLabel,
  loginLabel,
  signupLabel,
  onClose,
  onLogin,
  onSignup,
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-black/10 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-neutral-950">
        <div className="space-y-3">
          <h2 className="text-2xl font-extrabold text-black dark:text-white">{title}</h2>
          <p className="text-sm leading-7 text-black/65 dark:text-white/65">{body}</p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-2xl border border-black/10 px-5 py-3 text-sm font-semibold text-black transition hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex items-center justify-center rounded-2xl border border-black/10 px-5 py-3 text-sm font-semibold text-black transition hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
          >
            {loginLabel}
          </button>
          <button
            type="button"
            onClick={onSignup}
            className="inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-black"
          >
            {signupLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
