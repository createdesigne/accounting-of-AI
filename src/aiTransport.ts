/**
 * Vercel Deployment Protection is an application gateway, not a Gemini error.
 * Keep its authentication cookie on the current origin only and never follow an
 * unexpected API redirect with the per-request Gemini Authorization header.
 */
export const AI_FETCH_CREDENTIALS = "same-origin" as const;
export const AI_FETCH_REDIRECT = "manual" as const;

export class DeploymentAuthenticationError extends Error {
  constructor() {
    super("Vercel Previewへのログインが必要です。Previewを同じブラウザーで開いて認証し、この画面へ戻って再試行してください。");
    this.name = "DeploymentAuthenticationError";
  }
}

export function assertNotDeploymentAuthenticationResponse(response: Response): void {
  const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
  if (response.type === "opaqueredirect"
    || isVercelAuthenticationUrl(response.url)
    || (response.status === 401 && contentType.includes("text/html"))) {
    throw new DeploymentAuthenticationError();
  }
}

export function isVercelAuthenticationUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.hostname === "vercel.com" || url.hostname === "www.vercel.com")
      && (url.pathname.startsWith("/login") || url.pathname.startsWith("/sso-api") || url.pathname.startsWith("/api/auth"));
  } catch {
    return false;
  }
}
