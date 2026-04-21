
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Mic2,
    Users,
    NotebookPen,
    ChevronLeft,
    ChevronRight,
    Check,
    Info,
    Wand2,
    AlertCircle,
    Play,
    Edit,
    Pause,
    RotateCcw,
    RotateCw,
    Download,
    Headphones,
    Music2,
    Layers,
    SlidersHorizontal,
    ChevronDown,
} from "lucide-react";
import WeCastAudioPlayer from "./WeCastAudioPlayer";
import Modal from "../components/Modal";
import { exportScriptPdf } from "../utils/exportScriptPdf";
import { exportScriptTxt } from "../utils/exportScriptTxt";
import { shouldAutoplayVoicePreview, shouldShowEditingNotifications } from "../utils/accountPreferences";

const API_BASE = import.meta.env.PROD
    ? "https://wecast.onrender.com"
    : "http://localhost:5000";

const splitList = (value) => {
    if (Array.isArray(value)) {
        return value.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean);
    }
    return [];
};

const TONE_RULES = [
    { tone: "professional", keys: ["professional", "broadcaster", "corporate", "formal", "authoritative", "احترافي", "رسمي"] },
    { tone: "funny", keys: ["funny", "humorous", "comedic", "comic", "quirky", "playful", "مضحك", "كوميدي", "مرح"] },
    { tone: "warm", keys: ["warm", "friendly", "comforting", "cozy", "welcoming", "دافئ", "حنون"] },
    { tone: "calm", keys: ["calm", "relaxed", "soothing", "gentle", "smooth", "هادئ", "مريح"] },
    { tone: "energetic", keys: ["energetic", "dynamic", "lively", "upbeat", "excited", "حيوي", "نشيط"] },
    { tone: "conversational", keys: ["conversational", "natural", "casual", "chatty", "محادثة", "طبيعي"] },
    { tone: "serious", keys: ["serious", "deep", "resonant", "mature", "confident", "جدي", "عميق"] },
    { tone: "educational", keys: ["educational", "educator", "teacher", "instructive", "explainer", "تعليمي"] },
    { tone: "storytelling", keys: ["storytelling", "narration", "narrator", "cinematic", "قصصي", "سرد"] },
];

const getVoiceToneTags = (voice) => {
    const explicit = [
        ...splitList(voice?.tone),
        ...splitList(voice?.labels?.tone),
    ];

    const haystack = [
        String(voice?.name || ""),
        String(voice?.description || ""),
        String(voice?.labels?.description || ""),
    ]
        .join(" ")
        .toLowerCase();

    const inferred = TONE_RULES
        .filter((rule) => rule.keys.some((k) => haystack.includes(k)))
        .map((rule) => rule.tone);

    return Array.from(new Set([...explicit, ...inferred]));
};

const PITCH_VALUES = ["low", "medium", "high"];
const PITCH_RULES = [
    { pitch: "low", keys: ["low", "deep", "resonant", "bass", "baritone", "grave"] },
    { pitch: "high", keys: ["high", "bright", "light", "youthful", "soprano"] },
    { pitch: "medium", keys: ["medium", "balanced", "neutral", "natural"] },
];

const getVoicePitchTag = (voice) => {
    const raw = String(voice?.pitch || voice?.labels?.pitch || "").trim().toLowerCase();
    if (PITCH_VALUES.includes(raw)) return raw;

    const haystack = [
        String(voice?.name || ""),
        String(voice?.description || ""),
        String(voice?.labels?.description || ""),
    ]
        .join(" ")
        .toLowerCase();

    const inferred = PITCH_RULES.find((rule) => rule.keys.some((k) => haystack.includes(k)));
    return inferred?.pitch || "";
};

const STYLE_LIMITS = {
    Interview: [2, 3],
    Storytelling: [1, 2, 3],
    Educational: [1, 2, 3],
    Conversational: [2, 3],
};


/* -------------------- overlay: rotating logo -------------------- */
function LoadingOverlay({ show, logoSrc = "/logo.png", title, subtitle, logoAlt = "WeCast logo" }) {
    if (!show) return null;
    const safeTitle = String(title || "").replace(/[?؟]/g, "");
    return (
        <div
            className="fixed inset-0 z-[9999] grid place-items-center bg-black/70 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
        >
            <div className="w-[min(92vw,480px)] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl p-6">
                <div className="flex items-center gap-4">
                    <img
                        src={logoSrc}
                        alt={logoAlt}
                        className="w-12 h-12 rounded-full animate-[spin_6s_linear_infinite]"
                    />
                    <div>
                        <p className="font-extrabold text-black dark:text-white">
                            {safeTitle}
                        </p>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">
                            {subtitle}
                        </p>
                    </div>
                </div>
                <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div className="h-full w-1/3 animate-[shimmer_1.2s_ease_infinite] bg-gradient-to-r from-pink-400 via-purple-400 to-pink-400" />
                </div>
            </div>
            <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
        </div>
    );
}

/* -------------------- tiny toast -------------------- */
function Toast({ toast, onClose, closeLabel = "Close" }) {
  if (!toast) return null;
  if (!shouldShowEditingNotifications() && toast.type !== "error") return null;

  return (
    <div className="fixed top-4 right-4 z-[9998]">
      <div
        className={`rounded-xl px-4 py-3 shadow-lg border ${
          toast.type === "error"
            ? "bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-900/20 dark:text-rose-100 dark:border-rose-800/40"
            : "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-100 dark:border-emerald-800/40"
        }`}
      >
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5" />
          <div className="text-sm font-medium">{toast.message}</div>

          <button
            type="button"
            onClick={onClose}
            className="ml-3 opacity-60 hover:opacity-90"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}


export default function CreatePro() {
    const { t, i18n } = useTranslation();
    const isRTL = i18n.language === "ar";
    const [step, setStep] = useState(1);
    const [isFromStudioEntry, setIsFromStudioEntry] = useState(() =>
        (window.location.hash || "").includes("from=studio")
    );

    useEffect(() => {
        const onHashChange = () => {
            setIsFromStudioEntry((window.location.hash || "").includes("from=studio"));
        };
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    useEffect(() => {
        sessionStorage.setItem("currentStep", step);
    }, [step]);

    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }, [step]);

    const [generatedAudio, setGeneratedAudio] = useState(null);
    const [generatingAudio, setGeneratingAudio] = useState(false);
    const [generatedScript, setGeneratedScript] = useState(null);
    const [showTitle, setShowTitle] = useState("");
    const [scriptTemplate, setScriptTemplate] = useState("");
    const [episodeTitle, setEpisodeTitle] = useState("");
    const [scriptStyle, setScriptStyle] = useState("");
    const [speakersCount, setSpeakersCount] = useState(0);
    const [speakers, setSpeakers] = useState([]);

// ElevenLabs voices (load once)
const [voices, setVoices] = useState([]);
const [loadingVoices, setLoadingVoices] = useState(true);

// filters per speaker
const [speakerVoiceFilters, setSpeakerVoiceFilters] = useState({});
// { [index]: { open:false, q:"", gender:"", language:"", tone:"", pitch:"" } }
const [speakerVoiceVisibleCounts, setSpeakerVoiceVisibleCounts] = useState({});
const VOICE_PAGE_SIZE = 100;

const getVoiceId = (v) => v?.providerVoiceId || v?.id || v?.docId || "";

// Load ALL voices once
useEffect(() => {
  async function loadVoices() {
    try {
      setLoadingVoices(true);

      const params = new URLSearchParams();
      params.set("provider", "ElevenLabs");
      params.set("limit", "500");

      const url = `${API_BASE}/api/voices?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });

      console.log("GET /api/voices status:", res.status);

      const data = await res.json();
      console.log("GET /api/voices response:", data);

      if (!res.ok) {
        throw new Error(data?.error || `Failed to load voices (${res.status})`);
      }

      const raw =
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data?.voices) ? data.voices :
        Array.isArray(data?.data?.items) ? data.data.items :
        Array.isArray(data?.data?.voices) ? data.data.voices :
        Array.isArray(data) ? data :
        [];

      setVoices(raw);
    } catch (e) {
      console.error("Failed to load voices", e);
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }

  loadVoices();
}, []);

// Ensure each speaker has filters (NOW speakers is defined)
useEffect(() => {
  setSpeakerVoiceFilters((prev) => {
    const next = { ...prev };

    speakers.forEach((_, i) => {
      if (!next[i]) next[i] = { open: false, q: "", gender: "", language: "", tone: "", pitch: "" };
    });

    Object.keys(next).forEach((k) => {
      const idx = Number(k);
      if (idx >= speakers.length) delete next[k];
    });

    return next;
  });
}, [speakers]);

useEffect(() => {
  setSpeakerVoiceVisibleCounts((prev) => {
    const next = { ...prev };
    speakers.forEach((_, i) => {
      if (!next[i]) next[i] = VOICE_PAGE_SIZE;
    });
    Object.keys(next).forEach((k) => {
      const idx = Number(k);
      if (idx >= speakers.length) delete next[k];
    });
    return next;
  });
}, [speakers.length]);

// Group voices by gender (supports backend labels too)
const voiceGroups = useMemo(() => {
  const groups = { male: [], female: [], other: [] };

  voices.forEach((v) => {
    const g = String(v.gender || v.labels?.gender || v.labels?.Gender || "").toLowerCase();
    if (g === "male") groups.male.push(v);
    else if (g === "female") groups.female.push(v);
    else groups.other.push(v);
  });

  return groups;
}, [voices]);

// default voice assignment (returns providerVoiceId)
const defaultVoiceForGender = useCallback((gender = "Male", usedIds = new Set()) => {
  const isFemale = String(gender || "").toLowerCase() === "female";
  const key = isFemale ? "female" : "male";

  const pool = voiceGroups[key].length ? voiceGroups[key] : voices;
  if (!pool.length) return "";

  const unusedInPool = pool.find((v) => {
    const id = getVoiceId(v);
    return id && !usedIds.has(id);
  });
  if (unusedInPool) return getVoiceId(unusedInPool);

  const unusedAny = voices.find((v) => {
    const id = getVoiceId(v);
    return id && !usedIds.has(id);
  });
  if (unusedAny) return getVoiceId(unusedAny);

  return getVoiceId(pool[0]) || getVoiceId(voices[0]) || "";
}, [voiceGroups, voices]);

// Filter voices for a specific speaker (frontend)
const getFilteredVoicesForSpeaker = (speakerIndex) => {
  const f = speakerVoiceFilters[speakerIndex] || { q: "", gender: "", language: "", tone: "", pitch: "" };
  const isNeutralGender = (value) => {
    const g = String(value || "").trim().toLowerCase();
    return g.includes("neutral") || g.includes("netural");
  };
  const speakerGenderRaw = String(speakers?.[speakerIndex]?.gender || "").trim().toLowerCase();
  const speakerGender = isNeutralGender(speakerGenderRaw) ? "" : speakerGenderRaw;
  const selectedGender = String(f.gender || "").trim().toLowerCase();
  const effectiveGender = (selectedGender === "__all__" || isNeutralGender(selectedGender))
    ? ""
    : String(selectedGender || speakerGender || "").trim().toLowerCase();
  const toListLower = (value) => {
    if (Array.isArray(value)) return value.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    if (typeof value === "string") {
      return value
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
    }
    return [];
  };
  const matchFacet = (selected, candidates) => {
    const s = String(selected || "").trim().toLowerCase();
    if (!s) return true;
    return candidates.some((c) => c === s);
  };

  return voices.filter((v) => {
    const name = String(v.name || "").toLowerCase();
    const desc = String(v.description || "").toLowerCase();
    const q = String(f.q || "").trim().toLowerCase();

    const vGender = String(v.gender || v.labels?.gender || "").toLowerCase();
    const vPitch = getVoicePitchTag(v);
    const vTones = getVoiceToneTags(v);
    const vLangs = [...toListLower(v.languages), ...toListLower(v.labels?.languages)];

    if (q && !(name.includes(q) || desc.includes(q))) return false;
    if (effectiveGender && vGender !== effectiveGender) return false;
    if (f.pitch && vPitch !== String(f.pitch).toLowerCase()) return false;
    if (!matchFacet(f.tone, vTones)) return false;
    if (!matchFacet(f.language, vLangs)) return false;

    return true;
  });
};

    const [description, setDescription] = useState("");
    const [errors, setErrors] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [toast, setToast] = useState(null);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [hoverKey, setHoverKey] = useState(null);
    const [guidelineKey, setGuidelineKey] = useState("");
    const [guidelineVisible, setGuidelineVisible] = useState(false);
    const [musicPreview, setMusicPreview] = useState(null);
    const guidelineHideTimerRef = useRef(null);
    const voicePreviewRef = useRef(null);
    const voicePreviewCacheRef = useRef(new Map());
    const [previewLoadingVoiceId, setPreviewLoadingVoiceId] = useState("");
    const [category, setCategory] = useState("");
    const [introMusic, setIntroMusic] = useState("");
    const [bodyMusic, setBodyMusic] = useState("");
    const [outroMusic, setOutroMusic] = useState("");
    const [availableTracks, setAvailableTracks] = useState([]);
    const [showSampleReplaceModal, setShowSampleReplaceModal] = useState(false);
    const [pendingSampleLang, setPendingSampleLang] = useState("en");

    const previewVoice = async (voiceId, voiceName = "") => {
        if (!voiceId) {
            alert(t("create.speakers.selectVoice"));
            return;
        }

        try {
            setPreviewLoadingVoiceId(voiceId);
            if (voicePreviewRef.current) {
                voicePreviewRef.current.pause();
            }

            const cachedUrl = voicePreviewCacheRef.current.get(voiceId);
            if (cachedUrl) {
                const cachedAudio = new Audio(cachedUrl);
                voicePreviewRef.current = cachedAudio;
                await cachedAudio.play();
                setPreviewLoadingVoiceId("");
                return;
            }

            const res = await fetch(`${API_BASE}/api/voices/preview`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`,
                },
                body: JSON.stringify({
                    voiceId,
                    voiceName,
                    text: "This is a WeCast preview.",
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err?.error || "Preview failed");
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            voicePreviewCacheRef.current.set(voiceId, url);
            const audio = new Audio(url);
            voicePreviewRef.current = audio;
            await audio.play();
        } catch (e) {
            console.error(e);
            alert("Preview failed");
        } finally {
            setPreviewLoadingVoiceId("");
        }
    };

    useEffect(() => {
        return () => {
            if (voicePreviewRef.current) {
                voicePreviewRef.current.pause();
                voicePreviewRef.current = null;
            }
            for (const url of voicePreviewCacheRef.current.values()) {
                URL.revokeObjectURL(url);
            }
            voicePreviewCacheRef.current.clear();
        };
    }, []);

    const MUSIC_CATEGORIES = {
        dramatic: [
            { file: "Music dramatic 1.mp3", name: t("create.music.tracks.dramatic1") },
            { file: "Music dramatic 2.mp3", name: t("create.music.tracks.dramatic2") },
            { file: "Music 3 dramatic.mp3", name: t("create.music.tracks.dramatic3") },

        ],
        chill: [
            { file: "Music 1 chill.mp3", name: t("create.music.tracks.chill1") },
            { file: "Music 2 chill.mp3", name: t("create.music.tracks.chill2") },
            { file: "Music 3 chill.mp3", name: t("create.music.tracks.chill3") },

        ],
        classics: [
            { file: "Music classic 1.mp3", name: t("create.music.tracks.classic1") },
            { file: "Music classic 2.mp3", name: t("create.music.tracks.classic2") },
            { file: "Music classic 3.mp3", name: t("create.music.tracks.classic3") },

        ],
        arabic: [
            { file: "Arabic music 1.mp3", name: t("create.music.tracks.arabic1") },
            { file: "Arabic music 2.mp3", name: t("create.music.tracks.arabic2") },
            { file: "Arabic music 3.mp3", name: t("create.music.tracks.arabic3") },

        ],
    };

    const rawDisplayedScript =
        scriptTemplate && showTitle
            ? scriptTemplate.replaceAll("{{SHOW_TITLE}}", showTitle)
            : generatedScript || "";

    const displayedScript = React.useMemo(() => {
        if (!rawDisplayedScript) return "";
        if (i18n.language !== "ar") return rawDisplayedScript;

        return rawDisplayedScript
            .replace(/\bINTRO\b/g, t("create.script.intro"))
            .replace(/\bBODY\b/g, t("create.script.body"))
            .replace(/\bOUTRO\b/g, t("create.script.outro"))
            .replace(/\[music\]/gi, t("create.script.musicTag"));
    }, [rawDisplayedScript, i18n.language, t]);

    // restore title and template when page reloads or user comes back
    useEffect(() => {
        let editData = JSON.parse(sessionStorage.getItem("editData") || "{}");

        if (editData.showTitle) {
            setShowTitle(editData.showTitle);
        }
        if (editData.scriptTemplate) {
            setScriptTemplate(editData.scriptTemplate);
        }
    }, [t]);

    useEffect(() => {
        const draft = JSON.parse(sessionStorage.getItem("studioCreateDraft") || "{}");
        if (!draft || !draft.fromStudioCreate) return;

        if (draft.showTitle) {
            setShowTitle(draft.showTitle);
            setEpisodeTitle(draft.showTitle);
        }
        if (draft.scriptStyle) setScriptStyle(draft.scriptStyle);
        if (draft.speakersCount) setSpeakersCount(Number(draft.speakersCount));
        if (draft.description) setDescription(String(draft.description));

        sessionStorage.removeItem("studioCreateDraft");
    }, []);


    //  ElevenLabs voices

    const MIN = 500;
    const MAX = 2500;
    const countWords = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;
    const isArabicText = (text) => /[\u0600-\u06FF]/.test(String(text || ""));
    const resolveContentLanguage = (text) => (
        isArabicText(text) ? "ar" : (i18n.language === "ar" ? "ar" : "en")
    );

    const EN_SAMPLE_TEXT = `Qiddiya: Saudi Arabia's Emerging Global Capital of Entertainment, Sports, and Culture
Qiddiya stands as one of the boldest and most imaginative components of Saudi Arabia's Vision 2030. Located just 40 kilometers southwest of Riyadh, the project is designed to transform the Kingdom's entertainment and cultural landscape, offering world-class experiences that appeal to residents, tourists, and global enthusiasts alike. Stretching across more than 360 square kilometers, Qiddiya is not simply a recreational zone. It is an entire city built around the idea that entertainment, creativity, and human connection can reshape how people live, learn, and spend their time.
From its inception, Qiddiya was envisioned as a place where people can break away from routine and immerse themselves in new experiences. The city's master plan blends natural landscapes with cutting-edge architecture, creating environments that support adventure, performance, learning, and relaxation. Its massive scope makes it one of the largest entertainment developments in the world, and it aims to position Saudi Arabia as a major global destination in this sector.
One of Qiddiya's most anticipated attractions is its flagship theme park district, which will feature thrill rides, family activities, and landmark amusement experiences. Among these attractions is Falcon's Flight, expected to be the world's fastest, tallest, and longest roller coaster. This ride alone has already drawn worldwide attention, signaling Qiddiya's intention to push boundaries and set new records. Alongside the theme parks, the city will host a state-of-the-art water park, outdoor adventure zones, and immersive digital entertainment centers that reflect the growing demand for interactive experiences.
Qiddiya is equally committed to developing sports. The project includes facilities for football, basketball, swimming, climbing, and extreme sports, as well as a motorsport complex capable of holding major international events. The motorsport zone will include tracks designed for speed, precision, and professional competitions, helping create new opportunities for athletes, teams, and spectators. By investing in these areas, Qiddiya aims to nurture local talent and promote a more active, engaged lifestyle for the Saudi population.
Culture and arts form another core pillar of the project. Qiddiya will feature performance theaters, museums, creative studios, and festival venues that support both Saudi and international art forms. These spaces will offer opportunities for learning, innovation, and artistic exchange, encouraging young creators to explore their talents and share their stories. With a focus on education and creative development, Qiddiya aims to inspire the next generation of Saudi artists, designers, and performers.
Economically, the impact of Qiddiya is expected to be significant. The project will generate thousands of jobs across a wide range of fields, from technology and engineering to hospitality, design, and operations. Its location near Riyadh positions it to attract millions of visitors each year, contributing to the growth of both domestic and international tourism. As the Kingdom continues diversifying its economy, Qiddiya will play a key role in helping build a sustainable entertainment sector that supports long-term growth.
In terms of lifestyle, Qiddiya's residential areas will integrate seamlessly with its recreational spaces. Housing, retail centers, hotels, green parks, and community facilities will form a vibrant environment where people can live close to entertainment, culture, and nature. This approach reflects a modern vision of city planning that prioritizes convenience, quality of life, and social connection.
Qiddiya represents a powerful statement about the future Saudi Arabia is building. It is more than a destination. It is a symbol of innovation, ambition, and cultural transformation. As it continues to develop, the city promises not only unforgettable experiences, but also new opportunities for learning, creativity, and community. By blending entertainment with education, nature with technology, and global trends with local identity, Qiddiya is set to redefine what a modern entertainment city can be.`;

    const AR_SAMPLE_TEXT = `القدية: عاصمة سعودية صاعدة للترفيه والرياضة والثقافة
تُعد القدية واحدة من أكثر مشاريع رؤية السعودية 2030 طموحًا وابتكارًا. تقع على بُعد نحو 40 كيلومترًا جنوب غرب الرياض، وقد صُممت لإحداث نقلة نوعية في مشهد الترفيه والثقافة داخل المملكة، من خلال تقديم تجارب عالمية المستوى تستهدف السكان والزوار والمهتمين من مختلف أنحاء العالم. وتمتد القدية على مساحة تتجاوز 360 كيلومترًا مربعًا، وهي ليست مجرد منطقة ترفيهية، بل مدينة متكاملة تقوم على فكرة أن الترفيه والإبداع والتواصل الإنساني يمكن أن يعيدوا تشكيل طريقة عيش الناس وتعلمهم وقضاء أوقاتهم.
منذ انطلاق فكرتها، تم تصور القدية كمكان يبتعد فيه الناس عن الروتين وينغمسون في تجارب جديدة. وتمزج الخطة الرئيسية للمدينة بين الطبيعة والهندسة المعمارية الحديثة، لتوفير بيئات تدعم المغامرة والعروض الفنية والتعلم والاسترخاء. ويجعلها حجمها الضخم واحدة من أكبر وجهات الترفيه قيد التطوير في العالم، كما تهدف إلى ترسيخ مكانة السعودية كوجهة عالمية رئيسية في هذا القطاع.
ومن أبرز معالم القدية المرتقبة منطقة المدن الترفيهية الكبرى، التي ستضم ألعابًا حماسية وأنشطة عائلية وتجارب ترفيهية فريدة. ومن بين هذه المعالم لعبة فالكونز فلايت، المتوقع أن تكون الأسرع والأطول والأعلى في العالم. وقد لاقت هذه اللعبة اهتمامًا عالميًا واسعًا، ما يعكس رغبة القدية في تجاوز الحدود التقليدية وصناعة أرقام قياسية جديدة. وإلى جانب المدن الترفيهية، ستضم المدينة حديقة مائية متطورة، ومناطق مغامرات خارجية، ومراكز ترفيه رقمي تفاعلي تواكب الطلب المتزايد على التجارب الحديثة.
كما تولي القدية اهتمامًا كبيرًا بالرياضة، إذ تشمل مرافق لكرة القدم وكرة السلة والسباحة والتسلق والرياضات المتطرفة، إضافة إلى مجمع رياضي للمحركات قادر على استضافة بطولات دولية كبرى. وسيضم هذا المجمع حلبات مصممة للسرعة والدقة والمنافسات الاحترافية، بما يفتح آفاقًا جديدة للرياضيين والفرق والجماهير. ومن خلال هذه الاستثمارات، تسعى القدية إلى تنمية المواهب المحلية وتعزيز نمط حياة أكثر نشاطًا وحيوية في المجتمع السعودي.
وتُعد الثقافة والفنون ركيزة أساسية أخرى في المشروع. إذ ستحتضن القدية مسارح للعروض ومتاحف واستوديوهات إبداعية ومواقع للمهرجانات تدعم الفنون السعودية والعالمية. وستوفر هذه المساحات فرصًا للتعلم والابتكار والتبادل الفني، بما يشجع الجيل الجديد على اكتشاف مواهبه والتعبير عن قصصه. ومع التركيز على التعليم والتطوير الإبداعي، تهدف القدية إلى إلهام جيل جديد من الفنانين والمصممين والمبدعين في المملكة.
اقتصاديًا، من المتوقع أن يكون أثر القدية كبيرًا، حيث ستوفر آلاف الوظائف في مجالات متنوعة مثل التقنية والهندسة والضيافة والتصميم والتشغيل. كما أن قربها من الرياض يجعلها مؤهلة لاستقطاب ملايين الزوار سنويًا، بما يدعم نمو السياحة المحلية والدولية. ومع استمرار المملكة في تنويع اقتصادها، ستلعب القدية دورًا محوريًا في بناء قطاع ترفيهي مستدام يدعم النمو طويل الأجل.
وعلى مستوى نمط الحياة، ستتكامل المناطق السكنية في القدية مع مساحات الترفيه بسلاسة. فالمنازل ومراكز التسوق والفنادق والحدائق والمرافق المجتمعية ستشكّل بيئة نابضة بالحياة يعيش فيها الناس بالقرب من الثقافة والطبيعة والأنشطة المتنوعة. ويعكس هذا التوجه رؤية حديثة للتخطيط الحضري تركز على الراحة وجودة الحياة وتعزيز الروابط الاجتماعية.
تمثل القدية رسالة قوية عن المستقبل الذي تبنيه السعودية. فهي ليست مجرد وجهة، بل رمز للابتكار والطموح والتحول الثقافي. ومع استمرار تطورها، تعد المدينة بتقديم تجارب لا تُنسى وفرص جديدة للتعلم والإبداع وبناء المجتمع. ومن خلال المزج بين الترفيه والتعليم، والطبيعة والتقنية، والاتجاهات العالمية والهوية المحلية، تستعد القدية لإعادة تعريف مفهوم مدينة الترفيه الحديثة.`;

    const ensureMinWords = (baseText) => {
        const chunks = [];
        while (countWords(chunks.join("\n\n")) < MIN) {
            chunks.push(baseText);
        }
        return chunks.join("\n\n");
    };

    const buildSampleText = (lang = "en") => {
        const base = lang === "ar" ? AR_SAMPLE_TEXT : EN_SAMPLE_TEXT;
        return ensureMinWords(base);
    };

    const applySampleText = (lang = "en") => {
        setDescription(buildSampleText(lang));
        setErrors((prev) => ({ ...prev, description: "", server: "" }));
    };

    const handleUseSampleText = (lang = "en") => {
        if (description.trim()) {
            setPendingSampleLang(lang);
            setShowSampleReplaceModal(true);
            return;
        }
        applySampleText(lang);
    };

    useEffect(() => {
        const handleNavigation = () => {
            const urlParams = new URLSearchParams(window.location.search);
            const stepParam = urlParams.get("step");
            const forceStep = sessionStorage.getItem("forceStep");
            const editData = JSON.parse(sessionStorage.getItem("editData") || "{}");
            const saved = sessionStorage.getItem("currentStep");

            if (editData.fromEdit && (editData.generatedScript || editData.scriptTemplate)) {
                const template =
                    editData.scriptTemplate || editData.generatedScript || "";

                const titleFromStorage =
                    (editData.showTitle || "").trim() ||
                    (editData.episodeTitle || "").trim() ||
                    t("create.defaults.podcastShow");


                const rendered = template.includes("{{SHOW_TITLE}}")
                    ? template.replaceAll("{{SHOW_TITLE}}", titleFromStorage)
                    : template;

                setGeneratedScript(rendered);
                setScriptTemplate(template);
                setShowTitle(titleFromStorage);
                setEpisodeTitle(titleFromStorage);

                setScriptStyle(editData.scriptStyle || "");
                setSpeakersCount(editData.speakersCount || 0);
                setSpeakers(editData.speakers || []);
                setDescription(editData.description || "");

                setStep(4);

                sessionStorage.removeItem("forceStep");
                const cleanEditData = { ...editData };
                delete cleanEditData.fromEdit;
                sessionStorage.setItem("editData", JSON.stringify(cleanEditData));
                return;
            }


            if (forceStep) {
                const nextStep = Number.parseInt(forceStep, 10);
                setStep(Number.isFinite(nextStep) && nextStep > 0 ? nextStep : 1);
                sessionStorage.removeItem("forceStep");
                return;
            }

            if (stepParam) {
                const nextStep = Number.parseInt(stepParam, 10);
                setStep(Number.isFinite(nextStep) && nextStep > 0 ? nextStep : 1);
                return;
            }

            if (saved) {
                const nextStep = Number.parseInt(saved, 10);
                setStep(Number.isFinite(nextStep) && nextStep > 0 ? nextStep : 1);
            }
        };

        handleNavigation();
    }, [t]);


    useEffect(() => {
        const handleHashChange = () => {
            const hash = window.location.hash;
            const editData = JSON.parse(sessionStorage.getItem('editData') || '{}');

            if (hash === '#/edit' && generatedScript) {
                setStep(4);
            } else if (hash === '#/create') {
                if (editData.fromEdit && editData.generatedScript) {
                    setGeneratedScript(editData.generatedScript);
                    setScriptStyle(editData.scriptStyle || "");
                    setSpeakersCount(editData.speakersCount || 0);
                    setSpeakers(editData.speakers || []);
                    setDescription(editData.description || "");

                    let titleFromStorage =
                        (editData.showTitle || "").trim() ||
                        (editData.episodeTitle || "").trim();

                    if (!titleFromStorage) {
                        titleFromStorage = t("create.defaults.podcastShow");
                    }


                    if (editData.scriptTemplate) {
                        setScriptTemplate(editData.scriptTemplate);
                    }
                    if (titleFromStorage) {
                        setShowTitle(titleFromStorage);
                        setEpisodeTitle(titleFromStorage);
                    }

                    setStep(4);
                    const cleanEditData = { ...editData };
                    delete cleanEditData.fromEdit;
                    sessionStorage.setItem('editData', JSON.stringify(cleanEditData));
                } else if (generatedScript) {
                    setStep(4);
                }
            }
        };

        window.addEventListener('hashchange', handleHashChange);
        handleHashChange();

        return () => window.removeEventListener('hashchange', handleHashChange);
    }, [generatedScript, t]);



    /* ---------- rules ---------- */
    const STYLE_GUIDELINES = {
        Interview: {
            tone: t("create.guidelines.interview.tone"),
            flow: t("create.guidelines.interview.flow"),
            goal: t("create.guidelines.interview.goal"),
        },
        Storytelling: {
            tone: t("create.guidelines.storytelling.tone"),
            flow: t("create.guidelines.storytelling.flow"),
            goal: t("create.guidelines.storytelling.goal"),
        },
        Educational: {
            tone: t("create.guidelines.educational.tone"),
            flow: t("create.guidelines.educational.flow"),
            goal: t("create.guidelines.educational.goal"),
        },
        Conversational: {
            tone: t("create.guidelines.conversational.tone"),
            flow: t("create.guidelines.conversational.flow"),
            goal: t("create.guidelines.conversational.goal"),
        },
    };

    const styleCards = [
        {
            key: "Interview",
            title: t("create.styles.interview.title"),
            caption: t("create.styles.interview.caption"),
            bullets: [
                t("create.styles.interview.bullets.hosts"),
                t("create.styles.interview.bullets.guests"),
                t("create.styles.interview.bullets.pacing"),
            ],
            valid: t("create.styles.interview.valid"),
        },
        {
            key: "Storytelling",
            title: t("create.styles.storytelling.title"),
            caption: t("create.styles.storytelling.caption"),
            bullets: [
                t("create.styles.storytelling.bullets.hosts"),
                t("create.styles.storytelling.bullets.guests"),
                t("create.styles.storytelling.bullets.pacing"),
            ],
            valid: t("create.styles.storytelling.valid"),
        },
        {
            key: "Educational",
            title: t("create.styles.educational.title"),
            caption: t("create.styles.educational.caption"),
            bullets: [
                t("create.styles.educational.bullets.hosts"),
                t("create.styles.educational.bullets.guests"),
                t("create.styles.educational.bullets.pacing"),
            ],
            valid: t("create.styles.educational.valid"),
        },
        {
            key: "Conversational",
            title: t("create.styles.conversational.title"),
            caption: t("create.styles.conversational.caption"),
            bullets: [
                t("create.styles.conversational.bullets.hosts"),
                t("create.styles.conversational.bullets.guests"),
                t("create.styles.conversational.bullets.pacing"),
            ],
            valid: t("create.styles.conversational.valid"),
        },
    ];

    const defaultCount = (style) =>
        style === "Interview" ? 2 : style === "Conversational" ? 2 : 1;

    const styleLabelMap = useMemo(() => ({
        Interview: t("create.styles.interview.title"),
        Storytelling: t("create.styles.storytelling.title"),
        Educational: t("create.styles.educational.title"),
        Conversational: t("create.styles.conversational.title"),
    }), [t]);

    const activeGuidelineTarget = hoverKey || "";

    useEffect(() => {
        if (guidelineHideTimerRef.current) {
            clearTimeout(guidelineHideTimerRef.current);
            guidelineHideTimerRef.current = null;
        }

        if (activeGuidelineTarget) {
            setGuidelineKey(activeGuidelineTarget);
            const raf = requestAnimationFrame(() => setGuidelineVisible(true));
            return () => cancelAnimationFrame(raf);
        }

        setGuidelineVisible(false);
        guidelineHideTimerRef.current = setTimeout(() => {
            setGuidelineKey("");
            guidelineHideTimerRef.current = null;
        }, 220);

        return () => {
            if (guidelineHideTimerRef.current) {
                clearTimeout(guidelineHideTimerRef.current);
                guidelineHideTimerRef.current = null;
            }
        };
    }, [activeGuidelineTarget]);

    useEffect(() => () => {
        if (guidelineHideTimerRef.current) {
            clearTimeout(guidelineHideTimerRef.current);
            guidelineHideTimerRef.current = null;
        }
    }, []);

    const roleLabelFor = (role) => {
        if (role === "host") return t("create.roles.host");
        if (role === "guest") return t("create.roles.guest");
        if (role === "cohost") return t("create.roles.cohost");
        if (role === "narrator") return t("create.roles.narrator");
        return t("create.roles.speaker");
    };




    useEffect(() => {
        if (!scriptStyle) return;

        setSpeakers((prev) => {
            const limits = STYLE_LIMITS[scriptStyle] || [];

            let count = prev.length || Number(speakersCount) || 0;

            if (!count || !limits.includes(count)) {
                count = defaultCount(scriptStyle);
                setSpeakersCount(count);
            }

            const next = Array.from({ length: count }).map((_, i) => {
                const old = prev[i] || {};
                const gender = old.gender || (i === 0 ? "Male" : "Female");

                return {
                    name: old.name || "",
                    gender,
                    role: old.role || "host",
                    voiceId: old.voiceId || "",
                    filterPreset: old.filterPreset || "all",
                };
            });

            if (scriptStyle === "Interview") {
                if (count === 2) {
                    next[0].role = "host";
                    next[1].role = "guest";
                } else {
                    next[0].role = "host";
                    next[1].role = "host";
                    next[2].role = "guest";
                }
            } else if (scriptStyle === "Conversational") {
                next.forEach((s) => {
                    s.role = "host";
                });
            } else if (scriptStyle === "Educational" || scriptStyle === "Storytelling") {
                if (count === 1) {
                    next[0].role = "host";
                } else if (count === 2) {
                    next[0].role = "host";
                    next[1].role = "guest";
                } else if (count === 3) {
                    next[0].role = "host";
                    next[1].role = "guest";
                    next[2].role = "guest";
                }
            }
            // other styles: keep roles as they are

            return next;
        });

        setErrors({});
    }, [scriptStyle, speakersCount]);



    useEffect(() => {
        if (loadingVoices || !voices.length || !speakers.length) return;

        setSpeakers((prev) => {
            const usedIds = new Set(
                prev.map((s) => s.voiceId).filter(Boolean)
            );

            const next = prev.map((s) => {
                if (s.voiceId) return s;

                const voiceId = defaultVoiceForGender(s.gender, usedIds);
                if (voiceId) usedIds.add(voiceId);

                return { ...s, voiceId };
            });

            return next;
        });
    }, [loadingVoices, voices.length, speakers.length, defaultVoiceForGender]);


    useEffect(() => {
        if (!scriptStyle || !speakersCount) return;
        const count = Number(speakersCount);
        const limits = STYLE_LIMITS[scriptStyle] || [];
        if (!limits.includes(count)) return;

        setSpeakers((prev) => {
            const next = Array.from({ length: count }).map((_, i) => {
                const old = prev[i] || {};
                const gender = old.gender || "Male";
                return {
                    name: old.name || "",
                    gender,
                    role: old.role || "host",
                    voiceId: old.voiceId || "",
                    filterPreset: old.filterPreset || "all",
                };
            });

            if (scriptStyle === "Interview") {
                if (count === 2) {
                    next[0].role = "host";
                    next[1].role = "guest";
                } else {
                    next[0].role = "host";
                    next[1].role = "host";
                    next[2].role = "guest";
                }
            } else if (scriptStyle === "Conversational") {
                next.forEach((s) => (s.role = "host"));
            } else if (scriptStyle === "Educational" || scriptStyle === "Storytelling") {
                if (count === 1) next[0].role = "host";
                else if (count === 2) {
                    next[0].role = "host";
                    next[1].role = "guest";
                } else if (count === 3) {
                    next[0].role = "host";
                    next[1].role = "guest";
                    next[2].role = "guest";
                }
            } else {
                if (count === 1) next[0].role = "host";
                if (count === 2) {
                    next[0].role = "host";
                    next[1].role = "guest";
                }
                if (count === 3) {
                    next[0].role = "host";
                    next[1].role = "guest";
                    next[2].role = "guest";
                }
            }
            return next;
        });
    }, [speakersCount, scriptStyle, voices.length]);

    /* ---------- helpers ---------- */
    const allowedCounts = useMemo(() => STYLE_LIMITS[scriptStyle] || [], [scriptStyle]);
    const anyEmptySpeakerName = speakers.some((s) => !String(s.name || "").trim());

    const normalizeName = (s = "") =>
        s.trim().toLowerCase().replace(/\s+/g, " ");

    // Duplicate names:
    const hasDuplicateNames = useMemo(() => {
        const names = speakers
            .map((s) => normalizeName(s.name))
            .filter(Boolean); // ignore empty
        return new Set(names).size !== names.length;
    }, [speakers]);

    const continueFromStyle = () => {
        if (!scriptStyle) {
            setErrors({ script_style: t("create.errors.chooseStyle") });
            setToast({ type: "error", message: t("create.toasts.chooseStyle") });
            setTimeout(() => setToast(null), 2600);
            return;
        }
        setErrors({});
        setStep(2);
        setToast({ type: "success", message: t("create.toasts.styleSelected") });
        setTimeout(() => setToast(null), 2400);
    };

    const onContinueFromSpeakers = () => {
        const errs = {};
        if (!scriptStyle) errs.script_style = t("create.errors.chooseStyle");
        if (!allowedCounts.includes(Number(speakersCount))) {
            errs.speakers = t("create.errors.invalidSpeakersCount");
        }
        if (anyEmptySpeakerName) {
            errs.speaker_names = t("create.errors.missingSpeakerNames");
        } else if (hasDuplicateNames) {
            errs.speaker_names = t("create.errors.duplicateSpeakerNames");
        }

        setErrors(errs);
        if (Object.keys(errs).length === 0) {
            setStep(3);
            setToast({ type: "success", message: t("create.toasts.speakersSet") });
            setTimeout(() => setToast(null), 2400);
        } else {
            setToast({ type: "error", message: Object.values(errs)[0] });
            setTimeout(() => setToast(null), 2800);
        }
    };

    const handleGenerate = async () => {
        const words = description.trim().split(/\s+/).filter(Boolean).length;
        const requestedLanguage = resolveContentLanguage(description);
        if (words < MIN) {
            setErrors({ description: t("create.errors.minWords", { min: MIN }) });
            return;
        }
        if (words > MAX) {
            setErrors({ description: t("create.errors.maxWords", { max: MAX }) });
            return;
        }

        setSubmitting(true);
        setErrors({});

        try {
            const res = await fetch(`${API_BASE}/api/generate`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    script_style: scriptStyle,
                    speakers: Number(speakersCount),
                    speakers_info: speakers,
                    description,
                    language: requestedLanguage,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.script) {
        setErrors({ server: data.error || t("create.errors.generationFailed") });
                setSubmitting(false);
                return;
            }
            const podcastId = data.podcastId;
            const template = data.script;

            const backendTitle =
                data.show_title || data.title || t("create.defaults.podcastEpisode");

            setScriptTemplate(template);
            setShowTitle(backendTitle);
            setEpisodeTitle(backendTitle);

            const rendered = template.replaceAll("{{SHOW_TITLE}}", backendTitle);
            setGeneratedScript(rendered);


            const editData = {
                podcastId,
                scriptStyle,
                speakersCount,
                speakers,
                description,
                scriptTemplate: template,
                showTitle: backendTitle,
                episodeTitle: backendTitle,
                generatedScript: rendered,
                language: requestedLanguage,
            };
            sessionStorage.setItem("editData", JSON.stringify(editData));
            sessionStorage.removeItem("guestEditDraft");


            setToast({
                type: "success",
                message: t("create.toasts.scriptGenerated"),
            });
            setTimeout(() => setToast(null), 2400);
            setStep(4);
        } catch {
            setErrors({ server: t("create.errors.generationFailedBackend") });
        } finally {
            setSubmitting(false);
        }
    };

    const handleGenerateAudio = async () => {
        if (!generatedScript) {
            setToast({ type: "error", message: t("create.toasts.generateFirst") });
            setTimeout(() => setToast(null), 2800);
            return;
        }

        // 🔽 ADD THIS BLOCK HERE
        let editData = JSON.parse(sessionStorage.getItem("editData") || "{}");
        let podcastId = editData.podcastId;
        const scriptLanguage = editData.language || resolveContentLanguage(generatedScript || description);

        if (!podcastId) {
            try {
                const draftRes = await fetch(`${API_BASE}/api/draft`, {
                    credentials: "include",
                });
                if (draftRes.ok) {
                    const draft = await draftRes.json();
                    if (draft && draft.podcastId) {
                        podcastId = draft.podcastId;
                        editData = { ...editData, podcastId };
                        sessionStorage.setItem("editData", JSON.stringify(editData));
                    }
                }
            } catch {
                // ignore and fall back to error toast
            }
        }

        if (!podcastId) {
            setToast({
            type: "error",
            message: t("create.errors.missingPodcastId"),
            });
            setTimeout(() => setToast(null), 2800);
            return; // ❗ stop BEFORE audio generation
        }
        // 🔼 END ADDITION

        setGeneratingAudio(true);
        setGeneratedAudio(null);

        try {
            const response = await fetch(`${API_BASE}/api/audio`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                scriptText: generatedScript,
                podcastId,          // ✅ IMPORTANT
                script_style: scriptStyle,
                speakers_info: speakers,
                language: scriptLanguage,
            }),
            });

            const data = await response.json();

            if (!response.ok || !data.url) {
            throw new Error(data.error || t("create.errors.audioGenerationFailed"));
            }

            const baseAudioUrl = data.url.startsWith("http")
            ? data.url
            : `${API_BASE}${data.url}`;

            const previewPayload = {
            url: baseAudioUrl,
            audioKey: data.audioKey || "",
            words: data.words || [],
            title: audioTitle,
            language: scriptLanguage,
            category,
            };
            sessionStorage.setItem("wecast_preview", JSON.stringify(previewPayload));

            setGeneratedAudio(baseAudioUrl);

            setToast({
            type: "success",
            message: t("create.toasts.audioGenerated"),
            });
            setTimeout(() => setToast(null), 2400);

        } catch (error) {
            console.error("Audio generation error:", error);
            setToast({
            type: "error",
            message: t("create.errors.audioGenerationFailedRetry"),
            });
            setTimeout(() => setToast(null), 2800);
        } finally {
            setGeneratingAudio(false);
        }
        };


    const navigateToEdit = () => {
        if (!generatedScript) {
            setToast({
                type: "error",
                message: t("create.toasts.generateFirstToEdit"),
            });
            setTimeout(() => setToast(null), 2800);
            return;
        }

        const editData = {
            scriptStyle,
            speakersCount,
            speakers,
            generatedScript,
            description,
            scriptTemplate,
            showTitle,
            episodeTitle: showTitle,
        };

        sessionStorage.setItem("editData", JSON.stringify(editData));
        window.location.hash = "#/edit";
    };

    const navigateToFinalize = () => {
        const editData = JSON.parse(sessionStorage.getItem("editData") || "{}");
        const podcastId = editData.podcastId;

        if (!podcastId) {
            setToast({
                type: "error",
                message: t("create.errors.missingPodcastId"),
            });
            setTimeout(() => setToast(null), 2800);
            return;
        }

        window.location.hash = `#/finalize?podcastId=${encodeURIComponent(podcastId)}`;
    };

// Add this function before the return statement
const exportScript = async (format = "pdf") => {
  try {
    if (!generatedScript) {
      setToast({ type: "error", message: "No script content to export!" });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    const exportHandler = format === "txt" ? exportScriptTxt : exportScriptPdf;

    await exportHandler({
      scriptContent: generatedScript,
      title: showTitle || "Podcast Script",
      scriptStyle,
      fileNameBase: showTitle || "podcast_script",
    });
    
    setToast({ type: "success", message: `Script exported as ${format.toUpperCase()} successfully!` });
    setTimeout(() => setToast(null), 3000);
    
  } catch (error) {
    console.error("Error exporting script:", error);
    setToast({ type: "error", message: "Failed to export script. Please try again." });
    setTimeout(() => setToast(null), 3000);
  }
};
    /* ---------- stepper ---------- */
    const stepTitles = {
        1: t("create.step1.title"),
        2: t("create.step2.title"),
        3: t("create.step3.title"),
        4: t("create.step4.title"),
        5: t("create.step5.title"),
        6: t("create.step6.title"),
    };

    const stepDescriptions = {
        1: t("create.step1.desc"),
        2: t("create.step2.desc"),
        3: t("create.step3.desc"),
        4: t("create.step4.desc"),
        5: t("create.step5.desc"),
        6: t("create.step6.desc"),
    };

    const stepperLabels = [
        t("create.stepper.chooseStyle"),
        t("create.stepper.addSpeakers"),
        t("create.stepper.writeContent"),
        t("create.stepper.reviewEdit"),
        t("create.stepper.selectMusic"),
        t("create.stepper.generateAudio"),
        "Finalize & Publish",
    ];
    const StepDot = ({ n, label }) => {
        const state = step === n ? "active" : step > n ? "done" : "pending";
        const dot = state === "active" ? "bg-purple-600 text-white shadow" :
            state === "done" ? "bg-neutral-300 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200" :
                "bg-black/10 dark:bg-white/10 text-black/70 dark:text-white/70";
        const labelCls = state === "active" ? "text-purple-600" :
            state === "done" ? "text-neutral-500 dark:text-neutral-400" :
                "text-black/60 dark:text-white/60";
        return (
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <div className={`w-8 h-8 rounded-full grid place-items-center text-sm font-bold ${dot}`}>
                    {n}
                </div>
                <div className={`hidden text-sm font-semibold sm:block ${labelCls}`}>{label}</div>
            </div>
        );
    };

    const StepLine = ({ on }) => (
        <div className={`h-[3px] flex-1 rounded-full ${on ? "bg-gradient-to-r from-purple-600 to-pink-500" : "bg-black/10 dark:bg-white/10"}`} />
    );

    const roleCounts = useMemo(() => {
        const counts = {};
        speakers.forEach((s) => {
            const r = s.role || "Speaker";
            counts[r] = (counts[r] || 0) + 1;
        });
        return counts;
    }, [speakers]);

    const roleUsage = {};

    const audioTitle = React.useMemo(
        () =>
            (showTitle && showTitle.trim()) ||
            (episodeTitle && episodeTitle.trim()) ||
            (scriptStyle
                ? t("create.audioTitleWithStyle", {
                      style: styleLabelMap[scriptStyle] || scriptStyle,
                      count: speakersCount,
                  })
                : t("create.defaults.podcastEpisode")),
        [showTitle, episodeTitle, scriptStyle, speakersCount, styleLabelMap, t]
    );
    const studioGlassPanelClass = "border border-black/10 bg-white/45 backdrop-blur-sm shadow-[0_10px_30px_rgba(0,0,0,0.08)]";
    const studioTopPanelClass = "border border-black/10 bg-white/70 backdrop-blur-sm shadow-[0_10px_30px_rgba(0,0,0,0.08)]";
    const studioCardClass = isFromStudioEntry ? `ui-card ${studioGlassPanelClass}` : "ui-card";



    return (
        <div className={`min-h-screen ${isFromStudioEntry ? "bg-cream dark:bg-[#0a0a1a]" : "bg-cream dark:bg-[#0a0a0a]"}`}>
            {!isFromStudioEntry && <div className="h-2 bg-purple-gradient" />}
            <main className={`w-full ${isFromStudioEntry ? "max-w-full border-b border-black/10 bg-white/70 dark:bg-neutral-900/45 shadow-[0_10px_30px_rgba(0,0,0,0.08)] backdrop-blur-sm" : "mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10"}`}>
                <div className={isFromStudioEntry ? "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 bg-white/35 dark:bg-neutral-900/20" : ""}>
                {/* Title */}
                {isFromStudioEntry ? (
                    <header className="-mx-4 sm:-mx-6 lg:-mx-8 mb-6 bg-white/75 dark:bg-neutral-900/45 border-b border-black/10 dark:border-white/10 backdrop-blur-sm">
                        <div className="px-4 sm:px-6 lg:px-8 py-4">
                            <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                            <button
                                type="button"
                                onClick={() => { window.location.hash = "#/episodes"; }}
                                className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg"
                                aria-label="Back to Cast Studio"
                                title="Back to Cast Studio"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <div>
                                <h1 className="text-xl font-bold text-black sm:text-2xl dark:text-white">Create New Episode</h1>
                                <p className="mt-1 text-sm text-black/60 dark:text-white/60">{stepTitles[step]} - {stepDescriptions[step]}</p>
                            </div>
                        </div>
                            </div>
                    </header>
                ) : (
                    <header className="mb-6 text-center">
                        <h1 className="text-3xl md:text-4xl font-extrabold text-black dark:text-white">
                            {stepTitles[step]}
                        </h1>

                        <p className="mt-2 text-black/70 dark:text-white/70">
                            {stepDescriptions[step]}
                        </p>
                    </header>
                )}



                {/* Stepper */}
                {step > 0 && (
                    <div className={`w-full max-w-[1400px] mx-auto rounded-2xl border p-3 sm:p-4 mb-8 overflow-x-auto ${
                        isFromStudioEntry
                            ? `${studioTopPanelClass} dark:bg-neutral-900/45 dark:border-white/10`
                            : "bg-white/60 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800"
                    }`}>
                        <div className="flex min-w-max items-center gap-2">
                            <StepDot n={1} label={stepperLabels[0]} />
                            <StepLine on={step > 1} />

                            <StepDot n={2} label={stepperLabels[1]} />
                            <StepLine on={step > 2} />

                            <StepDot n={3} label={stepperLabels[2]} />
                            <StepLine on={step > 3} />

                            <StepDot n={4} label={stepperLabels[3]} />
                            <StepLine on={step > 4} />

                            <StepDot n={5} label={stepperLabels[4]} />
                            <StepLine on={step > 5} />

                            <StepDot n={6} label={stepperLabels[5]} />
                            <StepLine on={false} />
                            <StepDot n={7} label={stepperLabels[6]} />
                        </div>
                    </div>
                )}




                <div className="max-w-5xl mx-auto">
                    {/* STEP 1: STYLE */}
                    {step === 1 && (
                        <section className={studioCardClass}>
                            <h2 className="ui-card-title flex items-center gap-2 justify-center">
                                <Mic2 className="w-4 h-4" /> {t("create.sections.podcastStyle")}
                            </h2>
                            <div className="mt-4 grid grid-cols-1 gap-4 justify-items-center sm:grid-cols-2">
                                {styleCards.map((s) => {
                                    const guideline = STYLE_GUIDELINES[s.key];
                                    const isGuidelineMounted = guidelineKey === s.key;
                                    const isGuidelineShown = isGuidelineMounted && guidelineVisible;

                                    return (
                                        <label
                                            key={s.key}
                                            onClick={() => setScriptStyle(s.key)}
                                            onMouseEnter={() => setHoverKey(s.key)}
                                            onMouseLeave={() => setHoverKey((k) => (k === s.key ? null : k))}
                                            onFocusCapture={() => setHoverKey(s.key)}
                                            onBlurCapture={(e) => {
                                                if (!e.currentTarget.contains(e.relatedTarget)) {
                                                    setHoverKey((k) => (k === s.key ? null : k));
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    setScriptStyle(s.key);
                                                }
                                            }}
                                            tabIndex={0}
                                            className={`group relative w-full max-w-xl rounded-xl border p-4 transition cursor-pointer ${
                                                isGuidelineMounted ? "z-20" : "z-0"
                                            } ${
                                                isFromStudioEntry
                                                    ? scriptStyle === s.key
                                                        ? "border-purple-500/80 bg-white text-black dark:bg-neutral-900 dark:text-white dark:border-purple-400/70"
                                                        : "border-purple-200/90 bg-white text-black hover:border-purple-300/95 hover:bg-white dark:bg-neutral-900 dark:text-white dark:border-white/15 dark:hover:border-purple-400/70 dark:hover:bg-neutral-900"
                                                    : scriptStyle === s.key
                                                        ? "border-purple-400/60 bg-purple-500/10"
                                                        : "border-neutral-300 dark:border-neutral-800 hover:bg-black/5 dark:hover:bg-white/5"
                                            }`}
                                        >
                                            {isGuidelineMounted && (
                                                <div
                                                    className={`pointer-events-none absolute inset-x-4 bottom-full mb-3 transition-[opacity,transform] duration-200 ease-out sm:inset-x-auto sm:w-[18.5rem] ${
                                                        isRTL ? "sm:right-4" : "sm:left-4"
                                                    } ${
                                                        isGuidelineShown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                                                    }`}
                                                >
                                                    <div className="relative overflow-hidden rounded-3xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(250,245,255,0.96)_54%,rgba(241,232,255,0.95)_100%)] p-4 shadow-[0_22px_50px_rgba(109,40,217,0.18)] ring-1 ring-purple-100/80 backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(155deg,rgba(25,19,38,0.96)_0%,rgba(45,27,78,0.94)_58%,rgba(79,35,120,0.92)_100%)] dark:ring-purple-400/20">
                                                        <span
                                                            className={`absolute -bottom-2 h-4 w-4 rotate-45 rounded-[4px] border-r border-b border-white/80 bg-[#f2e8ff] dark:border-white/10 dark:bg-[#512c7e] ${
                                                                isRTL ? "right-8" : "left-8"
                                                            }`}
                                                        />
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                                                                <Info className="h-4 w-4 text-purple-500 dark:text-purple-300" />
                                                                <span>{t("create.guidelines.title")}</span>
                                                            </div>
                                                            <span className="rounded-full border border-purple-200/80 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-purple-600 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-purple-100">
                                                                {s.title}
                                                            </span>
                                                        </div>
                                                        <div className="mt-3 space-y-2.5 text-sm leading-5 text-slate-700 dark:text-white/85">
                                                            <p>
                                                                <span className="font-semibold text-slate-950 dark:text-white">
                                                                    {t("create.guidelines.tone")}:
                                                                </span>{" "}
                                                                {guideline.tone}
                                                            </p>
                                                            <p>
                                                                <span className="font-semibold text-slate-950 dark:text-white">
                                                                    {t("create.guidelines.flow")}:
                                                                </span>{" "}
                                                                {guideline.flow}
                                                            </p>
                                                            <p>
                                                                <span className="font-semibold text-slate-950 dark:text-white">
                                                                    {t("create.guidelines.goal")}:
                                                                </span>{" "}
                                                                {guideline.goal}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex items-start gap-3">
                                                <input type="radio" checked={scriptStyle === s.key} readOnly className="accent-purple-600 mt-1" />
                                                <div className="w-full">
                                                    <div className="flex items-center gap-2 font-bold">
                                                        <span className="truncate">{s.title}</span>
                                                        {scriptStyle === s.key && (
                                                            <span className="text-xs text-purple-500 flex items-center gap-1">
                                                                <Check className="w-3 h-3" /> {t("create.common.selected")}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm mt-1 text-black/80 dark:text-white/80">{s.caption}</p>
                                                    <ul className="flex flex-wrap gap-2 mt-2 text-xs text-black/70 dark:text-white/70">
                                                        {s.bullets.map((b, i) => (
                                                            <li
                                                                key={i}
                                                                className={`px-2 py-1 rounded ${
                                                                    isFromStudioEntry ? "bg-purple-50 text-purple-900/85 border border-purple-100 dark:bg-purple-900/25 dark:text-purple-200 dark:border-purple-400/30" : "bg-black/5 dark:bg-white/5"
                                                                }`}
                                                            >
                                                                {b}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    <p className="text-xs text-purple-500 mt-2">
                                                        {t("create.common.valid")}: {s.valid}
                                                    </p>
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                            {errors.script_style && <p className="text-rose-500 mt-3 flex items-center gap-2 justify-center"><AlertCircle className="w-4 h-4" /> {errors.script_style}</p>}
                            <div className="mt-6 flex justify-end">
                                <button onClick={continueFromStyle} className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold">
                                    {t("create.common.continue")} <ChevronRight className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
                                </button>
                            </div>
                        </section>
                    )}

                    {/* STEP 2: SPEAKERS */}
                    {step === 2 && (
                        <section className={studioCardClass}>
                            <h2 className="ui-card-title flex items-center gap-2 justify-center"><Users className="w-4 h-4" /> {t("create.sections.speakers")}</h2>
                            {scriptStyle && (
                                <div className="flex items-center gap-2 flex-wrap mt-3 justify-center">
                                    {allowedCounts.map((n) => (
                                        <button
                                            key={n}
                                            onClick={() => setSpeakersCount(n)}
                                            className={`px-4 py-2 text-sm font-semibold rounded-xl transition border ${
                                                speakersCount === n
                                                    ? "bg-purple-600 text-white border-purple-600"
                                                    : "bg-black/5 dark:bg-white/5 border-neutral-300 dark:border-neutral-800 text-black/70 dark:text-white/70 hover:bg-black/10"
                                            }`}
                                        >
                                            {n} {n === 1 ? t("create.common.speaker") : t("create.common.speakers")}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {speakers.length > 0 && (
                                <div className={`mt-5 grid gap-5 ${speakers.length === 1 ? "grid-cols-1 max-w-md" : speakers.length === 2 ? "grid-cols-1 md:grid-cols-2 max-w-4xl" : "grid-cols-1 md:grid-cols-3 max-w-5xl"} mx-auto`}>
                                    {speakers.map((sp, i) => {

                                        let rawRole = sp.role || "guest";

                                        const totalHosts = roleCounts["Host"] || roleCounts["host"] || 0;

                                        let roleKey;

                                        if (rawRole === "host" && totalHosts > 1) {
                                            roleKey = "cohost";
                                        } else if (rawRole === "host") {
                                            roleKey = "host";
                                        } else if (rawRole === "cohost") {
                                            roleKey = "cohost";
                                        } else if (rawRole === "narrator") {
                                            roleKey = "narrator";
                                        } else {
                                            roleKey = "guest";
                                        }

                                        roleUsage[roleKey] = (roleUsage[roleKey] || 0) + 1;
                                        const occurrence = roleUsage[roleKey];

                                        const roleLabel = t(`create.roles.${roleKey}`);
                                        const label =
                                            roleCounts[rawRole] > 1 && roleKey !== "host"
                                                ? `${roleLabel} ${occurrence}`
                                                : roleLabel;
                                        const isHostLocked = false;

                                        return (
                                            <div
                                                key={i}
                                                className="rounded-xl border border-neutral-300 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 w-full"
                                            >
                                                {/* Card title */}
                                                <h3 className="text-sm font-bold text-black/80 dark:text-white/80">
                                                    {label}
                                                </h3>
                                                <p className="mt-1 text-xs text-neutral-500">
                                                    {t("create.speakers.help")}
                                                </p>

                                                <div className="mt-3 space-y-3">
                                                    {/* Name */}
                                                    <div>
                                                        <label className="form-label">{t("create.speakers.name")}</label>
                                                        <input
                                                            value={sp.name}
                                                            disabled={isHostLocked}
                                                            onChange={(e) => {
                                                                const cleaned = e.target.value
                                                                    .replace(/[^\p{L}\s]/gu, "")
                                                                    .replace(/\s{2,}/g, " ");
                                                                setSpeakers((arr) => {
                                                                    const next = [...arr];
                                                                    next[i] = { ...next[i], name: cleaned };
                                                                    return next;
                                                                });
                                                            }}
                                                            placeholder={t("create.speakers.namePlaceholder", { label })}
                                                            className={`form-input ${errors.speaker_names && !sp.name.trim()
                                                                ? "border-rose-400"
                                                                : ""
                                                                } ${isHostLocked ? "opacity-70 cursor-not-allowed" : ""}`}
                                                        />
                                                    </div>

                                                    {/* Gender */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="form-label">{t("create.speakers.gender")}</label>
                                                            <select
                                                                value={sp.gender}
                                                                disabled={isHostLocked}
                                                                onChange={(e) => {
                                                                    setSpeakers((arr) => {
                                                                        const gender = e.target.value;
                                                                        const next = [...arr];

                                                                        // Voices used by OTHER speakers
                                                                        const usedIds = new Set(
                                                                            next
                                                                                .filter((_, idx) => idx !== i)
                                                                                .map((s) => s.voiceId)
                                                                                .filter(Boolean)
                                                                        );

                                                                        const voiceId = defaultVoiceForGender(gender, usedIds);

                                                                        next[i] = {
                                                                            ...next[i],
                                                                            gender,
                                                                            voiceId, // assign a fresh unique voice for this gender
                                                                        };

                                                                        return next;
                                                                    });
                                                                    setSpeakerVoiceVisibleCounts((prev) => ({
                                                                        ...prev,
                                                                        [i]: VOICE_PAGE_SIZE,
                                                                    }));
                                                                }}
                                                                dir={isRTL ? "rtl" : "ltr"}
                                                                className={`form-input select-input [color-scheme:light] dark:[color-scheme:dark] ${isRTL ? "text-right" : "text-left"} ${isHostLocked ? "opacity-70 cursor-not-allowed" : ""}`}
                                                                style={{
                                                                    backgroundPosition: isRTL ? "left 0.75rem center" : "right 1rem center",
                                                                    paddingLeft: isRTL ? "2.25rem" : undefined,
                                                                    paddingRight: isRTL ? "1rem" : "2.5rem",
                                                                }}
                                                            >
                                                                <option value="Male">{t("create.speakers.genderMale")}</option>
                                                                <option value="Female">{t("create.speakers.genderFemale")}</option>
                                                            </select>
                                                        </div>
                                                    </div>

                                                    {/* Voice picker */}
                                                    <div>
                                                        <label className="form-label">{t("create.speakers.voice")}</label>
                                                        {loadingVoices ? (
                                                            <p className="text-sm text-black/60 dark:text-white/60">
                                                                {t("create.speakers.loadingVoices")}
                                                            </p>
                                                        ) : voices.length === 0 ? (
                                                            <p className="text-sm text-rose-500">
                                                                {t("create.speakers.noVoices")}
                                                            </p>
                                                        ) : (() => {
                                                            const pool = getFilteredVoicesForSpeaker(i);
                                                            const poolIds = new Set(pool.map(getVoiceId));
                                                            const currentId = sp.voiceId || "";
                                                            const safeValue = poolIds.has(currentId) ? currentId : "";
                                                            const visibleCount = speakerVoiceVisibleCounts[i] || VOICE_PAGE_SIZE;
                                                            const visiblePool = pool.slice(0, visibleCount);
                                                            const hasMoreVoices = pool.length > visibleCount;
                                                            return (
                                                                <div className="w-full">
                                                                    <div className="flex items-center gap-3">
                                                                    {/* Filters dropdown (per speaker) */}
                                                                    {(() => {
                                                                    const f = speakerVoiceFilters[i] || {
                                                                        open: false,
                                                                        q: "",
                                                                        gender: "",
                                                                        language: "",
                                                                        tone: "",
                                                                        pitch: "",
                                                                    };
                                                                    const isNeutralGender = (value) => {
                                                                        const g = String(value || "").trim().toLowerCase();
                                                                        return g.includes("neutral") || g.includes("netural");
                                                                    };
                                                                    const safeGenderFilter = (() => {
                                                                        const g = String(f.gender || "").trim().toLowerCase();
                                                                        if (!g || g === "__all__" || isNeutralGender(g)) return "__all__";
                                                                        return g;
                                                                    })();

                                                                    const setF = (patch) =>
                                                                        {
                                                                            setSpeakerVoiceFilters((prev) => ({
                                                                                ...prev,
                                                                                [i]: { ...prev[i], ...patch },
                                                                            }));
                                                                            setSpeakerVoiceVisibleCounts((prev) => ({
                                                                                ...prev,
                                                                                [i]: VOICE_PAGE_SIZE,
                                                                            }));
                                                                        };

                                                                    const languageOptions = Array.from(
                                                                        new Set(
                                                                        voices
                                                                            .flatMap((v) => {
                                                                                const langs = Array.isArray(v.languages)
                                                                                    ? v.languages
                                                                                    : typeof v.languages === "string"
                                                                                        ? v.languages.split(",")
                                                                                        : [];
                                                                                const labelLangs = Array.isArray(v.labels?.languages)
                                                                                    ? v.labels.languages
                                                                                    : typeof v.labels?.languages === "string"
                                                                                        ? String(v.labels.languages).split(",")
                                                                                        : [];
                                                                                return [...langs, ...labelLangs];
                                                                            })
                                                                            .map((x) => String(x).trim())
                                                                            .filter(Boolean)
                                                                        )
                                                                    ).sort();

                                                                    const toneOptions = Array.from(
                                                                        new Set(
                                                                            voices
                                                                                .flatMap((v) => getVoiceToneTags(v))
                                                                                .map((x) => String(x).trim())
                                                                                .filter(Boolean)
                                                                        )
                                                                    ).sort();

                                                                    const pitchOptions = PITCH_VALUES;

                                                                    const genderOptions = Array.from(
                                                                        new Set(
                                                                            voices
                                                                                .map((v) => String(v.gender || v.labels?.gender || "").trim().toLowerCase())
                                                                                .filter((g) => Boolean(g) && !isNeutralGender(g))
                                                                        )
                                                                    ).sort();

                                                                        const hasActive =
                                                                        !!String(f.q || "").trim() || !!f.gender || !!f.language || !!f.tone || !!f.pitch;
                                                                        const activeFilterChips = [
                                                                            String(f.q || "").trim()
                                                                                ? { key: "q", label: `${t("create.speakers.search", "Search")}: ${String(f.q).trim()}` }
                                                                                : null,
                                                                            (safeGenderFilter && safeGenderFilter !== "__all__")
                                                                                ? {
                                                                                    key: "gender",
                                                                                    label: `${t("create.speakers.gender", "Gender")}: ${safeGenderFilter}`,
                                                                                }
                                                                                : null,
                                                                            f.language
                                                                                ? { key: "language", label: `${t("create.speakers.language", "Language")}: ${f.language}` }
                                                                                : null,
                                                                            f.tone
                                                                                ? { key: "tone", label: `${t("create.speakers.tone", "Tone")}: ${f.tone}` }
                                                                                : null,
                                                                            f.pitch
                                                                                ? { key: "pitch", label: `${t("create.speakers.pitch", "Pitch")}: ${f.pitch}` }
                                                                                : null,
                                                                        ].filter(Boolean);

                                                                    return (
                                                                        <>
                                                                    <button
                                                                    type="button"
                                                                    disabled={isHostLocked}
                                                                    onClick={() => setF({ open: true })}
                                                                    className={`relative inline-flex items-center justify-center h-[44px] w-[44px] rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 transition
                                                                        ${isHostLocked ? "opacity-60 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                                                                    aria-label={t("create.speakers.filters")}
                                                                    title={t("create.speakers.filters")}
                                                                    >
                                                                    <SlidersHorizontal className="w-5 h-5" />

                                                                    {/* active dot */}
                                                                    {hasActive ? (
                                                                        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-purple-600 ring-2 ring-white dark:ring-neutral-900" />
                                                                    ) : null}
                                                                    </button>


                                                                        <Modal
                                                                            open={!!f.open && !isHostLocked}
                                                                            title={t("create.speakers.filters")}
                                                                            onClose={() => setF({ open: false })}
                                                                            isRTL={isRTL}
                                                                            footer={
                                                                            <>
                                                                                <button
                                                                                type="button"
                                                                                onClick={() => setF({ q: "", gender: "__all__", language: "", tone: "", pitch: "" })}
                                                                                className="px-4 h-[42px] rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/5 transition"
                                                                                >
                                                                                {t("create.speakers.clearFilters")}
                                                                                </button>

                                                                                <button
                                                                                type="button"
                                                                                onClick={() => setF({ open: false })}
                                                                                className="px-4 h-[42px] rounded-xl bg-purple-600 text-white text-sm font-semibold hover:opacity-95 transition"
                                                                                >
                                                                                {t("create.common.done")}
                                                                                </button>
                                                                            </>
                                                                            }
                                                                        >
                                                                            <div className="grid grid-cols-1 gap-4">
                                                                            {/* Search */}
                                                                            <div>
                                                                                <label className="form-label">{t("create.speakers.search")}</label>
                                                                                <input
                                                                                value={f.q}
                                                                                onChange={(e) => setF({ q: e.target.value })}
                                                                                placeholder={t("create.speakers.searchPlaceholder")}
                                                                                className="form-input"
                                                                                />
                                                                            </div>

                                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                                {/* Gender */}
                                                                                <div>
                                                                                <label className="form-label">{t("create.speakers.gender")}</label>
                                                                                <div className="relative">
                                                                                    <select
                                                                                        value={safeGenderFilter}
                                                                                        onChange={(e) => setF({ gender: e.target.value })}
                                                                                        className="form-input appearance-none pr-10 [color-scheme:light] dark:[color-scheme:dark]"
                                                                                    >
                                                                                        <option value="__all__">{t("create.speakers.allGenders", "All Genders")}</option>
                                                                                        {genderOptions.map((g) => (
                                                                                        <option key={g} value={g}>
                                                                                            {g}
                                                                                        </option>
                                                                                        ))}
                                                                                    </select>
                                                                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50 dark:text-white/60" />
                                                                                </div>
                                                                                </div>

                                                                                {/* Language */}
                                                                                <div>
                                                                                <label className="form-label">{t("create.speakers.language")}</label>
                                                                                <div className="relative">
                                                                                    <select
                                                                                        value={f.language}
                                                                                        onChange={(e) => setF({ language: e.target.value })}
                                                                                        className="form-input appearance-none pr-10 [color-scheme:light] dark:[color-scheme:dark]"
                                                                                    >
                                                                                        <option value="">{t("create.speakers.allLanguages")}</option>
                                                                                        {languageOptions.map((lang) => (
                                                                                        <option key={lang} value={lang}>
                                                                                            {lang}
                                                                                        </option>
                                                                                        ))}
                                                                                    </select>
                                                                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50 dark:text-white/60" />
                                                                                </div>
                                                                                </div>

                                                                                {/* Tone */}
                                                                                <div>
                                                                                <label className="form-label">{t("create.speakers.tone")}</label>
                                                                                <div className="relative">
                                                                                    <select
                                                                                        value={f.tone}
                                                                                        onChange={(e) => setF({ tone: e.target.value })}
                                                                                        className="form-input appearance-none pr-10 [color-scheme:light] dark:[color-scheme:dark]"
                                                                                    >
                                                                                        <option value="">{t("create.speakers.allTones")}</option>
                                                                                        {toneOptions.map((tone) => (
                                                                                        <option key={tone} value={tone}>
                                                                                            {tone}
                                                                                        </option>
                                                                                        ))}
                                                                                    </select>
                                                                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50 dark:text-white/60" />
                                                                                </div>
                                                                                </div>

                                                                                {/* Pitch */}
                                                                                <div className="md:col-span-2">
                                                                                <label className="form-label">{t("create.speakers.pitch")}</label>
                                                                                <div className="relative">
                                                                                    <select
                                                                                        value={f.pitch}
                                                                                        onChange={(e) => setF({ pitch: e.target.value })}
                                                                                        className="form-input appearance-none pr-10 [color-scheme:light] dark:[color-scheme:dark]"
                                                                                    >
                                                                                        <option value="">{t("create.speakers.allPitches")}</option>
                                                                                        {pitchOptions.map((p) => (
                                                                                        <option key={p} value={p}>
                                                                                            {p}
                                                                                        </option>
                                                                                        ))}
                                                                                    </select>
                                                                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50 dark:text-white/60" />
                                                                                </div>
                                                                                </div>
                                                                            </div>

                                                                            {activeFilterChips.length > 0 && (
                                                                                <div>
                                                                                    <p className="mb-2 text-xs font-semibold text-black/60 dark:text-white/60">
                                                                                        {t("create.speakers.activeFilters", "Active filters")}
                                                                                    </p>
                                                                                    <div className="flex flex-wrap gap-2">
                                                                                        {activeFilterChips.map((chip) => (
                                                                                            <button
                                                                                                key={chip.key}
                                                                                                type="button"
                                                                                                onClick={() => setF({ [chip.key]: chip.key === "gender" ? "__all__" : "" })}
                                                                                                className="inline-flex items-center gap-1 rounded-full border border-purple-300/70 dark:border-purple-400/45 bg-purple-50 dark:bg-purple-900/25 px-2.5 py-1 text-xs text-purple-700 dark:text-purple-200"
                                                                                                title={t("create.speakers.removeFilter", "Remove filter")}
                                                                                            >
                                                                                                <span>{chip.label}</span>
                                                                                                <span>x</span>
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            )}

                                                                            {/* Optional: small hint */}
                                                                            <p className="text-xs text-black/60 dark:text-white/60">
                                                                                {pool?.length
                                                                                ? t("create.speakers.filteredCount", {
                                                                                    count: pool.length,
                                                                                    defaultValue: "{{count}} voices match current filters",
                                                                                })
                                                                                : ""}
                                                                            </p>
                                                                            </div>
                                                                        </Modal>
                                                                        </>
                                                                    );
                                                                    })()}
                                                                    <select
                                                                        dir={isRTL ? "rtl" : "ltr"}
                                                                        disabled={isHostLocked}
                                                                        className={`form-input select-input flex-1 [color-scheme:light] dark:[color-scheme:dark] ${isRTL ? "text-right" : "text-left"} ${isHostLocked ? "opacity-70 cursor-not-allowed" : ""}`}
                                                                        style={{
                                                                            backgroundPosition: isRTL ? "left 0.75rem center" : "right 1rem center",
                                                                            paddingLeft: isRTL ? "2.25rem" : undefined,
                                                                            paddingRight: isRTL ? "1rem" : "2.5rem",
                                                                        }}
                                                                        value={safeValue}
                                                                        onChange={(e) => {
                                                                            const newVoice = e.target.value;

                                                                            // Prevent duplicate assignment
                                                                            const alreadyUsed = speakers.some(
                                                                                (s, idx) => s.voiceId === newVoice && idx !== i
                                                                            );

                                                                            if (alreadyUsed) {
                                                                                alert(t("create.speakers.voiceAlreadyUsed"));
                                                                                return;
                                                                            }

                                                                            setSpeakers((arr) => {
                                                                                const n = [...arr];
                                                                                n[i] = { ...n[i], voiceId: newVoice };
                                                                                return n;
                                                                            });

                                                                            if (newVoice && shouldAutoplayVoicePreview()) {
                                                                                const selected = pool.find(
                                                                                    (v) => (v.providerVoiceId || v.id || v.docId) === newVoice
                                                                                );
                                                                                previewVoice(newVoice, selected?.name || "");
                                                                            }
                                                                        }}
                                                                    >
                                                                        <option value="">{t("create.speakers.selectVoice")}</option>
                                                                        {visiblePool.map((v) => {
                                                                        const vid = v.providerVoiceId || v.id || v.docId;
                                                                        const isTaken = speakers.some((s, idx) => s.voiceId === vid && idx !== i);

                                                                        return (
                                                                            <option key={vid} value={vid} disabled={isTaken}>
                                                                            {v.name} {isTaken ? `(${t("create.speakers.alreadyUsed")})` : ""}
                                                                            </option>
                                                                        );
                                                                        })}
                                                                    </select>

                                                                    <button
                                                                    type="button"
                                                                    disabled={isHostLocked || !sp.voiceId || previewLoadingVoiceId === sp.voiceId}
                                                                    onClick={() => {
                                                                        const selected = pool.find((v) => (v.providerVoiceId || v.id || v.docId) === sp.voiceId);
                                                                        previewVoice(sp.voiceId, selected?.name || "");
                                                                    }}
                                                                    className={`inline-flex items-center justify-center gap-2 px-5 h-[44px] rounded-xl border border-purple-500 text-purple-600 font-semibold transition ${
                                                                        (isHostLocked || !sp.voiceId || previewLoadingVoiceId === sp.voiceId) ? "opacity-60 cursor-not-allowed" : "hover:bg-purple-50 dark:hover:bg-purple-900/20"
                                                                    } ${isRTL ? "flex-row-reverse" : ""}`}
                                                                    title={previewLoadingVoiceId === sp.voiceId ? "Generating preview..." : t("create.common.preview")}
                                                                    >
                                                                    {t("create.common.preview")} <Play className={`w-4 h-4 ${previewLoadingVoiceId === sp.voiceId ? "animate-pulse" : ""}`} />
                                                                    </button>
                                                                    </div>
                                                                    {hasMoreVoices && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setSpeakerVoiceVisibleCounts((prev) => ({
                                                                                    ...prev,
                                                                                    [i]: Math.min(pool.length, (prev[i] || VOICE_PAGE_SIZE) + VOICE_PAGE_SIZE),
                                                                                }))
                                                                            }
                                                                            className="mt-2 text-xs font-semibold text-purple-600 dark:text-purple-300 hover:underline"
                                                                        >
                                                                            {t("create.speakers.loadMoreVoices", {
                                                                                defaultValue: "Load more voices ({{shown}}/{{total}})",
                                                                                shown: visiblePool.length,
                                                                                total: pool.length,
                                                                            })}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                        <p className="form-help text-xs mt-1">
                                                            {t("create.speakers.voiceHelp")}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {(errors.speaker_names || errors.speakers) && <p className="text-rose-500 mt-4 text-center flex items-center gap-2 justify-center"><AlertCircle className="w-4 h-4" /> {errors.speaker_names || errors.speakers}</p>}
                            <div className="mt-6 flex justify-between">
                                <button onClick={() => setStep(1)} className="px-4 py-2 border rounded-xl">{t("create.common.back")}</button>
                                <button onClick={onContinueFromSpeakers} className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold">
                                    {t("create.common.continue")} <ChevronRight className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
                                </button>
                            </div>
                        </section>
                    )}

                    {/* STEP 3: ENTER TEXT */}
                    {step === 3 && (
                        <section className={studioCardClass}>
                            <h2 className="ui-card-title flex items-center gap-2">
                                <NotebookPen className="w-4 h-4" />
                                {t("create.step3.enterTextTitle")}
                            </h2>
                            <div className={`mb-2 flex ${isRTL ? "justify-start" : "justify-end"}`}>
                                <button
                                    type="button"
                                    onClick={() => handleUseSampleText("en")}
                                    className="inline-flex items-center rounded-lg border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-black/80 dark:text-white/85 hover:bg-black/5 dark:hover:bg-white/10 transition"
                                >
                                    Use English sample
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleUseSampleText("ar")}
                                    className="ml-2 inline-flex items-center rounded-lg border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-black/80 dark:text-white/85 hover:bg-black/5 dark:hover:bg-white/10 transition"
                                >
                                    Use Arabic sample
                                </button>
                            </div>

                            <textarea
                                id="wecast_textarea"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t("create.step3.textPlaceholder", { min: MIN, max: MAX })}
                                dir={isArabicText(description) || isRTL ? "rtl" : "ltr"}
                                className={`form-textarea mt-3 ${isArabicText(description) || isRTL ? "text-right" : "text-left"}`}
                                rows={8}
                            />

                            {(() => {
                                const wordCount = countWords(description);

                                return (
                                    <div className={`mt-2 text-sm flex ${isRTL ? "flex-row-reverse" : ""} justify-between`}>
                                        <span
                                            className={
                                                wordCount < MIN || wordCount > MAX
                                                    ? "text-rose-500"      // red if too short OR too long
                                                    : "text-purple-500"    // normal color inside range
                                            }
                                        >
                                            {wordCount} / {MAX} {t("create.common.words")}
                                        </span>
                                        {errors.description && (
                                            <span className="text-rose-500">{errors.description}</span>
                                        )}
                                    </div>
                                );
                            })()}

                            {errors.server && (
                                <p className="text-rose-600 mt-3 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" /> {errors.server}
                                </p>
                            )}

                            <div className="mt-6 flex justify-between">
                                <button
                                    onClick={() => setStep(2)}
                                    className="px-4 py-2 border rounded-xl"
                                >
                                    {t("create.common.back")}
                                </button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={submitting}
                                    className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold disabled:opacity-50"
                                >
                                    {submitting ? (
                                            t("create.common.generatingScript")
                                    ) : (
                                        <>
                                            {t("create.common.generateScript")} <Wand2 className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </section>
                    )}


                    {/* STEP 4: REVIEW & EDIT */}
                    {step === 4 && generatedScript && (
                        <section className={studioCardClass}>
                            {/* Header with title and export button on opposite sides */}
        <div className="flex items-center justify-between mb-4">
            <h2 className="ui-card-title flex items-center gap-2">
                <Edit className="w-4 h-4" />
                {t("create.step4.reviewTitle")}
            </h2>
            
            <div className="relative">
                <button
                    onClick={() => setShowExportMenu((prev) => !prev)}
                    disabled={!generatedScript}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700 text-white"
                    title="Export script"
                >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showExportMenu ? "rotate-180" : ""}`} />
                </button>
                {showExportMenu && generatedScript && (
                    <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-black/10 bg-white/96 p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm dark:border-white/10 dark:bg-neutral-900/96">
                        <button
                            onClick={() => {
                                setShowExportMenu(false);
                                exportScript("pdf");
                            }}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-black/80 transition hover:bg-purple-50 hover:text-purple-700 dark:text-white/80 dark:hover:bg-purple-900/20 dark:hover:text-purple-200"
                        >
                            <Download className="w-4 h-4" />
                            Export as PDF
                        </button>
                        <button
                            onClick={() => {
                                setShowExportMenu(false);
                                exportScript("txt");
                            }}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-black/80 transition hover:bg-black/5 dark:text-white/80 dark:hover:bg-white/10"
                        >
                            <Download className="w-4 h-4" />
                            Export as TXT
                        </button>
                    </div>
                )}
            </div>
        </div>

                            <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-6 border border-green-200 dark:border-green-800 mb-6">
                                <h3 className="text-xl font-bold text-green-700 dark:text-green-300 mb-4 flex items-center gap-2">
                                    <Check className="w-5 h-5" /> {t("create.step4.scriptGeneratedTitle")}
                                </h3>

                                {/* Script Information ABOVE the script */}
                                <div className="bg-white dark:bg-neutral-800 rounded-xl p-4 mb-4">
                                    <h4 className="font-semibold mb-3 text-black dark:text-white">
                                        {t("create.step4.scriptInfoTitle")}
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p>
                                                <strong>{t("create.step4.style")}:</strong> {styleLabelMap[scriptStyle] || scriptStyle}
                                            </p>
                                            <p>
                                                <strong>{t("create.step4.speakers")}:</strong> {speakersCount}
                                            </p>
                                            <p>
                                                <strong>{t("create.step4.totalWords")}:</strong>{" "}
                                                {generatedScript.split(/\s+/).filter(Boolean).length}
                                            </p>
                                        </div>
                                        <div>
                                            <p>
                                                <strong>{t("create.step4.speakerRoles")}:</strong>{" "}
                                                {speakers.map((s) => roleLabelFor(s.role)).join(", ")}
                                            </p>
                                            <p>
                                                <strong>{t("create.step4.status")}:</strong> {t("create.step4.readyForAudio")}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Script Preview */}
                                <div className="bg-white dark:bg-neutral-800 rounded-xl p-4">
                                    <h4 className="font-semibold mb-3 text-black dark:text-white">
                                        {t("create.step4.scriptPreview")}
                                    </h4>
                                    <div className="whitespace-pre-wrap text-sm text-black/80 dark:text-white/80 leading-relaxed max-h-96 overflow-y-auto">
                                        {displayedScript}
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-between items-center">
                                <button
                                    onClick={() => {
                                        // go back to text step and allow regeneration
                                        setStep(3);
                                    }}
                                    className="px-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition"
                                >
                                    {t("create.common.backToText")}
                                </button>

                                <div className="flex gap-3">
                                    <button
                                        onClick={navigateToEdit}
                                        className="px-4 py-2 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
                                    >
                                        {t("create.step4.editInEditor")}
                                    </button>
                                    <button
                                        onClick={() => setStep(5)}
                                        className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold"
                                    >
                                        {t("create.common.continueToMusic")} <ChevronRight className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}
                    {/* STEP 5: TRANSITION MUSIC */}
                    {step === 5 && (
                        <section className={studioCardClass}>
                            <h2 className="ui-card-title flex items-center gap-2 justify-center">
                                <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/40">
                                    <Headphones className="w-4 h-4" />
                                </span>
                                <span>{t("create.step5.title")}</span>
                            </h2>

                            <p className="text-center text-sm text-black/60 dark:text-white/60 mt-2">
                                {t("create.step5.subtitle")}
                            </p>

                            {/* CATEGORY SELECT */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                                {Object.keys(MUSIC_CATEGORIES).map((cat) => {
                                    const isActive = category === cat;

                                    const labelText =
                                        cat === "dramatic"
                                            ? t("create.music.categories.dramatic.title")
                                            : cat === "chill"
                                                ? t("create.music.categories.chill.title")
                                                : cat === "classics"
                                                    ? t("create.music.categories.classics.title")
                                                    : t("create.music.categories.arabic.title");

                                    const description =
                                        cat === "dramatic"
                                            ? t("create.music.categories.dramatic.desc")
                                            : cat === "arabic"
                                                ? t("create.music.categories.arabic.desc")
                                                : cat === "chill"
                                                    ? t("create.music.categories.chill.desc")
                                                    : t("create.music.categories.classics.desc");

                                    return (
                                        <label
                                            key={cat}
                                            onClick={() => {
                                                // Only reset if user actually switched to a different category
                                                if (category !== cat) {
                                                    setCategory(cat);
                                                    setAvailableTracks(MUSIC_CATEGORIES[cat]);

                                                    // reset selections when switching category
                                                    setIntroMusic("");
                                                    setBodyMusic("");
                                                    setOutroMusic("");

                                                    // stop any playing preview
                                                    setMusicPreview(null);
                                                }
                                            }}
                                            className={`cursor-pointer group relative w-full p-5 rounded-2xl border transition ${
                                                isFromStudioEntry
                                                    ? isActive
                                                        ? "border-purple-500/80 bg-white/95 text-black backdrop-blur-sm shadow-[0_16px_32px_rgba(124,58,237,0.12)] dark:bg-neutral-900 dark:text-white dark:border-purple-400/70"
                                                        : "border-purple-200/90 bg-white/82 text-black backdrop-blur-sm shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:border-purple-300/95 hover:bg-white/92 dark:bg-neutral-900 dark:text-white dark:border-white/15 dark:hover:border-purple-400/70 dark:hover:bg-neutral-900"
                                                    : isActive
                                                        ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 shadow-sm"
                                                        : "border-neutral-300 dark:border-neutral-800 hover:bg-black/5 dark:hover:bg-white/5"
                                            }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <input
                                                    type="radio"
                                                    checked={isActive}
                                                    readOnly
                                                    className="accent-purple-600 mt-1"
                                                />

                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        {/* tiny music icon bubble */}
                                                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/50">
                                                            <Music2 className="w-3 h-3" />
                                                        </span>

                                                        <div className="flex flex-col">
                                                            <span className="font-semibold">{labelText}</span>
                                                            <p className="text-xs text-black/60 dark:text-white/60 mt-0.5">
                                                                {description}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {isActive && (
                                                <span className="absolute top-3 right-4 inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/60 px-2.5 py-1 text-[11px] font-semibold">
                                                    <Check className="w-3 h-3" />
                                                    {t("create.common.selected")}
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>

                            {/* TRACK LIST */}
                            {category && availableTracks.length > 0 && (
                                <div className="mt-8 space-y-4">
                                    {[t("create.music.intro"), t("create.music.body"), t("create.music.outro")].map((label, index) => (
                                        <div key={label} className="flex items-center justify-between border p-3 rounded-xl dark:border-neutral-700">
                                            <span className="font-medium">{label}</span>

                                            <div className="flex items-center gap-3">
                                                <select
                                                    className="p-2 rounded-lg border dark:bg-neutral-800 dark:border-neutral-700"
                                                    value={
                                                        index === 0 ? introMusic : index === 1 ? bodyMusic : outroMusic
                                                    }
                                                    onChange={(e) => {
                                                        if (index === 0) setIntroMusic(e.target.value);
                                                        if (index === 1) setBodyMusic(e.target.value);
                                                        if (index === 2) setOutroMusic(e.target.value);
                                                    }}
                                                >
                                                    <option value="">{t("create.common.select")}</option>
                                                    {availableTracks.map((track) => (
                                                        <option key={track.file} value={track.file}>{track.name}</option>
                                                    ))}
                                                </select>

                                                <button
                                                    className={`px-4 py-2 rounded-xl border flex items-center gap-2 text-sm font-semibold
                                                         ${(index === 0 && !introMusic) ||
                                                            (index === 1 && !bodyMusic) ||
                                                            (index === 2 && !outroMusic)
                                                            ? "opacity-40 cursor-not-allowed border-neutral-300 dark:border-neutral-700 text-neutral-400"
                                                            : "border-purple-500 text-purple-600 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                                                        }`}
                                                    onClick={() => {
                                                        const selected =
                                                            index === 0 ? introMusic : index === 1 ? bodyMusic : outroMusic;
                                                        if (selected) {
                                                            setMusicPreview(
                                                                `${API_BASE}/static/music/${selected}`
                                                            );

                                                        }
                                                    }}
                                                >
                                                    <Play className="w-4 h-4" />
                                                    <span>{t("create.common.preview")}</span>
                                                </button>

                                            </div>
                                        </div>
                                    ))}

                                    {musicPreview && (
                                        <audio autoPlay src={musicPreview} onEnded={() => setMusicPreview(null)} />
                                    )}
                                </div>
                            )}

                            <div className="mt-8 flex justify-between items-center">
                                <button
                                    onClick={() => setStep(4)}
                                    className="px-4 py-2 border rounded-xl"
                                >
                                    {t("create.common.back")}
                                </button>

                                <div className="flex items-center gap-3">
                                    {/* Skip Button */}
                                    <button
                                        onClick={async () => {
                                            try {

                                                await fetch(`${API_BASE}/api/save-music`, {
                                                    method: "POST",
                                                    credentials: "include",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({
                                                        introMusic: null,
                                                        bodyMusic: null,
                                                        outroMusic: null,
                                                    }),
                                                });
                                            } catch (e) {
                                                console.error("Failed to clear music selection", e);
                                            }

                                            // Clear on frontend too
                                            setIntroMusic("");
                                            setBodyMusic("");
                                            setOutroMusic("");

                                            // Go to audio step without music
                                            setStep(6);
                                        }}
                                        className="px-5 py-2 rounded-xl border border-neutral-400 text-neutral-700 dark:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/10 transition"
                                    >
                                    {t("create.common.skip")}
                                    </button>


                                    {/* Continue Button */}
                                    <button

                                        disabled={!introMusic || !bodyMusic || !outroMusic}
                                        onClick={async () => {
                                            await fetch(`${API_BASE}/api/save-music`, {
                                                method: "POST",
                                                credentials: "include",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ introMusic, bodyMusic, outroMusic }),
                                            });
                                            setStep(6);
                                        }}
                                        className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold disabled:opacity-50"
                                    >
                                        {t("create.common.continueToAudio")}
                                    </button>
                                </div>
                            </div>

                        </section>
                    )}


                    {/* STEP 6: AUDIO */}
                    {step === 6 && (
                        <section className={studioCardClass}>
                            <h2 className="ui-card-title flex items-center gap-2 justify-center"><Mic2 className="w-4 h-4" /> {t("create.step6.generateAudioTitle")}</h2>

                            {!generatedAudio ? (
                                // Audio generation section
                                <div className="text-center space-y-6">
                                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-2xl p-6 border border-purple-200 dark:border-purple-800">
                                        <h3 className="text-xl font-bold text-purple-700 dark:text-purple-300 mb-3">{t("create.step6.readyTitle")}</h3>
                                        <p className="text-black/70 dark:text-white/70 mb-4">
                                            {t("create.step6.readySubtitle")}
                                        </p>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-left">
                                            <div>
                                                <h4 className="font-semibold mb-2">{t("create.step6.detailsTitle")}</h4>
                                                <p><strong>{t("create.step6.detailsStyle")}:</strong> {styleLabelMap[scriptStyle] || scriptStyle}</p>
                                                <p><strong>{t("create.step6.detailsSpeakers")}:</strong> {speakersCount}</p>
                                                <p><strong>{t("create.step6.detailsWords")}:</strong> {generatedScript.split(/\s+/).filter(Boolean).length}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex gap-4 justify-center flex-wrap">
                                        <button
                                            onClick={() => setStep(5)}
                                            className="px-6 py-3 border border-neutral-300 dark:border-neutral-700 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition"
                                        >
                                            {t("create.common.back")}
                                        </button>
                                        <button
                                            onClick={handleGenerateAudio}
                                            disabled={generatingAudio}
                                            className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold disabled:opacity-50"
                                        >
                                            {generatingAudio ? t("create.common.generatingAudio") : <>{t("create.common.generateAudio")} <Play className="w-4 h-4" /></>}
                                        </button>
                                        <button
                                            onClick={navigateToEdit}
                                            className="px-6 py-3 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
                                        >
                                            {t("create.step6.editScriptFirst")}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // Audio playback section
                                <div className="space-y-6">
                                    <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-6 border border-green-200 dark:border-green-800">
                                        <h3 className="text-xl font-bold text-green-700 dark:text-green-300 mb-4 flex items-center gap-2 justify-center">
                                            <Check className="w-5 h-5" /> {t("create.step6.audioGeneratedTitle")}
                                        </h3>

                                        {/* Audio Player */}
                                        <div className="mt-6">
                                            <WeCastAudioPlayer
                                                src={generatedAudio}
                                                title={audioTitle}
                                            />
                                        </div>

                                        {/* Additional Actions */}
                                        <div className="mt-6 flex gap-4 justify-center flex-wrap">
                                            <button
                                                onClick={() => setStep(4)}
                                                className="px-6 py-3 border border-neutral-300 dark:border-neutral-700 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition"
                                            >
                                                {t("create.common.backToScript")}
                                            </button>
                                            <button
                                                onClick={handleGenerateAudio}
                                                disabled={generatingAudio}
                                                className="px-6 py-3 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
                                            >
                                                {t("create.step6.regenerateAudio")}
                                            </button>
                                            <button
                                                onClick={() => {
        let editData = JSON.parse(sessionStorage.getItem("editData") || "{}");
        let podcastId = editData.podcastId;
                                                const previewSource = isFromStudioEntry ? "studio_create" : "create";
                                                sessionStorage.setItem("preview_from", previewSource);
                                                window.location.hash = podcastId ? `#/preview?id=${podcastId}&from=${previewSource}` : `#/preview?from=${previewSource}`;
                                                }}

                                                className="px-6 py-3 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
                                            >
                                                {t("create.step6.openEpisode")}
                                            </button>

                                            <button
                                                onClick={navigateToEdit}
                                                className="px-6 py-3 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition"
                                            >
                                                {t("create.step6.editScript")}
                                            </button>
                                            <button
                                                onClick={navigateToFinalize}
                                                className="btn-cta inline-flex items-center gap-2 px-7 py-3 rounded-xl text-base font-semibold"
                                            >
                                                Finalize & Publish <ChevronRight className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
                                            </button>

                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </div>

                {/* overlays */}
                <LoadingOverlay
                    show={submitting}
                    title={t("create.loading.scriptTitle")}
                    subtitle={t("create.loading.scriptSubtitle")}
                    logoAlt={t("create.common.logoAlt")}
                />
                <LoadingOverlay
                    show={generatingAudio}
                    title={t("create.loading.audioTitle")}
                    subtitle={t("create.loading.audioSubtitle")}
                    logoAlt={t("create.common.logoAlt")}
                />
                {showSampleReplaceModal && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="w-[min(92vw,460px)] rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6">
                            <h2 className="text-lg font-bold text-black dark:text-white mb-2">
                                Replace Existing Text?
                            </h2>
                            <p className="text-sm text-black/70 dark:text-white/70 mb-5">
                                This action will replace your current editor content with the selected sample text.
                            </p>
                            <div className="flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowSampleReplaceModal(false)}
                                    className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/5 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        applySampleText(pendingSampleLang);
                                        setShowSampleReplaceModal(false);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm font-semibold hover:opacity-90 transition"
                                >
                                    Replace Text
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <Toast
                    toast={toast}
                    onClose={() => setToast(null)}
                    closeLabel={t("create.common.close")}
                />
                </div>
            </main >
        </div >
    );
}

