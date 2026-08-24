# Sahayak — Database Design Documentation

> This document is built incrementally. Each section is verified and approved before the next is added.
> All tables use `InnoDB` engine (default in MySQL 8+) for foreign key support and transaction safety.
> Companion file: [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) — covers `societies`, `blocks`, `floors`, `units`.

---

## Status

| Table | Status | Documented In |
|---|---|---|
| `users` | ✅ Finalized | [USER_DB.md](./USER_DB.md) |
| `societies` | ✅ Finalized | [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) |
| `blocks` | ✅ Finalized | [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) |
| `floors` | ✅ Finalized | [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) |
| `units` | ✅ Finalized | [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) |
| `tickets` | 🔲 Pending | Phase 2 |
| `ticket_replies` | 🔲 Pending | Phase 2 |
| `announcements` | 🔲 Pending | Phase 2 |
| `vendors` | 🔲 Pending | Phase 2 |
| `maintenance_config` | 🔲 Pending | Phase 2 |
| `maintenance_ledger` | 🔲 Pending | Phase 2 |
| `payment_transactions` | 🔲 Pending | Phase 2 |

---

## Table 1 — `users`

### SQL

```sql
CREATE TABLE users (
    id                INT          NOT NULL AUTO_INCREMENT,
    role              ENUM(
                        'super_admin',
                        'secretary',
                        'resident'
                      )            NOT NULL,
    society_id        INT          NULL,
    unit_id           INT          NULL,
    name              VARCHAR(100) NOT NULL,
    email             VARCHAR(150) NOT NULL,
    phone             VARCHAR(15)  NULL,
    password_hash     VARCHAR(255) NOT NULL,
    status            ENUM(
                        'pending',
                        'active',
                        'inactive',
                        'rejected'
                      )            NOT NULL DEFAULT 'pending',
    is_email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)

    -- Foreign keys to societies and units are added after those tables are created.
    -- See "Deferred FK Note" below.
);
```

> **Deferred FK Note** — `society_id` and `unit_id` are intentionally left without `FOREIGN KEY`
> constraints here because the `societies` and `units` tables do not exist yet.
> Once those tables are created in later steps, the constraints will be added with:
>
> ```sql
> ALTER TABLE users
>     ADD CONSTRAINT fk_users_society
>         FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL,
>     ADD CONSTRAINT fk_users_unit
>         FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL;
> ```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
- Standard surrogate primary key. Auto-incremented by MySQL.
- Used as the reference point in every other table that links back to a user
  (e.g. `tickets.raised_by_user_id`, `societies.secretary_id`).

---

#### `role` — `ENUM('super_admin', 'secretary', 'resident') NOT NULL`
- Controls what this user is allowed to see and do across the entire platform.
- Three roles:
  - **`super_admin`** — Platform owner. Can see and manage all secretaries and societies.
    Not affiliated with any single society. Created directly in the DB (no public registration).
  - **`secretary`** — Creates and manages one society. No apartment/unit of their own in the system.
  - **`resident`** — Lives in a unit inside a society. Must be approved by the secretary before getting access.
- Using `ENUM` here (not a separate `roles` table) because the roles are fixed, known,
  and will never grow beyond these three in the scope of this project.
  A full RBAC `roles` table would be overkill.

---

#### `society_id` — `INT NULL`
- References `societies(id)` (FK added later).
- Meaning by role:
  - **`super_admin`** → always `NULL`. They sit above all societies.
  - **`secretary`** → `NULL` right after registration. Gets populated once the secretary completes society setup.
  - **`resident`** → set at registration time when the resident submits the society code. Never `NULL` for an active resident.
- `ON DELETE SET NULL` — if a society is ever deleted, the user row is not deleted; `society_id` just becomes `NULL`.

---

#### `unit_id` — `INT NULL`
- References `units(id)` (FK added later).
- Meaning by role:
  - **`super_admin`** → always `NULL`.
  - **`secretary`** → always `NULL`. Secretaries do not occupy a unit in the system.
  - **`resident`** → set at registration time when the resident selects their apartment.
    The application layer enforces this is never `NULL` for an active resident.
    MySQL enforces that whatever value is provided actually exists in the `units` table (FK integrity).
- `ON DELETE SET NULL` — if a unit is deleted, the link is cleared rather than cascading to delete the user.

---

#### `name` — `VARCHAR(100) NOT NULL`
- Full display name of the person. Not split into first/last — unnecessary complexity for this use case,
  and most Indian names don't fit cleanly into that split anyway.

---

#### `email` — `VARCHAR(150) NOT NULL` + `UNIQUE`
- Primary login identifier across all roles.
- The `UNIQUE` constraint at the DB level means no two users (regardless of role) can share an email.
  This prevents edge cases like a secretary accidentally re-registering as a resident.

---

#### `phone` — `VARCHAR(15) NULL`
- Stored as a string, not an integer — phone numbers can have leading zeros, country codes (`+91`),
  and should never be used in arithmetic.
- `NULL` is allowed. Phone is collected during registration if provided, but not enforced as mandatory
  at the DB level. The application layer may enforce it for residents if SMS notifications are needed.
- `VARCHAR(15)` covers the international E.164 format max length (`+` + 14 digits = 15 chars).

---

#### `password_hash` — `VARCHAR(255) NOT NULL`
- **Never stores the raw password.** Purvi's Node backend hashes it using `bcrypt` before inserting.
- `VARCHAR(255)` — bcrypt output is 60 characters, but 255 gives headroom if the hashing algorithm
  is ever changed (e.g., Argon2 outputs vary in length).
- The AI agent has **read-only** access to the DB for reasoning purposes —
  it must **never** read or expose `password_hash`. Shub must exclude this column
  from all agent-facing queries.

---

#### `status` — `ENUM('pending', 'active', 'inactive', 'rejected') NOT NULL DEFAULT 'pending'`
- Controls whether this user can log in and operate.
- State transitions by role:

  | Role | At Registration | After Action | Notes |
  |---|---|---|---|
  | `super_admin` | `active` | — | Set directly in DB, no registration flow |
  | `secretary` | `active` | Can be set to `inactive` by super_admin | Secretary is trusted at self-registration |
  | `resident` | `pending` | `active` (approved) or `rejected` (denied) by secretary | Approval required |

- `pending` — registered but awaiting secretary approval (resident only in normal flow).
- `active` — fully operational, can log in.
- `inactive` — suspended by super_admin. Account exists but cannot log in. Not deleted.
- `rejected` — secretary denied this resident's registration request.
- Default is `pending` — safe for all new inserts. Secretary registration overrides this to `active`
  at the application layer explicitly on insert.

---

#### `is_email_verified` — `BOOLEAN NOT NULL DEFAULT FALSE`
- Tracks whether the user has clicked the verification link sent to their email after registration.
- A user can exist with `status = 'active'` but `is_email_verified = FALSE` — the application decides
  whether to block login until verified, or just nudge them. Keeping this flexible at the DB level.
- Default `FALSE` — always starts unverified until the link is clicked.

---

#### `created_at` — `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
- Set automatically by MySQL on insert. Application never needs to pass this manually.
- Useful for: secretary dashboard seeing when a resident registered,
  super_admin auditing secretary signups, AI agent answering "who registered this month."

---

#### `updated_at` — `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
- Automatically updated by MySQL whenever any column in the row changes. Zero application-side effort.
- Useful for: auditing profile changes, tracking when a resident's status was last changed.

---

### Per-Role Column State Summary

| Column | `super_admin` | `secretary` | `resident` |
|---|---|---|---|
| `society_id` | `NULL` (always) | `NULL` at registration → set after society setup | Set at registration (from society code) |
| `unit_id` | `NULL` (always) | `NULL` (always) | Set at registration (resident picks their unit) |
| `phone` | Optional | Optional | Optional (app layer may enforce for SMS) |
| `status` at creation | `active` (direct DB insert) | `active` | `pending` |
| `is_email_verified` at creation | `TRUE` (direct DB insert) | `FALSE` | `FALSE` |

---

### Design Decisions & Trade-offs

**Why one `users` table and not separate `secretaries` / `residents` tables?**
All three roles share the same authentication columns (`email`, `password_hash`, `is_email_verified`).
Splitting them would force Purvi to write three separate login flows, three password-reset handlers,
and three JWT strategies. A single table with a `role` column means auth is written once, and
the `role` value gates access everywhere. This is the industry-standard pattern used by
Django, Laravel, Rails, and most production SaaS systems.

**Why `ENUM` for `role` and `status` instead of a separate lookup/roles table?**
Both value sets are closed and fixed for the lifetime of this project.
A separate `roles` table would add a JOIN overhead to every single auth check with no practical benefit at this scale.
`ENUM` also enforces valid values at the DB level automatically — invalid values are rejected on insert.

**Why is `phone` nullable?**
Not every person has (or wants to share) a phone number at registration.
Enforcing `NOT NULL` would block valid sign-ups unnecessarily.
If the platform later requires phone for SMS OTP, that enforcement lives in the application layer —
keeping the DB schema flexible without a migration.

**Why are `society_id` and `unit_id` on the `users` table and not looked up via joins?**
For a secretary, their society could be found via `SELECT * FROM societies WHERE secretary_id = user.id`.
For a resident, their society is directly on their row.
Keeping `society_id` directly on the user row means every session-level check ("is this user from society X?")
is a single-column read on the users row — no joins needed on the hot path.
This is a deliberate denormalization trade-off for performance on the most frequent operation.

---

## Doubts & Clarifications

> Questions that came up during design review, answered and documented for future reference.

---

### ❓ Doubt 1 — Why are the FKs for `society_id` and `unit_id` commented out / deferred?

**Q:** The foreign key constraints on `society_id` and `unit_id` are not declared inside the `CREATE TABLE` — they're left as a comment and added later via `ALTER TABLE`. Is this because of circular imports, like with circular references in code?

**A:** Yes, exactly — and there are two distinct reasons:

**Reason 1 — True Circular FK between `users` and `societies` (the real problem):**
Both tables reference each other:
- `users.society_id` → `societies.id`
- `societies.secretary_id` → `users.id`

MySQL cannot create both tables with their FKs intact simultaneously — whichever you create first, the table it references doesn't exist yet, so the FK declaration will fail. The fix is to create both tables without the circular FK first, then use `ALTER TABLE` to add it after both tables exist.

```sql
-- Step 1: Create users (no FK to societies yet)
CREATE TABLE users (...);

-- Step 2: Create societies (FK to users is fine — users already exists)
CREATE TABLE societies (
    secretary_id INT NOT NULL,
    FOREIGN KEY (secretary_id) REFERENCES users(id)  -- ✅ works
    ...
);

-- Step 3: Now add the reverse FK on users (societies now exists)
ALTER TABLE users
    ADD CONSTRAINT fk_users_society
        FOREIGN KEY (society_id) REFERENCES societies(id);  -- ✅ works
```

**Reason 2 — Sequential Build for `units` (simpler, not circular):**
`users.unit_id → units.id` is not a circular reference — `units` does not reference back to `users`.
However, since we are building tables incrementally and `units` does not exist in the schema yet,
the FK cannot be declared now. It is simply added via `ALTER TABLE` once `units` is created later.

| FK | Why deferred |
|---|---|
| `users.society_id → societies` | Circular reference — mutual dependency between tables |
| `users.unit_id → units` | Sequential build — `units` table does not exist yet |

---

### ❓ Doubt 2 — Why no `block_name` / `floor_number` columns on the `users` table?

**Q:** At resident registration, the UI shows cascading dropdowns — pick a Block, then a Floor, then a Unit. Shouldn't the selected block and floor also be stored on the user row for easy access?

**A:** No — storing block and floor on the `users` table would be **redundant denormalization**, and here is why:

The unit hierarchy is: `societies → blocks → floors → units`

A `unit` already knows what floor it is on (`units.floor_id`), and that floor already knows what block it is in (`floors.block_id`). Since the `users` table already stores `unit_id`, all of this information is always reachable via a JOIN:

```sql
SELECT
    u.name,
    b.block_name,
    f.floor_number,
    un.display_label    -- e.g. "A-101"
FROM users u
JOIN units  un ON u.unit_id   = un.id
JOIN floors f  ON un.floor_id = f.id
JOIN blocks b  ON f.block_id  = b.id
WHERE u.id = 123;
```

If block and floor were also stored on the `users` row, the same data would exist in two places.
That means when a block is renamed, you would need to update both the `blocks` table **and** every user row — miss one, and the data is inconsistent. This is exactly what normalization prevents.

**The cascading dropdowns are a frontend + API concern, not a storage concern:**

```
User enters Society Code
        ↓
GET /society/{code}/blocks              → populates Block dropdown
        ↓  (user picks Block A)
GET /blocks/{id}/floors                 → populates Floor dropdown
        ↓  (user picks Floor 1)
GET /floors/{id}/units?status=vacant    → populates Unit dropdown (vacant only)
        ↓  (user picks A-101)
POST /register  { ..., unit_id: 42 }   ← only the final unit_id is stored
```

Block and floor are used only for navigation during registration — the DB only needs the final `unit_id`.

| Data | Where it lives | Reason |
|---|---|---|
| Which unit the resident is in | `users.unit_id` | Single source of truth |
| Which floor that unit is on | `units.floor_id → floors` | Derived via JOIN — always correct |
| Which block that floor is in | `floors.block_id → blocks` | Derived via JOIN — always correct |
| Block/Floor dropdowns at registration | API responses only | UI navigation, not stored |
