# Threat Model

## Project Overview

CardCaddie is a public internet golf scorecard application with a React + Vite frontend and an Express 5 API backed by PostgreSQL via Drizzle ORM. Users authenticate with a phone-number OTP flow backed by Twilio Verify and receive a JWT bearer token that is then used for authenticated API requests. The application exposes public trip, round, player, leaderboard, feed-preview, and course-lookup functionality alongside authenticated profile, social, and trip-management features.

Production assumptions for this repository:
- Replit deployments terminate TLS for inbound traffic.
- `NODE_ENV` is `production` in production.
- The mockup sandbox artifact is dev-only unless production reachability is demonstrated.
- The current deployment is public, so all public routes must be treated as internet-reachable.

## Assets

- **User accounts and sessions** — phone numbers, JWT bearer tokens, and Twilio-backed OTP login state. Compromise enables impersonation and unauthorized edits across trips and rounds.
- **Trip and round integrity** — trips, players, group assignments, scores, scramble scores, standings, comments, and social state. Unauthorized tampering directly changes user-visible results and competitive outcomes.
- **User privacy data** — phone numbers, discoverability settings, profile visibility, follow relationships, round participation, and social graph data.
- **Application secrets** — `JWT_SECRET`, Twilio credentials, database credentials, and `GOLF_COURSE_API_KEY`. Exposure or weak defaults would let an attacker mint sessions or abuse upstream services.
- **Availability-sensitive upstream quota** — Twilio Verify and GolfCourseAPI usage can be abused for spam, quota exhaustion, or service degradation if public endpoints lack adequate controls.

## Trust Boundaries

- **Browser / API boundary** — all client input is untrusted. Every mutation must be authenticated and authorized server-side; frontend gates are advisory only.
- **Public / authenticated boundary** — some trip, round, player, and course-lookup routes are intentionally public while profile, social, and account-management routes require auth. This is the highest-risk boundary in the app because score and roster data are collaborative and tempting to overexpose.
- **Authenticated user / other authenticated user boundary** — users must not be able to edit or delete other users’ trips, players, scores, follows, or social content unless the server explicitly grants shared-trip permissions.
- **API / database boundary** — the API server holds direct write access to all competitive and social data. Broken access control at the API layer immediately becomes database tampering.
- **API / external service boundary** — the server calls Twilio Verify and GolfCourseAPI using secrets. User-controlled request data must not let attackers exfiltrate secrets, bypass auth, or amplify abuse of those third-party services.
- **Production / dev-only boundary** — `artifacts/mockup-sandbox/`, generated/dist outputs, and local-only tooling should generally be ignored unless there is evidence they are served in production.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/*.ts`
- Frontend entry points: `artifacts/golf-scorecard/src/main.tsx`, `artifacts/golf-scorecard/src/App.tsx`, `artifacts/golf-scorecard/src/lib/auth.ts`
- Highest-risk areas: `routes/players.ts`, `routes/scores.ts`, `routes/groups.ts`, `routes/scramble-scores.ts`, `routes/auth.ts`, `lib/jwt.ts`, `routes/connections.ts`
- Public surfaces: trip/round/player reads, course lookup, claim preview, OTP bootstrap, and any route without `requireAuth`
- Authenticated surfaces: `/auth/me*`, `/users/me*`, feed/social actions, follow actions, claims, trip/round creation and most profile operations
- Dev-only areas to usually skip: `artifacts/mockup-sandbox/`, compiled `dist/` outputs, local scripts unless production reachability is shown

## Threat Categories

### Spoofing

The application issues long-lived JWT bearer tokens after OTP verification. The server must require a strong, deployment-specific signing secret in production and must reject any request that lacks a valid bearer token for protected routes. OTP initiation and verification endpoints must resist abuse well enough that attackers cannot cheaply impersonate users or brute-force account access.

### Tampering

The core business asset is competitive scoring data. The API must ensure that only authorized trip participants can create, update, delete, or claim players, rounds, group assignments, scores, and scramble scores. Public read access does not imply public write access; every mutation endpoint must enforce both authentication and object-level authorization.

### Information Disclosure

Trips, players, rounds, and social features expose identity and participation data. Private profiles, private rounds, phone-based discoverability controls, and claim/invite flows must not leak extra fields such as phone tags, claim codes, hidden rounds, or non-public relationship data. Logs and error messages must also avoid exposing secrets or upstream credential details.

### Denial of Service

Public endpoints can trigger outbound Twilio and GolfCourseAPI requests and can mutate shared score state. The service must bound request rates and resource usage enough that attackers cannot spam OTP sends, churn shared round state, or exhaust upstream quotas from the public internet.

### Elevation of Privilege

Because users collaborate inside shared trips, broken object-level authorization is the most plausible privilege-escalation path. A user — or unauthenticated internet attacker on public routes — must not be able to act as a trip member, scorekeeper, trip creator, or invited player without satisfying the server-side rules for that role. All privileged actions must be enforced in the route handlers and not delegated to client assumptions.