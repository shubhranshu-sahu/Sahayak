# Sahayak — Backend Implementation Guide Part 2 (Phase 1B: Lifecycle, Granular Controls & Dashboard)

> **For Backend Developer (Purvi)**:
> This guide extends [BACKEND_GUIDE.md](./BACKEND_GUIDE.md) with 9 new APIs and edge case fixes.
> All new endpoints follow the same patterns already established in the codebase:
> - Controller → Service → Raw SQL
> - `sendSuccess()` / `sendError()` from `utils/response.js`
> - `authenticateJWT` + `authorizeRoles('secretary')` middleware
> - Transactions (`pool.getConnection()` → `beginTransaction` → `commit/rollback`) for multi-table writes
>
> **References**:
> - [USER_DB.md](./USER_DB.md) — `users` table schema
> - [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) — `societies`, `blocks`, `floors`, `units` schemas
> - [FRONTEND_API_REFERENCE.md](./FRONTEND_API_REFERENCE.md) — Existing frontend-facing API docs

---

## Quick Reference — All New Endpoints

| # | Method | Endpoint | Module | Purpose |
|---|---|---|---|---|
| 1 | `POST` | `/api/v1/secretary/residents/:residentId/revoke` | `secretary` | Revoke an approved resident |
| 2 | `GET` | `/api/v1/secretary/residents/all` | `secretary` | List ALL residents (any status) with optional filter |
| 3 | `GET` | `/api/v1/secretary/dashboard/stats` | `secretary` | Dashboard summary statistics |
| 4 | `DELETE` | `/api/v1/society/blocks/:blockId` | `society` | Delete an empty block |
| 5 | `PUT` | `/api/v1/society/blocks/:blockId` | `society` | Rename a block |
| 6 | `DELETE` | `/api/v1/blocks/:blockId/floors/:floorId` | `structure` | Delete an empty floor |
| 7 | `DELETE` | `/api/v1/units/:unitId` | `structure` | Delete a vacant unit |
| 8 | `PUT` | `/api/v1/units/:unitId` | `structure` | Edit unit details |
| 9 | `GET` | `/api/v1/public/validate-code/:code` | `public` | Check if a society code is available |

---

## Existing Code Reference (Where to Add)

Current file structure for context:

```
sahayak_backend/src/
├── app.js                          # Express app — route mounts live here
├── modules/
│   ├── auth/
│   │   ├── auth.controller.js
│   │   ├── auth.service.js
│   │   └── auth.routes.js
│   ├── society/
│   │   ├── society.controller.js   # ← Add block delete/rename controllers here
│   │   ├── society.service.js      # ← Add block delete/rename services here
│   │   └── society.routes.js       # ← Add block delete/rename routes here
│   ├── structure/
│   │   ├── structure.controller.js # ← Add floor delete, unit delete/edit controllers here
│   │   ├── structure.service.js    # ← Add floor delete, unit delete/edit services here
│   │   └── structure.routes.js     # ← Add floor delete, unit delete/edit routes here
│   ├── public/
│   │   ├── public.controller.js    # ← Add code validation controller here
│   │   ├── public.service.js       # ← Add code validation service here
│   │   └── public.routes.js        # ← Add code validation route here
│   └── secretary/
│       ├── secretary.controller.js # ← Add revoke, all-residents, dashboard controllers here
│       ├── secretary.service.js    # ← Add revoke, all-residents, dashboard services here
│       └── secretary.routes.js     # ← Add revoke, all-residents, dashboard routes here
└── utils/
    └── response.js                 # sendSuccess(), sendError() — no changes needed
```

> **No new modules needed.** All 9 endpoints go into existing modules. No changes to `app.js` route mounts.

---

## Detailed API Specifications

---

### 👥 A. Resident Lifecycle APIs (Secretary Module)

These go into `secretary.service.js`, `secretary.controller.js`, `secretary.routes.js`.

---

#### 1. Revoke an Approved Resident

> **Why**: Secretary accidentally approved a wrong person, or a resident has moved out and needs to be deactivated. Currently there is NO way to undo an approval — once approved, the resident stays active forever.

- **Endpoint**: `POST /api/v1/secretary/residents/:residentId/revoke`
- **Access**: Private (Role: `secretary`)
- **Request Body**: None required
- **Transaction Business Logic**:
  1. Start MySQL Transaction.
  2. Lock and fetch resident:
     ```sql
     SELECT id, unit_id, status FROM users
     WHERE id = ? AND society_id = ? AND role = 'resident'
     FOR UPDATE;
     ```
  3. **Guard: Status check** — Only `active` residents can be revoked:
     - If not found → `404 Not Found` (`"Resident not found in your society"`)
     - If `status !== 'active'` → `400 Bad Request` (`"Cannot revoke resident with status '${status}'. Only active residents can be revoked."`)
  4. Update user status and clear unit reference:
     ```sql
     UPDATE users SET status = 'inactive', unit_id = NULL WHERE id = ?;
     ```
  5. Release unit back to vacant (if unit exists):
     ```sql
     UPDATE units SET status = 'vacant' WHERE id = ?;
     ```
  6. `COMMIT` transaction.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Resident access revoked and unit released to vacant."
  }
  ```
- **Error Cases**:
  - `404`: Resident not found or doesn't belong to this society
  - `400`: Resident is not in `active` status

> **Why `inactive` and not `rejected`?**
> `rejected` means "never approved in the first place." `inactive` means "was approved but access has been revoked." This distinction is important for audit trails and for the AI agent to understand resident history. It matches the `users.status` ENUM which already includes `inactive`.

> **Edge Case — What happens to the resident's login?**
> The `authenticateJWT` middleware already checks `if (status !== 'active')` and blocks with `403 Forbidden`. So a revoked resident will be immediately unable to access any private endpoint. Their existing JWT becomes useless on the next API call. No token blacklisting needed.

---

#### 2. List ALL Residents (With Status Filter)

> **Why**: Currently we have separate endpoints for `pending` and `active` residents. But there is NO way to see `rejected` or `inactive` (revoked) residents. The secretary needs a unified view for complete resident lifecycle management.

- **Endpoint**: `GET /api/v1/secretary/residents/all`
- **Access**: Private (Role: `secretary`)
- **Query Parameters** (all optional):
  - `status` — Filter by status: `pending`, `active`, `inactive`, `rejected`, or omit for all
- **Business Logic**:
  1. Base query fetches all residents in the secretary's society.
  2. If `status` query param is provided and is a valid value (`pending`, `active`, `inactive`, `rejected`), add `AND u.status = ?` filter.
  3. If `status` is provided but invalid, return `400 Bad Request` (`"Invalid status filter. Must be one of: pending, active, inactive, rejected"`).
  4. If `status` is omitted, return ALL residents regardless of status.
- **Query**:
  ```sql
  SELECT
      u.id AS user_id,
      u.name,
      u.email,
      u.phone,
      u.status,
      u.created_at AS registered_at,
      un.id AS unit_id,
      un.display_label,
      un.block_name,
      un.floor_number
  FROM users u
  LEFT JOIN units un ON u.unit_id = un.id
  WHERE u.society_id = ? AND u.role = 'resident'
  ORDER BY u.created_at DESC;
  ```
  *(Add `AND u.status = ?` dynamically if filter is provided.)*

> **Why `LEFT JOIN` instead of `JOIN`?**
> A rejected or revoked resident may have `unit_id = NULL` (after Fix 4/5 below clears it). `LEFT JOIN` ensures we never silently drop residents from the list just because their unit link is gone. Use `JOIN` only when you are certain the FK is always present.

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Residents retrieved",
    "data": [
      {
        "userId": 2,
        "name": "Rohan Sharma",
        "email": "rohan@example.com",
        "phone": "+919123456780",
        "status": "active",
        "registeredAt": "2026-09-26T15:47:49.000Z",
        "unit": {
          "id": 1,
          "displayLabel": "A-101",
          "block": "A",
          "floor": 1
        }
      },
      {
        "userId": 5,
        "name": "Priya Patel",
        "email": "priya@example.com",
        "phone": "+919000000000",
        "status": "rejected",
        "registeredAt": "2026-10-01T10:00:00.000Z",
        "unit": null
      }
    ]
  }
  ```

> **Note on existing endpoints**: The existing `GET /secretary/residents/pending` and `GET /secretary/residents` endpoints can remain as-is for backward compatibility. This new endpoint is a superset.

---

#### 3. Dashboard Statistics

> **Why**: The secretary dashboard currently shows nothing useful. This API powers the overview widgets showing occupancy, resident counts, and structure summary.

- **Endpoint**: `GET /api/v1/secretary/dashboard/stats`
- **Access**: Private (Role: `secretary`)
- **Request Body**: None
- **Business Logic**:
  Run 4 aggregate queries against the secretary's `societyId`. These are all simple COUNTs — no transactions needed.

  **Query 1 — Unit statistics**:
  ```sql
  SELECT
      COUNT(*) AS total_units,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied_units,
      SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant_units
  FROM units
  WHERE society_id = ?;
  ```

  **Query 2 — Block and floor counts**:
  ```sql
  SELECT
      (SELECT COUNT(*) FROM blocks WHERE society_id = ?) AS total_blocks,
      (SELECT COUNT(*) FROM floors WHERE society_id = ?) AS total_floors;
  ```

  **Query 3 — Resident statistics by status**:
  ```sql
  SELECT
      COUNT(*) AS total_residents,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_residents,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_residents,
      SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive_residents,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_residents
  FROM users
  WHERE society_id = ? AND role = 'resident';
  ```

  **Query 4 — Recent registrations (last 5)**:
  ```sql
  SELECT
      u.id AS user_id,
      u.name,
      u.status,
      u.created_at AS registered_at,
      un.display_label
  FROM users u
  LEFT JOIN units un ON u.unit_id = un.id
  WHERE u.society_id = ? AND u.role = 'resident'
  ORDER BY u.created_at DESC
  LIMIT 5;
  ```

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Dashboard statistics retrieved",
    "data": {
      "structure": {
        "totalBlocks": 3,
        "totalFloors": 30,
        "totalUnits": 120,
        "occupiedUnits": 45,
        "vacantUnits": 75,
        "occupancyRate": 37.5
      },
      "residents": {
        "total": 50,
        "pending": 3,
        "active": 45,
        "inactive": 1,
        "rejected": 1
      },
      "recentRegistrations": [
        {
          "userId": 52,
          "name": "Ankit Verma",
          "status": "pending",
          "registeredAt": "2026-10-02T10:30:00.000Z",
          "unitLabel": "B-205"
        }
      ]
    }
  }
  ```

> **`occupancyRate`**: Calculate at the application layer: `(occupiedUnits / totalUnits * 100)` rounded to 1 decimal. Handle division by zero — if `totalUnits === 0`, return `0`.

---

#### Route Registration

Add to `secretary.routes.js`:

```javascript
// --- New Phase 1B routes ---

// Resident lifecycle
router.post('/residents/:residentId/revoke', secretaryController.revokeResident);
router.get('/residents/all', secretaryController.getAllResidents);

// Dashboard
router.get('/dashboard/stats', secretaryController.getDashboardStats);
```

> **⚠️ IMPORTANT: Route ordering in Express matters!**
> The route `GET /residents/all` must be declared **BEFORE** any route with `:residentId` param pattern (if one exists on GET), otherwise Express would try to match `"all"` as a `residentId`. Currently there is no `GET /residents/:residentId`, so this is not an issue — but keep this in mind if you add one later.

---

### 🏢 B. Structure CRUD APIs

---

#### 4. Delete a Block

> **Why**: Secretary added a wrong block (e.g. typed "AB" instead of "A") during setup. Currently they cannot remove it — it stays forever.

- **Endpoint**: `DELETE /api/v1/society/blocks/:blockId`
- **Access**: Private (Role: `secretary`)
- **Request Body**: None
- **Business Logic**:
  1. Verify block belongs to `req.user.societyId`:
     ```sql
     SELECT id, block_name FROM blocks WHERE id = ? AND society_id = ?;
     ```
     If not found → `404 Not Found` (`"Block not found in your society"`)

  2. **Guard: Check if block has floors**:
     ```sql
     SELECT COUNT(*) AS floor_count FROM floors WHERE block_id = ?;
     ```
     If `floor_count > 0` → `409 Conflict` (`"Cannot delete block '${blockName}'. It has ${floorCount} floor(s). Delete all floors first."`)

  3. Delete the block:
     ```sql
     DELETE FROM blocks WHERE id = ? AND society_id = ?;
     ```

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Block 'AB' deleted successfully."
  }
  ```
- **Error Cases**:
  - `404`: Block not found or doesn't belong to this society
  - `409`: Block still has floors — cannot delete

> **Why not cascade delete?** Cascading would silently delete all floors → all units → orphan all residents linked to those units. That's catastrophic data loss. The `RESTRICT` FK on `blocks` already enforces this at the DB level. This API check gives a human-readable error before the DB even sees the query.

---

#### 5. Rename a Block

> **Why**: Secretary typed "AB" but meant "A". Without this, the only fix is delete + re-create (which requires deleting all floors and units first — extremely painful).

- **Endpoint**: `PUT /api/v1/society/blocks/:blockId`
- **Access**: Private (Role: `secretary`)
- **Request Body**:
  ```json
  {
    "block_name": "A"
  }
  ```
- **Business Logic**:
  1. Convert `block_name` to uppercase.
  2. Validate format: `/^[A-Z]+$/`. If invalid → `400 Bad Request` (`"Invalid block_name format. Only uppercase letters A-Z allowed."`)
  3. Verify block belongs to `req.user.societyId`:
     ```sql
     SELECT id, block_name FROM blocks WHERE id = ? AND society_id = ?;
     ```
     If not found → `404 Not Found`
  4. If new name === old name → return early with success (no-op).
  5. Check if the NEW name already exists in this society:
     ```sql
     SELECT id FROM blocks WHERE society_id = ? AND block_name = ? AND id != ?;
     ```
     If exists → `409 Conflict` (`"Block name '${newName}' already exists in this society."`)
  6. **Transaction — Update block AND propagate to all units**:
     ```sql
     START TRANSACTION;

     -- Update block name
     UPDATE blocks SET block_name = ? WHERE id = ?;

     -- Propagate to units (units.block_name is denormalized for display_label generation)
     UPDATE units SET block_name = ? WHERE block_id = ?;

     COMMIT;
     ```

     > **Critical**: The `units.display_label` is a MySQL `GENERATED ALWAYS AS (CONCAT(block_name, '-', ...)) STORED` column. When `units.block_name` is updated, MySQL **automatically recomputes** `display_label`. So updating `units.block_name` is sufficient — display labels like `AB-101` will automatically become `A-101`. No manual label update needed.

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Block renamed from 'AB' to 'A' successfully. All unit labels updated.",
    "data": {
      "id": 5,
      "blockName": "A",
      "unitsUpdated": 40
    }
  }
  ```

  > `unitsUpdated` comes from the `affectedRows` property of the second UPDATE query result.

---

#### Route Registration

Add to `society.routes.js`:

```javascript
// --- New Phase 1B routes ---
router.delete('/blocks/:blockId', societyController.deleteBlock);
router.put('/blocks/:blockId', societyController.renameBlock);
```

---

#### 6. Delete a Floor

> **Why**: Secretary added too many floors to a block. Currently they cannot remove extras.

- **Endpoint**: `DELETE /api/v1/blocks/:blockId/floors/:floorId`
- **Access**: Private (Role: `secretary`)
- **Request Body**: None
- **Business Logic**:
  1. Verify floor exists and belongs to the correct block + society:
     ```sql
     SELECT f.id, f.floor_number, f.block_id
     FROM floors f
     JOIN blocks b ON f.block_id = b.id
     WHERE f.id = ? AND f.block_id = ? AND b.society_id = ?;
     ```
     If not found → `404 Not Found` (`"Floor not found in this block."`)

  2. **Guard: Check if floor has units**:
     ```sql
     SELECT COUNT(*) AS unit_count FROM units WHERE floor_id = ?;
     ```
     If `unit_count > 0` → `409 Conflict` (`"Cannot delete floor ${floorNumber}. It has ${unitCount} unit(s). Delete all units on this floor first."`)

  3. Delete the floor:
     ```sql
     DELETE FROM floors WHERE id = ?;
     ```

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Floor 10 deleted from block 'A' successfully."
  }
  ```
- **Error Cases**:
  - `404`: Floor not found or doesn't belong to this block/society
  - `409`: Floor still has units — cannot delete

> **Note on floor number gaps**: If a block has floors 1-10 and floor 10 is deleted, the remaining floors are 1-9. If floor 5 is deleted, the remaining floors are 1-4 and 6-10 (there is a gap). This is FINE — `floor_number` is a label, not an array index. The display labels (`A-501`, `A-601`) remain correct. Do NOT renumber floors after deletion — that would change ALL display labels and break references.

---

#### 7. Delete a Unit

> **Why**: Unit needs to be removed — renovation, structural issue, or secretary made a setup mistake.

- **Endpoint**: `DELETE /api/v1/units/:unitId`
- **Access**: Private (Role: `secretary`)
- **Request Body**: None
- **Business Logic**:
  1. Verify unit exists and belongs to the secretary's society:
     ```sql
     SELECT id, status, display_label FROM units WHERE id = ? AND society_id = ?;
     ```
     If not found → `404 Not Found` (`"Unit not found in your society."`)

  2. **Guard: Check if unit is occupied**:
     If `status === 'occupied'` → `409 Conflict` (`"Cannot delete unit '${displayLabel}'. It is currently occupied by a resident. Revoke the resident first, then delete the unit."`)

  3. **Guard: Check if any user with active/pending status is still linked to this unit**:
     ```sql
     SELECT id, name, status FROM users WHERE unit_id = ? AND status IN ('pending', 'active');
     ```
     If any found → `409 Conflict` (`"Cannot delete unit. It has linked residents with active or pending status."`)

     > This covers an edge case: a `pending` resident is linked to the unit but hasn't been approved/rejected yet. The secretary must handle that resident before deleting the unit.

  4. Delete the unit:
     ```sql
     DELETE FROM units WHERE id = ?;
     ```

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Unit 'A-101' deleted successfully."
  }
  ```

> **Why not auto-revoke on delete?** Deleting an occupied unit should be a deliberate two-step operation. Silent auto-revoke risks accidentally displacing a resident. The secretary must consciously revoke the resident first (API #1), then delete the unit.

---

#### 8. Edit Unit Details

> **Why**: Secretary entered wrong `area_sqft` or `unit_type` during bulk creation. Also allows correcting details post-setup.

- **Endpoint**: `PUT /api/v1/units/:unitId`
- **Access**: Private (Role: `secretary`)
- **Request Body** (all fields optional — partial update):
  ```json
  {
    "unit_type": "villa",
    "area_sqft": 2500
  }
  ```
- **Business Logic**:
  1. Verify unit exists and belongs to the secretary's society:
     ```sql
     SELECT id, display_label FROM units WHERE id = ? AND society_id = ?;
     ```
     If not found → `404 Not Found`

  2. Validate inputs:
     - If `unit_type` is provided, verify it's one of: `apartment`, `villa`, `row_house`, `plot`, `other`. If invalid → `400 Bad Request` (`"Invalid unit_type. Must be one of: apartment, villa, row_house, plot, other."`)
     - If `area_sqft` is provided, verify it's a positive integer ≤ 65535 (`SMALLINT UNSIGNED` max). If invalid → `400 Bad Request` (`"area_sqft must be a positive integer up to 65535."`)

  3. Build dynamic update query (same pattern as `updateSocietyConfig` in `society.service.js`):
     ```javascript
     const updates = [];
     const values = [];

     if (unit_type !== undefined) {
       updates.push('unit_type = ?');
       values.push(unit_type);
     }
     if (area_sqft !== undefined) {
       updates.push('area_sqft = ?');
       values.push(area_sqft);
     }

     if (updates.length === 0) {
       // Nothing to update — return current unit data
     }

     values.push(unitId);
     const query = `UPDATE units SET ${updates.join(', ')} WHERE id = ?`;
     await pool.execute(query, values);
     ```

  4. Return updated unit details:
     ```sql
     SELECT id, display_label, unit_type, area_sqft, status FROM units WHERE id = ?;
     ```

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Unit 'A-101' updated successfully.",
    "data": {
      "id": 101,
      "displayLabel": "A-101",
      "unitType": "villa",
      "areaSqft": 2500,
      "status": "vacant"
    }
  }
  ```

> **What about changing `unit_number`?**
> NOT supported. Changing `unit_number` would alter the `display_label` (a generated column) and break all references (user records, any future complaint records). If the unit number is wrong, the correct flow is: delete the unit → create a new one with the correct number.

---

#### Route Registration

Add to `structure.routes.js`:

```javascript
// --- New Phase 1B routes ---
router.delete('/blocks/:blockId/floors/:floorId', structureController.deleteFloor);
router.delete('/units/:unitId', structureController.deleteUnit);
router.put('/units/:unitId', structureController.editUnit);
```

---

### 🌐 C. Public API Addition

---

#### 9. Validate Society Code Availability

> **Why**: During society setup (Step 1), the secretary types a society code. Currently they only find out it's taken AFTER submitting the form. This endpoint enables real-time validation as they type, with frontend debouncing.

- **Endpoint**: `GET /api/v1/public/validate-code/:code`
- **Access**: Public (no auth required)
- **Request Body**: None
- **Business Logic**:
  1. Convert `:code` param to uppercase.
  2. Validate format: `/^[A-Z][A-Z-]{2,19}$/`. If invalid → `400 Bad Request` (`"Invalid code format. Must be 3-20 uppercase characters (A-Z and hyphens only), starting with a letter."`)
  3. Check existence:
     ```sql
     SELECT id FROM societies WHERE society_code = ?;
     ```
  4. Return availability.

- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Society code is available",
    "data": {
      "code": "SUNRISE-DEL",
      "available": true
    }
  }
  ```
  Or if taken:
  ```json
  {
    "success": true,
    "message": "Society code is already taken",
    "data": {
      "code": "SUNRISE-DEL",
      "available": false
    }
  }
  ```

> **Security note**: This is public so it "leaks" which society codes exist. This is acceptable because society codes are already visible through `GET /public/societies` (which lists all active societies with their codes). No new information is exposed.

---

#### Route Registration

Add to `public.routes.js`:

```javascript
// Society code validation
router.get('/validate-code/:code', publicController.validateSocietyCode);
```

---

## Edge Case Fixes for Existing APIs

These are not new endpoints — they are fixes/improvements to existing code.

---

### Fix 1 — Bulk Unit Creation: Return `skipped` count

**File**: `structure.service.js` → `bulkAddUnits()` (around line 117)

**Current Behavior**: When units in the requested range already exist, the code silently skips them (`continue` on line 87). The response shows `unitsCreated` but does NOT tell the secretary how many were skipped. This is confusing — the secretary requests "add units 1-10" and gets back `unitsCreated: 3` with no explanation of what happened to the other 7.

**Fix**: Track and return skipped units.

```diff
 // In the return object (around line 117-121):
 return {
   floorId: Number(floorId),
   unitsCreated,
+  unitsSkipped: (end_unit - start_unit + 1) - unitsCreated,
   exampleLabel: exampleLabel || 'N/A'
 };
```

And in `structure.controller.js`, adjust the response message:

```javascript
const totalRequested = payload.end_unit - payload.start_unit + 1;
let message = `${data.unitsCreated} unit(s) created successfully.`;
if (data.unitsSkipped > 0) {
  message += ` ${data.unitsSkipped} unit(s) already existed and were skipped.`;
}
return sendSuccess(res, 201, message, data);
```

---

### Fix 2 — Bulk Floor Creation: Return informative range

**File**: `structure.service.js` → `bulkAddFloors()` (around line 40-43)

**Current Behavior**: The response shows `floorsCreated: N` but doesn't tell the secretary what floor numbers were actually created (e.g., "floors 6-10 created" when 1-5 already existed).

**Fix**: Include start/end floor numbers in response.

```diff
 return {
   blockId: Number(blockId),
   floorsCreated: total_floors,
+  floorRange: {
+    from: startFloor,
+    to: startFloor + total_floors - 1
+  }
 };
```

Controller message update:

```javascript
return sendSuccess(res, 201,
  `${data.floorsCreated} floor(s) created (floors ${data.floorRange.from}-${data.floorRange.to}).`,
  data
);
```

---

### Fix 3 — Resident Registration: Better duplicate unit handling

**File**: `auth.service.js` → resident registration logic

**Current Behavior**: If a unit is already `occupied`, the registration returns `409 Conflict` with `"This unit is already claimed/occupied"`. But this doesn't tell the registering resident WHAT to do about it.

**Fix**: Improve the error message to be more helpful:

```diff
- throw { status: 409, message: 'This unit is already claimed/occupied' };
+ throw { status: 409, message: 'This unit is already claimed or occupied by another resident. Please select a different unit, or contact your society secretary if you believe this is an error.' };
```

---

### Fix 4 — Reject Endpoint: Clear the rejected user's `unit_id`

**File**: `secretary.service.js` → `rejectResident()` (around line 90)

**Current Behavior**: When a resident is rejected, their `unit_id` on the `users` table still points to the unit (even though the unit is released back to `vacant`). This creates a stale reference — a rejected user row still points to a unit they have no claim to.

**Fix**: Also set `unit_id = NULL` on the rejected user.

```diff
 // Update user status to rejected (line 90-93)
 await connection.execute(
-  'UPDATE users SET status = ? WHERE id = ?',
-  ['rejected', residentId]
+  'UPDATE users SET status = ?, unit_id = NULL WHERE id = ?',
+  ['rejected', residentId]
 );
```

> **Why**: This ensures that when we list all residents (`GET /residents/all`), rejected residents don't show stale unit references. It also ensures the `LEFT JOIN` on units returns `null` cleanly for rejected users, which is the correct semantic — they have NO unit.

---

### Fix 5 — Revoke Endpoint: Also clear `unit_id`

Same logic as Fix 4. When revoking an active resident (new API #1 above), the `UPDATE` query already includes `unit_id = NULL`:

```sql
UPDATE users SET status = 'inactive', unit_id = NULL WHERE id = ?;
```

This is already specified in API #1's business logic above. Calling it out here for completeness — do NOT forget the `unit_id = NULL` part when implementing.

---

## Updated Endpoint Summary Table (After Phase 1B)

After implementing all 9 new endpoints, the complete API surface becomes:

| # | Category | Method | Endpoint | Status |
|---|---|---|---|---|
| 1 | Health | `GET` | `/api/health` | ✅ Existing |
| 2 | Auth | `POST` | `/api/v1/auth/register/secretary` | ✅ Existing |
| 3 | Auth | `POST` | `/api/v1/auth/register/resident` | ✅ Existing (+ Fix 3) |
| 4 | Auth | `POST` | `/api/v1/auth/login` | ✅ Existing |
| 5 | Auth | `GET` | `/api/v1/auth/me` | ✅ Existing |
| 6 | Public | `GET` | `/api/v1/public/societies` | ✅ Existing |
| 7 | Public | `GET` | `/api/v1/public/societies/:id/blocks` | ✅ Existing |
| 8 | Public | `GET` | `/api/v1/public/blocks/:id/floors` | ✅ Existing |
| 9 | Public | `GET` | `/api/v1/public/floors/:id/units` | ✅ Existing |
| 10 | **Public** | `GET` | `/api/v1/public/validate-code/:code` | 🆕 **New** |
| 11 | Society | `POST` | `/api/v1/society/setup` | ✅ Existing |
| 12 | Society | `GET` | `/api/v1/society/setup` | ✅ Existing |
| 13 | Society | `PUT` | `/api/v1/society/setup` | ✅ Existing |
| 14 | Society | `POST` | `/api/v1/society/blocks` | ✅ Existing |
| 15 | **Society** | `DELETE` | `/api/v1/society/blocks/:blockId` | 🆕 **New** |
| 16 | **Society** | `PUT` | `/api/v1/society/blocks/:blockId` | 🆕 **New** |
| 17 | Structure | `POST` | `/api/v1/blocks/:id/floors/bulk` | ✅ Existing (+ Fix 2) |
| 18 | Structure | `POST` | `/api/v1/floors/:id/units/bulk` | ✅ Existing (+ Fix 1) |
| 19 | **Structure** | `DELETE` | `/api/v1/blocks/:blockId/floors/:floorId` | 🆕 **New** |
| 20 | **Structure** | `DELETE` | `/api/v1/units/:unitId` | 🆕 **New** |
| 21 | **Structure** | `PUT` | `/api/v1/units/:unitId` | 🆕 **New** |
| 22 | Structure | `GET` | `/api/v1/society/structure` | ✅ Existing |
| 23 | Secretary | `GET` | `/api/v1/secretary/residents/pending` | ✅ Existing |
| 24 | Secretary | `POST` | `/api/v1/secretary/residents/:id/approve` | ✅ Existing |
| 25 | Secretary | `POST` | `/api/v1/secretary/residents/:id/reject` | ✅ Existing (+ Fix 4) |
| 26 | Secretary | `GET` | `/api/v1/secretary/residents` | ✅ Existing |
| 27 | **Secretary** | `POST` | `/api/v1/secretary/residents/:id/revoke` | 🆕 **New** |
| 28 | **Secretary** | `GET` | `/api/v1/secretary/residents/all` | 🆕 **New** |
| 29 | **Secretary** | `GET` | `/api/v1/secretary/dashboard/stats` | 🆕 **New** |

**Total: 29 endpoints (20 existing + 9 new)**

---

## Implementation Checklist for Purvi

### New APIs
- [ ] **API #1**: Implement `revokeResident` in `secretary.service.js` with transaction (user `inactive` + unit `vacant` + clear `unit_id`)
- [ ] **API #2**: Implement `getAllResidents` in `secretary.service.js` with optional status filter and `LEFT JOIN`
- [ ] **API #3**: Implement `getDashboardStats` in `secretary.service.js` with 4 aggregate queries
- [ ] **API #4**: Implement `deleteBlock` in `society.service.js` with floor-count guard
- [ ] **API #5**: Implement `renameBlock` in `society.service.js` with transaction (block name + unit `block_name` propagation)
- [ ] **API #6**: Implement `deleteFloor` in `structure.service.js` with unit-count guard
- [ ] **API #7**: Implement `deleteUnit` in `structure.service.js` with occupied/linked-resident guards
- [ ] **API #8**: Implement `editUnit` in `structure.service.js` with dynamic update pattern
- [ ] **API #9**: Implement `validateSocietyCode` in `public.service.js`

### Edge Case Fixes
- [ ] **Fix #1**: Add `unitsSkipped` to bulk unit creation response in `structure.service.js`
- [ ] **Fix #2**: Add `floorRange` to bulk floor creation response in `structure.service.js`
- [ ] **Fix #3**: Improve duplicate unit error message in `auth.service.js`
- [ ] **Fix #4**: Clear `unit_id = NULL` when rejecting a resident in `secretary.service.js` line ~90
- [ ] **Fix #5**: Ensure revoke (API #1) includes `unit_id = NULL` in the UPDATE query

### Routes
- [ ] Register new routes in `secretary.routes.js` (revoke, all-residents, dashboard-stats)
- [ ] Register new routes in `society.routes.js` (delete block, rename block)
- [ ] Register new routes in `structure.routes.js` (delete floor, delete unit, edit unit)
- [ ] Register new route in `public.routes.js` (validate-code)

### Testing
- [ ] Verify all deletion guards work (cannot delete block with floors, floor with units, occupied unit)
- [ ] Verify block rename propagates `block_name` to all units and `display_label` auto-updates by MySQL
- [ ] Verify revoke sets user to `inactive` (not `rejected`) and clears `unit_id`
- [ ] Verify dashboard stats return `0` occupancy rate when no units exist (division by zero guard)
- [ ] Verify `GET /residents/all` with `?status=invalid_value` returns `400`
- [ ] Verify `GET /residents/all` without query params returns all statuses
