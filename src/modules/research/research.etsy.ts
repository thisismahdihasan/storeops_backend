import { z } from "zod";
import env from "../../config/env.js";
import type { EtsyMetadata } from "./research.type.js";

const ETSY_API_BASE_URL = "https://openapi.etsy.com/v3/application/listings";
const ETSY_API_TIMEOUT_MS = 5_000;

const etsyListingResponseSchema = z.object({
  title: z.string().nullable().optional(),
  images: z.array(z.object({
    rank: z.number().nullable().optional(),
    url_fullxfull: z.string().nullable().optional(),
    url_570xN: z.string().nullable().optional(),
  })).nullable().optional(),
});

const emptyMetadata = (): EtsyMetadata => ({
  title: null,
  referenceImageUrl: null,
});

export const decodeEtsyTitleEntities = (value: string): string => value.replace(
  /&(amp|apos|quot|lt|gt|nbsp);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
  (entity, named: string | undefined, decimal: string | undefined, hexadecimal: string | undefined) => {
    if (named) return ({ amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: "\u00a0" } as Record<string, string>)[named] ?? entity;
    const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", hexadecimal ? 16 : 10);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity;
    try { return String.fromCodePoint(codePoint); } catch { return entity; }
  },
);

export const normalizeEtsyTitle = (title: string | null | undefined): string | null => {
  const trimmed = title ? decodeEtsyTitleEntities(title).trim() : "";
  return trimmed ? trimmed.slice(0, 500) : null;
};

const normalizeImageUrl = (url: string | null | undefined): string | null => {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) return null;

  try {
    const parsedUrl = new URL(trimmed);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
      ? parsedUrl.toString()
      : null;
  } catch {
    return null;
  }
};

// Fetches only the official Etsy listing metadata required by the research flow.
export const fetchEtsyListingFromApi = async (
  etsyListingId: string,
): Promise<EtsyMetadata> => {
  const keystring = env.ETSY_API_KEYSTRING?.trim();
  const sharedSecret = env.ETSY_API_SHARED_SECRET?.trim();
  if (!keystring || !sharedSecret) {
    console.warn("Etsy API metadata fetch skipped because credentials are not configured");
    return emptyMetadata();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ETSY_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${ETSY_API_BASE_URL}/${encodeURIComponent(etsyListingId)}?includes=Images`,
      {
        headers: {
          Accept: "application/json",
          "x-api-key": `${keystring}:${sharedSecret}`,
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn("Etsy API metadata request failed", { status: response.status });
      return emptyMetadata();
    }

    const parsedResponse = etsyListingResponseSchema.safeParse(await response.json());
    if (!parsedResponse.success) {
      console.warn("Etsy API metadata response did not match the expected shape");
      return emptyMetadata();
    }

    const images = parsedResponse.data.images ?? [];
    const primaryImage = images.find((image) => image.rank === 1) ?? images[0];
    const referenceImageUrl = primaryImage
      ? normalizeImageUrl(primaryImage.url_fullxfull) ?? normalizeImageUrl(primaryImage.url_570xN)
      : null;

    return {
      title: normalizeEtsyTitle(parsedResponse.data.title),
      referenceImageUrl,
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "timeout"
      : "network error";
    console.warn("Etsy API metadata request failed", { reason });
    return emptyMetadata();
  } finally {
    clearTimeout(timeout);
  }
};
