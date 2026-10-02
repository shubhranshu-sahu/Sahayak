# Sahayak — Frontend API Reference (Phase 1: Auth, Structure & Onboarding)

> **For Frontend Developer**: This document contains all live API paths, required headers, request payloads, and exact JSON responses implemented in the Sahayak Backend.

---

## 1. Base URL & Headers

* **Local Development Base URL**: `http://localhost:5000`
* **Production Base URL**: `https://<your-render-service-name>.onrender.com`
* **API Prefix**: `/api/v1`

### Standard Headers
| Header | Value | When Required |
| :--- | :--- | :--- |
| `Content-Type` | `application/json` | All `POST` / `PUT` / `PATCH` requests |
| `Authorization` | `Bearer <jwt_token>` | All **Private** endpoints |

---

## 2. Quick Endpoint Summary Table

| Category | Method | Endpoint Path | Auth Required | Role |
| :--- | :--- | :--- | :--- | :--- |
| **Health** | `GET` | `/api/health` | No (Public) | Any |
| **Auth** | `POST` | `/api/v1/auth/register/secretary` | No (Public) | Public |
| **Auth** | `POST` | `/api/v1/auth/register/resident` | No (Public) | Public |
| **Auth** | `POST` | `/api/v1/auth/login` | No (Public) | Public |
| **Auth** | `GET` | `/api/v1/auth/me` | **Yes (JWT)** | Any Active User |
| **Public Discovery** | `GET` | `/api/v1/public/societies` | No (Public) | Public |
| **Public Discovery** | `GET` | `/api/v1/public/societies/:societyId/blocks` | No (Public) | Public |
| **Public Discovery** | `GET` | `/api/v1/public/blocks/:blockId/floors` | No (Public) | Public |
| **Public Discovery** | `GET` | `/api/v1/public/floors/:floorId/units` | No (Public) | Public |
| **Society Setup** | `GET` | `/api/v1/society/setup` | **Yes (JWT)** | `secretary` |
| **Society Setup** | `POST` | `/api/v1/society/setup` | **Yes (JWT)** | `secretary` |
| **Society Setup** | `PUT` | `/api/v1/society/setup` | **Yes (JWT)** | `secretary` |
| **Society Setup** | `POST` | `/api/v1/society/blocks` | **Yes (JWT)** | `secretary` |
| **Society Setup** | `POST` | `/api/v1/blocks/:blockId/floors/bulk` | **Yes (JWT)** | `secretary` |
| **Society Setup** | `POST` | `/api/v1/floors/:floorId/units/bulk` | **Yes (JWT)** | `secretary` |
| **Society Setup** | `GET` | `/api/v1/society/structure` | **Yes (JWT)** | `secretary` |
| **Resident Approval** | `GET` | `/api/v1/secretary/residents/pending` | **Yes (JWT)** | `secretary` |
| **Resident Approval** | `POST` | `/api/v1/secretary/residents/:residentId/approve` | **Yes (JWT)** | `secretary` |
| **Resident Approval** | `POST` | `/api/v1/secretary/residents/:residentId/reject` | **Yes (JWT)** | `secretary` |
| **Resident Approval** | `GET` | `/api/v1/secretary/residents` | **Yes (JWT)** | `secretary` |

---

## 3. Standard Response Format

### Success Response (`200 OK` / `201 Created`)
```json
{
  "success": true,
  "message": "Human-readable success message",
  "data": { ... }
}
```

### Error Response (`400` / `401` / `403` / `404` / `409` / `500`)
```json
{
  "success": false,
  "message": "Human-readable error message"
}
```
*(For Zod validation errors on `400 Bad Request`, an `error` array is also included with `{ field, message }` items.)*

---

## 4. Detailed Endpoint Reference

---

### 🩺 Health Check

#### `GET /api/health`
Check if the backend server is awake and running.
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Sahayak Backend is running",
    "timestamp": "2026-10-01T12:00:00.000Z"
  }
  ```

---

### 🔐 A. Authentication Endpoints

#### 1. Secretary Registration
* **Path**: `POST /api/v1/auth/register/secretary`
* **Access**: Public
* **Request Body**:
  ```json
  {
    "name": "Purvi Parashar",
    "email": "purvi@example.com",
    "phone": "+919876543210",
    "password": "SecurePassword123"
  }
  ```
* **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Secretary registered successfully. Please proceed to society setup.",
    "data": {
      "userId": 1,
      "name": "Purvi Parashar",
      "email": "purvi@example.com",
      "role": "secretary"
    }
  }
  ```

#### 2. Resident Registration
* **Path**: `POST /api/v1/auth/register/resident`
* **Access**: Public
* **Request Body**:
  ```json
  {
    "name": "Rohan Sharma",
    "email": "rohan@example.com",
    "phone": "+919123456780",
    "password": "SecurePassword123",
    "society_id": 1,
    "unit_id": 1
  }
  ```
* **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Registration submitted successfully. Awaiting approval from society secretary.",
    "data": {
      "userId": 2,
      "name": "Rohan Sharma",
      "status": "pending"
    }
  }
  ```
* **Error Cases**:
  * `409 Conflict`: Email already registered OR Unit is already occupied/claimed.
  * `400 Bad Request`: Unit does not belong to the selected society.

#### 3. User Login (Secretary & Resident)
* **Path**: `POST /api/v1/auth/login`
* **Access**: Public
* **Request Body**:
  ```json
  {
    "email": "purvi@example.com",
    "password": "SecurePassword123"
  }
  ```
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "name": "Purvi Parashar",
        "email": "purvi@example.com",
        "role": "secretary",
        "societyId": 1,
        "unitId": null
      }
    }
  }
  ```
* **Frontend Routing Note**:
  * If `user.role === 'secretary'` and `user.societyId === null`, redirect the secretary to the **Society Setup Wizard** (`/api/v1/society/setup`).
  * If `user.role === 'secretary'` and `user.societyId !== null`, redirect to the **Secretary Dashboard**.
  * If `user.role === 'resident'`, redirect to the **Resident Portal**.

#### 4. Get Current Logged-In User Profile
* **Path**: `GET /api/v1/auth/me`
* **Access**: Private (`Authorization: Bearer <token>`)
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "User profile fetched successfully",
    "data": {
      "id": 2,
      "name": "Rohan Sharma",
      "email": "rohan@example.com",
      "phone": "+919123456780",
      "role": "resident",
      "society": {
        "id": 1,
        "name": "Sunrise Apartments",
        "societyCode": "SUNRISE"
      },
      "unit": {
        "id": 1,
        "displayLabel": "A-101",
        "blockName": "A",
        "floorNumber": 1
      }
    }
  }
  ```

---

### 🌐 B. Public Discovery Endpoints (Cascading Dropdowns for Resident Signup)

> These endpoints require **no authentication** and are used on the Resident Registration screen to populate: **Society → Block → Floor → Unit**.

#### 1. List All Active Societies
* **Path**: `GET /api/v1/public/societies`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Active societies retrieved",
    "data": [
      {
        "id": 1,
        "name": "Sunrise Apartments",
        "societyCode": "SUNRISE",
        "city": "New Delhi",
        "state": "Delhi"
      }
    ]
  }
  ```

#### 2. Get Blocks in a Society
* **Path**: `GET /api/v1/public/societies/:societyId/blocks`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Blocks retrieved",
    "data": [
      {
        "id": 1,
        "blockName": "A"
      }
    ]
  }
  ```
* **Error (`404 Not Found`)**: `{ "success": false, "message": "Society not found" }`

#### 3. Get Floors in a Block
* **Path**: `GET /api/v1/public/blocks/:blockId/floors`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Floors retrieved",
    "data": [
      {
        "id": 1,
        "floorNumber": 1
      }
    ]
  }
  ```
* **Error (`404 Not Found`)**: `{ "success": false, "message": "Block not found" }`

#### 4. Get Units on a Floor (With Availability Status)
* **Path**: `GET /api/v1/public/floors/:floorId/units`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Units retrieved",
    "data": [
      {
        "id": 1,
        "unitNumber": 1,
        "displayLabel": "A-101",
        "status": "occupied",
        "isSelectable": false
      },
      {
        "id": 2,
        "unitNumber": 2,
        "displayLabel": "A-102",
        "status": "vacant",
        "isSelectable": true
      }
    ]
  }
  ```
* **Frontend UX Note**: Disable units where `isSelectable === false` (`status === 'occupied'`) in the dropdown so the user can see the unit exists but cannot select it.
* **Error (`404 Not Found`)**: `{ "success": false, "message": "Floor not found" }`

---

### 🏢 C. Society Setup & Structure Endpoints (Secretary Only)

> All endpoints below require `Authorization: Bearer <secretary_token>`.

#### 0. Get Society Setup Configuration
* **Path**: `GET /api/v1/society/setup`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Society configuration retrieved",
    "data": {
      "id": 1,
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
  }
  ```

#### 0.5. Update Society Configuration
* **Path**: `PUT /api/v1/society/setup`
* **Request Body** (All fields optional):
  ```json
  {
    "name": "Sunrise Apartments Updated",
    "pincode": "110076"
  }
  ```
* **Response (`200 OK`)**:
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

#### 1. Onboard / Create Society
* **Path**: `POST /api/v1/society/setup`
* **Request Body**:
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
  *(Note: `society_code` must be 3–20 characters, uppercase `A-Z` and `-` only, starting with a letter.)*
* **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Society created successfully",
    "data": {
      "societyId": 1,
      "name": "Sunrise Apartments",
      "societyCode": "SUNRISE-DEL"
    }
  }
  ```

#### 2. Add a Block to Society
* **Path**: `POST /api/v1/society/blocks`
* **Request Body**:
  ```json
  {
    "block_name": "A"
  }
  ```
  *(Note: `block_name` only allows letters `A-Z` and is automatically uppercased.)*
* **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Block created successfully",
    "data": {
      "id": 1,
      "societyId": 1,
      "blockName": "A"
    }
  }
  ```

#### 3. Bulk Add Floors to a Block
* **Path**: `POST /api/v1/blocks/:blockId/floors/bulk`
* **Request Body**:
  ```json
  {
    "total_floors": 10
  }
  ```
* **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "10 floors created successfully",
    "data": {
      "blockId": 1,
      "floorsCreated": 10
    }
  }
  ```

#### 4. Bulk Add Units to a Floor
* **Path**: `POST /api/v1/floors/:floorId/units/bulk`
* **Request Body**:
  ```json
  {
    "start_unit": 1,
    "end_unit": 5,
    "unit_type": "apartment",
    "area_sqft": 1250
  }
  ```
  *(Note: `unit_type` can be `'apartment'`, `'villa'`, `'row_house'`, `'plot'`, or `'other'`. `start_unit` and `end_unit` must be between `1` and `99`.)*
* **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "5 units created successfully",
    "data": {
      "floorId": 1,
      "unitsCreated": 5,
      "exampleLabel": "A-101"
    }
  }
  ```

#### 5. Get Complete Society Structure Tree
* **Path**: `GET /api/v1/society/structure`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Society structure retrieved",
    "data": {
      "societyId": 1,
      "name": "Sunrise Apartments",
      "blocks": [
        {
          "id": 1,
          "blockName": "A",
          "floors": [
            {
              "id": 1,
              "floorNumber": 1,
              "units": [
                {
                  "id": 1,
                  "unitNumber": 1,
                  "displayLabel": "A-101",
                  "status": "occupied",
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

### 👥 D. Resident Approval Flow (Secretary Only)

> All endpoints below require `Authorization: Bearer <secretary_token>`.

#### 1. List Pending Resident Registrations
* **Path**: `GET /api/v1/secretary/residents/pending`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Pending residents retrieved",
    "data": [
      {
        "userId": 2,
        "name": "Rohan Sharma",
        "email": "rohan@example.com",
        "phone": "+919123456780",
        "registeredAt": "2026-09-26T15:47:49.000Z",
        "unit": {
          "id": 1,
          "displayLabel": "A-101",
          "block": "A",
          "floor": 1
        }
      }
    ]
  }
  ```

#### 2. Approve a Pending Resident
* **Path**: `POST /api/v1/secretary/residents/:residentId/approve`
* **Request Body**: None
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Resident approved successfully. They can now log in."
  }
  ```

#### 3. Reject a Pending Resident
* **Path**: `POST /api/v1/secretary/residents/:residentId/reject`
* **Request Body**: None
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Resident registration rejected and unit released to vacant."
  }
  ```

#### 4. List All Active (Approved) Residents
* **Path**: `GET /api/v1/secretary/residents`
* **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Active residents retrieved",
    "data": [
      {
        "userId": 2,
        "name": "Rohan Sharma",
        "email": "rohan@example.com",
        "phone": "+919123456780",
        "status": "active",
        "unit": {
          "displayLabel": "A-101",
          "block": "A",
          "floor": 1
        }
      }
    ]
  }
  ```
