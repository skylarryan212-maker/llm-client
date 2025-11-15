export type GoogleSearchResult = {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
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
};

export async function googleSearch(
  query: string,
  options: GoogleSearchOptions = {}
): Promise<GoogleSearchResult[]> {
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
    return [];
  }

  return items.map((item: Partial<GoogleSearchResult>) => ({
    title: (item?.title as string | undefined) || "Untitled result",
    link: (item?.link as string | undefined) || "",
    snippet: (item?.snippet as string | undefined) || "",
    displayLink: (item?.displayLink as string | undefined) ||
      (item?.link as string | undefined) ||
      "",
  }));
}
