# Sahayak — Backend Implementation Guide Part 3 (Phase 2: Resident Reactivation & Complaints Management System)

> **For Backend Developer (Purvi)**:
> This guide provides the complete, production-ready implementation specifications for:
> 1. **Resident Reactivation / Re-grant Access API** (Completes the Phase 1B Resident Lifecycle).
> 2. **Complete Complaints Management System** (Phase 2 Core Module: Resident Complaint Lifecycle, Communication Threads, Secretary Status Workflow, Analytics & Auto-Closure).
>
> **Prerequisites & Database Status**:
> - The tables `complaints` and `complaint_replies` are **already created** on the AlwaysData cloud MySQL database.
> - Schema reference: [COMPLAINTS_DB.md](./COMPLAINTS_DB.md)
> - User schema reference: [USER_DB.md](./USER_DB.md)
> - Structure schema reference: [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md)
> - Part 1 & 2 Guides: [BACKEND_GUIDE.md](./BACKEND_GUIDE.md) & [BACKEND_GUIDE_PART_2.md](./BACKEND_GUIDE_PART_2.md)

---

## Table of Contents
1. [Quick Reference — All Endpoints](#1-quick-reference--all-endpoints)
2. [Database Schema Recap (Already in MySQL)](#2-database-schema-recap)
3. [Section A: Resident Reactivation (Secretary Module)](#3-section-a-resident-reactivation-api)
   - [API 1: Reactivate / Re-grant Access to Resident](#api-1-reactivate--re-grant-access-to-resident)
4. [Section B: Complaints Management Module](#4-section-b-complaints-management-module)
   - [Module Architecture & File Layout](#module-architecture--file-layout)
   - [API 2: Raise a New Complaint (Resident)](#api-2-raise-a-new-complaint-resident)
   - [API 3: List My Complaints (Resident)](#api-3-list-my-complaints-resident)
   - [API 4: Get Complaint Details & Discussion Thread (Resident / Secretary)](#api-4-get-complaint-details--discussion-thread)
   - [API 5: Post Reply / Message in Thread (Resident / Secretary)](#api-5-post-reply--message-in-thread)
   - [API 6: Confirm Resolution / Close Complaint (Resident)](#api-6-confirm-resolution--close-complaint-resident)
   - [API 7: Reopen Complaint (Resident)](#api-7-reopen-complaint-resident)
   - [API 8: List All Society Complaints with Filters & Search (Secretary)](#api-8-list-all-society-complaints-with-filters--search-secretary)
   - [API 9: Update Complaint Status & Rejection (Secretary)](#api-9-update-complaint-status--rejection-secretary)
   - [API 10: Complaint Analytics & Resolution Time (Secretary)](#api-10-complaint-analytics--resolution-time-secretary)
5. [Section C: Auto-Closure Automation (Cron / Maintenance Helper)](#5-section-c-auto-closure-automation)
6. [Complete Code Files for Implementation](#6-complete-code-files-for-implementation)
   - [6.1 Updates to `secretary` Module](#61-updates-to-secretary-module)
   - [6.2 New `complaints` Module: `complaints.service.js`](#62-new-complaints-module-complaintsservicejs)
   - [6.3 New `complaints` Module: `complaints.controller.js`](#63-new-complaints-module-complaintscontrollerjs)
   - [6.4 New `complaints` Module: `complaints.routes.js`](#64-new-complaints-module-complaintsroutesjs)
   - [6.5 Update to `app.js`](#65-update-to-appjs)
7. [Edge Cases & Testing Checklist](#7-edge-cases--testing-checklist)

---

## 1. Quick Reference — All Endpoints

### Section A: Resident Lifecycle (Secretary Module)
| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| **1** | `POST` | `/api/v1/secretary/residents/:residentId/reactivate` | `secretary` | Reactivate an `inactive` (revoked) or `rejected` resident and assign a vacant unit |

### Section B: Complaints Module
| # | Method | Endpoint | Auth Role | Description |
|---|---|---|---|---|
| **2** | `POST` | `/api/v1/complaints` | `resident` | Raise a new complaint (with optional Cloudinary photo) |
| **3** | `GET` | `/api/v1/complaints/my` | `resident` | List logged-in resident's complaints with status filter & pagination |
| **4** | `GET` | `/api/v1/complaints/:id` | `resident`, `secretary` | View full complaint details + chronological message thread |
| **5** | `POST` | `/api/v1/complaints/:id/replies` | `resident`, `secretary` | Send a reply message or photo in thread |
| **6** | `POST` | `/api/v1/complaints/:id/confirm-resolved` | `resident` | Resident confirms resolution; marks complaint `closed` |
| **7** | `POST` | `/api/v1/complaints/:id/reopen` | `resident` | Resident reports unresolved issue; moves back to `in_progress` |
| **8** | `GET` | `/api/v1/secretary/complaints` | `secretary` | List society complaints with status/category/search filters & summary counts |
| **9** | `PATCH` | `/api/v1/secretary/complaints/:id/status` | `secretary` | Move to `in_progress`, `pending_closure`, or `rejected` (with reason) |
| **10**| `GET` | `/api/v1/secretary/complaints/stats` | `secretary` | Analytics: counts by status/category & avg resolution time |

---

## 2. Database Schema Recap

The following tables are already created on AlwaysData MySQL:

### 1. `complaints` Table
```sql
CREATE TABLE complaints (
    id                INT          NOT NULL AUTO_INCREMENT,
    society_id        INT          NOT NULL,
    unit_id           INT          NOT NULL,
    resident_id       INT          NOT NULL,
    title             VARCHAR(200) NOT NULL,
    category          ENUM('plumbing', 'electrical', 'lift', 'cleanliness', 'security', 'parking', 'noise', 'other') NOT NULL,
    category_label    VARCHAR(100) NULL,
    description       TEXT         NOT NULL,
    attachment_url    VARCHAR(500) NULL,
    status            ENUM('open', 'in_progress', 'pending_closure', 'closed', 'rejected') NOT NULL DEFAULT 'open',
    rejection_reason  VARCHAR(500) NULL,
    closed_at         DATETIME     NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_complaints_society_status (society_id, status),
    INDEX idx_complaints_resident (resident_id),
    CONSTRAINT chk_category_label CHECK (category != 'other' OR category_label IS NOT NULL),
    CONSTRAINT chk_rejection_reason CHECK (status != 'rejected' OR rejection_reason IS NOT NULL),
    CONSTRAINT fk_complaints_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_complaints_unit FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_complaints_resident FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

### 2. `complaint_replies` Table
```sql
CREATE TABLE complaint_replies (
    id              INT          NOT NULL AUTO_INCREMENT,
    complaint_id    INT          NOT NULL,
    sender_id       INT          NULL,        -- NULL for system automated messages
    sender_role     ENUM('resident', 'secretary', 'system') NOT NULL,
    message         TEXT         NULL,        -- NULL for photo-only replies
    attachment_url  VARCHAR(500) NULL,        -- Cloudinary photo URL
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_replies_complaint (complaint_id, created_at),
    CONSTRAINT chk_reply_content CHECK (message IS NOT NULL OR attachment_url IS NOT NULL),
    CONSTRAINT fk_replies_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE RESTRICT,
    CONSTRAINT fk_replies_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT
);
```

---

## 3. Section A: Resident Reactivation API

### Context:
When a secretary revokes an approved resident (or rejects one), their user status is set to `'inactive'` (or `'rejected'`), and their unit is freed back to `'vacant'`.
Until now, there was no endpoint to **restore or re-grant access** to that resident if the secretary made a mistake or the resident resolved their lease dispute.

### API 1: Reactivate / Re-grant Access to Resident
- **Method**: `POST`
- **URL**: `/api/v1/secretary/residents/:residentId/reactivate`
- **Auth**: `authenticateJWT` + `authorizeRoles('secretary')`

#### Request Body:
```json
{
  "unitId": 42
}
```
*(Note: `unitId` is mandatory because the user's previous unit might now be assigned to someone else. The secretary selects which vacant unit to assign).*

#### Business Rules & Edge Cases:
1. Verify resident exists, belongs to `req.user.societyId`, and has role `'resident'`. If not $\rightarrow$ `404 Not Found`.
2. Check resident's current status:
   - If `status === 'active'` $\rightarrow$ `400 Resident is already active.`
   - If `status === 'pending'` $\rightarrow$ `400 Resident is pending approval. Use the approve endpoint instead.`
   - Only `status === 'inactive'` or `status === 'rejected'` can be reactivated.
3. Verify target unit:
   - Must belong to `req.user.societyId`.
   - Must currently have `status === 'vacant'`. If occupied $\rightarrow$ `409 Unit is already occupied. Select a vacant unit.`
4. Database Transaction (`pool.getConnection()`):
   - Row-level lock (`FOR UPDATE`) on user and target unit.
   - `UPDATE users SET status = 'active', unit_id = ? WHERE id = ?`
   - `UPDATE units SET status = 'occupied' WHERE id = ?`
   - Commit transaction.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Resident reactivated successfully and assigned to unit A-101.",
  "data": {
    "userId": 15,
    "name": "Aarav Sharma",
    "status": "active",
    "unit": {
      "id": 42,
      "displayLabel": "A-101"
    }
  }
}
```

---

## 4. Section B: Complaints Management Module

### Module Architecture & File Layout
Create a new module directory `sahayak_backend/src/modules/complaints/`:
```
sahayak_backend/src/
├── app.js                          # Mount /api/v1/complaints
└── modules/
    ├── secretary/
    │   ├── secretary.controller.js # Add reactivateResident
    │   ├── secretary.service.js    # Add reactivateResident, getSecretaryComplaints, getComplaintStats
    │   └── secretary.routes.js     # Add reactivate and secretary complaints routes
    └── complaints/
        ├── complaints.controller.js
        ├── complaints.service.js
        └── complaints.routes.js
```

---

### Complaint Lifecycle Status Rules
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
         │                          │ (must provide rejection_reason)           │
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
             (reopens with explanation) ────────────────────────────── back ────┘
```

---

### API 2: Raise a New Complaint (Resident)
- **Method**: `POST`
- **URL**: `/api/v1/complaints`
- **Auth**: `authenticateJWT` + `authorizeRoles('resident')`

#### Request Body:
```json
{
  "title": "Water leakage in bathroom ceiling",
  "category": "plumbing",
  "category_label": null,
  "description": "Continuous water seepage observed near the exhaust vent since yesterday morning.",
  "attachment_url": "https://res.cloudinary.com/sahayak/image/upload/v12345/complaints/leak.jpg"
}
```

#### Validation & Edge Cases:
1. `title`: Required, string, trimmed, 3 to 200 characters.
2. `description`: Required, string, trimmed, min 10 characters.
3. `category`: Required. Must be one of:
   `['plumbing', 'electrical', 'lift', 'cleanliness', 'security', 'parking', 'noise', 'other']`.
4. If `category === 'other'`:
   - `category_label` is **mandatory** (string, trimmed, 2 to 100 characters).
   - If missing $\rightarrow$ `400 category_label is required when category is 'other'.`
5. If `category !== 'other'`:
   - Enforce `category_label = null`.
6. Resident checks:
   - Resident's `status` must be `'active'` (guaranteed by `authenticateJWT`).
   - Resident must have an assigned unit (`req.user.unitId`). If `req.user.unitId == null` $\rightarrow$ `400 Resident does not have an assigned unit. Contact secretary.`
7. Auto-populate from `req.user`:
   - `society_id = req.user.societyId`
   - `resident_id = req.user.userId`
   - `unit_id = req.user.unitId`
   - `status = 'open'`

#### Success Response (201 Created):
```json
{
  "success": true,
  "message": "Complaint raised successfully.",
  "data": {
    "complaintId": 101,
    "title": "Water leakage in bathroom ceiling",
    "category": "plumbing",
    "status": "open",
    "createdAt": "2026-10-06T18:30:00.000Z"
  }
}
```

---

### API 3: List My Complaints (Resident)
- **Method**: `GET`
- **URL**: `/api/v1/complaints/my`
- **Auth**: `authenticateJWT` + `authorizeRoles('resident')`

#### Query Parameters:
| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | Optional | Filter by status: `open`, `in_progress`, `pending_closure`, `closed`, `rejected` |
| `page` | integer | Optional | Page number (default: `1`) |
| `limit` | integer | Optional | Results per page (default: `10`, max `50`) |

#### Query Logic:
- Fetch complaints matching `resident_id = req.user.userId AND society_id = req.user.societyId`.
- Include total replies count: `(SELECT COUNT(*) FROM complaint_replies WHERE complaint_id = c.id) AS reply_count`.
- Include unit info from `units` table (`display_label`, `block_name`, `floor_number`).
- Order by `c.created_at DESC`.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Complaints retrieved successfully.",
  "data": {
    "complaints": [
      {
        "id": 101,
        "title": "Water leakage in bathroom ceiling",
        "category": "plumbing",
        "categoryLabel": null,
        "description": "Continuous water seepage...",
        "attachmentUrl": "https://res.cloudinary.com/sahayak/image/upload/v12345/complaints/leak.jpg",
        "status": "open",
        "rejectionReason": null,
        "replyCount": 2,
        "createdAt": "2026-10-06T18:30:00.000Z",
        "updatedAt": "2026-10-06T18:45:00.000Z",
        "closedAt": null,
        "unit": {
          "id": 42,
          "displayLabel": "A-101",
          "blockName": "Tower A",
          "floorNumber": 1
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

### API 4: Get Complaint Details & Discussion Thread
- **Method**: `GET`
- **URL**: `/api/v1/complaints/:id`
- **Auth**: `authenticateJWT` + `authorizeRoles('resident', 'secretary')`

#### Authorization & Security Checks:
1. Fetch complaint by `id`:
   - Join with `users` (resident details: name, email, phone)
   - Join with `units` (display_label, block_name, floor_number)
2. If complaint not found $\rightarrow$ `404 Complaint not found.`
3. **Society Scoping**: `c.society_id !== req.user.societyId` $\rightarrow$ `403 Access denied to this society's complaint.`
4. **Resident Scoping**: If `req.user.role === 'resident'` and `c.resident_id !== req.user.userId` $\rightarrow$ `403 You can only view your own complaints.`
5. Fetch thread replies from `complaint_replies`:
   - `LEFT JOIN users u ON r.sender_id = u.id`
   - Order by `r.created_at ASC` (oldest to newest).
   - If `r.sender_role === 'system'`, return `senderName = 'System'`.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Complaint details retrieved.",
  "data": {
    "complaint": {
      "id": 101,
      "title": "Water leakage in bathroom ceiling",
      "category": "plumbing",
      "categoryLabel": null,
      "description": "Continuous water seepage observed near the exhaust vent.",
      "attachmentUrl": "https://res.cloudinary.com/sahayak/image/upload/v12345/complaints/leak.jpg",
      "status": "in_progress",
      "rejectionReason": null,
      "createdAt": "2026-10-06T18:30:00.000Z",
      "updatedAt": "2026-10-06T19:00:00.000Z",
      "closedAt": null,
      "resident": {
        "id": 15,
        "name": "Aarav Sharma",
        "email": "aarav@gmail.com",
        "phone": "9876543210"
      },
      "unit": {
        "id": 42,
        "displayLabel": "A-101",
        "blockName": "Tower A",
        "floorNumber": 1
      }
    },
    "thread": [
      {
        "id": 1,
        "senderId": 2,
        "senderRole": "secretary",
        "senderName": "Secretary Rajesh",
        "message": "Plumber has been assigned. They will visit your unit tomorrow between 10am - 12pm.",
        "attachmentUrl": null,
        "createdAt": "2026-10-06T19:00:00.000Z"
      }
    ]
  }
}
```

---

### API 5: Post Reply / Message in Thread
- **Method**: `POST`
- **URL**: `/api/v1/complaints/:id/replies`
- **Auth**: `authenticateJWT` + `authorizeRoles('resident', 'secretary')`

#### Request Body:
```json
{
  "message": "Plumber has inspected and replaced the sealant.",
  "attachmentUrl": "https://res.cloudinary.com/sahayak/image/upload/v12345/fixes/sealant.jpg"
}
```
*(At least one of `message` or `attachmentUrl` is required. Both cannot be empty).*

#### Business Rules & Edge Cases:
1. Verify complaint exists in `req.user.societyId`.
2. Role validation:
   - If `req.user.role === 'resident'`, verify `complaint.resident_id === req.user.userId`.
3. Check complaint status:
   - If `status === 'closed'` $\rightarrow$ `400 Cannot reply to a closed complaint.`
   - If `status === 'rejected'` $\rightarrow$ `400 Cannot reply to a rejected complaint.`
4. **Auto-advance status on Secretary reply**:
   - If `req.user.role === 'secretary'` AND current `status === 'open'`:
     - Update `complaints SET status = 'in_progress' WHERE id = ?`.
     *(Because secretary interaction confirms work is now in progress!)*
5. Insert into `complaint_replies`:
   - `complaint_id`: id
   - `sender_id`: `req.user.userId`
   - `sender_role`: `req.user.role`
   - `message`: trimmed string or `null`
   - `attachment_url`: string or `null`
6. `complaints.updated_at` automatically updates.

#### Success Response (201 Created):
```json
{
  "success": true,
  "message": "Reply posted successfully.",
  "data": {
    "replyId": 5,
    "complaintId": 101,
    "senderRole": "secretary",
    "message": "Plumber has inspected and replaced the sealant.",
    "attachmentUrl": "https://res.cloudinary.com/sahayak/image/upload/v12345/fixes/sealant.jpg",
    "createdAt": "2026-10-06T19:30:00.000Z"
  }
}
```

---

### API 6: Confirm Resolution / Close Complaint (Resident)
- **Method**: `POST`
- **URL**: `/api/v1/complaints/:id/confirm-resolved`
- **Auth**: `authenticateJWT` + `authorizeRoles('resident')`

#### Request Body:
```json
{
  "feedback": "Leakage has completely stopped. Thanks for the quick resolution!"
}
```
*(Optional body: `feedback` string)*

#### Business Rules & Edge Cases:
1. Verify complaint exists in `req.user.societyId` and belongs to `req.user.userId`.
2. Check complaint status:
   - Must be in `pending_closure` or `in_progress`.
   - If already `closed` $\rightarrow$ `400 Complaint is already closed.`
   - If `rejected` $\rightarrow$ `400 Cannot confirm a rejected complaint.`
   - If `open` $\rightarrow$ `400 Secretary has not addressed or resolved this complaint yet.`
3. Transaction:
   - `UPDATE complaints SET status = 'closed', closed_at = NOW() WHERE id = ?`
   - Insert system reply into `complaint_replies`:
     - `sender_id`: `req.user.userId`
     - `sender_role`: `'resident'`
     - `message`: `feedback` || `"Resident confirmed resolution. Complaint closed."`
   - Commit transaction.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Complaint closed successfully. Thank you for your feedback.",
  "data": {
    "complaintId": 101,
    "status": "closed",
    "closedAt": "2026-10-06T20:00:00.000Z"
  }
}
```

---

### API 7: Reopen Complaint (Resident)
- **Method**: `POST`
- **URL**: `/api/v1/complaints/:id/reopen`
- **Auth**: `authenticateJWT` + `authorizeRoles('resident')`

#### Request Body:
```json
{
  "reason": "Water is still dripping from the corner of the ceiling. Issue not fixed."
}
```
*(`reason` is **mandatory**, string, trimmed, min 5 chars).*

#### Business Rules & Edge Cases:
1. Verify complaint exists in `req.user.societyId` and belongs to `req.user.userId`.
2. Allowed status:
   - Only complaints with `status === 'pending_closure'` can be reopened via this flow.
   - If `status === 'open'` or `status === 'in_progress'` $\rightarrow$ `400 Complaint is already open / in progress.`
   - If `status === 'closed'` $\rightarrow$ `400 Closed complaints cannot be reopened. Please raise a new complaint.`
   - If `status === 'rejected'` $\rightarrow$ `400 Rejected complaints cannot be reopened.`
3. Transaction:
   - `UPDATE complaints SET status = 'in_progress' WHERE id = ?`
   - Insert reply into `complaint_replies`:
     - `sender_id`: `req.user.userId`
     - `sender_role`: `'resident'`
     - `message`: `"Reopened by resident: " + reason`
   - Commit transaction.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Complaint reopened and moved back to in progress. The secretary has been notified.",
  "data": {
    "complaintId": 101,
    "status": "in_progress"
  }
}
```

---

### API 8: List All Society Complaints with Filters & Search (Secretary)
- **Method**: `GET`
- **URL**: `/api/v1/secretary/complaints`
- **Auth**: `authenticateJWT` + `authorizeRoles('secretary')`

#### Query Parameters:
| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | Optional | `open`, `in_progress`, `pending_closure`, `closed`, `rejected` |
| `category` | string | Optional | `plumbing`, `electrical`, `lift`, `cleanliness`, etc. |
| `search` | string | Optional | Search query matching in `title`, `description`, resident `name`, or unit `display_label` |
| `page` | integer | Optional | Page number (default: `1`) |
| `limit` | integer | Optional | Limit per page (default: `20`, max: `100`) |

#### Response Data Structure:
Returns both the paginated list and summary breakdown counts (`total`, `open`, `in_progress`, `pending_closure`, `closed`, `rejected`) so frontend tabs display live badges without needing separate API calls.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Society complaints retrieved.",
  "data": {
    "counts": {
      "total": 12,
      "open": 4,
      "inProgress": 3,
      "pendingClosure": 2,
      "closed": 2,
      "rejected": 1
    },
    "complaints": [
      {
        "id": 101,
        "title": "Water leakage in bathroom ceiling",
        "category": "plumbing",
        "categoryLabel": null,
        "status": "in_progress",
        "createdAt": "2026-10-06T18:30:00.000Z",
        "updatedAt": "2026-10-06T19:30:00.000Z",
        "replyCount": 3,
        "resident": {
          "id": 15,
          "name": "Aarav Sharma",
          "phone": "9876543210"
        },
        "unit": {
          "id": 42,
          "displayLabel": "A-101",
          "blockName": "Tower A",
          "floorNumber": 1
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 12,
      "totalPages": 1
    }
  }
}
```

---

### API 9: Update Complaint Status & Rejection (Secretary)
- **Method**: `PATCH`
- **URL**: `/api/v1/secretary/complaints/:id/status`
- **Auth**: `authenticateJWT` + `authorizeRoles('secretary')`

#### Request Body:
```json
{
  "status": "pending_closure"
}
```
Or for rejection:
```json
{
  "status": "rejected",
  "rejectionReason": "This issue falls under private tenant interior maintenance, not society scope."
}
```

#### Strict Business Rules & Validation:
1. Allowed `status` values for secretary:
   - `'in_progress'`
   - `'pending_closure'`
   - `'rejected'`
2. **Forbidden target status: `'closed'`**:
   - If secretary passes `status: 'closed'` $\rightarrow$ `400 Secretary cannot directly close a complaint. Mark status as 'pending_closure' for resident verification.`
3. Rejection enforcement:
   - If `status === 'rejected'`, `rejectionReason` is **mandatory** (string, min 5 chars, max 500 chars).
   - If missing $\rightarrow$ `400 rejectionReason is required when status is 'rejected'.`
4. Terminal state checks:
   - If complaint is currently `'closed'` $\rightarrow$ `400 Cannot change status of an already closed complaint.`
   - If complaint is currently `'rejected'` $\rightarrow$ `400 Cannot change status of an already rejected complaint.`
5. Transaction:
   - `UPDATE complaints SET status = ?, rejection_reason = ? WHERE id = ? AND society_id = ?`
   - Insert system reply into `complaint_replies`:
     - `sender_id`: `req.user.userId`
     - `sender_role`: `'secretary'`
     - `message`: Formatted notification, e.g.:
       - Pending closure: `"Secretary marked this complaint as Pending Closure. Awaiting resident confirmation."`
       - In progress: `"Secretary marked this complaint as In Progress."`
       - Rejected: `"Secretary rejected this complaint. Reason: " + rejectionReason`
   - Commit transaction.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Complaint status updated successfully.",
  "data": {
    "complaintId": 101,
    "status": "pending_closure",
    "rejectionReason": null
  }
}
```

---

### API 10: Complaint Analytics & Resolution Time (Secretary)
- **Method**: `GET`
- **URL**: `/api/v1/secretary/complaints/stats`
- **Auth**: `authenticateJWT` + `authorizeRoles('secretary')`

#### Analytical Metrics Computed:
1. Status breakdown: `open`, `in_progress`, `pending_closure`, `closed`, `rejected`.
2. Category breakdown: count per category (`plumbing`, `electrical`, etc.).
3. Average resolution time:
   `AVG(TIMESTAMPDIFF(HOUR, created_at, closed_at))` for `status = 'closed'`.
4. High-frequency units: Top 5 units with the most raised complaints.

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Complaint analytics retrieved.",
  "data": {
    "summary": {
      "total": 24,
      "open": 5,
      "inProgress": 4,
      "pendingClosure": 3,
      "closed": 10,
      "rejected": 2
    },
    "byCategory": {
      "plumbing": 9,
      "electrical": 6,
      "lift": 3,
      "cleanliness": 2,
      "security": 1,
      "parking": 1,
      "noise": 1,
      "other": 1
    },
    "performance": {
      "avgResolutionHours": 18.5,
      "avgResolutionDays": 0.8
    },
    "topUnits": [
      { "unitId": 42, "displayLabel": "A-101", "complaintCount": 4 },
      { "unitId": 58, "displayLabel": "B-204", "complaintCount": 3 }
    ]
  }
}
```

---

## 5. Section C: Auto-Closure Automation

According to [COMPLAINTS_DB.md](./COMPLAINTS_DB.md) Section 2:
> If a complaint is in `pending_closure` and the resident does not respond for **7 days**, the system should automatically close the complaint and insert an automated system reply.

### Cron Service Implementation:
```javascript
/**
 * Auto-close complaints in 'pending_closure' older than 7 days
 */
export const autoCloseStaleComplaints = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Find all stale complaints
    const [staleComplaints] = await connection.execute(
      `SELECT id, society_id FROM complaints
       WHERE status = 'pending_closure'
         AND updated_at < NOW() - INTERVAL 7 DAY
       FOR UPDATE`
    );

    if (staleComplaints.length === 0) {
      await connection.commit();
      return 0;
    }

    const complaintIds = staleComplaints.map((c) => c.id);

    // 2. Bulk update to 'closed'
    const placeholders = complaintIds.map(() => '?').join(',');
    await connection.execute(
      `UPDATE complaints
       SET status = 'closed', closed_at = NOW()
       WHERE id IN (${placeholders})`,
      complaintIds
    );

    // 3. Insert system replies
    for (const c of staleComplaints) {
      await connection.execute(
        `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
         VALUES (?, NULL, 'system', 'Auto-closed after 7 days with no response from resident.')`,
        [c.id]
      );
    }

    await connection.commit();
    return staleComplaints.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
```

---

## 6. Complete Code Files for Implementation

### 6.1 Updates to `secretary` Module

#### In `sahayak_backend/src/modules/secretary/secretary.service.js`:
Add the following function:

```javascript
/**
 * Reactivate an inactive (revoked) or rejected resident and assign a vacant unit
 */
export const reactivateResident = async (societyId, residentId, unitId) => {
  if (!unitId) {
    throw { status: 400, message: 'unitId is required to reactivate a resident.' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Lock and check resident
    const [residents] = await connection.execute(
      'SELECT id, name, status FROM users WHERE id = ? AND society_id = ? AND role = ? FOR UPDATE',
      [residentId, societyId, 'resident']
    );

    if (residents.length === 0) {
      throw { status: 404, message: 'Resident not found in your society.' };
    }

    const resident = residents[0];
    if (resident.status === 'active') {
      throw { status: 400, message: 'Resident is already active.' };
    }
    if (resident.status === 'pending') {
      throw { status: 400, message: 'Resident is pending approval. Use the approve endpoint instead.' };
    }

    // 2. Lock and check target unit
    const [units] = await connection.execute(
      'SELECT id, display_label, status FROM units WHERE id = ? AND society_id = ? FOR UPDATE',
      [unitId, societyId]
    );

    if (units.length === 0) {
      throw { status: 404, message: 'Unit not found in your society.' };
    }

    const targetUnit = units[0];
    if (targetUnit.status === 'occupied') {
      throw { status: 409, message: `Unit ${targetUnit.display_label} is already occupied. Select a vacant unit.` };
    }

    // 3. Update user status to active and assign unit
    await connection.execute(
      'UPDATE users SET status = ?, unit_id = ? WHERE id = ?',
      ['active', unitId, residentId]
    );

    // 4. Mark unit occupied
    await connection.execute(
      'UPDATE units SET status = ? WHERE id = ?',
      ['occupied', unitId]
    );

    await connection.commit();

    return {
      userId: resident.id,
      name: resident.name,
      status: 'active',
      unit: {
        id: targetUnit.id,
        displayLabel: targetUnit.display_label,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
```

#### In `sahayak_backend/src/modules/secretary/secretary.controller.js`:
Add:
```javascript
/**
 * POST /api/v1/secretary/residents/:residentId/reactivate
 */
export const reactivateResident = async (req, res, next) => {
  try {
    const { residentId } = req.params;
    const { unitId } = req.body;
    const data = await secretaryService.reactivateResident(req.user.societyId, residentId, unitId);
    return sendSuccess(res, 200, `Resident reactivated successfully and assigned to unit ${data.unit.displayLabel}.`, data);
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    next(error);
  }
};
```

#### In `sahayak_backend/src/modules/secretary/secretary.routes.js`:
Add route:
```javascript
router.post('/residents/:residentId/reactivate', secretaryController.reactivateResident);
```

---

### 6.2 New `complaints` Module: `complaints.service.js`

Create `sahayak_backend/src/modules/complaints/complaints.service.js`:

```javascript
import { pool } from '../../config/db.js';

const ALLOWED_CATEGORIES = [
  'plumbing',
  'electrical',
  'lift',
  'cleanliness',
  'security',
  'parking',
  'noise',
  'other',
];

/**
 * 1. Create a new complaint (Resident)
 */
export const createComplaint = async (societyId, residentId, unitId, payload) => {
  const { title, category, category_label, description, attachment_url } = payload;

  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
    throw { status: 400, message: 'Title is required (3 to 200 characters).' };
  }

  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    throw { status: 400, message: 'Description is required (at least 10 characters).' };
  }

  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    throw { status: 400, message: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}` };
  }

  let finalCategoryLabel = null;
  if (category === 'other') {
    if (!category_label || typeof category_label !== 'string' || category_label.trim().length < 2) {
      throw { status: 400, message: 'category_label is required when category is "other".' };
    }
    finalCategoryLabel = category_label.trim();
  }

  if (!unitId) {
    throw { status: 400, message: 'Resident does not have an assigned unit. Contact your secretary.' };
  }

  const [result] = await pool.execute(
    `INSERT INTO complaints 
      (society_id, unit_id, resident_id, title, category, category_label, description, attachment_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      societyId,
      unitId,
      residentId,
      title.trim(),
      category,
      finalCategoryLabel,
      description.trim(),
      attachment_url || null,
    ]
  );

  return {
    complaintId: result.insertId,
    title: title.trim(),
    category,
    status: 'open',
  };
};

/**
 * 2. Get resident's complaints with pagination
 */
export const getMyComplaints = async (societyId, residentId, queryParams) => {
  const { status, page = 1, limit = 10 } = queryParams;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  let whereClause = 'WHERE c.society_id = ? AND c.resident_id = ?';
  const queryValues = [societyId, residentId];

  if (status) {
    whereClause += ' AND c.status = ?';
    queryValues.push(status);
  }

  // Count total
  const [countResult] = await pool.execute(
    `SELECT COUNT(*) AS total FROM complaints c ${whereClause}`,
    queryValues
  );
  const total = Number(countResult[0].total || 0);

  // Fetch paginated
  const sql = `
    SELECT 
      c.id,
      c.title,
      c.category,
      c.category_label,
      c.description,
      c.attachment_url,
      c.status,
      c.rejection_reason,
      c.closed_at,
      c.created_at,
      c.updated_at,
      u.id AS unit_id,
      u.display_label AS unit_label,
      u.block_name,
      u.floor_number,
      (SELECT COUNT(*) FROM complaint_replies WHERE complaint_id = c.id) AS reply_count
    FROM complaints c
    JOIN units u ON c.unit_id = u.id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ${limitNum} OFFSET ${offset}
  `;

  const [rows] = await pool.execute(sql, queryValues);

  return {
    complaints: rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      categoryLabel: r.category_label,
      description: r.description,
      attachmentUrl: r.attachment_url,
      status: r.status,
      rejectionReason: r.rejection_reason,
      replyCount: Number(r.reply_count || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      closedAt: r.closed_at,
      unit: {
        id: r.unit_id,
        displayLabel: r.unit_label,
        blockName: r.block_name,
        floorNumber: r.floor_number,
      },
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

/**
 * 3. Get complaint details with thread (Resident & Secretary)
 */
export const getComplaintById = async (societyId, user, complaintId) => {
  const [complaints] = await pool.execute(
    `SELECT 
      c.id,
      c.society_id,
      c.resident_id,
      c.title,
      c.category,
      c.category_label,
      c.description,
      c.attachment_url,
      c.status,
      c.rejection_reason,
      c.closed_at,
      c.created_at,
      c.updated_at,
      u.id AS resident_user_id,
      u.name AS resident_name,
      u.email AS resident_email,
      u.phone AS resident_phone,
      un.id AS unit_id,
      un.display_label AS unit_label,
      un.block_name,
      un.floor_number
    FROM complaints c
    JOIN users u ON c.resident_id = u.id
    JOIN units un ON c.unit_id = un.id
    WHERE c.id = ? AND c.society_id = ?`,
    [complaintId, societyId]
  );

  if (complaints.length === 0) {
    throw { status: 404, message: 'Complaint not found.' };
  }

  const row = complaints[0];

  // If user is resident, they can only view their own complaint
  if (user.role === 'resident' && row.resident_id !== user.userId) {
    throw { status: 403, message: 'You are not authorized to view this complaint.' };
  }

  // Fetch thread messages
  const [replies] = await pool.execute(
    `SELECT 
      r.id,
      r.sender_id,
      r.sender_role,
      r.message,
      r.attachment_url,
      r.created_at,
      u.name AS sender_name
    FROM complaint_replies r
    LEFT JOIN users u ON r.sender_id = u.id
    WHERE r.complaint_id = ?
    ORDER BY r.created_at ASC`,
    [complaintId]
  );

  return {
    complaint: {
      id: row.id,
      title: row.title,
      category: row.category,
      categoryLabel: row.category_label,
      description: row.description,
      attachmentUrl: row.attachment_url,
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      resident: {
        id: row.resident_user_id,
        name: row.resident_name,
        email: row.resident_email,
        phone: row.resident_phone,
      },
      unit: {
        id: row.unit_id,
        displayLabel: row.unit_label,
        blockName: row.block_name,
        floorNumber: row.floor_number,
      },
    },
    thread: replies.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderRole: r.sender_role,
      senderName: r.sender_role === 'system' ? 'System' : (r.sender_name || 'User'),
      message: r.message,
      attachmentUrl: r.attachment_url,
      createdAt: r.created_at,
    })),
  };
};

/**
 * 4. Add a reply to complaint thread
 */
export const addReply = async (societyId, user, complaintId, payload) => {
  const { message, attachment_url } = payload;

  const trimmedMessage = message && typeof message === 'string' ? message.trim() : null;
  const validAttachment = attachment_url && typeof attachment_url === 'string' ? attachment_url.trim() : null;

  if (!trimmedMessage && !validAttachment) {
    throw { status: 400, message: 'A reply must have either a message or an attachment.' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock complaint
    const [complaints] = await connection.execute(
      'SELECT id, resident_id, status FROM complaints WHERE id = ? AND society_id = ? FOR UPDATE',
      [complaintId, societyId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const complaint = complaints[0];

    // Resident check
    if (user.role === 'resident' && complaint.resident_id !== user.userId) {
      throw { status: 403, message: 'You can only reply to your own complaint.' };
    }

    // Terminal checks
    if (complaint.status === 'closed') {
      throw { status: 400, message: 'Cannot reply to a closed complaint.' };
    }
    if (complaint.status === 'rejected') {
      throw { status: 400, message: 'Cannot reply to a rejected complaint.' };
    }

    // Auto-advance status if secretary replies to an open complaint
    if (user.role === 'secretary' && complaint.status === 'open') {
      await connection.execute(
        'UPDATE complaints SET status = "in_progress" WHERE id = ?',
        [complaintId]
      );
    }

    // Insert reply
    const [result] = await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message, attachment_url)
       VALUES (?, ?, ?, ?, ?)`,
      [complaintId, user.userId, user.role, trimmedMessage, validAttachment]
    );

    await connection.commit();

    return {
      replyId: result.insertId,
      complaintId: Number(complaintId),
      senderRole: user.role,
      message: trimmedMessage,
      attachmentUrl: validAttachment,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * 5. Confirm resolution & close complaint (Resident)
 */
export const confirmResolution = async (societyId, residentId, complaintId, feedback) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [complaints] = await connection.execute(
      'SELECT id, status FROM complaints WHERE id = ? AND society_id = ? AND resident_id = ? FOR UPDATE',
      [complaintId, societyId, residentId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const complaint = complaints[0];

    if (complaint.status === 'closed') {
      throw { status: 400, message: 'Complaint is already closed.' };
    }
    if (complaint.status === 'rejected') {
      throw { status: 400, message: 'Cannot confirm resolution on a rejected complaint.' };
    }
    if (complaint.status === 'open') {
      throw { status: 400, message: 'Complaint has not been addressed yet.' };
    }

    // Update status to closed
    await connection.execute(
      'UPDATE complaints SET status = "closed", closed_at = NOW() WHERE id = ?',
      [complaintId]
    );

    // Insert closure confirmation message
    const msg = feedback && typeof feedback === 'string' && feedback.trim()
      ? `Resident confirmed resolution: "${feedback.trim()}"`
      : 'Resident confirmed resolution. Complaint closed.';

    await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
       VALUES (?, ?, 'resident', ?)`,
      [complaintId, residentId, msg]
    );

    await connection.commit();

    return { complaintId: Number(complaintId), status: 'closed' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * 6. Reopen complaint (Resident)
 */
export const reopenComplaint = async (societyId, residentId, complaintId, reason) => {
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    throw { status: 400, message: 'Reason is required to reopen the complaint (min 5 characters).' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [complaints] = await connection.execute(
      'SELECT id, status FROM complaints WHERE id = ? AND society_id = ? AND resident_id = ? FOR UPDATE',
      [complaintId, societyId, residentId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const complaint = complaints[0];

    if (complaint.status !== 'pending_closure') {
      throw {
        status: 400,
        message: `Only complaints in 'pending_closure' can be reopened. Current status: '${complaint.status}'.`,
      };
    }

    // Move back to in_progress
    await connection.execute(
      'UPDATE complaints SET status = "in_progress" WHERE id = ?',
      [complaintId]
    );

    // Insert reopen message
    await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
       VALUES (?, ?, 'resident', ?)`,
      [complaintId, residentId, `Reopened by resident: ${reason.trim()}`]
    );

    await connection.commit();

    return { complaintId: Number(complaintId), status: 'in_progress' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * 7. Get all complaints for secretary (Search, Filter, Pagination, Summary counts)
 */
export const getSecretaryComplaints = async (societyId, queryParams) => {
  const { status, category, search, page = 1, limit = 20 } = queryParams;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  // 1. Get summary counts across all statuses
  const [countsResult] = await pool.execute(
    `SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS count_open,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS count_in_progress,
      SUM(CASE WHEN status = 'pending_closure' THEN 1 ELSE 0 END) AS count_pending_closure,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS count_closed,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS count_rejected
    FROM complaints
    WHERE society_id = ?`,
    [societyId]
  );

  const cRow = countsResult[0];
  const counts = {
    total: Number(cRow.total || 0),
    open: Number(cRow.count_open || 0),
    inProgress: Number(cRow.count_in_progress || 0),
    pendingClosure: Number(cRow.count_pending_closure || 0),
    closed: Number(cRow.count_closed || 0),
    rejected: Number(cRow.count_rejected || 0),
  };

  // 2. Build filtered query
  let whereConditions = ['c.society_id = ?'];
  let values = [societyId];

  if (status) {
    whereConditions.push('c.status = ?');
    values.push(status);
  }

  if (category) {
    whereConditions.push('c.category = ?');
    values.push(category);
  }

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    whereConditions.push('(c.title LIKE ? OR c.description LIKE ? OR u.name LIKE ? OR un.display_label LIKE ?)');
    values.push(s, s, s, s);
  }

  const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

  // Filtered total count
  const [filteredCountResult] = await pool.execute(
    `SELECT COUNT(*) AS total 
     FROM complaints c
     JOIN users u ON c.resident_id = u.id
     JOIN units un ON c.unit_id = un.id
     ${whereClause}`,
    values
  );
  const filteredTotal = Number(filteredCountResult[0].total || 0);

  // Fetch complaints
  const [rows] = await pool.execute(
    `SELECT 
      c.id,
      c.title,
      c.category,
      c.category_label,
      c.status,
      c.created_at,
      c.updated_at,
      u.id AS resident_id,
      u.name AS resident_name,
      u.phone AS resident_phone,
      un.id AS unit_id,
      un.display_label AS unit_label,
      un.block_name,
      un.floor_number,
      (SELECT COUNT(*) FROM complaint_replies WHERE complaint_id = c.id) AS reply_count
    FROM complaints c
    JOIN users u ON c.resident_id = u.id
    JOIN units un ON c.unit_id = un.id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ${limitNum} OFFSET ${offset}`,
    values
  );

  return {
    counts,
    complaints: rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      categoryLabel: r.category_label,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      replyCount: Number(r.reply_count || 0),
      resident: {
        id: r.resident_id,
        name: r.resident_name,
        phone: r.resident_phone,
      },
      unit: {
        id: r.unit_id,
        displayLabel: r.unit_label,
        blockName: r.block_name,
        floorNumber: r.floor_number,
      },
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: filteredTotal,
      totalPages: Math.ceil(filteredTotal / limitNum),
    },
  };
};

/**
 * 8. Secretary updates complaint status (in_progress, pending_closure, rejected)
 */
export const updateComplaintStatus = async (societyId, secretaryId, complaintId, payload) => {
  const { status, rejection_reason } = payload;

  const validTargetStatuses = ['in_progress', 'pending_closure', 'rejected'];
  if (!status || !validTargetStatuses.includes(status)) {
    throw {
      status: 400,
      message: `Invalid target status. Secretary can only update to: ${validTargetStatuses.join(', ')}. Direct closure must be confirmed by the resident.`,
    };
  }

  let finalRejectionReason = null;
  if (status === 'rejected') {
    if (!rejection_reason || typeof rejection_reason !== 'string' || rejection_reason.trim().length < 5) {
      throw { status: 400, message: 'rejection_reason is required when rejecting a complaint (min 5 characters).' };
    }
    finalRejectionReason = rejection_reason.trim();
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [complaints] = await connection.execute(
      'SELECT id, status FROM complaints WHERE id = ? AND society_id = ? FOR UPDATE',
      [complaintId, societyId]
    );

    if (complaints.length === 0) {
      throw { status: 404, message: 'Complaint not found.' };
    }

    const currentStatus = complaints[0].status;

    if (currentStatus === 'closed') {
      throw { status: 400, message: 'Cannot update status of an already closed complaint.' };
    }
    if (currentStatus === 'rejected') {
      throw { status: 400, message: 'Cannot update status of an already rejected complaint.' };
    }

    // Update status
    await connection.execute(
      'UPDATE complaints SET status = ?, rejection_reason = ? WHERE id = ?',
      [status, finalRejectionReason, complaintId]
    );

    // Insert system / secretary note
    let systemMessage = '';
    if (status === 'pending_closure') {
      systemMessage = 'Secretary marked this complaint as Pending Closure. Awaiting resident confirmation.';
    } else if (status === 'in_progress') {
      systemMessage = 'Secretary marked this complaint as In Progress.';
    } else if (status === 'rejected') {
      systemMessage = `Secretary rejected this complaint. Reason: ${finalRejectionReason}`;
    }

    await connection.execute(
      `INSERT INTO complaint_replies (complaint_id, sender_id, sender_role, message)
       VALUES (?, ?, 'secretary', ?)`,
      [complaintId, secretaryId, systemMessage]
    );

    await connection.commit();

    return {
      complaintId: Number(complaintId),
      status,
      rejectionReason: finalRejectionReason,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * 9. Secretary Complaint Analytics & Resolution Time
 */
export const getComplaintStats = async (societyId) => {
  const [statusResult, categoryResult, timeResult, topUnitsResult] = await Promise.all([
    // Counts by status
    pool.execute(
      `SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS count_open,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS count_in_progress,
        SUM(CASE WHEN status = 'pending_closure' THEN 1 ELSE 0 END) AS count_pending_closure,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS count_closed,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS count_rejected
      FROM complaints WHERE society_id = ?`,
      [societyId]
    ),
    // Counts by category
    pool.execute(
      `SELECT category, COUNT(*) AS count
       FROM complaints WHERE society_id = ?
       GROUP BY category`,
      [societyId]
    ),
    // Resolution time
    pool.execute(
      `SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, closed_at)) AS avg_hours
       FROM complaints WHERE society_id = ? AND status = 'closed' AND closed_at IS NOT NULL`,
      [societyId]
    ),
    // Top units with most complaints
    pool.execute(
      `SELECT u.id AS unit_id, u.display_label, COUNT(c.id) AS complaint_count
       FROM complaints c
       JOIN units u ON c.unit_id = u.id
       WHERE c.society_id = ?
       GROUP BY u.id, u.display_label
       ORDER BY complaint_count DESC
       LIMIT 5`,
      [societyId]
    ),
  ]);

  const sRow = statusResult[0][0];
  const avgHours = timeResult[0][0].avg_hours ? Number(parseFloat(timeResult[0][0].avg_hours).toFixed(1)) : 0;
  const avgDays = avgHours > 0 ? Number((avgHours / 24).toFixed(1)) : 0;

  const byCategory = {};
  categoryResult[0].forEach((row) => {
    byCategory[row.category] = Number(row.count);
  });

  return {
    summary: {
      total: Number(sRow.total || 0),
      open: Number(sRow.count_open || 0),
      inProgress: Number(sRow.count_in_progress || 0),
      pendingClosure: Number(sRow.count_pending_closure || 0),
      closed: Number(sRow.count_closed || 0),
      rejected: Number(sRow.count_rejected || 0),
    },
    byCategory,
    performance: {
      avgResolutionHours: avgHours,
      avgResolutionDays: avgDays,
    },
    topUnits: topUnitsResult[0].map((r) => ({
      unitId: r.unit_id,
      displayLabel: r.display_label,
      complaintCount: Number(r.complaint_count),
    })),
  };
};
```

---

### 6.3 New `complaints` Module: `complaints.controller.js`

Create `sahayak_backend/src/modules/complaints/complaints.controller.js`:

```javascript
import * as complaintsService from './complaints.service.js';
import { sendSuccess, sendError } from '../../utils/response.js';

export const createComplaint = async (req, res, next) => {
  try {
    const data = await complaintsService.createComplaint(
      req.user.societyId,
      req.user.userId,
      req.user.unitId,
      req.body
    );
    return sendSuccess(res, 201, 'Complaint raised successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const getMyComplaints = async (req, res, next) => {
  try {
    const data = await complaintsService.getMyComplaints(
      req.user.societyId,
      req.user.userId,
      req.query
    );
    return sendSuccess(res, 200, 'Complaints retrieved successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const getComplaintById = async (req, res, next) => {
  try {
    const data = await complaintsService.getComplaintById(
      req.user.societyId,
      req.user,
      req.params.id
    );
    return sendSuccess(res, 200, 'Complaint details retrieved.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const addReply = async (req, res, next) => {
  try {
    const data = await complaintsService.addReply(
      req.user.societyId,
      req.user,
      req.params.id,
      req.body
    );
    return sendSuccess(res, 201, 'Reply posted successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const confirmResolution = async (req, res, next) => {
  try {
    const data = await complaintsService.confirmResolution(
      req.user.societyId,
      req.user.userId,
      req.params.id,
      req.body.feedback
    );
    return sendSuccess(res, 200, 'Complaint closed successfully. Thank you for your feedback.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const reopenComplaint = async (req, res, next) => {
  try {
    const data = await complaintsService.reopenComplaint(
      req.user.societyId,
      req.user.userId,
      req.params.id,
      req.body.reason
    );
    return sendSuccess(res, 200, 'Complaint reopened and moved back to in progress.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const getSecretaryComplaints = async (req, res, next) => {
  try {
    const data = await complaintsService.getSecretaryComplaints(
      req.user.societyId,
      req.query
    );
    return sendSuccess(res, 200, 'Society complaints retrieved.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const updateComplaintStatus = async (req, res, next) => {
  try {
    const data = await complaintsService.updateComplaintStatus(
      req.user.societyId,
      req.user.userId,
      req.params.id,
      req.body
    );
    return sendSuccess(res, 200, 'Complaint status updated successfully.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};

export const getComplaintStats = async (req, res, next) => {
  try {
    const data = await complaintsService.getComplaintStats(req.user.societyId);
    return sendSuccess(res, 200, 'Complaint analytics retrieved.', data);
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message);
    next(error);
  }
};
```

---

### 6.4 New `complaints` Module: `complaints.routes.js`

Create `sahayak_backend/src/modules/complaints/complaints.routes.js`:

```javascript
import { Router } from 'express';
import * as complaintsController from './complaints.controller.js';
import { authenticateJWT } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';

const router = Router();

// All complaint routes require a valid active JWT
router.use(authenticateJWT);

// ==========================================
// 1. Resident Specific Routes
// ==========================================
router.post(
  '/',
  authorizeRoles('resident'),
  complaintsController.createComplaint
);

router.get(
  '/my',
  authorizeRoles('resident'),
  complaintsController.getMyComplaints
);

router.post(
  '/:id/confirm-resolved',
  authorizeRoles('resident'),
  complaintsController.confirmResolution
);

router.post(
  '/:id/reopen',
  authorizeRoles('resident'),
  complaintsController.reopenComplaint
);

// ==========================================
// 2. Shared Routes (Resident & Secretary)
// ==========================================
router.get(
  '/:id',
  authorizeRoles('resident', 'secretary'),
  complaintsController.getComplaintById
);

router.post(
  '/:id/replies',
  authorizeRoles('resident', 'secretary'),
  complaintsController.addReply
);

export default router;
```

#### Also Mount Secretary Complaint Endpoints in `secretary.routes.js`:
In `sahayak_backend/src/modules/secretary/secretary.routes.js`, add:
```javascript
import * as complaintsController from '../complaints/complaints.controller.js';

// Complaints Management (Secretary)
router.get('/complaints', complaintsController.getSecretaryComplaints);
router.patch('/complaints/:id/status', complaintsController.updateComplaintStatus);
router.get('/complaints/stats', complaintsController.getComplaintStats);
```

---

### 6.5 Update to `app.js`

In `sahayak_backend/src/app.js`:
```javascript
import complaintRoutes from './modules/complaints/complaints.routes.js';

// Mount complaints router
app.use('/api/v1/complaints', complaintRoutes);
```

---

## 7. Edge Cases & Testing Checklist

| # | Edge Case | Expected System Behavior |
|---|---|---|
| **1** | Reactivating resident with an occupied unit | Returns `409 Conflict` ("Unit is already occupied"). |
| **2** | Reactivating resident who is already active | Returns `400 Bad Request` ("Resident is already active"). |
| **3** | Raising a complaint with category `'other'` but empty `category_label` | Returns `400 Bad Request` ("category_label is required when category is 'other'"). |
| **4** | Resident trying to view or reply to someone else's complaint | Returns `403 Forbidden` ("You are not authorized to view this complaint"). |
| **5** | Posting a reply with empty message AND empty attachment | Returns `400 Bad Request` ("A reply must have either a message or an attachment"). |
| **6** | Secretary trying to directly set `status: 'closed'` | Returns `400 Bad Request` ("Secretary can only update to: in_progress, pending_closure, rejected. Direct closure must be confirmed by resident"). |
| **7** | Secretary rejecting complaint without `rejection_reason` | Returns `400 Bad Request` ("rejection_reason is required when rejecting a complaint"). |
| **8** | Replying to an already closed or rejected complaint | Returns `400 Bad Request` ("Cannot reply to a closed/rejected complaint"). |
| **9** | Reopening a complaint that is not in `pending_closure` | Returns `400 Bad Request` ("Only complaints in pending_closure can be reopened"). |
| **10**| Stale complaints older than 7 days in `pending_closure` | Auto-close cron sets `status = 'closed'`, `closed_at = NOW()`, and inserts `sender_role = 'system'` notification. |

---

> **Ready for Implementation!**
> Purvi can copy-paste and follow this guide section-by-section. All schemas, validations, role checks, and transaction boundaries match the Sahayak architecture standards.
