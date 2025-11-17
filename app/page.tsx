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
import type { ImageAttachment, Source, SourceChip } from "@/lib/chatTypes";
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
  sourceList?: Source[];
  attachments?: ImageAttachment[];
};

type ChatMessage = {
  id?: string;
  persistedId?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
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
  { value: "gpt-5-pro-2025-10-06", label: "GPT 5 Pro (2025-10-06)" },
];

const OTHER_MODEL_GROUPS: Array<{
  family: Exclude<ModelFamily, "auto" | "gpt-5.1">;
  label: string;
  shortLabel: string;
}> = [
  {
    family: "gpt-5-mini",
    label: "GPT 5 Mini",
    shortLabel: describeModelFamily("gpt-5-mini"),
  },
  {
    family: "gpt-5-nano",
    label: "GPT 5 Nano",
    shortLabel: describeModelFamily("gpt-5-nano"),
  },
  {
    family: "gpt-5-pro-2025-10-06",
    label: "GPT 5 Pro (2025-10-06)",
    shortLabel: describeModelFamily("gpt-5-pro-2025-10-06"),
  },
];

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

const MAX_INPUT_HEIGHT = 176;
const MIN_INPUT_HEIGHT = 32;
const MAX_MESSAGE_WIDTH = 900;
const AUTO_SCROLL_THRESHOLD_PX = 140;
const MAX_PROJECT_CHAT_PREVIEW = 5;

type ServerStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string };

type StatusVariant = "default" | "extended" | "search" | "error";

type ThinkingStatus =
  | { variant: "thinking"; label: string }
  | { variant: "extended"; label: string };

function StatusBubble({
  label,
  variant = "default",
}: {
  label: string;
  variant?: StatusVariant;
}) {
  const baseClassMap: Record<StatusVariant, string> = {
    default: "border-white/5 bg-[#1b1b20]/90 text-zinc-400",
    extended: "border-[#4b64ff]/30 bg-[#1a1c2b]/80 text-[#b7c6ff]",
    search: "border-[#4b64ff]/30 bg-[#152033]/80 text-[#9bb8ff]",
    error: "border-red-500/40 bg-[#30161a]/85 text-red-200",
  };

  const dotMap: Record<StatusVariant, string> = {
    default: "bg-zinc-500",
    extended: "bg-[#8ab4ff]",
    search: "bg-[#8ab4ff]",
    error: "bg-red-400",
  };

  const pulseClass = "animate-pulse";

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${baseClassMap[variant]}`}
      aria-live="polite"
    >
      <span
        className={`h-2 w-2 rounded-full ${dotMap[variant]} ${pulseClass}`}
        aria-hidden
      />
      <span>{label}</span>
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
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>(
    []
  );
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
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
    { message: string; variant: "running" | "error" } | null
  >(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);

  useEffect(() => {
    if (!headerModelMenuOpen) {
      setOtherModelsMenuOpen(false);
    }
  }, [headerModelMenuOpen]);

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

      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at, metadata")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (!opts.force && selectedConversationId !== conversationId) {
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (!opts.force && skipAutoLoadRef.current === conversationId) {
        skipAutoLoadRef.current = null;
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (error) {
        console.error("Load messages error", error);
        if (!(conversationHistoryRef.current.get(conversationId)?.length ?? 0)) {
          setMessages([]);
        }
      } else {
        console.log(
          `[historyDebug] loaded ${data?.length ?? 0} messages for conversationId=${conversationId}`
        );
        const nextMessages = (data || []).map((m) => {
          const metadata =
            ((m as { metadata?: MessageMetadata }).metadata || {}) as MessageMetadata;
          const attachments = Array.isArray(metadata.attachments)
            ? metadata.attachments
            : [];
          const thoughtSeconds = metadata.thoughtDurationSeconds;
          const thoughtLabel =
            metadata.thoughtDurationLabel && metadata.thoughtDurationLabel.trim().length > 0
              ? metadata.thoughtDurationLabel
              : typeof thoughtSeconds === "number"
                ? formatThoughtDurationLabel(thoughtSeconds)
                : undefined;
          return {
            id: (m as { id?: string }).id,
            persistedId: (m as { id?: string }).id,
            role: m.role,
            content: m.content,
            attachments,
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
  const canSendMessage =
    trimmedInput.length > 0 || imageAttachments.length > 0;
  const headerModelLabel =
    modelFamily === "auto"
      ? `Auto (${describeModelFamily("gpt-5-mini")})`
      : describeModelFamily(modelFamily);
  const attachmentsLimitReached =
    imageAttachments.length >= MAX_IMAGE_ATTACHMENTS;
  const isVoiceFlowActive = isRecording || isTranscribing;

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

  const handleImageInputChange = async (
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

  const handleRemoveAttachment = (id: string) => {
    setImageAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    setComposerError(null);
  };

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
    []
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
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("startRecording error", error);
      setComposerError("Microphone permission was denied.");
    }
  }, []);

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

  const handleImageButtonClick = () => {
    if (attachmentsLimitReached) {
      setComposerError(
        `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`
      );
      return;
    }
    fileInputRef.current?.click();
  };

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

type SendMessageOptions = {
  messageOverride?: string;
  attachmentsOverride?: ImageAttachment[];
  modelOverride?: ModelFamily;
  speedOverride?: SpeedMode;
  retry?: RetryOptions;
};

  // ------------------------------------------------------------
  // SEND MESSAGE — STREAMING
  // ------------------------------------------------------------
  async function sendMessage(options?: SendMessageOptions) {
    if (isStreaming) return;
    const sourceText = options?.messageOverride ?? input;
    const activeAttachments =
      options?.attachmentsOverride ?? imageAttachments;
    const text = sourceText.trim();
    const hasAttachments = activeAttachments.length > 0;
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
    const previewPrompt = text || (hasAttachments ? "[image attachments]" : text);
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
    }
    setComposerError(null);
    setIsStreaming(true);
    setComposerMenuOpen(false);
    setRowMenu(null);
    setMoveMenuConversationId(null);
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
    setSearchIndicator(null);
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

    if (!isRetry) {
      const newUserMessageId = createLocalId();
      userMessageId = newUserMessageId;
      const activeAssistantId = assistantMessageId!;
      setMessages((prev) => [
        ...prev,
        {
          id: newUserMessageId,
          role: "user",
          content: text,
          attachments: attachmentCopies,
          metadata: attachmentCopies.length
            ? { attachments: attachmentCopies }
            : undefined,
        },
        {
          id: activeAssistantId,
          role: "assistant",
          content: "",
          metadata: {
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
                        sourceList:
                          meta.sourceList ?? msg.metadata?.sourceList ?? [],
                        thoughtDurationSeconds: msg.thoughtDurationSeconds,
                        thoughtDurationLabel: msg.thoughtDurationLabel,
                      };
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
                    });
                  } else if (status.type === "search-complete") {
                    // keep indicator visible until first token arrives
                  } else if (status.type === "search-error") {
                    setSearchIndicator({
                      message:
                        status.message || "Web search failed. Using prior data.",
                      variant: "error",
                    });
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
                        sourceList: sourcesEvent.sources ?? [],
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
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleRetryWithModel(
    targetFamily: Exclude<ModelFamily, "auto">,
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
    setModelFamily(targetFamily);
    setOpenModelMenuId(null);
    setExpandedSourcesId((prev) =>
      prev === targetMessage.id ? null : prev
    );
    await sendMessage({
      messageOverride: relatedUserMessage.content,
      attachmentsOverride: relatedUserMessage.attachments ?? [],
      modelOverride: targetFamily,
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
      <div className="px-3 py-3">
        <button
          onClick={() => handleNewChat(true)}
          className="flex w-full items-center gap-2 rounded-md bg-[#202123] px-3 py-2 text-sm text-zinc-100 hover:bg-[#26272b]"
        >
          <span className="text-lg leading-none">＋</span>
          <span>New chat</span>
        </button>
      </div>

      {/* Projects */}
      <div className="mt-1 flex items-center justify-between px-3 text-[11px] font-semibold uppercase text-zinc-500">
        <span>Projects</span>
        <button
          onClick={() => setShowProjectModal(true)}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          + New
        </button>
      </div>

      <div className="mt-1 flex flex-col gap-1 px-2">
        {sortedProjects.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-zinc-500">No projects yet.</div>
        )}

        {sortedProjects.map((p) => {
          const isSelectedProject = sidebarActiveProjectId === p.id;
          const isMenuOpen = rowMenu?.type === "project" && rowMenu.id === p.id;
          const projectChatList = projectSidebarChats.get(p.id) || [];
          const topChats = projectChatList.slice(0, MAX_PROJECT_CHAT_PREVIEW);
          const hasMoreChats = projectChatList.length > MAX_PROJECT_CHAT_PREVIEW;
          return (
            <div key={p.id} className="group relative">
              <div
                className={`flex items-center rounded-md ${
                  isSelectedProject
                    ? "bg-[#202123] text-zinc-100"
                    : "text-zinc-300 hover:bg-[#202123]"
                }`}
              >
                <button
                  className="flex-1 truncate px-3 py-2 text-left text-sm"
                  onClick={() => handleProjectSelect(p.id)}
                >
                  {p.name}
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
                  className="mr-2 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
                >
                  ⋯
                </button>

                {isMenuOpen && (
                  <div
                    onClick={(event) => event.stopPropagation()}
                    className="absolute right-0 top-full z-30 mt-2 w-40 rounded-2xl border border-[#2a2a30] bg-[#101014] p-1 text-left text-xs shadow-2xl"
                  >
                    <button
                      onClick={() => {
                        renameProject(p.id);
                        setRowMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1d1d24]"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        requestDeleteProject(p.id);
                        setRowMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-red-400 hover:bg-[#1d1d24]"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {isSelectedProject && topChats.length > 0 && (
                <div className="ml-6 mt-1 space-y-1 border-l border-[#2a2a30] pl-3">
                  {topChats.map((chat) => {
                    const chatActive =
                      selectedConversationId === chat.id && viewMode === "chat";
                    return (
                      <button
                        key={chat.id}
                        className={`block w-full truncate rounded-md px-2 py-1 text-left text-[12px] ${
                          chatActive
                            ? "bg-[#202123] text-white"
                            : "text-zinc-400 hover:text-white"
                        }`}
                        onClick={() => handleConversationSelect(chat.id)}
                      >
                        {chat.title || "Untitled chat"}
                      </button>
                    );
                  })}
                  {hasMoreChats && (
                    <button
                      className="block w-full truncate rounded-md px-2 py-1 text-left text-[12px] text-zinc-500 hover:text-white"
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

      {/* All chats */}
      <div className="mt-4 px-3 text-[11px] font-semibold uppercase text-zinc-500">
        All chats
      </div>

      <div className="mt-1 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {unassignedChats.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-zinc-500">
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
              className={`group relative flex items-center rounded-md px-2 text-sm ${
                isActive
                  ? "bg-[#202123] text-zinc-100"
                  : "text-zinc-300 hover:bg-[#202123]"
              }`}
            >
              <button
                className="flex-1 truncate px-1 py-2 text-left"
                onClick={() => handleConversationSelect(c.id)}
              >
                {c.title || "Untitled chat"}
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
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
              >
                ⋯
              </button>

              {isMenuOpen && (
                <div
                  onClick={(event) => event.stopPropagation()}
                  className="absolute right-0 top-full z-30 mt-2 w-48 rounded-2xl border border-[#2a2a30] bg-[#101014] p-2 text-left text-xs shadow-2xl"
                >
                  <button
                    onClick={() => {
                      renameConversation(c.id);
                      setRowMenu(null);
                      setMoveMenuConversationId(null);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                  >
                    Rename
                  </button>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setMoveMenuConversationId((prev) =>
                          prev === c.id ? null : c.id
                        )
                      }
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                      aria-expanded={showMoveMenu}
                    >
                      Move to project
                      <span className="text-[10px] text-zinc-500">
                        {showMoveMenu ? "▲" : "▼"}
                      </span>
                    </button>
                    {showMoveMenu && (
                      <div className="mt-2 space-y-1 rounded-xl border border-[#2a2a30] bg-[#0f0f14] p-1">
                        <button
                          onClick={() => handleMoveFromMenu(c.id, null)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                        >
                          No project
                        </button>
                        <div className="max-h-48 overflow-y-auto">
                          {sortedProjects.map((proj) => (
                            <button
                              key={proj.id}
                              onClick={() => handleMoveFromMenu(c.id, proj.id)}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21] ${
                                proj.id === c.project_id
                                  ? "bg-[#1b1b21]"
                                  : ""
                              }`}
                            >
                              {proj.name}
                              {proj.id === c.project_id && (
                                <span className="text-[10px] text-zinc-500">Current</span>
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
                    className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-red-400 hover:bg-[#1b1b21]"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#202123] px-3 py-3 text-xs text-zinc-500">
        LLM Client · dev build
      </div>
    </>
  );

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="flex h-screen min-h-0 bg-[#212121] text-zinc-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 min-h-0 flex-col border-r border-[#202123] bg-[#181818] md:flex">
        <SidebarSections />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex w-64 flex-col border-r border-[#202123] bg-[#181818]">
            <div className="flex items-center justify-between border-b border-[#202123] px-3 py-3">
              <span className="text-sm font-semibold">Menu</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-sm text-zinc-400 hover:text-zinc-200"
              >
                Close
              </button>
            </div>
            <SidebarSections />
          </div>
          <button
            className="flex-1 bg-black/40"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex flex-1 min-h-0 flex-col bg-[#212121]">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-[#2a2a2a] bg-transparent px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-[#2f2f32] px-2 py-1 text-sm text-zinc-300 hover:bg-[#2a2a2e] md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-white">
                LLM Client
              </span>
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={headerModelMenuOpen}
                  aria-label="Choose model and speed"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHeaderModelMenuOpen((prev) => !prev);
                  }}
                  className={`flex items-center gap-3 rounded-full border border-white/15 px-3 py-1.5 text-left text-white/80 transition hover:border-white/30 hover:text-white ${
                    headerModelMenuOpen ? "bg-white/5" : ""
                  }`}
                >
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm font-semibold text-white">
                      {headerModelLabel}
                    </span>
                    <span className="text-[11px] text-white/60">
                      {SPEED_LABELS[speedMode]}
                    </span>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className={`h-3 w-3 transition ${
                      headerModelMenuOpen ? "-rotate-180" : ""
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
                                    {SPEED_OPTIONS.map((option) => {
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
                                    })}
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
        </header>

        {/* PROJECT VIEW */}
        {inProjectView && currentProject ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
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
          <>
            {/* Messages */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={chatContainerRef}
                className="flex h-full flex-col overflow-y-auto overflow-x-hidden px-4 py-6 pb-32"
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
                    const rawSourceList = m.metadata?.sourceList ?? [];
                    const displayableSources = rawSourceList.filter(
                      (source) => Boolean(source?.url)
                    );
                    const usedWebSearchFlag = Boolean(
                      m.usedWebSearch || m.metadata?.usedWebSearch
                    );
                    const showSourcesButton =
                      isAssistant &&
                      (usedWebSearchFlag || rawSourceList.length > 0);
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
                                        {m.usedModelFamily
                                          ? describeModelFamily(m.usedModelFamily)
                                          : m.usedModel}
                                      </button>

                                      {openModelMenuId === messageId && (
                                        <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-[#2d2d33] bg-[#101014] p-2 text-left text-xs shadow-2xl">
                                          {MODEL_RETRY_OPTIONS.map((option) => {
                                            const legacyMode =
                                              option.value === "gpt-5-nano"
                                                ? "nano"
                                                : option.value === "gpt-5-mini"
                                                  ? "mini"
                                                  : "full";
                                            const isCurrent =
                                              m.usedModelFamily === option.value ||
                                              (!m.usedModelFamily &&
                                                m.usedModelMode === legacyMode);
                                            return (
                                              <button
                                                key={option.value}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  handleRetryWithModel(option.value, m);
                                                }}
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                                              >
                                                <span>Retry with {option.label}</span>
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
                                              source.title?.trim().length
                                                ? source.title
                                                : domain || source.url;
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
                                                {source.snippet && (
                                                  <p className="mt-1 text-[12px] text-zinc-300">
                                                    {source.snippet}
                                                  </p>
                                                )}
                                              </a>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[12px] text-zinc-400">
                                          {isStreamingAssistantMessage
                                            ? "Gathering live sources…"
                                            : "OpenAI web_search did not return shareable source data for this response."}
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
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(searchIndicator || thinkingStatus) && (
                    <div
                      className="mx-auto mt-2 flex flex-col items-center gap-2"
                      style={{ maxWidth: MAX_MESSAGE_WIDTH }}
                    >
                      {searchIndicator && (
                        <StatusBubble
                          label={searchIndicator.message}
                          variant={
                            searchIndicator.variant === "error"
                              ? "error"
                              : "search"
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
            <div className="shrink-0 border-t border-[#202123] bg-[#212121] px-4 py-3">
              <div
                className="mx-auto flex w-full flex-col gap-3"
                style={{ maxWidth: MAX_MESSAGE_WIDTH }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    {forceWebSearch && (
                      <button
                        type="button"
                        onClick={() => setForceWebSearch(false)}
                        className="flex items-center gap-1 rounded-full border border-[#4b64ff]/50 bg-[#1a1e2f] px-3 py-1 text-[11px] text-[#a5bfff]"
                      >
                        <span className="text-base leading-none">🌐</span>
                        <span>Web search</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-[#3f3f46] bg-[#303030] px-3 py-2 text-sm shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            aria-label={
                              isVoiceFlowActive
                                ? "Cancel voice input"
                                : "Composer options"
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isVoiceFlowActive) {
                                cancelRecordingFlow();
                                return;
                              }
                              setComposerMenuOpen((prev) => !prev);
                            }}
                            className={`flex h-10 w-10 items-center justify-center rounded-2xl text-white/80 transition ${
                              isVoiceFlowActive
                                ? "bg-red-500/20 text-red-200"
                                : "bg-[#3a3a40] hover:bg-[#4b4b52]"
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

                          {composerMenuOpen && (
                            <div
                              onClick={(event) => event.stopPropagation()}
                              className="absolute left-0 bottom-full z-30 mb-2 w-60 rounded-2xl border border-[#2a2a30] bg-[#101014] p-2 text-left text-xs shadow-2xl"
                            >
                              <button
                                onClick={() => {
                                  setForceWebSearch((prev) => !prev);
                                  setComposerMenuOpen(false);
                                }}
                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                              >
                                <span>Web search</span>
                                {forceWebSearch && (
                                  <span className="text-[#8ab4ff]">On</span>
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex-1 space-y-2">
                          {imageAttachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {imageAttachments.map((attachment) => {
                                const sizeLabel = formatAttachmentSize(
                                  attachment.size
                                );
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
                                      onClick={() => handleRemoveAttachment(attachment.id)}
                                      className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex-1 px-1">
                            <textarea
                              ref={textareaRef}
                              className="w-full resize-none border-none bg-transparent py-1.5 text-[15px] leading-[1.45] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0 min-h-[1.5rem]"
                              style={{ maxHeight: MAX_INPUT_HEIGHT }}
                              value={input}
                              onChange={(e) => setInput(e.target.value)}
                              onKeyDown={handleKeyDown}
                              placeholder="Message the assistant…"
                              rows={1}
                            />
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="sr-only"
                            onChange={handleImageInputChange}
                          />
                        </div>

                        <div className="flex flex-col items-center gap-2">
                          <button
                            type="button"
                            aria-label="Add image"
                            onClick={handleImageButtonClick}
                            disabled={attachmentsLimitReached}
                            className={`flex h-10 w-10 items-center justify-center rounded-2xl text-white/80 transition ${
                              attachmentsLimitReached
                                ? "cursor-not-allowed bg-[#3a3a40]/70 opacity-40"
                                : "bg-[#3a3a40] hover:bg-[#4b4b52]"
                            }`}
                          >
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
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <path d="m8 13 2.5 3 3.5-4.5 4 5.5" />
                              <circle cx="8" cy="8" r="1.5" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            aria-label={
                              isRecording
                                ? "Stop recording"
                                : "Start voice input"
                            }
                            onClick={handleMicClick}
                            disabled={isTranscribing}
                            className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${
                              isRecording
                                ? "bg-red-500/20 text-red-200"
                                : "bg-[#3a3a40] text-white/80 hover:bg-[#4b4b52]"
                            } ${isTranscribing ? "cursor-wait opacity-60" : ""}`}
                            aria-pressed={isRecording}
                          >
                            {isTranscribing ? (
                              <span className="inline-flex h-4 w-4 items-center justify-center">
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
                              </span>
                            ) : isRecording ? (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                className="h-4 w-4"
                                fill="currentColor"
                              >
                                <rect x="7" y="7" width="10" height="10" rx="2" />
                              </svg>
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
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={
                        isStreaming ? handleStopGeneration : () => sendMessage()
                      }
                      disabled={
                        !isStreaming && (!canSendMessage || isTranscribing)
                      }
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b6eea] text-white shadow-lg transition focus:outline-none ${
                        isStreaming
                          ? "hover:bg-[#225fd0]"
                          : "hover:bg-[#3c7cff]"
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                      aria-label={isStreaming ? "Stop response" : "Send message"}
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
                  </div>
                  {composerError && (
                    <div className="text-xs text-red-400">{composerError}</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

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
