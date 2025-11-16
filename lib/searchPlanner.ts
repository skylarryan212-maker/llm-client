import type { GoogleSearchResult } from "./googleSearch";

export type SearchTopic =
  | "weather"
  | "stocks"
  | "crypto"
  | "hardware"
  | "news"
  | "general";

export type RankedSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  sourceType: "official" | "news" | "reference" | "other";
  published: string | null;
  confidenceScore: number;
};

export type NormalizedSearchPlan = {
  skipSearch: boolean;
  reason?: string;
  query: string;
  preferRecent: boolean;
  topic: SearchTopic | null;
  intent: "meta" | "fresh" | "stable";
};

const META_PATTERNS = [
  /\b(?:can|could|would) you (?:browse|access|use) (?:the )?(?:internet|web)/i,
  /\b(?:do|can) you have internet/i,
  /\bwhat(?:'s| is) your knowledge cutoff/i,
  /\bwhen were you (?:trained|last updated)/i,
  /\bare you able to search/i,
  /\bwhy can't you (?:search|browse)/i,
  /\bwhat model are you/i,
  /\bhow do your tools work/i,
];

const FRESH_KEYWORDS = [
  "current",
  "currently",
  "today",
  "tonight",
  "latest",
  "breaking",
  "just",
  "new",
  "newest",
  "recent",
  "right now",
  "this week",
  "this month",
  "this year",
  "price",
  "prices",
  "market",
  "stock",
  "stocks",
  "share",
  "earnings",
  "forecast",
  "weather",
  "humidity",
  "temperature",
  "release",
  "launch",
  "update",
  "live",
  "quote",
  "rate",
  "trend",
  "report",
  "today's",
  "guidance",
  "outlook",
];

const WEATHER_KEYWORDS = [
  "weather",
  "forecast",
  "temperature",
  "humidity",
  "rain",
  "snow",
  "wind",
  "conditions",
];

const HARDWARE_KEYWORDS = [
  "gpu",
  "graphics",
  "graphics card",
  "graphics cards",
  "cpu",
  "processor",
  "chip",
  "chips",
  "rtx",
  "rx",
  "gaming pc",
  "console",
  "playstation",
  "xbox",
  "nvidia",
  "amd",
  "intel",
  "laptop",
  "phone",
  "smartphone",
  "camera",
  "tablet",
  "wearable",
];

const NEWS_KEYWORDS = [
  "news",
  "headline",
  "breaking",
  "coverage",
  "happening",
  "story",
  "updates",
  "reported",
  "announcement",
];

const STOCK_ALIASES: Record<string, string> = {
  apple: "AAPL",
  aapl: "AAPL",
  tesla: "TSLA",
  tsla: "TSLA",
  nvidia: "NVDA",
  nvda: "NVDA",
  microsoft: "MSFT",
  msft: "MSFT",
  amazon: "AMZN",
  amzn: "AMZN",
  alphabet: "GOOGL",
  google: "GOOGL",
  goog: "GOOGL",
  googl: "GOOGL",
  meta: "META",
  facebook: "META",
  amd: "AMD",
  intel: "INTC",
  netflix: "NFLX",
  nflx: "NFLX",
  qualcomm: "QCOM",
  qcom: "QCOM",
  broadcom: "AVGO",
  avgo: "AVGO",
};

const CRYPTO_ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  eth: "ETH",
  solana: "SOL",
  sol: "SOL",
  ripple: "XRP",
  xrp: "XRP",
  cardano: "ADA",
  ada: "ADA",
};

const OFFICIAL_DOMAINS = new Set([
  "amd.com",
  "nvidia.com",
  "intel.com",
  "apple.com",
  "tesla.com",
  "sec.gov",
  "weather.gov",
  "noaa.gov",
  "metoffice.gov.uk",
  "finance.yahoo.com",
  "investor.apple.com",
  "samsung.com",
  "sony.com",
  "microsoft.com",
]);

const REFERENCE_DOMAINS = new Set([
  "wikipedia.org",
  "britannica.com",
  "investopedia.com",
]);

const NEWS_DOMAINS = new Set([
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "bbc.com",
  "theverge.com",
  "arstechnica.com",
  "cnbc.com",
  "apnews.com",
  "techcrunch.com",
]);

const MONTH_PATTERN =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;

const YEAR_PATTERN = /\b20\d{2}\b/;

function sanitizeQuery(text: string) {
  return text
    .replace(/^["'“”‘’\s]+/g, "")
    .replace(/["'“”‘’]+$/g, "")
    .replace(
      /\b(?:please|kindly|could you|would you|can you|tell me|show me|give me|find|look up|search|google|explain|help me with)\b/gi,
      ""
    )
    .replace(/\b(?:for me|for us|about|on the internet)\b/gi, "")
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function extractWeatherLocation(text: string) {
  const match = text.match(/(?:weather|forecast|temperature|conditions)\s+(?:in|for)\s+([^?.,]+)/i);
  if (match) {
    return sanitizeQuery(match[1]);
  }
  const stripped = text
    .replace(/\b(?:what'?s|what is|give me|show me|tell me)\b/gi, "")
    .replace(/\b(?:the )?(?:weather|forecast|temperature|conditions|like)\b/gi, "")
    .replace(/\b(?:today|right now|currently)\b/gi, "")
    .trim();
  return sanitizeQuery(stripped);
}

function buildWeatherQuery(cleaned: string) {
  const location = extractWeatherLocation(cleaned);
  const base = location
    ? `${location} current weather conditions`
    : "current weather conditions";
  return `${base} temperature humidity site:noaa.gov OR site:weather.com OR site:accuweather.com`;
}

function detectTicker(text: string) {
  const lower = text.toLowerCase();
  const mentionsStockKeyword = /stock|share|market|price|quote|ticker|trading|close|open|earnings/.test(lower);
  const mentionsCryptoKeyword = /crypto|coin|token|blockchain|price|trading|quote|defi/.test(lower);

  if (mentionsStockKeyword) {
    for (const [alias, ticker] of Object.entries(STOCK_ALIASES)) {
      if (lower.includes(alias)) {
        return { ticker, topic: "stocks" as const };
      }
    }
    const tickerMatch = lower.match(/\b[A-Z]{1,5}\b/);
    if (tickerMatch) {
      return { ticker: tickerMatch[0].toUpperCase(), topic: "stocks" as const };
    }
  }

  if (mentionsCryptoKeyword) {
    for (const [alias, symbol] of Object.entries(CRYPTO_ALIASES)) {
      if (lower.includes(alias)) {
        return { ticker: symbol, topic: "crypto" as const };
      }
    }
  }

  return null;
}

function buildTickerQuery(ticker: string, topic: "stocks" | "crypto") {
  if (topic === "stocks") {
    return `${ticker} stock price live quote today site:finance.yahoo.com OR site:reuters.com OR site:cnbc.com`;
  }
  return `${ticker} crypto price live quote today site:coinmarketcap.com OR site:coindesk.com`;
}

function buildHardwareQuery(cleaned: string) {
  const trimmed = cleaned
    .replace(
      /\b(latest|current|new|newest|recent|release|launch|gpu|graphics|graphics card|graphics cards|cpu|processor|laptop|phone)\b/gi,
      ""
    )
    .trim();
  const target = trimmed || cleaned;
  return `${target} latest release date specs site:wikipedia.org OR site:theverge.com OR site:tomshardware.com OR site:anandtech.com OR site:amd.com OR site:nvidia.com OR site:intel.com OR site:apple.com`;
}

function buildNewsQuery(cleaned: string) {
  return `${cleaned} latest updates site:reuters.com OR site:apnews.com OR site:bbc.com`;
}

function buildGeneralFreshQuery(cleaned: string) {
  return `${cleaned} latest updates site:reuters.com OR site:apnews.com OR site:wikipedia.org`;
}

export function planSearchQuery(
  inputText: string,
  options: { userText?: string } = {}
): NormalizedSearchPlan {
  const fallback = (options.userText || "").trim();
  const primary = (inputText || "").trim();
  const reference = primary || fallback;
  if (!reference) {
    return {
      skipSearch: true,
      reason: "empty input",
      query: "",
      preferRecent: false,
      topic: null,
      intent: "stable",
    };
  }

  const metaTarget = (options.userText || reference).toLowerCase();
  if (META_PATTERNS.some((pattern) => pattern.test(metaTarget))) {
    return {
      skipSearch: true,
      reason: "meta or capability question",
      query: sanitizeQuery(reference),
      preferRecent: false,
      topic: null,
      intent: "meta",
    };
  }

  const cleaned = sanitizeQuery(primary || fallback || reference);
  if (!cleaned) {
    return {
      skipSearch: true,
      reason: "query could not be normalized",
      query: "",
      preferRecent: false,
      topic: null,
      intent: "stable",
    };
  }

  const combinedContext = `${primary} ${fallback}`.trim() || cleaned;
  const lower = combinedContext.toLowerCase();
  const tickerInfo = detectTicker(combinedContext);

  let topic: SearchTopic | null = null;
  let preferRecent = false;
  let query = cleaned;
  let intent: "meta" | "fresh" | "stable" = "stable";

  const mentionsWeather = containsAny(lower, WEATHER_KEYWORDS);
  if (mentionsWeather) {
    topic = "weather";
    preferRecent = true;
    intent = "fresh";
    query = buildWeatherQuery(combinedContext);
  } else if (tickerInfo) {
    topic = tickerInfo.topic;
    preferRecent = true;
    intent = "fresh";
    query = buildTickerQuery(tickerInfo.ticker, tickerInfo.topic);
  } else if (containsAny(lower, HARDWARE_KEYWORDS) && containsAny(lower, FRESH_KEYWORDS)) {
    topic = "hardware";
    preferRecent = true;
    intent = "fresh";
    query = buildHardwareQuery(cleaned);
  } else if (containsAny(lower, NEWS_KEYWORDS)) {
    topic = "news";
    preferRecent = true;
    intent = "fresh";
    query = buildNewsQuery(cleaned);
  } else if (containsAny(lower, FRESH_KEYWORDS)) {
    topic = "general";
    preferRecent = true;
    intent = "fresh";
    query = buildGeneralFreshQuery(cleaned);
  }

  return {
    skipSearch: false,
    reason: preferRecent
      ? "live data likely useful"
      : "proceeding with normalized query",
    query,
    preferRecent,
    topic,
    intent,
  };
}

function normalizeTitle(value: string) {
  return value.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function extractDomain(link: string) {
  try {
    const url = new URL(link.startsWith("http") ? link : `https://${link}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return link.trim().replace(/^www\./i, "");
  }
}

function classifyDomain(domain: string) {
  if (OFFICIAL_DOMAINS.has(domain)) return "official" as const;
  if (REFERENCE_DOMAINS.has(domain)) return "reference" as const;
  if (NEWS_DOMAINS.has(domain)) return "news" as const;
  return "other" as const;
}

function extractPublishedText(text: string) {
  const monthMatch = text.match(MONTH_PATTERN);
  const yearMatch = text.match(YEAR_PATTERN);
  if (monthMatch && yearMatch) {
    return `${monthMatch[0]} ${yearMatch[0]}`;
  }
  if (yearMatch) {
    return yearMatch[0];
  }
  return null;
}

export function normalizeAndRankSources(
  results: GoogleSearchResult[]
): RankedSource[] {
  const seen = new Set<string>();
  const ranked: RankedSource[] = [];

  for (const item of results) {
    const title = item.title?.trim() || "Untitled result";
    const snippet = (item.snippet ?? "").replace(/\s+/g, " ").trim();
    const url = item.link || item.displayLink || "";
    if (!url) {
      continue;
    }
    const domain = extractDomain(url);
    const normalizedKey = `${domain}|${normalizeTitle(title)}`;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);

    const sourceType = classifyDomain(domain);
    const published = extractPublishedText(`${title} ${snippet}`);
    let confidence = 0.6;
    if (sourceType === "official") confidence = 0.95;
    else if (sourceType === "reference") confidence = 0.85;
    else if (sourceType === "news") confidence = 0.8;

    if (published) {
      const yearMatch = published.match(/20\d{2}/);
      if (yearMatch && Number(yearMatch[0]) >= new Date().getFullYear() - 1) {
        confidence += 0.03;
      }
    }

    ranked.push({
      title,
      snippet,
      url,
      domain,
      sourceType,
      published,
      confidenceScore: Math.min(confidence, 0.99),
    });
  }

  ranked.sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) {
      return b.confidenceScore - a.confidenceScore;
    }
    const yearA = a.published ? Number(a.published.match(/20\d{2}/)?.[0] ?? 0) : 0;
    const yearB = b.published ? Number(b.published.match(/20\d{2}/)?.[0] ?? 0) : 0;
    if (yearB !== yearA) {
      return yearB - yearA;
    }
    return 0;
  });

  return ranked.slice(0, 8);
}
