import type { ModelFamily, ReasoningEffort, SpeedMode } from "./modelConfig";

export type Source = {
  url: string;
  title?: string | null;
  domain?: string | null;
  startIndex?: number | null;
  endIndex?: number | null;
};

export type SourceChip = {
  id: number;
  title: string;
  url: string;
  domain: string;
};

export type ImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
};

export type FileAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
};

export type ModelMode = "auto" | "nano" | "mini" | "full";
export type ImageModelKey = "gpt-image-1" | "gpt-image-1-mini";

export type SearchSource = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published?: string | null;
  sourceType?: string;
  confidenceScore?: number;
};

export type SearchRecord = {
  query: string;
  summary: string;
  rankedSources: SearchSource[];
  rawResults?: SearchSource[];
  fromCache?: boolean;
};

export type MessageMetadata = {
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedModelFamily?: ModelFamily;
  requestedModelMode?: ModelMode;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
  searchedDomains?: string[];
  thoughtDurationSeconds?: number;
  thoughtDurationLabel?: string;
  thinkingDurationMs?: number;
  thinking?: {
    effort?: ReasoningEffort | null;
    durationSeconds?: number;
    durationMs?: number;
  };
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

export type GeneratedImageResult = {
  id: string;
  dataUrl: string;
  model: ImageModelKey;
  prompt?: string;
};

export type ChatMessage = {
  id?: string;
  persistedId?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  files?: FileAttachment[];
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedModelFamily?: ModelFamily;
  requestedModelMode?: ModelMode;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
  metadata?: MessageMetadata;
  thoughtDurationSeconds?: number;
  thoughtDurationLabel?: string;
};
