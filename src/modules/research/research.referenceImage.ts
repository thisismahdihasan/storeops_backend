import dns from "node:dns/promises";
import net from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { ApiError } from "../../shared/ApiError.js";

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_CONTENT_LENGTH_BYTES = 15 * 1024 * 1024; // 15 MB

export type SafeImageFetchResult = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export type SafeImageFetchOptions = {
  customFetch?: typeof fetch;
  timeoutMs?: number;
};

const stripBrackets = (ip: string): string => {
  let clean = ip.toLowerCase().trim();
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1);
  }
  return clean;
};

const isPrivateOrLocalIpv4 = (ip: string): boolean => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (ip === "255.255.255.255") return true; // broadcast

  return false;
};

// Checks whether an IP string belongs to a private, loopback, link-local, or broadcast range.
export const isPrivateOrLocalIp = (rawIp: string): boolean => {
  const clean = stripBrackets(rawIp);

  const ipType = net.isIP(clean);
  if (ipType === 4) {
    return isPrivateOrLocalIpv4(clean);
  }

  if (ipType === 6) {
    if (clean === "::1" || clean === "::") {
      return true;
    }
    // fe80::/10 link-local (fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(clean)) {
      return true;
    }
    // fc00::/7 unique local (fc, fd)
    if (/^f[cd]/i.test(clean)) {
      return true;
    }

    // IPv4-mapped IPv6: dot-decimal (e.g. ::ffff:127.0.0.1)
    const v4MappedPrefix = "::ffff:";
    if (clean.startsWith(v4MappedPrefix)) {
      const remainder = clean.slice(v4MappedPrefix.length);
      if (remainder.includes(".")) {
        return isPrivateOrLocalIpv4(remainder);
      }
    }

    // IPv4-mapped IPv6 in hex or expanded notation (e.g. ::ffff:7f00:1)
    const doubleColonCount = (clean.match(/::/g) || []).length;
    if (doubleColonCount <= 1) {
      let parts: string[] = [];
      if (clean.includes("::")) {
        const [leftStr, rightStr] = clean.split("::");
        const left = leftStr ? leftStr.split(":") : [];
        const right = rightStr ? rightStr.split(":") : [];
        const missing = 8 - (left.length + right.length);
        parts = [...left, ...Array(missing).fill("0"), ...right];
      } else {
        parts = clean.split(":");
      }

      if (parts.length === 8) {
        const words = parts.map((p) => parseInt(p, 16));
        if (
          words[0] === 0 &&
          words[1] === 0 &&
          words[2] === 0 &&
          words[3] === 0 &&
          words[4] === 0 &&
          words[5] === 0xffff
        ) {
          const b1 = (words[6] >> 8) & 0xff;
          const b2 = words[6] & 0xff;
          const b3 = (words[7] >> 8) & 0xff;
          const b4 = words[7] & 0xff;
          return isPrivateOrLocalIpv4(`${b1}.${b2}.${b3}.${b4}`);
        }
      }
    }
  }

  return false;
};

// Determines whether an image URL is a trusted Cloudinary asset (https://res.cloudinary.com).
export const isCloudinaryUrl = (rawUrl: string): boolean => {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "res.cloudinary.com" &&
      (parsed.port === "" || parsed.port === "443")
    );
  } catch {
    return false;
  }
};

// Resolves hostnames via DNS and confirms destination addresses do not point to internal or private networks (SSRF defense).
export const validateUrlSafety = async (rawUrl: string): Promise<URL> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(502, "Unable to load reference image");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(502, "Unable to load reference image");
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHost = (
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname
  ).replace(/\.$/, "");

  // Block obvious local names
  if (cleanHost === "localhost" || cleanHost.endsWith(".localhost")) {
    throw new ApiError(502, "Unable to load reference image");
  }

  // Check if hostname is literal IP
  if (isPrivateOrLocalIp(cleanHost)) {
    throw new ApiError(502, "Unable to load reference image");
  }

  // If host is a domain name, resolve through DNS and ensure no resolved IP is private/local
  if (net.isIP(cleanHost) === 0) {
    try {
      const addresses = await dns.lookup(cleanHost, { all: true });
      for (const addr of addresses) {
        if (isPrivateOrLocalIp(addr.address)) {
          throw new ApiError(502, "Unable to load reference image");
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(502, "Unable to load reference image");
    }
  }

  return parsed;
};

// Creates a stream transform that enforces a strict maximum byte limit to avoid memory exhaustion.
export const createByteLimitTransform = (
  maxBytes: number = MAX_CONTENT_LENGTH_BYTES
): Transform => {
  let totalBytes = 0;
  return new Transform({
    transform(chunk: Buffer | Uint8Array, _encoding, callback: TransformCallback) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        callback(
          new ApiError(502, "Reference image exceeds maximum allowed size")
        );
        return;
      }
      callback(null, chunk);
    },
  });
};

// Safely requests an image with manual redirect checks, DNS validation, and streamed byte capping.
export const fetchSafeImageStream = async (
  initialUrl: string,
  options?: SafeImageFetchOptions
): Promise<SafeImageFetchResult> => {
  let currentUrl = initialUrl;
  let redirectCount = 0;
  const activeFetch = options?.customFetch ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  while (redirectCount <= MAX_REDIRECTS) {
    await validateUrlSafety(currentUrl);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await activeFetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: abortController.signal,
        headers: {
          Accept: "image/*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("aborted"))
      ) {
        throw new ApiError(504, "Reference image request timed out");
      }
      throw new ApiError(502, "Unable to load reference image");
    } finally {
      clearTimeout(timeoutId);
    }

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      redirectCount++;
      if (redirectCount > MAX_REDIRECTS) {
        throw new ApiError(502, "Unable to load reference image");
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new ApiError(502, "Unable to load reference image");
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new ApiError(502, "Unable to load reference image");
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith("image/")) {
      throw new ApiError(502, "Unable to load reference image");
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (!isNaN(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
        throw new ApiError(
          502,
          "Reference image exceeds maximum allowed size"
        );
      }
    }

    if (!response.body) {
      throw new ApiError(502, "Unable to load reference image");
    }

    return {
      body: response.body,
      contentType,
    };
  }

  throw new ApiError(502, "Unable to load reference image");
};
