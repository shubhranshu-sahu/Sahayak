# Sahayak — Complaints Feature Database Documentation

> Covers the complaint management tables: `complaints`, `complaint_replies`.
> Companion files: [USER_DB.md](./USER_DB.md), [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md)

---

## Status

| Table | Status |
|---|---|
| `complaints` | ✅ Finalized |
| `complaint_replies` | ✅ Finalized |

---

## 1. Feature Name

**UI Label**: "Complaints"
**DB Table Names**: `complaints`, `complaint_replies`

### Why "Complaints" and not "Tickets" or "Service Requests"?

In the context of an Indian RWA/housing society, residents and secretaries naturally say
"raise a complaint" or "I have a complaint about the lift". The word "ticket" is developer
jargon that residents won't relate to, and "service request" sounds like a corporate helpdesk.
"Complaints" is the most natural, culturally appropriate term for this domain.

Internally, the code and DB use `complaints` consistently. The AI agent also references them
as complaints in natural language tool outputs.

---

## 2. Complaint Lifecycle — Status Flow

```
Resident raises complaint
        │
        ▼
    [ OPEN ]  ◀───────────────────────────────────────────────────────────────┐
        │                                                                      │
        │  Secretary replies / starts working                                  │
        ▼                                                                      │
 [ IN_PROGRESS ] ◀──────────────────────────────────────────────────────────  │
        │                          │                                           │
        │                          │ Secretary rejects at any point            │
        │                          │ (must provide reason)                     │
        │                          ▼                                           │
        │                    [ REJECTED ]  ← terminal, no further action       │
        │                                                                      │
        │  Secretary marks "Mark as Resolved"                                  │
        ▼                                                                      │
[ PENDING_CLOSURE ]                                                            │
        │                                                                      │
        ├── Resident confirms: "Yes, resolved" ──────────▶ [ CLOSED ]         │
        │                                                   (terminal)         │
        └── Resident rejects: "Still not fixed"                                │
            (adds a reply explaining why) ──────────────────────────── back ───┘
                                                             to [ IN_PROGRESS ]

Auto-close (cron job — no schema change needed):
  IF status = 'pending_closure' AND updated_at < NOW() - INTERVAL 7 DAY:
    → UPDATE status = 'closed', closed_at = NOW()
    → INSERT system reply: "Auto-closed after 7 days with no response."
```

### Status Reference

| Status | Set by | Meaning |
|---|---|---|
| `open` | System on creation | Complaint raised, not yet handled |
| `in_progress` | Secretary | Secretary has acknowledged and is handling |
| `pending_closure` | Secretary | Believes issue is resolved, awaiting resident confirmation |
| `closed` | Resident (confirm) or Cron (auto) | Fully resolved and closed — terminal |
| `rejected` | Secretary | Invalid / out of scope complaint — terminal |

---

## 3. Design Decisions

**Why store `society_id` on `complaints` (denormalized)?**
The AI agent's most frequent query pattern is society-scoped: *"Show me all open complaints
in this society"*. Without `society_id` directly on `complaints`, every such query would
require joining through `users` or `units`. A single denormalized INT column eliminates that
join on the hot path. Same reasoning as `society_id` on `users` and `floors`.

**Why is `category_label` a separate column and not just a free-text category field?**
Fixed ENUM categories allow the AI agent to filter and aggregate reliably:
`WHERE category = 'plumbing'`. If category were free text, residents would type
"Plumbing", "plumbing issue", "water leak" — impossible to group. `category_label` is only
populated when `category = 'other'`, giving the resident a voice while keeping the AI's
filter surface clean and consistent.

**Why are `complaint_replies` immutable (no `updated_at`)?**
Replies are a conversation thread — like chat messages. Allowing edits after sending breaks
the trust and integrity of the thread. Once sent, a reply is permanent. If someone needs to
correct something, they send a new reply. This matches how every major support/ticketing
system (Zendesk, Freshdesk) works.

**Why does `sender_role` exist on replies if `sender_id` already points to `users.role`?**
Two reasons:
1. **System messages** (`sender_id = NULL`) have no corresponding `users` row.
   `sender_role = 'system'` is the only way to identify auto-close and system-generated replies.
2. **Query performance**: The AI agent can filter `WHERE sender_role = 'secretary'`
   without an extra JOIN to `users`.

**Why `LEFT JOIN` on `users` when fetching replies?**
Because `sender_id = NULL` for system messages. An `INNER JOIN` would silently drop
all system-generated replies from the result. `LEFT JOIN` keeps them, with `u.name = NULL`
— the frontend renders "System" as the display name.

**Auto-close: why no schema change?**
The cron job uses `updated_at` (which auto-refreshes on every status change) to detect
stale `pending_closure` tickets. No dedicated column needed. The job updates
`status = 'closed'` and `closed_at = NOW()`, then inserts a `sender_role = 'system'` reply.
Zero DB schema impact — purely application-layer logic.

**Why `closed_at` but not `rejected_at`?**
`closed_at` enables a high-value AI metric: **average complaint resolution time**
(`closed_at - created_at`). The secretary can ask: *"What is the average time to resolve
plumbing complaints this month?"*
`rejected_at` has no equivalent analytical value — `updated_at` already records when
rejection happened.

**Photos: one per message via Cloudinary.**
Each complaint and each reply can carry one photo. The actual file never touches MySQL —
only a permanent Cloudinary CDN URL is stored. Cloudinary's free tier (25 credits/month)
is sufficient for a college demo. Local server disk is avoided because free-tier hosts
(Render, Railway) use ephemeral filesystems — files written to disk can silently vanish
on redeploy.

---

## 4. Table 1 — `complaints`

### SQL

```sql
CREATE TABLE complaints (
    id                INT          NOT NULL AUTO_INCREMENT,
    society_id        INT          NOT NULL,
    unit_id           INT          NOT NULL,
    resident_id       INT          NOT NULL,

    title             VARCHAR(200) NOT NULL,

    category          ENUM(
                        'plumbing',
                        'electrical',
                        'lift',
                        'cleanliness',
                        'security',
                        'parking',
                        'noise',
                        'other'
                      )            NOT NULL,

    -- Only populated when category = 'other'. Stores what the resident typed.
    category_label    VARCHAR(100) NULL,

    description       TEXT         NOT NULL,

    -- Cloudinary CDN URL. Optional — resident may or may not attach a photo.
    attachment_url    VARCHAR(500) NULL,

    status            ENUM(
                        'open',
                        'in_progress',
                        'pending_closure',
                        'closed',
                        'rejected'
                      )            NOT NULL DEFAULT 'open',

    -- Only populated when status = 'rejected'. Secretary must provide a reason.
    rejection_reason  VARCHAR(500) NULL,

    -- Set when status becomes 'closed' (resident confirm or auto-close cron).
    -- Enables AI agent to compute average resolution time.
    closed_at         DATETIME     NULL,

    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- AI agent's most common filter: open complaints in a society
    INDEX idx_complaints_society_status (society_id, status),

    -- Resident views their own complaints
    INDEX idx_complaints_resident (resident_id),

    -- category_label is required when category = 'other'
    CONSTRAINT chk_category_label
        CHECK (category != 'other' OR category_label IS NOT NULL),

    -- rejection_reason is required when status = 'rejected'
    CONSTRAINT chk_rejection_reason
        CHECK (status != 'rejected' OR rejection_reason IS NOT NULL),

    CONSTRAINT fk_complaints_society
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT,

    CONSTRAINT fk_complaints_unit
        FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,

    CONSTRAINT fk_complaints_resident
        FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
Standard surrogate PK. Referenced by `complaint_replies.complaint_id`.

---

#### `society_id` — `INT NOT NULL` + FK → `societies(id)`
Denormalized from `resident_id → users.society_id` for query performance.
The AI agent queries complaints almost exclusively within a society context.
`ON DELETE RESTRICT` — consistent with the project-wide no-silent-cascade philosophy.

---

#### `unit_id` — `INT NOT NULL` + FK → `units(id)`
Records which unit the complaint originates from.
Denormalized from `resident_id → users.unit_id`.
Enables AI queries like: *"Are there recurring complaints from unit A-101?"*

---

#### `resident_id` — `INT NOT NULL` + FK → `users(id)`
The resident who raised the complaint. Used to:
- Restrict the resident to only view/reply to their own complaints.
- Let the secretary see the complainant's name and unit.
- Let the AI agent query complaint history per resident.

---

#### `title` — `VARCHAR(200) NOT NULL`
Short summary of the complaint, e.g. `"Water leakage in bathroom"`.
Required. Used as the complaint's display label in lists and the AI agent's summaries.

---

#### `category` — `ENUM(...) NOT NULL`
Fixed category for AI filtering and analytics. The AI agent can answer:
*"How many plumbing complaints are open this month?"* only because `category`
is a structured ENUM, not free text.

| Value | Covers |
|---|---|
| `plumbing` | Leaks, pipe issues, drainage blockage |
| `electrical` | Power cuts, faulty wiring, fuse issues |
| `lift` | Elevator malfunction, maintenance |
| `cleanliness` | Garbage, common area hygiene |
| `security` | Gate, guard, CCTV issues |
| `parking` | Unauthorized parking, space disputes |
| `noise` | Neighbor noise, construction disturbance |
| `other` | Anything outside the above (requires `category_label`) |

---

#### `category_label` — `VARCHAR(100) NULL`
Free-text label provided by the resident when `category = 'other'`.
`NULL` for all other categories.
`CHECK (category != 'other' OR category_label IS NOT NULL)` enforces that
an 'other' complaint always has a custom description.
The AI agent reads `category_label` when processing `other` complaints to
understand the actual nature of the issue.

---

#### `description` — `TEXT NOT NULL`
The full complaint description written by the resident. Required — a title alone is
insufficient for the AI agent to draft a meaningful reply or accurately categorize urgency.

---

#### `attachment_url` — `VARCHAR(500) NULL`
Cloudinary CDN URL for an optional photo attached to the initial complaint.
Example: `https://res.cloudinary.com/sahayak/image/upload/v123/complaints/abc.jpg`
`NULL` if no photo was uploaded.

---

#### `status` — `ENUM(...) NOT NULL DEFAULT 'open'`
Current state of the complaint. Default `'open'` — all complaints start open.
See the lifecycle diagram in Section 2 for full transition rules.

---

#### `rejection_reason` — `VARCHAR(500) NULL`
Free-text reason the secretary provides when rejecting a complaint. `NULL` for all
non-rejected complaints. `CHECK` constraint ensures a reason is always recorded —
important for resident transparency and for the AI agent to understand why complaints
were rejected (avoids similar future complaints being mistakenly raised).

---

#### `closed_at` — `DATETIME NULL`
Timestamp of when the complaint was fully closed.
Set by the API when a resident confirms resolution, or by the cron job on auto-close.

Enables the AI agent to compute resolution metrics:
```sql
-- Average resolution time (hours) for plumbing complaints
SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, closed_at))
FROM complaints
WHERE society_id = ? AND category = 'plumbing' AND status = 'closed';
```

---

#### `created_at` / `updated_at`
- `created_at` — when the complaint was raised.
- `updated_at` — auto-refreshes on every row change. Used by the auto-close cron job
  to find stale `pending_closure` complaints:
  `WHERE status = 'pending_closure' AND updated_at < NOW() - INTERVAL 7 DAY`

---

### Constraints Summary

| Constraint | Type | Purpose |
|---|---|---|
| `PRIMARY KEY (id)` | PK | Unique row identifier |
| `INDEX (society_id, status)` | Composite Index | Fast AI agent filtering by society + status |
| `INDEX (resident_id)` | Index | Fast resident's own complaint listing |
| `CHECK (category_label)` | Check | `category_label` required when `category = 'other'` |
| `CHECK (rejection_reason)` | Check | `rejection_reason` required when `status = 'rejected'` |
| `FK society_id RESTRICT` | FK | Referential integrity — no orphaned complaints |
| `FK unit_id RESTRICT` | FK | Referential integrity |
| `FK resident_id RESTRICT` | FK | Referential integrity |

---

## 5. Table 2 — `complaint_replies`

### SQL

```sql
CREATE TABLE complaint_replies (
    id              INT          NOT NULL AUTO_INCREMENT,
    complaint_id    INT          NOT NULL,

    -- NULL for system-generated messages (auto-close, automated actions).
    -- NULL on FK columns is valid in MySQL — does not trigger FK constraint.
    sender_id       INT          NULL,

    sender_role     ENUM(
                      'resident',
                      'secretary',
                      'system'
                    )            NOT NULL,

    -- NULL if this is a photo-only message. See chk_reply_content.
    message         TEXT         NULL,

    -- Cloudinary CDN URL. NULL if this is a text-only message.
    attachment_url  VARCHAR(500) NULL,

    -- Replies are immutable — no updated_at.
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Fetch full thread for a complaint, oldest first
    INDEX idx_replies_complaint (complaint_id, created_at),

    -- Every reply must have at least a message OR a photo.
    CONSTRAINT chk_reply_content
        CHECK (message IS NOT NULL OR attachment_url IS NOT NULL),

    CONSTRAINT fk_replies_complaint
        FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE RESTRICT,

    -- LEFT JOIN safe: NULL sender_id (system) does not trigger this FK in MySQL.
    CONSTRAINT fk_replies_sender
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
Standard surrogate PK.

---

#### `complaint_id` — `INT NOT NULL` + FK → `complaints(id)`
Which complaint this reply belongs to.
`ON DELETE RESTRICT` — complaints are never deleted (only closed/rejected),
so this is a safety guard against accidental complaint deletion while replies exist.

---

#### `sender_id` — `INT NULL` + FK → `users(id)`
The `users.id` of whoever sent this reply:
- Resident reply → `sender_id = resident's users.id`
- Secretary reply → `sender_id = secretary's users.id`
- System message → `sender_id = NULL`

MySQL allows `NULL` on FK columns — a `NULL` value does not trigger the FK constraint.
Always use `LEFT JOIN users ON sender_id = users.id` when fetching replies so that
system messages (NULL sender) are not dropped from the result set.

---

#### `sender_role` — `ENUM('resident', 'secretary', 'system') NOT NULL`
Identifies the sender type without requiring a JOIN to `users`.
- Enables `WHERE sender_role = 'secretary'` filtering by the AI agent.
- Required for system messages where `sender_id = NULL` and no `users` row exists.
- `'system'` is used for: auto-close messages, and any future automated agent actions
  that insert replies on behalf of the system.

---

#### `message` — `TEXT NULL`
The text content of the reply. `NULL` only if this is a photo-only message.
Combined with `chk_reply_content`, at least one of `message` or `attachment_url`
must be non-NULL — an empty reply is never allowed.

---

#### `attachment_url` — `VARCHAR(500) NULL`
Cloudinary CDN URL for a photo attached to this reply.
Both resident and secretary can send photo replies:
- Resident: photo of the issue (e.g., cracked pipe)
- Secretary: photo of the fix (e.g., completed repair)
`NULL` if this is a text-only reply.

---

#### `created_at` — `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
When this reply was sent. Replies are **immutable** — there is no `updated_at`.
The `INDEX (complaint_id, created_at)` ensures fetching the full thread is fast,
returned in chronological order.

---

### Constraints Summary

| Constraint | Type | Purpose |
|---|---|---|
| `PRIMARY KEY (id)` | PK | Unique row identifier |
| `INDEX (complaint_id, created_at)` | Composite Index | Fast chronological thread retrieval |
| `CHECK (message OR attachment_url)` | Check | Every reply must have text or photo |
| `FK complaint_id RESTRICT` | FK | Cannot orphan a reply from its complaint |
| `FK sender_id RESTRICT` | FK | Referential integrity (NULL-safe for system messages) |

---

## 6. Deferred Columns — May Be Added Later

The following columns were deliberately excluded from the current schema.
They are documented here so context is not lost. All can be added via `ALTER TABLE`
— adding a nullable column to an existing MySQL 8.0 table is a non-breaking, online operation.

| Column | Table | When/Why to Add |
|---|---|---|
| `priority` | `complaints` | `ENUM('low','medium','high','urgent') NULL`. Will be set by the AI agent after its tools and tracking model are designed. `ALTER TABLE complaints ADD COLUMN priority ENUM('low','medium','high','urgent') NULL;` |
| `ai_tracking_enabled` | `societies` or `complaints` | Secretary toggle: if ON, AI agent auto-processes every new complaint (sends notification, drafts summary). Deferred — LLM call volume and cost implications must be evaluated before implementation. |
| `assigned_to` | `complaints` | FK → `users(id)`. For future vendor/staff assignment (assign complaint to a plumber or maintenance staff). Currently out of scope. |
| `resolved_at` | `complaints` | Timestamp when secretary first marks `pending_closure`. Would allow distinguishing "time to first resolution attempt" vs "total closed time". Low priority — `closed_at` is sufficient for current AI metrics. |
| `ai_summary` | `complaints` | `TEXT NULL`. Cached AI-generated summary of the complaint thread. Avoids re-processing the full thread on every AI agent call. Useful optimization for long threads — deferred to Phase 2. |
