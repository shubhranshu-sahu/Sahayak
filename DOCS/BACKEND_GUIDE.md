# Sahayak — Backend Implementation Guide (Phase 1: Auth & Structure)

> **Important Context for Backend Developer & Coding Agent**:
> - The root `README.md` serves as a broad initial roadmap and design intent. However, **do not rely on the README for database schemas or exact data logic**.
> - The finalized, verified single sources of truth are:
>   1. [USER_DB.md](./USER_DB.md) — Covers the `users` table schema, constraints, role statuses, and doubts.
>   2. [SOCIETY_STRUCTURE_DB.md](./SOCIETY_STRUCTURE_DB.md) — Covers `societies`, `blocks`, `floors`, `units`, generated columns, and physical structure.
> - **Email Verification Note**: Email verification (`is_email_verified`) is **deferred** for now. All newly registered users must have `is_email_verified = TRUE` defaulted at the application layer on insertion unless otherwise stated.

---

## 1. Phase 1 Overview & Scope

In Phase 1, the backend service must implement:
1. **Authentication & JWT Session Management** for Secretaries and Residents.
2. **Society Onboarding & Structure Management** (Blocks, Floors, Bulk Units).
3. **Public Discovery Endpoints** (Cascading dropdowns: Society Code → Blocks → Floors → Units).
4. **Resident Registration & Secretary Approval Flow** with transactional integrity.

---

## 2. Recommended Project Structure

Maintain a clean, layered architecture (Controller-Service-Repository/Model pattern):

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js              # MySQL2 connection pool
│   │   └── env.js             # Validated environment variables
│   ├── middlewares/
│   │   ├── auth.middleware.js # JWT verification + society active checks
│   │   ├── role.middleware.js # Role-based access control (secretary, resident, super_admin)
│   │   ├── validate.js        # Request schema validation (Zod / Joi / custom)
│   │   └── error.middleware.js# Centralized error handler
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js
│   │   │   └── auth.routes.js
│   │   ├── society/
│   │   │   ├── society.controller.js
│   │   │   ├── society.service.js
│   │   │   └── society.routes.js
│   │   ├── structure/
│   │   │   ├── structure.controller.js
│   │   │   ├── structure.service.js
│   │   │   └── structure.routes.js
│   │   ├── public/
│   │   │   ├── public.controller.js
│   │   │   ├── public.service.js
│   │   │   └── public.routes.js
│   │   └── secretary/
│   │       ├── secretary.controller.js
│   │       ├── secretary.service.js
│   │       └── secretary.routes.js
│   ├── utils/
│   │   ├── response.js        # Standardized API response helper
│   │   └── password.js        # bcrypt hashing helpers
│   ├── app.js                 # Express app initialization
│   └── server.js              # Entry point (listens on PORT)
├── .env.example
├── package.json
└── README.md
```

---

## 3. Standard API Response Envelope

All endpoints must return consistent JSON structures:

### Success Response (`200 OK`, `201 Created`)
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... }
}
```

### Error Response (`400`, `401`, `403`, `404`, `500`)
```json
{
  "success": false,
  "message": "Human readable error description",
  "error": "SPECIFIC_ERROR_CODE_OR_DETAILS"
}
```

---

## 4. Auth, JWT & Security Middleware Logic

### JWT Token Payload
When a user logs in, issue a JWT signed with `JWT_SECRET` containing:
```json
{
  "userId": 1,
  "role": "secretary",         // 'super_admin' | 'secretary' | 'resident'
  "societyId": 10,             // null for super_admin or secretary before setup
  "status": "active"
}
```

### `authenticateJWT` Middleware
1. Read `Authorization: Bearer <token>` header.
2. Verify token signature and expiry.
3. Fetch user record from database (`SELECT id, role, society_id, status FROM users WHERE id = ?`).
4. **Account Status Check**:
   - If `status !== 'active'`, reject with `403 Forbidden` (`"Account is not active"`).
5. **Society Suspension Check**:
   - If `user.society_id` is present, check `societies.is_active`.
   - If `is_active === FALSE`, reject with `403 Forbidden` (`"Society access has been suspended"`).
6. Attach `req.user = user` to the request.

### `authorizeRoles(...roles)` Middleware
Check if `roles.includes(req.user.role)`. If not, return `403 Forbidden` (`"Access forbidden for this role"`).

---

## 5. Phase 1 Complete API Specifications

Base URL prefix: `/api/v1`

---

### 🔐 A. Authentication Endpoints

#### 1. Secretary Registration
- **Endpoint**: `POST /api/v1/auth/register/secretary`
- **Access**: Public
- **Request Body**:
  ```json
  {
    "name": "Shubhranshu Sahu",
    "email": "shub@example.com",
    "phone": "+919876543210",
    "password": "SecurePassword123"
  }
  ```
- **Business Logic**:
  1. Check if email already exists (`uq_users_email`). If exists, return `409 Conflict`.
  2. Hash password with `bcrypt` (salt rounds: 10).
  3. Insert into `users`:
     - `role`: `'secretary'`
     - `society_id`: `NULL`
     - `unit_id`: `NULL`
     - `status`: `'active'`
     - `is_email_verified`: `TRUE`
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "Secretary registered successfully. Please proceed to society setup.",
    "data": {
      "userId": 1,
      "name": "Shubhranshu Sahu",
      "email": "shub@example.com",
      "role": "secretary"
    }
  }
  ```

---

#### 2. User Login (Secretary & Resident)
- **Endpoint**: `POST /api/v1/auth/login`
- **Access**: Public
- **Request Body**:
  ```json
  {
    "email": "shub@example.com",
    "password": "SecurePassword123"
  }
  ```
- **Business Logic**:
  1. Find user by email. If not found, return `401 Unauthorized` (`"Invalid email or password"`).
  2. Verify password hash using `bcrypt.compare`. If mismatch, return `401 Unauthorized`.
  3. Check account `status`:
     - `pending`: Return `403 Forbidden` (`"Registration pending secretary approval."`).
     - `rejected`: Return `403 Forbidden` (`"Your registration request was rejected by the society secretary."`).
     - `inactive`: Return `403 Forbidden` (`"Your account has been deactivated."`).
  4. If `user.society_id` is set, verify `societies.is_active`. If `FALSE`, return `403 Forbidden` (`"Society access is suspended."`).
  5. Generate JWT token (expires in e.g. `7d`).
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
      "user": {
        "id": 1,
        "name": "Shubhranshu Sahu",
        "email": "shub@example.com",
        "role": "secretary",
        "societyId": 12,
        "unitId": null
      }
    }
  }
  ```

---

#### 3. Current User Profile
- **Endpoint**: `GET /api/v1/auth/me`
- **Access**: Private (`authenticateJWT`)
- **Business Logic**:
  Return user profile details. If resident, include society name and unit `display_label`.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "id": 1,
      "name": "Rohan Sharma",
      "email": "rohan@example.com",
      "phone": "+919876543210",
      "role": "resident",
      "society": {
        "id": 12,
        "name": "Sunrise Apartments",
        "societyCode": "SUNRISE-DEL"
      },
      "unit": {
        "id": 45,
        "displayLabel": "A-101",
        "blockName": "A",
        "floorNumber": 1
      }
    }
  }
  ```

---

### 🏢 B. Society Setup & Structure (Secretary Only)

#### 1. Society Onboarding
- **Endpoint**: `POST /api/v1/society/setup`
- **Access**: Private (Role: `secretary` only)
- **Request Body**:
  ```json
  {
    "name": "Sunrise Apartments",
    "society_code": "SUNRISE-DEL",
    "address": "Plot 14, Sector 21, Dwarka",
    "city": "New Delhi",
    "state": "Delhi",
    "pincode": "110075",
    "metadata": {
      "registration_number": "RWA-DEL-2022",
      "contact_email": "secretary@sunrise.com"
    }
  }
  ```
- **Business Logic**:
  1. Validate `society_code` format: Uppercase `A-Z` and `-` only (`^[A-Z][A-Z-]{2,19}$`).
  2. Verify that this secretary does not already own a society (`uq_societies_secretary`).
  3. Insert into `societies` table with `secretary_id = req.user.userId`.
  4. Update `users` table setting `society_id = newSociety.id` for the secretary.
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "Society created successfully",
    "data": {
      "societyId": 12,
      "name": "Sunrise Apartments",
      "societyCode": "SUNRISE-DEL"
    }
  }
  ```

---

#### 2. Fetch Society Setup Configuration (Added by Frontend / Vansh)
> **Why Added**: When a secretary logs in or returns to the Society Setup screen / Dashboard, the frontend needs to fetch existing society details to pre-populate Step 1 (Society Information) so the secretary does not see empty inputs.
- **Endpoint**: `GET /api/v1/society/setup`
- **Access**: Private (Role: `secretary`)
- **Business Logic**:
  1. Ensure secretary has an associated society (`req.user.societyId`). If null, return `404 Not Found` (`"No society found for this secretary"`).
  2. Fetch society record from `societies` table (`id`, `secretary_id`, `name`, `society_code`, `address`, `city`, `state`, `pincode`, `is_active`, `metadata`).
  3. Safely parse `metadata` if stored as JSON string.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Society configuration retrieved",
    "data": {
      "id": 1,
      "secretary_id": 1,
      "name": "Sunrise Apartments",
      "society_code": "SUNRISE-DEL",
      "address": "Plot 14, Sector 21, Dwarka",
      "city": "New Delhi",
      "state": "Delhi",
      "pincode": "110075",
      "is_active": 1,
      "metadata": {
        "registration_number": "RWA-DEL-2022",
        "contact_email": "secretary@sunrise.com"
      }
    }
  }
  ```

---

#### 3. Update Society Configuration (Added by Frontend / Vansh)
> **Why Added**: If the secretary edits society details (e.g. address, registration number, or pincode) on re-visiting the form, calling `POST` would fail due to the `uq_societies_secretary` and `society_code` unique constraints. This `PUT` endpoint enables safe, partial in-place updates.
- **Endpoint**: `PUT /api/v1/society/setup`
- **Access**: Private (Role: `secretary`)
- **Request Body** (All fields optional):
  ```json
  {
    "name": "Sunrise Apartments Updated",
    "society_code": "SUNRISE-DEL",
    "address": "Plot 14, Sector 21, Dwarka",
    "city": "New Delhi",
    "state": "Delhi",
    "pincode": "110076",
    "metadata": {
      "registration_number": "RWA-DEL-2022",
      "contact_email": "secretary@sunrise.com"
    }
  }
  ```
- **Business Logic**:
  1. Ensure secretary has `req.user.societyId`.
  2. If `society_code` is provided:
     - Validate format (`^[A-Z][A-Z-]{2,19}$`).
     - Check if another society already uses this code (`SELECT id FROM societies WHERE society_code = ? AND id != ?`). If yes, return `409 Conflict`.
  3. Dynamically update modified columns (`name`, `society_code`, `address`, `city`, `state`, `pincode`, `metadata`).
  4. Return the refreshed society configuration.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Society configuration updated",
    "data": {
      "id": 1,
      "name": "Sunrise Apartments Updated",
      "society_code": "SUNRISE-DEL",
      "address": "Plot 14, Sector 21, Dwarka",
      "city": "New Delhi",
      "state": "Delhi",
      "pincode": "110076",
      "metadata": {
        "registration_number": "RWA-DEL-2022",
        "contact_email": "secretary@sunrise.com"
      }
    }
  }
  ```

---

#### 4. Add Block
- **Endpoint**: `POST /api/v1/society/blocks`
- **Access**: Private (Role: `secretary`)
- **Request Body**:
  ```json
  {
    "block_name": "A"
  }
  ```
- **Business Logic**:
  1. Convert `block_name` to uppercase (`.toUpperCase()`).
  2. Validate `block_name` format (`^[A-Z]+$`).
  3. Insert into `blocks` with `society_id = req.user.societyId`.
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "Block created successfully",
    "data": {
      "id": 5,
      "societyId": 12,
      "blockName": "A"
    }
  }
  ```

---

#### 5. Add Single Floor or Bulk Floors to Block
- **Endpoint**: `POST /api/v1/blocks/:blockId/floors/bulk`
- **Access**: Private (Role: `secretary`)
- **Request Body**:
  ```json
  {
    "total_floors": 10
  }
  ```
- **Business Logic**:
  1. Verify `blockId` belongs to `req.user.societyId`.
  2. In a transaction, insert rows for floor numbers `1` through `total_floors` into `floors` table (`block_id`, `society_id`, `floor_number`).
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "10 floors created successfully",
    "data": {
      "blockId": 5,
      "floorsCreated": 10
    }
  }
  ```

---

#### 6. Bulk Add Units on a Floor
- **Endpoint**: `POST /api/v1/floors/:floorId/units/bulk`
- **Access**: Private (Role: `secretary`)
- **Request Body**:
  ```json
  {
    "start_unit": 1,
    "end_unit": 20,
    "unit_type": "apartment",
    "area_sqft": 1250
  }
  ```
- **Business Logic**:
  1. Fetch `floor` details and ensure it belongs to `req.user.societyId`. Also retrieve `block_name` and `floor_number`.
  2. Validate `start_unit >= 1` and `end_unit <= 99`.
  3. In a transaction, bulk insert units into `units` table:
     - `floor_id`, `block_id`, `society_id`
     - `block_name`, `floor_number`, `unit_number` (loop from start to end)
     - `unit_type`: `'apartment'`
     - `area_sqft`: `1250`
     - `status`: `'vacant'`
     - `display_label` will be auto-generated by MySQL as `STORED` column (e.g. `A-101` to `A-120`).
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "20 units created successfully on floor 1",
    "data": {
      "floorId": 10,
      "unitsCreated": 20,
      "exampleLabel": "A-101"
    }
  }
  ```

---

#### 7. Get Complete Society Structure Tree
- **Endpoint**: `GET /api/v1/society/structure`
- **Access**: Private (Role: `secretary`)
- **Business Logic**:
  Query and return nested hierarchy of Blocks → Floors → Units with occupancy statuses.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "societyId": 12,
      "name": "Sunrise Apartments",
      "blocks": [
        {
          "id": 5,
          "blockName": "A",
          "floors": [
            {
              "id": 10,
              "floorNumber": 1,
              "units": [
                {
                  "id": 101,
                  "unitNumber": 1,
                  "displayLabel": "A-101",
                  "status": "vacant",
                  "areaSqft": 1250
                }
              ]
            }
          ]
        }
      ]
    }
  }
  ```

---

### 🌐 C. Public Discovery Endpoints (For Resident Registration Dropdowns)

*These endpoints are completely public to power the cascading registration dropdowns on the frontend.*

#### 1. List All Active Societies
- **Endpoint**: `GET /api/v1/public/societies`
- **Access**: Public
- **Business Logic**:
  `SELECT id, name, society_code, city, state FROM societies WHERE is_active = TRUE;`
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 12,
        "name": "Sunrise Apartments",
        "societyCode": "SUNRISE-DEL",
        "city": "New Delhi"
      }
    ]
  }
  ```

---

#### 2. Get Blocks in Society
- **Endpoint**: `GET /api/v1/public/societies/:societyId/blocks`
- **Access**: Public
- **Query**:
  `SELECT id, block_name FROM blocks WHERE society_id = ? ORDER BY block_name ASC;`

---

#### 3. Get Floors in Block
- **Endpoint**: `GET /api/v1/public/blocks/:blockId/floors`
- **Access**: Public
- **Query**:
  `SELECT id, floor_number FROM floors WHERE block_id = ? ORDER BY floor_number ASC;`

---

#### 4. Get Units on Floor (With Availability Status)
- **Endpoint**: `GET /api/v1/public/floors/:floorId/units`
- **Access**: Public
- **Business Logic**:
  Return **all** units on the floor so the resident can see them, but clearly indicate `status` (`vacant` vs `occupied`).
  - Frontend UX: If `status === 'occupied'`, disable selection but allow user to search/see it.
- **Query**:
  `SELECT id, unit_number, display_label, unit_type, status FROM units WHERE floor_id = ? ORDER BY unit_number ASC;`
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 101,
        "unitNumber": 1,
        "displayLabel": "A-101",
        "status": "vacant",
        "isSelectable": true
      },
      {
        "id": 102,
        "unitNumber": 2,
        "displayLabel": "A-102",
        "status": "occupied",
        "isSelectable": false
      }
    ]
  }
  ```

---

### 👥 D. Resident Registration & Secretary Approval Flow

#### 1. Resident Registration (With Atomic Transaction)
- **Endpoint**: `POST /api/v1/auth/register/resident`
- **Access**: Public
- **Request Body**:
  ```json
  {
    "name": "Pooja Verma",
    "email": "pooja@example.com",
    "phone": "+919123456780",
    "password": "SecurePassword123",
    "society_id": 12,
    "unit_id": 101
  }
  ```
- **Transaction Business Logic**:
  1. Check email uniqueness (`users.email`). If exists, return `409 Conflict`.
  2. Start MySQL Transaction (`START TRANSACTION`):
     - **Lock and verify unit**:
       `SELECT id, society_id, status FROM units WHERE id = ? FOR UPDATE;`
     - If unit does not exist or `unit.society_id !== payload.society_id`, rollback and return `400 Bad Request`.
     - If `unit.status !== 'vacant'`, rollback and return `409 Conflict` (`"This unit is already claimed/occupied"`).
     - **Hash password** (`bcrypt`).
     - **Insert resident user**:
       ```sql
       INSERT INTO users (role, society_id, unit_id, name, email, phone, password_hash, status, is_email_verified)
       VALUES ('resident', ?, ?, ?, ?, ?, ?, 'pending', TRUE);
       ```
     - **Reserve Unit**:
       ```sql
       UPDATE units SET status = 'occupied' WHERE id = ?;
       ```
     - `COMMIT` transaction.
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "message": "Registration submitted successfully. Awaiting approval from society secretary.",
    "data": {
      "userId": 44,
      "name": "Pooja Verma",
      "status": "pending"
    }
  }
  ```

---

#### 2. List Pending Resident Approvals (Secretary Only)
- **Endpoint**: `GET /api/v1/secretary/residents/pending`
- **Access**: Private (Role: `secretary`)
- **Business Logic**:
  Fetch all residents in the secretary's society with `status = 'pending'`.
- **Query**:
  ```sql
  SELECT 
      u.id AS user_id,
      u.name,
      u.email,
      u.phone,
      u.created_at AS registered_at,
      un.id AS unit_id,
      un.display_label,
      un.block_name,
      un.floor_number
  FROM users u
  JOIN units un ON u.unit_id = un.id
  WHERE u.society_id = ? AND u.role = 'resident' AND u.status = 'pending'
  ORDER BY u.created_at ASC;
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "userId": 44,
        "name": "Pooja Verma",
        "email": "pooja@example.com",
        "phone": "+919123456780",
        "registeredAt": "2026-08-25T00:15:00Z",
        "unit": {
          "id": 101,
          "displayLabel": "A-101",
          "block": "A",
          "floor": 1
        }
      }
    ]
  }
  ```

---

#### 3. Approve Resident Request
- **Endpoint**: `POST /api/v1/secretary/residents/:residentId/approve`
- **Access**: Private (Role: `secretary`)
- **Business Logic**:
  1. Ensure `residentId` exists, belongs to `req.user.societyId`, and has `status = 'pending'`.
  2. Update `users SET status = 'active' WHERE id = ?;`
  3. (Unit is already marked `occupied` from registration).
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Resident approved successfully. They can now log in."
  }
  ```

---

#### 4. Reject Resident Request (With Unit Rollback Transaction)
- **Endpoint**: `POST /api/v1/secretary/residents/:residentId/reject`
- **Access**: Private (Role: `secretary`)
- **Transaction Business Logic**:
  1. Start MySQL Transaction:
     - Fetch resident: `SELECT id, unit_id, status FROM users WHERE id = ? AND society_id = ? FOR UPDATE;`
     - If not found or `status !== 'pending'`, rollback and return `400 Bad Request`.
     - Update user status:
       `UPDATE users SET status = 'rejected' WHERE id = ?;`
     - **Rollback unit status to vacant**:
       `UPDATE units SET status = 'vacant' WHERE id = ?;`
     - `COMMIT` transaction.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "Resident registration rejected and unit released to vacant."
  }
  ```

---

#### 5. List All Active Residents in Society
- **Endpoint**: `GET /api/v1/secretary/residents`
- **Access**: Private (Role: `secretary`)
- **Business Logic**:
  Fetch all approved residents in the secretary's society.
- **Query**:
  ```sql
  SELECT 
      u.id AS user_id,
      u.name,
      u.email,
      u.phone,
      u.status,
      un.display_label,
      un.block_name,
      un.floor_number
  FROM users u
  JOIN units un ON u.unit_id = un.id
  WHERE u.society_id = ? AND u.role = 'resident' AND u.status = 'active'
  ORDER BY un.display_label ASC;
  ```

---

## 6. Critical Implementation Checklist for Purvi

- [ ] **Run Initial Migrations**: Execute `users` table from `USER_DB.md` and `societies`, `blocks`, `floors`, `units` from `SOCIETY_STRUCTURE_DB.md`.
- [ ] **Apply Deferred Foreign Keys**: Add the circular/deferred foreign keys:
  ```sql
  ALTER TABLE users
      ADD CONSTRAINT fk_users_society FOREIGN KEY (society_id) REFERENCES societies(id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_users_unit FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL;
  ```
- [ ] **Password Security**: Never return `password_hash` in any response. Always use `bcrypt` for hashing.
- [ ] **Transaction Wrappers**: Always use database transactions on:
  - Resident Registration (`users` insert + `units` occupied status update).
  - Resident Rejection (`users` rejected status + `units` vacant status rollback).
- [ ] **Society Kill Switch**: Ensure auth middleware verifies `societies.is_active` so suspended societies cannot access endpoints.
- [x] **Society Configuration Fetch & Update (Added by Vansh)**: `GET /api/v1/society/setup` and `PUT /api/v1/society/setup` implemented in `src/modules/society/` to support frontend form repopulation and society info modifications.
