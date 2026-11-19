# Plan: first-party remote MCP server

## Status

- Draft plan. Not implemented. No code, dependency, migration or config entry is added by this document.
- Date: 2026-11-19. Base: `feat/document-previews` at `648c223b`.
- Assumed MCP specification revision: 2025-06-18 or later. This is assumed from memory, not checked against the published text. No `@modelcontextprotocol/*` package is installed, so nothing here could be verified against a local copy. Every protocol-level statement below follows that assumed revision, and the ones most likely to be wrong are collected in [Verify before slice 1](#verify-before-slice-1).
- Reading of the request ("plan the integration of a real mcp server with oauth and custom fields etc."): a remote MCP server hosted inside `apps/papra-server` and reached by URL, authorized through OAuth, exposing documents, tags, custom properties ("custom fields") and document enrichment. A local stdio wrapper built on `packages/api-sdk` or `packages/cli` is the deferred alternative: it needs the user to install and configure a process and paste an API key, and it cannot offer a browser authorization flow.

## 1. Location and mounting

### Module

A new module `apps/papra-server/src/modules/mcp/`, following the layout of existing modules (for example `apps/papra-server/src/modules/custom-properties/`):

- `mcp.config.ts`: config definition.
- `mcp.routes.ts`: registers the HTTP endpoint and the metadata endpoints.
- `mcp.tools.ts`: the tool catalogue (name, description, input schema, required permissions, handler).
- `mcp.usecases.ts`: argument validation, permission check, dispatch, error mapping.
- `mcp.models.ts` and tests colocated as `*.test.ts`, as in the other modules.

### Config flag

Defined as a `figue` `ConfigDefinition`, the same shape as `apps/papra-server/src/modules/custom-properties/custom-properties.config.ts`, and registered in `apps/papra-server/src/modules/config/config.ts` next to the other module configs.

| Key           | Env var              | Default | Purpose                             |
| ------------- | -------------------- | ------- | ----------------------------------- |
| `mcp.enabled` | `MCP_SERVER_ENABLED` | `false` | Turns the endpoint and metadata on. |

When the flag is off the endpoint and the metadata routes are not registered, so requests fall through to the existing 404 handling.

### Mounting on the Hono app

`apps/papra-server/src/modules/app/server.api.routes.ts` registers `app.use('/api/*', ...)` and hands every `/api/*` request to the contract request handler first. The MCP endpoint is not a contract route (one endpoint, JSON-RPC body, optional event stream), so it must not live under `/api/*`.

- Endpoint path: `/mcp`, outside `/api/*`.
- Registration: a `registerMcpRoutes(context)` function added to `registerRoutes` in `apps/papra-server/src/modules/app/server.routes.ts`, called only when `config.mcp.enabled` is true.
- Metadata endpoints (see section 2) are served at their well-known paths from the same registration function. The server also serves client assets (`apps/papra-server/src/modules/app/static-assets/`), so the plan must make sure the SPA fallback does not answer `/.well-known/*` or `/mcp`. Slice 1 adds a test for that.

### Transport

Following the assumed revision, the transport is "streamable HTTP": a single endpoint that accepts `POST` with a JSON-RPC message and may answer with a JSON body or an event stream, plus an optional `GET` that opens a server-to-client stream.

- Stateless is recommended. Every tool in the catalogue is a request/response call, there is no server-initiated message, and the server may run as several instances behind a load balancer. Each `POST` is handled on its own, with no session id. `GET` returns `405`.
- Stateful sessions (an `Mcp-Session-Id` header, per the assumed revision) are only needed for server-initiated messages, which this plan does not use. If a later tool needs progress notifications, revisit.
- Session-less operation still requires an authenticated request every time; there is no state to attach a login to.

### Dependency decision

Not installed today (no `@modelcontextprotocol/*` in any `package.json`). Slice 1 decides between:

1. `@modelcontextprotocol/sdk`: handles JSON-RPC framing, tool registration and capability negotiation. Cost: a new dependency, and its HTTP transport targets Node request/response objects, so it needs an adapter on Hono's `Request`/`Response`.
2. A hand-rolled JSON-RPC handler for the small subset used (`initialize`, `tools/list`, `tools/call`, `ping`). Cost: protocol drift is Papra's problem.

Recommendation: start with the SDK if its transport can run on web-standard `Request`/`Response`; otherwise hand-roll the subset. A maintainer approves the dependency before slice 1 merges.

## 2. Authentication and authorization

### What exists today

- API keys: tokens are `ppapi_` followed by 64 alphanumeric characters, and `API_KEY_PERMISSIONS` lists 16 strings, `organizations|documents|tags|custom-properties` crossed with `create|read|update|delete` (`apps/papra-server/src/modules/api-keys/api-keys.constants.ts`).
- Contract routes resolve credentials in `buildResolveAuthenticationContext` (`apps/papra-server/src/modules/api/api.authentication.ts`). It returns `{ userId, authType: 'session' }` or `{ userId, apiKeyId, authType: 'api-key' }`, rejects a request that carries both a session and an API key, and for API keys requires every entry of the route's `apiKeyPermissions` to be present on the key. A route that passes no `apiKeyPermissions` is session-only.
- Legacy Hono routes use `requireAuthentication` (`apps/papra-server/src/modules/app/auth/auth.middleware.ts`), which calls `isAuthenticationValid` (`apps/papra-server/src/modules/app/auth/auth.models.ts`) with the same permission list.
- Both paths are followed, inside the handler, by `ensureUserIsInOrganization` (`apps/papra-server/src/modules/organizations/organizations.usecases.ts`). Example: `apps/papra-server/src/modules/document-enrichment/document-enrichment.api.routes.ts`. API-key permissions say what kind of call is allowed; membership says on which organization. Role-based permissions live in `apps/papra-server/src/modules/roles/`.
- better-auth is configured in `apps/papra-server/src/modules/app/auth/auth.services.ts` with the `expo` and `twoFactor` plugins and, only when custom providers are configured, `genericOAuth`. Papra is an OAuth client today and never an authorization server.

### Option A: API keys as bearer tokens on `/mcp`

The MCP endpoint accepts `Authorization: Bearer ppapi_...` and reuses `buildGetApiKey`.

| Aspect               | Assessment                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client compatibility | Works only with clients that let the user paste a static header. Clients that implement the MCP authorization flow (discovery, registration, browser consent) cannot use it, because there is no authorization server to discover. |
| Token scope          | Already scoped through `API_KEY_PERMISSIONS`.                                                                                                                                                                                      |
| Audience binding     | None. A key works on `/api/*` and on `/mcp`. A key leaked from an MCP client config is a full REST credential for its scopes.                                                                                                      |
| Revocation           | Exists (API keys page in `apps/papra-client/src/modules/api-keys/`).                                                                                                                                                               |
| Lifetime             | Long-lived by design.                                                                                                                                                                                                              |
| Implementation cost  | Small: one resolver, no new tables.                                                                                                                                                                                                |
| New tables           | None.                                                                                                                                                                                                                              |

### Option B: OAuth 2.1 authorization server

Papra becomes an authorization server for the MCP resource. Per the assumed revision this means: authorization-server metadata (RFC 8414), protected-resource metadata (RFC 9728), dynamic client registration (RFC 7591), authorization code with PKCE (RFC 7636), resource indicators (RFC 8707) so tokens are bound to the MCP URL, a consent screen, token and refresh endpoints, and revocation.

| Aspect               | Assessment                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Client compatibility | Works with clients that implement the MCP authorization flow, and needs no pasted secret. |
| Token scope          | Scopes are chosen on the consent screen and can be narrower than what the user could do.  |
| Audience binding     | Tokens are issued for the MCP resource URL and rejected elsewhere.                        |
| Revocation           | Per client, from a connected-apps list; access tokens are short-lived and refreshed.      |
| Implementation cost  | Large: tables, consent UI, discovery endpoints, a third authentication context.           |
| New tables           | Client registrations, access/refresh tokens, consents.                                    |

### What better-auth 1.6.11 provides

Version pinned in the catalog of `pnpm-workspace.yaml` and consumed by `apps/papra-server/package.json`. Checked in the installed package:

- `better-auth/plugins` exports `mcp`, `withMcpAuth`, `oAuthProtectedResourceMetadata`, `oAuthDiscoveryMetadata`, `oidcProvider`, `jwt`, `bearer` and `deviceAuthorization`.
- `oidcProvider` is annotated `@deprecated Use @better-auth/oauth-provider instead. This plugin will be removed in the next major version.` (`dist/plugins/oidc-provider/index.d.mts` in the installed package).
- The `mcp` plugin imports and wraps `oidcProvider` and reuses its schema (`dist/plugins/mcp/index.mjs`), so it inherits the deprecation.
- `@better-auth/oauth-provider` is not installed. Using it adds a dependency that a maintainer must approve.
- The oidc-provider schema defines three models: `oauthApplication`, `oauthAccessToken`, `oauthConsent` (`dist/plugins/oidc-provider/schema.mjs`).

Tables: Papra writes its auth tables by hand in `apps/papra-server/src/modules/app/auth/auth.tables.ts` (`auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_two_factor`) and applies schema changes with hand-written migrations in `apps/papra-server/src/migrations/list/`, registered in `apps/papra-server/src/migrations/migrations.registry.ts`. The new tables follow the same pattern: drizzle tables with `auth_`-prefixed names (for example `auth_oauth_clients`, `auth_oauth_tokens`, `auth_oauth_consents`), mapped to better-auth's model names through its `modelName`/schema options, and a hand-written migration. better-auth's own migration CLI is not used.

### Recommendation

Build option B on `@better-auth/oauth-provider`, and ship option A first as the interim.

Reasons:

1. The deprecated `oidcProvider`/`mcp` pair will be removed in the next better-auth major version. Building new tables and endpoints on it would mean a forced migration shortly after.
2. Option A is a few dozen lines and lets the tool catalogue be built and tested before the authorization server exists. Whether it is useful to real users depends on the target clients (open question 1).
3. OAuth tokens give audience binding and per-client revocation, which API keys cannot.

Fallback if the maintainer rejects the new dependency: keep option A only and document it as the supported way to connect (static bearer header). A second fallback is to build the authorization endpoints on the deprecated plugin that is already installed, accepting the migration cost at the next better-auth major. This plan does not recommend that.

### Scope mapping

OAuth scopes are the existing `API_KEY_PERMISSIONS` strings 1:1, so a single check covers both token types.

| OAuth scope                                               | Meaning                                          |
| --------------------------------------------------------- | ------------------------------------------------ |
| `organizations:read`                                      | List and read organizations the user belongs to. |
| `organizations:create` / `update` / `delete`              | Defined, not requested by any tool in this plan. |
| `documents:read` / `create` / `update` / `delete`         | Same as the API-key permission.                  |
| `tags:read` / `create` / `update` / `delete`              | Same as the API-key permission.                  |
| `custom-properties:read` / `create` / `update` / `delete` | Same as the API-key permission.                  |

The consent screen groups them in plain language (for example "Read your documents"). The server does not offer coarse aliases; the client UI does the grouping. Offering only a subset (for example excluding `*:delete` and `organizations:*`) on first release is an option, see open questions.

### Third authentication context

`buildResolveAuthenticationContext` gains a third result: `{ userId, clientId, scopes, authType: 'oauth' }`, and `isAuthenticationValid` in `apps/papra-server/src/modules/app/auth/auth.models.ts` gains the matching branch for legacy routes. Rules:

- The existing per-route `apiKeyPermissions` list is checked against the token's scopes with the same `every(...)` logic. The type name `apiKeyPermissions` stays as is in slice 1; renaming it to something neutral is optional churn.
- Tokens are audience-bound to the MCP resource URL. The `/api/*` resolver rejects `authType: 'oauth'` tokens unless a later decision opens REST to them. The simplest implementation is a separate resolver for `/mcp` so `/api/*` never sees OAuth tokens.
- A token's scopes never exceed the user's rights. Scope checks are added on top of `ensureUserIsInOrganization` and role checks (`apps/papra-server/src/modules/roles/`), not instead of them. A user who is removed from an organization loses access through the token immediately, because membership is checked on every call.

### URLs

Issuer, resource URL and metadata URLs are derived from configured base URLs, never from request `Host` headers, so instances behind a reverse proxy work. The server base URL comes from `server.baseUrl` and `appBaseUrl` in `apps/papra-server/src/modules/config/config.ts`; `getClientBaseUrl` in `apps/papra-server/src/modules/config/config.models.ts` is the existing helper for the client side and a sibling helper for the server side is added in slice 1. Metadata paths (per the assumed revision): `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, with `401` responses from `/mcp` carrying a `WWW-Authenticate` header that points at the former.

## 3. Tool catalogue

### Principles

- Tools call usecases or contract handlers in process, with the resolved user id. They never make HTTP calls back to the server.
- Organization scoping: organization id is a tool argument, as in the REST API. Almost every route takes `:organizationId` and runs `ensureUserIsInOrganization`; a `list_organizations` tool tells the model which ids exist. Binding a token to one organization is listed as an open question.
- Errors: `createError` in `apps/papra-server/src/modules/shared/errors/errors.ts` produces errors with `code`, `message` and `isInternal`. A non-internal error becomes a tool result with `isError: true` and text content `{ code, message }`, the same payload the HTTP error middleware sends (`apps/papra-server/src/modules/app/middlewares/errors.middleware.ts`). Internal errors become `isError: true` with a generic message and are logged. Malformed JSON-RPC and unknown tools use protocol-level errors, not `isError`.
- Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`): per the assumed revision, tool annotations are hints only; permission checks do not rely on them.

### Table

Routes are in `apps/papra-server/src/modules/documents/documents.routes.ts` and `apps/papra-server/src/modules/custom-properties/custom-properties.routes.ts` (legacy Hono), and in `apps/papra-server/src/modules/tags/tags.api.contracts.ts`, `apps/papra-server/src/modules/organizations/organizations.api.contracts.ts` and `apps/papra-server/src/modules/document-enrichment/document-enrichment.api.contracts.ts` (contracts). Slice numbers refer to section 6.

| Tool                              | Purpose                                                 | Calls                                                                      | Permissions                                  | Annotation  | Slice |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- | ----------- | ----- |
| `list_organizations`              | Organizations the user belongs to.                      | `getOrganizationsContract`                                                 | `organizations:read`                         | read-only   | 2     |
| `search_documents`                | Search and list documents; `searchQuery`, sort, paging. | `GET /api/organizations/:organizationId/documents`                         | `documents:read`                             | read-only   | 2     |
| `get_document`                    | One document with metadata.                             | `GET .../documents/:documentId`                                            | `documents:read`                             | read-only   | 2     |
| `read_document_content`           | Extracted text (`content` field), cut to a size limit.  | same route as `get_document`                                               | `documents:read`                             | read-only   | 2     |
| `update_document`                 | Rename, edit content, date, notes.                      | `PATCH .../documents/:documentId`, `updateDocumentBodySchema`              | `documents:update`                           | idempotent  | 3     |
| `upload_document`                 | Create a document from base64 content.                  | `POST .../documents`                                                       | `documents:create`                           | additive    | 3     |
| `delete_document`                 | Move to trash. Deferred past slice 3.                   | `DELETE .../documents/:documentId`                                         | `documents:delete`                           | destructive | later |
| `download_document_file`          | Original file. Deferred, see below.                     | `GET .../documents/:documentId/file`                                       | `documents:read`                             | read-only   | later |
| `list_tags`                       | Tags of an organization.                                | `getOrganizationTagsContract`                                              | `tags:read`                                  | read-only   | 2     |
| `create_tag`                      | Create a tag.                                           | `createOrganizationTagContract`                                            | `tags:create`                                | additive    | 3     |
| `update_tag`                      | Rename or recolor a tag.                                | `updateOrganizationTagContract`                                            | `tags:update`                                | idempotent  | 3     |
| `delete_tag`                      | Delete a tag.                                           | `deleteOrganizationTagContract`                                            | `tags:delete`                                | destructive | 3     |
| `add_document_tag`                | Attach a tag to a document.                             | `addOrganizationDocumentTagContract`                                       | `documents:update`, `tags:read`              | additive    | 3     |
| `remove_document_tag`             | Detach a tag.                                           | `removeOrganizationDocumentTagContract`                                    | `documents:update`, `tags:read`              | destructive | 3     |
| `list_custom_properties`          | Definitions with their select options.                  | `GET .../custom-properties`                                                | `custom-properties:read`                     | read-only   | 2     |
| `get_custom_property`             | One definition with options.                            | `GET .../custom-properties/:propertyDefinitionId`                          | `custom-properties:read`                     | read-only   | 2     |
| `create_custom_property`          | Create a definition.                                    | `POST .../custom-properties`                                               | `custom-properties:create`                   | additive    | 3     |
| `update_custom_property`          | Update a definition.                                    | `PUT .../custom-properties/:propertyDefinitionId`                          | `custom-properties:update`                   | idempotent  | 3     |
| `delete_custom_property`          | Delete a definition and its values.                     | `DELETE .../custom-properties/:propertyDefinitionId`                       | `custom-properties:delete`                   | destructive | 3     |
| `get_document_custom_properties`  | Values of one document.                                 | `GET .../documents/:documentId/custom-properties`                          | `documents:read`, `custom-properties:read`   | read-only   | 2     |
| `set_document_custom_property`    | Set one value.                                          | `PUT .../documents/:documentId/custom-properties/:propertyDefinitionId`    | `documents:update`, `custom-properties:read` | idempotent  | 3     |
| `delete_document_custom_property` | Clear one value.                                        | `DELETE .../documents/:documentId/custom-properties/:propertyDefinitionId` | `documents:update`, `custom-properties:read` | destructive | 3     |
| `enrich_document`                 | Schedule enrichment (currently `auto-tagging`).         | `enrichDocumentContract`                                                   | `documents:update`                           | additive    | 3     |
| `get_task_status`                 | Result of a scheduled task. New usecase, see below.     | none today                                                                 | `documents:read`                             | read-only   | later |

The permission pairs for the custom-property value routes and the tag attach routes match the `apiKeyPermissions` arrays declared in the route files.

### Notes per area

**Documents.**

- `search_documents` maps to the `searchQuery`, `sortField`, `sortOrder`, `pageIndex` and `pageSize` query keys of the list route; `searchDocumentsQuerySchema` is in `apps/papra-server/src/modules/documents/documents.schemas.ts`. Page size is capped at 100 there; the tool keeps the cap and returns a smaller default so one call does not flood the model's context.
- `read_document_content` returns the `content` column of `apps/papra-server/src/modules/documents/documents.table.ts` and takes `offset`/`limit` arguments so long documents can be read in pieces.
- `upload_document`: MCP carries JSON, so file bytes travel as base64, about a third larger than the file. The REST limit is `DOCUMENT_STORAGE_MAX_UPLOAD_SIZE` (`apps/papra-server/src/modules/documents/document-storage.config.ts`, default 25 MB) and the plan-specific limit that the route resolves from the organization plan. The tool applies the same limits to the decoded size and adds a lower hard cap for the encoded payload (suggested starting value 10 MB, open question 8). Larger files are rejected with a clear error.
- `download_document_file` is deferred. Returning a whole file as an embedded resource has the same size problem in the other direction, and extracted text from `read_document_content` covers most uses.
- `delete_document` is deferred out of the first write slice; a model deleting documents is the highest-impact mistake in the catalogue, and the existing trash step makes it recoverable, so it can come later with a destructive annotation.

**Custom properties.** Eight types are defined in `CUSTOM_PROPERTY_TYPES` (`apps/papra-server/src/modules/custom-properties/custom-properties.constants.ts`). The value a tool caller sends comes from each type's `inputSchema` in `apps/papra-server/src/modules/custom-properties/definitions/<type>/<type>.custom-property-definition.ts`:

| Type                | Value sent by the caller                                               | Source of truth                  |
| ------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| `text`              | string, at most 10,000 characters                                      | `definitions/text/`              |
| `number`            | finite number                                                          | `definitions/number/`            |
| `date`              | string or number, converted with `v.toDate()`; send an ISO 8601 string | `definitions/date/`              |
| `boolean`           | `true` or `false`                                                      | `definitions/boolean/`           |
| `select`            | one option id (not the option name)                                    | `definitions/select/`            |
| `multi_select`      | array of option ids                                                    | `definitions/multi-select/`      |
| `user_relation`     | array of user ids, all members of the organization                     | `definitions/user-relation/`     |
| `document_relation` | array of document ids, all in the organization                         | `definitions/document-relation/` |

Discovery: a model cannot guess option ids, user ids or document ids. `list_custom_properties` and `get_custom_property` return each definition with its type and, for the two select types, its options (id and name). Valid user ids come from a `list_organization_members` tool (not in the table above because no contract exists for it; add it with slice 2 if relation properties are wanted, otherwise leave relations to ids the model already holds). Valid document ids come from `search_documents`. The `extendInputValidation` hooks in the same definition files reject ids that do not belong to the organization, and those errors flow through the `isError` mapping above.

**Enrichment.** `enrichDocumentContract` (`apps/papra-server/src/modules/document-enrichment/document-enrichment.api.contracts.ts`) requires `documents:update`, takes a non-empty `capabilities` array (`apps/papra-server/src/modules/document-enrichment/document-enrichment.schemas.ts`; the only capability today is `auto-tagging`) and answers `202 { taskId }`. There is no status endpoint, so a client cannot learn the result of a task from the task id. Options: add `get_task_status` backed by a new usecase over the tasks module (`apps/papra-server/src/modules/tasks/`), or leave it out and tell the model to call `get_document` afterwards and look at the tags. Recommendation: leave the status tool for a later slice and describe the follow-up call in the tool description.

## 4. Input schema derivation

Tool `inputSchema` is generated from valibot, not written by hand, with `@valibot/to-json-schema`. It is already a server dependency (`apps/papra-server/package.json`) and `toStandardJsonSchema` is already used in `apps/papra-server/src/modules/ai/ai.services.ts`.

### Where the schemas live

`apps/papra-server/src/modules/api/api.contracts.registry.ts` (exported as `@papra/app-server/api/contract`) holds the admin, health, config, users, organizations, tags and `enrichDocumentContract` contracts only. Documents and custom properties are still legacy Hono routes (`documents.routes.ts`, `custom-properties.routes.ts`) with inline valibot schemas and `*.schemas.ts` files. `apps/papra-server/src/modules/api/README.md` describes the incremental migration, one as-is PR per route group.

### Strategy

Recommended: migrate the documents and custom-properties routes to contracts first, each as its own as-is PR, then derive MCP schemas from the registry. Reasons: one source of truth, the SDK generation benefits as well, and the registry then covers every tool. In the meantime slice 2 can derive from the existing `*.schemas.ts` exports where they exist (for example `updateDocumentBodySchema`, `searchDocumentsQuerySchema`) and from the property definitions' `inputSchema`, so the migration is not a blocker for the read tools. Inline route schemas (such as the strict query object in `documents.routes.ts`) are extracted into named exports as part of the migration PRs.

### Building one input object from a contract

A contract has `params`, `query` and a JSON `body` (see `apps/papra-server/src/modules/api/api.contracts.ts`). A tool takes one flat object:

- Merge `params`, `query` and the `application/json` body properties into one object schema.
- Key collisions: fail the build of the tool table at startup and in a unit test; rename in the contract if one appears. None is expected, since params are ids and bodies are fields.
- Bodies that are not JSON (multipart upload, file download) have no automatic mapping. `upload_document` and `download_document_file` are hand-written tools with explicit schemas.
- Path parameters are ids matching `[a-zA-Z0-9_-]` (rule in `apps/papra-server/src/modules/api/README.md`), so no encoding concerns.

### Transforms

JSON Schema cannot express every valibot construct. Examples in this codebase: `v.toDate()` in the date property `inputSchema` and in `updateDocumentBodySchema`, and coerced query schemas. The converter either throws or emits a looser type for these, depending on its `errorMode` setting. Rules:

- The JSON Schema is advisory. At call time the arguments are parsed with the original valibot schema, so transforms, coercion and `extendInputValidation` hooks still run. The JSON Schema is never the validator.
- For schemas the converter cannot handle, the tool declares an override: a small hand-written JSON Schema fragment next to the tool, with a unit test that checks it accepts the values the valibot schema accepts. For `date` the override is `{ "type": "string", "format": "date-time" }`.

### Custom property values: one tool or eight

The value schema depends on the definition's type, which is data, not part of the tool's static shape. Two designs:

1. One `set_document_custom_property` tool whose `value` is a union of the eight shapes. Fewer tools in the list, but the model has to look up the definition's type first, and a union gives weak guidance.
2. One tool per type (`set_document_text_property`, and so on). Precise schemas, but eight write tools plus eight clear tools bloat the list and clients show every tool to the model.

Recommendation: design 1, with the tool description telling the model to call `get_custom_property` first and with the value validated server-side against the definition's own `inputSchema` through the registry in `apps/papra-server/src/modules/custom-properties/definitions/custom-property-definition.registry.ts`. Errors name the expected type so the model can retry.

## 5. User-visible parts for later slices

None of these are part of this PR.

- Consent page in `apps/papra-client`: client name, requested scopes in plain language, approve and deny, and an organization choice only if tokens become organization-bound. The authorization endpoint redirects signed-out users to the existing sign-in page and back.
- Connected-apps list with revoke, next to the existing API keys settings (`apps/papra-client/src/modules/api-keys/pages/`), with the matching i18n keys.
- Docs guide under `apps/docs/src/content/docs/03-guides/` (the next free number is `14-`), an entry in the config reference for `MCP_SERVER_ENABLED`, and a changeset in `.changeset/`.
- The architecture pages in `apps/docs/src/content/docs/05-architecture/` describe shipped behaviour only, so this plan lives in `docs/plans/` instead.

## 6. Ordered follow-up PRs

Each entry is one PR. Branch names follow `<type>/<kebab-topic>`. Dependencies are listed after the risk.

| #   | Branch                                     | Scope                                                                                                                             | Risk   | Surfaces     | Depends on           |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------ | -------------------- |
| 0a  | `refactor/documents-api-contracts`         | Move documents routes to contracts, as-is, per the README rule. May split by route.                                               | medium | none         | none                 |
| 0b  | `refactor/custom-properties-api-contracts` | Move custom-properties routes to contracts, as-is.                                                                                | medium | none         | none                 |
| 1   | `feat/mcp-server-skeleton`                 | `mcp` module, config flag, `/mcp` route, stateless transport, API-key auth, `ping` and `list_organizations`, SPA-fallback test.   | medium | security     | dependency approval  |
| 2   | `feat/mcp-read-tools`                      | Read tools: documents, tags, custom properties, document values. Schema derivation helper.                                        | low    | none         | 1 (0a, 0b preferred) |
| 3   | `feat/mcp-write-tools`                     | Write tools: update, upload, tags, custom property definitions and values, enrichment. Size limits and `isError` mapping.         | medium | security     | 2                    |
| 4   | `feat/mcp-oauth-server`                    | OAuth tables, migration, authorization-server and protected-resource metadata, registration, token endpoints, third auth context. | high   | security, db | 1                    |
| 5   | `feat/mcp-consent-ui`                      | Consent page, connected-apps list with revoke, i18n.                                                                              | medium | ui           | 4                    |
| 6   | `docs/mcp-server-guide`                    | Guide, config reference, changeset.                                                                                               | low    | none         | 3, 5                 |

This keeps the intake's six slices (skeleton with API keys, read tools, write tools, OAuth server, consent UI, docs guide) and adds the contract migrations from section 4 as prerequisites.

Ordering of OAuth against the write tools: if a target client accepts only the authorization flow for remote servers (open question 1), slice 4 and 5 move ahead of slice 3, because write tools behind a static key that no target client can use have no users, and a write-capable token should be audience-bound and revocable from the start. If the target clients accept a static bearer header, keep the order above; slices 1 to 3 then deliver a usable server, and OAuth is an upgrade.

Migrations: the base branch has migrations up to `apps/papra-server/src/migrations/list/0028-pending-organization-invitations-unique.migration.ts`, and `0029` is being taken by in-progress document-preview work. Slice 4 takes the next free number at the time it lands and rebases the registry entry in `apps/papra-server/src/migrations/migrations.registry.ts`.

## 7. Open questions for the maintainer

1. Which clients must work on day one? This decides whether slices 1 to 3 are useful before OAuth (static bearer header) or whether OAuth must come first.
2. Organization-bound tokens or organization as a tool argument? The plan assumes the argument. Binding a token to one organization is safer for delegated access but needs an organization choice on the consent page and complicates users with several organizations.
3. Plan gating: should the MCP server be tied to a plan entitlement (`apps/papra-server/src/modules/plan-entitlements/`) or be available on every plan?
4. Dependencies: add `@better-auth/oauth-provider`, `@modelcontextprotocol/sdk`, both, or neither (hand-rolled)?
5. Does the maintainer want this in core? `CONTRIBUTING.md` asks for an issue before feature PRs, so an issue should exist and be agreed before slice 1.
6. Rate limiting: should `/mcp` use the existing limiter in `apps/papra-server/src/modules/app/rate-limit/`, with its own limits per user or per client?
7. Audit or activity logging of tool calls: record them in document activity (`apps/papra-server/src/modules/documents/document-activity/`), in the logs only, or not at all? Should changes made through MCP be marked with the client name?
8. File size over MCP: the encoded-payload cap for `upload_document`, and whether file download is ever offered.
9. Which scopes does the first OAuth release offer? Excluding `*:delete` and `organizations:*` limits what a mistaken tool call can do.
10. Should REST (`/api/*`) ever accept OAuth tokens, or stay API-key and session only?

## Verify before slice 1

These are protocol details taken from the assumed revision (2025-06-18 or later) and not checked here. The slice-1 author checks each against the published specification and the chosen SDK, and updates this plan.

- Transport name and behaviour: single endpoint, `POST` required, `GET` optional, response as JSON body or event stream, status code for an unsupported `GET`.
- Required request headers (protocol version header, `Accept` values) and whether a session id header can be omitted entirely in stateless mode.
- Protected-resource metadata path and its fields; the `WWW-Authenticate` parameter that points to it on a `401`.
- Authorization-server metadata path, and which registration and PKCE methods clients are required to use.
- Whether a `resource` parameter (RFC 8707) is required on authorization and token requests, and how the audience is validated.
- Scope discovery: where the server advertises the scopes it supports and how a client requests a subset.
- Tool annotations: field names and defaults for `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
- Structured tool output: whether to return `structuredContent` next to text content, and how `outputSchema` is declared.
- Error shape for tool failures (`isError` result) against protocol errors.
