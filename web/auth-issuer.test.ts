import assert from "node:assert/strict";
import test from "node:test";
import * as oauth from "oauth4webapi";
import { buildBaseAuthConfig, DISCORD_OAUTH_ISSUER } from "./auth.config.ts";

const discordAuthorizationServer = {
  issuer: DISCORD_OAUTH_ISSUER,
  token_endpoint: "https://discord.com/api/oauth2/token",
  userinfo_endpoint: "https://discord.com/api/users/@me",
};

const client = { client_id: "discord-client" };

function callbackParams(iss: string | undefined, state = "expected-state") {
  const params = new URLSearchParams({ code: "auth-code", state });
  if (iss !== undefined) params.set("iss", iss);
  return params;
}

test("Discord provider declares Discord's issuer and keeps PKCE defaults", () => {
  const provider = buildBaseAuthConfig().providers[0] as {
    id?: string;
    checks?: string[];
    options?: { issuer?: string; checks?: string[]; authorization?: { params?: { scope?: string } } };
  };
  assert.equal(provider.id, "discord");
  assert.equal(provider.options?.issuer, "https://discord.com");
  assert.equal(provider.checks, undefined);
  assert.equal(provider.options?.checks, undefined);
  assert.equal(provider.options?.authorization?.params?.scope, "identify");
});

test("Discord iss https://discord.com passes and a wrong iss is rejected", () => {
  const accepted = oauth.validateAuthResponse(
    discordAuthorizationServer,
    client,
    callbackParams("https://discord.com"),
    "expected-state",
  );
  assert.equal(accepted.get("iss"), "https://discord.com");
  assert.equal(accepted.get("code"), "auth-code");

  assert.throws(
    () =>
      oauth.validateAuthResponse(
        discordAuthorizationServer,
        client,
        callbackParams("https://authjs.dev"),
        "expected-state",
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('unexpected "iss" (issuer) response parameter value'),
  );

  assert.throws(
    () =>
      oauth.validateAuthResponse(
        discordAuthorizationServer,
        client,
        callbackParams("https://evil.example"),
        "expected-state",
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('unexpected "iss" (issuer) response parameter value'),
  );
});

test("state mismatch stays rejected", () => {
  assert.throws(
    () =>
      oauth.validateAuthResponse(
        discordAuthorizationServer,
        client,
        callbackParams("https://discord.com", "other-state"),
        "expected-state",
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('unexpected "state" response parameter value'),
  );
});

test("placeholder issuer still rejects Discord's iss", () => {
  assert.throws(
    () =>
      oauth.validateAuthResponse(
        { ...discordAuthorizationServer, issuer: "https://authjs.dev" },
        client,
        callbackParams("https://discord.com"),
        "expected-state",
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('unexpected "iss" (issuer) response parameter value'),
  );
});
