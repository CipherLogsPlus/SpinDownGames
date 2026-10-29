// node_modules/oauth4webapi/build/index.js
var USER_AGENT;
if (typeof navigator === "undefined" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) {
  const NAME = "oauth4webapi";
  const VERSION = "v3.8.8";
  USER_AGENT = `${NAME}/${VERSION}`;
}
function looseInstanceOf(input, expected) {
  if (input == null) {
    return false;
  }
  try {
    return input instanceof expected || Object.getPrototypeOf(input)[Symbol.toStringTag] === expected.prototype[Symbol.toStringTag];
  } catch {
    return false;
  }
}
var ERR_INVALID_ARG_VALUE = "ERR_INVALID_ARG_VALUE";
var ERR_INVALID_ARG_TYPE = "ERR_INVALID_ARG_TYPE";
function CodedTypeError(message, code, cause) {
  const err = new TypeError(message, { cause });
  Object.assign(err, { code });
  return err;
}
var allowInsecureRequests = /* @__PURE__ */ Symbol();
var clockSkew = /* @__PURE__ */ Symbol();
var clockTolerance = /* @__PURE__ */ Symbol();
var customFetch = /* @__PURE__ */ Symbol();
var jweDecrypt = /* @__PURE__ */ Symbol();
var jwksCache = /* @__PURE__ */ Symbol();
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function buf(input) {
  if (typeof input === "string") {
    return encoder.encode(input);
  }
  return decoder.decode(input);
}
var encodeBase64Url;
if (Uint8Array.prototype.toBase64) {
  encodeBase64Url = (input) => {
    if (input instanceof ArrayBuffer) {
      input = new Uint8Array(input);
    }
    return input.toBase64({ alphabet: "base64url", omitPadding: true });
  };
} else {
  const CHUNK_SIZE = 32768;
  encodeBase64Url = (input) => {
    if (input instanceof ArrayBuffer) {
      input = new Uint8Array(input);
    }
    const arr = [];
    for (let i = 0; i < input.byteLength; i += CHUNK_SIZE) {
      arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
    }
    return btoa(arr.join("")).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
}
var decodeBase64Url;
if (Uint8Array.fromBase64) {
  decodeBase64Url = (input) => {
    try {
      return Uint8Array.fromBase64(input, { alphabet: "base64url" });
    } catch (cause) {
      throw CodedTypeError("The input to be decoded is not correctly encoded.", ERR_INVALID_ARG_VALUE, cause);
    }
  };
} else {
  decodeBase64Url = (input) => {
    try {
      const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (cause) {
      throw CodedTypeError("The input to be decoded is not correctly encoded.", ERR_INVALID_ARG_VALUE, cause);
    }
  };
}
function b64u(input) {
  if (typeof input === "string") {
    return decodeBase64Url(input);
  }
  return encodeBase64Url(input);
}
var UnsupportedOperationError = class extends Error {
  code;
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = UNSUPPORTED_OPERATION;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var OperationProcessingError = class extends Error {
  code;
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    if (options?.code) {
      this.code = options?.code;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
};
function OPE(message, code, cause) {
  return new OperationProcessingError(message, { code, cause });
}
function isJsonObject(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  return true;
}
function prepareHeaders(input) {
  if (looseInstanceOf(input, Headers)) {
    input = Object.fromEntries(input.entries());
  }
  const headers = new Headers(input ?? {});
  if (USER_AGENT && !headers.has("user-agent")) {
    headers.set("user-agent", USER_AGENT);
  }
  if (headers.has("authorization")) {
    throw CodedTypeError('"options.headers" must not include the "authorization" header name', ERR_INVALID_ARG_VALUE);
  }
  return headers;
}
function signal(url, value) {
  if (value !== void 0) {
    if (typeof value === "function") {
      value = value(url.href);
    }
    if (!(value instanceof AbortSignal)) {
      throw CodedTypeError('"options.signal" must return or be an instance of AbortSignal', ERR_INVALID_ARG_TYPE);
    }
    return value;
  }
  return void 0;
}
function replaceDoubleSlash(pathname) {
  if (pathname.includes("//")) {
    return pathname.replace("//", "/");
  }
  return pathname;
}
function prependWellKnown(url, wellKnown, allowTerminatingSlash = false) {
  if (url.pathname === "/") {
    url.pathname = wellKnown;
  } else {
    url.pathname = replaceDoubleSlash(`${wellKnown}/${allowTerminatingSlash ? url.pathname : url.pathname.replace(/(\/)$/, "")}`);
  }
  return url;
}
function appendWellKnown(url, wellKnown) {
  url.pathname = replaceDoubleSlash(`${url.pathname}/${wellKnown}`);
  return url;
}
async function performDiscovery(input, urlName, transform, options) {
  if (!(input instanceof URL)) {
    throw CodedTypeError(`"${urlName}" must be an instance of URL`, ERR_INVALID_ARG_TYPE);
  }
  checkProtocol(input, options?.[allowInsecureRequests] !== true);
  const url = transform(new URL(input.href));
  const headers = prepareHeaders(options?.headers);
  headers.set("accept", "application/json");
  return (options?.[customFetch] || fetch)(url.href, {
    body: void 0,
    headers: Object.fromEntries(headers.entries()),
    method: "GET",
    redirect: "manual",
    signal: signal(url, options?.signal)
  });
}
async function discoveryRequest(issuerIdentifier, options) {
  return performDiscovery(issuerIdentifier, "issuerIdentifier", (url) => {
    switch (options?.algorithm) {
      case void 0:
      case "oidc":
        appendWellKnown(url, ".well-known/openid-configuration");
        break;
      case "oauth2":
        prependWellKnown(url, ".well-known/oauth-authorization-server");
        break;
      default:
        throw CodedTypeError('"options.algorithm" must be "oidc" (default), or "oauth2"', ERR_INVALID_ARG_VALUE);
    }
    return url;
  }, options);
}
function assertNumber(input, allow0, it, code, cause) {
  try {
    if (typeof input !== "number" || !Number.isFinite(input)) {
      throw CodedTypeError(`${it} must be a number`, ERR_INVALID_ARG_TYPE, cause);
    }
    if (input > 0)
      return;
    if (allow0) {
      if (input !== 0) {
        throw CodedTypeError(`${it} must be a non-negative number`, ERR_INVALID_ARG_VALUE, cause);
      }
      return;
    }
    throw CodedTypeError(`${it} must be a positive number`, ERR_INVALID_ARG_VALUE, cause);
  } catch (err) {
    if (code) {
      throw OPE(err.message, code, cause);
    }
    throw err;
  }
}
function assertString(input, it, code, cause) {
  try {
    if (typeof input !== "string") {
      throw CodedTypeError(`${it} must be a string`, ERR_INVALID_ARG_TYPE, cause);
    }
    if (input.length === 0) {
      throw CodedTypeError(`${it} must not be empty`, ERR_INVALID_ARG_VALUE, cause);
    }
  } catch (err) {
    if (code) {
      throw OPE(err.message, code, cause);
    }
    throw err;
  }
}
async function processDiscoveryResponse(expectedIssuerIdentifier, response) {
  const expected = expectedIssuerIdentifier;
  if (!(expected instanceof URL) && expected !== _nodiscoverycheck) {
    throw CodedTypeError('"expectedIssuerIdentifier" must be an instance of URL', ERR_INVALID_ARG_TYPE);
  }
  if (!looseInstanceOf(response, Response)) {
    throw CodedTypeError('"response" must be an instance of Response', ERR_INVALID_ARG_TYPE);
  }
  if (response.status !== 200) {
    throw OPE('"response" is not a conform Authorization Server Metadata response (unexpected HTTP status code)', RESPONSE_IS_NOT_CONFORM, response);
  }
  assertReadableResponse(response);
  const json2 = await getResponseJsonBody(response);
  assertString(json2.issuer, '"response" body "issuer" property', INVALID_RESPONSE, { body: json2 });
  if (expected !== _nodiscoverycheck && new URL(json2.issuer).href !== expected.href) {
    throw OPE('"response" body "issuer" property does not match the expected value', JSON_ATTRIBUTE_COMPARISON, { expected: expected.href, body: json2, attribute: "issuer" });
  }
  return json2;
}
function assertApplicationJson(response) {
  assertContentType(response, "application/json");
}
function notJson(response, ...types) {
  let msg = '"response" content-type must be ';
  if (types.length > 2) {
    const last = types.pop();
    msg += `${types.join(", ")}, or ${last}`;
  } else if (types.length === 2) {
    msg += `${types[0]} or ${types[1]}`;
  } else {
    msg += types[0];
  }
  return OPE(msg, RESPONSE_IS_NOT_JSON, response);
}
function assertContentTypes(response, ...types) {
  if (!types.includes(getContentType(response))) {
    throw notJson(response, ...types);
  }
}
function assertContentType(response, contentType) {
  if (getContentType(response) !== contentType) {
    throw notJson(response, contentType);
  }
}
function randomBytes() {
  return b64u(crypto.getRandomValues(new Uint8Array(32)));
}
function generateRandomCodeVerifier() {
  return randomBytes();
}
function generateRandomNonce() {
  return randomBytes();
}
async function calculatePKCECodeChallenge(codeVerifier) {
  assertString(codeVerifier, "codeVerifier");
  return b64u(await crypto.subtle.digest("SHA-256", buf(codeVerifier)));
}
function getClockSkew(client) {
  const skew = client?.[clockSkew];
  return typeof skew === "number" && Number.isFinite(skew) ? skew : 0;
}
function getClockTolerance(client) {
  const tolerance = client?.[clockTolerance];
  return typeof tolerance === "number" && Number.isFinite(tolerance) && Math.sign(tolerance) !== -1 ? tolerance : 30;
}
function epochTime() {
  return Math.floor(Date.now() / 1e3);
}
function assertAs(as) {
  if (typeof as !== "object" || as === null) {
    throw CodedTypeError('"as" must be an object', ERR_INVALID_ARG_TYPE);
  }
  assertString(as.issuer, '"as.issuer"');
}
function assertClient(client) {
  if (typeof client !== "object" || client === null) {
    throw CodedTypeError('"client" must be an object', ERR_INVALID_ARG_TYPE);
  }
  assertString(client.client_id, '"client.client_id"');
}
function formUrlEncode(token2) {
  return encodeURIComponent(token2).replace(/(?:[-_.!~*'()]|%20)/g, (substring) => {
    switch (substring) {
      case "-":
      case "_":
      case ".":
      case "!":
      case "~":
      case "*":
      case "'":
      case "(":
      case ")":
        return `%${substring.charCodeAt(0).toString(16).toUpperCase()}`;
      case "%20":
        return "+";
      default:
        throw new Error();
    }
  });
}
function ClientSecretBasic(clientSecret) {
  assertString(clientSecret, '"clientSecret"');
  return (_as, client, _body, headers) => {
    const username = formUrlEncode(client.client_id);
    const password = formUrlEncode(clientSecret);
    const credentials2 = btoa(`${username}:${password}`);
    headers.set("authorization", `Basic ${credentials2}`);
  };
}
var URLParse = URL.parse ? (url, base) => URL.parse(url, base) : (url, base) => {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
};
function checkProtocol(url, enforceHttps) {
  if (enforceHttps && url.protocol !== "https:") {
    throw OPE("only requests to HTTPS are allowed", HTTP_REQUEST_FORBIDDEN, url);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw OPE("only HTTP and HTTPS requests are allowed", REQUEST_PROTOCOL_FORBIDDEN, url);
  }
}
function validateEndpoint(value, endpoint, useMtlsAlias, enforceHttps) {
  let url;
  if (typeof value !== "string" || !(url = URLParse(value))) {
    throw OPE(`authorization server metadata does not contain a valid ${useMtlsAlias ? `"as.mtls_endpoint_aliases.${endpoint}"` : `"as.${endpoint}"`}`, value === void 0 ? MISSING_SERVER_METADATA : INVALID_SERVER_METADATA, { attribute: useMtlsAlias ? `mtls_endpoint_aliases.${endpoint}` : endpoint });
  }
  checkProtocol(url, enforceHttps);
  return url;
}
function resolveEndpoint(as, endpoint, useMtlsAlias, enforceHttps) {
  if (useMtlsAlias && as.mtls_endpoint_aliases && endpoint in as.mtls_endpoint_aliases) {
    return validateEndpoint(as.mtls_endpoint_aliases[endpoint], endpoint, useMtlsAlias, enforceHttps);
  }
  return validateEndpoint(as[endpoint], endpoint, useMtlsAlias, enforceHttps);
}
var ResponseBodyError = class extends Error {
  cause;
  code;
  error;
  status;
  error_description;
  response;
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = RESPONSE_BODY_ERROR;
    this.cause = options.cause;
    this.error = options.cause.error;
    this.status = options.response.status;
    this.error_description = options.cause.error_description;
    Object.defineProperty(this, "response", { enumerable: false, value: options.response });
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var AuthorizationResponseError = class extends Error {
  cause;
  code;
  error;
  error_description;
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = AUTHORIZATION_RESPONSE_ERROR;
    this.cause = options.cause;
    this.error = options.cause.get("error");
    this.error_description = options.cause.get("error_description") ?? void 0;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var WWWAuthenticateChallengeError = class extends Error {
  cause;
  code;
  response;
  status;
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = WWW_AUTHENTICATE_CHALLENGE;
    this.cause = options.cause;
    this.status = options.response.status;
    this.response = options.response;
    Object.defineProperty(this, "response", { enumerable: false });
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var tokenMatch = "[a-zA-Z0-9!#$%&\\'\\*\\+\\-\\.\\^_`\\|~]+";
var token68Match = "[a-zA-Z0-9\\-\\._\\~\\+\\/]+={0,2}";
var quotedMatch = '"((?:[^"\\\\]|\\\\[\\s\\S])*)"';
var quotedParamMatcher = "(" + tokenMatch + ")\\s*=\\s*" + quotedMatch;
var paramMatcher = "(" + tokenMatch + ")\\s*=\\s*(" + tokenMatch + ")";
var schemeRE = new RegExp("^[,\\s]*(" + tokenMatch + ")");
var quotedParamRE = new RegExp("^[,\\s]*" + quotedParamMatcher + "[,\\s]*(.*)");
var unquotedParamRE = new RegExp("^[,\\s]*" + paramMatcher + "[,\\s]*(.*)");
var token68ParamRE = new RegExp("^(" + token68Match + ")(?:$|[,\\s])(.*)");
function parseWwwAuthenticateChallenges(response) {
  if (!looseInstanceOf(response, Response)) {
    throw CodedTypeError('"response" must be an instance of Response', ERR_INVALID_ARG_TYPE);
  }
  const header = response.headers.get("www-authenticate");
  if (header === null) {
    return void 0;
  }
  const challenges = [];
  let rest = header;
  while (rest) {
    let match = rest.match(schemeRE);
    const scheme = match?.["1"].toLowerCase();
    if (!scheme) {
      return void 0;
    }
    const afterScheme = rest.substring(match[0].length);
    if (afterScheme && !afterScheme.match(/^[\s,]/)) {
      return void 0;
    }
    const spaceMatch = afterScheme.match(/^\s+(.*)$/);
    const hasParameters = !!spaceMatch;
    rest = spaceMatch ? spaceMatch[1] : void 0;
    const parameters = {};
    let token68;
    if (hasParameters) {
      while (rest) {
        let key;
        let value;
        if (match = rest.match(quotedParamRE)) {
          ;
          [, key, value, rest] = match;
          if (value.includes("\\")) {
            value = value.replace(/\\([\s\S])/g, "$1");
          }
          parameters[key.toLowerCase()] = value;
          continue;
        }
        if (match = rest.match(unquotedParamRE)) {
          ;
          [, key, value, rest] = match;
          parameters[key.toLowerCase()] = value;
          continue;
        }
        if (match = rest.match(token68ParamRE)) {
          if (Object.keys(parameters).length) {
            break;
          }
          ;
          [, token68, rest] = match;
          break;
        }
        return void 0;
      }
    } else {
      rest = afterScheme || void 0;
    }
    const challenge = { scheme, parameters };
    if (token68) {
      challenge.token68 = token68;
    }
    challenges.push(challenge);
  }
  if (!challenges.length) {
    return void 0;
  }
  return challenges;
}
async function parseOAuthResponseErrorBody(response) {
  if (response.status > 399 && response.status < 500) {
    assertReadableResponse(response);
    assertApplicationJson(response);
    try {
      const json2 = await response.clone().json();
      if (isJsonObject(json2) && typeof json2.error === "string" && json2.error.length) {
        return json2;
      }
    } catch {
    }
  }
  return void 0;
}
async function checkOAuthBodyError(response, expected, label) {
  if (response.status !== expected) {
    checkAuthenticationChallenges(response);
    let err;
    if (err = await parseOAuthResponseErrorBody(response)) {
      await response.body?.cancel();
      throw new ResponseBodyError("server responded with an error in the response body", {
        cause: err,
        response
      });
    }
    throw OPE(`"response" is not a conform ${label} response (unexpected HTTP status code)`, RESPONSE_IS_NOT_CONFORM, response);
  }
}
function assertDPoP(option) {
  if (!branded.has(option)) {
    throw CodedTypeError('"options.DPoP" is not a valid DPoPHandle', ERR_INVALID_ARG_VALUE);
  }
}
var jwksMap;
var jwksRequests;
var jwksKeys;
function setJwksCache(as, jwks, uat, cache) {
  jwksMap ||= /* @__PURE__ */ new WeakMap();
  jwksMap.set(as, {
    jwks,
    uat,
    get age() {
      return epochTime() - this.uat;
    }
  });
  if (cache) {
    Object.assign(cache, { jwks: structuredClone(jwks), uat });
  }
}
function isFreshJwksCache(input) {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  if (!("uat" in input) || typeof input.uat !== "number" || epochTime() - input.uat >= 300) {
    return false;
  }
  if (!("jwks" in input) || !isJsonObject(input.jwks) || !Array.isArray(input.jwks.keys) || !Array.prototype.every.call(input.jwks.keys, isJsonObject)) {
    return false;
  }
  return true;
}
function clearJwksCache(as, cache) {
  jwksMap?.delete(as);
  delete cache?.jwks;
  delete cache?.uat;
}
async function getPublicSigKeyFromIssuerJwksUri(as, options, header) {
  const { alg, kid } = header;
  checkSupportedJwsAlg(header);
  if (!jwksMap?.has(as) && isFreshJwksCache(options?.[jwksCache])) {
    setJwksCache(as, options?.[jwksCache].jwks, options?.[jwksCache].uat);
  }
  let jwks;
  let age;
  if (jwksMap?.has(as)) {
    ;
    ({ jwks, age } = jwksMap.get(as));
    if (age >= 300) {
      clearJwksCache(as, options?.[jwksCache]);
      return getPublicSigKeyFromIssuerJwksUri(as, options, header);
    }
  } else {
    const downloaded = await jwksRequest(as, options);
    jwks = downloaded.jwks;
    age = epochTime() - downloaded.uat;
    setJwksCache(as, jwks, downloaded.uat, options?.[jwksCache]);
  }
  let kty;
  switch (alg.slice(0, 2)) {
    case "RS":
    case "PS":
      kty = "RSA";
      break;
    case "ES":
      kty = "EC";
      break;
    case "Ed":
      kty = "OKP";
      break;
    case "ML":
      kty = "AKP";
      break;
    default:
      throw new UnsupportedOperationError("unsupported JWS algorithm", { cause: { alg } });
  }
  const candidates = jwks.keys.filter((jwk2) => {
    if (jwk2.kty !== kty) {
      return false;
    }
    if (kid !== void 0 && kid !== jwk2.kid) {
      return false;
    }
    if (jwk2.alg !== void 0 && alg !== jwk2.alg) {
      return false;
    }
    if (jwk2.use !== void 0 && jwk2.use !== "sig") {
      return false;
    }
    if (jwk2.key_ops?.includes("verify") === false) {
      return false;
    }
    switch (true) {
      case (alg === "ES256" && jwk2.crv !== "P-256"):
      case (alg === "ES384" && jwk2.crv !== "P-384"):
      case (alg === "ES512" && jwk2.crv !== "P-521"):
      case (alg === "Ed25519" && jwk2.crv !== "Ed25519"):
      case (alg === "EdDSA" && jwk2.crv !== "Ed25519"):
        return false;
    }
    return true;
  });
  const { 0: jwk, length } = candidates;
  if (!length) {
    if (age >= 60) {
      clearJwksCache(as, options?.[jwksCache]);
      return getPublicSigKeyFromIssuerJwksUri(as, options, header);
    }
    throw OPE("error when selecting a JWT verification key, no applicable keys found", KEY_SELECTION, { header, candidates, jwks_uri: new URL(as.jwks_uri) });
  }
  if (length !== 1) {
    throw OPE('error when selecting a JWT verification key, multiple applicable keys found, a "kid" JWT Header Parameter is required', KEY_SELECTION, { header, candidates, jwks_uri: new URL(as.jwks_uri) });
  }
  jwksKeys ||= /* @__PURE__ */ new WeakMap();
  let keys = jwksKeys.get(jwk);
  if (!keys) {
    keys = /* @__PURE__ */ new Map();
    jwksKeys.set(jwk, keys);
  }
  let key = keys.get(alg);
  if (!key) {
    key = importJwk(alg, jwk).catch((cause) => {
      keys.delete(alg);
      throw cause;
    });
    keys.set(alg, key);
  }
  return key;
}
function getContentType(input) {
  return input.headers.get("content-type")?.split(";")[0];
}
async function authenticatedRequest(as, client, clientAuthentication, url, body, headers, options) {
  await clientAuthentication(as, client, body, headers);
  headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  return (options?.[customFetch] || fetch)(url.href, {
    body,
    headers: Object.fromEntries(headers.entries()),
    method: "POST",
    redirect: "manual",
    signal: signal(url, options?.signal)
  });
}
async function tokenEndpointRequest(as, client, clientAuthentication, grantType, parameters, options) {
  const url = resolveEndpoint(as, "token_endpoint", client.use_mtls_endpoint_aliases, options?.[allowInsecureRequests] !== true);
  parameters.set("grant_type", grantType);
  const headers = prepareHeaders(options?.headers);
  headers.set("accept", "application/json");
  if (options?.DPoP !== void 0) {
    assertDPoP(options.DPoP);
    await options.DPoP.addProof(url, headers, "POST");
  }
  const response = await authenticatedRequest(as, client, clientAuthentication, url, parameters, headers, options);
  options?.DPoP?.cacheNonce(response, url);
  return response;
}
var idTokenClaims = /* @__PURE__ */ new WeakMap();
var jwtRefs = /* @__PURE__ */ new WeakMap();
function getValidatedIdTokenClaims(ref) {
  if (!ref.id_token) {
    return void 0;
  }
  const claims = idTokenClaims.get(ref);
  if (!claims) {
    throw CodedTypeError('"ref" was already garbage collected or did not resolve from the proper sources', ERR_INVALID_ARG_VALUE);
  }
  return claims;
}
async function validateApplicationLevelSignature(as, ref, options) {
  assertAs(as);
  if (!jwtRefs.has(ref)) {
    throw CodedTypeError('"ref" does not contain a processed JWT Response to verify the signature of', ERR_INVALID_ARG_VALUE);
  }
  const { 0: protectedHeader, 1: payload, 2: encodedSignature } = jwtRefs.get(ref).split(".");
  const header = JSON.parse(buf(b64u(protectedHeader)));
  if (header.alg.startsWith("HS")) {
    throw new UnsupportedOperationError("unsupported JWS algorithm", { cause: { alg: header.alg } });
  }
  let key;
  key = await getPublicSigKeyFromIssuerJwksUri(as, options, header);
  await validateJwsSignature(protectedHeader, payload, key, b64u(encodedSignature));
}
async function processGenericAccessTokenResponse(as, client, response, additionalRequiredIdTokenClaims, decryptFn, recognizedTokenTypes) {
  assertAs(as);
  assertClient(client);
  if (!looseInstanceOf(response, Response)) {
    throw CodedTypeError('"response" must be an instance of Response', ERR_INVALID_ARG_TYPE);
  }
  await checkOAuthBodyError(response, 200, "Token Endpoint");
  assertReadableResponse(response);
  const json2 = await getResponseJsonBody(response);
  assertString(json2.access_token, '"response" body "access_token" property', INVALID_RESPONSE, {
    body: json2
  });
  assertString(json2.token_type, '"response" body "token_type" property', INVALID_RESPONSE, {
    body: json2
  });
  json2.token_type = json2.token_type.toLowerCase();
  if (json2.expires_in !== void 0) {
    let expiresIn = typeof json2.expires_in !== "number" ? parseFloat(json2.expires_in) : json2.expires_in;
    assertNumber(expiresIn, true, '"response" body "expires_in" property', INVALID_RESPONSE, {
      body: json2
    });
    json2.expires_in = expiresIn;
  }
  if (json2.refresh_token !== void 0) {
    assertString(json2.refresh_token, '"response" body "refresh_token" property', INVALID_RESPONSE, {
      body: json2
    });
  }
  if (json2.scope !== void 0 && typeof json2.scope !== "string") {
    throw OPE('"response" body "scope" property must be a string', INVALID_RESPONSE, { body: json2 });
  }
  if (json2.id_token !== void 0) {
    assertString(json2.id_token, '"response" body "id_token" property', INVALID_RESPONSE, {
      body: json2
    });
    const requiredClaims = [];
    if (client.require_auth_time === true) {
      requiredClaims.push("auth_time");
    }
    if (client.default_max_age !== void 0) {
      assertNumber(client.default_max_age, true, '"client.default_max_age"');
      requiredClaims.push("auth_time");
    }
    if (additionalRequiredIdTokenClaims?.length) {
      requiredClaims.push(...additionalRequiredIdTokenClaims);
    }
    const { claims, jwt } = await validateIdTokenClaims(as, client, json2.id_token, requiredClaims, decryptFn);
    validateIdTokenAuthorizedParty(client, claims);
    validateIdTokenAuthTimeClaim(claims);
    jwtRefs.set(response, jwt);
    idTokenClaims.set(json2, claims);
  }
  if (recognizedTokenTypes?.[json2.token_type] !== void 0) {
    recognizedTokenTypes[json2.token_type](response, json2);
  } else if (json2.token_type !== "dpop" && json2.token_type !== "bearer") {
    throw new UnsupportedOperationError("unsupported `token_type` value", { cause: { body: json2 } });
  }
  return json2;
}
function checkAuthenticationChallenges(response) {
  let challenges;
  if (challenges = parseWwwAuthenticateChallenges(response)) {
    throw new WWWAuthenticateChallengeError("server responded with a challenge in the WWW-Authenticate HTTP Header", { cause: challenges, response });
  }
}
function validateAudience(expected, result) {
  if (Array.isArray(result.claims.aud)) {
    if (!result.claims.aud.includes(expected)) {
      throw OPE('unexpected JWT "aud" (audience) claim value', JWT_CLAIM_COMPARISON, {
        expected,
        claims: result.claims,
        claim: "aud"
      });
    }
  } else if (result.claims.aud !== expected) {
    throw OPE('unexpected JWT "aud" (audience) claim value', JWT_CLAIM_COMPARISON, {
      expected,
      claims: result.claims,
      claim: "aud"
    });
  }
  return result;
}
function validateIssuer(as, result) {
  const expected = as[_expectedIssuer]?.(result) ?? as.issuer;
  if (result.claims.iss !== expected) {
    throw OPE('unexpected JWT "iss" (issuer) claim value', JWT_CLAIM_COMPARISON, {
      expected,
      claims: result.claims,
      claim: "iss"
    });
  }
  return result;
}
var branded = /* @__PURE__ */ new WeakSet();
function brand(searchParams) {
  branded.add(searchParams);
  return searchParams;
}
var nopkce = /* @__PURE__ */ Symbol();
async function authorizationCodeGrantRequest(as, client, clientAuthentication, callbackParameters, redirectUri, codeVerifier, options) {
  assertAs(as);
  assertClient(client);
  if (!branded.has(callbackParameters)) {
    throw CodedTypeError('"callbackParameters" must be an instance of URLSearchParams obtained from "validateAuthResponse()", or "validateJwtAuthResponse()', ERR_INVALID_ARG_VALUE);
  }
  assertString(redirectUri, '"redirectUri"');
  const code = getURLSearchParameter(callbackParameters, "code");
  if (!code) {
    throw OPE('no authorization code in "callbackParameters"', INVALID_RESPONSE);
  }
  const parameters = new URLSearchParams(options?.additionalParameters);
  parameters.set("redirect_uri", redirectUri);
  parameters.set("code", code);
  if (codeVerifier !== nopkce) {
    assertString(codeVerifier, '"codeVerifier"');
    parameters.set("code_verifier", codeVerifier);
  }
  return tokenEndpointRequest(as, client, clientAuthentication, "authorization_code", parameters, options);
}
var jwtClaimNames = {
  aud: "audience",
  c_hash: "code hash",
  client_id: "client id",
  exp: "expiration time",
  iat: "issued at",
  iss: "issuer",
  jti: "jwt id",
  nonce: "nonce",
  s_hash: "state hash",
  sub: "subject",
  ath: "access token hash",
  htm: "http method",
  htu: "http uri",
  cnf: "confirmation",
  auth_time: "authentication time"
};
function validatePresence(required, result) {
  for (const claim of required) {
    if (result.claims[claim] === void 0) {
      throw OPE(`JWT "${claim}" (${jwtClaimNames[claim]}) claim missing`, INVALID_RESPONSE, {
        claims: result.claims
      });
    }
  }
  return result;
}
function validateStringClaim(claim, result) {
  if (typeof result.claims[claim] !== "string") {
    throw OPE(`unexpected JWT "${claim}" (${jwtClaimNames[claim]}) claim type`, INVALID_RESPONSE, {
      claims: result.claims
    });
  }
  return result;
}
function validateIdTokenClaims(as, client, idToken, requiredClaims, decryptFn) {
  return validateJwt(idToken, checkSigningAlgorithm.bind(void 0, client.id_token_signed_response_alg, as.id_token_signing_alg_values_supported, "RS256"), getClockSkew(client), getClockTolerance(client), decryptFn).then(validatePresence.bind(void 0, ["aud", "exp", "iat", "iss", "sub", ...requiredClaims])).then(validateIssuer.bind(void 0, as)).then(validateAudience.bind(void 0, client.client_id)).then(validateStringClaim.bind(void 0, "sub"));
}
function resolveIdTokenMaxAge(client, maxAge) {
  if (maxAge === skipAuthTimeCheck) {
    return maxAge;
  }
  const fromClient = maxAge === void 0;
  if (fromClient) {
    maxAge = client.default_max_age;
  }
  if (maxAge === void 0) {
    return skipAuthTimeCheck;
  }
  assertNumber(maxAge, true, fromClient ? '"client.default_max_age"' : '"maxAge" argument');
  return maxAge;
}
function validateIdTokenAuthTimeClaim(claims) {
  if (claims.auth_time !== void 0) {
    assertNumber(claims.auth_time, true, 'ID Token "auth_time" (authentication time)', INVALID_RESPONSE, { claims });
  }
}
function validateIdTokenAuthTime(client, claims, maxAge) {
  if (maxAge === skipAuthTimeCheck) {
    return;
  }
  const now = epochTime() + getClockSkew(client);
  const tolerance = getClockTolerance(client);
  if (claims.auth_time + maxAge < now - tolerance) {
    throw OPE("too much time has elapsed since the last End-User authentication", JWT_TIMESTAMP_CHECK, { claims, now, tolerance, claim: "auth_time" });
  }
}
function validateIdTokenNonce(claims, expectedNonce) {
  const expected = expectedNonce === expectNoNonce ? void 0 : expectedNonce;
  if (claims.nonce !== expected) {
    throw OPE('unexpected ID Token "nonce" claim value', JWT_CLAIM_COMPARISON, {
      expected,
      claims,
      claim: "nonce"
    });
  }
}
function validateIdTokenAuthorizedParty(client, claims) {
  if (Array.isArray(claims.aud) && claims.aud.length !== 1) {
    if (claims.azp === void 0) {
      throw OPE('ID Token "aud" (audience) claim includes additional untrusted audiences', JWT_CLAIM_COMPARISON, { claims, claim: "aud" });
    }
    if (claims.azp !== client.client_id) {
      throw OPE('unexpected ID Token "azp" (authorized party) claim value', JWT_CLAIM_COMPARISON, {
        expected: client.client_id,
        claims,
        claim: "azp"
      });
    }
  }
}
var expectNoNonce = /* @__PURE__ */ Symbol();
var skipAuthTimeCheck = /* @__PURE__ */ Symbol();
async function processAuthorizationCodeResponse(as, client, response, options) {
  if (typeof options?.expectedNonce === "string" || typeof options?.maxAge === "number" || options?.requireIdToken) {
    return processAuthorizationCodeOpenIDResponse(as, client, response, options.expectedNonce, options.maxAge, options[jweDecrypt], options.recognizedTokenTypes);
  }
  return processAuthorizationCodeOAuth2Response(as, client, response, options?.maxAge, options?.[jweDecrypt], options?.recognizedTokenTypes);
}
async function processAuthorizationCodeOpenIDResponse(as, client, response, expectedNonce, maxAge, decryptFn, recognizedTokenTypes) {
  const additionalRequiredClaims = [];
  switch (expectedNonce) {
    case void 0:
      expectedNonce = expectNoNonce;
      break;
    case expectNoNonce:
      break;
    default:
      assertString(expectedNonce, '"expectedNonce" argument');
      additionalRequiredClaims.push("nonce");
  }
  maxAge = resolveIdTokenMaxAge(client, maxAge);
  if (maxAge !== skipAuthTimeCheck) {
    additionalRequiredClaims.push("auth_time");
  }
  const result = await processGenericAccessTokenResponse(as, client, response, additionalRequiredClaims, decryptFn, recognizedTokenTypes);
  assertString(result.id_token, '"response" body "id_token" property', INVALID_RESPONSE, {
    body: result
  });
  const claims = getValidatedIdTokenClaims(result);
  validateIdTokenAuthTime(client, claims, maxAge);
  validateIdTokenNonce(claims, expectedNonce);
  return result;
}
async function processAuthorizationCodeOAuth2Response(as, client, response, maxAge, decryptFn, recognizedTokenTypes) {
  const result = await processGenericAccessTokenResponse(as, client, response, void 0, decryptFn, recognizedTokenTypes);
  const claims = getValidatedIdTokenClaims(result);
  if (claims) {
    validateIdTokenAuthTime(client, claims, resolveIdTokenMaxAge(client, maxAge));
    validateIdTokenNonce(claims, expectNoNonce);
  }
  return result;
}
var WWW_AUTHENTICATE_CHALLENGE = "OAUTH_WWW_AUTHENTICATE_CHALLENGE";
var RESPONSE_BODY_ERROR = "OAUTH_RESPONSE_BODY_ERROR";
var UNSUPPORTED_OPERATION = "OAUTH_UNSUPPORTED_OPERATION";
var AUTHORIZATION_RESPONSE_ERROR = "OAUTH_AUTHORIZATION_RESPONSE_ERROR";
var PARSE_ERROR = "OAUTH_PARSE_ERROR";
var INVALID_RESPONSE = "OAUTH_INVALID_RESPONSE";
var RESPONSE_IS_NOT_JSON = "OAUTH_RESPONSE_IS_NOT_JSON";
var RESPONSE_IS_NOT_CONFORM = "OAUTH_RESPONSE_IS_NOT_CONFORM";
var HTTP_REQUEST_FORBIDDEN = "OAUTH_HTTP_REQUEST_FORBIDDEN";
var REQUEST_PROTOCOL_FORBIDDEN = "OAUTH_REQUEST_PROTOCOL_FORBIDDEN";
var JWT_TIMESTAMP_CHECK = "OAUTH_JWT_TIMESTAMP_CHECK_FAILED";
var JWT_CLAIM_COMPARISON = "OAUTH_JWT_CLAIM_COMPARISON_FAILED";
var JSON_ATTRIBUTE_COMPARISON = "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED";
var KEY_SELECTION = "OAUTH_KEY_SELECTION_FAILED";
var MISSING_SERVER_METADATA = "OAUTH_MISSING_SERVER_METADATA";
var INVALID_SERVER_METADATA = "OAUTH_INVALID_SERVER_METADATA";
function assertReadableResponse(response) {
  if (response.bodyUsed) {
    throw CodedTypeError('"response" body has been used already', ERR_INVALID_ARG_VALUE);
  }
}
async function jwksRequest(as, options) {
  assertAs(as);
  const url = resolveEndpoint(as, "jwks_uri", false, options?.[allowInsecureRequests] !== true);
  const headers = prepareHeaders(options?.headers);
  headers.set("accept", "application/json");
  headers.append("accept", "application/jwk-set+json");
  const requestHeaders = Object.fromEntries(headers.entries());
  const headersKey = JSON.stringify(requestHeaders);
  const fetcher = options?.[customFetch] || fetch;
  const requestSignal = signal(url, options?.signal);
  jwksRequests ||= /* @__PURE__ */ new WeakMap();
  const requests = jwksRequests.get(as) ?? /* @__PURE__ */ new Set();
  for (const pending2 of requests) {
    if (pending2.url === url.href && pending2.headers === headersKey && pending2.fetch === fetcher && pending2.signal === requestSignal) {
      return pending2.promise;
    }
  }
  const pending = {
    url: url.href,
    headers: headersKey,
    fetch: fetcher,
    signal: requestSignal,
    promise: Promise.resolve().then(() => fetcher(url.href, {
      body: void 0,
      headers: requestHeaders,
      method: "GET",
      redirect: "manual",
      signal: requestSignal
    })).then(processJwksResponse).then((jwks) => {
      const uat = epochTime();
      setJwksCache(as, jwks, uat);
      return { jwks, uat };
    }).finally(() => {
      requests.delete(pending);
      if (!requests.size) {
        jwksRequests.delete(as);
      }
    })
  };
  requests.add(pending);
  jwksRequests.set(as, requests);
  return pending.promise;
}
async function processJwksResponse(response) {
  if (!looseInstanceOf(response, Response)) {
    throw CodedTypeError('"response" must be an instance of Response', ERR_INVALID_ARG_TYPE);
  }
  if (response.status !== 200) {
    throw OPE('"response" is not a conform JSON Web Key Set response (unexpected HTTP status code)', RESPONSE_IS_NOT_CONFORM, response);
  }
  assertReadableResponse(response);
  const json2 = await getResponseJsonBody(response, (response2) => assertContentTypes(response2, "application/json", "application/jwk-set+json"));
  if (!Array.isArray(json2.keys)) {
    throw OPE('"response" body "keys" property must be an array', INVALID_RESPONSE, { body: json2 });
  }
  if (!Array.prototype.every.call(json2.keys, isJsonObject)) {
    throw OPE('"response" body "keys" property members must be JWK formatted objects', INVALID_RESPONSE, { body: json2 });
  }
  return json2;
}
function supported(alg) {
  switch (alg) {
    case "PS256":
    case "ES256":
    case "RS256":
    case "PS384":
    case "ES384":
    case "RS384":
    case "PS512":
    case "ES512":
    case "RS512":
    case "Ed25519":
    case "EdDSA":
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return true;
    default:
      return false;
  }
}
function checkSupportedJwsAlg(header) {
  if (!supported(header.alg)) {
    throw new UnsupportedOperationError('unsupported JWS "alg" identifier', {
      cause: { alg: header.alg }
    });
  }
}
function checkRsaKeyAlgorithm(key) {
  const { algorithm } = key;
  if (typeof algorithm.modulusLength !== "number" || algorithm.modulusLength < 2048) {
    throw new UnsupportedOperationError(`unsupported ${algorithm.name} modulusLength`, {
      cause: key
    });
  }
}
function ecdsaHashName(key) {
  const { algorithm } = key;
  switch (algorithm.namedCurve) {
    case "P-256":
      return "SHA-256";
    case "P-384":
      return "SHA-384";
    case "P-521":
      return "SHA-512";
    default:
      throw new UnsupportedOperationError("unsupported ECDSA namedCurve", { cause: key });
  }
}
function keyToSubtle(key) {
  switch (key.algorithm.name) {
    case "ECDSA":
      return {
        name: key.algorithm.name,
        hash: ecdsaHashName(key)
      };
    case "RSA-PSS": {
      checkRsaKeyAlgorithm(key);
      switch (key.algorithm.hash.name) {
        case "SHA-256":
        case "SHA-384":
        case "SHA-512":
          return {
            name: key.algorithm.name,
            saltLength: parseInt(key.algorithm.hash.name.slice(-3), 10) >> 3
          };
        default:
          throw new UnsupportedOperationError("unsupported RSA-PSS hash name", { cause: key });
      }
    }
    case "RSASSA-PKCS1-v1_5":
      checkRsaKeyAlgorithm(key);
      return key.algorithm.name;
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "Ed25519":
      return key.algorithm.name;
  }
  throw new UnsupportedOperationError("unsupported CryptoKey algorithm name", { cause: key });
}
async function validateJwsSignature(protectedHeader, payload, key, signature) {
  const data = buf(`${protectedHeader}.${payload}`);
  const algorithm = keyToSubtle(key);
  const verified = await crypto.subtle.verify(algorithm, key, signature, data);
  if (!verified) {
    throw OPE("JWT signature verification failed", INVALID_RESPONSE, {
      key,
      data,
      signature,
      algorithm
    });
  }
}
async function validateJwt(jws, checkAlg, clockSkew2, clockTolerance2, decryptJwt) {
  let { 0: protectedHeader, 1: payload, length } = jws.split(".");
  if (length === 5) {
    if (decryptJwt !== void 0) {
      jws = await decryptJwt(jws);
      ({ 0: protectedHeader, 1: payload, length } = jws.split("."));
    } else {
      throw new UnsupportedOperationError("JWE decryption is not configured", { cause: jws });
    }
  }
  if (length !== 3) {
    throw OPE("Invalid JWT", INVALID_RESPONSE, jws);
  }
  let header;
  try {
    header = JSON.parse(buf(b64u(protectedHeader)));
  } catch (cause) {
    throw OPE("failed to parse JWT Header body as base64url encoded JSON", PARSE_ERROR, cause);
  }
  if (!isJsonObject(header)) {
    throw OPE("JWT Header must be a top level object", INVALID_RESPONSE, jws);
  }
  checkAlg(header);
  if (header.crit !== void 0) {
    throw new UnsupportedOperationError('no JWT "crit" header parameter extensions are supported', {
      cause: { header }
    });
  }
  let claims;
  try {
    claims = JSON.parse(buf(b64u(payload)));
  } catch (cause) {
    throw OPE("failed to parse JWT Payload body as base64url encoded JSON", PARSE_ERROR, cause);
  }
  if (!isJsonObject(claims)) {
    throw OPE("JWT Payload must be a top level object", INVALID_RESPONSE, jws);
  }
  const now = epochTime() + clockSkew2;
  if (claims.exp !== void 0) {
    if (typeof claims.exp !== "number") {
      throw OPE('unexpected JWT "exp" (expiration time) claim type', INVALID_RESPONSE, { claims });
    }
    if (claims.exp <= now - clockTolerance2) {
      throw OPE('unexpected JWT "exp" (expiration time) claim value, expiration is past current timestamp', JWT_TIMESTAMP_CHECK, { claims, now, tolerance: clockTolerance2, claim: "exp" });
    }
  }
  if (claims.iat !== void 0) {
    if (typeof claims.iat !== "number") {
      throw OPE('unexpected JWT "iat" (issued at) claim type', INVALID_RESPONSE, { claims });
    }
  }
  if (claims.iss !== void 0) {
    if (typeof claims.iss !== "string") {
      throw OPE('unexpected JWT "iss" (issuer) claim type', INVALID_RESPONSE, { claims });
    }
  }
  if (claims.nbf !== void 0) {
    if (typeof claims.nbf !== "number") {
      throw OPE('unexpected JWT "nbf" (not before) claim type', INVALID_RESPONSE, { claims });
    }
    if (claims.nbf > now + clockTolerance2) {
      throw OPE('unexpected JWT "nbf" (not before) claim value', JWT_TIMESTAMP_CHECK, {
        claims,
        now,
        tolerance: clockTolerance2,
        claim: "nbf"
      });
    }
  }
  if (claims.aud !== void 0) {
    if (typeof claims.aud !== "string" && !Array.isArray(claims.aud)) {
      throw OPE('unexpected JWT "aud" (audience) claim type', INVALID_RESPONSE, { claims });
    }
  }
  return { header, claims, jwt: jws };
}
function checkSigningAlgorithm(client, issuer, fallback, header) {
  if (client !== void 0) {
    if (typeof client === "string" ? header.alg !== client : !client.includes(header.alg)) {
      throw OPE('unexpected JWT "alg" header parameter', INVALID_RESPONSE, {
        header,
        expected: client,
        reason: "client configuration"
      });
    }
    return;
  }
  if (Array.isArray(issuer)) {
    if (!issuer.includes(header.alg)) {
      throw OPE('unexpected JWT "alg" header parameter', INVALID_RESPONSE, {
        header,
        expected: issuer,
        reason: "authorization server metadata"
      });
    }
    return;
  }
  if (fallback !== void 0) {
    if (typeof fallback === "string" ? header.alg !== fallback : typeof fallback === "function" ? !fallback(header.alg) : !fallback.includes(header.alg)) {
      throw OPE('unexpected JWT "alg" header parameter', INVALID_RESPONSE, {
        header,
        expected: fallback,
        reason: "default value"
      });
    }
    return;
  }
  throw OPE('missing client or server configuration to verify used JWT "alg" header parameter', void 0, { client, issuer, fallback });
}
function getURLSearchParameter(parameters, name) {
  const { 0: value, length } = parameters.getAll(name);
  if (length > 1) {
    throw OPE(`"${name}" parameter must be provided only once`, INVALID_RESPONSE);
  }
  return value;
}
var skipStateCheck = /* @__PURE__ */ Symbol();
var expectNoState = /* @__PURE__ */ Symbol();
function validateAuthResponse(as, client, parameters, expectedState) {
  assertAs(as);
  assertClient(client);
  if (parameters instanceof URL) {
    parameters = parameters.searchParams;
  }
  if (!(parameters instanceof URLSearchParams)) {
    throw CodedTypeError('"parameters" must be an instance of URLSearchParams, or URL', ERR_INVALID_ARG_TYPE);
  }
  if (getURLSearchParameter(parameters, "response")) {
    throw OPE('"parameters" contains a JARM response, use validateJwtAuthResponse() instead of validateAuthResponse()', INVALID_RESPONSE, { parameters });
  }
  const iss = getURLSearchParameter(parameters, "iss");
  const state = getURLSearchParameter(parameters, "state");
  if (!iss && as.authorization_response_iss_parameter_supported) {
    throw OPE('response parameter "iss" (issuer) missing', INVALID_RESPONSE, { parameters });
  }
  if (iss && iss !== as.issuer) {
    throw OPE('unexpected "iss" (issuer) response parameter value', INVALID_RESPONSE, {
      expected: as.issuer,
      parameters
    });
  }
  switch (expectedState) {
    case void 0:
    case expectNoState:
      if (state !== void 0) {
        throw OPE('unexpected "state" response parameter encountered', INVALID_RESPONSE, {
          expected: void 0,
          parameters
        });
      }
      break;
    case skipStateCheck:
      break;
    default:
      assertString(expectedState, '"expectedState" argument');
      if (state !== expectedState) {
        throw OPE(state === void 0 ? 'response parameter "state" missing' : 'unexpected "state" response parameter value', INVALID_RESPONSE, { expected: expectedState, parameters });
      }
  }
  const error = getURLSearchParameter(parameters, "error");
  if (error) {
    throw new AuthorizationResponseError("authorization response from the server is an error", {
      cause: parameters
    });
  }
  const id_token = getURLSearchParameter(parameters, "id_token");
  const token2 = getURLSearchParameter(parameters, "token");
  if (id_token !== void 0 || token2 !== void 0) {
    throw new UnsupportedOperationError("implicit and hybrid flows are not supported");
  }
  return brand(new URLSearchParams(parameters));
}
function algToSubtle(alg) {
  switch (alg) {
    case "PS256":
    case "PS384":
    case "PS512":
      return { name: "RSA-PSS", hash: `SHA-${alg.slice(-3)}` };
    case "RS256":
    case "RS384":
    case "RS512":
      return { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${alg.slice(-3)}` };
    case "ES256":
    case "ES384":
      return { name: "ECDSA", namedCurve: `P-${alg.slice(-3)}` };
    case "ES512":
      return { name: "ECDSA", namedCurve: "P-521" };
    case "EdDSA":
      return "Ed25519";
    case "Ed25519":
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return alg;
    default:
      throw new UnsupportedOperationError("unsupported JWS algorithm", { cause: { alg } });
  }
}
async function importJwk(alg, jwk) {
  const { ext, key_ops, use, ...key } = jwk;
  return crypto.subtle.importKey("jwk", key, algToSubtle(alg), true, ["verify"]);
}
async function getResponseJsonBody(response, check = assertApplicationJson) {
  let json2;
  try {
    json2 = await response.json();
  } catch (cause) {
    check(response);
    throw OPE('failed to parse "response" body as JSON', PARSE_ERROR, cause);
  }
  if (!isJsonObject(json2)) {
    throw OPE('"response" body must be a top level object', INVALID_RESPONSE, { body: json2 });
  }
  return json2;
}
var _nodiscoverycheck = /* @__PURE__ */ Symbol();
var _expectedIssuer = /* @__PURE__ */ Symbol();

// src/http.ts
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "HttpError";
  }
  status;
  code;
};
function json(value, status = 200, headers = {}) {
  const safeHeaders = new Headers(headers);
  safeHeaders.set("Content-Type", "application/json; charset=utf-8");
  safeHeaders.set("Cache-Control", "no-store");
  safeHeaders.set("X-Content-Type-Options", "nosniff");
  safeHeaders.set("Referrer-Policy", "no-referrer");
  safeHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(JSON.stringify(value), { status, headers: safeHeaders });
}
async function readBytes(request, maximum) {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function readJson(request, maximum = 16384) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/json")
    throw new HttpError(415, "JSON_REQUIRED", "Send JSON for this request.");
  const bytes = await readBytes(request, maximum);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Send valid JSON for this request.");
  }
}

// src/password-hash.ts
import { Buffer } from "node:buffer";
import { scrypt, timingSafeEqual } from "node:crypto";
var SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
var SALT_BYTES = 16;
var KEY_BYTES = 32;
var PREFIX = "$scrypt$v=1$N=32768,r=8,p=3$";
var HASH_PATTERN = /^\$scrypt\$v=1\$N=32768,r=8,p=3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
var DUMMY_HASH = "$scrypt$v=1$N=32768,r=8,p=3$whJFULaFTVpMRhQC6g4rng$ROZhOKAZYrj1T7ELy18hgQoZzIh9RMYmZMKxH0IiCU0";
function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await derive(password, salt);
  return `${PREFIX}${Buffer.from(salt).toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}
async function verifyPassword(password, encoded) {
  const match = HASH_PATTERN.exec(encoded);
  if (!match) return false;
  const salt = Buffer.from(match[1], "base64url");
  const expected = Buffer.from(match[2], "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES || `${PREFIX}${salt.toString("base64url")}$${expected.toString("base64url")}` !== encoded) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

// src/session.ts
var SESSION_COOKIE = "__Host-spinarium_session";
var SESSION_TTL = 8 * 60 * 60;
var TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
function epoch() {
  return Math.floor(Date.now() / 1e3);
}
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function readCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header || header.length > 8192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie(name) {
  return cookie(name, "", 0);
}
function applicationConfig(env) {
  if (env.AUTH_ENABLED !== "true") throw new HttpError(503, "ACCOUNTS_DISABLED", "Account access is not enabled yet.");
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN || origin.username || origin.password) throw new Error();
    if (!["password", "oidc"].includes(env.AUTH_PROVIDER)) throw new Error();
    return { origin: origin.origin };
  } catch {
    throw new HttpError(503, "SERVICE_UNAVAILABLE", "Account access is not configured.");
  }
}
function assertRequestOrigin(request, config) {
  if (new URL(request.url).origin !== config.origin) throw new HttpError(403, "ORIGIN_DENIED", "This request origin is not allowed.");
}
function requireCsrf(request, env, session) {
  const config = applicationConfig(env);
  assertRequestOrigin(request, config);
  if (request.headers.get("Origin") !== config.origin) throw new HttpError(403, "ORIGIN_DENIED", "This request origin is not allowed.");
  const value = request.headers.get("X-CSRF-Token") ?? "";
  const encoder2 = new TextEncoder();
  if (!TOKEN_PATTERN.test(value) || !crypto.subtle.timingSafeEqual(encoder2.encode(value), encoder2.encode(session.csrfToken))) {
    throw new HttpError(403, "CSRF_REJECTED", "Reload your session before continuing.");
  }
}
async function requireSession(request, env) {
  assertRequestOrigin(request, applicationConfig(env));
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) throw new HttpError(401, "AUTH_REQUIRED", "Sign in to continue.");
  const sessionTokenHash = await hashToken(rawToken);
  const row = await env.DB.withSession("first-primary").prepare(`
    SELECT s.user_id, s.csrf_token, s.expires_at, u.display_name, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
  `).bind(sessionTokenHash, epoch()).first();
  if (!row) throw new HttpError(401, "AUTH_REQUIRED", "Sign in to continue.");
  return {
    userId: row.user_id,
    displayName: row.display_name,
    memberSince: new Date(row.created_at * 1e3).toISOString(),
    csrfToken: row.csrf_token,
    sessionTokenHash,
    expiresAt: row.expires_at
  };
}
function sessionProjection(session) {
  return {
    user: { id: session.userId, displayName: session.displayName, memberSince: session.memberSince },
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt * 1e3).toISOString()
  };
}

// src/password-auth.ts
var LOCAL_ISSUER = "urn:spinarium:password";
function invalidInput() {
  throw new HttpError(400, "INVALID_INPUT", "Use a valid email-shaped account name and a password of 15 to 128 characters.");
}
function invalidCredentials() {
  throw new HttpError(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
}
function malformedUnicode(value) {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point >= 55296 && point <= 57343;
  });
}
function validatePassword(value) {
  if (typeof value !== "string") invalidInput();
  const characters = Array.from(value).length;
  if (characters < 15 || characters > 128 || new TextEncoder().encode(value).byteLength > 512 || !value.trim() || malformedUnicode(value)) invalidInput();
  return value;
}
function mutationOrigin(request, env) {
  const config = applicationConfig(env);
  assertRequestOrigin(request, config);
  if (request.headers.get("Origin") !== config.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new HttpError(403, "ORIGIN_DENIED", "This request origin is not allowed.");
  }
}
async function credentials(request, signup2) {
  const value = await readJson(request, 8192);
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidInput();
  const body = value;
  const expected = signup2 ? ["email", "password", "displayName"] : ["email", "password"];
  if (Object.keys(body).some((key) => !expected.includes(key))) invalidInput();
  if (typeof body.email !== "string" || typeof body.password !== "string") invalidInput();
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email) || malformedUnicode(email)) invalidInput();
  const password = validatePassword(body.password);
  let displayName = "";
  if (signup2) {
    if (typeof body.displayName !== "string") invalidInput();
    displayName = body.displayName.trim();
    if (!displayName || Array.from(displayName).length > 120 || /[\u0000-\u001f\u007f]/.test(displayName) || malformedUnicode(displayName)) invalidInput();
  }
  return { email, password, displayName };
}
async function limit(request, env, email, signup2) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unavailable";
  if (ip.length > 64) throw new HttpError(400, "INVALID_INPUT", "Invalid request.");
  const now = epoch();
  const windowStart = Math.floor(now / 900) * 900;
  const db = env.DB.withSession("first-primary");
  const operation = signup2 ? "signup" : "login";
  const keys = [
    { key: await hashToken(`password:${operation}:ip:${ip}`), maximum: signup2 ? 5 : 30 },
    { key: await hashToken(`password:${operation}:account:${email}`), maximum: signup2 ? 5 : 10 }
  ];
  for (const { key, maximum } of keys) {
    const result = await db.prepare(`
    INSERT INTO auth_rate_limits (key, hits, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING hits
  `).bind(key, windowStart).first();
    if (!result || result.hits > maximum) {
      throw new HttpError(429, "TOO_MANY_REQUESTS", "Wait a few minutes before trying again.");
    }
  }
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)").bind(now),
    db.prepare("DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE window_start < ? ORDER BY window_start LIMIT 100)").bind(now - 86400)
  ]);
}
function issuedSession(userId, displayName, createdAt, csrfToken, expiresAt) {
  return { userId, displayName, memberSince: new Date(createdAt * 1e3).toISOString(), csrfToken, expiresAt, sessionTokenHash: "" };
}
async function removePrevious(request, env) {
  const previous = readCookie(request, SESSION_COOKIE);
  if (previous) await env.DB.withSession("first-primary").prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(previous)).run();
}
async function signup(request, env) {
  if (env.SIGNUP_ENABLED !== "true") throw new HttpError(503, "SIGNUP_DISABLED", "Registration is not enabled yet.");
  mutationOrigin(request, env);
  const { email, password, displayName } = await credentials(request, true);
  await limit(request, env, email, true);
  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const rawToken = token();
  const csrfToken = token();
  const now = epoch();
  const expiresAt = now + SESSION_TTL;
  const db = env.DB.withSession("first-primary");
  try {
    await db.batch([
      db.prepare(`INSERT INTO users (id, oidc_issuer, oidc_subject, display_name, disabled, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)`).bind(userId, LOCAL_ISSUER, userId, displayName, now, now, now),
      db.prepare(`INSERT INTO password_accounts (user_id, email_normalized, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`).bind(userId, email, passwordHash, now, now),
      db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`).bind(await hashToken(rawToken), userId, csrfToken, now, expiresAt)
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: password_accounts\.email_normalized/.test(error.message)) {
      throw new HttpError(400, "ACCOUNT_UNAVAILABLE", "An account could not be created with those details.");
    }
    throw error;
  }
  await removePrevious(request, env);
  return json(
    sessionProjection(issuedSession(userId, displayName, now, csrfToken, expiresAt)),
    201,
    { "Set-Cookie": cookie(SESSION_COOKIE, rawToken, SESSION_TTL) }
  );
}
async function login(request, env) {
  mutationOrigin(request, env);
  const { email, password } = await credentials(request, false);
  await limit(request, env, email, false);
  const db = env.DB.withSession("first-primary");
  const account2 = await db.prepare(`SELECT p.user_id, p.password_hash, u.disabled, u.display_name, u.created_at
    FROM password_accounts p JOIN users u ON u.id = p.user_id WHERE p.email_normalized = ?`).bind(email).first();
  const matches = await verifyPassword(password, account2?.password_hash ?? DUMMY_HASH);
  if (!account2 || !matches || account2.disabled !== 0) invalidCredentials();
  const rawToken = token();
  const csrfToken = token();
  const now = epoch();
  const expiresAt = now + SESSION_TTL;
  const tokenHash = await hashToken(rawToken);
  const results = await db.batch([
    db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
      SELECT ?, u.id, ?, ?, ? FROM users u JOIN password_accounts p ON p.user_id = u.id
      WHERE u.id = ? AND u.disabled = 0 AND p.password_hash = ?`).bind(tokenHash, csrfToken, now, expiresAt, account2.user_id, account2.password_hash),
    // Record only a successful mint in the same transaction. Concurrent logins
    // cannot move this time backwards; login does not invalidate admin edits.
    db.prepare(`UPDATE users SET last_login_at = MAX(COALESCE(last_login_at, 0), ?)
      WHERE id = ? AND disabled = 0 AND EXISTS (
        SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = users.id
      )`).bind(now, account2.user_id, tokenHash)
  ]);
  if (results[0].meta.changes !== 1) invalidCredentials();
  await removePrevious(request, env);
  return json(
    sessionProjection(issuedSession(account2.user_id, account2.display_name, account2.created_at, csrfToken, expiresAt)),
    200,
    { "Set-Cookie": cookie(SESSION_COOKIE, rawToken, SESSION_TTL) }
  );
}
async function handlePasswordAuth(request, env) {
  const path = new URL(request.url).pathname;
  if (!["/api/auth/login", "/api/auth/signup", "/api/auth/session", "/api/auth/logout"].includes(path)) return null;
  assertRequestOrigin(request, applicationConfig(env));
  const method = path === "/api/auth/session" ? "GET" : "POST";
  if (request.method !== method) throw new HttpError(405, "METHOD_NOT_ALLOWED", "This method is not supported.");
  if (path === "/api/auth/signup") return signup(request, env);
  if (path === "/api/auth/login") return login(request, env);
  const session = await requireSession(request, env);
  if (path === "/api/auth/session") return json(sessionProjection(session));
  requireCsrf(request, env, session);
  await env.DB.withSession("first-primary").prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.sessionTokenHash).run();
  return json({ signedOut: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
}

// src/password-reset.ts
var VALID_RESET = `r.expires_at > ? AND target.disabled = 0 AND issuer.disabled = 0
  AND r.user_id != r.created_by AND NOT EXISTS (
    SELECT 1 FROM admin_allowlist protected WHERE protected.user_id = r.user_id AND protected.role = 'owner'
  ) AND (actor.role = 'owner' OR NOT EXISTS (
    SELECT 1 FROM admin_allowlist target_admin WHERE target_admin.user_id = r.user_id
  ))`;
var RESET_JOINS = `password_resets r JOIN users target ON target.id = r.user_id
  JOIN password_accounts credential ON credential.user_id = target.id
  JOIN users issuer ON issuer.id = r.created_by
  JOIN admin_allowlist actor ON actor.user_id = issuer.id`;
function unavailable() {
  throw new HttpError(400, "PASSWORD_RESET_UNAVAILABLE", "This password-reset link is unavailable. Request a new link from an administrator.");
}
async function rateLimit(env, value, maximum) {
  const now = epoch();
  const row = await env.DB.withSession("first-primary").prepare(`
    INSERT INTO auth_rate_limits(key,hits,window_start) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
      window_start = excluded.window_start RETURNING hits
  `).bind(await hashToken(value), Math.floor(now / 900) * 900).first();
  if (!row || row.hits > maximum) throw new HttpError(429, "TOO_MANY_REQUESTS", "Wait a few minutes before trying again.");
}
async function handlePasswordReset(request, env) {
  if (new URL(request.url).pathname !== "/api/auth/password-reset") return null;
  if (env.AUTH_PROVIDER !== "password") throw new HttpError(404, "NOT_FOUND", "This endpoint does not exist.");
  const { origin } = applicationConfig(env);
  assertRequestOrigin(request, { origin });
  if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "This method is not supported.");
  if (request.headers.get("Origin") !== origin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new HttpError(403, "ORIGIN_DENIED", "This request origin is not allowed.");
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? "unavailable";
  if (ip.length > 64) unavailable();
  await rateLimit(env, `password-reset:ip:${ip}`, 20);
  const value = await readJson(request, 8192);
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  const body = value;
  if (Object.keys(body).some((key) => !["token", "password"].includes(key)) || typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) unavailable();
  const password = validatePassword(body.password);
  const tokenHash = await hashToken(body.token);
  await rateLimit(env, `password-reset:token:${tokenHash}`, 5);
  const db = env.DB.withSession("first-primary");
  const reset = await db.prepare(`SELECT r.user_id FROM ${RESET_JOINS}
    WHERE r.token_hash = ? AND ${VALID_RESET}`).bind(tokenHash, epoch()).first();
  if (!reset) unavailable();
  const passwordHash = await hashPassword(password);
  const now = epoch();
  const eventId = crypto.randomUUID();
  const currentCookie = readCookie(request, SESSION_COOKIE);
  const currentTokenHash = currentCookie ? await hashToken(currentCookie) : null;
  const results = await db.batch([
    db.prepare(`UPDATE password_accounts SET password_hash = ?, updated_at = ?
      WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM ${RESET_JOINS} WHERE r.token_hash = ? AND r.user_id = password_accounts.user_id AND ${VALID_RESET}
      )`).bind(passwordHash, now, reset.user_id, tokenHash, now),
    db.prepare(`INSERT INTO account_audit(id,target_user_id,actor_user_id,action,reason,before_json,after_json,created_at)
      SELECT ?,id,NULL,'password_reset_completed','A one-time administrator-issued password-reset link was redeemed.',
        json_object('displayName',display_name,'disabled',json(CASE disabled WHEN 1 THEN 'true' ELSE 'false' END),'revision',account_revision),
        json_object('displayName',display_name,'disabled',json(CASE disabled WHEN 1 THEN 'true' ELSE 'false' END),'revision',account_revision+1),?
      FROM users WHERE id = ? AND changes() = 1`).bind(eventId, now, reset.user_id),
    db.prepare(`UPDATE users SET account_revision = account_revision + 1, updated_at = ?
      WHERE id = ? AND EXISTS(SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = users.id)`).bind(now, reset.user_id, eventId),
    db.prepare(`DELETE FROM sessions WHERE (user_id = ? OR token_hash = ?) AND EXISTS(SELECT 1 FROM account_audit WHERE id = ?)`).bind(reset.user_id, currentTokenHash, eventId),
    db.prepare(`DELETE FROM password_resets WHERE user_id = ? AND EXISTS(SELECT 1 FROM account_audit WHERE id = ?)`).bind(reset.user_id, eventId)
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) unavailable();
  return json({ passwordReset: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
}

// src/auth.ts
var ATTEMPT_COOKIE = "__Host-spinarium_oidc";
var ATTEMPT_TTL = 10 * 60;
var CALLBACK_PATH = "/api/auth/callback";
function authConfig(env) {
  const { origin: configuredOrigin } = applicationConfig(env);
  try {
    const origin = new URL(configuredOrigin);
    const issuer = new URL(env.OIDC_ISSUER);
    if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN || origin.username || origin.password) throw new Error();
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error();
    if (!env.OIDC_CLIENT_ID || env.OIDC_CLIENT_ID.length > 512 || !env.OIDC_CLIENT_SECRET || env.OIDC_CLIENT_SECRET.length > 4096) throw new Error();
    if (!env.AUTH0_CONNECTION || env.AUTH0_CONNECTION.length > 128 || /[\u0000-\u001f\u007f]/.test(env.AUTH0_CONNECTION)) throw new Error();
    return {
      origin: origin.origin,
      issuer,
      client: { client_id: env.OIDC_CLIENT_ID, id_token_signed_response_alg: "RS256", [clockTolerance]: 30 },
      secret: env.OIDC_CLIENT_SECRET,
      callback: `${origin.origin}${CALLBACK_PATH}`,
      connection: env.AUTH0_CONNECTION
    };
  } catch {
    throw new HttpError(503, "authentication_unavailable", "Account access is not configured.");
  }
}
async function rateLimit2(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unavailable";
  if (ip.length > 64) throw new HttpError(400, "invalid_request", "Invalid request.");
  const key = await hashToken(`oidc:${ip}`);
  const now = epoch();
  const windowStart = Math.floor(now / 300) * 300;
  const row = await env.DB.withSession("first-primary").prepare(`
    INSERT INTO auth_rate_limits (key, hits, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING hits
  `).bind(key, windowStart).first();
  if (!row || row.hits > 20) throw new HttpError(429, "too_many_requests", "Try signing in again in a few minutes.");
}
function boundedFetch(dependencies) {
  const transport = dependencies.fetch ?? fetch;
  return async (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("Invalid identity endpoint.");
    const response = await transport(input, { ...init, redirect: "manual", signal: AbortSignal.timeout(1e4) });
    if (response.status >= 300 && response.status < 400) throw new Error("Identity endpoint redirects are not allowed.");
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 131072) throw new Error("Identity response exceeds limit.");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
async function provider(config, transport) {
  const response = await discoveryRequest(config.issuer, { [customFetch]: transport });
  const metadata = await processDiscoveryResponse(config.issuer, response);
  for (const value of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!value) throw new Error("Identity endpoint missing.");
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) throw new Error("Invalid identity endpoint.");
  }
  if (!metadata.code_challenge_methods_supported?.includes("S256")) throw new Error("Identity provider must support PKCE S256.");
  if (metadata.token_endpoint_auth_methods_supported && !metadata.token_endpoint_auth_methods_supported.includes("client_secret_basic")) {
    throw new Error("Identity provider must support confidential client authentication.");
  }
  return metadata;
}
function redirect(location, cookies) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
async function login2(request, env, config, dependencies, signup2) {
  if (signup2 && env.SIGNUP_ENABLED !== "true") throw new HttpError(503, "signup_unavailable", "Registration is not enabled yet.");
  const origin = request.headers.get("Origin");
  if (origin && origin !== config.origin) throw new HttpError(403, "origin_rejected", "This request origin is not allowed.");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new HttpError(403, "origin_rejected", "Open Spinarium to sign in.");
  await rateLimit2(request, env);
  const transport = boundedFetch(dependencies);
  let metadata;
  try {
    metadata = await provider(config, transport);
  } catch {
    throw new HttpError(503, "authentication_unavailable", "The sign-in provider is unavailable.");
  }
  const state = token();
  const browserBinding = token();
  const nonce = generateRandomNonce();
  const verifier = generateRandomCodeVerifier();
  const now = epoch();
  const db = env.DB.withSession("first-primary");
  await db.batch([
    db.prepare("DELETE FROM oidc_attempts WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?").bind(now - 86400),
    db.prepare("INSERT INTO oidc_attempts (state_hash, browser_hash, nonce, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(await hashToken(state), await hashToken(browserBinding), nonce, verifier, now, now + ATTEMPT_TTL)
  ]);
  const target = new URL(metadata.authorization_endpoint);
  target.searchParams.set("client_id", config.client.client_id);
  target.searchParams.set("redirect_uri", config.callback);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", "openid profile email");
  target.searchParams.set("connection", config.connection);
  if (signup2) {
    target.searchParams.set("screen_hint", "signup");
    target.searchParams.set("prompt", "login");
  }
  target.searchParams.set("state", state);
  target.searchParams.set("nonce", nonce);
  target.searchParams.set("code_challenge", await calculatePKCECodeChallenge(verifier));
  target.searchParams.set("code_challenge_method", "S256");
  target.searchParams.set("response_mode", "query");
  return redirect(target.href, [cookie(ATTEMPT_COOKIE, browserBinding, ATTEMPT_TTL)]);
}
async function callback(request, env, config, dependencies) {
  const failure = (notice = "failed") => redirect(`${config.origin}/spinarium/?auth=${notice}#signin`, [clearCookie(ATTEMPT_COOKIE)]);
  const url = new URL(request.url);
  const states = url.searchParams.getAll("state");
  const binding = readCookie(request, ATTEMPT_COOKIE);
  if (url.href.length > 4096 || states.length !== 1 || !TOKEN_PATTERN.test(states[0]) || !binding) return failure();
  await rateLimit2(request, env);
  const db = env.DB.withSession("first-primary");
  const attempt = await db.prepare(`DELETE FROM oidc_attempts
    WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING nonce, code_verifier`).bind(await hashToken(states[0]), await hashToken(binding), epoch()).first();
  if (!attempt) return failure();
  try {
    const transport = boundedFetch(dependencies);
    const metadata = await provider(config, transport);
    const parameters = validateAuthResponse(metadata, config.client, url, states[0]);
    const response = await authorizationCodeGrantRequest(
      metadata,
      config.client,
      ClientSecretBasic(config.secret),
      parameters,
      config.callback,
      attempt.code_verifier,
      { [customFetch]: transport }
    );
    const tokens = await processAuthorizationCodeResponse(metadata, config.client, response, {
      expectedNonce: attempt.nonce,
      requireIdToken: true
    });
    await validateApplicationLevelSignature(metadata, response, { [customFetch]: transport });
    const claims = getValidatedIdTokenClaims(tokens);
    if (!claims || !claims.sub || claims.sub.length > 255 || claims.iat > epoch() + 30 || epoch() - claims.iat > ATTEMPT_TTL + 30) return failure();
    if (claims.email_verified !== true || typeof claims.email !== "string" || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
      return failure("verify-email");
    }
    const displayName = typeof claims.name === "string" ? claims.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Collector" : "Collector";
    const now = epoch();
    const user = await db.prepare(`INSERT INTO users
      (id, oidc_issuer, oidc_subject, display_name, disabled, created_at, updated_at)
      SELECT ?, ?, ?, ?, 0, ?, ?
      WHERE ? = 1 OR EXISTS (SELECT 1 FROM users WHERE oidc_issuer = ? AND oidc_subject = ?)
      -- Existing names may have been edited by a trusted administrator. Login
      -- keeps them and their account revision intact instead of refreshing them.
      ON CONFLICT(oidc_issuer, oidc_subject) DO UPDATE SET oidc_subject = excluded.oidc_subject
      RETURNING id, disabled`).bind(
      crypto.randomUUID(),
      config.issuer.href,
      claims.sub,
      displayName,
      now,
      now,
      env.SIGNUP_ENABLED === "true" ? 1 : 0,
      config.issuer.href,
      claims.sub
    ).first();
    if (!user || user.disabled !== 0) return failure();
    const rawToken = token();
    const expiresAt = now + SESSION_TTL;
    const tokenHash = await hashToken(rawToken);
    const results = await db.batch([
      db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
        SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND disabled = 0`).bind(tokenHash, token(), now, expiresAt, user.id),
      db.prepare(`UPDATE users SET last_login_at = MAX(COALESCE(last_login_at, 0), ?)
        WHERE id = ? AND disabled = 0 AND EXISTS (
          SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = users.id
        )`).bind(now, user.id, tokenHash)
    ]);
    if (results[0].meta.changes !== 1) return failure();
    const previous = readCookie(request, SESSION_COOKIE);
    if (previous) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(previous)).run();
    return redirect(`${config.origin}/spinarium/`, [clearCookie(ATTEMPT_COOKIE), cookie(SESSION_COOKIE, rawToken, SESSION_TTL)]);
  } catch {
    return failure();
  }
}
async function handleAuth(request, env, dependencies = {}) {
  const path = new URL(request.url).pathname;
  if (!["/api/auth/login", "/api/auth/signup", "/api/auth/password-reset", CALLBACK_PATH, "/api/auth/session", "/api/auth/logout"].includes(path)) return null;
  const commonConfig = applicationConfig(env);
  assertRequestOrigin(request, commonConfig);
  if (path === "/api/auth/password-reset") return handlePasswordReset(request, env);
  if (env.AUTH_PROVIDER === "password") return handlePasswordAuth(request, env);
  const config = authConfig(env);
  if (request.url.length > 4096) throw new HttpError(400, "invalid_request", "Invalid request.");
  const method = path === "/api/auth/logout" ? "POST" : "GET";
  if (request.method !== method) throw new HttpError(405, "method_not_allowed", "This method is not supported.");
  if (path === "/api/auth/login" || path === "/api/auth/signup") return login2(request, env, config, dependencies, path === "/api/auth/signup");
  if (path === CALLBACK_PATH) return callback(request, env, config, dependencies);
  const session = await requireSession(request, env);
  if (path === "/api/auth/session") {
    return json(sessionProjection(session));
  }
  requireCsrf(request, env, session);
  const db = env.DB.withSession("first-primary");
  const binding = readCookie(request, ATTEMPT_COOKIE);
  const statements = [db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.sessionTokenHash)];
  if (binding) statements.push(db.prepare("DELETE FROM oidc_attempts WHERE browser_hash = ?").bind(await hashToken(binding)));
  await db.batch(statements);
  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  headers.append("Set-Cookie", clearCookie(ATTEMPT_COOKIE));
  return json({ signedOut: true }, 200, headers);
}

// src/admin-authorization.ts
var ADMIN_ACTOR_GUARD = `EXISTS (SELECT 1 FROM admin_allowlist actor
  JOIN users actor_user ON actor_user.id = actor.user_id
  JOIN sessions actor_session ON actor_session.user_id = actor.user_id
  WHERE actor.user_id = ? AND actor_user.disabled = 0 AND actor.role IN ('admin', 'owner')
  AND actor_session.token_hash = ? AND actor_session.expires_at > MAX(?, unixepoch()))`;
var OWNER_ACTOR_GUARD = ADMIN_ACTOR_GUARD.replace("actor.role IN ('admin', 'owner')", "actor.role = 'owner'");
function adminActorValues(session) {
  return [session.userId, session.sessionTokenHash, epoch()];
}

// src/admin-accounts.ts
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SELECT_ACCOUNT = `SELECT u.id, u.display_name, u.disabled, u.created_at, u.updated_at,
  u.last_login_at, u.account_revision, u.account_email AS email,
  COALESCE(a.role, 'collector') AS role,
  EXISTS (SELECT 1 FROM password_accounts p WHERE p.user_id = u.id) AS password_account`;
var ACCOUNT_FROM = "LEFT JOIN admin_allowlist a ON a.user_id = u.id";
var SAFE_AUDIT_JSON = `json_object('displayName', u.display_name,
  'disabled', json(CASE WHEN u.disabled = 1 THEN 'true' ELSE 'false' END),
  'revision', u.account_revision,
  'role', COALESCE((SELECT role FROM admin_allowlist WHERE user_id = u.id), 'collector'))`;
function invalid(message = "Check the account fields and try again.") {
  throw new HttpError(400, "INVALID_INPUT", message);
}
function safeText(value, maximum) {
  if (typeof value !== "string") invalid();
  const normalized = value.trim();
  const points = Array.from(normalized);
  if (!points.length || points.length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(normalized) || points.some((point) => {
    const code = point.codePointAt(0);
    return code >= 55296 && code <= 57343;
  })) invalid();
  return normalized;
}
function objectBody(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value;
  if (Object.keys(body).some((key) => !fields.includes(key))) invalid();
  return body;
}
function iso(seconds) {
  return new Date(seconds * 1e3).toISOString();
}
function revision(request) {
  const header = request.headers.get("If-Match");
  if (!header) throw new HttpError(428, "REVISION_REQUIRED", "Reload the account before editing it.");
  const match = header.match(/^"([1-9][0-9]{0,15})"$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalid("Send a valid account revision.");
  return Number(match[1]);
}
function conflict() {
  throw new HttpError(409, "ACCOUNT_CHANGED", "The account changed. Reload before trying again.");
}
function protectedAccount() {
  throw new HttpError(403, "PROTECTED_ACCOUNT", "This account is protected from that action.");
}
async function getAdminRole(env, userId) {
  const row = await env.DB.withSession("first-primary").prepare(`SELECT a.role FROM admin_allowlist a
    JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND u.disabled = 0`).bind(userId).first();
  return row?.role ?? null;
}
async function authorizedRead(db, session, statement) {
  const results = await db.batch([
    db.prepare(`SELECT role FROM admin_allowlist WHERE user_id = ? AND ${ADMIN_ACTOR_GUARD}`).bind(session.userId, ...adminActorValues(session)),
    statement
  ]);
  if (!results[0].results.length) throw new HttpError(403, "ADMIN_REQUIRED", "Trusted administrator access is required.");
  return results[1].results;
}
function canManage(actorRole, actorId, account2) {
  return account2.id !== actorId && account2.role !== "owner" && (actorRole === "owner" || account2.role === "collector");
}
function profile(row) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email === null ? null : false,
    displayName: row.display_name,
    disabled: row.disabled === 1,
    role: row.role,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastLoginAt: row.last_login_at === null ? null : iso(row.last_login_at),
    revision: row.account_revision,
    passwordAccount: row.password_account === 1
  };
}
function detailProjection(row, actorRole, actorId) {
  const currentActorRole = row.actor_role ?? actorRole;
  const manage = canManage(currentActorRole, actorId, row);
  return {
    ...profile(row),
    activeSessionCount: row.active_session_count ?? 0,
    ownershipCount: row.ownership_count ?? 0,
    protected: !manage,
    permissions: {
      editProfile: manage || row.id === actorId,
      setStatus: manage,
      revokeSessions: manage,
      resetPassword: manage && row.disabled === 0 && row.password_account === 1,
      setRole: manage && currentActorRole === "owner" && row.disabled === 0
    }
  };
}
function detailStatement(db, id, actorId) {
  return db.prepare(`${SELECT_ACCOUNT},
    (SELECT role FROM admin_allowlist WHERE user_id = ?) AS actor_role,
    (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_session_count,
    (SELECT count(*) FROM ownerships o WHERE o.user_id = u.id) AS ownership_count
    FROM users u ${ACCOUNT_FROM} WHERE u.id = ?`).bind(actorId, epoch(), id);
}
async function account(db, session, id) {
  const rows = await authorizedRead(db, session, detailStatement(db, id, session.userId));
  if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "The account was not found.");
  return rows[0];
}
function safeAudit(row) {
  return { displayName: row.display_name, disabled: row.disabled === 1, revision: row.account_revision, role: row.role };
}
function encodeCursor(cursor) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decodeCursor(value, kind, scope) {
  if (value === null || value === "") return null;
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid("Select a valid page.");
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const cursor = parsed;
    if (Object.keys(cursor).sort().join(",") !== "id,key,kind,scope,v" || cursor.v !== 1 || cursor.kind !== kind || cursor.scope !== scope || !UUID.test(cursor.id) || !(typeof cursor.key === "number" && Number.isSafeInteger(cursor.key) && cursor.key >= 0 || typeof cursor.key === "string" && cursor.key.length <= 254) || encodeCursor(cursor) !== value) throw new Error();
    return cursor;
  } catch {
    invalid("Select a valid page for these filters.");
  }
}
function queryParameters(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) invalid("Use valid account filters.");
  }
}
function limitValue(url, fallback) {
  const value = url.searchParams.get("limit");
  if (value === null) return fallback;
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100) invalid("Choose a page size from 1 to 100.");
  return Number(value);
}
function directoryQuery(url) {
  queryParameters(url, ["search", "searchBy", "status", "role", "cursor", "limit"]);
  const rawSearch = (url.searchParams.get("search") ?? "").trim();
  if (rawSearch.length > 254) invalid("Use a search of 254 characters or less.");
  if (rawSearch) safeText(rawSearch, 254);
  const searchBy = url.searchParams.get("searchBy") ?? "email";
  const status = url.searchParams.get("status") ?? "all";
  const role = url.searchParams.get("role") ?? "all";
  if (!["email", "name", "id"].includes(searchBy) || !["all", "active", "disabled"].includes(status) || !["all", "collector", "admin", "owner"].includes(role)) invalid("Use valid account filters.");
  const search = searchBy === "email" ? rawSearch.toLowerCase() : searchBy === "name" ? rawSearch.replace(/[A-Z]/g, (character) => character.toLowerCase()) : rawSearch.toLowerCase();
  if (searchBy === "id" && search && !UUID.test(search)) invalid("Use an exact account ID.");
  const scope = JSON.stringify({ searchBy, search, status, role });
  const cursor = decodeCursor(url.searchParams.get("cursor"), "accounts", scope);
  if (cursor && (search && searchBy !== "id" ? typeof cursor.key !== "string" : typeof cursor.key !== "number")) invalid();
  return {
    search,
    searchBy,
    status,
    role,
    scope,
    cursor,
    limit: limitValue(url, 50)
  };
}
function prefixUpper(value) {
  const characters = Array.from(value);
  while (characters.length) {
    const last = characters.pop().codePointAt(0);
    if (last < 1114111) return characters.join("") + String.fromCodePoint(last === 55295 ? 57344 : last + 1);
  }
  return null;
}
function accountDirectoryStatement(db, url) {
  const query = directoryQuery(url);
  const prefix = query.search && query.searchBy !== "id";
  const field = prefix ? query.searchBy === "email" ? "account_email" : "display_name_search" : "created_at";
  const conditions = [];
  const values = [];
  const statusFilter = query.status !== "all";
  const roleFilter = query.role !== "all";
  if (statusFilter) {
    conditions.push("u.disabled = ?");
    values.push(query.status === "disabled" ? 1 : 0);
  }
  if (roleFilter) {
    conditions.push("u.account_role = ?");
    values.push(query.role);
  }
  if (query.searchBy === "id" && query.search) {
    conditions.push("u.id = ?");
    values.push(query.search);
  }
  if (prefix) {
    conditions.push(`u.${field} >= ?`);
    values.push(query.search);
    const upper = prefixUpper(query.search);
    if (upper !== null) {
      conditions.push(`u.${field} < ?`);
      values.push(upper);
    }
  }
  if (query.cursor) {
    conditions.push(`(u.${field}, u.id) ${prefix ? ">" : "<"} (?, ?)`);
    values.push(query.cursor.key, query.cursor.id);
  }
  const order = prefix ? "ASC" : "DESC";
  const index = `users_account_${statusFilter ? "status_" : ""}${roleFilter ? "role_" : ""}${prefix ? query.searchBy : "newest"}`;
  const source = query.searchBy === "id" && query.search ? "users u" : `users u INDEXED BY ${index}`;
  const sql = `${SELECT_ACCOUNT}, u.${field} AS cursor_key FROM ${source} ${ACCOUNT_FROM}
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY u.${field} ${order}, u.id ${order} LIMIT ?`;
  values.push(query.limit + 1);
  return { statement: db.prepare(sql).bind(...values), query, sql, values };
}
async function directory(db, session, url) {
  const { statement, query } = accountDirectoryStatement(db, url);
  const rows = await authorizedRead(db, session, statement);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return json({
    accounts: page.map(profile),
    limit: query.limit,
    nextCursor: rows.length > query.limit && last ? encodeCursor({ v: 1, kind: "accounts", scope: query.scope, key: last.cursor_key, id: last.id }) : null
  });
}
async function summary(db, session) {
  const rows = await authorizedRead(
    db,
    session,
    db.prepare(`SELECT count(*) AS total, count(*) FILTER (WHERE disabled = 0) AS active,
      count(*) FILTER (WHERE disabled = 1) AS disabled,
      (SELECT count(*) FROM admin_allowlist) AS admins,
      (SELECT count(*) FROM admin_allowlist WHERE role = 'owner') AS owners,
      (SELECT role FROM admin_allowlist WHERE user_id = ?) AS currentActorRole FROM users`).bind(session.userId)
  );
  return json(rows[0]);
}
async function relatedPage(db, session, id, kind, url) {
  queryParameters(url, ["cursor", "limit"]);
  await account(db, session, id);
  const limit2 = limitValue(url, 25);
  const cursor = decodeCursor(url.searchParams.get("cursor"), kind, id);
  if (cursor && typeof cursor.key !== "number") invalid();
  const values = [id];
  if (cursor) values.push(cursor.key, cursor.id);
  values.push(limit2 + 1);
  if (kind === "ownerships") {
    const rows2 = await authorizedRead(db, session, db.prepare(`SELECT o.id, o.veiling_id, v.name, v.character_number, v.status, o.acquired_at, o.acquisition
      FROM ownerships o JOIN catalog_veilings v ON v.id = o.veiling_id WHERE o.user_id = ?
      ${cursor ? "AND (o.acquired_at, o.id) < (?, ?)" : ""} ORDER BY o.acquired_at DESC, o.id DESC LIMIT ?`).bind(...values));
    const page2 = rows2.slice(0, limit2);
    const last2 = page2.at(-1);
    return json({
      ownerships: page2.map((row) => ({
        id: row.id,
        veilingId: row.veiling_id,
        name: row.name,
        number: row.character_number,
        status: row.status,
        acquiredAt: iso(row.acquired_at),
        acquisition: row.acquisition
      })),
      limit: limit2,
      nextCursor: rows2.length > limit2 && last2 ? encodeCursor({ v: 1, kind, scope: id, key: last2.acquired_at, id: last2.id }) : null
    });
  }
  const rows = await authorizedRead(db, session, db.prepare(`SELECT id, actor_user_id, action, reason, before_json, after_json, created_at
    FROM account_audit WHERE target_user_id = ? ${cursor ? "AND (created_at, id) < (?, ?)" : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values));
  const page = rows.slice(0, limit2);
  const last = page.at(-1);
  return json({
    history: page.map((row) => ({
      id: row.id,
      actorId: row.actor_user_id,
      action: row.action,
      reason: row.reason,
      before: JSON.parse(row.before_json),
      after: JSON.parse(row.after_json),
      createdAt: iso(row.created_at)
    })),
    limit: limit2,
    nextCursor: rows.length > limit2 && last ? encodeCursor({ v: 1, kind, scope: id, key: last.created_at, id: last.id }) : null
  });
}
var MANAGE_TARGET = `u.id != ? AND NOT EXISTS (SELECT 1 FROM admin_allowlist target_owner WHERE target_owner.user_id = u.id AND target_owner.role = 'owner')
  AND (EXISTS (SELECT 1 FROM admin_allowlist actor_owner WHERE actor_owner.user_id = ? AND actor_owner.role = 'owner')
    OR NOT EXISTS (SELECT 1 FROM admin_allowlist target_admin WHERE target_admin.user_id = u.id))`;
function manageValues(session) {
  return [session.userId, session.userId];
}
async function mutation(request, env, session, actorRole, id, operation) {
  requireCsrf(request, env, session);
  const expected = revision(request);
  const body = objectBody(await readJson(request, 8192), operation === "patch" ? ["displayName", "disabled", "reason"] : operation === "role" ? ["role", "reason"] : ["reason"]);
  const reason = safeText(body.reason, 500);
  const db = env.DB.withSession("first-primary");
  const existing = await account(db, session, id);
  if (existing.account_revision !== expected) conflict();
  const manage = canManage(actorRole, session.userId, existing);
  const selfProfile = operation === "patch" && id === session.userId && "displayName" in body && !("disabled" in body);
  if (!manage && !selfProfile) protectedAccount();
  let name = existing.display_name;
  let disabled = existing.disabled;
  let action = operation === "revoke-sessions" ? "sessions_revoked" : operation === "password-reset" ? "password_reset_issued" : "profile_updated";
  if (operation === "patch") {
    if (!("displayName" in body) && !("disabled" in body)) invalid();
    if ("displayName" in body) name = safeText(body.displayName, 120);
    if ("disabled" in body) {
      if (typeof body.disabled !== "boolean") invalid();
      disabled = body.disabled ? 1 : 0;
      if (disabled !== existing.disabled) action = disabled ? "account_disabled" : "account_enabled";
    }
    if (name === existing.display_name && disabled === existing.disabled) invalid("Choose a change before saving.");
  }
  if (operation === "password-reset" && (existing.disabled !== 0 || existing.password_account !== 1)) protectedAccount();
  let desiredRole = null;
  if (operation === "role") {
    if (actorRole !== "owner") protectedAccount();
    if (!["admin", "collector"].includes(body.role) || existing.disabled !== 0 || body.role === existing.role) invalid();
    desiredRole = body.role;
    action = "role_changed";
  }
  const now = epoch();
  const eventId = crypto.randomUUID();
  const rawReset = operation === "password-reset" ? token() : null;
  const resetHash = rawReset ? await hashToken(rawReset) : null;
  const expiresAt = now + 15 * 60;
  let first;
  if (operation === "role") {
    const roleGuard = `u.id = ? AND u.account_revision = ? AND u.disabled = 0 AND ${OWNER_ACTOR_GUARD} AND ${MANAGE_TARGET}`;
    first = desiredRole === "admin" ? db.prepare(`INSERT INTO admin_allowlist(user_id, granted_at, granted_by, role)
        SELECT u.id, ?, ?, 'admin' FROM users u WHERE ${roleGuard}
        AND NOT EXISTS (SELECT 1 FROM admin_allowlist WHERE user_id = u.id)`).bind(now, session.userId, id, expected, ...adminActorValues(session), ...manageValues(session)) : db.prepare(`DELETE FROM admin_allowlist WHERE user_id = ? AND role = 'admin'
        AND EXISTS (SELECT 1 FROM users u WHERE ${roleGuard})`).bind(id, id, expected, ...adminActorValues(session), ...manageValues(session));
  } else {
    const targetGuard = selfProfile ? "u.id = ?" : MANAGE_TARGET;
    const targetValues = selfProfile ? [session.userId] : manageValues(session);
    first = db.prepare(`UPDATE users AS u SET display_name = ?, disabled = ?, updated_at = ?, account_revision = account_revision + 1
      WHERE u.id = ? AND u.account_revision = ? AND ${ADMIN_ACTOR_GUARD} AND ${targetGuard}
      ${operation === "password-reset" ? "AND u.disabled = 0 AND EXISTS (SELECT 1 FROM password_accounts p WHERE p.user_id = u.id)" : ""}`).bind(name, disabled, now, id, expected, ...adminActorValues(session), ...targetValues);
  }
  const revoke = operation !== "patch" || disabled === 1;
  const statements = [
    first,
    db.prepare(`INSERT INTO account_audit(id, target_user_id, actor_user_id, action, reason, before_json, after_json, created_at)
      SELECT ?, u.id, ?, ?, ?, ?, ${SAFE_AUDIT_JSON}, ? FROM users u WHERE u.id = ? AND changes() = 1`).bind(eventId, session.userId, action, reason, JSON.stringify(safeAudit(existing)), now, id),
    db.prepare("DELETE FROM password_resets WHERE (user_id = ? OR (created_by = ? AND ? = 1)) AND EXISTS (SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = ?)").bind(id, id, revoke ? 1 : 0, eventId, id)
  ];
  if (revoke) statements.push(db.prepare("DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = ?)").bind(id, eventId, id));
  if (resetHash) statements.push(db.prepare(`INSERT INTO password_resets(token_hash,user_id,created_by,created_at,expires_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = ?)`).bind(resetHash, id, session.userId, now, expiresAt, eventId, id));
  const detailIndex = statements.length;
  statements.push(detailStatement(db, id, session.userId));
  const results = await db.batch(statements);
  if (results[1].meta.changes !== 1) {
    const freshActor = await getAdminRole(env, session.userId);
    if (!freshActor) throw new HttpError(403, "ADMIN_REQUIRED", "Trusted administrator access is required.");
    if (operation === "role" && freshActor !== "owner") protectedAccount();
    const fresh = await account(db, session, id);
    if (!canManage(freshActor, session.userId, fresh) && !selfProfile) protectedAccount();
    conflict();
  }
  const result = detailProjection(results[detailIndex].results[0], actorRole, session.userId);
  const revokedSessionCount = revoke ? results[3].meta.changes : 0;
  if (rawReset) return json({ account: result, resetLink: `${env.APP_ORIGIN}/spinarium/#reset-password=${rawReset}`, expiresAt: iso(expiresAt), revokedSessionCount });
  return json({ ...result, revokedSessionCount });
}
async function handleAdminAccounts(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/accounts" && !url.pathname.startsWith("/api/admin/accounts/")) return null;
  const session = await requireSession(request, env);
  const actorRole = await getAdminRole(env, session.userId);
  if (!actorRole) throw new HttpError(403, "ADMIN_REQUIRED", "Trusted administrator access is required.");
  const db = env.DB.withSession("first-primary");
  if (url.pathname === "/api/admin/accounts") {
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    return directory(db, session, url);
  }
  if (url.pathname === "/api/admin/accounts/summary") {
    queryParameters(url, []);
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    return summary(db, session);
  }
  const match = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)(?:\/(ownerships|history|revoke-sessions|password-reset|role))?$/);
  if (!match || !UUID.test(match[1])) throw new HttpError(404, "NOT_FOUND", "The account endpoint was not found.");
  const id = match[1].toLowerCase();
  const section = match[2];
  if (section === "ownerships" || section === "history") {
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    return relatedPage(db, session, id, section, url);
  }
  queryParameters(url, []);
  if (!section && request.method === "GET") return json(detailProjection(await account(db, session, id), actorRole, session.userId));
  const method = !section || section === "role" ? "PATCH" : "POST";
  if (request.method !== method) throw new HttpError(405, "METHOD_NOT_ALLOWED", `Use ${method} for this endpoint.`);
  return mutation(request, env, session, actorRole, id, section ?? "patch");
}

// src/showcase.ts
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function snapshotJson(alias) {
  return `json_object('veiling_id',${alias}.veiling_id,'name',${alias}.name,'description',${alias}.description,
    'character_number',${alias}.character_number,'rarity',${alias}.rarity,'edition',${alias}.edition,
    'artwork_id',${alias}.artwork_id,'visibility',${alias}.visibility,'release_date',${alias}.release_date,
    'source_revision',${alias}.source_revision,'updated_at',${alias}.updated_at)`;
}
var PUBLICATION_COLUMN = `CASE WHEN p.veiling_id IS NOT NULL THEN ${snapshotJson("p")} ELSE NULL END AS publication_json`;
var LEGACY_CATALOG_VISIBLE = `(v.deleted_at IS NULL AND v.status != 'draft' AND NOT EXISTS (
  SELECT 1 FROM publication_audit history WHERE history.veiling_id=v.id
))`;
var CATALOG_WITH_PUBLICATION = `SELECT v.*, ${PUBLICATION_COLUMN},
  ${LEGACY_CATALOG_VISIBLE} AS legacy_content_visible FROM catalog_veilings v
  LEFT JOIN veiling_publications p ON p.veiling_id=v.id`;
function publicationOf(row) {
  return row.publication_json ? JSON.parse(row.publication_json) : null;
}
function publicationProjection(row) {
  return {
    id: row.veiling_id,
    name: row.name,
    number: row.character_number,
    description: row.description,
    rarity: row.rarity,
    edition: row.edition,
    artworkUrl: row.artwork_id ? `/api/artwork/${row.artwork_id}` : null,
    visibility: row.visibility,
    releaseDate: row.release_date,
    updatedAt: new Date(row.updated_at * 1e3).toISOString()
  };
}
function invalid2(message = "Check the publication settings and try again.") {
  throw new HttpError(400, "INVALID_INPUT", message);
}
function conflict2() {
  throw new HttpError(409, "CATALOG_CHANGED", "The catalog changed. Reload before saving again.");
}
function inputRevision(request) {
  const header = request.headers.get("If-Match");
  if (!header) throw new HttpError(428, "REVISION_REQUIRED", "Reload the catalog before publishing this Veiling.");
  const match = /^"([1-9][0-9]{0,15})"$/.exec(header);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalid2("Send a valid catalog revision.");
  return Number(match[1]);
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
async function publishPublication(request, env, session, id) {
  requireCsrf(request, env, session);
  const expected = inputRevision(request);
  const value = await readJson(request, 2048);
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid2();
  const body = value;
  if (Object.keys(body).length !== 3 || Object.keys(body).some((key) => !["visibility", "releaseDate", "useSavedDraft"].includes(key)) || !["public", "upcoming", "private"].includes(body.visibility) || typeof body.useSavedDraft !== "boolean" || body.releaseDate !== null && !validDate(body.releaseDate) || body.visibility !== "upcoming" && body.releaseDate !== null || body.visibility === "private" && body.useSavedDraft) invalid2();
  const visibility = body.visibility;
  const releaseDate = body.releaseDate;
  const useDraft = body.useSavedDraft;
  const db = env.DB.withSession("first-primary");
  const current = await db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id=?`).bind(id).first();
  if (!current) throw new HttpError(404, "NOT_FOUND", "The Veiling was not found.");
  if (current.deleted_at !== null) throw new HttpError(404, "NOT_FOUND", "The Veiling was not found.");
  if (current.revision !== expected) conflict2();
  if (!useDraft && !publicationOf(current))
    throw new HttpError(409, "PUBLICATION_REQUIRED", "Approve the saved draft before changing its member visibility.");
  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1e3);
  const before = `(SELECT ${snapshotJson("p")} FROM veiling_publications p WHERE p.veiling_id=v.id)`;
  const after = visibility === "private" ? "NULL" : useDraft ? `json_object('veiling_id',v.id,'name',v.name,'description',v.description,'character_number',v.character_number,
        'rarity',v.rarity,'edition',v.edition,'artwork_id',v.artwork_id,'visibility',?,'release_date',?,
        'source_revision',v.revision+1,'updated_at',?)` : `(SELECT json_set(${snapshotJson("p")},'$.visibility',?,'$.release_date',?,
        '$.source_revision',CASE WHEN p.source_revision=v.revision THEN v.revision+1 ELSE p.source_revision END,
        '$.updated_at',?) FROM veiling_publications p WHERE p.veiling_id=v.id)`;
  const action = visibility === "private" ? "hide" : useDraft ? "approve_draft" : "change_visibility";
  const marker = `EXISTS(SELECT 1 FROM publication_audit e WHERE e.id=? AND e.veiling_id=?)`;
  const first = db.prepare(`INSERT INTO publication_audit
    (id,veiling_id,actor_user_id,action,before_json,after_json,catalog_revision,created_at)
    SELECT ?,v.id,?,?,${before},${after},v.revision+1,? FROM catalog_veilings v
    WHERE v.id=? AND v.revision=? AND ${ADMIN_ACTOR_GUARD}
      ${!useDraft ? "AND EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)" : ""}`).bind(
    eventId,
    session.userId,
    action,
    ...visibility === "private" ? [] : [visibility, releaseDate, now],
    now,
    id,
    expected,
    ...adminActorValues(session)
  );
  const statements = [
    first,
    db.prepare(`UPDATE catalog_veilings SET revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND revision=? AND ${marker}`).bind(session.userId, now, id, expected, eventId, id)
  ];
  if (visibility === "private") {
    statements.push(db.prepare(`DELETE FROM veiling_publications WHERE veiling_id=? AND ${marker}`).bind(id, eventId, id));
  } else if (useDraft) {
    statements.push(db.prepare(`INSERT INTO veiling_publications
      (veiling_id,name,description,character_number,rarity,edition,artwork_id,visibility,release_date,source_revision,updated_at)
      SELECT id,name,description,character_number,rarity,edition,artwork_id,?,?,revision,? FROM catalog_veilings
      WHERE id=? AND ${marker}
      ON CONFLICT(veiling_id) DO UPDATE SET name=excluded.name,description=excluded.description,
        character_number=excluded.character_number,rarity=excluded.rarity,edition=excluded.edition,artwork_id=excluded.artwork_id,
        visibility=excluded.visibility,release_date=excluded.release_date,source_revision=excluded.source_revision,updated_at=excluded.updated_at`).bind(visibility, releaseDate, now, id, eventId, id));
  } else {
    statements.push(db.prepare(`UPDATE veiling_publications SET visibility=?,release_date=?,updated_at=?,
      source_revision=CASE WHEN source_revision=? THEN ? ELSE source_revision END WHERE veiling_id=? AND ${marker}`).bind(visibility, releaseDate, now, expected, expected + 1, id, eventId, id));
  }
  statements.push(db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id=?`).bind(id));
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: veiling_publications.character_number"))
      throw new HttpError(409, "NUMBER_IN_USE", "This character number is already in use.");
    throw error;
  }
  if (results[0].meta.changes !== 1) {
    await requireSession(request, env);
    if (!await getAdminRole(env, session.userId)) throw new HttpError(403, "ADMIN_REQUIRED", "Trusted administrator access is required.");
    conflict2();
  }
  return results[3].results[0];
}
async function handleShowcase(request, env) {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/showcase\/([^/]*)$/.exec(path);
  if (path !== "/api/showcase" && !match) return null;
  await requireSession(request, env);
  if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
  const db = env.DB.withSession("first-primary");
  if (match) {
    if (!UUID2.test(match[1])) throw new HttpError(404, "NOT_FOUND", "The showcase Veiling was not found.");
    const row = await db.prepare("SELECT * FROM veiling_publications WHERE veiling_id=?").bind(match[1].toLowerCase()).first();
    if (!row) throw new HttpError(404, "NOT_FOUND", "The showcase Veiling was not found.");
    return json({ schemaVersion: "1", mode: "live", veiling: publicationProjection(row) });
  }
  const rows = await db.prepare(`SELECT * FROM veiling_publications
    ORDER BY visibility='upcoming', character_number IS NULL, character_number, veiling_id`).all();
  return json({ schemaVersion: "1", mode: "live", veilings: rows.results.map(publicationProjection) });
}

// src/data.ts
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
var INPUT_FIELDS = /* @__PURE__ */ new Set(["name", "description", "number", "status", "rarity", "edition"]);
var ADMIN_EXISTS = `EXISTS (
  SELECT 1 FROM admin_allowlist a JOIN users u ON u.id = a.user_id
  WHERE a.user_id = ? AND u.disabled = 0
)`;
var AUDIT_JSON = `json_object(
  'id', id, 'name', name, 'description', description,
  'number', character_number, 'status', status, 'rarity', rarity,
  'edition', edition, 'artworkId', artwork_id, 'revision', revision
)`;
async function isAdmin(env, userId) {
  const result = await env.DB.withSession("first-primary").prepare(`SELECT 1 AS permitted WHERE ${ADMIN_EXISTS}`).bind(userId).first();
  return result !== null;
}
async function requireAdmin(env, session) {
  if (!await isAdmin(env, session.userId)) {
    throw new HttpError(403, "ADMIN_REQUIRED", "Trusted administrator access is required.");
  }
}
function invalidInput2(message = "Check the Veiling fields and try again.") {
  throw new HttpError(400, "INVALID_INPUT", message);
}
function text(value, maximum, required = false) {
  if (typeof value !== "string") invalidInput2();
  const normalized = value.trim();
  if (normalized.length > maximum || required && !normalized || normalized.includes("\0")) invalidInput2();
  return normalized;
}
function nullableText(value, maximum) {
  return value === null ? null : text(value, maximum) || null;
}
function parseInput(value, existing) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidInput2();
  const input = value;
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !INPUT_FIELDS.has(key))) invalidInput2();
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  if (!existing && !has("name")) invalidInput2("A Veiling name is required.");
  const result = {
    name: has("name") ? text(input.name, 120, true) : existing.name,
    description: has("description") ? text(input.description, 2e4) : existing?.description ?? "",
    number: has("number") ? input.number : existing?.character_number ?? null,
    status: has("status") ? input.status : existing?.status ?? "draft",
    rarity: has("rarity") ? nullableText(input.rarity, 80) : existing?.rarity ?? null,
    edition: has("edition") ? nullableText(input.edition, 120) : existing?.edition ?? null
  };
  if (result.number !== null && (!Number.isSafeInteger(result.number) || result.number < 1 || result.number > 999999)) {
    invalidInput2("The character number must be a whole number from 1 to 999999.");
  }
  if (!["draft", "active", "retired"].includes(result.status)) invalidInput2("Choose a valid publication status.");
  return result;
}
function adminProjection(row) {
  const publication = publicationOf(row);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    character_number: row.character_number,
    status: row.status,
    rarity: row.rarity,
    edition: row.edition,
    revision: row.revision,
    created_at: new Date(row.created_at * 1e3).toISOString(),
    updated_at: new Date(row.updated_at * 1e3).toISOString(),
    artworkUrl: row.artwork_id ? `/api/artwork/${row.artwork_id}` : null,
    publication: publication ? { ...publicationProjection(publication), sourceRevision: publication.source_revision } : null
  };
}
function auditProjection(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    number: row.character_number,
    status: row.status,
    rarity: row.rarity,
    edition: row.edition,
    artworkId: row.artwork_id,
    revision: row.revision
  };
}
async function catalogRow(env, id) {
  const row = await env.DB.withSession("first-primary").prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id).first();
  if (!row || row.deleted_at !== null) throw new HttpError(404, "NOT_FOUND", "The Veiling was not found.");
  return row;
}
function catalogDatabaseError(error) {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed: catalog_veilings.character_number")) {
    throw new HttpError(409, "NUMBER_IN_USE", "This character number is already in use.");
  }
  throw error;
}
async function dashboard(env, session) {
  const db = env.DB.withSession("first-primary");
  const results = await db.batch([
    db.prepare(`${CATALOG_WITH_PUBLICATION}
      WHERE EXISTS (
        SELECT 1 FROM ownerships o WHERE o.user_id = ? AND o.veiling_id = v.id
      ) ORDER BY p.veiling_id IS NULL AND NOT ${LEGACY_CATALOG_VISIBLE},
        CASE WHEN p.veiling_id IS NOT NULL THEN p.character_number WHEN ${LEGACY_CATALOG_VISIBLE} THEN v.character_number END, v.id`).bind(session.userId),
    db.prepare(`SELECT o.* FROM ownerships o
      WHERE o.user_id = ? ORDER BY o.acquired_at, o.id`).bind(session.userId),
    db.prepare(`SELECT d.* FROM discoveries d JOIN catalog_veilings v ON v.id = d.veiling_id
      WHERE (${LEGACY_CATALOG_VISIBLE} OR EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)) AND EXISTS (
        SELECT 1 FROM ownerships o WHERE o.user_id = ? AND o.veiling_id = d.veiling_id
      )`).bind(session.userId)
  ]);
  const veilings = results[0].results;
  const ownerships = results[1].results;
  const discoveries = results[2].results;
  const discovered = new Map(discoveries.map((row) => [row.veiling_id, row]));
  return json({
    schemaVersion: "1",
    mode: "live",
    profile: { id: session.userId, displayName: session.displayName, memberSince: session.memberSince, avatarSrc: null },
    veilings: veilings.map((row) => {
      const publication = publicationOf(row);
      const unavailable2 = !publication && !row.legacy_content_visible;
      const revealed = Boolean(publication) || !unavailable2 && discovered.get(row.id)?.status === "revealed";
      const name = publication ? publication.name : row.name;
      const description = publication ? publication.description : row.description;
      const artworkId = publication ? publication.artwork_id : row.artwork_id;
      return {
        id: row.id,
        number: unavailable2 ? null : publication ? publication.character_number : row.character_number,
        name: revealed ? name : null,
        type: null,
        origin: null,
        editionIds: [],
        artwork: revealed && artworkId ? [{
          id: artworkId,
          role: "color_art",
          url: `/api/artwork/${artworkId}`,
          alt: name,
          variantId: null,
          status: "approved"
        }] : [],
        lore: revealed ? [{
          id: row.id,
          locale: "en",
          title: name,
          preview: description,
          text: description,
          status: "published",
          version: publication ? publication.source_revision : row.revision
        }] : [],
        releaseDate: null,
        contentStatus: unavailable2 ? "unavailable" : revealed ? "published" : "redacted"
      };
    }),
    ownerships: ownerships.map((row) => ({
      id: row.id,
      userId: session.userId,
      veilingId: row.veiling_id,
      acquisition: row.acquisition,
      physicalCardId: null,
      editionId: "",
      variantId: "",
      acquiredAt: new Date(row.acquired_at * 1e3).toISOString()
    })),
    discoveries: discoveries.map((row) => ({
      veilingId: row.veiling_id,
      status: row.status,
      firstDiscoveredAt: row.first_discovered_at === null ? null : new Date(row.first_discovered_at * 1e3).toISOString(),
      firstDiscovererId: row.first_discoverer_id === session.userId ? session.userId : null,
      publicDiscovererName: null,
      revealKind: row.reveal_kind
    })),
    series: [],
    editions: [],
    variants: [],
    rarities: [],
    physicalCards: [],
    achievements: [],
    userAchievements: [],
    collections: [],
    news: [],
    events: []
  });
}
async function ownershipDetail(env, session, id) {
  const row = await env.DB.withSession("first-primary").prepare(`
    SELECT o.id, o.user_id, o.veiling_id, o.acquisition, o.acquired_at,
      v.character_number, v.name, v.description, v.artwork_id, v.status AS catalog_status,
      d.status AS discovery_status, ${PUBLICATION_COLUMN}, ${LEGACY_CATALOG_VISIBLE} AS legacy_content_visible
    FROM ownerships o JOIN catalog_veilings v ON v.id = o.veiling_id
    LEFT JOIN veiling_publications p ON p.veiling_id=v.id
    LEFT JOIN discoveries d ON d.veiling_id = v.id
    WHERE o.id = ? AND o.user_id = ?
  `).bind(id, session.userId).first();
  if (!row) throw new HttpError(404, "NOT_FOUND", "The ownership was not found.");
  const publication = publicationOf(row);
  const unavailable2 = !publication && !row.legacy_content_visible;
  const revealed = Boolean(publication) || !unavailable2 && row.discovery_status === "revealed";
  const artworkId = publication ? publication.artwork_id : row.artwork_id;
  return json({
    schemaVersion: "1",
    mode: "live",
    ownership: {
      id: row.id,
      userId: session.userId,
      veilingId: row.veiling_id,
      acquisition: row.acquisition,
      acquiredAt: new Date(row.acquired_at * 1e3).toISOString(),
      physicalCardId: null
    },
    veiling: {
      id: row.veiling_id,
      number: unavailable2 ? null : publication ? publication.character_number : row.character_number,
      name: revealed ? publication ? publication.name : row.name : null,
      description: revealed ? publication ? publication.description : row.description : null,
      artworkUrl: revealed && artworkId ? `/api/artwork/${artworkId}` : null,
      contentStatus: unavailable2 ? "unavailable" : revealed ? "published" : "redacted"
    }
  });
}
async function createVeiling(request, env, session) {
  const db = env.DB.withSession("first-primary");
  requireCsrf(request, env, session);
  const input = parseInput(await readJson(request, 1e5));
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1e3);
  let results;
  try {
    results = await db.batch([
      db.prepare(`INSERT INTO catalog_veilings
        (id, name, description, character_number, status, rarity, edition, created_by, updated_by, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ADMIN_ACTOR_GUARD}`).bind(
        id,
        input.name,
        input.description,
        input.number,
        input.status,
        input.rarity,
        input.edition,
        session.userId,
        session.userId,
        now,
        now,
        ...adminActorValues(session)
      ),
      db.prepare(`INSERT INTO catalog_audit (id, veiling_id, actor_user_id, action, before_json, after_json, created_at)
        SELECT ?, id, ?, 'create', NULL, ${AUDIT_JSON}, ? FROM catalog_veilings WHERE id = ? AND changes() = 1`).bind(crypto.randomUUID(), session.userId, now, id),
      db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id)
    ]);
  } catch (error) {
    catalogDatabaseError(error);
  }
  if (results[0].meta.changes !== 1) {
    await requireSession(request, env);
    throw new HttpError(403, "ADMIN_REQUIRED", "Trusted administrator access is required.");
  }
  return json(adminProjection(results[2].results[0]), 201);
}
async function deleteVeiling(request, env, session, id) {
  const db = env.DB.withSession("first-primary");
  requireCsrf(request, env, session);
  const current = await catalogRow(env, id);
  requireRevision(request, current.revision);
  if (current.publication_json)
    throw new HttpError(409, "UNPUBLISH_FIRST", "Unpublish this Veiling before deleting it.");
  const now = Math.floor(Date.now() / 1e3);
  const results = await db.batch([
    db.prepare(`UPDATE catalog_veilings
      SET deleted_at=?, deleted_by=?, updated_by=?, updated_at=?,
        character_number=NULL, status='retired', revision=revision+1
      WHERE id=? AND revision=? AND deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=catalog_veilings.id)
        AND ${ADMIN_ACTOR_GUARD}`).bind(now, session.userId, session.userId, now, id, current.revision, ...adminActorValues(session)),
    db.prepare(`INSERT INTO veiling_deletion_audit(id, veiling_id, actor_user_id, before_json, created_at)
      SELECT ?,id,?,?,? FROM catalog_veilings WHERE id=? AND changes()=1`).bind(crypto.randomUUID(), session.userId, JSON.stringify(auditProjection(current)), now, id)
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
    throw new HttpError(409, "CATALOG_CHANGED", "The Veiling changed. Reload before deleting.");
  return json({ id, deleted: true });
}
async function updateVeiling(request, env, session, id) {
  const db = env.DB.withSession("first-primary");
  requireCsrf(request, env, session);
  const existing = await catalogRow(env, id);
  requireRevision(request, existing.revision);
  const input = parseInput(await readJson(request, 1e5), existing);
  const now = Math.floor(Date.now() / 1e3);
  let results;
  try {
    results = await db.batch([
      db.prepare(`UPDATE catalog_veilings SET name = ?, description = ?, character_number = ?, status = ?,
        rarity = ?, edition = ?, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL AND ${ADMIN_ACTOR_GUARD}`).bind(
        input.name,
        input.description,
        input.number,
        input.status,
        input.rarity,
        input.edition,
        session.userId,
        now,
        id,
        existing.revision,
        ...adminActorValues(session)
      ),
      db.prepare(`INSERT INTO catalog_audit (id, veiling_id, actor_user_id, action, before_json, after_json, created_at)
        SELECT ?, id, ?, 'update', ?, ${AUDIT_JSON}, ? FROM catalog_veilings WHERE id = ? AND changes() = 1`).bind(crypto.randomUUID(), session.userId, JSON.stringify(auditProjection(existing)), now, id),
      db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id)
    ]);
  } catch (error) {
    catalogDatabaseError(error);
  }
  if (results[0].meta.changes !== 1) {
    await requireSession(request, env);
    await requireAdmin(env, session);
    throw new HttpError(409, "CATALOG_CHANGED", "The catalog changed. Reload before saving again.");
  }
  return json(adminProjection(results[2].results[0]));
}
function requireRevision(request, current) {
  const header = request.headers.get("If-Match");
  if (!header) throw new HttpError(428, "REVISION_REQUIRED", "Reload the catalog before editing this Veiling.");
  const match = header.match(/^"([1-9][0-9]{0,15})"$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalidInput2("Send a valid catalog revision.");
  if (Number(match[1]) !== current) throw new HttpError(409, "CATALOG_CHANGED", "The catalog changed. Reload before saving again.");
}
function imageExtension(contentType, bytes) {
  if (contentType === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "png";
  if (contentType === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (contentType === "image/webp" && bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  invalidInput2("Choose a PNG, JPEG, or WebP image with a matching file signature.");
}
async function uploadArtwork(request, env, session, id) {
  const db = env.DB.withSession("first-primary");
  requireCsrf(request, env, session);
  const existing = await catalogRow(env, id);
  requireRevision(request, existing.revision);
  const contentType = request.headers.get("content-type") ?? "";
  if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) invalidInput2("Choose a PNG, JPEG, or WebP image.");
  const bytes = await readBytes(request, MAX_ARTWORK_BYTES);
  const extension = imageExtension(contentType, bytes);
  const artworkId = crypto.randomUUID();
  const objectKey = `veilings/${id}/${artworkId}.${extension}`;
  const stored = await env.ARTWORK.put(objectKey, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType, cacheControl: "private, no-store" }
  });
  if (!stored) throw new HttpError(409, "ARTWORK_CONFLICT", "The artwork could not be stored. Try again.");
  const now = Math.floor(Date.now() / 1e3);
  let results;
  try {
    results = await db.batch([
      db.prepare(`INSERT INTO artwork (id, veiling_id, object_key, content_type, byte_length, created_by, created_at)
        SELECT ?, id, ?, ?, ?, ?, ? FROM catalog_veilings WHERE id = ? AND revision = ? AND deleted_at IS NULL AND ${ADMIN_ACTOR_GUARD}`).bind(artworkId, objectKey, contentType, bytes.byteLength, session.userId, now, id, existing.revision, ...adminActorValues(session)),
      // The successful guarded insert authorizes the rest of this transaction.
      // Re-evaluating time here could leave a partial attachment at expiry.
      db.prepare(`UPDATE catalog_veilings SET artwork_id = ?, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM artwork WHERE id = ?) AND changes() = 1`).bind(artworkId, session.userId, now, id, existing.revision, artworkId),
      db.prepare(`INSERT INTO catalog_audit (id, veiling_id, actor_user_id, action, before_json, after_json, created_at)
        SELECT ?, id, ?, 'artwork', ?, ${AUDIT_JSON}, ? FROM catalog_veilings WHERE id = ? AND changes() = 1`).bind(crypto.randomUUID(), session.userId, JSON.stringify(auditProjection(existing)), now, id),
      db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id)
    ]);
    if (results[1].meta.changes !== 1) {
      await requireSession(request, env);
      await requireAdmin(env, session);
      throw new HttpError(409, "CATALOG_CHANGED", "The catalog changed. Reload before uploading again.");
    }
  } catch (error) {
    await env.ARTWORK.delete(objectKey).catch(() => void 0);
    throw error;
  }
  return json(adminProjection(results[3].results[0]));
}
async function artwork(env, session, id) {
  const row = await env.DB.withSession("first-primary").prepare(`SELECT a.* FROM artwork a JOIN catalog_veilings v ON v.id = a.veiling_id
    WHERE a.id = ? AND (${ADMIN_EXISTS} OR EXISTS(
      SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id AND p.artwork_id=a.id
    ) OR (
      ${LEGACY_CATALOG_VISIBLE} AND v.artwork_id = a.id
      AND NOT EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)
      AND EXISTS (SELECT 1 FROM discoveries d WHERE d.veiling_id = v.id AND d.status = 'revealed')
      AND EXISTS (
        SELECT 1 FROM ownerships o WHERE o.user_id = ? AND o.veiling_id = a.veiling_id
      )
    ))`).bind(id, session.userId, session.userId).first();
  if (!row) throw new HttpError(404, "NOT_FOUND", "The artwork was not found.");
  const object = await env.ARTWORK.get(row.object_key);
  if (!object) throw new HttpError(404, "NOT_FOUND", "The artwork was not found.");
  return new Response(object.body, { headers: {
    "Content-Type": row.content_type,
    "Content-Length": String(row.byte_length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline"
  } });
}
async function handleData(request, env) {
  const showcaseResponse = await handleShowcase(request, env);
  if (showcaseResponse) return showcaseResponse;
  const accountResponse = await handleAdminAccounts(request, env);
  if (accountResponse) return accountResponse;
  const path = new URL(request.url).pathname;
  const veilingMatch = path.match(/^\/api\/admin\/veilings\/([^/]+)(\/artwork|\/publication)?$/);
  const artworkMatch = path.match(/^\/api\/artwork\/([^/]+)$/);
  const ownershipMatch = path.match(/^\/api\/ownerships\/([^/]*)$/);
  const isKnown = ["/api/dashboard", "/api/admin/access", "/api/admin/veilings"].includes(path) || veilingMatch || artworkMatch || ownershipMatch;
  if (!isKnown) return null;
  const session = await requireSession(request, env);
  if (path === "/api/dashboard") {
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    return dashboard(env, session);
  }
  if (ownershipMatch) {
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    if (!UUID3.test(ownershipMatch[1])) throw new HttpError(404, "NOT_FOUND", "The ownership was not found.");
    return ownershipDetail(env, session, ownershipMatch[1].toLowerCase());
  }
  if (path === "/api/admin/access") {
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    const role = await getAdminRole(env, session.userId);
    return json({ admin: role !== null, role });
  }
  if (artworkMatch) {
    if (request.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    if (!UUID3.test(artworkMatch[1])) throw new HttpError(404, "NOT_FOUND", "The artwork was not found.");
    return artwork(env, session, artworkMatch[1].toLowerCase());
  }
  await requireAdmin(env, session);
  if (path === "/api/admin/veilings") {
    if (request.method === "GET") {
      const rows = await env.DB.withSession("first-primary").prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.deleted_at IS NULL ORDER BY v.character_number IS NULL, v.character_number, v.created_at DESC, v.id LIMIT 200`).all();
      return json(rows.results.map(adminProjection));
    }
    if (request.method === "POST") return createVeiling(request, env, session);
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET or POST for this endpoint.");
  }
  const id = veilingMatch[1].toLowerCase();
  if (!UUID3.test(id)) invalidInput2("Select a valid Veiling.");
  if (veilingMatch[2] === "/publication") {
    if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    return json(adminProjection(await publishPublication(request, env, session, id)));
  }
  if (veilingMatch[2]) {
    if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    return uploadArtwork(request, env, session, id);
  }
  if (request.method === "DELETE") return deleteVeiling(request, env, session, id);
  if (request.method !== "PATCH") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use PATCH or DELETE for this endpoint.");
  return updateVeiling(request, env, session, id);
}

// src/index.ts
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET")
        return json({ service: "spinarium", accountsEnabled: env.AUTH_ENABLED === "true", claimsEnabled: false });
      if (!url.pathname.startsWith("/api/"))
        throw new HttpError(404, "NOT_FOUND", "This endpoint does not exist.");
      if (env.AUTH_ENABLED !== "true")
        throw new HttpError(503, "ACCOUNTS_DISABLED", "Real accounts are not enabled yet.");
      if (!env.APP_ORIGIN || url.origin !== env.APP_ORIGIN)
        throw new HttpError(403, "ORIGIN_DENIED", "Use the configured Spinarium origin.");
      const response = await handleAuth(request, env) ?? await handleData(request, env);
      return response ?? json({ code: "NOT_FOUND", message: "This endpoint does not exist." }, 404);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ code: error.code, message: error.message }, error.status);
      console.error(JSON.stringify({ event: "spinarium_request_failed", method: request.method }));
      return json({ code: "SERVICE_UNAVAILABLE", message: "Spinarium could not complete this request." }, 503);
    }
  }
};
export {
  index_default as default
};
