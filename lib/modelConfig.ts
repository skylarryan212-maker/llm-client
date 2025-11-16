export type SpeedMode = "auto" | "instant" | "thinking";
export type ModelFamily = "auto" | "gpt-5.1" | "gpt-5-mini" | "gpt-5-nano";
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface ModelConfig {
  model: string;
  reasoning?: {
    effort: ReasoningEffort;
  };
}

const MODEL_ID_MAP: Record<Exclude<ModelFamily, "auto">, string> = {
  "gpt-5.1": "gpt-5.1-2025-11-13",
  "gpt-5-mini": "gpt-5-mini-2025-08-07",
  "gpt-5-nano": "gpt-5-nano-2025-08-07",
};

const LIGHT_REASONING_KEYWORDS = [
  "step by step",
  "analyze",
  "analysis",
  "explain",
  "break down",
  "derive",
  "prove",
  "detailed",
  "strategy",
  "plan",
  "evaluate",
  "compare",
  "contrast",
  "investigate",
  "why",
  "how",
  "improve",
];

const HIGH_COMPLEXITY_KEYWORDS = [
  "research",
  "comprehensive",
  "in-depth",
  "long-form",
  "whitepaper",
  "architecture",
  "roadmap",
  "algorithm",
  "implementation",
  "financial model",
];

const LONG_PROMPT_THRESHOLD = 360;
const MEDIUM_PROMPT_THRESHOLD = 640;
const HIGH_PROMPT_THRESHOLD = 900;

export function shouldUseLightReasoning(promptText: string) {
  const normalized = promptText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length >= LONG_PROMPT_THRESHOLD) {
    return true;
  }
  return LIGHT_REASONING_KEYWORDS.some((keyword) =>
    normalized.includes(keyword)
  );
}

export function pickMediumOrHigh(promptText: string): "medium" | "high" {
  const normalized = promptText.trim().toLowerCase();
  if (normalized.length >= HIGH_PROMPT_THRESHOLD) {
    return "high";
  }
  if (
    HIGH_COMPLEXITY_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
    normalized.split(/[.!?]/).some((segment) => segment.trim().length > 200)
  ) {
    return "high";
  }
  return "medium";
}

function autoReasoningForModelAndPrompt(
  promptText: string,
  modelFamily: Exclude<ModelFamily, "auto">
): ReasoningEffort | null {
  const normalized = promptText.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length >= HIGH_PROMPT_THRESHOLD * 1.2) {
    return "high";
  }
  if (normalized.length >= MEDIUM_PROMPT_THRESHOLD) {
    return "medium";
  }
  if (shouldUseLightReasoning(normalized)) {
    return "low";
  }
  if (/\b(plan|roadmap|design|strategy|debug)\b/i.test(normalized)) {
    return "medium";
  }
  if (modelFamily === "gpt-5.1" && normalized.length >= LONG_PROMPT_THRESHOLD) {
    return "low";
  }
  return null;
}

export function getModelAndReasoningConfig(
  modelFamily: ModelFamily,
  speedMode: SpeedMode,
  promptText: string
): ModelConfig {
  const resolvedFamily: Exclude<ModelFamily, "auto"> =
    modelFamily === "auto" ? "gpt-5-mini" : modelFamily;
  const model = MODEL_ID_MAP[resolvedFamily];
  const trimmedPrompt = promptText.trim();

  if (speedMode === "instant") {
    const needsLightReasoning = shouldUseLightReasoning(trimmedPrompt);
    if (!needsLightReasoning) {
      if (resolvedFamily === "gpt-5.1") {
        return { model, reasoning: { effort: "none" } };
      }
      return { model };
    }
    return { model, reasoning: { effort: "low" } };
  }

  if (speedMode === "thinking") {
    return { model, reasoning: { effort: pickMediumOrHigh(trimmedPrompt) } };
  }

  const autoEffort = autoReasoningForModelAndPrompt(
    trimmedPrompt,
    resolvedFamily
  );
  if (!autoEffort || autoEffort === "none") {
    if (resolvedFamily === "gpt-5.1") {
      return { model, reasoning: { effort: "none" } };
    }
    return { model };
  }
  return { model, reasoning: { effort: autoEffort } };
}

export function describeModelFamily(family: ModelFamily) {
  switch (family) {
    case "gpt-5.1":
      return "5.1";
    case "gpt-5-mini":
      return "5 Mini";
    case "gpt-5-nano":
      return "5 Nano";
    default:
      return "Auto";
  }
}
