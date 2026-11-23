import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_FETCH_CREDENTIALS,
  AI_FETCH_REDIRECT,
  assertNotDeploymentAuthenticationResponse,
  DeploymentAuthenticationError,
  isVercelAuthenticationUrl,
} from "../src/aiTransport.ts";

test("AI transport sends cookies to the current origin only and never follows API redirects", () => {
  assert.equal(AI_FETCH_CREDENTIALS, "same-origin");
  assert.equal(AI_FETCH_REDIRECT, "manual");
});

test("Vercel authentication is distinguished from a Gemini JSON 401 without exposing response data", () => {
  assert.equal(isVercelAuthenticationUrl("https://vercel.com/login?next=preview"), true);
  assert.equal(isVercelAuthenticationUrl("https://vercel.com/sso-api?url=preview"), true);
  assert.equal(isVercelAuthenticationUrl("https://accounting-of-ai.vercel.app/accounting-of-AI/"), false);
  const protectedResponse = {
    type: "opaqueredirect", status: 0, url: "", headers: new Headers(),
  } as Response;
  assert.throws(() => assertNotDeploymentAuthenticationResponse(protectedResponse), DeploymentAuthenticationError);

  const providerResponse = new Response(JSON.stringify({ error: { code: "AUTH_ERROR" } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
  assert.doesNotThrow(() => assertNotDeploymentAuthenticationResponse(providerResponse));
});

test("an HTML 401 from the deployment gateway is treated as Preview authentication", () => {
  const response = new Response("<html>login</html>", {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  assert.throws(() => assertNotDeploymentAuthenticationResponse(response), DeploymentAuthenticationError);
});
