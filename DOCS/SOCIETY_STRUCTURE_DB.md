# Sahayak — Society Structure Database Documentation

> Covers the society setup and physical structure tables: `societies`, `blocks`, `floors`, `units`.
> These are created and managed by the secretary after registration.
> Companion file: [USER_DB.md](./USER_DB.md) — covers the `users` table.

---

## Status

| Table | Status |
|---|---|
| `societies` | ✅ Finalized |
| `blocks` | ✅ Finalized |
| `floors` | ✅ Finalized |
| `units` | ✅ Finalized |

---

## Table 1 — `societies`

### SQL

```sql
CREATE TABLE societies (
    id              INT          NOT NULL AUTO_INCREMENT,
    secretary_id    INT          NOT NULL,
    name            VARCHAR(150) NOT NULL,
    society_code    VARCHAR(20)  NOT NULL,
    address         TEXT         NOT NULL,
    city            VARCHAR(100) NOT NULL,
    state           VARCHAR(100) NOT NULL,
    pincode         VARCHAR(10)  NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    metadata        JSON         NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- One secretary can only ever own one society
    UNIQUE KEY uq_societies_secretary (secretary_id),

    -- Society code must be globally unique — residents use it to find their society
    UNIQUE KEY uq_societies_code (society_code),

    -- Enforces format: only uppercase A-Z and hyphens, 3–20 characters
    CONSTRAINT chk_society_code
        CHECK (society_code REGEXP '^[A-Z][A-Z-]{2,19}$'),

    -- If someone tries to delete a secretary user who still owns a society,
    -- MySQL blocks the delete entirely. Secretary must be deactivated, not deleted.
    CONSTRAINT fk_societies_secretary
        FOREIGN KEY (secretary_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
- Standard surrogate primary key.
- Referenced by `blocks`, `floors`, `units`, `users`, `tickets`, `announcements`, and every other table
  that is scoped to a specific society.

---

#### `secretary_id` — `INT NOT NULL` + `UNIQUE` + FK → `users(id)`
- The user who created and owns this society. Always a user with `role = 'secretary'`.
- `NOT NULL` — a society cannot exist without an owning secretary.
- `UNIQUE` — enforces the **one secretary = one society** rule at the DB level.
  Even if the application layer somehow allowed a second society creation, MySQL would reject the insert.
- `ON DELETE RESTRICT` — if someone attempts to delete the secretary's row in `users`
  while this society still exists, MySQL will **block the deletion entirely**.
  This is intentional: secretaries should be deactivated (`status = 'inactive'`), never deleted.
  Deleting a secretary should be a deliberate, multi-step operation with data cleanup — not an accident.

---

#### `name` — `VARCHAR(150) NOT NULL`
- The full display name of the society, e.g. `"Sunrise Apartments"`, `"Green Valley RWA"`.
- Shown to residents on their portal and to the secretary on their dashboard.
- `VARCHAR(150)` — generous enough for long society names common in India.

---

#### `society_code` — `VARCHAR(20) NOT NULL` + `UNIQUE` + `CHECK`
- A short, human-readable code that the secretary creates, e.g. `"SUNRISE-DEL"`, `"GVR-PHASE-TWO"`.
- **Primary use:** residents enter this code at registration to find and join the correct society.
  Without it, a resident has no way to link themselves to a society.
- `UNIQUE` — globally unique across the entire platform. Two societies cannot share a code.
- `CHECK` constraint enforces the format rule: only uppercase `A-Z` and hyphens `-`, minimum 3 characters,
  maximum 20. The regex `^[A-Z][A-Z-]{2,19}$` ensures it starts with a letter and is 3–20 chars total.
- Additional validation (e.g. no trailing hyphen, no consecutive hyphens) is enforced at the application
  layer in Purvi's Node backend — the DB constraint is the last line of defence, not the only one.

---

#### `address` — `TEXT NOT NULL`
- Full street address of the society, e.g. `"Plot 14, Sector 21, Dwarka"`.
- `TEXT` instead of `VARCHAR` because addresses can be arbitrarily long and vary widely.
- Stored as free-form text — not split into street/area/landmark fields, which would over-engineer the schema
  for something that is only displayed, never filtered upon.

---

#### `city` — `VARCHAR(100) NOT NULL`
- City where the society is located, e.g. `"New Delhi"`, `"Pune"`.
- Kept as a separate column (not just part of `address`) because the AI agent and dashboard
  may filter or group societies by city — a dedicated column is far easier to query than
  parsing a free-form address string.

---

#### `state` — `VARCHAR(100) NOT NULL`
- State / UT where the society is located, e.g. `"Delhi"`, `"Maharashtra"`.
- Same reasoning as `city` — kept structured for filtering.
- Stored as free text rather than an ENUM of Indian states, so the schema doesn't break
  if a union territory is added or renamed (this has happened in India with J&K, for example).

---

#### `pincode` — `VARCHAR(10) NOT NULL`
- Indian postal code, always 6 digits (e.g. `"110075"`).
- Stored as `VARCHAR`, not `INT` — pincodes are identifiers, not numbers.
  Arithmetic on them is meaningless, and `VARCHAR` avoids any leading-zero edge cases in future.
- `VARCHAR(10)` gives headroom beyond India's 6-digit standard in case of future requirements.

---

#### `is_active` — `BOOLEAN NOT NULL DEFAULT TRUE`
- Controlled exclusively by the super_admin.
- `TRUE` (default) — society is operational. Secretary and residents can log in and use the platform.
- `FALSE` — society is suspended. The application layer blocks all logins for users belonging to this society.
  The data is preserved; nothing is deleted. Suspension is reversible.
- Use cases: secretary violating terms, non-payment in a future commercial model, platform maintenance.
- Note: this is different from a secretary's `status` column in `users`. A society can be `is_active = FALSE`
  while the secretary's user row stays `status = 'active'` — the secretary is not punished as a person,
  the society's access is what's suspended.

---

#### `metadata` — `JSON NULL`
- Optional JSON store for extensible society-level details without having to run new schema migrations.
- Examples of what can be stored:
  ```json
  {
    "logo_url": "https://cdn.sahayak.app/logos/sunrise.png",
    "contact_phone": "+919876543210",
    "contact_email": "rwa@sunriserealty.in",
    "registration_number": "RWA-DEL-2018-994",
    "established_year": 2018,
    "website": "https://sunrisesociety.in"
  }
  ```
- `NULL` if not used. MySQL natively validates that any stored value is syntactically valid JSON.

---

#### `created_at` / `updated_at`
- Standard auto-managed timestamps. See `users` table documentation for rationale.
- `created_at` tells the super_admin when a society was onboarded onto the platform.
- `updated_at` tracks when society details were last modified (e.g. address change, code change).

---

### Constraints Summary

| Constraint | Type | Purpose |
|---|---|---|
| `PRIMARY KEY (id)` | PK | Unique row identifier |
| `UNIQUE (secretary_id)` | Unique | One secretary = one society |
| `UNIQUE (society_code)` | Unique | Code is globally unique for resident lookup |
| `CHECK (society_code REGEXP ...)` | Check | Enforces CAPS + hyphens format at DB level |
| `FK secretary_id → users(id) RESTRICT` | FK | Blocks accidental secretary user deletion |

---

### Design Decisions & Trade-offs

**Why `ON DELETE RESTRICT` on `secretary_id` and not `CASCADE` or `SET NULL`?**
- `CASCADE` would delete the entire society (all blocks, floors, units, tickets, residents) if the secretary
  user row is deleted — catastrophic data loss from a single DELETE statement. Never acceptable.
- `SET NULL` is not possible here since `secretary_id` is `NOT NULL` — a society without a secretary
  has no owner and is unmanageable.
- `RESTRICT` forces an explicit decision: before deleting a secretary, the operator must first
  either transfer ownership or delete the society's data in a controlled sequence.
  This is the only safe behavior.

**Why is `society_code` secretary-defined and not auto-generated?**
Secretaries need to share this code with residents verbally or on a notice board — `"SUNRISE-DEL"` is
memorable and communicable; `"a3f9b2c1"` is not. Human-readable codes are a deliberate UX choice.
The `UNIQUE` constraint at the DB level ensures no collisions.

**Why no `total_units` or `total_blocks` column?**
These are always derivable with a COUNT query against `blocks` or `units` filtered by `society_id`.
Storing them would require keeping them in sync on every insert/delete — an unnecessary maintenance burden
with no performance benefit at this scale.

---

## Doubts & Clarifications

### ❓ Doubt 1 — Why is `is_active` on societies and not handled purely through the secretary's `status`?

**Q:** If the super_admin wants to suspend a society, can't they just set `users.status = 'inactive'`
for the secretary? Why do we need a separate `is_active` on the societies table?

**A:** Setting the secretary's `status = 'inactive'` only blocks that one user from logging in.
All the residents of that society could still log in, raise tickets, and use the platform normally —
which is not the intended behavior when a society is suspended.

`societies.is_active = FALSE` is a **society-wide kill switch** — the application checks it on every
login attempt for any user belonging to that society (secretary or resident) and blocks all of them.
It is a separate, broader control. The secretary's personal `status` is about that individual account;
`societies.is_active` is about the entire society's access to the platform.

---

### ❓ Doubt 2 — Why add a `metadata JSON` column on `societies` and `units`, but not on `blocks` or `floors`?

**Q:** Why not add `metadata JSON` to every table across the board so we have generic storage everywhere?

**A:** `JSON` columns should be applied intentionally where genuine attribute variability exists:
1. **`societies` & `units` have high variability**: Societies have optional details (logo, contact email, registration number, website), and units have varying features (parking slots, balcony type, furnishing status, meter numbers). These would otherwise result in lots of sparse, mostly-empty columns.
2. **`blocks` & `floors` are strictly structural**: A block is simply a name tag (`"A"`), and a floor is a number (`1`). They do not possess meaningful, variable attributes. Adding a JSON column to them adds useless database overhead and schema noise.


---
---

## Table 2 — `blocks`

### SQL

```sql
CREATE TABLE blocks (
    id          INT         NOT NULL AUTO_INCREMENT,
    society_id  INT         NOT NULL,
    block_name  VARCHAR(10) NOT NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- The same society cannot have two blocks with the same name.
    -- Different societies can both have a block named 'A' — this constraint is scoped per society.
    UNIQUE KEY uq_blocks_society_name (society_id, block_name),

    -- Only uppercase A–Z letters allowed. No digits, spaces, or special characters.
    CONSTRAINT chk_block_name
        CHECK (block_name REGEXP '^[A-Z]+$'),

    -- If a society row is deleted, MySQL blocks it unless all its blocks are removed first.
    -- Societies should be deactivated (is_active = FALSE), not deleted.
    CONSTRAINT fk_blocks_society
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT
);
```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
- Standard surrogate PK.
- Referenced by the `floors` table — every floor row will carry a `block_id` pointing here.

---

#### `society_id` — `INT NOT NULL` + FK → `societies(id)`
- Which society this block belongs to.
- `NOT NULL` — a block cannot exist without a parent society.
- `ON DELETE RESTRICT` — consistent with the design philosophy: structural data is never silently
  cascaded away. If a society needs to be removed, its blocks (and floors, units) must be
  cleaned up explicitly and deliberately.

---

#### `block_name` — `VARCHAR(10) NOT NULL` + `UNIQUE (society_id, block_name)` + `CHECK`
- The name the secretary gives this block, e.g. `"A"`, `"B"`, `"C"`, `"TOWER"`.
- Stored directly in **uppercase** as entered (`A-Z` only). This simplifies all queries, comparisons, and display logic:
  it can be concatenated directly with floor and unit numbers to form display labels like `"A-101"` without runtime case transformations.
- `VARCHAR(10)` — generous for single-letter blocks (`"A"`) up to short names (`"TOWER"`),
  within the A-Z only constraint.
- `UNIQUE KEY uq_blocks_society_name (society_id, block_name)` — a composite unique key,
  **not** a global unique. Two different societies can each have a block `"A"` — that is fine.
  But within a single society, `"A"` can only exist once.
- `CHECK (block_name REGEXP '^[A-Z]+$')` — DB-level enforcement that only uppercase A-Z letters
  are stored. Digits, spaces, hyphens, and lowercase letters are all rejected at the DB level.
  The application layer (Node.js) should automatically uppercase inputs before saving; the CHECK constraint acts as the strict DB-level guardrail.

---

#### `created_at` / `updated_at`
- Auto-managed timestamps.
- `created_at` — when the secretary added this block during society setup.
- `updated_at` — when the block record was last modified (e.g. if block_name is corrected).

---

### Constraints Summary

| Constraint | Type | Purpose |
|---|---|---|
| `PRIMARY KEY (id)` | PK | Unique row identifier |
| `UNIQUE (society_id, block_name)` | Composite Unique | No duplicate block names within the same society |
| `CHECK (block_name REGEXP ...)` | Check | Only A-Z letters, enforced at DB level |
| `FK society_id → societies(id) RESTRICT` | FK | Prevents silent society deletion while blocks exist |

---

### Design Decisions & Trade-offs

**Why no `description` or `notes` column?**
A block is a structural entity — it is a container for floors. It has no meaningful metadata beyond
its name and which society it belongs to. If the AI agent needs "insights about a block," it queries
the floors and units under it (occupancy rate, complaint count, etc.) — none of that needs a
free-text notes field on the block row itself.

**Why uppercase `A-Z` storage?**
Storing directly in uppercase avoids runtime transformation overhead and case mismatches when constructing unit display labels (`CONCAT(b.block_name, '-', u.unit_number)` directly yields `"A-101"`).

**Why `RESTRICT` and not `CASCADE` on society deletion?**
`CASCADE` would mean deleting a society silently deletes all its blocks, which deletes all floors,
which deletes all units, which orphans all residents. That is an irreversible data wipe triggered
by a single DELETE. `RESTRICT` forces intentional, step-by-step cleanup. Consistent with the same
decision made on `fk_societies_secretary`.

**Why is `block_name` a composite unique with `society_id` and not globally unique?**
Block names like `"A"`, `"B"` are short and common. Every society in the platform would
independently have a block `"A"`. A global unique constraint on `block_name` alone would
mean the second society to register a block `"A"` would fail — which is nonsensical.
The composite `UNIQUE (society_id, block_name)` correctly scopes uniqueness to within a society.

---
---

## Table 3 — `floors`

### SQL

```sql
CREATE TABLE floors (
    id            INT              NOT NULL AUTO_INCREMENT,
    block_id      INT              NOT NULL,
    society_id    INT              NOT NULL,
    floor_number  TINYINT UNSIGNED NOT NULL,
    created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Same block cannot have two rows with the same floor number.
    -- Different blocks can independently both have a floor_number = 1.
    UNIQUE KEY uq_floors_block_number (block_id, floor_number),

    -- Floor number must be at least 1. Ground floor / basement not modelled (future scope).
    CONSTRAINT chk_floor_number
        CHECK (floor_number >= 1),

    CONSTRAINT fk_floors_block
        FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE RESTRICT,

    CONSTRAINT fk_floors_society
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT
);
```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
- Standard surrogate PK.
- Referenced by the `units` table — every unit row will carry a `floor_id` pointing here.

---

#### `block_id` — `INT NOT NULL` + FK → `blocks(id)`
- Which block this floor belongs to.
- `NOT NULL` — a floor cannot exist without a parent block.
- `ON DELETE RESTRICT` — if someone tries to delete a block that still has floors, MySQL blocks it.
  Floors must be removed first (and their units before that).

---

#### `society_id` — `INT NOT NULL` + FK → `societies(id)`
- Deliberately denormalized from `blocks.society_id` for query performance.
- Without this column, every query scoped to a society (e.g. "list all floors in society X")
  would require a JOIN through `blocks`. With it, the AI agent or dashboard can do:
  `SELECT * FROM floors WHERE society_id = X` — no JOIN needed.
- The application layer must always set this to the same `society_id` as the parent block's society.
  The FK ensures it references a real society; the block FK ensures the block also belongs to the same society (enforced at application layer).
- `ON DELETE RESTRICT` — consistent with the rest of the structural hierarchy.

---

#### `floor_number` — `TINYINT UNSIGNED NOT NULL`
- The floor's number within its block, e.g. `1`, `2`, `10`.
- **Why `TINYINT UNSIGNED`:** Unsigned means values `0–255`. Combined with the `CHECK (floor_number >= 1)` constraint,
  the effective range is `1–255`. No real housing society has 255 floors, so this is more than sufficient
  and is semantically cleaner than `INT` (which would imply floors could be in the billions).
- **Role in display label:** `floor_number` is the middle segment of the unit display label.
  A unit on floor `1` in block `A` gets display label `A-1XX` where `XX` is the unit number.
  Example: floor `1`, unit `01` → `A-101`. Floor `12`, unit `05` → `A-1205`.
- **Starts at 1 (not 0):** Ground floor and basements are not modelled in the current scope.
  Floor numbering starts at 1 for simplicity and clean display labels. Future scope if needed.
- `UNIQUE KEY uq_floors_block_number (block_id, floor_number)` — composite unique.
  Block `A` and Block `B` can each have a `floor_number = 1` independently — the uniqueness
  is scoped to within a single block, not globally.

---

#### `created_at` / `updated_at`
- Auto-managed timestamps.
- `created_at` — when the secretary added this floor during society setup.
- `updated_at` — when the floor record was last modified.

---

### Constraints Summary

| Constraint | Type | Purpose |
|---|---|---|
| `PRIMARY KEY (id)` | PK | Unique row identifier |
| `UNIQUE (block_id, floor_number)` | Composite Unique | No duplicate floor numbers within the same block |
| `CHECK (floor_number >= 1)` | Check | Floors start at 1, no ground floor / basement |
| `FK block_id → blocks(id) RESTRICT` | FK | Prevents silent block deletion while floors exist |
| `FK society_id → societies(id) RESTRICT` | FK | Referential integrity + fast society-scoped queries |

---

### Design Decisions & Trade-offs

**Why include `society_id` on `floors` if it's derivable from `block_id → blocks.society_id`?**
This is intentional denormalization — the same trade-off made for `society_id` on `users`.
The AI agent's most common floor-related queries are society-scoped: "how many floors in society X",
"list all floors with vacant units in society X". Without `society_id` directly on `floors`,
every such query needs a JOIN through `blocks`. A single extra INT column eliminates that overhead
on the hot path. The FK on `society_id` keeps it referentially valid.

**Why `TINYINT UNSIGNED` and not `INT` or `SMALLINT`?**
`INT` (4 bytes) is semantically misleading — a floor number in the billions makes no sense.
`TINYINT UNSIGNED` (1 byte, range 0–255) signals clearly that this is a small, bounded number.
With the `CHECK (floor_number >= 1)` constraint, it's further narrowed to 1–255.
`SMALLINT` would also work but is unnecessary — 255 floors is already far beyond any realistic scenario.

**Why no ground floor (0) or basements (negative numbers)?**
Ground floor as `floor_number = 0` would make display label `A-001` — slightly confusing since
`0` in the label doesn't visually read as "ground floor" to a resident. Basements as negative numbers
would require `TINYINT SIGNED` and complicate display label generation significantly.
Both are deferred as future scope. The `CHECK (floor_number >= 1)` constraint makes the current
limitation explicit and enforced — it can be relaxed in a migration if needed.

---
---

## Table 4 — `units`

### SQL

```sql
CREATE TABLE units (
    id            INT              NOT NULL AUTO_INCREMENT,
    floor_id      INT              NOT NULL,
    block_id      INT              NOT NULL,
    society_id    INT              NOT NULL,

    -- Denormalized from parent tables for generated label + fast filtering without joins
    block_name    VARCHAR(10)      NOT NULL,
    floor_number  TINYINT UNSIGNED NOT NULL,

    unit_number   TINYINT UNSIGNED NOT NULL,

    -- Auto-computed by MySQL. e.g. block='A', floor=1, unit=01 → 'A-101'
    display_label VARCHAR(20) GENERATED ALWAYS AS (
                      CONCAT(block_name, '-', floor_number, LPAD(unit_number, 2, '0'))
                  ) STORED,

    unit_type     ENUM(
                    'apartment',
                    'villa',
                    'row_house',
                    'plot',
                    'other'
                  )                NOT NULL DEFAULT 'apartment',

    area_sqft     SMALLINT UNSIGNED NULL,

    status        ENUM('vacant', 'occupied') NOT NULL DEFAULT 'vacant',

    metadata      JSON             NULL,

    created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- No two units on the same floor can share a unit_number
    UNIQUE KEY uq_units_floor_number (floor_id, unit_number),

    -- display_label must be unique within a society (A-101 can only exist once per society)
    UNIQUE KEY uq_units_display_label (society_id, display_label),

    -- Unit numbers are capped at 1–99 per floor
    CONSTRAINT chk_unit_number
        CHECK (unit_number >= 1 AND unit_number <= 99),

    CONSTRAINT fk_units_floor
        FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE RESTRICT,

    CONSTRAINT fk_units_block
        FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE RESTRICT,

    CONSTRAINT fk_units_society
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT
);
```

---

### Column-by-Column Explanation

#### `id` — `INT NOT NULL AUTO_INCREMENT`
- Standard surrogate PK.
- Referenced by `users.unit_id` (a resident's home unit), `tickets`, `maintenance_ledger`, etc.

---

#### `floor_id` — `INT NOT NULL` + FK → `floors(id)`
- Which floor this unit sits on.
- `ON DELETE RESTRICT` — deleting a floor that still has units is blocked. Units must be removed first.

---

#### `block_id` — `INT NOT NULL` + FK → `blocks(id)`
- Which block this unit is in.
- Denormalized from `floor_id → floors.block_id` for performance.
- Allows queries like `SELECT * FROM units WHERE block_id = X` without going through `floors`.
- `ON DELETE RESTRICT` — consistent with hierarchy.

---

#### `society_id` — `INT NOT NULL` + FK → `societies(id)`
- Denormalized from `block_id → blocks.society_id` for performance.
- The most common query pattern for any dashboard or AI agent call is society-scoped.
  Having `society_id` directly on `units` means `WHERE society_id = X` hits one indexed column.
- `ON DELETE RESTRICT` — consistent with the rest of the structural hierarchy.

---

#### `block_name` — `VARCHAR(10) NOT NULL`
- Denormalized from `blocks.block_name`.
- **Primary reason:** MySQL `GENERATED` columns cannot reference other tables via subqueries.
  To auto-compute `display_label` inside MySQL, `block_name` and `floor_number` must be
  present as plain columns on the same row.
- **Secondary reason:** AI agent filtering like `WHERE block_name = 'A'` works without a JOIN.
- Application layer must ensure this always matches the actual parent block's `block_name`.
  In practice, block names are set at creation and rarely changed.

---

#### `floor_number` — `TINYINT UNSIGNED NOT NULL`
- Denormalized from `floors.floor_number`.
- Same dual reason as `block_name` — needed for the generated column, and useful for direct filtering.
- Application layer must ensure this matches the actual parent floor's `floor_number`.

---

#### `unit_number` — `TINYINT UNSIGNED NOT NULL`
- The apartment's number on its floor, e.g. `1`, `5`, `12`, `99`.
- Range enforced at DB level: `CHECK (unit_number >= 1 AND unit_number <= 99)` — 99 max per floor.
- When the secretary bulk-adds apartments (e.g. "add apartments 1–20 on floor 1"),
  the application inserts 20 rows with `unit_number` 1 through 20.
- `UNIQUE KEY uq_units_floor_number (floor_id, unit_number)` — no two units on the same floor
  can share a number. Different floors can each have unit 1.

---

#### `display_label` — `VARCHAR(20) GENERATED ALWAYS AS (...) STORED`
- **Auto-computed by MySQL.** The application never sets this manually.
- Formula: `CONCAT(block_name, '-', floor_number, LPAD(unit_number, 2, '0'))`
- Examples:

  | block_name | floor_number | unit_number | display_label |
  |---|---|---|---|
  | `A` | `1` | `1` | `A-101` |
  | `A` | `1` | `9` | `A-109` |
  | `A` | `1` | `99` | `A-199` |
  | `B` | `12` | `5` | `B-1205` |
  | `TOWER` | `3` | `7` | `TOWER-307` |

- `STORED` — the computed value is physically written to disk on insert/update,
  making it indexable and fast to read. If `block_name` or `floor_number` changes (rare),
  MySQL recomputes and updates `display_label` automatically.
- `UNIQUE KEY uq_units_display_label (society_id, display_label)` — within a single society,
  no two units can have the same display label. Globally, `A-101` can exist in multiple societies.

---

#### `unit_type` — `ENUM('apartment', 'villa', 'row_house', 'plot', 'other') NOT NULL DEFAULT 'apartment'`
- The type of unit. Defaults to `'apartment'` since the vast majority of society units are apartments.
- Used for display and filtering. Maintenance billing logic may treat types differently in future
  (e.g. villa billing by plot area rather than sqft).

---

#### `area_sqft` — `SMALLINT UNSIGNED NULL`
- Optional. The floor area of the unit in square feet.
- `NULL` if not provided — many societies don't track this.
- `SMALLINT UNSIGNED` — range 0–65,535 sqft. Sufficient for any residential unit
  (most Indian apartments are 300–3,000 sqft).
- Used by `maintenance_config` when `charge_type = 'per_sqft'` to compute the monthly due:
  `amount_due = base_amount × area_sqft`.

---

#### `status` — `ENUM('vacant', 'occupied') NOT NULL DEFAULT 'vacant'`
- Whether the unit currently has a resident living in it.
- Default `'vacant'` — all units start empty when created by the secretary.
- Flipped to `'occupied'` when a resident's registration is approved and linked to this unit.
- Flipped back to `'vacant'` if the resident is removed or moves out.
- Used by the registration flow to show only vacant units in the dropdown,
  and by the AI agent for occupancy insights: `SELECT COUNT(*) FROM units WHERE status = 'vacant'`.

---

#### `metadata` — `JSON NULL`
- Optional catch-all for unit-specific extras that don't warrant dedicated columns.
- Examples of what might be stored: `{"parking_slot": "P-12", "balcony": true, "furnished": "semi"}`
- `NULL` if not used. Application layer defines and validates the structure of this JSON — the DB
  only enforces it is valid JSON (MySQL validates JSON syntax on insert automatically).
- **Not added to `blocks` or `floors`** — those are structural nodes with no meaningful variable metadata.
  Added to `societies` as well (see `societies` table notes).

---

#### `created_at` / `updated_at`
- Auto-managed timestamps.
- `created_at` — when the secretary created this unit (during bulk setup or individually).
- `updated_at` — last modification (e.g. status change when a resident moves in/out, area_sqft edit).

---

### Constraints Summary

| Constraint | Type | Purpose |
|---|---|---|
| `PRIMARY KEY (id)` | PK | Unique row identifier |
| `UNIQUE (floor_id, unit_number)` | Composite Unique | No duplicate unit numbers on the same floor |
| `UNIQUE (society_id, display_label)` | Composite Unique | Display label unique within a society |
| `CHECK (unit_number >= 1 AND <= 99)` | Check | Caps at 99 units per floor |
| `FK floor_id → floors(id) RESTRICT` | FK | Prevents deleting floors with units |
| `FK block_id → blocks(id) RESTRICT` | FK | Referential integrity for denormalized block_id |
| `FK society_id → societies(id) RESTRICT` | FK | Referential integrity for denormalized society_id |

---

### Design Decisions & Trade-offs

**Why are `block_name` and `floor_number` duplicated on the `units` row?**
MySQL `GENERATED` columns (both `VIRTUAL` and `STORED`) cannot use subqueries or reference other tables.
To have MySQL auto-compute `display_label` from `block_name`, `floor_number`, and `unit_number`,
those values must be columns on the same row. This is intentional denormalization.
The values rarely change in practice (a block rename or floor renumber is an admin-only edge case),
so the risk of inconsistency is low. If needed, a DB trigger or application-level update propagates
changes to all affected units.

**Why `STORED` and not `VIRTUAL` for `display_label`?**
`VIRTUAL` computed columns exist only at query time — they are recalculated on every read.
`STORED` writes the value to disk on insert/update, making it indexable (e.g. the `UNIQUE KEY` on
`display_label` requires it to be `STORED`) and fast to read without recomputation.

**Why cap `unit_number` at 99?**
The display label format — `A-101` — encodes floor number directly before the 2-digit unit number.
Unit `100` would become `A-1100`, which is ambiguous (floor 11, unit 00? or floor 1, unit 100?).
Capping at 99 and always padding to 2 digits (`LPAD(unit_number, 2, '0')`) keeps the label
unambiguous and consistent. 99 apartments per floor is far beyond any realistic housing society floor.

**Why `metadata JSON NULL` on `units` but not `blocks` or `floors`?**
Units have genuinely variable, optional attributes — parking slots, furnishing state, balcony,
water connection type — that differ per unit and don't all need dedicated columns.
Blocks and floors are pure structural nodes (a name, a number) with no such variable metadata.
Adding JSON to them would be unused complexity. `societies` gets a `metadata` column too
for society-level optional extras (logo URL, website, contact info).
