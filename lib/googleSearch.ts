export type GoogleSearchResult = {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
};

export type GoogleSearchResponse = {
  results: GoogleSearchResult[];
  fromCache: boolean;
  cacheAgeMs: number;
};

export class MissingGoogleConfigError extends Error {
  constructor(message = "Missing Google Custom Search configuration") {
    super(message);
    this.name = "MissingGoogleConfigError";
  }
}

export class GoogleSearchRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSearchRequestError";
  }
}

type GoogleSearchOptions = {
  /** Bias toward more recent results when true. */
  preferRecent?: boolean;
  /** When true, only return cached results and never hit Google. */
  cacheOnly?: boolean;
};

type CachedEntry = {
  timestamp: number;
  results: GoogleSearchResult[];
};

const SEARCH_CACHE = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 45_000;

function buildCacheKey(query: string, preferRecent: boolean) {
  return `${query.trim().toLowerCase()}|recent:${preferRecent ? "1" : "0"}`;
}

function getValidCache(key: string) {
  const cached = SEARCH_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return cached;
}

export function peekCachedSearch(
  query: string,
  preferRecent = false
): { results: GoogleSearchResult[]; ageMs: number } | null {
  const key = buildCacheKey(query, preferRecent);
  const cached = getValidCache(key);
  if (!cached) {
    return null;
  }
  return { results: cached.results, ageMs: Date.now() - cached.timestamp };
}

export async function googleSearch(
  query: string,
  options: GoogleSearchOptions = {}
): Promise<GoogleSearchResponse> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;

  if (!apiKey || !cx) {
    console.error(
      `[googleSearch] Missing config (key len=${apiKey?.length ?? 0}, cx len=${cx?.length ?? 0})`
    );
    throw new MissingGoogleConfigError();
  }

  const preferRecent = Boolean(options.preferRecent);
  const adjustedQuery = preferRecent ? `${query} latest` : query;
  const cacheKey = buildCacheKey(query, preferRecent);
  const cached = getValidCache(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.timestamp;
    console.log(
      `[googleSearch] cacheHit query="${query}" preferRecent=${preferRecent} ageMs=${ageMs}`
    );
    return { results: cached.results, fromCache: true, cacheAgeMs: ageMs };
  }

  if (options.cacheOnly) {
    return { results: [], fromCache: false, cacheAgeMs: 0 };
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", adjustedQuery);
  if (preferRecent) {
    url.searchParams.set("sort", "date");
    url.searchParams.set("dateRestrict", "m6");
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw new GoogleSearchRequestError(
      error instanceof Error ? error.message : "Failed to reach Google Custom Search"
    );
  }

  const payload = (await response.json()) as {
    items?: GoogleSearchResult[];
    error?: { message?: string };
  };

  if (!response.ok) {
    const message =
      (payload?.error?.message as string | undefined) ||
      `Google Custom Search responded with status ${response.status}`;
    throw new GoogleSearchRequestError(message);
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!items.length) {
    const empty: GoogleSearchResult[] = [];
    SEARCH_CACHE.set(cacheKey, { timestamp: Date.now(), results: empty });
    return { results: empty, fromCache: false, cacheAgeMs: 0 };
  }

  const normalized = items.map((item: Partial<GoogleSearchResult>) => ({
    title: (item?.title as string | undefined) || "Untitled result",
    link: (item?.link as string | undefined) || "",
    snippet: (item?.snippet as string | undefined) || "",
    displayLink: (item?.displayLink as string | undefined) ||
      (item?.link as string | undefined) ||
      "",
  }));

  SEARCH_CACHE.set(cacheKey, { timestamp: Date.now(), results: normalized });
  return { results: normalized, fromCache: false, cacheAgeMs: 0 };
}
