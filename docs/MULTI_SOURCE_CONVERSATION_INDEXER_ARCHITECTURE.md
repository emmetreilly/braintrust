# Multi-Source Conversation Indexer Architecture for Brain Trust

## Research Document - January 2026

This document provides comprehensive research on building a multi-source conversation indexer that can ingest, normalize, and index conversations from various collaboration platforms. The goal is to enable Brain Trust to aggregate organizational knowledge from multiple conversation sources beyond the existing in-app messaging.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Platform-by-Platform API Analysis](#platform-by-platform-api-analysis)
   - [Slack](#1-slack)
   - [Microsoft Teams](#2-microsoft-teams)
   - [Discord](#3-discord)
   - [Google Chat/Spaces](#4-google-chatspaces)
   - [Notion](#5-notion)
   - [Linear](#6-linear)
   - [GitHub](#7-github)
   - [Confluence](#8-confluence)
   - [Email (Gmail & Outlook)](#9-email-gmail--outlook)
   - [WhatsApp Business](#10-whatsapp-business)
   - [Intercom/Zendesk](#11-intercomzendesk)
3. [Comparative Analysis](#comparative-analysis)
4. [Universal Connector Architecture](#universal-connector-architecture)
5. [Normalized Message Schema](#normalized-message-schema)
6. [Implementation Recommendations](#implementation-recommendations)
7. [Sources](#sources)

---

## Executive Summary

Building a multi-source conversation indexer requires understanding the unique characteristics of each platform's API, authentication mechanisms, rate limits, and data access patterns. This research reveals several key insights:

**Key Findings:**

1. **Authentication Complexity Varies Significantly**: OAuth 2.0 is standard, but implementations differ. Some platforms (Slack, Discord) offer simpler flows, while others (Microsoft, Google) require more complex enterprise consent flows.

2. **Real-Time vs Polling Trade-offs**: Most platforms now offer webhooks/change notifications, but with varying reliability and setup complexity. Socket-based real-time options (Slack Socket Mode, Discord Gateway) are available but harder to scale.

3. **Rate Limits Are Restrictive**: All platforms enforce strict rate limits. Historical imports require careful pacing. LinkedIn has 5,000 requests/hour; Microsoft Teams has 10,000 requests/10 minutes; Notion averages 3 requests/second.

4. **Enterprise Features Gatekept**: Many critical features (message export, compliance APIs, admin-level access) require Enterprise/paid tiers.

5. **Data Normalization Is Complex**: Message formats, threading models, reaction systems, and file attachment handling vary dramatically between platforms.

---

## Platform-by-Platform API Analysis

### 1. Slack

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | Events API (HTTP webhooks) |
| Alternative | Socket Mode (WebSocket-based) |
| Legacy | RTM API (deprecated for new apps) |
| SDK Support | Bolt SDK (Node.js, Python, Java) |

**OAuth/Auth Flow Complexity: Medium**

- Standard OAuth 2.0 flow with workspace-level permissions
- Supports both user tokens and bot tokens
- Granular OAuth scopes tied to specific event subscriptions
- V2 OAuth flow for modern apps (V1 deprecated)

**Rate Limits:**

| Tier | Requests |
|------|----------|
| Tier 1 | 1 request/minute |
| Tier 2 | 20 requests/minute |
| Tier 3 | 50 requests/minute |
| Tier 4 | 100+ requests/minute |
| Events API | 30,000 events/workspace/app/hour |
| RTM (legacy) | 1 message/second sustained |

**2025-2026 Rate Limit Changes:** Starting May 29, 2025, non-Marketplace apps face stricter limits on `conversations.history` and `conversations.replies`. By March 2026, existing apps will also be affected.

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Messages | Yes | Channel and DM messages with proper scopes |
| Files | Yes | Shared files with metadata |
| Reactions | Yes | Emoji reactions on messages |
| Threads | Yes | Thread replies accessible separately |
| User Profiles | Yes | Basic profile information |
| Channel History | Yes | With `channels:history` scope |

**Real-Time vs Polling:**

- **Events API (Recommended)**: HTTP webhooks, stateless, highly reliable
- **Socket Mode**: WebSocket-based, up to 10 concurrent connections, no public endpoint required
- **RTM (Deprecated)**: Legacy WebSocket, only for classic apps

**Enterprise vs Free Tier:**

| Feature | Free/Pro | Enterprise Grid |
|---------|----------|-----------------|
| Events API | Yes | Yes |
| Discovery API | No | Yes |
| Org-wide deployment | No | Yes |
| Data Export | Limited | Full compliance export |
| eDiscovery | No | Yes |

---

### 2. Microsoft Teams

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | Microsoft Graph API |
| Endpoint | `https://graph.microsoft.com/v1.0` |
| SDK Support | Microsoft Graph SDKs (all major languages) |

**OAuth/Auth Flow Complexity: High**

- Azure AD OAuth 2.0 with complex consent flows
- Requires Azure app registration
- Admin consent often required for organizational data
- Supports both delegated (user) and application permissions
- Token acquisition handled separately by Azure AD (not counted against Graph limits)

**Rate Limits:**

| Resource | Limit |
|----------|-------|
| Outlook/Mail | 10,000 requests/10 minutes per app/mailbox |
| Teams Messages | Polling limited to once/day (use webhooks instead) |
| Subscriptions | 500 operations/20 seconds/app/tenant |
| Concurrent Requests | 4 per app/tenant |

**September 2025 Change:** Per-app/per-user limits reduced to 50% of total per-tenant limit.

**August 2025 Pricing Change:** Microsoft ceased charging for Teams export APIs, transcripts, and meeting recordings.

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Channel Messages | Yes | Via Graph API with proper permissions |
| Chat Messages | Yes | 1:1 and group chats |
| Files | Yes | SharePoint integration |
| Reactions | Yes | On messages |
| Threads/Replies | Yes | Hierarchical message structure |
| Meeting Transcripts | Yes | With Teams Premium |

**Real-Time vs Polling:**

- **Change Notifications (Webhooks)**: Recommended approach for real-time updates
- **Resources**: `/teams/{id}/channels/{id}/messages`, `/chats/{id}/messages`
- **Tenant-wide**: `/teams/getAllMessages`, `/chats/getAllMessages`
- **Subscription Expiry**: 3 days (must renew)
- **Delivery Methods**: Webhooks, Azure Event Hubs, Azure Event Grid

**Enterprise vs Free Tier:**

| Feature | Microsoft 365 Basic | Enterprise E3/E5 |
|---------|---------------------|------------------|
| Graph API Access | Yes | Yes |
| Compliance APIs | Limited | Full |
| eDiscovery | No | Yes (E5) |
| Admin Audit Logs | Basic | Advanced |
| Data Loss Prevention | No | Yes |

---

### 3. Discord

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | REST API + Gateway (WebSocket) |
| Bot Framework | Discord.js, discord.py, JDA |
| Interactions | Slash commands, message components |

**OAuth/Auth Flow Complexity: Medium**

- Standard OAuth 2.0 for user authorization
- Bot tokens for server access (no OAuth needed once invited)
- Application-level credentials for API access

**Rate Limits:**

| Resource | Limit |
|----------|-------|
| Global | Varies by endpoint |
| Gateway | 120 events/60 seconds (send) |
| Webhooks | 5 requests/2 seconds/webhook |
| Message Send | ~5 messages/5 seconds/channel |

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Messages | Yes* | Requires MESSAGE_CONTENT intent |
| Files | Yes | Attachments in messages |
| Reactions | Yes | Emoji reactions |
| Threads | Yes | Forum posts and threads |
| Server Members | Yes* | Requires GUILD_MEMBERS intent |

**Privileged Intents (Critical):**

- `MESSAGE_CONTENT`: Required to read message content (since Sept 2022)
- `GUILD_MEMBERS`: Access to member lists
- `GUILD_PRESENCES`: Presence/status data

For bots in 100+ servers, these require Discord approval.

**Real-Time vs Polling:**

- **Gateway (WebSocket)**: Primary real-time mechanism
- **Events**: `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`
- **No HTTP Webhooks**: Discord uses outgoing webhooks only (for sending messages)

**Enterprise vs Free Tier:**

Discord doesn't have traditional enterprise tiers for API access. However:
- Bots in 100+ servers require verification
- Privileged intents require application approval
- Large bots may receive custom rate limit considerations

---

### 4. Google Chat/Spaces

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | Google Chat API (REST) |
| SDK Support | Google API Client Libraries |
| Workspace Events | Google Workspace Events API v1 |

**OAuth/Auth Flow Complexity: High**

- Google OAuth 2.0 with Workspace domain verification
- Requires Google Cloud project setup
- Domain-wide delegation for admin access
- Scopes: `chat.spaces`, `chat.messages`, `chat.memberships`

**January 2026 Change:** Granular OAuth consent for Apps Script Chat apps begins.

**Rate Limits:**

| Quota Type | Scope |
|------------|-------|
| Per-project | Single Chat app calling methods |
| Per-space | Shared among all apps in a space |
| Per-user | Rate for user-authenticated calls |
| Space Creation | 35/minute, 800/hour (GROUP_CHAT/SPACE) |

No daily limit if staying within per-minute quotas.

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Messages | Yes | Up to 32KB per message |
| Files/Attachments | Yes | Via Drive integration |
| Reactions | Yes | Emoji reactions |
| Threads | Yes | Threaded conversations |
| Space Memberships | Yes | Member management |

**Real-Time vs Polling:**

- **Google Workspace Events API**: Webhook-based notifications
- **Chat app events**: Direct event delivery to Chat apps
- **Deprecation Notice**: v1beta endpoint for Chat/Meet events deprecated April 30, 2025

**Enterprise vs Free Tier:**

| Feature | Google Workspace | Enterprise Plus |
|---------|-----------------|-----------------|
| Chat API | Yes | Yes |
| Data Export | Limited | Full (Vault) |
| DLP | No | Yes |
| Audit Logs | Basic | Advanced |

---

### 5. Notion

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | REST API |
| SDK Support | notion-sdk-js, notion-sdk-py |
| File Uploads | Available since May 2025 |

**OAuth/Auth Flow Complexity: Low-Medium**

- Standard OAuth 2.0 with integration-level access
- Public integrations require Notion approval
- Internal integrations for single workspace use

**Rate Limits:**

| Limit | Value |
|-------|-------|
| Average Rate | 3 requests/second |
| Burst Allowance | Up to 1,000 calls in seconds (within 15-min window) |
| 15-Minute Quota | 2,700 calls/token |
| Payload Size | 1,000 block elements, 500KB max |

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Page Content | Yes | Blocks and properties |
| Comments | Yes | Page and block comments |
| Databases | Yes | Query and update |
| Users | Yes | Workspace members |
| Files | Yes | As of May 2025 |

**Real-Time vs Polling:**

- **No native webhooks**: Must poll for changes
- **Search API**: Can query for recently modified pages
- **Workaround**: Use database "Last edited" property for change detection

**Enterprise vs Free Tier:**

| Feature | Free/Plus | Enterprise |
|---------|-----------|------------|
| API Access | Yes | Yes |
| Rate Limits | Standard | Potentially higher (contact Notion) |
| Audit Logs | No | Yes |
| SAML SSO | No | Yes |

---

### 6. Linear

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | GraphQL API |
| SDK Support | @linear/sdk (TypeScript) |
| Webhooks | Data change webhooks |

**OAuth/Auth Flow Complexity: Low-Medium**

- OAuth 2.0 with personal API keys alternative
- **October 2025 Change**: New OAuth apps issue refresh tokens by default
- **April 2026**: Existing apps must migrate to refresh token system

**Rate Limits:**

| Type | Limit |
|------|-------|
| Authenticated Requests | 5,000/hour/user |
| Unauthenticated | 60/hour |
| Complexity Points (Auth) | 250,000/hour |
| Complexity Points (Unauth) | 10,000/hour |
| Single Query Max | 10,000 points |

Workspace-level OAuth apps get dynamic rate limit increases based on paid users.

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Issues | Yes | Full CRUD |
| Comments | Yes | Issue comments with reactions |
| Projects | Yes | Project metadata and updates |
| Cycles | Yes | Sprint/cycle data |
| Users | Yes | Team members |
| Attachments | Yes | Issue attachments |

**Real-Time vs Polling:**

- **Webhooks (Recommended)**: Data change events for issues, comments, projects, etc.
- **Polling Discouraged**: Linear specifically advises against polling
- **Webhook Events**: Issues, comments, reactions, projects, cycles, SLA updates

**Enterprise vs Free Tier:**

Linear provides consistent API access across tiers. Enterprise features focus on admin controls, SAML SSO, and audit logs rather than API restrictions.

---

### 7. GitHub

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary APIs | REST API v3, GraphQL API v4 |
| SDK Support | Octokit (JavaScript, Ruby, .NET) |
| Apps | GitHub Apps (recommended), OAuth Apps |

**OAuth/Auth Flow Complexity: Medium**

- OAuth 2.0 for user authorization
- GitHub Apps use JWT + installation tokens
- Fine-grained personal access tokens available

**Rate Limits:**

| Authentication | Limit |
|----------------|-------|
| Authenticated (User/OAuth) | 5,000/hour |
| GitHub App | 5,000/hour (15,000 for GHEC org-owned) |
| Unauthenticated | 60/hour |
| GITHUB_TOKEN (Actions) | 1,000/hour/repo (15,000 for GHEC) |
| GraphQL | 5,000 points/hour |

**May 2025 Change:** Updated rate limits for unauthenticated requests affecting cloning operations.

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Issues | Yes | Full CRUD with comments |
| Pull Requests | Yes | Reviews, comments, status |
| Discussions | Yes | Q&A and announcements |
| Comments | Yes | On issues, PRs, commits |
| Reactions | Yes | Emoji reactions |
| Files | Yes | Repository content |

**Real-Time vs Polling:**

- **Webhooks**: Repository, organization, and enterprise-level
- **Events**: Push, PR, issues, comments, discussions, etc.
- **Conditional Requests**: ETag headers for efficient polling
- **GraphQL**: Reduces multiple REST calls into single request

**Enterprise vs Free Tier:**

| Feature | Free/Pro | Enterprise Cloud |
|---------|----------|-----------------|
| API Rate Limits | 5,000/hour | 15,000/hour |
| Audit Logs API | No | Yes |
| SAML SSO | No | Yes |
| Advanced Security | No | Yes |

---

### 8. Confluence

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | REST API v2, GraphQL (Cloud) |
| Legacy | REST API v1 |
| SDK Support | Atlassian SDK, Forge |

**OAuth/Auth Flow Complexity: Medium-High**

- OAuth 2.0 (3LO) for Atlassian Cloud
- Basic auth or personal access tokens for Data Center
- Atlassian Connect for app development

**Rate Limits:**

**February 2026 Change:** New points-based rate limits and tiered quotas for Jira and Confluence Cloud apps (Forge, Connect, OAuth 2.0).

| Type | Description |
|------|-------------|
| Points-based | API calls consume points based on complexity |
| Burst Limits | Short window (seconds) to prevent spikes |
| Quota Limits | Hourly evaluation |
| High-impact Endpoints | Extra burst protection (Permissions, Search, Admin) |

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Pages | Yes | Content with formatting |
| Comments | Yes | Inline and page comments |
| Spaces | Yes | Space metadata and content |
| Attachments | Yes | File attachments |
| Labels | Yes | Page and space labels |
| Users | Yes | With appropriate permissions |

**Real-Time vs Polling:**

- **Webhooks**: Available for page and comment events
- **Atlassian Connect**: Event subscriptions for apps
- **Rate Limit Note**: Only external REST API requests are limited; internal Confluence actions are not

**Enterprise vs Free Tier:**

| Feature | Free/Standard | Premium/Enterprise |
|---------|---------------|-------------------|
| API Access | Yes | Yes |
| Rate Limits | Standard | Higher (Data Center configurable) |
| Audit Logs | No | Yes |
| Analytics | Basic | Advanced |

---

### 9. Email (Gmail & Outlook)

#### Gmail API

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | Gmail REST API |
| SDK Support | Google API Client Libraries |
| Batch Requests | Up to 100 calls/batch |

**OAuth/Auth Flow Complexity: High**

- Google OAuth 2.0 with sensitive scope review
- Domain-wide delegation for Workspace admins
- Restricted scopes require security assessment

**Rate Limits:**

| Limit Type | Value |
|------------|-------|
| Quota Units | Per-project and per-user |
| Batch Limit | 100 requests/batch |
| Concurrent Requests | Limited (triggers 429 on parallel requests) |

Per-user limits cannot be increased.

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Messages | Yes | Full message content |
| Threads | Yes | Conversation grouping |
| Labels | Yes | Folder/category management |
| Attachments | Yes | File content |
| Headers | Yes | Metadata |

**Real-Time vs Polling:**

- **Push Notifications**: Via Cloud Pub/Sub
- **History API**: Incremental sync for changes since last sync
- **Watch**: Set up push notifications for mailbox changes

#### Microsoft Outlook (Graph API)

**Rate Limits:**

| Limit | Value |
|-------|-------|
| Requests | 10,000/10 minutes/app/mailbox |
| Concurrent | 4 requests/app/tenant |
| Send Limit | 30 messages/minute (Exchange Online limit) |
| Daily Send | 10,000 messages/24 hours |
| Attachment Upload | 150MB/5 minutes |

**Real-Time vs Polling:**

- **Change Notifications**: Webhooks for mail folder changes
- **Subscription**: Similar to Teams, requires renewal

---

### 10. WhatsApp Business

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | WhatsApp Cloud API (Meta) |
| Alternative | On-Premise API (deprecated focus) |
| Business Solution Providers | Third-party access available |

**OAuth/Auth Flow Complexity: Medium-High**

- Meta Business verification required
- Access tokens with `whatsapp_business_messaging` permission
- User tokens expire in 24 hours (refresh needed)

**Rate Limits:**

**October 2025 Change:** Messaging limits now applied at business portfolio level.

| Tier | Conversations/24 hours |
|------|----------------------|
| New/Unverified | 250 |
| Verified (Tier 1) | 2,000 |
| Verified (Tier 2) | 10,000 |
| Verified (Tier 3) | 100,000 |
| Unlimited | Case-by-case |

**Throughput:**
- Default: 80 messages/second
- Eligible users: Up to 1,000 messages/second

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Messages | Yes | Text, media, templates |
| Media | Yes | Images, documents, audio, video |
| Contacts | Limited | Opted-in users only |
| Read Receipts | Yes | Delivery/read status |

**Real-Time vs Polling:**

- **Webhooks**: Real-time message delivery notifications
- **Delivery Rate**: Up to 5 messages/second to webhook
- **Retry**: Up to 50 retries with incremental backoff
- **Response Timeout**: 10 seconds required

**Enterprise vs Free Tier:**

| Feature | Standard | Meta Verified Business |
|---------|----------|----------------------|
| API Access | Yes | Yes |
| Message Limits | Tiered | Higher/Unlimited |
| Template Approval | Required | Faster review |
| Support | Standard | Priority |

**July 2025 Pricing Change:** Per-delivered-message charging for template categories with country-based rate cards.

---

### 11. Intercom/Zendesk

#### Intercom

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | REST API |
| SDK Support | intercom-ruby, intercom-node |
| Pagination | Cursor-based |

**OAuth/Auth Flow Complexity: Low-Medium**

- OAuth 2.0 for third-party apps
- Access tokens for private integrations
- omniauth-intercom middleware available

**Rate Limits:**

| App Type | Limit |
|----------|-------|
| Private Apps | 10,000/minute/app, 25,000/minute/workspace |
| Public Apps | 10,000/minute/app (separate from other apps) |
| Window | 10-second rolling windows (1/6 of minute limit) |

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Conversations | Yes | Full thread history |
| Messages | Yes | Customer and admin messages |
| Users/Contacts | Yes | Customer data |
| Companies | Yes | Organization data |
| Tags | Yes | Conversation/contact tags |

**Real-Time vs Polling:**

- **Webhooks**: Available for conversation and message events
- **Rate Limits**: Only REST API calls counted, not webhook deliveries

#### Zendesk

**API Availability and Requirements:**

| Aspect | Details |
|--------|---------|
| Primary API | Ticketing REST API, Chat Conversations API (GraphQL) |
| SDK Support | zendesk_api (Ruby), zenpy (Python) |

**April 2025 Note:** No new integrations allowed on Chat Conversations APIs.

**OAuth/Auth Flow Complexity: Medium**

- OAuth 2.0 for client-side access
- API tokens for server-side
- Rate limits apply to account, not individual tokens

**Rate Limits (by plan):**

| Plan | Limit |
|------|-------|
| Team | 200 requests/minute |
| Professional | 400 requests/minute |
| Enterprise | 700 requests/minute |
| High Volume Add-on | 2,500 requests/minute |

**Data Access:**

| Data Type | Accessible | Notes |
|-----------|------------|-------|
| Tickets | Yes | Full ticket data |
| Comments | Yes | Ticket comments/replies |
| Users | Yes | End-users and agents |
| Organizations | Yes | Customer organizations |
| Attachments | Yes | Ticket attachments |

**Real-Time vs Polling:**

- **Webhooks**: Trigger-based notifications
- **Streaming API**: For real-time ticket updates
- **Job Limits**: 30 concurrent queued/running jobs

---

## Comparative Analysis

### Authentication Complexity Ranking

| Platform | Complexity | Notes |
|----------|------------|-------|
| Linear | Low | Simple OAuth or API keys |
| Discord | Low-Medium | Bot tokens straightforward |
| Notion | Low-Medium | Integration-based OAuth |
| Slack | Medium | Well-documented, granular scopes |
| Intercom | Medium | Standard OAuth |
| GitHub | Medium | Multiple auth options |
| Zendesk | Medium | Account-level tokens |
| Confluence | Medium-High | Atlassian ecosystem complexity |
| Google Chat | High | Workspace verification needed |
| Gmail | High | Sensitive scope review |
| Microsoft Teams | High | Azure AD, admin consent |
| WhatsApp | High | Meta business verification |

### Real-Time Capability Comparison

| Platform | Mechanism | Reliability | Setup Complexity |
|----------|-----------|-------------|------------------|
| Slack | Events API/Socket Mode | High | Low |
| Microsoft Teams | Change Notifications | High | Medium |
| Discord | Gateway (WebSocket) | Medium | Medium |
| Google Chat | Workspace Events | Medium | High |
| GitHub | Webhooks | High | Low |
| Linear | Webhooks | High | Low |
| Confluence | Webhooks | Medium | Medium |
| WhatsApp | Webhooks | High | Medium |
| Intercom | Webhooks | High | Low |
| Zendesk | Webhooks/Streaming | High | Medium |
| Notion | None (polling only) | N/A | N/A |
| Gmail | Pub/Sub Push | High | High |
| Outlook | Change Notifications | High | Medium |

### Rate Limit Severity

| Platform | Requests | Window | Severity |
|----------|----------|--------|----------|
| Notion | ~180/min | Rolling | High |
| Zendesk (Team) | 200/min | Minute | High |
| Discord | Varies | Per-route | Medium |
| Confluence | Points-based | Hourly | Medium |
| Linear | ~83/min | Hourly | Medium |
| Slack | Tier-based | Varies | Medium |
| GitHub | ~83/min | Hourly | Medium |
| Microsoft Teams | 1000/min | 10 minutes | Low |
| Intercom | 10,000/min | Minute | Low |
| Gmail | Quota-based | Daily | Medium |

---

## Universal Connector Architecture

### Design Pattern: Adapter-Based Data Ingestion

Based on research into integration patterns, the recommended architecture uses the **Adapter Pattern** combined with an **Event-Driven Pipeline**.

```
+------------------+     +------------------+     +------------------+
|   Source APIs    |     |    Adapters      |     |   Normalized     |
|------------------|     |------------------|     |   Message Queue  |
| Slack API        |---->| SlackAdapter     |---->|                  |
| Teams Graph      |---->| TeamsAdapter     |---->|   Kafka/Redis    |
| Discord Gateway  |---->| DiscordAdapter   |---->|   Streams        |
| GitHub API       |---->| GitHubAdapter    |---->|                  |
| ...              |---->| ...              |---->|                  |
+------------------+     +------------------+     +------------------+
                                                          |
                                                          v
                         +------------------+     +------------------+
                         |   Index/Store    |<----|   Processing     |
                         |------------------|     |   Pipeline       |
                         | Brain Trust      |     |------------------|
                         | Vector Store     |     | - Embedding Gen  |
                         | D1 Database      |     | - Entity Extract |
                         +------------------+     | - Deduplication  |
                                                  +------------------+
```

### Core Components

#### 1. Source Connector Interface

```typescript
interface SourceConnector {
  // Authentication
  authenticate(credentials: AuthCredentials): Promise<AuthToken>;
  refreshToken(token: AuthToken): Promise<AuthToken>;

  // Real-time ingestion
  subscribeToEvents(config: SubscriptionConfig): EventStream;
  handleWebhook(payload: WebhookPayload): NormalizedMessage[];

  // Batch/historical import
  fetchHistoricalMessages(params: HistoricalFetchParams): AsyncIterator<NormalizedMessage>;

  // Health and rate limiting
  getRateLimitStatus(): RateLimitStatus;
  healthCheck(): Promise<HealthStatus>;
}
```

#### 2. Authentication Manager

Each platform requires different auth handling:

```typescript
interface AuthenticationManager {
  // OAuth flow initiation
  initiateOAuth(platform: Platform, workspaceId: string): OAuthState;

  // Token exchange
  exchangeCode(platform: Platform, code: string, state: OAuthState): Promise<TokenSet>;

  // Token refresh
  refreshTokens(platform: Platform, refreshToken: string): Promise<TokenSet>;

  // Secure storage
  storeCredentials(workspaceId: string, platform: Platform, tokens: TokenSet): Promise<void>;
  getCredentials(workspaceId: string, platform: Platform): Promise<TokenSet | null>;

  // Token validation
  validateToken(platform: Platform, token: string): Promise<boolean>;
}
```

**Platform-Specific Considerations:**

| Platform | Token Refresh | Storage Notes |
|----------|--------------|---------------|
| Slack | Not needed for bot tokens | Store workspace token separately |
| Teams | Azure AD handles refresh | Store per-tenant |
| Discord | Bot tokens don't expire | Store encrypted |
| Google | Automatic with SDK | Use service account for admin |
| Linear | Refresh tokens (2025+) | Migrate existing apps |
| GitHub | PATs don't expire | App tokens need refresh |

#### 3. Rate Limit Handler

```typescript
interface RateLimitHandler {
  // Check before request
  canMakeRequest(platform: Platform, endpoint: string): boolean;

  // Record request
  recordRequest(platform: Platform, endpoint: string, response: Response): void;

  // Get wait time
  getWaitTime(platform: Platform, endpoint: string): number;

  // Exponential backoff with jitter
  calculateBackoff(attemptNumber: number): number;

  // Queue management for batch operations
  enqueueRequest(request: APIRequest): Promise<Response>;
}
```

**Implementation Strategy:**

1. **Token Bucket Algorithm** for most platforms
2. **Sliding Window** for Intercom's 10-second windows
3. **Points Tracking** for Confluence/Linear complexity-based limits
4. **Adaptive Throttling** based on 429 response headers

#### 4. Message Normalizer

Each adapter transforms platform-specific messages to a common schema:

```typescript
interface MessageNormalizer {
  normalize(platformMessage: PlatformMessage): NormalizedMessage;

  // Handle platform-specific features
  normalizeThread(thread: PlatformThread): NormalizedThread;
  normalizeReaction(reaction: PlatformReaction): NormalizedReaction;
  normalizeAttachment(attachment: PlatformAttachment): NormalizedAttachment;
  normalizeUser(user: PlatformUser): NormalizedUser;
}
```

### Multi-Tenant Architecture

For SaaS deployment supporting multiple workspaces:

```typescript
interface TenantIsolation {
  // Tenant context
  getTenantContext(request: Request): TenantContext;

  // Credential isolation
  getCredentialsForTenant(tenantId: string, platform: Platform): Promise<TokenSet>;

  // Data partitioning
  getDataPartition(tenantId: string): DataPartition;

  // Rate limit isolation
  getTenantRateLimits(tenantId: string, platform: Platform): RateLimitConfig;
}
```

**Isolation Strategies:**

| Strategy | Pros | Cons | Best For |
|----------|------|------|----------|
| Silo (separate DBs) | Max isolation | High cost | Enterprise/compliance |
| Pool (shared schema) | Cost effective | Complexity | Most SaaS |
| Bridge (hybrid) | Balanced | Implementation effort | Growing products |

### Historical Import Pipeline

For batch importing existing conversations:

```typescript
interface HistoricalImportPipeline {
  // Job management
  createImportJob(config: ImportJobConfig): Promise<ImportJob>;
  getJobStatus(jobId: string): Promise<ImportJobStatus>;
  cancelJob(jobId: string): Promise<void>;

  // Progress tracking
  onProgress(callback: (progress: ImportProgress) => void): void;

  // Resumable imports
  resumeJob(jobId: string): Promise<void>;

  // Conflict resolution
  handleDuplicate(existing: NormalizedMessage, incoming: NormalizedMessage): NormalizedMessage;
}
```

**Batch Import Considerations:**

1. **Rate Limit Pacing**: Spread requests over time
2. **Checkpoint/Resume**: Save progress for large imports
3. **Deduplication**: Hash-based detection of existing messages
4. **Incremental Sync**: Track last sync timestamp per source

---

## Normalized Message Schema

### Core Message Structure

```typescript
interface NormalizedMessage {
  // Identity
  id: string;                          // Brain Trust internal ID
  externalId: string;                   // Source platform message ID
  source: ConversationSource;           // Platform identifier

  // Location
  workspaceId: string;                  // Brain Trust workspace
  channelId: string;                    // Normalized channel/space/thread ID
  channelName: string;                  // Human-readable channel name
  channelType: ChannelType;             // 'channel' | 'dm' | 'group' | 'thread' | 'issue' | 'pr'

  // Content
  content: string;                      // Plain text content
  contentHtml?: string;                 // Rich text/HTML if available
  contentMarkdown?: string;             // Markdown representation

  // Threading
  threadId?: string;                    // Parent thread ID
  parentMessageId?: string;             // Direct parent message
  isThreadStart: boolean;               // Is this the thread root
  replyCount?: number;                  // Number of replies

  // Author
  author: NormalizedUser;               // Message author

  // Metadata
  timestamp: string;                    // ISO 8601 timestamp
  editedAt?: string;                    // Last edit timestamp

  // Attachments
  attachments: NormalizedAttachment[];

  // Reactions
  reactions: NormalizedReaction[];

  // Mentions
  mentions: NormalizedMention[];

  // Platform-specific data
  metadata: Record<string, unknown>;    // Preserve original data

  // Processing status
  indexed: boolean;
  embeddingId?: string;
}

type ConversationSource =
  | 'slack'
  | 'teams'
  | 'discord'
  | 'google_chat'
  | 'notion'
  | 'linear'
  | 'github'
  | 'confluence'
  | 'gmail'
  | 'outlook'
  | 'whatsapp'
  | 'intercom'
  | 'zendesk'
  | 'brain_trust';  // Internal messages

type ChannelType =
  | 'public_channel'
  | 'private_channel'
  | 'direct_message'
  | 'group_dm'
  | 'thread'
  | 'issue'
  | 'pull_request'
  | 'discussion'
  | 'comment'
  | 'ticket'
  | 'email_thread';

interface NormalizedUser {
  id: string;
  externalId: string;
  source: ConversationSource;
  name: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  isBot: boolean;
}

interface NormalizedAttachment {
  id: string;
  type: 'file' | 'image' | 'video' | 'link' | 'code' | 'embed';
  name: string;
  url?: string;
  mimeType?: string;
  size?: number;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
}

interface NormalizedReaction {
  emoji: string;
  emojiName?: string;
  count: number;
  users: string[];  // User IDs
}

interface NormalizedMention {
  type: 'user' | 'channel' | 'everyone' | 'here';
  id: string;
  name: string;
}
```

### Platform Mapping Examples

#### Slack to Normalized

```typescript
function normalizeSlackMessage(slackMsg: SlackMessage): NormalizedMessage {
  return {
    id: generateId(),
    externalId: slackMsg.ts,
    source: 'slack',
    workspaceId: slackMsg.team,
    channelId: slackMsg.channel,
    channelName: '', // Fetch separately
    channelType: mapSlackChannelType(slackMsg.channel_type),
    content: slackMsg.text,
    threadId: slackMsg.thread_ts,
    parentMessageId: slackMsg.parent_user_id ? slackMsg.thread_ts : undefined,
    isThreadStart: !slackMsg.thread_ts || slackMsg.ts === slackMsg.thread_ts,
    replyCount: slackMsg.reply_count,
    author: normalizeSlackUser(slackMsg.user),
    timestamp: slackTimestampToISO(slackMsg.ts),
    editedAt: slackMsg.edited?.ts ? slackTimestampToISO(slackMsg.edited.ts) : undefined,
    attachments: slackMsg.files?.map(normalizeSlackFile) ?? [],
    reactions: slackMsg.reactions?.map(normalizeSlackReaction) ?? [],
    mentions: extractSlackMentions(slackMsg.text),
    metadata: { original: slackMsg },
    indexed: false,
  };
}
```

#### GitHub Issue to Normalized

```typescript
function normalizeGitHubIssue(issue: GitHubIssue): NormalizedMessage {
  return {
    id: generateId(),
    externalId: `${issue.repository.full_name}#${issue.number}`,
    source: 'github',
    workspaceId: issue.repository.owner.login,
    channelId: issue.repository.full_name,
    channelName: issue.repository.name,
    channelType: 'issue',
    content: issue.body || '',
    contentMarkdown: issue.body,
    threadId: undefined,  // Issue is the thread root
    isThreadStart: true,
    replyCount: issue.comments,
    author: normalizeGitHubUser(issue.user),
    timestamp: issue.created_at,
    editedAt: issue.updated_at !== issue.created_at ? issue.updated_at : undefined,
    attachments: extractGitHubAttachments(issue.body),
    reactions: normalizeGitHubReactions(issue.reactions),
    mentions: extractGitHubMentions(issue.body),
    metadata: {
      title: issue.title,
      state: issue.state,
      labels: issue.labels,
      milestone: issue.milestone,
      original: issue,
    },
    indexed: false,
  };
}
```

---

## Implementation Recommendations

### Phase 1: Foundation (Weeks 1-4)

1. **Define and implement the normalized message schema**
   - Create TypeScript interfaces
   - Set up database schema (extend existing D1)
   - Create migration scripts

2. **Build the authentication manager**
   - OAuth flow UI components
   - Secure credential storage (encrypt at rest)
   - Token refresh background job

3. **Implement rate limit handler**
   - Redis/KV-based rate tracking
   - Exponential backoff utility
   - Queue system for batch operations

### Phase 2: High-Value Connectors (Weeks 5-10)

Start with platforms that offer:
- Good documentation
- Reliable webhooks
- Lower auth complexity

**Recommended Order:**
1. **Slack** - Most common, excellent docs, Events API
2. **GitHub** - Well-documented, webhooks, common for dev teams
3. **Linear** - GraphQL, webhooks, dev-focused
4. **Notion** - Popular for docs, requires polling
5. **Discord** - Common for communities, Gateway complexity

### Phase 3: Enterprise Connectors (Weeks 11-16)

Higher complexity, but high value for enterprise:
1. **Microsoft Teams** - Large enterprise presence
2. **Google Chat** - Workspace integration
3. **Confluence** - Enterprise documentation

### Phase 4: Customer Communication (Weeks 17-20)

Specialized use cases:
1. **Intercom/Zendesk** - Customer support history
2. **Email (Gmail/Outlook)** - Universal but complex
3. **WhatsApp Business** - Customer messaging

### Key Technical Decisions

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| Message Queue | Redis Streams or Cloudflare Queues | Already on Cloudflare, low latency |
| Auth Token Storage | Encrypted D1 columns | Leverage existing infrastructure |
| Rate Limit Tracking | Cloudflare KV | Fast, distributed |
| Historical Import | Background Durable Objects | Long-running, resumable |
| Real-time Events | Combination approach | HTTP webhooks primary, WebSocket where needed |

### Estimated Effort per Connector

| Connector | Effort | Complexity | Risk |
|-----------|--------|------------|------|
| Slack | 2 weeks | Medium | Low |
| GitHub | 2 weeks | Medium | Low |
| Linear | 1 week | Low | Low |
| Notion | 1.5 weeks | Low-Medium | Low |
| Discord | 2 weeks | Medium | Medium (intents) |
| Teams | 3 weeks | High | Medium |
| Google Chat | 2.5 weeks | High | Medium |
| Confluence | 2 weeks | Medium | Low |
| Gmail | 2.5 weeks | High | Medium |
| Outlook | 2 weeks | Medium | Low |
| WhatsApp | 2 weeks | Medium | Medium (verification) |
| Intercom | 1.5 weeks | Low | Low |
| Zendesk | 1.5 weeks | Low | Low |

**Total Estimated Effort:** 24-28 weeks for full implementation

---

## Sources

### Slack
- [Rate limits | Slack Developer Docs](https://docs.slack.dev/apis/web-api/rate-limits/)
- [The Events API | Slack Developer Docs](https://docs.slack.dev/apis/events-api/)
- [Comparing HTTP & Socket Mode | Slack Developer Docs](https://docs.slack.dev/apis/events-api/comparing-http-socket-mode/)
- [Using Socket Mode | Slack Developer Docs](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [Legacy RTM API | Slack Developer Docs](https://api.slack.com/rtm)

### Microsoft Teams
- [Microsoft Graph service-specific throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)
- [Microsoft Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)
- [Use the Microsoft Graph API to work with Microsoft Teams](https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview?view=graph-rest-1.0)
- [Receive change notifications through webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)
- [Change Notifications for Microsoft Teams Messages now Generally Available](https://devblogs.microsoft.com/microsoft365dev/change-notifications-for-microsoft-teams-messages-now-generally-available/)

### Discord
- [Rate Limits | Discord Developer Portal](https://discord.com/developers/docs/topics/rate-limits)
- [Message Content Privileged Intent FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privileged-Intent-FAQ)
- [What are Privileged Intents?](https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents)

### Google Chat
- [Usage limits | Google Chat](https://developers.google.com/workspace/chat/limits)
- [Authenticate and authorize Chat apps](https://developers.google.com/workspace/chat/authenticate-authorize)
- [Google Chat API release notes](https://developers.google.com/workspace/chat/release-notes)

### Notion
- [Request limits | Notion Developers](https://developers.notion.com/reference/request-limits)
- [How to Handle Notion API Request Limits - Thomas Frank](https://thomasjfrank.com/how-to-handle-notion-api-request-limits/)

### Linear
- [Rate limiting | Linear Developers](https://linear.app/developers/rate-limiting)
- [Getting started | Linear Developers](https://linear.app/developers/graphql)
- [API and Webhooks | Linear Docs](https://linear.app/docs/api-and-webhooks)

### GitHub
- [Rate limits for the REST API - GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [A Developer's Guide: Managing Rate Limits for the GitHub API](https://www.lunar.dev/post/a-developers-guide-managing-rate-limits-for-the-github-api)
- [Updated rate limits for unauthenticated requests - GitHub Changelog](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)

### Confluence
- [Rate limiting - Confluence Cloud](https://developer.atlassian.com/cloud/confluence/rate-limiting/)
- [Scaling responsibly: evolving our API rate limits - Atlassian](https://www.atlassian.com/blog/platform/evolving-api-rate-limits)

### Gmail
- [Usage limits | Gmail API](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Managing Threads | Gmail API](https://developers.google.com/workspace/gmail/api/guides/threads)

### Microsoft Outlook
- [Microsoft Graph service-specific throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)
- [Throttling coming to Outlook API and Microsoft Graph](https://devblogs.microsoft.com/microsoft365dev/throttling-coming-to-outlook-api-and-microsoft-graph/)

### WhatsApp Business
- [WhatsApp API Rate Limits: How They Work](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/)
- [WhatsApp API 2026: Complete Integration Guide - Unipile](https://www.unipile.com/whatsapp-api-a-complete-guide-to-integration/)

### Intercom
- [Rate Limiting | Intercom Developers](https://developers.intercom.com/docs/references/rest-api/errors/rate-limiting)
- [A practical guide to Intercom API rate limits in 2025](https://www.eesel.ai/blog/intercom-api-rate-limits)

### Zendesk
- [Rate limits | Zendesk Developer Docs](https://developer.zendesk.com/api-reference/introduction/rate-limits/)
- [Best practices for avoiding rate limiting | Zendesk](https://developer.zendesk.com/documentation/ticketing/using-the-zendesk-api/best-practices-for-avoiding-rate-limiting/)
- [Chat Conversations API | Zendesk Developer Docs](https://developer.zendesk.com/api-reference/live-chat/chat-conversations-api/conversations-api/)

### Architecture Patterns
- [Data source connectors layer as a service - design patterns](https://ceur-ws.org/Vol-3369/short2.pdf)
- [Adapter Pattern for Integrating multiple data sources](https://medium.com/@logeshrajendran/adapter-pattern-your-gauntlet-for-integrating-multiple-data-sources-8dce16dc2517)
- [Data Ingestion in a Multi-Tenant SaaS Environment Using AWS](https://aws.amazon.com/blogs/apn/data-ingestion-in-a-multi-tenant-saas-environment-using-aws-services/)
- [Architectural Approaches for Tenant Integration - Azure](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/integration)
- [How to build a scalable platform architecture for real-time data](https://www.redpanda.com/blog/reference-architecture-saas-real-time-data)
