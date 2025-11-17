export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseInput,
  ResponseInputMessageContentList,
  ResponseOutputMessage,
  EasyInputMessage,
  Tool,
  ToolChoiceAllowed,
} from "openai/resources/responses/responses";
import type {
  FileAttachment,
  ImageAttachment,
  Source,
  SourceChip,
} from "@/lib/chatTypes";
import {
  getModelAndReasoningConfig,
  suggestSmallerModelForEffort,
  type ModelFamily,
  type ReasoningEffort,
  type SpeedMode,
} from "@/lib/modelConfig";
import { getServerSupabaseClient } from "@/lib/serverSupabase";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return new OpenAI({ apiKey });
}

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  files?: FileAttachment[];
};
type PersistedHistoryRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown> | null;
};

type ModelMode = "auto" | "nano" | "mini" | "full";
type ModelKey = Exclude<ModelMode, "auto">;

export type RankedSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  sourceType: "official" | "news" | "reference" | "other";
  published: string | null;
  confidenceScore: number;
};

type SearchRecord = {
  query: string;
  summary: string;
  rankedSources: RankedSource[];
  rawResults?: RankedSource[];
  fromCache?: boolean;
};

type WebSearchAction = {
  type?: string;
  query?: string;
  sources?: Array<{ url?: string }>;
  results?: unknown;
  content?: unknown;
};

type WebSearchOutputEntry = {
  results?: unknown;
  content?: unknown;
  text?: string;
};

type WebSearchCall = {
  type?: string;
  status?: string;
  query?: string;
  actions?: WebSearchAction[];
  results?: unknown;
  output?: { results?: unknown } | WebSearchOutputEntry[];
  data?: { results?: unknown };
  metadata?: { results?: unknown };
};

function isWebSearchCall(value: unknown): value is WebSearchCall {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (value as { type?: string }).type === "web_search_call";
}

type FileSearchCallFailedEvent = {
  type: "response.file_search_call.failed";
};

function isFileSearchCallFailedEvent(
  event: unknown
): event is FileSearchCallFailedEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as { type?: string }).type === "response.file_search_call.failed"
  );
}

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string }
  | { type: "file-reading-start" }
  | { type: "file-reading-complete" }
  | { type: "file-reading-error"; message?: string };

type ResponseMetadata = {
  usedModel: string;
  usedModelMode: ModelKey;
  usedModelFamily: Exclude<ModelFamily, "auto">;
  requestedModelFamily: ModelFamily;
  speedMode: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch: boolean;
  searchRecords: SearchRecord[];
  sources: SourceChip[];
  citations: Source[];
  vectorStoreIds?: string[];
  generationType?: "text" | "image";
  imagePrompt?: string;
  imageModelLabel?: string;
  generatedImages?: Array<{
    id: string;
    dataUrl?: string;
    url?: string;
    model?: string;
    prompt?: string;
  }>;
  searchedSiteLabel?: string;
};

const MODEL_MAP: Record<ModelKey, string> = {
  nano: "gpt-5-nano-2025-08-07",
  mini: "gpt-5-mini-2025-08-07",
  full: "gpt-5.1-2025-11-13",
};

const MODEL_FAMILY_TO_MODE: Record<Exclude<ModelFamily, "auto">, ModelKey> = {
  "gpt-5-nano": "nano",
  "gpt-5-mini": "mini",
  "gpt-5.1": "full",
  "gpt-5-pro-2025-10-06": "full",
};

const MODEL_KEY_TO_FAMILY: Record<ModelKey, Exclude<ModelFamily, "auto">> = {
  nano: "gpt-5-nano",
  mini: "gpt-5-mini",
  full: "gpt-5.1",
};

const BASE_SYSTEM_PROMPT =
  "You are a web-connected assistant with access to the `web_search` tool for live information.\n" +
  "Follow these rules:\n" +
  "- Use internal knowledge for timeless concepts, math, or historical context.\n" +
  "- For questions about current events, market conditions, weather, schedules, releases, or other fast-changing facts, prefer calling `web_search` to gather fresh data.\n" +
  "- When `web_search` returns results, treat them as live, up-to-date sources. Summarize them, cite domains inline using (Source: domain.com), and close with a short Sources list that repeats the referenced domains.\n" +
  "- Never claim you lack internet access or that your knowledge is outdated in a turn where tool outputs were provided.\n" +
  "- If the tool returns little or no information, acknowledge that gap before relying on older knowledge.\n" +
  "- Do not send capability or identity questions to `web_search`; answer those directly.\n" +
  "- Keep answers clear and grounded, blending background context with any live data you retrieved.";

const FORCE_WEB_SEARCH_PROMPT =
  "The user explicitly requested live web search. Ensure you call the `web_search` tool for this turn unless it would clearly be redundant.";

const LIVE_DATA_HINTS = [
  "current",
  "today",
  "tonight",
  "latest",
  "recent",
  "breaking",
  "news",
  "update",
  "updated",
  "now",
  "right now",
  "this week",
  "this month",
  "this year",
  "price",
  "prices",
  "market",
  "stock",
  "stocks",
  "quote",
  "report",
  "earnings",
  "forecast",
  "weather",
  "temperature",
  "release",
  "launch",
  "trend",
];

const CROSS_CHAT_STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "about",
  "your",
  "have",
  "will",
  "they",
  "them",
  "their",
  "what",
  "when",
  "where",
  "which",
  "would",
  "could",
  "should",
  "there",
  "here",
  "please",
  "thanks",
  "thank",
  "like",
  "just",
  "need",
  "want",
  "into",
  "using",
  "been",
  "some",
  "more",
  "also",
  "really",
  "because",
  "while",
  "after",
  "before",
  "since",
  "those",
  "these",
  "through",
  "over",
  "such",
  "only",
  "even",
  "many",
  "very",
  "make",
  "made",
  "does",
  "doing",
  "done",
  "said",
  "asks",
  "help",
  "idea",
  "ideas",
  "project",
  "projects",
]);

const EMERGING_ENTITY_KEYWORDS = [
  "buy",
  "purchase",
  "preorder",
  "pre-order",
  "release",
  "released",
  "launch",
  "launched",
  "announce",
  "announced",
  "available",
  "availability",
  "in stock",
  "stock",
  "price",
  "prices",
  "cost",
  "ticket",
  "tickets",
  "order",
  "exists",
  "exist",
  "new",
  "latest",
  "upcoming",
];

const KNOWN_ENTITY_PATTERNS = [
  /rtx\s?\d{3,4}/i,
  /geforce/i,
  /radeon/i,
  /iphone/i,
  /galaxy/i,
  /pixel/i,
  /tesla/i,
  /model\s?[sx3y]/i,
  /macbook/i,
  /ipad/i,
  /playstation/i,
  /xbox/i,
  /gpu/i,
  /cpu/i,
  /summit/i,
  /conference/i,
  /expo/i,
  /festival/i,
  /tournament/i,
  /world cup/i,
  /olympics/i,
];

const PRODUCT_STYLE_PATTERN = /\b(?:[A-Z]{2,}[A-Za-z0-9+\-]*\d{2,5}|[A-Za-z]+\s?\d{4})\b/;

const DIRECT_WEB_REQUEST_PATTERNS = [
  /\bsearch (?:the )?(?:web|internet)\b/i,
  /\bsearch online\b/i,
  /\bweb search\b/i,
  /\blook up\b/i,
  /\bfind (?:online|on the web)\b/i,
  /\bcheck (?:the )?(?:internet|web)\b/i,
  /\bbrowse the web\b/i,
  /\bgoogle (?:it|this)?\b/i,
  /\bnews sources?\b/i,
  /\bcitations?\b/i,
];

const META_QUESTION_PATTERNS = [
  /\b(?:can|could|would) you (?:browse|access|use) (?:the )?(?:internet|web)/i,
  /\b(?:do|can) you have internet/i,
  /\bwhat(?:'s| is) your knowledge cutoff/i,
  /\bwhen were you (?:trained|last updated)/i,
  /\bare you able to search/i,
  /\bwhat model are you/i,
  /\bhow do your tools work/i,
];

const PLACEHOLDER_TITLES = [
  "",
  "new chat",
  "untitled chat",
  "conversation with assistant",
  "chat with assistant",
];

function isPlaceholderTitle(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return PLACEHOLDER_TITLES.includes(normalized);
}

function normalizeGeneratedTitle(input: string | null | undefined) {
  const cleaned = (input || "")
    .replace(/["'“”‘’]+/g, "")
    .replace(/[.!?,:;]+$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const truncated = words.slice(0, 8).join(" ");
  if (!truncated) return null;
  const normalized = truncated.trim();
  if (isPlaceholderTitle(normalized)) {
    return null;
  }
  return normalized;
}

function parseSpeedMode(value: unknown): SpeedMode {
  const allowed: SpeedMode[] = ["auto", "instant", "thinking"];
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as SpeedMode;
    if (allowed.includes(normalized)) {
      return normalized;
    }
  }
  return "auto";
}

function parseModelFamily(value: unknown): ModelFamily {
  const allowed: ModelFamily[] = [
    "auto",
    "gpt-5.1",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-pro-2025-10-06",
  ];
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as ModelFamily;
    if (allowed.includes(normalized)) {
      return normalized;
    }
  }
  return "auto";
}

function shouldAllowWebSearch({
  userText,
  forceWebSearch,
}: {
  userText: string;
  forceWebSearch: boolean;
}) {
  if (forceWebSearch) {
    return true;
  }
  const trimmed = userText.trim();
  if (!trimmed) {
    return false;
  }
  if (META_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (DIRECT_WEB_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  if (LIVE_DATA_HINTS.some((hint) => lower.includes(hint))) {
    return true;
  }
  if (/https?:\/\//i.test(trimmed) || /\bwww\./i.test(trimmed)) {
    return true;
  }
  if (/\bsources?\b/i.test(trimmed) || /\breference\b/i.test(trimmed)) {
    return true;
  }
  if (referencesEmergingEntity(trimmed)) {
    return true;
  }
  return false;
}

function referencesEmergingEntity(text: string) {
  if (!text.trim()) {
    return false;
  }
  if (KNOWN_ENTITY_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  const lower = text.toLowerCase();
  const hasKeyword = EMERGING_ENTITY_KEYWORDS.some((keyword) =>
    lower.includes(keyword)
  );
  if (!hasKeyword) {
    return false;
  }
  return PRODUCT_STYLE_PATTERN.test(text);
}

function buildSourceChips(records: SearchRecord[], maxSources = 4): SourceChip[] {
  if (!records.length) {
    return [];
  }
  const chips: SourceChip[] = [];
  const seen = new Set<string>();
  let nextId = 1;

  for (const record of records) {
    for (const result of record.rankedSources) {
      const rawUrl = (result.url || "").trim();
      if (!rawUrl) {
        continue;
      }
      const url = normalizeSourceUrl(rawUrl);
      const domain =
        extractDomainFromUrl(url) ||
        result.domain ||
        url;
      const normalizedDomain = domain.toLowerCase();
      if (seen.has(normalizedDomain)) {
        continue;
      }
      chips.push({
        id: nextId,
        title: result.title?.trim() || domain,
        url,
        domain,
      });
      seen.add(normalizedDomain);
      nextId += 1;
      if (chips.length >= maxSources) {
        return chips;
      }
    }
  }

  return chips;
}

function normalizeSourceUrl(input: string) {
  if (!input) {
    return "";
  }
  try {
    return new URL(input).toString();
  } catch {
    try {
      return new URL(`https://${input}`).toString();
    } catch {
      return input;
    }
  }
}

function extractDomainFromUrl(input: string) {
  if (!input) {
    return null;
  }
  try {
    const host = new URL(input).hostname;
    return host.replace(/^www\./i, "");
  } catch {
    if (!/^https?:/i.test(input)) {
      try {
        const host = new URL(`https://${input}`).hostname;
        return host.replace(/^www\./i, "");
      } catch {
        // fall through
      }
    }
    const sanitized = input
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim();
    return sanitized || null;
  }
}

const IMAGE_ATTACHMENT_LIMIT = 4;
const FILE_ATTACHMENT_LIMIT = 8;
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

function sanitizeImageAttachment(input: unknown): ImageAttachment | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<ImageAttachment> & {
    dataUrl?: string;
  };
  const rawDataUrl =
    typeof candidate.dataUrl === "string" ? candidate.dataUrl.trim() : "";
  if (!rawDataUrl || !rawDataUrl.startsWith("data:image/")) {
    return null;
  }
  const id =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id
      : randomUUID();
  const name =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name
      : "image";
  const mimeType =
    typeof candidate.mimeType === "string" && candidate.mimeType.trim().length > 0
      ? candidate.mimeType
      : "image/*";
  const size =
    typeof candidate.size === "number" && Number.isFinite(candidate.size)
      ? candidate.size
      : undefined;
  return {
    id,
    name,
    mimeType,
    dataUrl: rawDataUrl,
    size,
  };
}

function sanitizeAttachmentList(value: unknown): ImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: ImageAttachment[] = [];
  for (const raw of value) {
    const normalized = sanitizeImageAttachment(raw);
    if (normalized) {
      attachments.push(normalized);
    }
    if (attachments.length >= IMAGE_ATTACHMENT_LIMIT) {
      break;
    }
  }
  return attachments;
}

function sanitizeFileAttachment(input: unknown): FileAttachment | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<FileAttachment> & { dataUrl?: string };
  const rawDataUrl =
    typeof candidate.dataUrl === "string" ? candidate.dataUrl.trim() : "";
  if (!rawDataUrl || !rawDataUrl.startsWith("data:")) {
    return null;
  }
  if (rawDataUrl.length > MAX_FILE_SIZE_BYTES * 1.45) {
    // Rough guardrail against extremely large base64 payloads.
    return null;
  }
  const id =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id
      : randomUUID();
  const name =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name
      : "file";
  const mimeType =
    typeof candidate.mimeType === "string" && candidate.mimeType.trim().length > 0
      ? candidate.mimeType
      : "application/octet-stream";
  const size =
    typeof candidate.size === "number" && Number.isFinite(candidate.size)
      ? candidate.size
      : undefined;
  return {
    id,
    name,
    mimeType,
    dataUrl: rawDataUrl,
    size,
  };
}

function sanitizeFileAttachmentList(value: unknown): FileAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: FileAttachment[] = [];
  for (const raw of value) {
    const normalized = sanitizeFileAttachment(raw);
    if (normalized) {
      attachments.push(normalized);
    }
    if (attachments.length >= FILE_ATTACHMENT_LIMIT) {
      break;
    }
  }
  return attachments;
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  const base64 = match[2];
  return Buffer.from(base64, "base64");
}

function extractAttachmentsFromMetadata(metadata: unknown): ImageAttachment[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const raw = (metadata as { attachments?: unknown }).attachments;
  return sanitizeAttachmentList(raw);
}

function extractFilesFromMetadata(metadata: unknown): FileAttachment[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const raw = (metadata as { files?: unknown }).files;
  return sanitizeFileAttachmentList(raw);
}

function extractVectorStoreIds(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const raw = (metadata as { vectorStoreIds?: unknown }).vectorStoreIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function gatherVectorStoreIds(rows: PersistedHistoryRow[]): string[] {
  const ids = new Set<string>();
  rows.forEach((row) => {
    extractVectorStoreIds(row.metadata).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

async function ensureVectorStoreId({
  openai,
  conversationId,
  existingIds,
}: {
  openai: OpenAI;
  conversationId: string;
  existingIds: Set<string>;
}) {
  const first = existingIds.values().next().value as string | undefined;
  if (first) {
    return first;
  }
  const vectorStore = await openai.vectorStores.create({
    name: `chat-${conversationId}`,
    metadata: { conversation_id: conversationId },
  });
  existingIds.add(vectorStore.id);
  return vectorStore.id;
}

async function uploadFilesToVectorStore({
  openai,
  vectorStoreId,
  files,
}: {
  openai: OpenAI;
  vectorStoreId: string;
  files: FileAttachment[];
}) {
  for (const file of files) {
    try {
      const buffer = dataUrlToBuffer(file.dataUrl);
      const uploadable = new File([buffer], file.name || "file", {
        type: file.mimeType || "application/octet-stream",
      });
      await openai.vectorStores.files.uploadAndPoll(vectorStoreId, uploadable);
    } catch (error) {
      console.error("Failed to upload file to vector store", error);
      throw error;
    }
  }
}

function buildContentPayload(
  text: string,
  attachments: ImageAttachment[]
): string | ResponseInputMessageContentList {
  if (!attachments.length) {
    return text;
  }
  const blocks: ResponseInputMessageContentList = [];
  if (text && text.trim()) {
    blocks.push({ type: "input_text", text });
  }
  attachments.forEach((attachment) => {
    blocks.push({
      type: "input_image",
      image_url: attachment.dataUrl,
      detail: "auto",
    });
  });
  if (!blocks.length) {
    blocks.push({ type: "input_text", text: "(image-only message)" });
  }
  return blocks;
}

function attachmentPlaceholder(imageCount: number, fileCount: number) {
  const parts: string[] = [];
  if (imageCount > 0) {
    parts.push(
      imageCount === 1
        ? "[image attachment]"
        : `[${imageCount} image attachments]`
    );
  }
  if (fileCount > 0) {
    parts.push(
      fileCount === 1
        ? "[file attachment]"
        : `[${fileCount} file attachments]`
    );
  }
  return parts.join(" ");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = (body.message ?? "").toString().trim();
    const conversationId = (body.conversationId ?? "").toString();
    const requestedModelFamily = parseModelFamily(body.modelFamily);
    const speedMode = parseSpeedMode(body.speedMode);
    const requestedMode: ModelMode =
      requestedModelFamily === "auto"
        ? "auto"
        : MODEL_FAMILY_TO_MODE[requestedModelFamily];
    const forceWebSearch = Boolean(body.forceWebSearch);
    const rawImages = Array.isArray(body.images) ? body.images : [];
    const sanitizedImageAttachments = sanitizeAttachmentList(rawImages);
    const rawFiles = Array.isArray(body.files) ? body.files : [];
    const sanitizedFileUploads = sanitizeFileAttachmentList(rawFiles);
    const retryAssistantMessageId =
      typeof body.retryAssistantMessageId === "string" &&
      body.retryAssistantMessageId.trim().length > 0
        ? body.retryAssistantMessageId.trim()
        : null;
    let retryUserMessageId =
      typeof body.retryUserMessageId === "string" &&
      body.retryUserMessageId.trim().length > 0
        ? body.retryUserMessageId.trim()
        : null;

    if (!conversationId) {
      return NextResponse.json(
        { error: "Missing conversation" },
        { status: 400 }
      );
    }

    const supabase = getServerSupabaseClient();

    let historyRows: unknown[] = [];
    try {
      const { data, error: historyError } = await supabase
        .from("messages")
        .select("id, role, content, metadata")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(40);

      if (historyError) {
        throw historyError;
      }
      historyRows = data || [];
    } catch (historyError) {
      console.error("Failed to load history", historyError);
    }

    const validHistoryRows: PersistedHistoryRow[] = (historyRows || [])
      .filter(
        (m): m is {
          id: string;
          role: "user" | "assistant";
          content: string;
          metadata: Record<string, unknown> | null | undefined;
        } => {
          if (!m || typeof m !== "object") {
            return false;
          }

          const candidate = m as {
            id?: unknown;
            role?: unknown;
            content?: unknown;
            metadata?: Record<string, unknown> | null | undefined;
          };

          return (
            typeof candidate.id === "string" &&
            typeof candidate.content === "string" &&
            (candidate.role === "user" || candidate.role === "assistant")
          );
        }
      )
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata ?? null,
      }));

    const isRetryRequest = Boolean(retryAssistantMessageId);

    if (isRetryRequest && !retryAssistantMessageId) {
      return NextResponse.json(
        { error: "Missing retry message id" },
        { status: 400 }
      );
    }

    let historyRowsForModel = validHistoryRows;
    let retryUserAttachments: ImageAttachment[] = [];
    let retryUserFiles: FileAttachment[] = [];

    if (isRetryRequest && retryAssistantMessageId) {
      const assistantIndex = validHistoryRows.findIndex(
        (row) => row.id === retryAssistantMessageId
      );

      if (assistantIndex === -1) {
        return NextResponse.json(
          { error: "Assistant message not found" },
          { status: 404 }
        );
      }

      if (!retryUserMessageId) {
        for (let i = assistantIndex - 1; i >= 0; i -= 1) {
          if (validHistoryRows[i].role === "user") {
            retryUserMessageId = validHistoryRows[i].id;
            break;
          }
        }
      }

      if (!retryUserMessageId) {
        return NextResponse.json(
          { error: "Unable to identify user message for retry" },
          { status: 400 }
        );
      }

      const userIndex = validHistoryRows.findIndex(
        (row) => row.id === retryUserMessageId
      );

      if (userIndex === -1) {
        return NextResponse.json(
          { error: "User message not found for retry" },
          { status: 404 }
        );
      }

      const retryUserRow = validHistoryRows[userIndex];
      retryUserAttachments = extractAttachmentsFromMetadata(
        retryUserRow.metadata
      );
      retryUserFiles = extractFilesFromMetadata(retryUserRow.metadata);

      historyRowsForModel = validHistoryRows.slice(0, userIndex + 1);
    }

    const imageAttachments = isRetryRequest ? [] : sanitizedImageAttachments;
    const fileUploads = isRetryRequest ? [] : sanitizedFileUploads;
    const attachmentCountForContext = isRetryRequest
      ? retryUserAttachments.length
      : imageAttachments.length;
    const fileCountForContext = isRetryRequest
      ? retryUserFiles.length
      : fileUploads.length;
    const requestHasAttachments =
      attachmentCountForContext > 0 || fileCountForContext > 0;

    if (!userText && !requestHasAttachments) {
      return NextResponse.json(
        { error: "Empty message" },
        { status: 400 }
      );
    }

    const userTextForContext =
      userText ||
      attachmentPlaceholder(attachmentCountForContext, fileCountForContext);

    const historyForModel: HistoryMessage[] = historyRowsForModel.map(
      (message) => ({
        role: message.role,
        content: message.content,
        attachments: extractAttachmentsFromMetadata(message.metadata),
        files: extractFilesFromMetadata(message.metadata),
      })
    );
    const vectorStoreIdSet = new Set(gatherVectorStoreIds(validHistoryRows));
    let vectorStoreIds = Array.from(vectorStoreIdSet);

    const { data: conversationRow } = await supabase
      .from("conversations")
      .select("title, user_id")
      .eq("id", conversationId)
      .single();

    const existingConversationTitle = (conversationRow?.title || "").trim();
    const conversationOwnerId =
      conversationRow && typeof conversationRow.user_id === "string"
        ? conversationRow.user_id
        : null;
    const hasAssistantHistory = historyForModel.some(
      (msg) => msg.role === "assistant"
    );
    const needsTitle =
      !hasAssistantHistory && isPlaceholderTitle(existingConversationTitle);
    const crossChatSummary = conversationOwnerId
      ? await buildCrossChatSummary({
          supabase,
          userId: conversationOwnerId,
          excludeConversationId: conversationId,
        })
      : null;

    let userRowId: string | null = null;
    let assistantRowId: string | null = isRetryRequest
      ? retryAssistantMessageId ?? null
      : null;
    if (isRetryRequest && retryAssistantMessageId) {
      userRowId = retryUserMessageId ?? null;
      try {
        await supabase
          .from("messages")
          .update({ content: "", metadata: null })
          .eq("id", retryAssistantMessageId)
          .eq("conversation_id", conversationId);
      } catch (error) {
        console.warn("Failed to clear assistant message before retry", error);
      }
    } else {
      const userMetadata: Record<string, unknown> = {};
      if (imageAttachments.length) {
        userMetadata.attachments = imageAttachments;
      }
      if (fileUploads.length) {
        userMetadata.files = fileUploads;
      }
      if (vectorStoreIds.length) {
        userMetadata.vectorStoreIds = vectorStoreIds;
      }
      const metadataPayload =
        Object.keys(userMetadata).length > 0 ? userMetadata : null;

      const { data: userRow, error: userInsertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: userText,
          metadata: metadataPayload,
        })
        .select("id")
        .single();

      if (userInsertError) {
        console.error("Failed to persist user message", userInsertError);
      }

      userRowId = userRow?.id ?? null;
    }

    const openai = getOpenAIClient();

    const routerResult = await routeModel({
      openai,
      history: historyForModel,
      userText: userTextForContext || userText,
      requestedMode,
      requestTitle: needsTitle && requestedMode === "auto",
    });

    let routerTitlePromise: Promise<string | null> | null = null;
    if (needsTitle && routerResult.titleSuggestion) {
      routerTitlePromise = applyTitleSuggestion({
        supabase,
        conversationId,
        suggestedTitle: routerResult.titleSuggestion,
      });
    }

    let manualTitlePromise: Promise<string | null> | null = null;
    if (needsTitle && !routerResult.titleSuggestion && requestedMode !== "auto") {
      manualTitlePromise = requestNanoTitle({
        openai,
        userMessage: userTextForContext || userText,
      }).then((maybeTitle) =>
        maybeTitle
          ? applyTitleSuggestion({
              supabase,
              conversationId,
              suggestedTitle: maybeTitle,
            })
          : null
      );
    }

    const historyMessages: EasyInputMessage[] = historyForModel.map(
      (message) => ({
        role: message.role,
        content: buildContentPayload(
          message.content,
          message.attachments ?? []
        ),
        type: "message",
      })
    );

    if (!isRetryRequest && fileUploads.length > 0) {
      try {
        const vectorStoreId = await ensureVectorStoreId({
          openai,
          conversationId,
          existingIds: vectorStoreIdSet,
        });
        await uploadFilesToVectorStore({
          openai,
          vectorStoreId,
          files: fileUploads,
        });
      } catch (error) {
        console.error("File upload failed", error);
        return NextResponse.json(
          { error: "Unable to register files for search" },
          { status: 400 }
        );
      }
    }
    vectorStoreIds = Array.from(vectorStoreIdSet);

    const allowWebSearch = shouldAllowWebSearch({
      userText: userTextForContext,
      forceWebSearch,
    });
    const webSearchTool = { type: "web_search" } satisfies Tool & {
      [key: string]: unknown;
    };
    const toolsForRequest: Tool[] = [];
    if (allowWebSearch) {
      toolsForRequest.push(webSearchTool);
    }
    if (vectorStoreIds.length > 0) {
      toolsForRequest.push(
        {
          type: "file_search",
          vector_store_ids: vectorStoreIds,
        } satisfies Tool
      );
    }
    const toolChoice: ToolChoiceAllowed | undefined = allowWebSearch
      ? ({
          type: "allowed_tools",
          mode: forceWebSearch ? "required" : "auto",
          tools: [webSearchTool],
        } satisfies ToolChoiceAllowed)
      : undefined;

    const systemMessages: EasyInputMessage[] = [
      {
        role: "system",
        content: BASE_SYSTEM_PROMPT,
        type: "message",
      },
      ...(crossChatSummary
        ? ([
            {
              role: "system",
              content:
                "High-level summary of this user's behavior and interests across their other chats: " +
                crossChatSummary,
              type: "message",
            },
          ] satisfies EasyInputMessage[])
        : []),
      ...(forceWebSearch
        ? ([
            {
              role: "system",
              content: FORCE_WEB_SEARCH_PROMPT,
              type: "message",
            },
          ] satisfies EasyInputMessage[])
        : []),
    ];

    const requestMessages: ResponseInput = [
      ...systemMessages,
      ...historyMessages,
    ];

    if (!isRetryRequest) {
      requestMessages.push({
        role: "user",
        content: buildContentPayload(userText, imageAttachments),
        type: "message",
      });
    }

    let targetModelKey = routerResult.modelKey;
    let targetModelFamily: Exclude<ModelFamily, "auto"> =
      requestedModelFamily === "auto"
        ? MODEL_KEY_TO_FAMILY[targetModelKey]
        : requestedModelFamily;

    if (requestedModelFamily !== "auto") {
      targetModelKey = MODEL_FAMILY_TO_MODE[targetModelFamily];
    }

    const promptForRouting = userTextForContext || userText;

    if (requestedModelFamily === "auto") {
      const previewConfig = getModelAndReasoningConfig(
        targetModelFamily,
        speedMode,
        promptForRouting
      );
      const previewEffort = previewConfig.reasoning?.effort ?? null;
      if (previewEffort === "medium" || previewEffort === "high") {
        const suggestedFamily = suggestSmallerModelForEffort(
          promptForRouting,
          previewEffort
        );
        if (suggestedFamily && suggestedFamily !== targetModelFamily) {
          targetModelFamily = suggestedFamily;
          targetModelKey = MODEL_FAMILY_TO_MODE[targetModelFamily];
        }
      }
    }

    const modelConfig = getModelAndReasoningConfig(
      targetModelFamily,
      speedMode,
      promptForRouting
    );
    const targetModel = modelConfig.model;

    const encoder = new TextEncoder();
    const historyForTitle = isRetryRequest
      ? historyForModel
      : [
          ...historyForModel,
          {
            role: "user" as const,
            content: userText,
            attachments: imageAttachments,
            files: fileUploads,
          },
        ];
    const firstUserMessage = historyForTitle.find(
      (msg) => msg.role === "user"
    )?.content;
    const userMessageForTitle =
      firstUserMessage && firstUserMessage.trim().length > 0
        ? firstUserMessage
        : userTextForContext || userText;
    const isFirstAssistantResponse = !historyForModel.some(
      (msg) => msg.role === "assistant"
    );

    if (isFirstAssistantResponse) {
      void ensureChatTitle({
        openai,
        supabase,
        conversationId,
        userMessage: userMessageForTitle,
        assistantMessage: null,
        allowUserOnly: true,
      });
    }

    const readable = new ReadableStream({
      async start(controller) {
        const enqueueJson = (payload: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(payload)}\n`)
          );
        };
        const sendStatusUpdate = (status: SearchStatusEvent) => {
          enqueueJson({ status });
        };
        const announceTitle = (promise: Promise<string | null> | null) => {
          promise
            ?.then((title) => {
              if (title) {
                enqueueJson({ title });
              }
            })
            .catch((err) =>
              console.warn("Unable to announce title update", err)
            );
        };
        let fullAssistantMessage = "";
        let responseMetadata: ResponseMetadata | null = null;

        announceTitle(routerTitlePromise);
        announceTitle(manualTitlePromise);

        enqueueJson({
          meta: {
            requestedModelFamily,
            speedMode,
            assistantMessageRowId: assistantRowId,
            userMessageRowId: userRowId,
            reasoningEffort: modelConfig.reasoning?.effort,
          },
        });

        try {
          const responseStream = await openai.responses.stream({
            model: targetModel,
            input: requestMessages,
            stream: true,
            tools: toolsForRequest.length ? toolsForRequest : undefined,
            tool_choice: toolChoice,
            include: allowWebSearch
              ? [
                  "web_search_call.results",
                  "web_search_call.action.sources",
                ]
              : undefined,
            reasoning: modelConfig.reasoning,
          });

          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const token = event.delta;
              if (token) {
                fullAssistantMessage += token;
                enqueueJson({ token });
              }
            } else if (
              event.type === "response.web_search_call.in_progress" ||
              event.type === "response.web_search_call.searching"
            ) {
              sendStatusUpdate({
                type: "search-start",
                query: "web search",
              });
            } else if (event.type === "response.web_search_call.completed") {
              sendStatusUpdate({
                type: "search-complete",
                query: "web search",
              });
            } else if (
              event.type === "response.file_search_call.in_progress" ||
              event.type === "response.file_search_call.searching"
            ) {
              sendStatusUpdate({ type: "file-reading-start" });
            } else if (event.type === "response.file_search_call.completed") {
              sendStatusUpdate({ type: "file-reading-complete" });
            } else if (isFileSearchCallFailedEvent(event)) {
              sendStatusUpdate({
                type: "file-reading-error",
                message: "Unable to read documents.",
              });
            }
          }

          const finalResponse = await responseStream.finalResponse();
          if (finalResponse.output_text) {
            fullAssistantMessage = finalResponse.output_text;
          }
          const searchMetadata = extractSearchMetadata(finalResponse);
          const usedWebSearch = searchMetadata.records.length > 0;
          const sources = buildSourceChips(searchMetadata.records);
          const citations = extractUrlCitations(finalResponse);
          if (sources.length > 0 || citations.length > 0) {
            console.log(
              `[sourcesDebug] aggregated sources chips=${sources.length} citations=${citations.length} conversationId=${conversationId}`
            );
          } else {
            console.log(
              `[sourcesDebug] aggregated sources count=0 conversationId=${conversationId}`
            );
          }
          if (searchMetadata.failed) {
            sendStatusUpdate({
              type: "search-error",
              query: "web search",
              message: "Web search failed; using prior knowledge.",
            });
          }
          responseMetadata = {
            usedModel: targetModel,
            usedModelMode: targetModelKey,
            usedModelFamily: targetModelFamily,
            requestedModelFamily,
            speedMode,
            reasoningEffort: modelConfig.reasoning?.effort,
            usedWebSearch,
            searchRecords: searchMetadata.records,
            sources,
            citations,
            vectorStoreIds,
            generationType: "text",
          };

          if (!assistantRowId) {
            try {
              const { data, error } = await supabase
                .from("messages")
                .insert({
                  conversation_id: conversationId,
                  role: "assistant",
                  content: fullAssistantMessage,
                  metadata: responseMetadata,
                })
                .select("id")
                .single();
              if (error) {
                console.error("Failed to persist assistant message", error);
              }
              assistantRowId = data?.id ?? null;
            } catch (persistErr) {
              console.error("Assistant message insert failed", persistErr);
            }
          } else {
            try {
              await supabase
                .from("messages")
                .update({
                  content: fullAssistantMessage,
                  metadata: responseMetadata,
                })
                .eq("id", assistantRowId);
            } catch (persistErr) {
              console.error("Assistant message update failed", persistErr);
            }
          }

          enqueueJson({
            meta: {
              ...responseMetadata,
              assistantMessageRowId: assistantRowId,
              userMessageRowId: userRowId,
            },
          });
          enqueueJson({
            type: "sources",
            conversationId,
            messageId: assistantRowId,
            sources: citations,
          });
          console.log(
            `[sourcesDebug] emitted sources payload conversationId=${conversationId} messageId=${assistantRowId} chips=${responseMetadata.sources.length} citations=${citations.length}`
          );
        } catch (err) {
          console.error("Stream error:", err);
          enqueueJson({ error: "upstream_error" });
        } finally {
          enqueueJson({ done: true });

          if (isFirstAssistantResponse && fullAssistantMessage.trim()) {
            await ensureChatTitle({
              openai,
              supabase,
              conversationId,
              userMessage: userMessageForTitle,
              assistantMessage: fullAssistantMessage,
            });
          }

          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Server error calling OpenAI" },
      { status: 500 }
    );
  }
}

type RouteModelArgs = {
  openai: OpenAI;
  history: HistoryMessage[];
  userText: string;
  requestedMode: ModelMode;
  requestTitle?: boolean;
};

type RoutedModelConfig = {
  modelKey: ModelKey;
  titleSuggestion?: string | null;
};

async function routeModel({
  openai,
  history,
  userText,
  requestedMode,
  requestTitle = false,
}: RouteModelArgs): Promise<RoutedModelConfig> {
  if (requestedMode === "nano" || requestedMode === "mini" || requestedMode === "full") {
    return {
      modelKey: requestedMode,
    };
  }

  try {
    const response = await openai.responses.create({
      model: MODEL_MAP.nano,
      input: [
        {
          role: "system",
          content:
            'Given the user message and recent context, respond with minified JSON {"mode":"nano|mini|full","title":"..."}. "mode" selects the response model: nano for trivial or short questions, mini for most normal questions, full for complex or high-stakes reasoning. If a title is not needed, set "title" to an empty string. When a title is requested, keep it to 3-8 words with no punctuation, emojis, or filler.',
        },
        {
          role: "user",
          content: buildRouterPrompt(history, userText, requestTitle),
        },
      ],
    });
    const content = response.output_text?.trim() ?? "";
    const parsed = parseRouterResponse(content);
    if (parsed?.mode) {
      return {
        modelKey: parsed.mode,
        titleSuggestion: requestTitle ? parsed.title ?? "" : undefined,
      };
    }
  } catch (error) {
    console.warn("Model router failed, defaulting to mini", error);
  }

  return {
    modelKey: "mini",
    titleSuggestion: null,
  };
}

function buildRouterPrompt(
  history: HistoryMessage[],
  userText: string,
  requestTitle: boolean
) {
  const recent = history.slice(-6).map((message) => {
    const speaker = message.role === "user" ? "User" : "Assistant";
    const attachmentNote = attachmentPlaceholder(
      message.attachments?.length ?? 0,
      message.files?.length ?? 0
    );
    const text = message.content?.trim().length
      ? message.content
      : attachmentNote || "(no text)";
    return attachmentNote
      ? `${speaker}: ${text} ${attachmentNote}`.trim()
      : `${speaker}: ${text}`;
  });

  const recentBlock = recent.length > 0 ? recent.join("\n") : "(no prior messages)";

  const titleDirective = requestTitle
    ? "Provide a concise chat title in the `title` field based solely on the latest user request."
    : "Set `title` to an empty string.";

  return `Recent conversation:
${recentBlock}

Latest user request:
${userText}

Respond with JSON containing keys "mode" and "title". ${titleDirective}`;
}

function parseRouterResponse(content: string) {
  try {
    const parsed = JSON.parse(content);
    const rawMode = typeof parsed.mode === "string" ? parsed.mode.toLowerCase() : "";
    const title = typeof parsed.title === "string" ? parsed.title : "";
    if (rawMode === "nano" || rawMode === "mini" || rawMode === "full") {
      return { mode: rawMode as ModelKey, title };
    }
  } catch {
    // ignore
  }

  const normalized = content.trim().toLowerCase();
  if (normalized === "nano" || normalized === "mini" || normalized === "full") {
    return { mode: normalized as ModelKey, title: "" };
  }
  return null;
}

function extractSearchMetadata(response: OpenAIResponse) {
  const records: SearchRecord[] = [];
  let failed = false;
  const outputs = Array.isArray(response.output) ? response.output : [];
  for (const item of outputs) {
    if (!isWebSearchCall(item)) {
      continue;
    }
    const call = item;
    if (call.status === "failed") {
      failed = true;
    }
    logWebSearchCall(call);
    const actions = Array.isArray(call.actions) ? call.actions : [];
    const searchAction = actions.find((action) => action?.type === "search");
    const query =
      typeof call.query === "string"
        ? call.query
        : typeof searchAction?.query === "string"
          ? searchAction.query
          : "web search";
    const rawResults = extractWebSearchResults(call);
    const rankedSources: RankedSource[] = rawResults.length
      ? rawResults
      : buildSourcesFromAction(searchAction);
    const summaryParts: string[] = [];
    summaryParts.push(`Query: ${query}`);
    if (rankedSources.length > 0) {
      summaryParts.push(
        `Found ${rankedSources.length} source${rankedSources.length === 1 ? "" : "s"}`
      );
    } else if (call.status === "failed") {
      summaryParts.push("Search failed");
    } else {
      summaryParts.push("No sources returned");
    }
    records.push({
      query,
      summary: summaryParts.join(". "),
      rankedSources,
      rawResults,
      fromCache: false,
    });
  }
  return { records, failed };
}

function extractUrlCitations(response: OpenAIResponse): Source[] {
  const citations: Source[] = [];
  const outputs = Array.isArray(response.output) ? response.output : [];
  outputs.forEach((item) => {
    if ((item as { type?: string }).type !== "message") {
      return;
    }
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: ResponseOutputMessage["content"] }).content || [])
      : [];
    content.forEach((block) => {
      if ((block as { type?: string }).type !== "output_text") {
        return;
      }
      const annotations = Array.isArray(
        (block as { annotations?: unknown }).annotations
      )
        ? ((block as { annotations: unknown[] }).annotations || [])
        : [];
      annotations.forEach((annotation) => {
        if ((annotation as { type?: string }).type !== "url_citation") {
          return;
        }
        const url = (annotation as { url?: unknown }).url;
        if (typeof url !== "string" || !url.trim()) {
          return;
        }
        const titleRaw = (annotation as { title?: unknown }).title;
        citations.push({
          url,
          title: typeof titleRaw === "string" ? titleRaw : null,
          startIndex: (annotation as { start_index?: number }).start_index ?? null,
          endIndex: (annotation as { end_index?: number }).end_index ?? null,
        });
      });
    });
  });
  return citations;
}

function logWebSearchCall(call: WebSearchCall) {
  try {
    const serialized = JSON.stringify(call);
    const trimmed = serialized.length > 2000 ? `${serialized.slice(0, 2000)}…` : serialized;
    console.log(`[webSearchDebug] result=${trimmed}`);
  } catch (error) {
    console.log("[webSearchDebug] unable to serialize web_search result", error);
  }
}

function extractWebSearchResults(call: WebSearchCall) {
  const aggregated: RankedSource[] = [];
  const pushCandidates = (candidate: unknown) => {
    if (!Array.isArray(candidate)) {
      return;
    }
    for (const item of candidate) {
      const normalized = normalizeWebSearchResult(item);
      if (normalized) {
        aggregated.push(normalized);
      }
    }
  };

  const inspectContent = (content: unknown) => {
    if (Array.isArray(content)) {
      for (const entry of content) {
        if (Array.isArray((entry as { results?: unknown }).results)) {
          pushCandidates((entry as { results?: unknown }).results);
        }
        if (typeof (entry as { text?: unknown }).text === "string") {
          const parsed = safeJsonParse((entry as { text: string }).text);
          if (Array.isArray((parsed as { results?: unknown })?.results)) {
            pushCandidates((parsed as { results?: unknown }).results);
          }
        }
      }
    }
  };

  pushCandidates(call.results);
  if (call.output && !Array.isArray(call.output)) {
    pushCandidates(call.output.results);
  }
  if (call.data?.results) {
    pushCandidates(call.data.results);
  }
  if (call.metadata?.results) {
    pushCandidates(call.metadata.results);
  }

  if (Array.isArray(call.output)) {
    for (const entry of call.output) {
      if (!entry) {
        continue;
      }
      pushCandidates(entry.results);
      inspectContent(entry.content);
      if (typeof entry.text === "string") {
        const parsed = safeJsonParse(entry.text);
        if (Array.isArray((parsed as { results?: unknown })?.results)) {
          pushCandidates((parsed as { results?: unknown }).results);
        }
      }
    }
  }

  if (aggregated.length > 0) {
    return aggregated;
  }

  if (Array.isArray(call.actions)) {
    for (const action of call.actions) {
      pushCandidates(action?.results);
    }
  }

  return aggregated;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildSourcesFromAction(action: WebSearchAction | undefined): RankedSource[] {
  if (!action?.sources) {
    return [];
  }
  return action.sources
    .map((source): RankedSource | null => {
      const url = typeof source?.url === "string" ? source.url : "";
      if (!url) {
        return null;
      }
      const domain = extractDomainFromUrl(url) || url;
      return {
        title: domain,
        url,
        snippet: "",
        domain,
        sourceType: "other",
        published: null,
        confidenceScore: 0.5,
      } satisfies RankedSource;
    })
    .filter((item): item is RankedSource => item !== null);
}

function normalizeWebSearchResult(result: unknown): RankedSource | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const data = result as Record<string, unknown>;
  const url =
    typeof data.url === "string"
      ? data.url
      : typeof data.link === "string"
        ? data.link
        : "";
  if (!url) {
    return null;
  }
  const title =
    typeof data.title === "string"
      ? data.title
      : typeof data.name === "string"
        ? data.name
        : url;
  const snippet =
    typeof data.snippet === "string"
      ? data.snippet
      : typeof data.excerpt === "string"
        ? data.excerpt
        : typeof data.summary === "string"
          ? data.summary
          : "";
  const published =
    typeof data.published_at === "string"
      ? data.published_at
      : typeof data.date === "string"
        ? data.date
        : null;
  const domain =
    extractDomainFromUrl(url) ||
    (typeof data.domain === "string" ? data.domain : undefined) ||
    (typeof data.site === "string" ? data.site : undefined) ||
    url;
  const sourceTypeRaw =
    typeof data.source_type === "string"
      ? data.source_type.toLowerCase()
      : "";
  const sourceType: RankedSource["sourceType"] =
    sourceTypeRaw === "official" ||
    sourceTypeRaw === "news" ||
    sourceTypeRaw === "reference"
      ? (sourceTypeRaw as RankedSource["sourceType"])
      : "other";
  const confidenceRaw =
    typeof data.score === "number"
      ? data.score
      : typeof data.confidence === "number"
        ? data.confidence
        : 0.5;
  return {
    title,
    url,
    snippet,
    domain,
    sourceType,
    published,
    confidenceScore: clampConfidence(confidenceRaw),
  };
}

function clampConfidence(value: number) {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

async function ensureChatTitle({
  openai,
  supabase,
  conversationId,
  userMessage,
  assistantMessage,
  allowUserOnly = false,
}: {
  openai: OpenAI;
  supabase: ReturnType<typeof getServerSupabaseClient>;
  conversationId: string;
  userMessage: string;
  assistantMessage: string | null;
  allowUserOnly?: boolean;
}) {
  const trimmedAssistant = (assistantMessage || "").trim();
  const trimmedUser = userMessage.trim();

  if (!trimmedUser) {
    return;
  }

  if (!trimmedAssistant && !allowUserOnly) {
    return;
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", conversationId)
    .single();

  if (error) {
    console.warn("Unable to load conversation for title", error);
    return;
  }

  const existingTitle = (conversation?.title || "").trim();
  if (existingTitle && existingTitle !== "New chat" && existingTitle !== "Untitled chat") {
    return;
  }

  const titleModelFamily: Exclude<ModelFamily, "auto"> = "gpt-5-nano";
  const titleModelConfig = getModelAndReasoningConfig(
    titleModelFamily,
    "instant",
    trimmedAssistant || trimmedUser
  );
  console.log(
    `[titleDebug] generating title for conversationId=${conversationId} using model=${titleModelConfig.model} effort=${
      titleModelConfig.reasoning?.effort ?? "omitted"
    }`
  );

  try {
    const response = await openai.responses.create({
      model: titleModelConfig.model,
      input: [
        {
          role: "system",
          content:
            "You write ultra-short, specific chat titles (3-8 words). Avoid punctuation, quotes, emojis, and filler phrases. Respond with the title only.",
        },
        trimmedAssistant
          ? {
              role: "user" as const,
              content: `User message:\n${trimmedUser}\n\nAssistant reply:\n${trimmedAssistant}\n\nTitle:`,
            }
          : {
              role: "user" as const,
              content: `User message:\n${trimmedUser}\n\nTitle:`,
            },
      ],
      reasoning: titleModelConfig.reasoning,
    });

    const rawTitle = response.output_text?.trim() || "";
    const normalized = normalizeGeneratedTitle(rawTitle);
    if (!normalized) {
      return;
    }

    await supabase
      .from("conversations")
      .update({ title: normalized })
      .eq("id", conversationId);
  } catch (err) {
    console.warn("Title generation failed", err);
  }
}

async function buildCrossChatSummary({
  supabase,
  userId,
  excludeConversationId,
}: {
  supabase: ReturnType<typeof getServerSupabaseClient>;
  userId: string;
  excludeConversationId: string;
}): Promise<string | null> {
  try {
    const { data: otherConversations, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .neq("id", excludeConversationId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !otherConversations?.length) {
      return null;
    }

    const conversationIds = otherConversations
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
    if (!conversationIds.length) {
      return null;
    }

    const { data: otherMessages, error: otherMessagesError } = await supabase
      .from("messages")
      .select("conversation_id, role, content")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(200);

    if (otherMessagesError || !otherMessages?.length) {
      return null;
    }

    const recentUserMessages = otherMessages
      .filter(
        (row): row is { conversation_id: unknown; role: "user"; content: string } =>
          row?.role === "user" && typeof row?.content === "string"
      )
      .map((row) => row.content)
      .slice(0, 80);

    if (!recentUserMessages.length) {
      return null;
    }

    return summarizeOtherChats(recentUserMessages);
  } catch (error) {
    console.warn("Unable to summarize cross-chat behavior", error);
    return null;
  }
}

function summarizeOtherChats(contents: string[]): string | null {
  const frequency = new Map<string, number>();
  contents.forEach((entry) => {
    const normalized = entry
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(
        (token) => token.length >= 4 && !CROSS_CHAT_STOP_WORDS.has(token)
      );
    const uniqueTokens = new Set(normalized);
    uniqueTokens.forEach((token) => {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    });
  });
  const ranked = Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);
  if (!ranked.length) {
    return null;
  }
  return `Top recurring topics from the user's other chats include ${ranked.join(", ")}.`;
}

async function requestNanoTitle({
  openai,
  userMessage,
}: {
  openai: OpenAI;
  userMessage: string;
}): Promise<string | null> {
  const modelConfig = getModelAndReasoningConfig(
    "gpt-5-nano",
    "instant",
    userMessage
  );
  console.log(
    `[titleDebug] generating quick title using model=${modelConfig.model} effort=${
      modelConfig.reasoning?.effort ?? "omitted"
    }`
  );
  try {
    const response = await openai.responses.create({
      model: modelConfig.model,
      input: [
        {
          role: "system",
          content:
            "You create short chat titles (3-8 words) from a single user prompt. Avoid punctuation, emojis, and filler words. Respond with the title only.",
        },
        {
          role: "user",
          content: `User message:\n${userMessage}\n\nTitle:`,
        },
      ],
      reasoning: modelConfig.reasoning,
    });

    return response.output_text?.trim() || null;
  } catch (error) {
    console.warn("Nano title request failed", error);
    return null;
  }
}

async function applyTitleSuggestion({
  supabase,
  conversationId,
  suggestedTitle,
}: {
  supabase: ReturnType<typeof getServerSupabaseClient>;
  conversationId: string;
  suggestedTitle?: string | null;
}): Promise<string | null> {
  const normalized = normalizeGeneratedTitle(suggestedTitle);
  if (!normalized) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", conversationId)
      .single();

    if (error) {
      console.warn("Unable to load conversation for title update", error);
      return null;
    }

    if (!isPlaceholderTitle(data?.title)) {
      return null;
    }

    await supabase
      .from("conversations")
      .update({ title: normalized })
      .eq("id", conversationId);

    return normalized;
  } catch (error) {
    console.warn("Failed to apply title suggestion", error);
    return null;
  }
}
