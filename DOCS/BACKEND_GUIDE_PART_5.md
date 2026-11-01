# Sahayak — Backend Implementation Guide Part 5 (Phase 2C: Announcements & Digital Notice Board)

> **For Backend Developer (Purvi)**:
> This guide provides the complete, production-ready implementation specifications for the
> **Announcements & Digital Notice Board** module — a flexible, targeted broadcast system that
> allows the secretary to send notices to society-wide audiences, specific blocks, specific floors,
> specific units, or even individual residents. Every announcement has a mandatory expiry date and
> a full read-receipt tracking system.
>
> **Prerequisites & Database Status**:
> - Existing tables: `users`, `societies`, `blocks`, `floors`, `units`, `complaints`, `complaint_replies`.
> - Schema references: [USER_DB.md](./USER_DB.md), [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md), [COMPLAINTS_DB.md](./COMPLAINTS_DB.md).
> - Existing guides: [BACKEND_GUIDE_PART_3.md](./BACKEND_GUIDE_PART_3.md) (Complaints), [BACKEND_GUIDE_PART_4.md](./BACKEND_GUIDE_PART_4.md) (Skipped — Razorpay, post-exam).

---

## Table of Contents

1. [Announcement System Design Overview](#1-announcement-system-design-overview)
   - [1.1 What Are Announcements?](#11-what-are-announcements)
   - [1.2 Targeting Model — Who Gets What](#12-targeting-model--who-gets-what)
   - [1.3 Lifecycle — Active to Expired (Never Auto-Deleted)](#13-lifecycle--active-to-expired-never-auto-deleted)
   - [1.4 Read Receipts — How They Work](#14-read-receipts--how-they-work)
   - [1.5 What the Secretary Can and Cannot Do](#15-what-the-secretary-can-and-cannot-do)
2. [Database Schema Design](#2-database-schema-design)
   - [2.1 Design Rationale](#21-design-rationale)
   - [2.2 Table 1: `announcements`](#22-table-1-announcements)
   - [2.3 Table 2: `announcement_reads`](#23-table-2-announcement_reads)
   - [2.4 Complete Copy-Paste MySQL DDL Script](#24-complete-copy-paste-mysql-ddl-script)
   - [2.5 Targeting Resolution — How the Query Engine Works](#25-targeting-resolution--how-the-query-engine-works)
3. [Quick Reference — All API Endpoints](#3-quick-reference--all-api-endpoints)
4. [Section A: Secretary Announcement APIs](#4-section-a-secretary-announcement-apis)
   - [API 1: Create Announcement](#api-1-create-announcement)
   - [API 2: List All Announcements with filters](#api-2-list-all-announcements-with-filters)
   - [API 3: Get Single Announcement Details + Read Stats](#api-3-get-single-announcement-details--read-stats)
   - [API 4: Delete Single Announcement](#api-4-delete-single-announcement)
   - [API 5: Delete All Expired Announcements Bulk](#api-5-delete-all-expired-announcements-bulk)
5. [Section B: Resident Announcement APIs](#5-section-b-resident-announcement-apis)
   - [API 6: Get My Announcements Targeted Feed](#api-6-get-my-announcements-targeted-feed)
   - [API 7: Mark Announcement as Read](#api-7-mark-announcement-as-read)
   - [API 8: Get Single Announcement Resident View](#api-8-get-single-announcement-resident-view)
6. [Complete Code Files for Implementation](#6-complete-code-files-for-implementation)
   - [6.1 announcements.service.js](#61-announcementsservicejs)
   - [6.2 announcements.controller.js](#62-announcementscontrollerjs)
   - [6.3 announcements.routes.js](#63-announcementsroutesjs)
   - [6.4 Update to app.js](#64-update-to-appjs)
7. [Edge Cases & Testing Checklist](#7-edge-cases--testing-checklist)
8. [Design Decisions Log](#8-design-decisions-log)

---

## 1. Announcement System Design Overview

### 1.1 What Are Announcements?

Announcements are official notices created by the **secretary** and pushed to one or more
residents in their society. Unlike complaints (which are resident to secretary), announcements
flow **secretary to residents**.

Real-world use cases:
- *"Water supply will be shut off on Sunday 10 AM to 2 PM for pipeline repair."* (Block B only)
- *"Society AGM meeting is on 15th November at 6 PM in the community hall."* (All residents)
- *"Reminder: Parking stickers must be renewed by 30th Nov."* (All residents)
- *"Unit 304, please clear the corridor obstruction within 48 hours."* (Single unit)
- *"All owners: Share certificate copies are required by Dec 1."* (Owner role only)

---

### 1.2 Targeting Model — Who Gets What

The system supports **6 targeting scopes**, controlled by the `target_type` + `target_id` pair:

| `target_type` | `target_id` | Who Sees the Announcement |
|---|---|---|
| `all` | `NULL` | Every active resident in the society |
| `block` | `block_id` (INT) | All residents in any unit inside that block |
| `floor` | `floor_id` (INT) | All residents in any unit on that floor |
| `unit` | `unit_id` (INT) | Only the resident(s) assigned to that specific unit |
| `user` | `user_id` (INT) | One specific individual resident — targeted DM-style |
| `role` | `NULL` (role in `target_role` column) | All residents with a specific occupant role (`owner`/`tenant`) |

> **Security rule**: `target_id` is always validated to belong to `society_id`. A secretary cannot
> target a block or floor that belongs to a different society.

---

### 1.3 Lifecycle — Active to Expired (Never Auto-Deleted)

Every announcement **must** have an `expires_at` datetime set during creation.

```
Secretary Creates Announcement
        |
        v
   [ ACTIVE ]   <- NOW() < expires_at
   Visible in resident feed, "Active Announcements" in secretary dashboard
        |
        |  Time passes, expires_at is reached
        v
   [ EXPIRED ]  <- NOW() >= expires_at
   Moved to "Expired / Archived" tab in secretary dashboard
   Still visible to residents via direct link, but
   NOT shown in the main resident feed by default
        |
        |  Secretary explicitly deletes it (manually or via bulk delete)
        v
   [ DELETED ]  <- Permanent soft-delete via is_deleted flag
   Invisible everywhere, data retained for audit
```

**Key Rule**: Announcements are **never automatically hard-deleted**. Expired ones move to an
archived section. The secretary can:
- Manually delete any single announcement (active or expired).
- Bulk-delete all expired announcements with one API call.

---

### 1.4 Read Receipts — How They Work

The `announcement_reads` table is a simple join table. When a resident opens/views an announcement,
the frontend calls `POST /api/v1/announcements/:id/read`. This inserts a row with `resident_id`
and `announcement_id` and the timestamp.

**For the Secretary**:
- On `GET /api/v1/announcements/:id`, the response includes `read_count` (how many
  targeted residents have read it) and `total_targeted` (how many residents should have seen it).
- This gives a "12/45 residents read" style metric.

**Idempotency**: If a resident calls the read endpoint twice, the second call is silently ignored
via `INSERT IGNORE` — the first read timestamp is the one that counts.

---

### 1.5 What the Secretary Can and Cannot Do

| Action | Allowed? | Notes |
|---|---|---|
| Create any type of announcement | YES | All 6 `target_type` scopes |
| View all announcements (active + expired) | YES | With filters |
| View read stats per announcement | YES | Count of readers vs targeted |
| Delete any single announcement | YES | Active or expired |
| Bulk delete all expired announcements | YES | One-click cleanup |
| **Edit an existing announcement** | NO | Announcements are immutable after creation |
| Archive/unpublish an announcement | NO | Expiry handles this automatically |

> **Why no edit?** — An announcement is an official society notice. Residents who already read it
> would have seen different content than late readers. Immutability preserves integrity.
> The correct workflow: delete the old one and post a new corrected one.

---

## 2. Database Schema Design

### 2.1 Design Rationale

**Why 2 tables and not 1?**

`announcements` stores the announcement itself. `announcement_reads` stores who has read what.
These are fundamentally different entities and must be separate for normalization and query
performance. Storing read receipts as a JSON array inside `announcements` would make read-count
queries and "have I read this?" checks extremely inefficient at scale.

**Why `target_type` + `target_id` + `target_role` instead of separate columns?**

A single polymorphic targeting approach is cleaner than having 5 separate nullable columns
(`block_id`, `floor_id`, `unit_id`, `user_id`, `role`). Only one targeting dimension is ever
active. The `target_type` ENUM makes the active dimension explicit and allows a simple switch
statement to resolve the correct SQL JOIN for fetching targeted residents.

---

### 2.2 Table 1: `announcements`

```sql
CREATE TABLE announcements (
    id              INT             NOT NULL AUTO_INCREMENT,
    society_id      INT             NOT NULL,
    created_by      INT             NOT NULL,

    -- Content
    title           VARCHAR(200)    NOT NULL,
    content         TEXT            NOT NULL,

    -- Classification
    category        ENUM(
                      'general',
                      'maintenance',
                      'security',
                      'event',
                      'emergency',
                      'financial'
                    )               NOT NULL DEFAULT 'general',

    priority        ENUM(
                      'low',
                      'normal',
                      'urgent'
                    )               NOT NULL DEFAULT 'normal',

    -- Targeting
    target_type     ENUM(
                      'all',
                      'block',
                      'floor',
                      'unit',
                      'user',
                      'role'
                    )               NOT NULL DEFAULT 'all',

    target_id       INT             NULL,
    -- 'all'   -> NULL
    -- 'block' -> blocks.id
    -- 'floor' -> floors.id
    -- 'unit'  -> units.id
    -- 'user'  -> users.id
    -- 'role'  -> NULL (target_role column used instead)

    target_role     ENUM(
                      'owner',
                      'tenant'
                    )               NULL,
    -- Only populated when target_type = 'role'

    -- Lifecycle
    expires_at      DATETIME        NOT NULL,
    is_deleted      BOOLEAN         NOT NULL DEFAULT FALSE,
    deleted_at      DATETIME        NULL,

    -- Timestamps
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    INDEX idx_ann_society          (society_id),
    INDEX idx_ann_society_active   (society_id, is_deleted, expires_at),
    INDEX idx_ann_target           (society_id, target_type, target_id),
    INDEX idx_ann_created_by       (created_by),

    CONSTRAINT fk_ann_society
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,

    CONSTRAINT fk_ann_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,

    CONSTRAINT chk_ann_target_id
        CHECK (
            (target_type IN ('all', 'role') AND target_id IS NULL)
            OR (target_type IN ('block', 'floor', 'unit', 'user') AND target_id IS NOT NULL)
        ),

    CONSTRAINT chk_ann_target_role
        CHECK (
            (target_type = 'role' AND target_role IS NOT NULL)
            OR (target_type != 'role' AND target_role IS NULL)
        )
);
```

**Column-by-Column Explanation:**

| Column | Type | Purpose |
|---|---|---|
| `id` | INT AUTO_INCREMENT PK | Unique announcement identifier |
| `society_id` | INT NOT NULL FK | Society isolation — every query filters by this |
| `created_by` | INT NOT NULL FK | Secretary who created it — for ownership and audit |
| `title` | VARCHAR(200) NOT NULL | Short headline |
| `content` | TEXT NOT NULL | Full body of the announcement |
| `category` | ENUM | Classification for filtering |
| `priority` | ENUM | `low` / `normal` / `urgent` — frontend uses for visual styling |
| `target_type` | ENUM | The targeting dimension — controls who can see this announcement |
| `target_id` | INT NULL | The FK value for block/floor/unit/user — `NULL` for `all` and `role` |
| `target_role` | ENUM NULL | `owner` or `tenant` — only set when `target_type = 'role'` |
| `expires_at` | DATETIME NOT NULL | When the announcement stops being active |
| `is_deleted` | BOOLEAN DEFAULT FALSE | Soft-delete flag — deleted rows are never shown |
| `deleted_at` | DATETIME NULL | Timestamp when it was soft-deleted |

---

### 2.3 Table 2: `announcement_reads`

```sql
CREATE TABLE announcement_reads (
    id              INT             NOT NULL AUTO_INCREMENT,
    announcement_id INT             NOT NULL,
    resident_id     INT             NOT NULL,
    read_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- One resident can mark one announcement as read only once
    UNIQUE KEY uq_reads_ann_resident (announcement_id, resident_id),

    INDEX idx_reads_announcement    (announcement_id),
    INDEX idx_reads_resident        (resident_id),

    CONSTRAINT fk_reads_announcement
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,

    CONSTRAINT fk_reads_resident
        FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Why `ON DELETE CASCADE` on both FKs?**
- If an announcement is ever hard-deleted, orphan read records are meaningless.
- If a resident is deleted from the system, their read receipts clean up automatically.

**Why `UNIQUE KEY uq_reads_ann_resident`?**
- Enforces idempotency at the DB level. `INSERT IGNORE` silently skips duplicates.

---

### 2.4 Complete Copy-Paste MySQL DDL Script

Run this against the AlwaysData MySQL database to create both tables:

```sql
-- ============================================================
-- Sahayak Phase 2C: Announcements Module
-- Run once on the production database.
-- ============================================================

CREATE TABLE IF NOT EXISTS announcements (
    id              INT             NOT NULL AUTO_INCREMENT,
    society_id      INT             NOT NULL,
    created_by      INT             NOT NULL,
    title           VARCHAR(200)    NOT NULL,
    content         TEXT            NOT NULL,
    category        ENUM('general','maintenance','security','event','emergency','financial')
                                    NOT NULL DEFAULT 'general',
    priority        ENUM('low','normal','urgent')
                                    NOT NULL DEFAULT 'normal',
    target_type     ENUM('all','block','floor','unit','user','role')
                                    NOT NULL DEFAULT 'all',
    target_id       INT             NULL,
    target_role     ENUM('owner','tenant')
                                    NULL,
    expires_at      DATETIME        NOT NULL,
    is_deleted      BOOLEAN         NOT NULL DEFAULT FALSE,
    deleted_at      DATETIME        NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_ann_society          (society_id),
    INDEX idx_ann_society_active   (society_id, is_deleted, expires_at),
    INDEX idx_ann_target           (society_id, target_type, target_id),
    INDEX idx_ann_created_by       (created_by),

    CONSTRAINT fk_ann_society
        FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE CASCADE,
    CONSTRAINT fk_ann_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_ann_target_id
        CHECK (
            (target_type IN ('all', 'role') AND target_id IS NULL)
            OR (target_type IN ('block', 'floor', 'unit', 'user') AND target_id IS NOT NULL)
        ),
    CONSTRAINT chk_ann_target_role
        CHECK (
            (target_type = 'role' AND target_role IS NOT NULL)
            OR (target_type != 'role' AND target_role IS NULL)
        )
);

CREATE TABLE IF NOT EXISTS announcement_reads (
    id              INT             NOT NULL AUTO_INCREMENT,
    announcement_id INT             NOT NULL,
    resident_id     INT             NOT NULL,
    read_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reads_ann_resident (announcement_id, resident_id),
    INDEX idx_reads_announcement     (announcement_id),
    INDEX idx_reads_resident         (resident_id),

    CONSTRAINT fk_reads_announcement
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
    CONSTRAINT fk_reads_resident
        FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

### 2.5 Targeting Resolution — How the Query Engine Works

When a resident fetches their announcement feed, the backend must figure out which announcements
are "meant for them". A resident's profile has: `society_id`, `unit_id`, `block_id` (via join),
`floor_id` (via join), and `occupant_type` (owner/tenant).

The targeting resolution SQL uses a **single OR chain**:

```sql
SELECT a.*
FROM announcements a
WHERE
    a.society_id = :society_id
    AND a.is_deleted = FALSE
    AND a.expires_at > NOW()
    AND (
        a.target_type = 'all'

        OR (a.target_type = 'block'
            AND a.target_id = :resident_block_id)

        OR (a.target_type = 'floor'
            AND a.target_id = :resident_floor_id)

        OR (a.target_type = 'unit'
            AND a.target_id = :resident_unit_id)

        OR (a.target_type = 'user'
            AND a.target_id = :resident_user_id)

        OR (a.target_type = 'role'
            AND a.target_role = :resident_occupant_type)
    )
ORDER BY FIELD(a.priority, 'urgent', 'normal', 'low'), a.created_at DESC
```

This query runs efficiently per resident because all filtering columns are indexed.

---

## 3. Quick Reference — All API Endpoints

### Section A: Secretary APIs
| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| **1** | `POST` | `/api/v1/announcements` | `secretary` | Create a new announcement |
| **2** | `GET` | `/api/v1/announcements` | `secretary` | List all announcements (active + expired) with filters |
| **3** | `GET` | `/api/v1/announcements/:id` | `secretary` | Get announcement details + read receipt stats |
| **4** | `DELETE` | `/api/v1/announcements/:id` | `secretary` | Soft-delete a single announcement |
| **5** | `DELETE` | `/api/v1/announcements/expired` | `secretary` | Bulk soft-delete all expired announcements |

### Section B: Resident APIs
| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| **6** | `GET` | `/api/v1/announcements/my` | `resident` | Get my targeted announcement feed (active only) |
| **7** | `POST` | `/api/v1/announcements/:id/read` | `resident` | Mark an announcement as read (idempotent) |
| **8** | `GET` | `/api/v1/announcements/:id` | `resident` | View a single announcement (checks targeting) |

> **CRITICAL Express Route Order**: Register `/expired` and `/my` **BEFORE** `/:id` in the router,
> otherwise Express treats the strings "expired" and "my" as ID values routing to the wrong handler.

---

## 4. Section A: Secretary Announcement APIs

---

### API 1: Create Announcement

**Method & URL**: `POST /api/v1/announcements`
**Auth**: `secretary` role required

**Request Body**:
```json
{
  "title": "Water Supply Shutdown — Block B",
  "content": "Water supply will be shut off on Sunday 10 Nov from 10 AM to 2 PM for pipeline repair.",
  "category": "maintenance",
  "priority": "urgent",
  "target_type": "block",
  "target_id": 3,
  "expires_at": "2024-11-10T23:59:59"
}
```

**Field Validation Rules**:

| Field | Required | Rules |
|---|---|---|
| `title` | YES | String, 5–200 characters |
| `content` | YES | String, 10–5000 characters |
| `category` | YES | One of: `general`, `maintenance`, `security`, `event`, `emergency`, `financial` |
| `priority` | Optional | One of: `low`, `normal`, `urgent`. Defaults to `normal` |
| `target_type` | YES | One of: `all`, `block`, `floor`, `unit`, `user`, `role` |
| `target_id` | Conditional | Required (positive INT) when `target_type` is `block`, `floor`, `unit`, or `user`. Must be null/absent when `target_type` is `all` or `role` |
| `target_role` | Conditional | Required when `target_type = 'role'`. One of: `owner`, `tenant` |
| `expires_at` | YES | ISO 8601 datetime string. Must be strictly in the future |

**Additional Service-Layer Validations**:
- `block` target_type: verify `target_id` (block_id) belongs to `society_id`.
- `floor` target_type: verify `target_id` (floor_id) belongs to `society_id`.
- `unit` target_type: verify `target_id` (unit_id) belongs to `society_id`.
- `user` target_type: verify `target_id` (user_id) is an **active resident** in `society_id`.
- `expires_at` must be strictly in the future.

**Success Response** `201 Created`:
```json
{
  "success": true,
  "message": "Announcement created successfully.",
  "data": {
    "id": 42,
    "title": "Water Supply Shutdown — Block B",
    "category": "maintenance",
    "priority": "urgent",
    "target_type": "block",
    "target_id": 3,
    "target_label": "Block B",
    "expires_at": "2024-11-10T23:59:59.000Z",
    "created_at": "2024-11-08T14:32:00.000Z"
  }
}
```

> `target_label` is a human-readable display string computed by the service (joins to blocks/floors/units/users).

**Error Responses**:
| Status | Scenario |
|---|---|
| `400` | Any validation failure (missing field, wrong type, past expiry, targeting cross-constraint) |
| `404` | `target_id` does not exist or does not belong to this society |
| `403` | Caller is not a secretary |

---

### API 2: List All Announcements with filters

**Method & URL**: `GET /api/v1/announcements`
**Auth**: `secretary` role required

**Query Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `status` | string | `active` (default), `expired`, or `all` |
| `category` | string | Filter by category |
| `priority` | string | Filter by priority: `low`, `normal`, `urgent` |
| `target_type` | string | Filter by targeting scope |
| `page` | int | Page number (default: `1`) |
| `limit` | int | Results per page (default: `20`, max: `100`) |

**Success Response** `200 OK`:
```json
{
  "success": true,
  "message": "Announcements retrieved successfully.",
  "data": {
    "summary": {
      "total_active": 5,
      "total_expired": 12,
      "total_all": 17
    },
    "announcements": [
      {
        "id": 42,
        "title": "Water Supply Shutdown — Block B",
        "category": "maintenance",
        "priority": "urgent",
        "target_type": "block",
        "target_id": 3,
        "expires_at": "2024-11-10T23:59:59.000Z",
        "is_active": true,
        "read_count": 8,
        "created_at": "2024-11-08T14:32:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "total_pages": 1
    }
  }
}
```

---

### API 3: Get Single Announcement Details + Read Stats

**Method & URL**: `GET /api/v1/announcements/:id`
**Auth**: `secretary` or `resident` (shared endpoint — response differs by role)

**Secretary Response** `200 OK`:
```json
{
  "success": true,
  "message": "Announcement retrieved.",
  "data": {
    "id": 42,
    "title": "Water Supply Shutdown — Block B",
    "content": "Water supply will be shut off on Sunday 10 Nov from 10 AM to 2 PM...",
    "category": "maintenance",
    "priority": "urgent",
    "target_type": "block",
    "target_id": 3,
    "expires_at": "2024-11-10T23:59:59.000Z",
    "is_active": true,
    "created_at": "2024-11-08T14:32:00.000Z",
    "read_stats": {
      "total_targeted": 45,
      "read_count": 12,
      "read_percentage": 26.67,
      "unread_count": 33
    },
    "readers": [
      {
        "resident_id": 101,
        "resident_name": "Priya Sharma",
        "unit_label": "B-201",
        "read_at": "2024-11-08T15:10:00.000Z"
      }
    ]
  }
}
```

**Resident Response** `200 OK` (reduced data, no read stats):
```json
{
  "success": true,
  "message": "Announcement retrieved.",
  "data": {
    "id": 42,
    "title": "Water Supply Shutdown — Block B",
    "content": "Water supply will be shut off on Sunday 10 Nov from 10 AM to 2 PM...",
    "category": "maintenance",
    "priority": "urgent",
    "expires_at": "2024-11-10T23:59:59.000Z",
    "is_active": true,
    "is_read": true,
    "read_at": "2024-11-08T15:10:00.000Z",
    "created_at": "2024-11-08T14:32:00.000Z"
  }
}
```

**Error Responses**:
| Status | Scenario |
|---|---|
| `404` | Announcement does not exist, is deleted, or doesn't belong to this society |
| `403` | Resident trying to access an announcement not targeted at them |

---

### API 4: Delete Single Announcement

**Method & URL**: `DELETE /api/v1/announcements/:id`
**Auth**: `secretary` role required

**Business Rules**:
- Can delete **any** announcement regardless of status (active or expired).
- Implements **soft delete**: sets `is_deleted = TRUE` and `deleted_at = NOW()`.
- After soft-delete, disappears from both secretary's list and all resident feeds.
- `announcement_reads` rows are NOT deleted (retained as historical records).

**Success Response** `200 OK`:
```json
{
  "success": true,
  "message": "Announcement deleted successfully.",
  "data": {
    "id": 42,
    "deleted_at": "2024-11-08T16:00:00.000Z"
  }
}
```

**Error Responses**:
| Status | Scenario |
|---|---|
| `404` | Announcement not found, already deleted, or belongs to a different society |

---

### API 5: Delete All Expired Announcements Bulk

**Method & URL**: `DELETE /api/v1/announcements/expired`
**Auth**: `secretary` role required

> WARNING — Express Route Registration Order: This route (`/expired`) MUST be registered
> BEFORE `/:id` in the router file, otherwise Express will treat "expired" as an ID value.

**Business Rules**:
- Soft-deletes all announcements where: `society_id = secretary's society_id`, `is_deleted = FALSE`, `expires_at <= NOW()`.
- Returns how many were deleted. No request body needed.

**Success Response** `200 OK`:
```json
{
  "success": true,
  "message": "All expired announcements deleted successfully.",
  "data": {
    "deleted_count": 12
  }
}
```

**Edge Case**: If 0 expired announcements exist, `deleted_count = 0` with HTTP `200`.

---

## 5. Section B: Resident Announcement APIs

---

### API 6: Get My Announcements Targeted Feed

**Method & URL**: `GET /api/v1/announcements/my`
**Auth**: `resident` role required

> WARNING — Express Route Registration Order: This route (`/my`) MUST be registered BEFORE `/:id`.

**How It Works**:
1. Middleware populates `req.user` with `{ userId, societyId, unitId }`.
2. Service resolves `blockId` and `floorId` from `unitId` via a JOIN on `units -> floors -> blocks`.
3. Service resolves `occupantType` from the `units.occupant_type` column.
4. Runs the targeting resolution query with `is_deleted = FALSE AND expires_at > NOW()`.
5. LEFT JOINs on `announcement_reads` to determine `is_read` per announcement.

**Query Parameters**:

| Parameter | Type | Description |
|---|---|---|
| `include_expired` | boolean | `false` (default). `true` includes expired ones in an `archived` array |
| `category` | string | Filter by category |
| `page` | int | Default: `1` |
| `limit` | int | Default: `20`, max: `50` |

**Success Response** `200 OK`:
```json
{
  "success": true,
  "message": "Announcements fetched successfully.",
  "data": {
    "active": [
      {
        "id": 42,
        "title": "Water Supply Shutdown — Block B",
        "category": "maintenance",
        "priority": "urgent",
        "expires_at": "2024-11-10T23:59:59.000Z",
        "is_read": false,
        "read_at": null,
        "created_at": "2024-11-08T14:32:00.000Z"
      },
      {
        "id": 38,
        "title": "Society AGM — 15th November",
        "category": "event",
        "priority": "normal",
        "expires_at": "2024-11-15T18:00:00.000Z",
        "is_read": true,
        "read_at": "2024-11-08T09:30:00.000Z",
        "created_at": "2024-11-07T11:00:00.000Z"
      }
    ],
    "unread_count": 1,
    "pagination": { "page": 1, "limit": 20, "total": 2, "total_pages": 1 }
  }
}
```

> `unread_count` at the top level is the key data for the frontend notification badge (red dot on bell icon).

---

### API 7: Mark Announcement as Read

**Method & URL**: `POST /api/v1/announcements/:id/read`
**Auth**: `resident` role required. No request body.

**Business Rules**:
1. Verify announcement exists, is not deleted, and belongs to `society_id`.
2. Verify the announcement is actually targeted at this resident (prevents fake read receipts).
3. `INSERT IGNORE INTO announcement_reads` — idempotent.
4. Return existing `read_at` if already read, or new timestamp if first read.

**Success Response** `200 OK`:
```json
{
  "success": true,
  "message": "Announcement marked as read.",
  "data": {
    "announcement_id": 42,
    "resident_id": 101,
    "read_at": "2024-11-08T15:10:00.000Z",
    "already_read": false
  }
}
```

**Error Responses**:
| Status | Scenario |
|---|---|
| `404` | Announcement not found or deleted |
| `403` | Announcement is not targeted at this resident |

---

### API 8: Get Single Announcement Resident View

Same endpoint as API 3 (`GET /api/v1/announcements/:id`). The controller checks `req.user.role`
and returns either the secretary view (with read stats) or the resident view (with personal `is_read`).

**Additional Resident-Specific Logic**:
- Verify the announcement is targeted at the calling resident. If not: `403 Forbidden`.
- Expired announcements: residents **can** still view expired announcements by direct ID
  (they just won't appear in the default `/my` feed). This prevents dead notification links.

---

## 6. Complete Code Files for Implementation

### 6.1 announcements.service.js

Create `src/modules/announcements/announcements.service.js`:

```javascript
import { pool } from '../../config/db.js';

const ALLOWED_CATEGORIES = ['general', 'maintenance', 'security', 'event', 'emergency', 'financial'];
const ALLOWED_PRIORITIES = ['low', 'normal', 'urgent'];
const ALLOWED_TARGET_TYPES = ['all', 'block', 'floor', 'unit', 'user', 'role'];
const ALLOWED_ROLES = ['owner', 'tenant'];

const _validateAndResolveTarget = async (conn, societyId, targetType, targetId, targetRole) => {
  if (targetType === 'all') return { valid: true, label: 'All Residents' };

  if (targetType === 'role') {
    if (!ALLOWED_ROLES.includes(targetRole)) {
      throw { status: 400, message: "target_role must be 'owner' or 'tenant' when target_type is 'role'." };
    }
    return { valid: true, label: `All ${targetRole.charAt(0).toUpperCase() + targetRole.slice(1)}s` };
  }

  if (!targetId || !Number.isInteger(Number(targetId)) || Number(targetId) <= 0) {
    throw { status: 400, message: `target_id is required as a positive integer for target_type '${targetType}'.` };
  }

  const id = Number(targetId);

  if (targetType === 'block') {
    const [rows] = await conn.execute(
      'SELECT id, name FROM blocks WHERE id = ? AND society_id = ?', [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Block id ${id} not found in this society.` };
    return { valid: true, label: `Block ${rows[0].name}` };
  }

  if (targetType === 'floor') {
    const [rows] = await conn.execute(
      `SELECT f.floor_number, b.name AS block_name
       FROM floors f JOIN blocks b ON b.id = f.block_id
       WHERE f.id = ? AND b.society_id = ?`, [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Floor id ${id} not found in this society.` };
    return { valid: true, label: `Block ${rows[0].block_name} - Floor ${rows[0].floor_number}` };
  }

  if (targetType === 'unit') {
    const [rows] = await conn.execute(
      `SELECT u.unit_number, b.name AS block_name
       FROM units u JOIN floors fl ON fl.id = u.floor_id JOIN blocks b ON b.id = fl.block_id
       WHERE u.id = ? AND b.society_id = ?`, [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Unit id ${id} not found in this society.` };
    return { valid: true, label: `Unit ${rows[0].block_name}-${rows[0].unit_number}` };
  }

  if (targetType === 'user') {
    const [rows] = await conn.execute(
      "SELECT id, name FROM users WHERE id = ? AND society_id = ? AND role = 'resident' AND status = 'active'",
      [id, societyId]
    );
    if (!rows.length) throw { status: 404, message: `Active resident id ${id} not found in this society.` };
    return { valid: true, label: `${rows[0].name} (Personal)` };
  }

  throw { status: 400, message: `Unknown target_type: ${targetType}` };
};

const _getResidentContext = async (conn, unitId) => {
  if (!unitId) return { blockId: null, floorId: null, occupantType: null };
  const [rows] = await conn.execute(
    'SELECT u.floor_id, u.occupant_type, fl.block_id FROM units u JOIN floors fl ON fl.id = u.floor_id WHERE u.id = ?',
    [unitId]
  );
  if (!rows.length) return { blockId: null, floorId: null, occupantType: null };
  return { blockId: rows[0].block_id, floorId: rows[0].floor_id, occupantType: rows[0].occupant_type };
};

const _buildTargetingClause = (userId, unitId, blockId, floorId, occupantType) => ({
  sql: `(
    a.target_type = 'all'
    OR (a.target_type = 'block' AND a.target_id = ?)
    OR (a.target_type = 'floor' AND a.target_id = ?)
    OR (a.target_type = 'unit'  AND a.target_id = ?)
    OR (a.target_type = 'user'  AND a.target_id = ?)
    OR (a.target_type = 'role'  AND a.target_role = ?)
  )`,
  params: [blockId, floorId, unitId, userId, occupantType],
});

export const createAnnouncement = async (societyId, createdBy, payload) => {
  const { title, content, category, priority = 'normal', target_type, target_id = null, target_role = null, expires_at } = payload;

  if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200)
    throw { status: 400, message: 'Title is required (5-200 characters).' };
  if (!content || typeof content !== 'string' || content.trim().length < 10 || content.trim().length > 5000)
    throw { status: 400, message: 'Content is required (10-5000 characters).' };
  if (!ALLOWED_CATEGORIES.includes(category))
    throw { status: 400, message: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}.` };
  if (!ALLOWED_PRIORITIES.includes(priority))
    throw { status: 400, message: `Invalid priority. Must be one of: ${ALLOWED_PRIORITIES.join(', ')}.` };
  if (!ALLOWED_TARGET_TYPES.includes(target_type))
    throw { status: 400, message: `Invalid target_type. Must be one of: ${ALLOWED_TARGET_TYPES.join(', ')}.` };
  if (!expires_at) throw { status: 400, message: 'expires_at is required.' };

  const expiryDate = new Date(expires_at);
  if (isNaN(expiryDate.getTime())) throw { status: 400, message: 'expires_at must be a valid ISO 8601 datetime.' };
  if (expiryDate <= new Date()) throw { status: 400, message: 'expires_at must be in the future.' };

  if (['all', 'role'].includes(target_type) && target_id != null)
    throw { status: 400, message: `target_id must not be provided when target_type is '${target_type}'.` };
  if (['block', 'floor', 'unit', 'user'].includes(target_type) && target_role != null)
    throw { status: 400, message: `target_role must not be provided when target_type is '${target_type}'.` };

  const conn = await pool.getConnection();
  try {
    const { label: targetLabel } = await _validateAndResolveTarget(conn, societyId, target_type, target_id, target_role);
    const [result] = await conn.execute(
      `INSERT INTO announcements (society_id, created_by, title, content, category, priority, target_type, target_id, target_role, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [societyId, createdBy, title.trim(), content.trim(), category, priority, target_type, target_id || null, target_role || null, expiryDate]
    );
    return { id: result.insertId, title: title.trim(), category, priority, target_type, target_id: target_id || null, target_role: target_role || null, target_label: targetLabel, expires_at: expiryDate, created_at: new Date() };
  } finally {
    conn.release();
  }
};

export const listAnnouncements = async (societyId, query) => {
  const { status = 'active', category, priority, target_type, page = 1, limit = 20 } = query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = ['a.society_id = ?', 'a.is_deleted = FALSE'];
  const params = [societyId];

  if (status === 'active') conditions.push('a.expires_at > NOW()');
  else if (status === 'expired') conditions.push('a.expires_at <= NOW()');

  if (category && ALLOWED_CATEGORIES.includes(category)) { conditions.push('a.category = ?'); params.push(category); }
  if (priority && ALLOWED_PRIORITIES.includes(priority)) { conditions.push('a.priority = ?'); params.push(priority); }
  if (target_type && ALLOWED_TARGET_TYPES.includes(target_type)) { conditions.push('a.target_type = ?'); params.push(target_type); }

  const whereClause = conditions.join(' AND ');
  const [rows] = await pool.execute(
    `SELECT a.id, a.title, a.category, a.priority, a.target_type, a.target_id, a.target_role,
            a.expires_at, a.created_at, (a.expires_at > NOW()) AS is_active,
            (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) AS read_count
     FROM announcements a WHERE ${whereClause} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limitNum, offset]
  );

  const [[counts]] = await pool.execute(
    'SELECT SUM(expires_at > NOW()) AS total_active, SUM(expires_at <= NOW()) AS total_expired, COUNT(*) AS total_all FROM announcements WHERE society_id = ? AND is_deleted = FALSE',
    [societyId]
  );
  const [[{ total_count }]] = await pool.execute(`SELECT COUNT(*) AS total_count FROM announcements a WHERE ${whereClause}`, params);

  return {
    summary: { total_active: Number(counts.total_active || 0), total_expired: Number(counts.total_expired || 0), total_all: Number(counts.total_all || 0) },
    announcements: rows.map(r => ({ ...r, is_active: Boolean(r.is_active), read_count: Number(r.read_count) })),
    pagination: { page: pageNum, limit: limitNum, total: Number(total_count), total_pages: Math.ceil(Number(total_count) / limitNum) },
  };
};

export const getAnnouncementByIdSecretary = async (societyId, announcementId) => {
  const [[ann]] = await pool.execute(
    'SELECT a.*, (a.expires_at > NOW()) AS is_active FROM announcements a WHERE a.id = ? AND a.society_id = ? AND a.is_deleted = FALSE',
    [announcementId, societyId]
  );
  if (!ann) throw { status: 404, message: 'Announcement not found.' };

  let totalTargeted = 0;
  const conn = await pool.getConnection();
  try {
    const countQuery = {
      all: ['SELECT COUNT(*) AS c FROM users WHERE society_id = ? AND role = "resident" AND status = "active"', [societyId]],
      block: ['SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN units un ON un.id = u.unit_id JOIN floors fl ON fl.id = un.floor_id WHERE fl.block_id = ? AND u.society_id = ? AND u.role = "resident" AND u.status = "active"', [ann.target_id, societyId]],
      floor: ['SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN units un ON un.id = u.unit_id WHERE un.floor_id = ? AND u.society_id = ? AND u.role = "resident" AND u.status = "active"', [ann.target_id, societyId]],
      unit: ['SELECT COUNT(*) AS c FROM users WHERE unit_id = ? AND society_id = ? AND role = "resident" AND status = "active"', [ann.target_id, societyId]],
      role: ['SELECT COUNT(*) AS c FROM users u JOIN units un ON un.id = u.unit_id WHERE u.society_id = ? AND u.role = "resident" AND u.status = "active" AND un.occupant_type = ?', [societyId, ann.target_role]],
    };

    if (ann.target_type === 'user') {
      totalTargeted = 1;
    } else if (countQuery[ann.target_type]) {
      const [[r]] = await conn.execute(...countQuery[ann.target_type]);
      totalTargeted = Number(r.c);
    }

    const [[readStats]] = await conn.execute('SELECT COUNT(*) AS read_count FROM announcement_reads WHERE announcement_id = ?', [announcementId]);
    const readCount = Number(readStats.read_count);

    const [readers] = await conn.execute(
      `SELECT ar.resident_id, u.name AS resident_name, CONCAT(b.name, '-', un.unit_number) AS unit_label, ar.read_at
       FROM announcement_reads ar
       JOIN users u ON u.id = ar.resident_id
       LEFT JOIN units un ON un.id = u.unit_id
       LEFT JOIN floors fl ON fl.id = un.floor_id
       LEFT JOIN blocks b ON b.id = fl.block_id
       WHERE ar.announcement_id = ? ORDER BY ar.read_at DESC`,
      [announcementId]
    );

    return {
      ...ann,
      is_active: Boolean(ann.is_active),
      read_stats: {
        total_targeted: totalTargeted,
        read_count: readCount,
        unread_count: Math.max(0, totalTargeted - readCount),
        read_percentage: totalTargeted > 0 ? parseFloat(((readCount / totalTargeted) * 100).toFixed(2)) : 0,
      },
      readers,
    };
  } finally {
    conn.release();
  }
};

export const deleteAnnouncement = async (societyId, announcementId) => {
  const [[ann]] = await pool.execute(
    'SELECT id FROM announcements WHERE id = ? AND society_id = ? AND is_deleted = FALSE',
    [announcementId, societyId]
  );
  if (!ann) throw { status: 404, message: 'Announcement not found or already deleted.' };

  const now = new Date();
  await pool.execute('UPDATE announcements SET is_deleted = TRUE, deleted_at = ? WHERE id = ?', [now, announcementId]);
  return { id: announcementId, deleted_at: now };
};

export const deleteExpiredAnnouncements = async (societyId) => {
  const now = new Date();
  const [result] = await pool.execute(
    'UPDATE announcements SET is_deleted = TRUE, deleted_at = ? WHERE society_id = ? AND is_deleted = FALSE AND expires_at <= NOW()',
    [now, societyId]
  );
  return { deleted_count: result.affectedRows };
};

export const getMyAnnouncements = async (userId, societyId, unitId, query) => {
  const { include_expired = 'false', category, page = 1, limit = 20 } = query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conn = await pool.getConnection();
  try {
    const { blockId, floorId, occupantType } = await _getResidentContext(conn, unitId);
    const targeting = _buildTargetingClause(userId, unitId, blockId, floorId, occupantType);

    const baseConditions = ['a.society_id = ?', 'a.is_deleted = FALSE', targeting.sql];
    const baseParams = [societyId, ...targeting.params];

    if (category && ALLOWED_CATEGORIES.includes(category)) {
      baseConditions.push('a.category = ?');
      baseParams.push(category);
    }

    const [activeRows] = await conn.execute(
      `SELECT a.id, a.title, a.content, a.category, a.priority, a.expires_at, a.created_at,
              ar.read_at, (ar.id IS NOT NULL) AS is_read
       FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
       WHERE ${[...baseConditions, 'a.expires_at > NOW()'].join(' AND ')}
       ORDER BY FIELD(a.priority, 'urgent', 'normal', 'low'), a.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, ...baseParams, limitNum, offset]
    );

    const [[{ unread_count }]] = await conn.execute(
      `SELECT COUNT(*) AS unread_count FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
       WHERE ${[...baseConditions, 'a.expires_at > NOW()', 'ar.id IS NULL'].join(' AND ')}`,
      [userId, ...baseParams]
    );

    const response = {
      active: activeRows.map(r => ({ ...r, is_read: Boolean(r.is_read) })),
      unread_count: Number(unread_count),
      pagination: { page: pageNum, limit: limitNum },
    };

    if (include_expired === 'true') {
      const [expiredRows] = await conn.execute(
        `SELECT a.id, a.title, a.content, a.category, a.priority, a.expires_at, a.created_at,
                ar.read_at, (ar.id IS NOT NULL) AS is_read
         FROM announcements a
         LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
         WHERE ${[...baseConditions, 'a.expires_at <= NOW()'].join(' AND ')}
         ORDER BY a.expires_at DESC LIMIT 20`,
        [userId, ...baseParams]
      );
      response.archived = expiredRows.map(r => ({ ...r, is_read: Boolean(r.is_read) }));
    }

    return response;
  } finally {
    conn.release();
  }
};

export const markAsRead = async (userId, societyId, unitId, announcementId) => {
  const conn = await pool.getConnection();
  try {
    const [[ann]] = await conn.execute(
      'SELECT id FROM announcements WHERE id = ? AND society_id = ? AND is_deleted = FALSE',
      [announcementId, societyId]
    );
    if (!ann) throw { status: 404, message: 'Announcement not found.' };

    const { blockId, floorId, occupantType } = await _getResidentContext(conn, unitId);
    const targeting = _buildTargetingClause(userId, unitId, blockId, floorId, occupantType);

    const [[targeted]] = await conn.execute(
      `SELECT id FROM announcements a WHERE a.id = ? AND ${targeting.sql}`,
      [announcementId, ...targeting.params]
    );
    if (!targeted) throw { status: 403, message: 'This announcement is not addressed to you.' };

    const [[existingRead]] = await conn.execute(
      'SELECT read_at FROM announcement_reads WHERE announcement_id = ? AND resident_id = ?',
      [announcementId, userId]
    );
    if (existingRead) return { announcement_id: announcementId, resident_id: userId, read_at: existingRead.read_at, already_read: true };

    const now = new Date();
    await conn.execute(
      'INSERT IGNORE INTO announcement_reads (announcement_id, resident_id, read_at) VALUES (?, ?, ?)',
      [announcementId, userId, now]
    );
    return { announcement_id: announcementId, resident_id: userId, read_at: now, already_read: false };
  } finally {
    conn.release();
  }
};

export const getAnnouncementByIdResident = async (userId, societyId, unitId, announcementId) => {
  const conn = await pool.getConnection();
  try {
    const { blockId, floorId, occupantType } = await _getResidentContext(conn, unitId);
    const targeting = _buildTargetingClause(userId, unitId, blockId, floorId, occupantType);

    const [[ann]] = await conn.execute(
      `SELECT a.id, a.title, a.content, a.category, a.priority, a.expires_at, a.created_at,
              (a.expires_at > NOW()) AS is_active, ar.read_at, (ar.id IS NOT NULL) AS is_read
       FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.resident_id = ?
       WHERE a.id = ? AND a.society_id = ? AND a.is_deleted = FALSE AND ${targeting.sql}`,
      [userId, announcementId, societyId, ...targeting.params]
    );

    if (!ann) {
      const [[exists]] = await conn.execute(
        'SELECT id FROM announcements WHERE id = ? AND society_id = ? AND is_deleted = FALSE',
        [announcementId, societyId]
      );
      if (!exists) throw { status: 404, message: 'Announcement not found.' };
      throw { status: 403, message: 'This announcement is not addressed to you.' };
    }

    return { ...ann, is_active: Boolean(ann.is_active), is_read: Boolean(ann.is_read) };
  } finally {
    conn.release();
  }
};
```

---

### 6.2 announcements.controller.js

Create `src/modules/announcements/announcements.controller.js`:

```javascript
import * as announcementsService from './announcements.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const createAnnouncement = async (req, res, next) => {
  try {
    const data = await announcementsService.createAnnouncement(req.user.societyId, req.user.userId, req.body);
    return sendSuccess(res, 201, 'Announcement created successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const listAnnouncements = async (req, res, next) => {
  try {
    const data = await announcementsService.listAnnouncements(req.user.societyId, req.query);
    return sendSuccess(res, 200, 'Announcements retrieved successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const deleteExpiredAnnouncements = async (req, res, next) => {
  try {
    const data = await announcementsService.deleteExpiredAnnouncements(req.user.societyId);
    return sendSuccess(res, 200, 'All expired announcements deleted successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const getMyAnnouncements = async (req, res, next) => {
  try {
    const data = await announcementsService.getMyAnnouncements(req.user.userId, req.user.societyId, req.user.unitId, req.query);
    return sendSuccess(res, 200, 'Announcements fetched successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const getAnnouncementById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = req.user.role === 'secretary'
      ? await announcementsService.getAnnouncementByIdSecretary(req.user.societyId, id)
      : await announcementsService.getAnnouncementByIdResident(req.user.userId, req.user.societyId, req.user.unitId, id);
    return sendSuccess(res, 200, 'Announcement retrieved.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const markAsRead = async (req, res, next) => {
  try {
    const data = await announcementsService.markAsRead(req.user.userId, req.user.societyId, req.user.unitId, parseInt(req.params.id, 10));
    return sendSuccess(res, 200, 'Announcement marked as read.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};

export const deleteAnnouncement = async (req, res, next) => {
  try {
    const data = await announcementsService.deleteAnnouncement(req.user.societyId, parseInt(req.params.id, 10));
    return sendSuccess(res, 200, 'Announcement deleted successfully.', data);
  } catch (error) { if (error.status) return sendError(res, error.status, error.message); next(error); }
};
```

---

### 6.3 announcements.routes.js

Create `src/modules/announcements/announcements.routes.js`:

```javascript
import { Router } from 'express';
import * as announcementsController from './announcements.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();
router.use(authenticateJWT);

// ============================================================
// CRITICAL: Static routes MUST be registered BEFORE /:id
// ============================================================

// Secretary: List all
router.get('/', authorizeRoles('secretary'), announcementsController.listAnnouncements);

// Secretary: Create
router.post('/', authorizeRoles('secretary'), announcementsController.createAnnouncement);

// Secretary: Bulk delete expired -- MUST be before /:id
router.delete('/expired', authorizeRoles('secretary'), announcementsController.deleteExpiredAnnouncements);

// Resident: Get my feed -- MUST be before /:id
router.get('/my', authorizeRoles('resident'), announcementsController.getMyAnnouncements);

// Shared: Get single (secretary sees read stats, resident sees is_read)
router.get('/:id', authorizeRoles('secretary', 'resident'), announcementsController.getAnnouncementById);

// Resident: Mark as read
router.post('/:id/read', authorizeRoles('resident'), announcementsController.markAsRead);

// Secretary: Delete single
router.delete('/:id', authorizeRoles('secretary'), announcementsController.deleteAnnouncement);

export default router;
```

---

### 6.4 Update to app.js

Add **2 lines** to `src/app.js`:

```javascript
// 1. Add import at the top with other imports:
import announcementRoutes from './modules/announcements/announcements.routes.js';

// 2. Add route registration with other app.use() calls:
app.use('/api/v1/announcements', announcementRoutes);
```

Final route section in `app.js`:
```javascript
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/society', societyRoutes);
app.use('/api/v1/secretary', secretaryRoutes);
app.use('/api/v1/complaints', complaintRoutes);
app.use('/api/v1/announcements', announcementRoutes);   // <- NEW
app.use('/api/v1', structureRoutes);
```

---

## 7. Edge Cases & Testing Checklist

### Input Validation
- [ ] `title` with 4 characters -> should fail (min 5)
- [ ] `title` with 201 characters -> should fail (max 200)
- [ ] `content` with only whitespace -> should fail (trimmed length check)
- [ ] `expires_at` set to exactly NOW() -> should fail (must be strictly future)
- [ ] `expires_at` set 1 minute in the future -> should succeed
- [ ] `target_type = 'block'` with `target_id = null` -> 400
- [ ] `target_type = 'all'` with `target_id = 5` -> 400 (unexpected field)
- [ ] `target_type = 'role'` with `target_role = null` -> 400
- [ ] `target_type = 'role'` with `target_role = 'staff'` -> 400 (invalid value)
- [ ] `target_type = 'block'` with `target_id = 999` (non-existent) -> 404
- [ ] `target_type = 'block'` with `target_id` from a different society -> 404
- [ ] `target_type = 'user'` with `target_id` of a `pending` resident -> 404 (only active)
- [ ] `target_type = 'user'` with `target_id` of a secretary -> 404 (only residents)

### Society Isolation
- [ ] Secretary A creates announcement in Society A; Secretary B cannot see it
- [ ] Secretary B cannot delete announcement from Society A even knowing the ID
- [ ] Resident in Society A cannot access announcement from Society B via direct ID

### Lifecycle & Status
- [ ] Announcement with `expires_at` 1 second in the past -> NOT in resident `/my` feed
- [ ] Same expired announcement -> visible in secretary list with `status=expired` filter
- [ ] Expired announcement -> resident can still view via direct `GET /:id`
- [ ] `DELETE /expired` when 0 expired exist -> `{ deleted_count: 0 }` with HTTP 200

### Read Receipts
- [ ] Resident marks announcement as read -> row inserted in `announcement_reads`
- [ ] Same resident calls read endpoint again -> `already_read: true`, no duplicate row
- [ ] Read count and percentage update correctly in secretary dashboard
- [ ] `total_targeted = 0` edge case -> `read_percentage = 0` (no division by zero)
- [ ] Resident from Block A cannot mark read an announcement targeted at Block B -> 403
- [ ] `target_type = 'user'` for User A: User B's read attempt -> 403

### Routing Order
- [ ] `DELETE /announcements/expired` -> hits bulk delete (NOT /:id treating "expired" as ID)
- [ ] `GET /announcements/my` -> hits resident feed (NOT /:id treating "my" as ID)
- [ ] `GET /announcements/123` -> hits /:id handler correctly
- [ ] `POST /announcements/123/read` -> hits mark-read handler correctly

### Permissions
- [ ] Resident `POST /announcements` -> 403 Forbidden
- [ ] Resident `DELETE /announcements/:id` -> 403 Forbidden
- [ ] Secretary `GET /announcements/my` -> 403 Forbidden
- [ ] Unauthenticated request to any endpoint -> 401 Unauthorized

### Targeting Logic Correctness
- [ ] `target_type = 'all'`: Every active resident sees it
- [ ] `target_type = 'block'`: Block A resident sees it; Block B resident does NOT
- [ ] `target_type = 'floor'`: Floor 2 resident sees it; Floor 3 resident does NOT
- [ ] `target_type = 'unit'`: Only Unit 304 resident sees it; neighbor Unit 305 does NOT
- [ ] `target_type = 'user'`: Only that specific resident sees it
- [ ] `target_type = 'role'`: All owners see it; tenants do NOT (and vice versa)

### target_label Accuracy
- [ ] `target_type = 'block'` -> label is `"Block B"` (correct block name)
- [ ] `target_type = 'floor'` -> label is `"Block A - Floor 2"`
- [ ] `target_type = 'unit'` -> label is `"A-301"`
- [ ] `target_type = 'user'` -> label is `"Priya Sharma (Personal)"`
- [ ] `target_type = 'role'`, `target_role = 'owner'` -> label is `"All Owners"`

---

## 8. Design Decisions Log

### DD-1: Why is editing an announcement not allowed?

**Problem**: What if the secretary makes a typo?

**Decision**: No edit API. The secretary must delete and re-create.

**Rationale**: An announcement is an official notice. Once posted and read by residents, silently
modifying its content would mean different residents saw different information. Immutability
preserves the integrity of the notice board. The correct workflow: delete the old announcement
and post a new one with the correction noted in the content itself.

---

### DD-2: Why soft delete instead of hard delete?

**Decision**: Soft delete via `is_deleted = TRUE` + `deleted_at` timestamp.

**Rationale**: Read receipt rows in `announcement_reads` reference `announcements.id` via FK.
Hard-deleting would CASCADE-delete all read receipts, destroying the audit trail permanently.
Soft delete preserves the historical record. Data is the most valuable asset — don't destroy it.

---

### DD-3: Why is `expires_at` mandatory?

**Decision**: `expires_at` is mandatory with no option for a permanent announcement.

**Rationale**: A notice board with no expiry mechanism fills up with stale content indefinitely,
degrading the UX for residents. Forcing an expiry date makes the secretary consciously decide how
long a notice is relevant. For "permanent" rules, set an expiry 5-10 years in the future.

---

### DD-4: Why allow residents to view expired announcements via direct ID?

**Decision**: Expired announcements are hidden from the default `/my` feed but accessible via
direct `GET /announcements/:id`.

**Rationale**: Residents may receive a push notification linking to an announcement. If it expires
before they click the link, a `404` response is confusing. Showing the expired announcement with a
clear "This notice has expired" banner is much better UX than a dead link.

---

### DD-5: Why is `target_role` a separate column from `target_id`?

**Decision**: Separate dedicated `target_role` column with its own ENUM.

**Rationale**: `target_id` is typed as `INT` for foreign key IDs. Overloading it with string
values would require changing the type to VARCHAR, breaking FK semantics and making the schema
confusing. A dedicated `target_role` ENUM column is type-safe and enforced at the DB constraint
level via `chk_ann_target_role`.

---

### DD-6: Why does the resident feed sort by priority first, then creation date?

**Decision**: Primary sort: urgent first. Secondary sort: newest within same priority.

**Rationale**: An `urgent` security alert posted yesterday is more important than a `low` priority
event posted 1 minute ago. Priority-first sorting ensures critical notices are never buried beneath
routine announcements.

---

*Guide Status: **READY FOR IMPLEMENTATION***

*New module: `src/modules/announcements/` with 3 files (`service.js`, `controller.js`, `routes.js`) + 2-line update to `app.js`.*

*Next Step for AI Service: Implement Announcement AI Agent Tools (Phase 2C) — the secretary should be able to draft and post announcements via natural language through the AI assistant.*
