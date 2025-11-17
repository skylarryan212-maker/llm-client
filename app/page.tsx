"use client";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import { supabase } from "../lib/supabaseClient";
import type {
  FileAttachment,
  ImageAttachment,
  Source,
  SourceChip,
} from "@/lib/chatTypes";
import {
  describeModelFamily,
  getModelAndReasoningConfig,
  type ModelFamily,
  type ReasoningEffort,
  type SpeedMode,
} from "@/lib/modelConfig";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type SearchSource = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published?: string | null;
  sourceType?: string;
  confidenceScore?: number;
};

type SearchRecord = {
  query: string;
  summary: string;
  rankedSources: SearchSource[];
  rawResults?: SearchSource[];
  fromCache?: boolean;
};

type MessageMetadata = {
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedModelFamily?: ModelFamily;
  requestedModelMode?: ModelMode;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
  thoughtDurationSeconds?: number;
  thoughtDurationLabel?: string;
  sources?: SourceChip[];
  citations?: Source[];
  files?: FileAttachment[];
  vectorStoreIds?: string[];
  attachments?: ImageAttachment[];
  generationType?: "text" | "image";
  generatedImages?: GeneratedImageResult[];
  imagePrompt?: string;
  imageModelLabel?: string;
  searchedSiteLabel?: string;
};

type ChatMessage = {
  id?: string;
  persistedId?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  files?: FileAttachment[];
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedModelFamily?: ModelFamily;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
  metadata?: MessageMetadata;
  thoughtDurationSeconds?: number;
  thoughtDurationLabel?: string;
};

type ImageModelKey = "gpt-image-1" | "gpt-image-1-mini";

type GeneratedImageResult = {
  id: string;
  dataUrl: string;
  model: ImageModelKey;
  prompt?: string;
};

type Project = {
  id: string;
  name: string;
  created_at?: string;
};

type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  created_at?: string;
};

type ViewMode = "chat" | "project";

type ModelMode = "auto" | "nano" | "mini" | "full";

const TEST_USER_ID = "test-user-1";

const SPEED_OPTIONS: { value: SpeedMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Balanced" },
  { value: "instant", label: "Instant", hint: "Fast replies" },
  { value: "thinking", label: "Thinking", hint: "Deeper reasoning" },
];

const SPEED_LABELS: Record<SpeedMode, string> = {
  auto: "Auto",
  instant: "Instant",
  thinking: "Thinking",
};


const MODEL_RETRY_OPTIONS: {
  value: Exclude<ModelFamily, "auto">;
  label: string;
}[] = [
  { value: "gpt-5-nano", label: "GPT 5 Nano" },
  { value: "gpt-5-mini", label: "GPT 5 Mini" },
  { value: "gpt-5.1", label: "GPT 5.1" },
  { value: "gpt-5-pro-2025-10-06", label: "GPT 5 Pro" },
];

const IMAGE_MODEL_OPTIONS: { value: ImageModelKey; label: string }[] = [
  { value: "gpt-image-1", label: "GPT Image" },
  { value: "gpt-image-1-mini", label: "GPT Image Mini" },
];

const IMAGE_MODEL_LABELS: Record<ImageModelKey, string> = {
  "gpt-image-1": "GPT Image",
  "gpt-image-1-mini": "GPT Image Mini",
};

const OTHER_MODEL_GROUPS: Array<{
  family: Exclude<ModelFamily, "auto" | "gpt-5.1">;
  label: string;
  shortLabel: string;
  supportsSpeedModes?: boolean;
}> = [
  {
    family: "gpt-5-mini",
    label: "GPT 5 Mini",
    shortLabel: describeModelFamily("gpt-5-mini"),
    supportsSpeedModes: true,
  },
  {
    family: "gpt-5-nano",
    label: "GPT 5 Nano",
    shortLabel: describeModelFamily("gpt-5-nano"),
    supportsSpeedModes: true,
  },
  {
    family: "gpt-5-pro-2025-10-06",
    label: "GPT 5 Pro",
    shortLabel: describeModelFamily("gpt-5-pro-2025-10-06"),
    supportsSpeedModes: false,
  },
];

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_ATTACHMENTS = 6;
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

const MAX_INPUT_HEIGHT = 176;
const MIN_INPUT_HEIGHT = 32;
const MAX_MESSAGE_WIDTH = 900;
const AUTO_SCROLL_THRESHOLD_PX = 140;
const MAX_PROJECT_CHAT_PREVIEW = 5;
const WAVEFORM_BAR_COUNT = 24;
const createEmptyWaveform = () =>
  Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0);

type ServerStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string }
  | { type: "file-reading-start" }
  | { type: "file-reading-complete" }
  | { type: "file-reading-error"; message?: string };

type StatusVariant = "default" | "extended" | "search" | "reading" | "error";

type ThinkingStatus =
  | { variant: "thinking"; label: string }
  | { variant: "extended"; label: string };

function StatusBubble({
  label,
  variant = "default",
  subtext,
}: {
  label: string;
  variant?: StatusVariant;
  subtext?: string;
}) {
  const baseClassMap: Record<StatusVariant, string> = {
    default: "border-white/5 bg-[#1b1b20]/90 text-zinc-400",
    extended: "border-[#4b64ff]/30 bg-[#1a1c2b]/80 text-[#b7c6ff]",
    search: "border-[#4b64ff]/30 bg-[#152033]/80 text-[#9bb8ff]",
    reading: "border-[#2f9e89]/40 bg-[#0f1f1a]/85 text-[#b8ffe8]",
    error: "border-red-500/40 bg-[#30161a]/85 text-red-200",
  };

  const dotMap: Record<StatusVariant, string> = {
    default: "bg-zinc-500",
    extended: "bg-[#8ab4ff]",
    search: "bg-[#8ab4ff]",
    reading: "bg-[#53f2c7]",
    error: "bg-red-400",
  };

  const pulseClass = "animate-pulse";

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-full border px-3 py-1 text-xs ${baseClassMap[variant]} sm:flex-row sm:items-center sm:gap-2`}
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${dotMap[variant]} ${pulseClass}`}
          aria-hidden
        />
        <span>{label}</span>
      </div>
      {subtext ? (
        <span className="text-[11px] opacity-80">{subtext}</span>
      ) : null}
    </div>
  );
}

function CheckmarkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function formatThoughtDurationLabel(seconds: number) {
  return `Thought for ${seconds.toFixed(1)} seconds`;
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code({ inline, children }: { inline?: boolean; children?: ReactNode }) {
    if (inline) {
      return (
        <code className="rounded-md bg-[#2d2d30] px-1.5 py-0.5 text-[13px]">
          {children}
        </code>
      );
    }
    return (
      <pre className="mt-2 overflow-x-auto rounded-lg bg-[#111111] px-3 py-2 text-[13px]">
        <code>{children}</code>
      </pre>
    );
  },
};

function latestConvTimeForProject(projectId: string, convs: ConversationMeta[]) {
  const filtered = convs.filter(
    (c) => c.project_id === projectId && c.created_at
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((max, c) => {
    const t = c.created_at!;
    if (!max) return t;
    return t > max ? t : max;
  }, filtered[0].created_at!);
}

function getNewestConversation(conversations: ConversationMeta[]) {
  if (conversations.length === 0) return null;
  return [...conversations].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "")
  )[0];
}

function legacyModeFromFamily(family: ModelFamily): ModelMode {
  switch (family) {
    case "gpt-5-nano":
      return "nano";
    case "gpt-5-mini":
      return "mini";
    case "gpt-5.1":
      return "full";
    case "gpt-5-pro-2025-10-06":
      return "full";
    default:
      return "auto";
  }
}

function extractDomainFromUrl(url?: string | null) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  }
}

const SEARCH_DOMAIN_LABELS: Record<string, string> = {
  "en.wikipedia.org": "Wikipedia",
};

function formatSearchSiteLabel(hostname?: string | null) {
  if (!hostname) return null;
  const normalized = hostname.toLowerCase();
  return SEARCH_DOMAIN_LABELS[normalized] ?? normalized;
}

function deriveSearchDomain(
  searchRecords?: SearchRecord[] | null,
  citations?: Source[] | null
) {
  const recordDomain = searchRecords
    ?.flatMap((record) => [
      ...(record.rankedSources ?? []),
      ...(record.rawResults ?? []),
    ])
    .map((source) => source.domain || extractDomainFromUrl(source.url))
    .find((domain) => !!domain);
  if (recordDomain) {
    return formatSearchSiteLabel(recordDomain);
  }
  const citationDomain = citations
    ?.map((source) => source.domain || extractDomainFromUrl(source.url))
    .find((domain) => !!domain);
  if (citationDomain) {
    return formatSearchSiteLabel(citationDomain);
  }
  return null;
}

function buildWaveformPath(levels: number[]) {
  if (!levels.length) {
    return "M0 12 L100 12";
  }
  const height = 24;
  const centerY = height / 2;
  const amplitude = centerY - 1;
  const width = Math.max(1, levels.length - 1);
  const step = 100 / width;
  const topPath: string[] = [];
  const bottomPath: string[] = [];
  levels.forEach((level, index) => {
    const clamped = Math.max(0.08, Math.min(1, level));
    const x = Number((index * step).toFixed(2));
    const offset = clamped * amplitude;
    const topY = Number((centerY - offset).toFixed(2));
    const bottomY = Number((centerY + offset).toFixed(2));
    const command = index === 0 ? "M" : "L";
    topPath.push(`${command}${x} ${topY}`);
    bottomPath.unshift(`L${x} ${bottomY}`);
  });
  return `${topPath.join(" ")} ${bottomPath.join(" ")} Z`;
}

export default function Home() {
  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelFamily, setModelFamily] = useState<ModelFamily>("gpt-5.1");
  const [speedMode, setSpeedMode] = useState<SpeedMode>("auto");
  const [forceWebSearch, setForceWebSearch] = useState(false);
  const [createImageArmed, setCreateImageArmed] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>(
    []
  );
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(
    null
  );
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);

  const skipAutoLoadRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const filePickerInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const waveformAnimationRef = useRef<number | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeAssistantMessageId, setActiveAssistantMessageId] =
    useState<string | null>(null);
  const [expandedSourcesId, setExpandedSourcesId] = useState<string | null>(
    null
  );
  const [openModelMenuId, setOpenModelMenuId] = useState<string | null>(null);
  const [headerModelMenuOpen, setHeaderModelMenuOpen] = useState(false);
  const [otherModelsMenuOpen, setOtherModelsMenuOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState<ThinkingStatus | null>(
    null
  );
  const [searchIndicator, setSearchIndicator] = useState<
    { message: string; variant: "running" | "error"; siteLabel?: string }
      | null
  >(null);
  const [fileReadingIndicator, setFileReadingIndicator] = useState<
    "running" | "error" | null
  >(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [waveformLevels, setWaveformLevels] = useState<number[]>(() =>
    createEmptyWaveform()
  );
  const [isMultilineInput, setIsMultilineInput] = useState(false);

  const cleanupWaveformVisualizer = useCallback(() => {
    if (waveformAnimationRef.current) {
      cancelAnimationFrame(waveformAnimationRef.current);
      waveformAnimationRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    const ctx = audioContextRef.current;
    if (ctx) {
      ctx.close().catch(() => null);
      audioContextRef.current = null;
    }
    waveformDataRef.current = null;
    setWaveformLevels(createEmptyWaveform());
  }, []);

  useEffect(() => {
    if (!headerModelMenuOpen) {
      setOtherModelsMenuOpen(false);
    }
  }, [headerModelMenuOpen]);

  useEffect(() => () => cleanupWaveformVisualizer(), [
    cleanupWaveformVisualizer,
  ]);

  useEffect(() => {
    if (isRecording || isTranscribing) {
      setComposerMenuOpen(false);
    }
  }, [isRecording, isTranscribing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("conversationHistory");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const hydrated = new Map<string, ChatMessage[]>();
      parsed.forEach((entry) => {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          Array.isArray(entry[1])
        ) {
          hydrated.set(entry[0], entry[1] as ChatMessage[]);
        }
      });
      conversationHistoryRef.current = hydrated;
    } catch (error) {
      console.warn("Failed to hydrate conversation history", error);
    }
  }, []);
  const [rowMenu, setRowMenu] = useState<
    { type: "conversation" | "project"; id: string } | null
  >(null);
  const [moveMenuConversationId, setMoveMenuConversationId] =
    useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<
    { id: string; title: string } | null
  >(null);
  const [deleteConversationLoading, setDeleteConversationLoading] =
    useState(false);
  const responseTimingRef = useRef({
    start: null as number | null,
    firstToken: null as number | null,
    assistantMessageId: null as string | null,
  });
  const longThinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMetadataPersistRef = useRef(new Map<string, MessageMetadata>());
  const conversationHistoryRef = useRef(new Map<string, ChatMessage[]>());

  const persistConversationHistory = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const serialized = JSON.stringify(
        Array.from(conversationHistoryRef.current.entries())
      );
      window.localStorage.setItem("conversationHistory", serialized);
    } catch (error) {
      console.warn("Failed to persist conversation history", error);
    }
  }, []);

  const removeConversationFromCache = useCallback(
    (conversationId: string) => {
      if (!conversationHistoryRef.current.has(conversationId)) return;
      conversationHistoryRef.current.delete(conversationId);
      persistConversationHistory();
    },
    [persistConversationHistory]
  );

  const clearLongThinkTimer = useCallback(() => {
    if (longThinkTimerRef.current) {
      clearTimeout(longThinkTimerRef.current);
      longThinkTimerRef.current = null;
    }
  }, []);

  const resetThinkingIndicator = useCallback(() => {
    clearLongThinkTimer();
    setThinkingStatus(null);
  }, [clearLongThinkTimer]);

  const showThinkingIndicator = useCallback(
    (effort?: ReasoningEffort | null) => {
      clearLongThinkTimer();
      if (!effort) {
        setThinkingStatus(null);
        return;
      }
      if (effort === "medium" || effort === "high") {
        setThinkingStatus({ variant: "extended", label: "Thinking for longer…" });
        return;
      }
      setThinkingStatus({ variant: "thinking", label: "Thinking" });
      if (effort === "low") {
        longThinkTimerRef.current = setTimeout(() => {
          setThinkingStatus({ variant: "extended", label: "Thinking for longer…" });
          longThinkTimerRef.current = null;
        }, 4000);
      }
    },
    [clearLongThinkTimer]
  );

  function scrollToBottom(opts: { behavior?: ScrollBehavior } = {}) {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: opts.behavior ?? "smooth",
    });
  }

  function handleJumpToBottom() {
    scrollToBottom({ behavior: "smooth" });
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
  }

  // ------------------------------------------------------------
  // INITIAL LOAD: projects + conversations
  // ------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, created_at")
        .eq("user_id", TEST_USER_ID);

      const { data: convData } = await supabase
        .from("conversations")
        .select("id, title, project_id, created_at")
        .eq("user_id", TEST_USER_ID);

      setProjects((projData || []) as Project[]);
      setConversations((convData || []) as ConversationMeta[]);

      if (convData && convData.length > 0) {
        const newest = [...convData].sort((a, b) =>
          (b.created_at || "").localeCompare(a.created_at || "")
        )[0];

        setSelectedConversationId(newest.id);
        setSelectedProjectId(newest.project_id);
        setViewMode("chat");
      }
    })();
  }, []);

  // ------------------------------------------------------------
  // LOAD MESSAGES
  // ------------------------------------------------------------
  const loadMessages = useCallback(
    async (
      conversationId: string,
      opts: { silent?: boolean; force?: boolean } = {}
    ) => {
      if (!conversationId) return;
      if (!opts.silent) setIsLoadingMessages(true);

      type ApiMessageRow = {
        id?: string;
        role: "user" | "assistant";
        content: string;
        metadata?: MessageMetadata | null;
      };

      let rows: ApiMessageRow[] = [];
      try {
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(
            `Failed to load messages (${response.status} ${response.statusText})`
          );
        }
        const payload = (await response.json()) as {
          messages?: ApiMessageRow[];
        };
        rows = Array.isArray(payload.messages) ? payload.messages : [];
      } catch (error) {
        console.error("Load messages error", error);
        if (!(conversationHistoryRef.current.get(conversationId)?.length ?? 0)) {
          setMessages([]);
        }
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (!opts.force && selectedConversationId !== conversationId) {
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (!opts.force && skipAutoLoadRef.current === conversationId) {
        skipAutoLoadRef.current = null;
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      console.log(
        `[historyDebug] loaded ${rows.length} messages for conversationId=${conversationId}`
      );
      const nextMessages = rows.map((m) => {
        const metadata = (m.metadata || {}) as MessageMetadata;
        const attachments = Array.isArray(metadata.attachments)
          ? metadata.attachments
          : [];
        const files = Array.isArray(metadata.files) ? metadata.files : [];
        const thoughtSeconds = metadata.thoughtDurationSeconds;
        const thoughtLabel =
          metadata.thoughtDurationLabel && metadata.thoughtDurationLabel.trim().length > 0
            ? metadata.thoughtDurationLabel
            : typeof thoughtSeconds === "number"
              ? formatThoughtDurationLabel(thoughtSeconds)
              : undefined;
        return {
          id: m.id,
          persistedId: m.id,
          role: m.role,
          content: m.content,
          attachments,
          files,
          usedModel: metadata.usedModel,
          usedModelMode: metadata.usedModelMode,
          usedModelFamily: metadata.usedModelFamily,
          requestedModelFamily: metadata.requestedModelFamily,
          speedMode: metadata.speedMode,
          reasoningEffort: metadata.reasoningEffort,
          usedWebSearch: metadata.usedWebSearch,
          searchRecords: metadata.searchRecords || [],
          metadata,
          thoughtDurationSeconds: thoughtSeconds,
          thoughtDurationLabel: thoughtLabel,
        } as ChatMessage;
      });

      if (
        nextMessages.length === 0 &&
        (conversationHistoryRef.current.get(conversationId)?.length ?? 0) > 0
      ) {
        console.warn(
          "Skipping empty history update because cached messages exist",
          conversationId
        );
      } else {
        setMessages(nextMessages);
      }

      if (!opts.silent) setIsLoadingMessages(false);
    },
    [selectedConversationId]
  );

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    const cachedMessages = conversationHistoryRef.current.get(
      selectedConversationId
    );
    if (cachedMessages) {
      setMessages(cachedMessages);
    } else {
      setMessages([]);
    }

    loadMessages(selectedConversationId);
  }, [selectedConversationId, loadMessages]);

  // ------------------------------------------------------------
  // AUTOSCROLL WHEN MESSAGES CHANGE
  // ------------------------------------------------------------
  useEffect(() => {
    if (!autoScrollEnabled) return;
    scrollToBottom({ behavior: isStreaming ? "smooth" : "auto" });
  }, [messages, autoScrollEnabled, isStreaming]);

  useEffect(() => {
    if (!selectedConversationId) return;
    conversationHistoryRef.current.set(selectedConversationId, messages);
    persistConversationHistory();
  }, [messages, selectedConversationId, persistConversationHistory]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX;
      setAutoScrollEnabled(nearBottom);
      const hasScrollableContent = el.scrollHeight > el.clientHeight + 8;
      setShowScrollButton(!nearBottom && hasScrollableContent);
    };
    handleScroll();
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const measuredHeight = Math.max(el.scrollHeight, MIN_INPUT_HEIGHT);
    const nextHeight = Math.min(measuredHeight, MAX_INPUT_HEIGHT);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
    const isMulti = el.scrollHeight > MIN_INPUT_HEIGHT + 2;
    setIsMultilineInput((prev) => (prev === isMulti ? prev : isMulti));
  }, [input]);

  useEffect(() => {
    const handleWindowClick = () => {
      setOpenModelMenuId(null);
      setComposerMenuOpen(false);
      setRowMenu(null);
      setMoveMenuConversationId(null);
      setHeaderModelMenuOpen(false);
      setOtherModelsMenuOpen(false);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    if (!searchIndicator || searchIndicator.variant !== "error") {
      return;
    }
    const timeout = setTimeout(() => setSearchIndicator(null), 5000);
    return () => clearTimeout(timeout);
  }, [searchIndicator]);

  useEffect(() => {
    if (fileReadingIndicator !== "error") {
      return;
    }
    const timeout = setTimeout(() => setFileReadingIndicator(null), 5000);
    return () => clearTimeout(timeout);
  }, [fileReadingIndicator]);

  useEffect(() => () => clearLongThinkTimer(), [clearLongThinkTimer]);

  // ------------------------------------------------------------
  // MEMOIZED SORTED LISTS
  // ------------------------------------------------------------
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "")
      ),
    [conversations]
  );

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const lastA =
          latestConvTimeForProject(a.id, conversations) || a.created_at || "";
        const lastB =
          latestConvTimeForProject(b.id, conversations) || b.created_at || "";
        return lastB.localeCompare(lastA);
      }),
    [projects, conversations]
  );

  const projectSidebarChats = useMemo(() => {
    const map = new Map<string, ConversationMeta[]>();
    sortedConversations.forEach((conversation) => {
      if (!conversation.project_id) {
        return;
      }
      if (!map.has(conversation.project_id)) {
        map.set(conversation.project_id, []);
      }
      map.get(conversation.project_id)?.push(conversation);
    });
    return map;
  }, [sortedConversations]);

  const currentProject = projects.find((p) => p.id === selectedProjectId);
  const selectedConversationMeta = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );
  const sidebarActiveProjectId =
    selectedProjectId ?? selectedConversationMeta?.project_id ?? null;

  const projectChats = useMemo(
    () =>
      selectedProjectId
        ? sortedConversations.filter((c) => c.project_id === selectedProjectId)
        : [],
    [sortedConversations, selectedProjectId]
  );

  const unassignedChats = useMemo(
    () => sortedConversations.filter((c) => !c.project_id),
    [sortedConversations]
  );

  const inProjectView = viewMode === "project" && !!selectedProjectId;
  const trimmedInput = input.trim();
  const hasComposerAttachments =
    imageAttachments.length > 0 || fileAttachments.length > 0;
  const canSendMessage = createImageArmed
    ? trimmedInput.length > 0 && !hasComposerAttachments
    : trimmedInput.length > 0 || hasComposerAttachments;
  const headerModelLabel =
    modelFamily === "auto"
      ? `Auto (${describeModelFamily("gpt-5-mini")})`
      : describeModelFamily(modelFamily);
  const headerSpeedDisplay =
    modelFamily === "gpt-5-pro-2025-10-06" || speedMode === "auto"
      ? null
      : SPEED_LABELS[speedMode];
  const isVoiceFlowActive = isRecording || isTranscribing;
  const shouldShowSendButton =
    isVoiceFlowActive || isStreaming || canSendMessage;
  const sendButtonDisabled = isStreaming ? false : !canSendMessage;
  const sendButtonAriaLabel = isStreaming
    ? "Stop response"
    : sendButtonDisabled
      ? "Send message (unavailable)"
      : createImageArmed
        ? "Send image prompt"
        : "Send message";
  const composerShapeClass = isMultilineInput
    ? "input-row-expanded"
    : "input-row-pill";
  const handlePrimaryAction = () => {
    if (isStreaming) {
      handleStopGeneration();
      return;
    }
    if (!sendButtonDisabled) {
      if (createImageArmed) {
        void sendImageMessage();
      } else {
        void sendTextMessage();
      }
    }
  };

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const formatAttachmentSize = (bytes?: number | null) => {
    if (!bytes) return null;
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const handlePhotoInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const availableSlots = MAX_IMAGE_ATTACHMENTS - imageAttachments.length;
    if (availableSlots <= 0) {
      setComposerError(
        `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`
      );
      event.target.value = "";
      return;
    }
    const selectedFiles = Array.from(files).slice(0, availableSlots);
    const prepared: ImageAttachment[] = [];
    for (const file of selectedFiles) {
      if (!file.type.startsWith("image/")) {
        setComposerError("Only image files are supported.");
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setComposerError("Images must be 8MB or smaller.");
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        prepared.push({
          id: createLocalId(),
          name: file.name || "image",
          mimeType: file.type || "image/*",
          dataUrl,
          size: file.size,
        });
      } catch (error) {
        console.error("Failed to read attachment", error);
        setComposerError("Failed to load one of the images.");
      }
    }
    if (prepared.length) {
      setImageAttachments((prev) => [...prev, ...prepared]);
      setComposerError(null);
    }
    event.target.value = "";
  };

  const handleFilePickerChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    let remainingImageSlots = MAX_IMAGE_ATTACHMENTS - imageAttachments.length;
    let remainingFileSlots = MAX_FILE_ATTACHMENTS - fileAttachments.length;
    const newImages: ImageAttachment[] = [];
    const newFiles: FileAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/") && remainingImageSlots > 0) {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          setComposerError("Images must be 8MB or smaller.");
          continue;
        }
        try {
          const dataUrl = await readFileAsDataUrl(file);
          newImages.push({
            id: createLocalId(),
            name: file.name || "image",
            mimeType: file.type || "image/*",
            dataUrl,
            size: file.size,
          });
          remainingImageSlots -= 1;
        } catch (error) {
          console.error("Failed to read attachment", error);
          setComposerError("Failed to load one of the files.");
        }
        continue;
      }
      if (remainingFileSlots <= 0) {
        setComposerError(
          `You can attach up to ${MAX_FILE_ATTACHMENTS} files.`
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setComposerError("Files must be 16MB or smaller.");
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        newFiles.push({
          id: createLocalId(),
          name: file.name || "file",
          mimeType: file.type || "application/octet-stream",
          dataUrl,
          size: file.size,
        });
        remainingFileSlots -= 1;
      } catch (error) {
        console.error("Failed to read file attachment", error);
        setComposerError("Failed to load one of the files.");
      }
    }
    if (newImages.length) {
      setImageAttachments((prev) => [...prev, ...newImages]);
    }
    if (newFiles.length) {
      setFileAttachments((prev) => [...prev, ...newFiles]);
    }
    if (newImages.length || newFiles.length) {
      setComposerError(null);
    }
    event.target.value = "";
  };

  const handleRemoveImageAttachment = (id: string) => {
    setImageAttachments((prev) =>
      prev.filter((attachment) => attachment.id !== id)
    );
    setComposerError(null);
  };

  const handleRemoveFileAttachment = (id: string) => {
    setFileAttachments((prev) => prev.filter((file) => file.id !== id));
    setComposerError(null);
  };

  const startWaveformVisualizer = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined") {
        return;
      }
      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
      if (!AudioCtx) {
        return;
      }
      try {
        cleanupWaveformVisualizer();
        const audioContext = new AudioCtx();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const buffer: Uint8Array<ArrayBuffer> = new Uint8Array(
          new ArrayBuffer(analyser.frequencyBinCount)
        );
        audioContextRef.current = audioContext;
        audioSourceRef.current = source;
        analyserRef.current = analyser;
        waveformDataRef.current = buffer;

        const tick = () => {
          if (!analyserRef.current || !waveformDataRef.current) {
            return;
          }
          analyserRef.current.getByteTimeDomainData(waveformDataRef.current);
          const data = waveformDataRef.current;
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            sum += Math.abs(data[i] - 128);
          }
          const normalized = Math.min(1, sum / data.length / 64);
          setWaveformLevels((prev) => {
            const next = prev.slice(1);
            next.push(normalized);
            return next;
          });
          waveformAnimationRef.current = requestAnimationFrame(tick);
        };
        waveformAnimationRef.current = requestAnimationFrame(tick);
        if (typeof audioContext.resume === "function") {
          void audioContext.resume().catch(() => null);
        }
      } catch (error) {
        console.warn("Unable to initialize waveform visualization", error);
      }
    },
    [cleanupWaveformVisualizer]
  );

  const stopRecording = useCallback(
    (shouldReturnBlob: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        return Promise.resolve<Blob | null>(null);
      }
      return new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => {
          mediaRecorderRef.current = null;
          const stream = mediaStreamRef.current;
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          const chunks = recordingChunksRef.current;
          recordingChunksRef.current = [];
          cleanupWaveformVisualizer();
          if (!shouldReturnBlob || chunks.length === 0) {
            resolve(null);
            return;
          }
          resolve(new Blob(chunks, { type: "audio/webm" }));
        };
        try {
          recorder.stop();
        } catch (error) {
          console.error("Unable to stop recording", error);
          resolve(null);
        }
      });
    },
    [cleanupWaveformVisualizer]
  );

  const cancelRecordingFlow = useCallback(() => {
    if (isRecording) {
      void stopRecording(false);
      setIsRecording(false);
    }
    if (isTranscribing) {
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setIsTranscribing(false);
    }
    setComposerError(null);
  }, [isRecording, isTranscribing, stopRecording]);

  useEffect(() => {
    if (isVoiceFlowActive) {
      setComposerMenuOpen(false);
    }
  }, [isVoiceFlowActive]);

  const startRecording = useCallback(async () => {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setComposerError("Voice input isn't supported in this browser.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setComposerError("Microphone access is unavailable.");
      return;
    }
    try {
      setComposerError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startWaveformVisualizer(stream);
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("startRecording error", error);
      setComposerError("Microphone permission was denied.");
    }
  }, [startWaveformVisualizer]);

  const transcribeAudio = useCallback(
    async (blob: Blob) => {
      const formData = new FormData();
      formData.append("audio", blob, "voice-message.webm");
      const controller = new AbortController();
      transcriptionAbortRef.current = controller;
      try {
        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Transcription failed");
        }
        const payload = (await response.json()) as { transcript?: string };
        const transcript = (payload.transcript || "").trim();
        if (transcript) {
          setInput((prev) => {
            if (!prev) return transcript;
            return `${prev.trimEnd()} ${transcript}`.trim();
          });
          textareaRef.current?.focus();
          setComposerError(null);
        } else {
          setComposerError("No speech detected in the recording.");
        }
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") {
          return;
        }
        console.error("transcribeAudio error", error);
        setComposerError("Unable to transcribe audio.");
      } finally {
        transcriptionAbortRef.current = null;
      }
    },
    []
  );

  const handleMicClick = useCallback(async () => {
    if (isTranscribing) {
      return;
    }
    if (isRecording) {
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        const blob = await stopRecording(true);
        if (blob) {
          await transcribeAudio(blob);
        } else {
          setComposerError("Recording was too short.");
        }
      } catch (error) {
        if ((error as DOMException)?.name !== "AbortError") {
          setComposerError("Unable to capture audio.");
        }
      } finally {
        setIsTranscribing(false);
      }
      return;
    }
    await startRecording();
  }, [isRecording, isTranscribing, startRecording, stopRecording, transcribeAudio]);

  const handleConversationSelect = (id: string) => {
    const convo = conversations.find((c) => c.id === id);
    if (id === selectedConversationId) {
      loadMessages(id, { force: true });
    } else {
      setSelectedConversationId(id);
    }
    setSelectedProjectId(convo?.project_id ?? null);
    setViewMode("chat");
    setSidebarOpen(false);
  };

  const handleProjectSelect = (id: string) => {
    setSelectedProjectId(id);
    setViewMode("project");
    setSidebarOpen(false);
  };

  const refreshConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, project_id, created_at")
      .eq("user_id", TEST_USER_ID);

    if (Array.isArray(data)) {
      setConversations(data as ConversationMeta[]);
    }
  }, []);

  const persistMessageMetadata = useCallback(
    async (messageId: string, metadata: MessageMetadata) => {
      if (!messageId) return;
      try {
        await supabase
          .from("messages")
          .update({ metadata })
          .eq("id", messageId);
      } catch (error) {
        console.warn("Failed to persist message metadata", error);
      }
    },
    []
  );

  useEffect(() => {
    if (pendingMetadataPersistRef.current.size === 0) return;
    messages.forEach((msg) => {
      const messageId = msg.id;
      if (!messageId) return;
      const pending = pendingMetadataPersistRef.current.get(messageId);
      if (!pending || !msg.persistedId) return;
      pendingMetadataPersistRef.current.delete(messageId);
      persistMessageMetadata(msg.persistedId, pending);
    });
  }, [messages, persistMessageMetadata]);

  // ------------------------------------------------------------
  // CREATE CONVERSATION
  // ------------------------------------------------------------
  async function createConversation(
    initialTitle: string,
    projectId: string | null
  ) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: TEST_USER_ID,
        title: initialTitle,
        project_id: projectId,
      })
      .select("id, title, project_id, created_at")
      .single();

    if (error || !data) throw error || new Error("Conversation not created");

    setConversations((prev) => [data, ...prev]);
    return data;
  }

type RetryOptions = {
  assistantMessageId: string;
  assistantPersistedId?: string | null;
  userMessagePersistedId?: string | null;
};

  type SendTextMessageOptions = {
    messageOverride?: string;
    attachmentsOverride?: ImageAttachment[];
    fileAttachmentsOverride?: FileAttachment[];
    modelOverride?: ModelFamily;
    speedOverride?: SpeedMode;
    retry?: RetryOptions;
  };

  type SendImageMessageOptions = {
    messageOverride?: string;
    modelOverride?: ImageModelKey;
    retry?: RetryOptions;
  };

  // ------------------------------------------------------------
  // SEND MESSAGE — STREAMING
  // ------------------------------------------------------------
  async function sendTextMessage(options?: SendTextMessageOptions) {
    if (isStreaming) return;
    const sourceText = options?.messageOverride ?? input;
    const activeAttachments =
      options?.attachmentsOverride ?? imageAttachments;
    const activeFiles =
      options?.fileAttachmentsOverride ?? fileAttachments;
    const text = sourceText.trim();
    const hasAttachments =
      activeAttachments.length > 0 || activeFiles.length > 0;
    if (!text && !hasAttachments) return;

    let conversationId = selectedConversationId;
    let assistantMessageId: string | null = options?.retry?.assistantMessageId ?? null;
    let userMessageId: string | null = null;
    const isRetry = Boolean(options?.retry);
    const chosenFamily = options?.modelOverride ?? modelFamily;
    const chosenSpeed = options?.speedOverride ?? speedMode;
    const requestedLegacyMode = legacyModeFromFamily(chosenFamily);
    const previewFamilyForReasoning =
      chosenFamily === "auto" ? "gpt-5-mini" : chosenFamily;
    const previewPrompt =
      text || (hasAttachments ? "[attachments]" : text);
    const previewModelConfig = getModelAndReasoningConfig(
      previewFamilyForReasoning,
      chosenSpeed,
      previewPrompt
    );
    const requestedReasoningEffort = previewModelConfig.reasoning?.effort;
    console.log(
      `[reasoningDebug] model=${previewModelConfig.model} effort=${previewModelConfig.reasoning?.effort ?? "none"} speed=${chosenSpeed}`
    );
    if (!options?.messageOverride) {
      setInput("");
      if (!options?.attachmentsOverride) {
        setImageAttachments([]);
      }
      if (!options?.fileAttachmentsOverride) {
        setFileAttachments([]);
      }
    }
    setComposerError(null);
    setIsStreaming(true);
    setComposerMenuOpen(false);
    setRowMenu(null);
    setMoveMenuConversationId(null);
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
    setSearchIndicator(null);
    setFileReadingIndicator(null);
    responseTimingRef.current = {
      start: typeof performance !== "undefined" ? performance.now() : Date.now(),
      firstToken: null,
      assistantMessageId: null,
    };
    resetThinkingIndicator();
    showThinkingIndicator(requestedReasoningEffort ?? null);

    try {
      if (!conversationId && isRetry) {
        throw new Error("Cannot retry without a conversation");
      }
      if (!conversationId) {
        const conv = await createConversation("New chat", selectedProjectId);
        conversationId = conv.id;
        setSelectedConversationId(conv.id);
        setSelectedProjectId(conv.project_id ?? selectedProjectId ?? null);
        setViewMode("chat");
        skipAutoLoadRef.current = conv.id;
      }

      if (!assistantMessageId) {
        assistantMessageId = createLocalId();
      }
      responseTimingRef.current.assistantMessageId = assistantMessageId;
      setActiveAssistantMessageId(assistantMessageId);

    const attachmentCopies = activeAttachments.map((attachment) => ({
      ...attachment,
    }));
    const fileAttachmentCopies = activeFiles.map((file) => ({
      ...file,
    }));

    if (!isRetry) {
      const newUserMessageId = createLocalId();
      userMessageId = newUserMessageId;
      const activeAssistantId = assistantMessageId!;
      const userMetadata =
        attachmentCopies.length || fileAttachmentCopies.length
          ? {
              ...(attachmentCopies.length
                ? { attachments: attachmentCopies }
                : {}),
              ...(fileAttachmentCopies.length
                ? { files: fileAttachmentCopies }
                : {}),
            }
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          id: newUserMessageId,
          role: "user",
          content: text,
          attachments: attachmentCopies,
          files: fileAttachmentCopies,
          metadata: userMetadata,
        },
        {
          id: activeAssistantId,
          role: "assistant",
          content: "",
          metadata: {
            generationType: "text",
            requestedModelMode: requestedLegacyMode,
            requestedModelFamily: chosenFamily,
            speedMode: chosenSpeed,
            reasoningEffort: requestedReasoningEffort,
          },
          requestedModelFamily: chosenFamily,
          speedMode: chosenSpeed,
          reasoningEffort: requestedReasoningEffort,
        },
      ]);
    } else {
        if (assistantMessageId) {
          pendingMetadataPersistRef.current.delete(assistantMessageId);
        }
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMessageId) return msg;
          return {
            ...msg,
            content: "",
            usedModel: undefined,
            usedModelMode: undefined,
            usedModelFamily: undefined,
            usedWebSearch: undefined,
            searchRecords: [],
            thoughtDurationSeconds: undefined,
            thoughtDurationLabel: undefined,
            metadata: {
              generationType: "text",
              requestedModelMode: requestedLegacyMode,
              requestedModelFamily: chosenFamily,
              speedMode: chosenSpeed,
              reasoningEffort: requestedReasoningEffort,
            },
            requestedModelFamily: chosenFamily,
            speedMode: chosenSpeed,
            reasoningEffort: requestedReasoningEffort,
          };
        })
      );
        setExpandedSourcesId((prev) =>
          prev === assistantMessageId ? null : prev
        );
      }

      const shouldForceWebSearch = forceWebSearch;
      setForceWebSearch(false);

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const requestBody: Record<string, unknown> = {
        message: text,
        conversationId,
        modelFamily: chosenFamily,
        speedMode: chosenSpeed,
        forceWebSearch: shouldForceWebSearch,
      };
      if (attachmentCopies.length > 0) {
        requestBody.images = attachmentCopies.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          size: attachment.size,
        }));
      }
      if (fileAttachmentCopies.length > 0) {
        requestBody.files = fileAttachmentCopies.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
          size: attachment.size,
        }));
      }

      if (options?.retry?.assistantPersistedId) {
        requestBody.retryAssistantMessageId =
          options.retry.assistantPersistedId;
      }
      if (options?.retry?.userMessagePersistedId) {
        requestBody.retryUserMessageId =
          options.retry.userMessagePersistedId;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      const markResponseFinished = () => {
        resetThinkingIndicator();
        setSearchIndicator((prev) =>
          prev?.variant === "running" ? null : prev
        );
        responseTimingRef.current = {
          start: null,
          firstToken: null,
          assistantMessageId: null,
        };
      };

      while (!finished) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line) {
              try {
                const payload = JSON.parse(line);
                if (payload.meta) {
                  const meta = payload.meta as MessageMetadata & {
                    assistantMessageRowId?: string;
                    userMessageRowId?: string;
                  };
                  const assistantRowId =
                    (meta as { assistantMessageRowId?: string })
                      .assistantMessageRowId;
                  const userRowId = (meta as { userMessageRowId?: string })
                    .userMessageRowId;
                  if (
                    typeof meta.reasoningEffort !== "undefined" &&
                    !responseTimingRef.current.firstToken
                  ) {
                    showThinkingIndicator(meta.reasoningEffort);
                  }
                  if (userRowId && userMessageId) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === userMessageId
                          ? { ...msg, persistedId: userRowId }
                          : msg
                      )
                    );
                  }
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== assistantMessageId) return msg;
                      const resolvedRequestedFamily =
                        meta.requestedModelFamily ??
                        msg.metadata?.requestedModelFamily ??
                        chosenFamily;
                      const resolvedSpeedMode =
                        meta.speedMode ??
                        msg.metadata?.speedMode ??
                        chosenSpeed;
                      const resolvedReasoning =
                        meta.reasoningEffort ??
                        msg.metadata?.reasoningEffort ??
                        requestedReasoningEffort;
                      const mergedMetadata: MessageMetadata = {
                        ...(msg.metadata || {}),
                        usedModel: meta.usedModel ?? msg.metadata?.usedModel,
                        usedModelMode:
                          meta.usedModelMode ??
                          msg.metadata?.usedModelMode ??
                          (meta.usedModelFamily
                            ? legacyModeFromFamily(meta.usedModelFamily)
                            : undefined),
                        usedModelFamily:
                          meta.usedModelFamily ??
                          msg.metadata?.usedModelFamily,
                        requestedModelMode:
                          meta.requestedModelMode ??
                          msg.metadata?.requestedModelMode ??
                          legacyModeFromFamily(resolvedRequestedFamily),
                        requestedModelFamily: resolvedRequestedFamily,
                        speedMode: resolvedSpeedMode,
                        reasoningEffort: resolvedReasoning,
                        usedWebSearch:
                          typeof meta.usedWebSearch === "boolean"
                            ? meta.usedWebSearch
                            : msg.metadata?.usedWebSearch,
                        searchRecords:
                          meta.searchRecords ??
                          msg.metadata?.searchRecords ??
                          [],
                        sources:
                          meta.sources ?? msg.metadata?.sources ?? [],
                        citations:
                          meta.citations ?? msg.metadata?.citations ?? [],
                        vectorStoreIds:
                          meta.vectorStoreIds ??
                          msg.metadata?.vectorStoreIds,
                        thoughtDurationSeconds: msg.thoughtDurationSeconds,
                        thoughtDurationLabel: msg.thoughtDurationLabel,
                      };
                      const discoveredSiteLabel = deriveSearchDomain(
                        mergedMetadata.searchRecords,
                        mergedMetadata.citations
                      );
                      if (discoveredSiteLabel) {
                        mergedMetadata.searchedSiteLabel =
                          discoveredSiteLabel;
                        setSearchIndicator((prev) =>
                          prev?.variant === "running"
                            ? { ...prev, siteLabel: discoveredSiteLabel }
                            : prev
                        );
                      }
                      if (!mergedMetadata.generationType) {
                        mergedMetadata.generationType = "text";
                      }
                      return {
                        ...msg,
                        usedModel: meta.usedModel ?? msg.usedModel,
                        usedModelMode:
                          meta.usedModelMode ??
                          msg.usedModelMode ??
                          (meta.usedModelFamily
                            ? legacyModeFromFamily(meta.usedModelFamily)
                            : undefined),
                        usedModelFamily:
                          meta.usedModelFamily ?? msg.usedModelFamily,
                        requestedModelFamily: resolvedRequestedFamily,
                        speedMode: resolvedSpeedMode,
                        reasoningEffort: resolvedReasoning,
                        usedWebSearch:
                          typeof meta.usedWebSearch === "boolean"
                            ? meta.usedWebSearch
                            : msg.usedWebSearch,
                        searchRecords:
                          meta.searchRecords ?? msg.searchRecords ?? [],
                        metadata: mergedMetadata,
                        persistedId: assistantRowId ?? msg.persistedId,
                      };
                    })
                  );
                  if (assistantMessageId && assistantRowId) {
                    const pending = pendingMetadataPersistRef.current.get(
                      assistantMessageId
                    );
                    if (pending) {
                      pendingMetadataPersistRef.current.delete(
                        assistantMessageId
                      );
                      persistMessageMetadata(assistantRowId, pending);
                    }
                  }
                } else if (typeof payload.token === "string") {
                  const token = payload.token as string;
                  if (!responseTimingRef.current.firstToken) {
                    const now =
                      typeof performance !== "undefined"
                        ? performance.now()
                        : Date.now();
                    responseTimingRef.current.firstToken = now;
                    resetThinkingIndicator();
                    setSearchIndicator((prev) =>
                      prev?.variant === "running" ? null : prev
                    );
                    setFileReadingIndicator((prev) =>
                      prev === "running" ? null : prev
                    );
                    const startTime = responseTimingRef.current.start;
                    const targetMessageId =
                      responseTimingRef.current.assistantMessageId;
                    if (startTime && targetMessageId) {
                      const seconds = Math.max(0, (now - startTime) / 1000);
                      const formatted = formatThoughtDurationLabel(seconds);
                      let persistedIdForTiming: string | undefined;
                      let updatedMetadata: MessageMetadata | null = null;
                      setMessages((prev) =>
                        prev.map((msg) => {
                          if (msg.id !== targetMessageId) return msg;
                          persistedIdForTiming = msg.persistedId;
                          const nextMetadata: MessageMetadata = {
                            ...(msg.metadata || {}),
                            thoughtDurationSeconds: seconds,
                            thoughtDurationLabel: formatted,
                          };
                          updatedMetadata = nextMetadata;
                          return {
                            ...msg,
                            metadata: nextMetadata,
                            thoughtDurationSeconds: seconds,
                            thoughtDurationLabel: formatted,
                          };
                        })
                      );
                      if (updatedMetadata) {
                        if (persistedIdForTiming) {
                          persistMessageMetadata(
                            persistedIdForTiming,
                            updatedMetadata
                          );
                        } else {
                          pendingMetadataPersistRef.current.set(
                            targetMessageId,
                            updatedMetadata
                          );
                        }
                      }
                    }
                  }
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + token }
                        : msg
                    )
                  );
                } else if (payload.status) {
                  const status = payload.status as ServerStatusEvent;
                  if (status.type === "search-start") {
                    setSearchIndicator({
                      message: "Searching the web…",
                      variant: "running",
                      siteLabel: undefined,
                    });
                  } else if (status.type === "search-complete") {
                    // keep indicator visible until first token arrives
                  } else if (status.type === "search-error") {
                    setSearchIndicator({
                      message:
                        status.message || "Web search failed. Using prior data.",
                      variant: "error",
                      siteLabel: undefined,
                    });
                  } else if (status.type === "file-reading-start") {
                    setFileReadingIndicator("running");
                  } else if (status.type === "file-reading-complete") {
                    setFileReadingIndicator(null);
                  } else if (status.type === "file-reading-error") {
                    setFileReadingIndicator("error");
                  }
                } else if (payload.type === "sources") {
                  const sourcesEvent = payload as {
                    type: "sources";
                    conversationId?: string;
                    messageId?: string;
                    sources?: Source[];
                  };
                  if (
                    sourcesEvent.conversationId &&
                    sourcesEvent.conversationId !== selectedConversationId
                  ) {
                    continue;
                  }
                  if (!Array.isArray(sourcesEvent.sources)) {
                    continue;
                  }
                  let metadataForPersist: MessageMetadata | null = null;
                  let localMessageId: string | null = null;
                  let resolvedPersistedId: string | null = null;
                  setMessages((prev) =>
                    prev.map((msg) => {
                      const matchesPersisted =
                        msg.persistedId === sourcesEvent.messageId;
                      const matchesActive =
                        assistantMessageId &&
                        msg.id === assistantMessageId &&
                        !msg.persistedId;
                      if (!matchesPersisted && !matchesActive) {
                        return msg;
                      }
                      const nextMetadata: MessageMetadata = {
                        ...(msg.metadata || {}),
                        citations: sourcesEvent.sources ?? [],
                      };
                      metadataForPersist = nextMetadata;
                      localMessageId = msg.id ?? null;
                      resolvedPersistedId = msg.persistedId ?? null;
                      return {
                        ...msg,
                        metadata: nextMetadata,
                      };
                    })
                  );
                  if (metadataForPersist) {
                    if (resolvedPersistedId) {
                      persistMessageMetadata(
                        resolvedPersistedId,
                        metadataForPersist
                      );
                    } else if (localMessageId) {
                      pendingMetadataPersistRef.current.set(
                        localMessageId,
                        metadataForPersist
                      );
                    }
                  }
                } else if (typeof payload.title === "string") {
                  const newTitle = payload.title.trim();
                  if (newTitle && conversationId) {
                    setConversations((prev) =>
                      prev.map((conv) =>
                        conv.id === conversationId
                          ? { ...conv, title: newTitle }
                          : conv
                      )
                    );
                  }
                } else if (payload.done) {
                  markResponseFinished();
                  finished = true;
                }
              } catch (err) {
                console.warn("Failed to parse stream chunk", err);
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (done) {
          finished = true;
        }
      }

      // bump last activity timestamp
      if (conversationId) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, created_at: new Date().toISOString() }
              : c
          )
        );
      }

      refreshConversations();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.warn("Chat request aborted");
      } else {
        console.error(error);
        if (assistantMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: "Error contacting GPT. Try again." }
                : msg
            )
          );
        }
      }
      resetThinkingIndicator();
      setSearchIndicator(null);
      setFileReadingIndicator(null);
      responseTimingRef.current = {
        start: null,
        firstToken: null,
        assistantMessageId: null,
      };
      if (assistantMessageId) {
        pendingMetadataPersistRef.current.delete(assistantMessageId);
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setActiveAssistantMessageId((current) =>
        assistantMessageId && current === assistantMessageId ? null : current
      );
      setFileReadingIndicator(null);
      responseTimingRef.current = {
        start: null,
        firstToken: null,
        assistantMessageId: null,
      };
      if (assistantMessageId) {
        pendingMetadataPersistRef.current.delete(assistantMessageId);
      }
    }
  }

  async function sendImageMessage(options?: SendImageMessageOptions) {
    if (isStreaming) return;
    const sourceText = options?.messageOverride ?? input;
    const prompt = sourceText.trim();
    if (!prompt) {
      setComposerError("Enter a prompt to create an image.");
      return;
    }
    if (imageAttachments.length > 0 || fileAttachments.length > 0) {
      setComposerError("Remove attachments before creating an image.");
      return;
    }

    let conversationId = selectedConversationId;
    let assistantMessageId: string | null =
      options?.retry?.assistantMessageId ?? null;
    let userMessageId: string | null = null;
    const isRetry = Boolean(options?.retry);

    if (!options?.messageOverride) {
      setInput("");
      setImageAttachments([]);
      setFileAttachments([]);
    }
    setComposerError(null);
    setIsStreaming(true);
    setComposerMenuOpen(false);
    setRowMenu(null);
    setMoveMenuConversationId(null);
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
    setForceWebSearch(false);
    setSearchIndicator(null);
    setFileReadingIndicator(null);
    setThinkingStatus({ variant: "thinking", label: "Generating image…" });

    try {
      if (!conversationId && isRetry) {
        throw new Error("Cannot retry without a conversation");
      }
      if (!conversationId) {
        const conv = await createConversation("New chat", selectedProjectId);
        conversationId = conv.id;
        setSelectedConversationId(conv.id);
        setSelectedProjectId(conv.project_id ?? selectedProjectId ?? null);
        setViewMode("chat");
        skipAutoLoadRef.current = conv.id;
      }

      if (!assistantMessageId) {
        assistantMessageId = createLocalId();
      }
      responseTimingRef.current = {
        start:
          typeof performance !== "undefined" ? performance.now() : Date.now(),
        firstToken: null,
        assistantMessageId,
      };
      setActiveAssistantMessageId(assistantMessageId);

      if (!isRetry) {
        const newUserMessageId = createLocalId();
        userMessageId = newUserMessageId;
        const placeholderAssistantId = assistantMessageId!;
        setMessages((prev) => [
          ...prev,
          {
            id: newUserMessageId,
            role: "user",
            content: prompt,
          },
          {
            id: placeholderAssistantId,
            role: "assistant",
            content: "",
            metadata: {
              generationType: "image",
              imagePrompt: prompt,
            },
          },
        ]);
      } else {
        if (assistantMessageId) {
          pendingMetadataPersistRef.current.delete(assistantMessageId);
        }
        const promptCopy = prompt;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: "",
                  usedModel: undefined,
                  usedModelMode: undefined,
                  usedModelFamily: undefined,
                  metadata: {
                    ...(msg.metadata || {}),
                    generationType: "image",
                    imagePrompt: promptCopy,
                    generatedImages: [],
                    imageModelLabel: undefined,
                  },
                }
              : msg
          )
        );
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const requestBody: Record<string, unknown> = {
        prompt,
        conversationId,
      };
      if (options?.modelOverride) {
        requestBody.model = options.modelOverride;
      }
      if (options?.retry?.assistantPersistedId) {
        requestBody.retryAssistantMessageId =
          options.retry.assistantPersistedId;
      }
      if (options?.retry?.userMessagePersistedId) {
        requestBody.retryUserMessageId =
          options.retry.userMessagePersistedId;
      }

      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      if (!res.ok) {
        throw new Error("Image generation failed");
      }
      const payload = (await res.json()) as {
        assistantMessageId?: string;
        userMessageId?: string;
        images: GeneratedImageResult[];
        usedModel: ImageModelKey;
        metadata?: Partial<MessageMetadata>;
        content?: string;
      };

      const resolvedAssistantId =
        payload.assistantMessageId ?? assistantMessageId;
      const imageModelLabel =
        IMAGE_MODEL_LABELS[payload.usedModel] ?? payload.usedModel;
      const resolvedMetadata: MessageMetadata = {
        generationType: "image",
        imagePrompt: prompt,
        imageModelLabel,
        generatedImages: payload.images,
        ...(payload.metadata || {}),
      };
      const assistantContent =
        payload.content?.trim() ||
        (payload.images.length > 1
          ? "Created the requested images."
          : "Created the requested image.");

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMessageId) return msg;
          return {
            ...msg,
            content: assistantContent,
            metadata: resolvedMetadata,
            usedModel: payload.usedModel,
            persistedId: payload.assistantMessageId ?? msg.persistedId,
          };
        })
      );

      if (resolvedAssistantId) {
        persistMessageMetadata(resolvedAssistantId, resolvedMetadata);
      } else if (assistantMessageId) {
        pendingMetadataPersistRef.current.set(
          assistantMessageId,
          resolvedMetadata
        );
      }

      if (payload.userMessageId && userMessageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === userMessageId
              ? { ...msg, persistedId: payload.userMessageId ?? msg.persistedId }
              : msg
          )
        );
      }
      refreshConversations();
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") {
        console.warn("Image request aborted");
      } else {
        console.error(error);
        if (assistantMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: "Unable to create the image. Try again.",
                  }
                : msg
            )
          );
        } else {
          setComposerError("Unable to create the image. Try again.");
        }
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setActiveAssistantMessageId((current) =>
        assistantMessageId && current === assistantMessageId ? null : current
      );
      setThinkingStatus(null);
      responseTimingRef.current = {
        start: null,
        firstToken: null,
        assistantMessageId: null,
      };
      setCreateImageArmed(false);
      if (assistantMessageId) {
        pendingMetadataPersistRef.current.delete(assistantMessageId);
      }
    }
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (createImageArmed) {
        void sendImageMessage();
      } else {
        void sendTextMessage();
      }
    }
  }

  async function handleRetryWithModel(
    targetFamily: Exclude<ModelFamily, "auto">,
    targetMessage: ChatMessage
  ) {
    if (targetMessage.metadata?.generationType === "image") {
      return;
    }
    if (!targetMessage.id) return;
    const targetIndex = messages.findIndex(
      (msg) => msg.id === targetMessage.id
    );
    if (targetIndex === -1) return;
    const relatedUserMessage = [...messages]
      .slice(0, targetIndex)
      .reverse()
      .find((msg) => msg.role === "user");
    if (!relatedUserMessage) return;
    const retryPayload: RetryOptions | undefined =
      targetMessage.persistedId && relatedUserMessage.persistedId
        ? {
            assistantMessageId: targetMessage.id,
            assistantPersistedId: targetMessage.persistedId,
            userMessagePersistedId: relatedUserMessage.persistedId,
          }
        : undefined;
    setModelFamily(targetFamily);
    setOpenModelMenuId(null);
    setExpandedSourcesId((prev) =>
      prev === targetMessage.id ? null : prev
    );
    await sendTextMessage({
      messageOverride: relatedUserMessage.content,
      attachmentsOverride: relatedUserMessage.attachments ?? [],
      modelOverride: targetFamily,
      retry: retryPayload,
    });
  }

  async function handleRetryWithImageModel(
    targetModel: ImageModelKey,
    targetMessage: ChatMessage
  ) {
    if (!targetMessage.id) return;
    const targetIndex = messages.findIndex(
      (msg) => msg.id === targetMessage.id
    );
    if (targetIndex === -1) return;
    const relatedUserMessage = [...messages]
      .slice(0, targetIndex)
      .reverse()
      .find((msg) => msg.role === "user");
    if (!relatedUserMessage) return;
    const retryPayload: RetryOptions | undefined =
      targetMessage.persistedId && relatedUserMessage.persistedId
        ? {
            assistantMessageId: targetMessage.id,
            assistantPersistedId: targetMessage.persistedId,
            userMessagePersistedId: relatedUserMessage.persistedId,
          }
        : undefined;
    await sendImageMessage({
      messageOverride: relatedUserMessage.content,
      modelOverride: targetModel,
      retry: retryPayload,
    });
  }

  function handleStopGeneration() {
    const activeId = activeAssistantMessageId;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    resetThinkingIndicator();
    setSearchIndicator(null);
    setFileReadingIndicator(null);
    responseTimingRef.current = {
      start: null,
      firstToken: null,
      assistantMessageId: null,
    };
    if (activeId) {
      pendingMetadataPersistRef.current.delete(activeId);
    }
    setActiveAssistantMessageId(null);
  }

  async function handleCopyMessage(message: ChatMessage, fallbackId?: string) {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id ?? fallbackId ?? null);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  }

  // ------------------------------------------------------------
  // PROJECTS + CHAT MGMT
  // ------------------------------------------------------------
  async function handleNewChat(global = false) {
    const projectId = global ? null : selectedProjectId;
    try {
      const conv = await createConversation("New chat", projectId);
      setSelectedConversationId(conv.id);
      setSelectedProjectId(conv.project_id ?? projectId ?? null);
      setMessages([]);
      setViewMode("chat");
      setSidebarOpen(false);
    } catch {
      // noop
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: TEST_USER_ID, name })
      .select("id, name, created_at")
      .single();

    if (!error && data) {
      setProjects((prev) => [data, ...prev]);
      setSelectedProjectId(data.id);
      setViewMode("project");
      setShowProjectModal(false);
      setNewProjectName("");
    }
  }

  async function renameConversation(id: string) {
    const oldTitle =
      conversations.find((c) => c.id === id)?.title || "Untitled chat";

    const nextTitle = window.prompt("Rename chat:", oldTitle);
    if (!nextTitle || !nextTitle.trim()) return;

    await supabase
      .from("conversations")
      .update({ title: nextTitle.trim() })
      .eq("id", id);

    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: nextTitle.trim() } : c))
    );
  }

  async function deleteConversation(id: string) {
    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);
    removeConversationFromCache(id);

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (selectedConversationId === id) {
        const fallback = getNewestConversation(filtered);
        if (fallback) {
          setSelectedConversationId(fallback.id);
          setSelectedProjectId(fallback.project_id);
          setViewMode("chat");
        } else {
          setSelectedConversationId(null);
          setMessages([]);
        }
      }
      return filtered;
    });
  }

  const requestDeleteConversation = (id: string) => {
    const target = conversations.find((c) => c.id === id);
    setPendingDeleteConversation({
      id,
      title: target?.title?.trim() || "Untitled chat",
    });
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;
    setDeleteConversationLoading(true);
    try {
      await deleteConversation(pendingDeleteConversation.id);
    } finally {
      setDeleteConversationLoading(false);
      setPendingDeleteConversation(null);
    }
  };

  async function moveConversation(id: string, newProjectId: string | null) {
    await supabase
      .from("conversations")
      .update({ project_id: newProjectId })
      .eq("id", id);

    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, project_id: newProjectId } : c
      )
    );

    if (selectedConversationId === id) {
      setSelectedProjectId(newProjectId);
    }
  }

  async function handleMoveFromMenu(
    conversationId: string,
    targetProjectId: string | null
  ) {
    await moveConversation(conversationId, targetProjectId);
    setRowMenu(null);
    setMoveMenuConversationId(null);
  }

  async function renameProject(id: string) {
    const existingName = projects.find((p) => p.id === id)?.name || "Untitled";
    const nextName = window.prompt("Rename project:", existingName);
    if (!nextName || !nextName.trim()) return;
    await supabase
      .from("projects")
      .update({ name: nextName.trim() })
      .eq("id", id);

    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: nextName.trim() } : p))
    );
  }

  async function deleteProject(id: string) {
    const { data: conversationRows } = await supabase
      .from("conversations")
      .select("id")
      .eq("project_id", id);

    const conversationIds = new Set(
      (conversationRows || []).map((row) => (row as { id: string }).id)
    );
    conversations
      .filter((c) => c.project_id === id)
      .forEach((c) => {
        if (c.id) {
          conversationIds.add(c.id);
        }
      });
    const idsArray = Array.from(conversationIds);

    if (idsArray.length > 0) {
      await supabase
        .from("messages")
        .delete()
        .in("conversation_id", idsArray);
      await supabase
        .from("conversations")
        .delete()
        .in("id", idsArray);
      idsArray.forEach((conversationId) =>
        removeConversationFromCache(conversationId)
      );
    }

    await supabase.from("projects").delete().eq("id", id);

    setProjects((prev) => prev.filter((p) => p.id !== id));
    const selectedConversationDeleted =
      !!selectedConversationId &&
      conversationIds.has(selectedConversationId);
    setConversations((prev) => {
      const remaining = prev.filter((c) => !conversationIds.has(c.id));
      if (selectedConversationDeleted) {
        const fallback = getNewestConversation(remaining);
        if (fallback) {
          setSelectedConversationId(fallback.id);
          setSelectedProjectId(fallback.project_id);
          setViewMode("chat");
        } else {
          setSelectedConversationId(null);
          setMessages([]);
        }
      }
      return remaining;
    });

    if (!selectedConversationDeleted && selectedProjectId === id) {
      setSelectedProjectId(null);
      setViewMode("chat");
    }
  }

  const requestDeleteProject = (id: string) => {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    setPendingDeleteProject(target);
  };

  const confirmDeleteProject = async () => {
    if (!pendingDeleteProject) return;
    setDeleteProjectLoading(true);
    try {
      await deleteProject(pendingDeleteProject.id);
    } finally {
      setDeleteProjectLoading(false);
      setPendingDeleteProject(null);
    }
  };

  // ------------------------------------------------------------
  // SIDEBAR CONTENT (shared between desktop + mobile)
  // ------------------------------------------------------------
  const SidebarSections = () => (
    <>
      <div className="sidebar-header">
        <div className="flex flex-col gap-1">
          <div className="sidebar-title">Workspaces &amp; Projects</div>
          <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">
            LLM Client
          </div>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            onClick={() => handleNewChat(true)}
            aria-label="Start a new chat"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => setShowProjectModal(true)}
            aria-label="Create project"
          >
            New project
          </button>
        </div>
      </div>
      <div className="sidebar-main">
        <button
          onClick={() => handleNewChat(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#5661f6] via-[#3c4ed8] to-[#1e2a6f] px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:opacity-95"
        >
          <span className="text-lg leading-none">＋</span>
          <span>New chat</span>
        </button>
        <section className="sidebar-section">
          <div className="sidebar-section-header">Projects</div>
          <div className="flex flex-col gap-1.5">
            {sortedProjects.length === 0 && (
              <div className="rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/50">
                No projects yet.
              </div>
            )}

            {sortedProjects.map((p) => {
              const isSelectedProject = sidebarActiveProjectId === p.id;
              const isMenuOpen = rowMenu?.type === "project" && rowMenu.id === p.id;
              const projectChatList = projectSidebarChats.get(p.id) || [];
              const topChats = projectChatList.slice(0, MAX_PROJECT_CHAT_PREVIEW);
              const hasMoreChats = projectChatList.length > MAX_PROJECT_CHAT_PREVIEW;
              return (
                <div
                  key={p.id}
                  className="group relative rounded-2xl border border-white/5 bg-[oklch(16%_0.03_250)]/60 text-sm shadow-sm shadow-black/30"
                >
                  <div
                    className={`flex items-center rounded-2xl px-3 py-2 ${
                      isSelectedProject
                        ? "bg-white/10 text-white"
                        : "text-white/70"
                    }`}
                  >
                    <button
                      className="flex flex-1 items-center gap-3 truncate text-left"
                      onClick={() => handleProjectSelect(p.id)}
                    >
                      <span className="sidebar-item-icon text-[10px]">P</span>
                      <span className="sidebar-item-text">{p.name}</span>
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setMoveMenuConversationId(null);
                        setRowMenu((prev) =>
                          prev?.type === "project" && prev.id === p.id
                            ? null
                            : { type: "project", id: p.id }
                        );
                      }}
                      aria-label="Project actions"
                      className="ml-2 flex h-7 w-7 items-center justify-center rounded-full text-white/40 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                    >
                      ⋯
                    </button>
                  </div>
                  {isMenuOpen && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="absolute left-full top-2 z-30 ml-2 w-56 rounded-2xl border border-white/10 bg-[#0f111b] p-3 text-xs text-white shadow-2xl"
                    >
                      <div className="space-y-2 text-[13px]">
                        <button
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-white/80 transition hover:bg-white/5"
                          onClick={(event) => {
                            event.stopPropagation();
                            renameProject(p.id);
                            setRowMenu(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-red-300 transition hover:bg-red-500/10"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDeleteProject(p.id);
                            setRowMenu(null);
                          }}
                        >
                          Delete project
                        </button>
                        <div className="rounded-2xl bg-white/5 px-3 py-2 text-[12px] text-white/70">
                          <div className="text-[11px] uppercase tracking-wide text-white/60">
                            Recent chats
                          </div>
                          <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                            {sortedConversations
                              .filter((c) => c.project_id === p.id)
                              .map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    handleConversationSelect(c.id);
                                    setRowMenu(null);
                                    setSidebarOpen(false);
                                  }}
                                  className="truncate rounded-xl px-2 py-1 text-left text-[12px] text-white/80 transition hover:bg-white/10"
                                >
                                  {c.title || "Untitled chat"}
                                </button>
                              ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {isSelectedProject && topChats.length > 0 && (
                    <div className="ml-6 mt-2 space-y-1 border-l border-white/10 pl-3">
                      {topChats.map((chat) => {
                        const chatActive =
                          selectedConversationId === chat.id && viewMode === "chat";
                        return (
                          <button
                            key={chat.id}
                            className={`block w-full truncate rounded-xl px-2 py-1 text-left text-[12px] transition ${
                              chatActive
                                ? "bg-white/10 text-white"
                                : "text-white/60 hover:text-white"
                            }`}
                            onClick={() => handleConversationSelect(chat.id)}
                          >
                            {chat.title || "Untitled chat"}
                          </button>
                        );
                      })}
                      {hasMoreChats && (
                        <button
                          className="block w-full truncate rounded-xl px-2 py-1 text-left text-[12px] text-white/40 transition hover:text-white"
                          onClick={() => handleProjectSelect(p.id)}
                        >
                          Show more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="sidebar-section">
          <div className="sidebar-section-header">All chats</div>
          <div className="space-y-1.5">
            {unassignedChats.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-white/50">
                No unassigned chats yet.
              </div>
            )}

            {unassignedChats.map((c) => {
              const isActive = selectedConversationId === c.id && viewMode === "chat";
              const isMenuOpen = rowMenu?.type === "conversation" && rowMenu.id === c.id;
              const showMoveMenu = moveMenuConversationId === c.id;
              return (
                <div
                  key={c.id}
                  className={`group relative flex items-center rounded-2xl border border-white/5 px-3 text-sm shadow-sm transition ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "bg-[oklch(15%_0.03_250)]/80 text-white/70 hover:bg-white/5"
                  }`}
                >
                  <button
                    className="flex flex-1 items-center gap-3 truncate py-2 text-left"
                    onClick={() => handleConversationSelect(c.id)}
                  >
                    <span className="sidebar-item-icon text-[10px]">C</span>
                    <span className="sidebar-item-text">{c.title || "Untitled chat"}</span>
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setMoveMenuConversationId(null);
                      setRowMenu((prev) =>
                        prev?.type === "conversation" && prev.id === c.id
                          ? null
                          : { type: "conversation", id: c.id }
                      );
                    }}
                    aria-label="Conversation actions"
                    className="ml-2 flex h-7 w-7 items-center justify-center rounded-full text-white/40 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                  >
                    ⋯
                  </button>
                  {isMenuOpen && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="absolute right-full top-2 z-30 mr-2 w-60 rounded-2xl border border-white/10 bg-[#0f111b] p-3 text-xs text-white shadow-2xl"
                    >
                      <div className="space-y-2 text-[13px]">
                        <button
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-white/80 transition hover:bg-white/5"
                          onClick={(event) => {
                            event.stopPropagation();
                            renameConversation(c.id);
                            setRowMenu(null);
                          }}
                        >
                          Rename conversation
                        </button>
                        <button
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-white/80 transition hover:bg-white/5"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMoveMenuConversationId((prev) =>
                              prev === c.id ? null : c.id
                            );
                          }}
                          aria-expanded={showMoveMenu}
                        >
                          Move to project
                        </button>
                        {showMoveMenu && (
                          <div className="rounded-2xl bg-white/5 p-2 text-left text-[12px]">
                            <div className="mb-2 text-[11px] uppercase tracking-wide text-white/60">
                              Choose project
                            </div>
                            <div className="max-h-48 space-y-1 overflow-y-auto">
                              <button
                                onClick={() => handleMoveFromMenu(c.id, null)}
                                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-zinc-200 transition hover:bg-white/10"
                              >
                                No project
                              </button>
                              {sortedProjects.map((proj) => (
                                <button
                                  key={proj.id}
                                  onClick={() => handleMoveFromMenu(c.id, proj.id)}
                                  className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-zinc-200 transition hover:bg-white/10 ${
                                    proj.id === c.project_id
                                      ? "bg-white/10"
                                      : ""
                                  }`}
                                >
                                  {proj.name}
                                  {proj.id === c.project_id && (
                                    <span className="text-[10px] text-white/60">Current</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          requestDeleteConversation(c.id);
                          setRowMenu(null);
                          setMoveMenuConversationId(null);
                        }}
                        className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-red-300 transition hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <div className="sidebar-footer">
        <span>LLM Client · dev build</span>
        <span className="text-white/60">{projects.length} projects</span>
      </div>
    </>
  );

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="chat-layout text-white">
      <aside className="sidebar hidden md:flex">
        <SidebarSections />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex bg-black/60 backdrop-blur md:hidden">
          <div className="sidebar relative w-[280px]">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute right-3 top-3 rounded-full border border-white/20 px-2 py-1 text-xs text-white/70 hover:text-white"
            >
              Close
            </button>
            <SidebarSections />
          </div>
          <button
            className="flex-1"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      <div className="main-panel">
        <header className="main-header">
          <div className="main-title">
            <div className="flex items-center gap-2">
              <button
                className="rounded-full border border-white/20 px-3 py-1 text-sm text-white/70 hover:text-white md:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                ☰
              </button>
              <span className="main-title-label">LLM Client</span>
            </div>
            <div className="main-title-text">
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={headerModelMenuOpen}
                  aria-label="Choose model and speed"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHeaderModelMenuOpen((prev) => !prev);
                  }}
                  className={`group inline-flex items-baseline gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-lg font-semibold transition hover:border-white/40 hover:text-white ${
                    headerModelMenuOpen ? "text-white" : "text-white/90"
                  }`}
                >
                  <span>LLM Client</span>
                  <span className="text-white">{headerModelLabel}</span>
                  {headerSpeedDisplay && (
                    <span className="text-sm text-white/70">{headerSpeedDisplay}</span>
                  )}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className={`h-3 w-3 text-white/70 transition ${
                      headerModelMenuOpen ? "-rotate-180 text-white" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {headerModelMenuOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-full z-40 mt-3 min-w-[18rem] rounded-2xl border border-white/10 bg-[#111116] text-left text-xs text-white shadow-2xl"
                    style={{ width: "min(20rem, calc(100vw - 2rem))" }}
                  >
                    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 py-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {describeModelFamily("gpt-5.1")}
                        </div>
                        <div className="text-[11px] text-white/60">Speed controls</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        {SPEED_OPTIONS.map((option) => {
                          const isActive =
                            modelFamily === "gpt-5.1" &&
                            speedMode === option.value;
                          return (
                            <button
                              key={option.value}
                              onClick={() => {
                                setModelFamily("gpt-5.1");
                                setSpeedMode(option.value);
                                setHeaderModelMenuOpen(false);
                              }}
                              className={`flex items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                isActive
                                  ? "bg-white/10 text-white font-semibold"
                                  : "text-white/70 hover:bg-white/5"
                              }`}
                            >
                              <span className="flex flex-col">
                                <span className="text-sm">{option.label}</span>
                                <span className="text-[11px] text-white/60">
                                  {option.hint}
                                </span>
                              </span>
                              {isActive && (
                                <CheckmarkIcon className="h-3.5 w-3.5 text-white" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="pt-1">
                        <div className="text-sm font-semibold text-white">
                          Other Models
                        </div>
                        <div className="text-[11px] text-white/60">
                          Mini &amp; Nano presets
                        </div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setOtherModelsMenuOpen((prev) => !prev);
                          }}
                          className="mt-2 flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-left text-white/80 transition hover:text-white"
                          aria-expanded={otherModelsMenuOpen}
                        >
                          <span className="text-sm font-medium text-white">
                            Other Models
                          </span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className={`h-3.5 w-3.5 transition ${
                              otherModelsMenuOpen ? "rotate-180 text-white" : "text-white/60"
                            }`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                        {otherModelsMenuOpen && (
                          <div className="mt-3 rounded-2xl border border-white/10 bg-[#111116] text-left text-xs text-white shadow-2xl">
                            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-3 py-3">
                              {OTHER_MODEL_GROUPS.map((group) => (
                                <div key={group.family} className="space-y-1">
                                  <div className="text-xs uppercase tracking-wide text-white/60">
                                    {group.label}
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    {group.supportsSpeedModes === false ? (
                                      <button
                                        onClick={() => {
                                          setModelFamily(group.family);
                                          setHeaderModelMenuOpen(false);
                                        }}
                                        className={`flex items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                          modelFamily === group.family
                                            ? "bg-white/10 text-white font-semibold"
                                            : "text-white/70 hover:bg-white/5"
                                        }`}
                                      >
                                        <span>{group.label}</span>
                                        {modelFamily === group.family && (
                                          <CheckmarkIcon className="h-3.5 w-3.5 text-white" />
                                        )}
                                      </button>
                                    ) : (
                                      SPEED_OPTIONS.map((option) => {
                                        const isComboActive =
                                          modelFamily === group.family &&
                                          speedMode === option.value;
                                        return (
                                          <button
                                            key={`${group.family}-${option.value}`}
                                            onClick={() => {
                                              setModelFamily(group.family);
                                              setSpeedMode(option.value);
                                              setHeaderModelMenuOpen(false);
                                            }}
                                            className={`flex items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                                              isComboActive
                                                ? "bg-white/10 text-white font-semibold"
                                                : "text-white/70 hover:bg-white/5"
                                            }`}
                                          >
                                            <span>{`${group.shortLabel} ${option.label}`}</span>
                                            {isComboActive && (
                                              <CheckmarkIcon className="h-3.5 w-3.5 text-white" />
                                            )}
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="main-actions">
            <button onClick={() => handleNewChat(true)}>New chat</button>
            <button onClick={() => setShowProjectModal(true)}>New project</button>
          </div>
        </header>

        <main className="main-content">

        {/* PROJECT VIEW */}
        {inProjectView && currentProject ? (
          <div className="chat-window overflow-y-auto">
            <div className="mx-auto max-w-3xl">
              <h1 className="mb-4 text-lg font-semibold">
                {currentProject.name}
              </h1>

              <button
                onClick={() => handleNewChat(false)}
                className="mb-6 w-full rounded-2xl bg-[#181818] px-4 py-3 text-sm text-zinc-300 hover:bg-[#202123]"
              >
                ＋ New chat in {currentProject.name}
              </button>

              {projectChats.length === 0 && (
                <div className="text-sm text-zinc-500">
                  No chats in this project yet.
                </div>
              )}

              <div className="space-y-2">
                {projectChats.map((c) => (
                  <div
                    key={c.id}
                    className="space-y-2 rounded-xl bg-[#181818] px-4 py-3 text-sm hover:bg-[#202123]"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        className="flex-1 text-left"
                        onClick={() => {
                          handleConversationSelect(c.id);
                          setSidebarOpen(false);
                        }}
                      >
                        <div className="font-medium text-zinc-100">
                          {c.title || "Untitled chat"}
                        </div>
                      </button>

                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        requestDeleteConversation(c.id);
                      }}
                      aria-label="Delete chat"
                      className="rounded-md p-1 text-xs text-zinc-500 transition hover:text-red-400"
                    >
                      ×
                    </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                      <button
                        onClick={() => renameConversation(c.id)}
                        className="hover:text-zinc-200"
                      >
                        Rename
                      </button>

                      <span>·</span>

                      <select
                        className="rounded-md border border-[#3f3f46] bg-transparent px-1 py-0.5"
                        value={c.project_id || ""}
                        onChange={(e) =>
                          moveConversation(
                            c.id,
                            e.target.value === "" ? null : e.target.value
                          )
                        }
                      >
                        <option value="">No project</option>
                        {sortedProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <span>·</span>

                      <button
                        onClick={() => requestDeleteConversation(c.id)}
                        className="hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="h-10" />
            </div>
          </div>
        ) : (
          /* CHAT VIEW */
          <div className="chat-window">
            {/* Messages */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={chatContainerRef}
                className="chat-messages pb-24 pr-1"
              >
                <div
                  className="mx-auto flex w-full flex-col space-y-4 pb-6"
                  style={{ maxWidth: MAX_MESSAGE_WIDTH }}
                >
                  {isLoadingMessages && (
                    <div className="mb-2 text-center text-xs text-zinc-500">
                      Loading messages...
                    </div>
                  )}

                  {!isLoadingMessages && messages.length === 0 && (
                    <div className="mt-10 text-center text-sm text-zinc-400">
                      Start chatting — {describeModelFamily("gpt-5.1")} chat is
                      streaming live.
                    </div>
                  )}

                  {messages.map((m, i) => {
                    const messageId = m.id ?? `msg-${i}`;
                    const isAssistant = m.role === "assistant";
                    const rawCitations = m.metadata?.citations ?? [];
                    const displayableSources = rawCitations.filter(
                      (source) => Boolean(source?.url)
                    );
                    const usedWebSearchFlag = Boolean(
                      m.usedWebSearch || m.metadata?.usedWebSearch
                    );
                    const showSourcesButton =
                      isAssistant &&
                      (usedWebSearchFlag || displayableSources.length > 0);
                    const generatedImages = m.metadata?.generatedImages ?? [];
                    const isImageMessage =
                      m.metadata?.generationType === "image" &&
                      generatedImages.length > 0;
                    const imageModelLabel =
                      isImageMessage && typeof m.usedModel === "string"
                        ? IMAGE_MODEL_LABELS[
                            m.usedModel as ImageModelKey
                          ] || m.usedModel
                        : null;
                    const sourceChips = (m.metadata?.sources ?? []).filter(
                      (chip) => Boolean(chip?.url) && Boolean(chip?.domain)
                    );
                    const showSourceChips = sourceChips.length > 0;
                    const isStreamingAssistantMessage =
                      isAssistant &&
                      activeAssistantMessageId === messageId;
                    const thoughtLabel =
                      m.thoughtDurationLabel &&
                      m.thoughtDurationLabel.trim().length > 0
                        ? m.thoughtDurationLabel
                        : typeof m.thoughtDurationSeconds === "number"
                          ? formatThoughtDurationLabel(
                              m.thoughtDurationSeconds
                            )
                          : null;
                    const assistantWrapperClass =
                      "flex w-full max-w-[95%] flex-col md:max-w-[85%]";
                    const userWrapperClass =
                      "inline-flex max-w-[90%] flex-col md:max-w-[70%]";

                    return (
                      <div
                        key={messageId}
                        className={`flex ${
                          isAssistant ? "justify-start" : "justify-end"
                        }`}
                      >
                        {isAssistant ? (
                          <div
                            className={`${assistantWrapperClass} px-1 py-1 text-left text-[15px] leading-relaxed text-zinc-100 md:px-2`}
                          >
                            {thoughtLabel && (
                              <div className="mb-2">
                                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#15151a]/80 px-3 py-1 text-xs text-zinc-300">
                                  <span
                                    className="h-2 w-2 rounded-full bg-zinc-500"
                                    aria-hidden
                                  />
                                  <span>{thoughtLabel}</span>
                                </div>
                              </div>
                            )}
                            <div className="space-y-3 text-[15px] leading-relaxed">
                              <div className="prose prose-invert max-w-none text-sm">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkBreaks]}
                                  rehypePlugins={[rehypeRaw]}
                                  components={markdownComponents}
                                >
                                  {m.content}
                                </ReactMarkdown>
                              </div>
                            </div>

                            {isImageMessage ? (
                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                {generatedImages.map((image) => (
                                  <div
                                    key={`${messageId}-generated-${image.id}`}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-black/30"
                                  >
                                    <Image
                                      src={image.dataUrl}
                                      alt={
                                        image.prompt
                                          ? `Generated: ${image.prompt}`
                                          : "Generated image"
                                      }
                                      width={512}
                                      height={512}
                                      className="h-auto w-full object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {m.attachments?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {m.attachments.map((attachment) => (
                                  <div
                                    key={`${messageId}-assistant-attachment-${attachment.id}`}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                                  >
                                    <Image
                                      src={attachment.dataUrl}
                                      alt={attachment.name || "Attachment"}
                                      width={96}
                                      height={96}
                                      className="h-24 w-24 object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {showSourceChips && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {sourceChips.map((chip) => (
                                  <a
                                    key={`${messageId}-source-${chip.id}-${chip.domain}`}
                                    href={chip.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="rounded-full border border-[#2f2f36] bg-[#141417] px-3 py-1 text-[12px] text-[#bac4ff] transition hover:border-[#5c5cf5]"
                                    title={chip.title}
                                  >
                                    {chip.domain}
                                  </a>
                                ))}
                              </div>
                            )}

                            {!isStreamingAssistantMessage && (
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCopyMessage(m, messageId);
                                  }}
                                  className="rounded-full border border-[#3a3a3f] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]"
                                >
                                  {copiedMessageId === messageId ? "Copied" : "Copy"}
                                </button>

                                {showSourcesButton && (
                                  <>
                                    <span
                                      className="h-4 w-px bg-[#38383d]"
                                      aria-hidden
                                    />
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setExpandedSourcesId((prev) =>
                                          prev === messageId ? null : messageId
                                        );
                                      }}
                                      className="rounded-full border border-[#35353a] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]"
                                      aria-expanded={
                                        expandedSourcesId === messageId
                                      }
                                    >
                                      {expandedSourcesId === messageId
                                        ? "Hide sources"
                                        : "Sources"}
                                    </button>
                                  </>
                                )}

                                {m.usedModel && (
                                  <>
                                    <span
                                      className="h-4 w-px bg-[#38383d]"
                                      aria-hidden
                                    />
                                    <div className="relative">
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setOpenModelMenuId((prev) =>
                                            prev === messageId ? null : messageId
                                          );
                                        }}
                                        className="rounded-full border border-[#3a3a40] px-3 py-1 text-[11px] text-zinc-200 hover:border-[#5c5cf5]"
                                      >
                                        {imageModelLabel
                                          ? imageModelLabel
                                          : m.usedModelFamily
                                            ? describeModelFamily(
                                                m.usedModelFamily
                                              )
                                            : m.usedModel}
                                      </button>

                                      {openModelMenuId === messageId && (
                                        <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-[#2d2d33] bg-[#101014] p-2 text-left text-xs shadow-2xl">
                                          {(isImageMessage
                                            ? IMAGE_MODEL_OPTIONS
                                            : MODEL_RETRY_OPTIONS
                                          ).map((option) => {
                                            if (isImageMessage) {
                                              const imageOption =
                                                option as (typeof IMAGE_MODEL_OPTIONS)[number];
                                              const isCurrentImage =
                                                m.usedModel === imageOption.value;
                                              return (
                                                <button
                                                  key={imageOption.value}
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleRetryWithImageModel(
                                                      imageOption.value,
                                                      m
                                                    );
                                                  }}
                                                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                                                >
                                                  <span>
                                                    Retry with {imageOption.label}
                                                  </span>
                                                  {isCurrentImage && (
                                                    <span className="text-[10px] text-zinc-500">
                                                      current
                                                    </span>
                                                  )}
                                                </button>
                                              );
                                            }
                                            const typedOption = option as (typeof MODEL_RETRY_OPTIONS)[number];
                                            const legacyMode =
                                              typedOption.value === "gpt-5-nano"
                                                ? "nano"
                                                : typedOption.value === "gpt-5-mini"
                                                  ? "mini"
                                                  : "full";
                                            const isCurrent =
                                              m.usedModelFamily === typedOption.value ||
                                              (!m.usedModelFamily &&
                                                m.usedModelMode === legacyMode);
                                            return (
                                              <button
                                                key={typedOption.value}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  handleRetryWithModel(
                                                    typedOption.value,
                                                    m
                                                  );
                                                }}
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                                              >
                                                <span>
                                                  Retry with {typedOption.label}
                                                </span>
                                                {isCurrent && (
                                                  <span className="text-[10px] text-zinc-500">
                                                    current
                                                  </span>
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}

                                {showSourcesButton &&
                                  expandedSourcesId === messageId && (
                                    <div className="mt-3 rounded-2xl border border-[#2f2f36] bg-[#141417] p-3 text-[13px] text-zinc-200">
                                      {displayableSources.length > 0 ? (
                                        <div className="space-y-2">
                                          {displayableSources.map((source, idx) => {
                                            const domain =
                                              source.domain ||
                                              extractDomainFromUrl(source.url);
                                            const title =
                                              (source.title || domain || source.url)?.trim() ||
                                              source.url;
                                            return (
                                              <a
                                                key={`${source.url}-${idx}`}
                                                href={source.url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className="block rounded-xl border border-[#2f2f36] bg-[#1b1b20] p-3 transition hover:border-[#5c5cf5]"
                                              >
                                                <div className="text-[13px] font-semibold text-white">
                                                  {title}
                                                </div>
                                                {domain && (
                                                  <div className="text-[11px] text-zinc-500">
                                                    {domain}
                                                  </div>
                                                )}
                                              </a>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[12px] text-zinc-400">
                                          {isStreamingAssistantMessage
                                            ? "Gathering live citations…"
                                            : "No citations were shared for this response."}
                                        </p>
                                      )}
                                    </div>
                                  )}
                          </div>
                        ) : (
                          <div
                            className={`relative ${userWrapperClass} rounded-3xl bg-[#1e4fd8] px-5 py-4 text-left text-[15px] leading-relaxed text-white`}
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {m.content && m.content.trim().length > 0 ? (
                                m.content
                              ) : m.attachments?.length ? (
                                <span className="italic text-white/80">
                                  Sent {m.attachments.length > 1
                                    ? `${m.attachments.length} images`
                                    : "an image"}
                                </span>
                              ) : null}
                            </div>
                            {m.attachments?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {m.attachments.map((attachment) => (
                                  <div
                                    key={`${m.id}-attachment-${attachment.id}`}
                                    className="overflow-hidden rounded-2xl border border-white/10 bg-white/10"
                                  >
                                    <Image
                                      src={attachment.dataUrl}
                                      alt={attachment.name || "Chat attachment"}
                                      width={96}
                                      height={96}
                                      className="h-24 w-24 object-cover"
                                      unoptimized
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {m.files?.length ? (
                              <div className="mt-3 space-y-2">
                                {m.files.map((file) => {
                                  const sizeLabel = formatAttachmentSize(file.size);
                                  return (
                                    <div
                                      key={`${m.id}-file-${file.id}`}
                                      className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[12px]"
                                    >
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70">
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 24 24"
                                          className="h-4 w-4"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth={1.6}
                                        >
                                          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                                          <path d="M14 3v6h6" />
                                        </svg>
                                      </div>
                                      <div className="min-w-0 flex-1 text-left">
                                        <div className="truncate text-white">
                                          {file.name || "File"}
                                        </div>
                                        {sizeLabel && (
                                          <div className="text-[10px] uppercase tracking-wide text-white/50">
                                            {sizeLabel}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(searchIndicator || thinkingStatus || fileReadingIndicator) && (
                    <div
                      className="mx-auto mt-2 flex flex-col items-center gap-2"
                      style={{ maxWidth: MAX_MESSAGE_WIDTH }}
                    >
                      {fileReadingIndicator && (
                        <StatusBubble
                          label="Reading documents"
                          variant={
                            fileReadingIndicator === "error"
                              ? "error"
                              : "reading"
                          }
                        />
                      )}
                      {searchIndicator && (
                        <StatusBubble
                          label={searchIndicator.message}
                          variant={
                            searchIndicator.variant === "error"
                              ? "error"
                              : "search"
                          }
                          subtext={
                            searchIndicator.siteLabel
                              ? `Searched ${searchIndicator.siteLabel}`
                              : undefined
                          }
                        />
                      )}
                      {thinkingStatus && (
                        <StatusBubble
                          label={thinkingStatus.label}
                          variant={
                            thinkingStatus.variant === "extended"
                              ? "extended"
                              : "default"
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {showScrollButton && messages.length > 0 && (
                <button
                  onClick={handleJumpToBottom}
                  className="pointer-events-auto absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/15 bg-[#1b1b25]/90 p-3 text-white shadow-xl transition hover:bg-[#242433] sm:bottom-6"
                  aria-label="Jump to latest message"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Input */}
            <div className="input-area">
              {(forceWebSearch || createImageArmed) && (
                <div className="input-chips text-[11px]">
                  {forceWebSearch && (
                    <button
                      type="button"
                      onClick={() => setForceWebSearch(false)}
                      className="flex items-center gap-1 rounded-full border border-[#4b64ff]/50 bg-[#1a1e2f] px-3 py-1 text-[#a5bfff]"
                    >
                      <span className="text-base leading-none">🌐</span>
                      <span>Web search</span>
                    </button>
                  )}
                  {createImageArmed && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreateImageArmed(false);
                        setComposerError(null);
                      }}
                      className="flex items-center gap-1 rounded-full border border-white/30 bg-[#2b2b31] px-3 py-1 text-zinc-200"
                    >
                      <span className="text-base leading-none">🎨</span>
                      <span>Create image</span>
                    </button>
                  )}
                </div>
              )}

              {(imageAttachments.length > 0 || fileAttachments.length > 0) && (
                <div className="input-attachments">
                  {imageAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {imageAttachments.map((attachment) => {
                        const sizeLabel = formatAttachmentSize(attachment.size);
                        return (
                          <div
                            key={`${attachment.id}-preview`}
                            className="group flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-1"
                          >
                            <div className="h-12 w-12 overflow-hidden rounded-xl bg-black/20">
                              <Image
                                src={attachment.dataUrl}
                                alt={attachment.name || "Attachment"}
                                width={48}
                                height={48}
                                className="h-full w-full object-cover"
                                unoptimized
                              />
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate text-[12px] font-medium text-white">
                                {attachment.name || "Image"}
                              </div>
                              {sizeLabel && (
                                <div className="text-[10px] uppercase tracking-wide text-white/50">
                                  {sizeLabel}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              aria-label="Remove attachment"
                              onClick={() => handleRemoveImageAttachment(attachment.id)}
                              className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {fileAttachments.length > 0 && (
                    <div className="space-y-2">
                      {fileAttachments.map((file) => {
                        const sizeLabel = formatAttachmentSize(file.size);
                        return (
                          <div
                            key={`${file.id}-file`}
                            className="group flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                          >
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1b1b21] text-white/70">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.6}
                              >
                                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                                <path d="M14 3v6h6" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate text-white">
                                {file.name || "File"}
                              </div>
                              {sizeLabel && (
                                <div className="text-[10px] uppercase tracking-wide text-white/50">
                                  {sizeLabel}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              aria-label="Remove file attachment"
                              onClick={() => handleRemoveFileAttachment(file.id)}
                              className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="input-container">
                <div className={`input-row ${composerShapeClass} bg-white/5`}>
                  <div className="input-left">
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={
                          isRecording
                            ? "Stop recording"
                            : isTranscribing
                              ? "Cancel transcription"
                              : "Composer options"
                        }
                        aria-expanded={!isVoiceFlowActive ? composerMenuOpen : undefined}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isRecording) {
                            void handleMicClick();
                            return;
                          }
                          if (isTranscribing) {
                            cancelRecordingFlow();
                            return;
                          }
                          setComposerMenuOpen((prev) => !prev);
                        }}
                        className={`input-icon-button ${
                          isVoiceFlowActive
                            ? "bg-red-500/20 text-red-200"
                            : "text-white/80 hover:bg-white/10"
                        }`}
                      >
                        {isVoiceFlowActive ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                          >
                            <path d="M6 6l12 12M6 18 18 6" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                          >
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        )}
                      </button>
                      {!isVoiceFlowActive && composerMenuOpen && (
                        <div
                          onClick={(event) => event.stopPropagation()}
                          className="absolute left-0 bottom-full z-30 mb-3 w-64 rounded-2xl border border-white/10 bg-[#0f111b] p-3 text-left text-xs text-white shadow-2xl"
                        >
                          <div className="flex flex-col text-[13px] text-white/80">
                            <button
                              type="button"
                              onClick={() => {
                                setForceWebSearch((prev) => !prev);
                                setComposerMenuOpen(false);
                              }}
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:text-white"
                            >
                              <span>Web search</span>
                              {forceWebSearch && (
                                <span className="text-[#8ab4ff]">On</span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCreateImageArmed((prev) => !prev);
                                setComposerMenuOpen(false);
                                if (composerError) {
                                  setComposerError(null);
                                }
                              }}
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:text-white"
                            >
                              <span>Create image</span>
                              {createImageArmed && (
                                <span className="text-[#8ab4ff]">Armed</span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setComposerMenuOpen(false);
                                filePickerInputRef.current?.click();
                              }}
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:text-white"
                            >
                              <span>Upload file</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setComposerMenuOpen(false);
                                photoInputRef.current?.click();
                              }}
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:text-white"
                            >
                              <span>Attach photo</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setComposerMenuOpen(false)}
                              className="flex w-full items-center rounded-xl px-3 py-2 text-left transition hover:text-white"
                            >
                              Agent mode
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="input-middle">
                    {!isVoiceFlowActive && (
                      <textarea
                        ref={textareaRef}
                        className="input-field placeholder:text-white/50"
                        style={{ maxHeight: MAX_INPUT_HEIGHT }}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message the assistant"
                        rows={1}
                      />
                    )}
                    {isVoiceFlowActive ? (
                      isRecording ? (
                        <div className="flex h-10 w-full items-center" aria-live="polite">
                          <svg
                            viewBox="0 0 100 24"
                            className="h-8 w-full text-red-400/80"
                            preserveAspectRatio="none"
                          >
                            <defs>
                              <linearGradient id="composerWaveformGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="rgba(248,113,113,0.45)" />
                                <stop offset="100%" stopColor="rgba(248,113,113,0.9)" />
                              </linearGradient>
                            </defs>
                            <path d={buildWaveformPath(waveformLevels)} fill="url(#composerWaveformGradient)" />
                            <line
                              x1="0"
                              y1="12"
                              x2="100"
                              y2="12"
                              stroke="rgba(255,255,255,0.08)"
                              strokeWidth="0.5"
                            />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-10 w-full items-center justify-center text-sm text-zinc-400">
                          Transcribing…
                        </div>
                      )
                    ) : null}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={handlePhotoInputChange}
                    />
                    <input
                      ref={filePickerInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.tsv,.json,.md,.rtf,.html,.zip,.log"
                      multiple
                      className="sr-only"
                      onChange={handleFilePickerChange}
                    />
                  </div>

                  <div className="input-actions">
                    {!isVoiceFlowActive && (
                      <button
                        type="button"
                        aria-label={isRecording ? "Stop recording" : "Start voice input"}
                        onClick={handleMicClick}
                        disabled={isTranscribing}
                        className={`input-icon-button ${
                          isTranscribing ? "cursor-wait opacity-60" : "hover:bg-white/10"
                        }`}
                      >
                        {isTranscribing ? (
                          <span className="inline-flex h-4 w-4 items-center justify-center">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
                          </span>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 4a2.5 2.5 0 0 0-2.5 2.5v5A2.5 2.5 0 0 0 12 14.5a2.5 2.5 0 0 0 2.5-2.5v-5A2.5 2.5 0 0 0 12 4Z" />
                            <path d="M19 11.5a7 7 0 0 1-14 0" />
                            <path d="M12 18.5v2" />
                          </svg>
                        )}
                      </button>
                    )}
                    {shouldShowSendButton && (
                      <button
                        type="button"
                        onClick={handlePrimaryAction}
                        disabled={sendButtonDisabled}
                        className={`input-icon-button primary ${
                          sendButtonDisabled ? "cursor-not-allowed opacity-40" : ""
                        } ${isStreaming ? "hover:from-[#4f6ee0]" : "hover:from-[#7a96ff]"}`}
                        aria-label={sendButtonAriaLabel}
                      >
                        {isStreaming ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="currentColor"
                          >
                            <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 18V6" />
                            <path d="M6 12l6-6 6 6" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="input-bottom">
                  <div className="input-mode-pill">
                    <span
                      className="inline-block h-2 w-2 rounded-full bg-gradient-to-br from-[#7e8bff] to-[#4c5ed9]"
                    />
                    <span>
                      {createImageArmed
                        ? "Image generation armed"
                        : `Reasoning · ${SPEED_LABELS[speedMode]}`}
                    </span>
                  </div>
                  <div className="input-shortcuts">
                    <div className="input-shortcut">
                      <span>Press</span>
                      <span className="input-shortcut-kbd">Enter</span>
                      <span>to send</span>
                    </div>
                    <div className="input-shortcut">
                      <span>Shift</span>
                      <span className="input-shortcut-kbd">↵</span>
                      <span>for newline</span>
                    </div>
                  </div>
                </div>
              </div>

              {composerError && (
                <div className="mt-2 text-xs text-red-400">{composerError}</div>
              )}
            </div>

          </div>
        )}
        </main>
      </div>

      {/* PROJECT MODAL */}
      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[#3f3f46] bg-[#181818] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">New project</h2>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-lg text-zinc-400 hover:text-zinc-200"
              >
                ×
              </button>
            </div>

            <input
              className="w-full rounded-md border border-[#3f3f46] bg-[#303030] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowProjectModal(false)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#26272b]"
              >
                Cancel
              </button>

              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="rounded-md bg-[#1e4fd8] px-3 py-1.5 text-xs text-white hover:bg-[#2658e4] disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteConversation)}
        title="Delete chat?"
        body={
          <span>
            This will delete &ldquo;
            {pendingDeleteConversation?.title || "this chat"}
            &rdquo;.
          </span>
        }
        confirmLoading={deleteConversationLoading}
        onCancel={() => {
          if (!deleteConversationLoading) {
            setPendingDeleteConversation(null);
          }
        }}
        onConfirm={() => {
          if (!deleteConversationLoading) {
            void confirmDeleteConversation();
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteProject)}
        title="Delete this project?"
        body={
          <span>
            This will delete &ldquo;
            {pendingDeleteProject?.name || "this project"}
            &rdquo; and all of its conversations.
          </span>
        }
        confirmLabel="Delete project"
        confirmLoading={deleteProjectLoading}
        onCancel={() => {
          if (!deleteProjectLoading) {
            setPendingDeleteProject(null);
          }
        }}
        onConfirm={() => {
          if (!deleteProjectLoading) {
            void confirmDeleteProject();
          }
        }}
      />
    </div>
  );
}
