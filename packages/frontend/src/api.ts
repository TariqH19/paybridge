export const apiUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

export async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error("Could not reach the PayBridge API. Check the backend URL and try again.");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { response, body };
}

export function getApiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) {
    return fallback;
  }

  const message = (body as Record<string, unknown>).error;
  return typeof message === "string" ? message : fallback;
}
