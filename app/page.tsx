"use client";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import { supabase } from "../lib/supabaseClient";
import type { SourceChip } from "@/lib/chatTypes";
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
};

type ChatMessage = {
  id?: string;
  persistedId?: string;
  role: "user" | "assistant";
  content: string;
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

const EXACT_MODEL_OPTIONS: {
  value: Exclude<ModelFamily, "auto">;
  label: string;
  hint: string;
}[] = [
  { value: "gpt-5-nano", label: "GPT 5 Nano", hint: "Fast & light" },
  { value: "gpt-5-mini", label: "GPT 5 Mini", hint: "Balanced" },
  { value: "gpt-5.1", label: "GPT 5.1", hint: "Most capable" },
];

const MODEL_RETRY_OPTIONS: {
  value: Exclude<ModelFamily, "auto">;
  label: string;
}[] = [
  { value: "gpt-5-nano", label: "GPT 5 Nano" },
  { value: "gpt-5-mini", label: "GPT 5 Mini" },
  { value: "gpt-5.1", label: "GPT 5.1" },
];

const MAX_INPUT_HEIGHT = 176;
const MIN_INPUT_HEIGHT = 32;
const MAX_MESSAGE_WIDTH = 900;
const AUTO_SCROLL_THRESHOLD_PX = 140;
const LONG_THINK_THRESHOLD_MS = 3000;
const MAX_PROJECT_CHAT_PREVIEW = 5;

type ServerStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string };

type StatusVariant = "default" | "extended" | "search" | "error";

function StatusBubble({
  label,
  variant = "default",
}: {
  label: string;
  variant?: StatusVariant;
}) {
  const baseClassMap: Record<StatusVariant, string> = {
    default: "border-white/10 bg-[#15151a]/80 text-zinc-200",
    extended: "border-[#4b64ff]/30 bg-[#1a1c2b]/80 text-[#b7c6ff]",
    search: "border-[#4b64ff]/30 bg-[#152033]/80 text-[#9bb8ff]",
    error: "border-red-500/40 bg-[#30161a]/85 text-red-200",
  };

  const dotMap: Record<StatusVariant, string> = {
    default: "bg-zinc-400",
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
    default:
      return "auto";
  }
}

export default function Home() {
  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelFamily, setModelFamily] = useState<ModelFamily>("auto");
  const [speedMode, setSpeedMode] = useState<SpeedMode>("auto");
  const [forceWebSearch, setForceWebSearch] = useState(false);

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

  const skipAutoLoadRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeAssistantMessageId, setActiveAssistantMessageId] =
    useState<string | null>(null);
  const [expandedSourcesId, setExpandedSourcesId] = useState<string | null>(
    null
  );
  const [openModelMenuId, setOpenModelMenuId] = useState<string | null>(null);
  const [headerModelMenuOpen, setHeaderModelMenuOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState<
    { phase: "waiting" | "extended" | "responding"; label: string } | null
  >(null);
  const [searchIndicator, setSearchIndicator] = useState<
    { message: string; variant: "running" | "error" } | null
  >(null);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
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
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMetadataPersistRef = useRef(new Map<string, MessageMetadata>());

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
        setMessages([]);
      } else {
        console.log(
          `[historyDebug] loaded ${data?.length ?? 0} messages for conversationId=${conversationId}`
        );
        setMessages(
          (data || []).map((m) => {
            const metadata =
              ((m as { metadata?: MessageMetadata }).metadata || {}) as MessageMetadata;
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
          })
        );
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
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!searchIndicator || searchIndicator.variant !== "error") {
      return;
    }
    const timeout = setTimeout(() => setSearchIndicator(null), 5000);
    return () => clearTimeout(timeout);
  }, [searchIndicator]);

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

  const currentConversation = conversations.find(
    (c) => c.id === selectedConversationId
  );
  const currentProject = projects.find((p) => p.id === selectedProjectId);

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
  const canSendMessage = input.trim().length > 0;
  const modelLabel =
    modelFamily === "auto" ? "Auto" : describeModelFamily(modelFamily);
  const headerStatusLabel =
    speedMode === "auto" && modelFamily === "auto"
      ? modelLabel
      : `${modelLabel} ${SPEED_LABELS[speedMode]}`;

  const clearThinkingTimeout = () => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  };

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
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
  modelOverride?: ModelFamily;
  speedOverride?: SpeedMode;
  retry?: RetryOptions;
};

  // ------------------------------------------------------------
  // SEND MESSAGE — STREAMING
  // ------------------------------------------------------------
  async function sendMessage(options?: SendMessageOptions) {
    const sourceText = options?.messageOverride ?? input;
    if (!sourceText.trim() || isStreaming) return;

    let conversationId = selectedConversationId;
    let assistantMessageId: string | null = options?.retry?.assistantMessageId ?? null;
    let userMessageId: string | null = null;
    const isRetry = Boolean(options?.retry);
    const text = sourceText.trim();
    const chosenFamily = options?.modelOverride ?? modelFamily;
    const chosenSpeed = options?.speedOverride ?? speedMode;
    const requestedLegacyMode = legacyModeFromFamily(chosenFamily);
    const previewFamilyForReasoning =
      chosenFamily === "auto" ? "gpt-5-mini" : chosenFamily;
    const previewModelConfig = getModelAndReasoningConfig(
      previewFamilyForReasoning,
      chosenSpeed,
      text
    );
    const requestedReasoningEffort = previewModelConfig.reasoning?.effort;
    if (!options?.messageOverride) {
      setInput("");
    }
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
    clearThinkingTimeout();
    const shouldShowImmediateLongThink =
      requestedReasoningEffort && requestedReasoningEffort !== "none";
    if (shouldShowImmediateLongThink) {
      setThinkingStatus({ phase: "extended", label: "Thinking for longer…" });
    } else {
      setThinkingStatus({ phase: "waiting", label: "Thinking…" });
      thinkingTimerRef.current = setTimeout(() => {
        if (!responseTimingRef.current.firstToken) {
          setThinkingStatus({
            phase: "extended",
            label: "Thinking for longer…",
          });
        }
      }, LONG_THINK_THRESHOLD_MS);
    }

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

    if (!isRetry) {
      const newUserMessageId = createLocalId();
      userMessageId = newUserMessageId;
      const activeAssistantId = assistantMessageId!;
      setMessages((prev) => [
        ...prev,
        { id: newUserMessageId, role: "user", content: text },
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
        clearThinkingTimeout();
        setThinkingStatus(null);
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
                    clearThinkingTimeout();
                    setThinkingStatus({
                      phase: "responding",
                      label: "Responding…",
                    });
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
      clearThinkingTimeout();
      setThinkingStatus(null);
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
      clearThinkingTimeout();
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
    if (!targetMessage.persistedId || !relatedUserMessage.persistedId) {
      console.warn("Retry unavailable until messages finish saving");
      return;
    }
    setModelFamily(targetFamily);
    setOpenModelMenuId(null);
    setExpandedSourcesId((prev) =>
      prev === targetMessage.id ? null : prev
    );
    await sendMessage({
      messageOverride: relatedUserMessage.content,
      modelOverride: targetFamily,
      retry: {
        assistantMessageId: targetMessage.id,
        assistantPersistedId: targetMessage.persistedId,
        userMessagePersistedId: relatedUserMessage.persistedId,
      },
    });
  }

  function handleStopGeneration() {
    const activeId = activeAssistantMessageId;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    clearThinkingTimeout();
    setThinkingStatus(null);
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
    if (
      !window.confirm(
        "Delete this project? Chats inside will move back to 'No project'."
      )
    ) {
      return;
    }

    await supabase.from("conversations").update({ project_id: null }).eq("project_id", id);
    await supabase.from("projects").delete().eq("id", id);

    setProjects((prev) => prev.filter((p) => p.id !== id));
    setConversations((prev) =>
      prev.map((c) =>
        c.project_id === id ? { ...c, project_id: null } : c
      )
    );

    if (selectedProjectId === id) {
      setSelectedProjectId(null);
      setViewMode("chat");
    }
  }

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
          const isActive = selectedProjectId === p.id && viewMode === "project";
          const isMenuOpen = rowMenu?.type === "project" && rowMenu.id === p.id;
          const projectChatList = projectSidebarChats.get(p.id) || [];
          const topChats = projectChatList.slice(0, MAX_PROJECT_CHAT_PREVIEW);
          const hasMoreChats = projectChatList.length > MAX_PROJECT_CHAT_PREVIEW;
          return (
            <div key={p.id} className="group relative">
              <div
                className={`flex items-center rounded-md ${
                  isActive
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
                        deleteProject(p.id);
                        setRowMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12px] text-red-400 hover:bg-[#1d1d24]"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {topChats.length > 0 && (
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
        <header className="flex shrink-0 items-center justify-between border-b border-[#202123] px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-[#2f2f32] px-2 py-1 text-sm text-zinc-300 hover:bg-[#2a2a2e] md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setHeaderModelMenuOpen((prev) => !prev);
                }}
                className="flex items-center gap-2 rounded-xl border border-[#2f2f32] bg-[#141418] px-3 py-1 text-left text-xs text-zinc-200 hover:border-[#4b64ff]"
              >
                <span className="text-sm font-semibold text-white">LLM Client</span>
                <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/80">
                  {headerStatusLabel}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
              {headerModelMenuOpen && (
                <div
                  onClick={(event) => event.stopPropagation()}
                  className="absolute left-0 top-full z-40 mt-2 w-72 rounded-2xl border border-[#2a2a30] bg-[#0f0f13] p-3 text-left text-xs shadow-2xl"
                >
                  <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                    Speed
                  </div>
                  <div className="flex flex-col gap-1">
                    {SPEED_OPTIONS.map((option) => {
                      const isActive = speedMode === option.value;
                      return (
                        <button
                          key={option.value}
                          onClick={() => {
                            setSpeedMode(option.value);
                            setHeaderModelMenuOpen(false);
                          }}
                          className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] transition ${
                            isActive
                              ? "bg-[#1e4fd8] text-white"
                              : "text-zinc-200 hover:bg-[#1b1b21]"
                          }`}
                        >
                          <span>{option.label}</span>
                          <span className="text-[11px] text-zinc-400">{option.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                      Exact model
                    </div>
                    <button
                      onClick={() => {
                        setModelFamily("auto");
                        setHeaderModelMenuOpen(false);
                      }}
                      className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] transition ${
                        modelFamily === "auto"
                          ? "bg-[#1e4fd8] text-white"
                          : "text-zinc-200 hover:bg-[#1b1b21]"
                      }`}
                    >
                      <span>Auto (Router)</span>
                      {modelFamily === "auto" && (
                        <span className="text-[10px] text-white/70">current</span>
                      )}
                    </button>
                    {EXACT_MODEL_OPTIONS.map((option) => {
                      const isActive = modelFamily === option.value;
                      return (
                        <button
                          key={option.value}
                          onClick={() => {
                            setModelFamily(option.value);
                            setHeaderModelMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] transition ${
                            isActive
                              ? "bg-[#1e4fd8] text-white"
                              : "text-zinc-200 hover:bg-[#1b1b21]"
                          }`}
                        >
                          <span>{option.label}</span>
                          <span className="text-[11px] text-zinc-400">{option.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
                      Start chatting — GPT-5.1 chat is streaming live.
                    </div>
                  )}

                  {messages.map((m, i) => {
                    const messageId = m.id ?? `msg-${i}`;
                    const isAssistant = m.role === "assistant";
                    const hasSearchRecords = Boolean(
                      isAssistant &&
                        m.usedWebSearch &&
                        (m.searchRecords?.length || 0) > 0
                    );
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

                                {hasSearchRecords && (
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
                                      aria-expanded={expandedSourcesId === messageId}
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

                                {hasSearchRecords &&
                                  expandedSourcesId === messageId &&
                                  !isStreamingAssistantMessage && (
                                    <div className="mt-3 space-y-3 rounded-2xl border border-[#2f2f36] bg-[#141417] p-3 text-[13px] text-zinc-200">
                                  {m.searchRecords?.map((record, idx) => {
                                    const ranked = record.rankedSources ?? [];
                                    return (
                                      <div key={`${record.query}-${idx}`} className="space-y-2">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                                          {record.query}
                                        </div>
                                        {ranked.length === 0 ? (
                                          <p className="text-[12px] text-zinc-400">
                                            {record.summary}
                                          </p>
                                        ) : (
                                          <div className="space-y-2">
                                            {ranked.map((result, sourceIdx) => (
                                              <div
                                                key={`${result.url}-${sourceIdx}`}
                                                className="rounded-xl bg-[#1b1b20] p-2"
                                              >
                                                <div className="text-[13px] font-semibold text-zinc-100">
                                                  {result.title}
                                                </div>
                                                <div className="text-[11px] text-zinc-500">
                                                  {result.domain}
                                                  {result.published && ` • ${result.published}`}
                                                </div>
                                                <p className="mt-1 text-[12px] text-zinc-300">
                                                  {result.snippet}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                          </div>
                        ) : (
                          <div
                            className={`relative ${userWrapperClass} rounded-3xl bg-[#1e4fd8] px-5 py-4 text-left text-[15px] leading-relaxed text-white`}
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {m.content}
                            </div>
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
                            thinkingStatus.phase === "extended"
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

                <div className="flex items-end gap-2">
                  <div className="relative w-full">
                    <div className="flex w-full items-center gap-2 rounded-[999px] border border-[#3f3f46] bg-[#303030] px-3 py-1 pr-14 text-sm shadow-[0_0_0_1px_rgba(0,0,0,0.45)]">
                      <div className="relative">
                        <button
                          type="button"
                          aria-label="Insert options"
                          onClick={(event) => {
                            event.stopPropagation();
                            setComposerMenuOpen((prev) => !prev);
                          }}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a3a40] text-white/80 transition hover:bg-[#4b4b52]"
                        >
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
                        </button>

                        {composerMenuOpen && (
                          <div
                            onClick={(event) => event.stopPropagation()}
                            className="absolute bottom-12 left-0 z-30 w-60 rounded-2xl border border-[#2a2a30] bg-[#101014] p-2 text-left text-xs shadow-2xl"
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

                      <div className="flex-1 px-1">
                        <textarea
                          ref={textareaRef}
                          className="w-full resize-none border-none bg-transparent py-0.5 text-[15px] leading-[1.45] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0 min-h-[1.5rem]"
                          style={{ maxHeight: MAX_INPUT_HEIGHT }}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="Message the assistant…"
                          rows={1}
                        />
                      </div>

                      <button
                        type="button"
                        aria-label="Voice input (coming soon)"
                        onClick={() => textareaRef.current?.focus()}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:text-white"
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
                          <path d="M12 4a2.5 2.5 0 0 0-2.5 2.5v5A2.5 2.5 0 0 0 12 14.5a2.5 2.5 0 0 0 2.5-2.5v-5A2.5 2.5 0 0 0 12 4Z" />
                          <path d="M19 11.5a7 7 0 0 1-14 0" />
                          <path d="M12 18.5v2" />
                        </svg>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={
                        isStreaming ? handleStopGeneration : () => sendMessage()
                      }
                      disabled={!isStreaming && !canSendMessage}
                      className={`absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[#2b6eea] text-white shadow-lg transition focus:outline-none ${
                        isStreaming
                          ? "hover:bg-[#225fd0]"
                          : "hover:bg-[#3c7cff] disabled:opacity-40"
                      }`}
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
            This will delete "
            {pendingDeleteConversation?.title || "this chat"}
            ".
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
    </div>
  );
}
