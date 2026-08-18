# Sahayak — AI-Powered Housing Society Management Assistant

> "Sahayak" (सहायक) is Hindi for "assistant/helper" — fitting, since the core of this product is an AI assistant that acts on behalf of a society secretary. If you don't like the name, swap it — nothing about the architecture depends on it. (Alternatives considered: **SocietyLoop** — echoes InsightLoop's naming, or **Nivas AI** — "nivas" = residence.)

---

## 1. Project Overview

### What it is
Sahayak is a multi-tenant SaaS platform for Residents' Welfare Associations (RWAs) / housing societies. Each society signs up independently (multi-tenant, like InsightLoop's business-per-tenant model), gets its own secretary (admin) account, and residents register under that society. The platform replaces the chaotic WhatsApp-group way most Indian societies currently run complaints, announcements, and maintenance collection — with a structured system that has an **AI agent sitting on top of it, acting as the secretary's operational assistant.**

### Who uses it
- **Secretary / Society Admin** — the person who currently manually tracks complaints, sends notices, and chases people for maintenance money. They get a dashboard *and* a conversational AI assistant they can delegate operational work to.
- **Residents** — people living in the society. They get a simple portal to raise complaints, receive notices, and pay maintenance online instead of via cash/cheque.

### Why it's different from InsightLoop (and why that matters for your resume)
InsightLoop's AI work was: **collect → analyze with an LLM → RAG chat over the results.** That's a strong pattern, but it's now a common one in GenAI projects. Sahayak's AI layer is a **tool-calling agent that takes real actions** (reads live operational data, drafts communications, and — with human approval — sends them) rather than only answering questions about static data. That's the current frontier of what companies mean by "agentic AI," and it's a meaningfully different, harder engineering problem than RAG alone.

### Core design principles (stated once, applies everywhere below)
1. **Pragmatic architecture over textbook purity.** This is a 3-person student project, not a funded startup with a platform team. Shub's AI agent will read directly from the shared MySQL database for its own reasoning (a "shared-database, service-oriented" design rather than strict microservices with API-only communication). This is a real, named trade-off in industry — not a mistake — and you can defend it in an interview: *"We chose a shared-database architecture given team size and timeline; we understood the trade-off against full service isolation and can articulate when we'd revisit it (e.g., before scaling to many tenants, we'd move the agent to Node's API to avoid schema-coupling)."* That sentence alone shows more engineering maturity than blindly doing "pure microservices" without knowing why.
2. **The agent proposes, a human approves, before anything leaves the system.** Any action visible to a resident (a bulk reply, an announcement, a payment reminder) is **drafted by the agent and must be approved by the secretary before it sends.** This is not a limitation — it's the current industry-standard safety pattern for agentic systems (LangGraph calls this a human-in-the-loop `interrupt()`), and it's a genuinely strong interview talking point.
3. **The agent never moves money.** It can read payment/ledger data and draft reminder messages about it. It never initiates, records, or confirms a transaction — that entire path stays inside Purvi's Node service talking to Razorpay. Never let an LLM touch financial execution — only reporting and drafting.

---

## 2. System Architecture at a Glance

| Layer | Owner | Tech | Responsibility |
|---|---|---|---|
| Resident/Secretary web app | Samia (+ either of you) | HTML/CSS/Bootstrap/JS | Dashboards, forms, chat UI with the agent |
| Core backend (system of record) | **Purvi** | Node.js/Express + MySQL | Auth, society/unit/resident management, tickets, announcements, **maintenance & payments (Razorpay)**, all external side-effects (sending emails/SMS/push, payment gateway calls) |
| AI Agent service | **Shub** | FastAPI + LangGraph + LangChain | The secretary's AI assistant: reads DB directly for reasoning, drafts communications/replies, calls Node's API for any action with an external side-effect (actually sending something, recording a transaction) |
| LLM / Vector DB | Shub | Gemini (reuse from InsightLoop) + Qdrant (only if/when bylaws-RAG is added) | Reasoning engine + optional RAG store |

**The practical read/write line**, since it matters for how Purvi scopes her APIs:
- **Reads for agent reasoning** → Shub's agent queries MySQL directly (fast, simple, no API round-trip needed just to "look something up").
- **Writes, and anything with an external side-effect** (actually sending a notification, recording a payment, dispatching an SMS) → goes through **Purvi's Node API**, because that's where the provider integrations (email/SMS gateway, Razorpay) and audit/validation logic live. This keeps money and outbound communication flowing through one well-tested path, even though reads are more relaxed.

---

## 3. Shub's Part — The AI Agent

### What the agent is, conceptually
Think of it as the secretary's operations assistant. The secretary talks to it in natural language ("what are the open tickets from Block C," "reply to all the water complaints saying supply resumes tomorrow," "send a notice to Block B about tomorrow's maintenance work"), and the agent:
1. **Reasons** about what's being asked,
2. **Calls tools** to fetch real data or prepare a draft action,
3. **Pauses for approval** if the action would affect a resident, then
4. **Executes** (via Node's API) once approved.

This is a LangGraph state graph, not a single prompt — the graph has a router/reasoning loop, a tool-execution step, an approval gate (`interrupt()`), and an execution step.

### Tools the agent will have (Python functions exposed to LangGraph)

**Ticket intelligence (direct DB reads):**
- `search_tickets(society_id, category=None, status=None, block=None, floor=None, urgency=None, date_range=None)` — the main lookup tool.
- `get_ticket_detail(ticket_id)` — full thread for one ticket.
- `get_ticket_stats(society_id, group_by="category")` — counts/trends, powers "how many plumbing complaints this month."

*(Summarizing what these tools return is the LLM's own reasoning step — you don't need a separate "summarize" tool. Tools fetch raw data; the model reasons over it.)*

**Communication (draft → approve → send):**
- `draft_ticket_reply(ticket_ids: list, message: str)` — creates a draft row, does **not** send.
- `draft_announcement(target_type, target_filter, message)` — target_type ∈ {all, block, floor, unit_list}.
- `send_draft(draft_id)` — **only callable after the `interrupt()` approval step** — this is the one that calls Node's `/announcements/send` or `/tickets/reply/send` API, which actually dispatches to residents.

**File-based targeting (the Excel/Word extraction feature):**
- `extract_contacts_from_file(file_path)` — parses an uploaded `.xlsx`/`.docx` (via `openpyxl`/`python-docx`), pulls out names/flat numbers, and **fuzzy-matches** them against the real resident records (names in a spreadsheet rarely match the DB exactly — "A-302, Mr. Sharma" vs "Rohan Sharma, Flat A302" — so you'll want something like `rapidfuzz` for matching). Returns a clean list of matched `unit_id`s, plus a list of anything it couldn't confidently match for the secretary to confirm manually. **This fuzzy-matching-and-reconciliation logic is a genuinely good, non-trivial technical detail to describe in an interview** — it's real data-cleaning work, not just a file-parsing wrapper.

**Vendor tools:**
- `get_vendor_contacts(society_id, category)`
- `escalate_to_vendor(ticket_id, vendor_id)` — drafts the vendor request (same approve-then-send pattern).

**Payment visibility (read-only, strictly no write access):**
- `get_payment_defaulters(society_id, billing_period)` — for "who hasn't paid this month" style questions.
- `draft_payment_reminder(unit_ids, message)` — draft only. Sending still requires approval, and the actual send/recording of anything happens in Node, never in the agent.

### The approval gate
Any tool that would result in a resident actually receiving something (`send_draft`, `send_reply`, sending to a vendor) routes through a LangGraph `interrupt()` node. Execution pauses, the secretary's dashboard shows the drafted message for review/edit, and only on explicit approval does the graph resume and call Node's API to actually dispatch it. This is the "HITL in code, not in prompts" principle — you're not trusting the LLM's own judgment to "be careful," you're structurally preventing it from sending anything without a human token.

---

## 4. Purvi's Part — The Node.js Backend

Purvi's service is the **system of record** — anything that must be correct, auditable, and durable lives here, along with every integration that talks to the outside world.

### Core responsibilities
- **Auth & roles**: secretary signup, resident registration (either invited by the secretary against a pre-loaded unit list, or self-registration pending secretary approval), JWT-based sessions, role-based access (secretary vs resident).
- **Society/unit onboarding**: secretary sets up their society profile and defines its units — see the schema note below on why this needs to be flexible for Indian naming conventions.
- **Ticket CRUD APIs**: create/list/filter/update tickets, attach photos, add comments/replies (including agent-drafted-then-approved replies), assign to vendors.
- **Announcement APIs**: create/send, targeting logic (all/block/floor/custom unit list), delivery + read-receipt tracking.
- **Notification dispatch**: the actual email/SMS/push integration (e.g., Nodemailer for email, or an SMS provider) — this is where "sending" really happens, regardless of whether a human or the agent initiated the draft.
- **File storage**: resident-uploaded complaint photos, secretary-uploaded contact spreadsheets.
- **Maintenance & payments** — detailed fully below, this is Purvi's biggest single piece of new scope.
- **Dashboard-serving APIs** for both the secretary's admin dashboard and the resident portal.

### API surface (representative, not exhaustive)
```
POST   /auth/register/secretary
POST   /auth/register/resident
POST   /auth/login

POST   /society/setup
POST   /society/units              (bulk or single unit creation)
GET    /society/units

POST   /tickets
GET    /tickets?status=&category=&block=&floor=
GET    /tickets/:id
PATCH  /tickets/:id/status
POST   /tickets/:id/reply
POST   /tickets/:id/assign-vendor

POST   /announcements
POST   /announcements/:id/send      <-- called by agent only after approval
GET    /announcements

POST   /vendors
GET    /vendors?category=
```

---

## 5. Database Schema

A quick note before the tables: the trickiest schema decision here is **how to represent "which unit a resident lives in,"** because Indian societies genuinely differ — some have Tower/Block → Floor → Flat Number, some are independent villas/row-houses with no floor at all, some use plot numbers. The fix is to make `block_name` and `floor_number` **nullable**, and keep a single free-text `display_label` as the source of truth for what's actually shown to people — so the schema doesn't break depending on which naming convention a given society uses, while you still keep `block_name`/`floor_number` as structured columns for filtering ("send to Block A").

*(All tables below also get standard `created_at`/`updated_at` timestamps — omitted from each definition to keep this readable.)*

```sql
-- Core tenancy
CREATE TABLE societies (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10)
);

CREATE TABLE units (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  display_label VARCHAR(50),        -- "A-302", "Villa 14", "Plot 45" — always shown as-is
  block_name VARCHAR(50) NULL,      -- "A", "Sunflower Block" — NULL for standalone villas
  floor_number INT NULL,            -- NULL where there's no concept of a floor
  unit_number VARCHAR(20),          -- "302", "14"
  unit_type ENUM('apartment','villa','row_house','plot','other'),
  area_sqft INT NULL,               -- optional, enables per-sqft maintenance billing later
  status ENUM('occupied','vacant') DEFAULT 'vacant'
);

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  role ENUM('secretary','resident'),   -- 'super_admin' added later, see Section 9
  unit_id INT NULL REFERENCES units(id),  -- NULL for secretary
  name VARCHAR(100),
  email VARCHAR(150),
  phone VARCHAR(15),
  password_hash VARCHAR(255),
  is_verified BOOLEAN DEFAULT FALSE
);

-- Tickets
CREATE TABLE tickets (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  unit_id INT REFERENCES units(id),
  raised_by_user_id INT REFERENCES users(id),
  category ENUM('water','electricity','plumbing','security','parking','other'),
  description TEXT,
  attachment_url VARCHAR(255) NULL,
  status ENUM('open','in_progress','resolved','closed') DEFAULT 'open',
  urgency ENUM('low','medium','high') DEFAULT 'medium',
  resolved_at DATETIME NULL
);

CREATE TABLE ticket_replies (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT REFERENCES tickets(id),
  sender_type ENUM('resident','secretary','agent'),
  sender_user_id INT NULL REFERENCES users(id),  -- NULL when sender_type = 'agent'
  message TEXT
);

-- Announcements
CREATE TABLE announcements (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  created_by_user_id INT REFERENCES users(id),  -- the secretary who approved it, even if agent-drafted
  drafted_by_agent BOOLEAN DEFAULT FALSE,
  title VARCHAR(150),
  message TEXT,
  target_type ENUM('all','block','floor','unit_list'),
  target_filter JSON,     -- e.g. {"block":"B"} or {"unit_ids":[12,45,88]}
  sent_at DATETIME NULL
);

CREATE TABLE announcement_recipients (
  id INT PRIMARY KEY AUTO_INCREMENT,
  announcement_id INT REFERENCES announcements(id),
  user_id INT REFERENCES users(id),
  delivered_at DATETIME NULL,
  read_at DATETIME NULL
);

-- Vendors
CREATE TABLE vendors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  name VARCHAR(100),
  category ENUM('plumber','electrician','security','housekeeping','other'),
  contact_number VARCHAR(15)
);

CREATE TABLE ticket_vendor_assignments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT REFERENCES tickets(id),
  vendor_id INT REFERENCES vendors(id),
  status ENUM('assigned','in_progress','completed') DEFAULT 'assigned'
);

-- Maintenance & Payments (Purvi owns this entire block — detailed in Section 8)
CREATE TABLE maintenance_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  charge_type ENUM('flat','per_sqft'),
  base_amount DECIMAL(10,2),
  due_day INT,                 -- e.g. 5 = due on the 5th of each month
  late_fee_type ENUM('fixed','percentage'),
  late_fee_value DECIMAL(10,2),
  grace_period_days INT DEFAULT 5,
  effective_from DATE
);

CREATE TABLE maintenance_ledger (
  id INT PRIMARY KEY AUTO_INCREMENT,
  society_id INT REFERENCES societies(id),
  unit_id INT REFERENCES units(id),
  billing_period VARCHAR(7),      -- "2026-08"
  amount_due DECIMAL(10,2),
  late_fee_applied DECIMAL(10,2) DEFAULT 0,
  amount_paid DECIMAL(10,2) DEFAULT 0,
  status ENUM('pending','paid','overdue','partial') DEFAULT 'pending',
  due_date DATE,
  paid_date DATE NULL,
  razorpay_order_id VARCHAR(100) NULL
);

CREATE TABLE payment_transactions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ledger_id INT REFERENCES maintenance_ledger(id),
  razorpay_payment_id VARCHAR(100),
  amount DECIMAL(10,2),
  status ENUM('created','captured','failed','refunded'),
  raw_response JSON     -- full Razorpay webhook payload, for audit/debugging
);
```

---

## 6. Functionalities — Resident Side

- Register against a unit (invited by secretary, or self-register pending approval)
- Raise a new complaint/ticket — category, description, optional photo
- View own tickets, their status, and the reply thread (including agent-sent replies)
- Receive announcements relevant to them (all-society, their block/floor, or individually targeted)
- View own maintenance ledger — dues, payment history, receipts
- Pay maintenance fee online via Razorpay checkout
- (Nice-to-have) see whether their own ticket/announcement has been read/acknowledged

## 7. Functionalities — Secretary (Admin) Side

- Set up the society profile and define units during onboarding
- Add/invite/approve residents against specific units
- View and manually manage all tickets (filter by status/category/block/urgency, assign to a vendor, reply directly)
- **Talk to the AI agent**: ask for ticket summaries/patterns, instruct it to draft replies (individual or bulk), review and approve/edit drafts before they send
- Create and send announcements manually, or via the agent — including uploading an Excel/Word file of names for the agent to extract and match against residents
- Configure maintenance settings: base charge (flat or per-sqft), due day, late fee rule, grace period
- View the maintenance ledger dashboard — who's paid, who's overdue — and get agent-drafted (secretary-approved) reminders sent to defaulters
- Maintain a vendor directory and assign tickets to vendors
- View basic analytics: ticket volume/trends by category and block, resolution times, collection rate

---

## 8. Maintenance Fee & Payments — Full Deep-Dive (Purvi's feature, end to end)

This is entirely Purvi's build. Here's everything she needs to know to scope it.

### Payment gateway
**Razorpay** — it has a free test/sandbox mode with no setup cost, so development and demoing cost nothing. You'll use two pieces of their API:
- **Orders API** — server creates an "order" for a given amount when a resident wants to pay.
- **Checkout + Webhooks** — the frontend opens Razorpay's checkout with that order ID; once the resident pays, Razorpay calls your webhook to confirm success, and *that webhook call* is what should actually mark the ledger row as paid — never trust the frontend alone to tell you a payment succeeded.

### How the monthly ledger gets built
1. Secretary sets up `maintenance_config` once (charge amount, due day, late fee rule, grace period). This can be edited going forward (e.g., a new value applies `effective_from` a given date, so past months aren't retroactively changed).
2. A **scheduled job** (e.g., `node-cron`, running once a month) walks every occupied unit in the society and inserts one `maintenance_ledger` row per unit for the new billing period, with `amount_due` computed from the config (flat amount, or `base_amount × area_sqft` if per-sqft).
3. A second **scheduled job** runs daily, checks any `maintenance_ledger` row past `due_date + grace_period_days` that's still `pending`, and applies the late fee (updating `late_fee_applied` and flipping status to `overdue`).

### API surface for this feature
```
POST   /maintenance/config              (secretary sets/updates charge & late-fee rules)
GET    /maintenance/config

GET    /maintenance/ledger              (secretary — full society view, filterable by period/status)
GET    /maintenance/ledger/mine         (resident — their own history)

POST   /maintenance/pay                 (resident initiates → creates Razorpay order, returns order_id)
POST   /maintenance/webhook             (Razorpay → confirms payment → updates ledger + payment_transactions)

GET    /maintenance/receipt/:ledger_id  (generate/download a receipt once paid)
```

### What the secretary can configure
- Base maintenance charge — flat per unit, or per-sqft (using `area_sqft` from the `units` table)
- Due day of the month
- Late fee — fixed amount or percentage of due amount
- Grace period before a late fee applies

### Where the AI agent touches this (and where it explicitly doesn't)
The agent can **read** `maintenance_ledger` to answer "who hasn't paid" and **draft** a reminder message — but sending that reminder still goes through the same approve-then-send flow as everything else, and the agent has **no ability to create, modify, or confirm a payment or ledger entry.** That entire path is Purvi's Node service talking directly to Razorpay. This boundary is worth stating explicitly in your report/interview: *"the agent can talk about money, it can never move money."*

---

## 9. Future Scope — Platform Super-Admin (deliberately deprioritized)

Not to be built until the core per-society product works well. Documented here so the idea isn't lost:

- A platform-level role (above any single society's secretary) that can onboard/manage multiple societies
- Monitoring dashboard for **LLM token usage and cost per society** — useful both operationally and as a resume line ("built cost-observability for LLM usage across tenants")
- Aggregate usage analytics across societies, without exposing any individual resident's private data
- Basic audit logs of agent actions across all societies, for governance/compliance
- If this ever became a real commercial product: subscription/billing management per society

This mirrors the same "platform admin" layer any multi-tenant SaaS eventually needs — the same shape InsightLoop itself would need if it scaled further.

---

## 10. Optional / Not-Yet-Confirmed Enhancements

These came up in earlier discussion but aren't locked in — listed here so nothing's lost, without assuming they're part of the current build:

- **Proactive pattern detection** — agent flags "3 water complaints in Block C this month" unprompted
- **RAG over society bylaws** — residents ask "can I keep a pet?" answered from an uploaded rules document (a different, complementary RAG use case from InsightLoop's feedback-chat)
- **Multi-agent supervisor split** — separate specialized sub-agents (triage / communication / vendor-coordination) instead of one agent doing everything
- **Persistent cross-session agent memory** — the agent remembers a secretary's past requests across days, not just within one conversation
- **Meeting-minutes-to-action** — paste AGM notes, agent extracts decisions and cross-references open tickets
- **Structured-output extraction** — Pydantic-validated parsing of raw complaint text into category/urgency automatically
- **Guardrail validation pass** on agent-drafted messages before they're eligible for approval (tone, no leaked PII)
- **LangSmith observability + a small eval set** for tool-selection accuracy
- **Streaming the agent's intermediate reasoning/tool-calls** to the dashboard, not just the final answer

---

*This document reflects what's been decided so far: ticket/complaint system, AI agent for ticket review + bulk/individual replies + notice drafting (including file-based targeting), and the maintenance fee/payment system. Anything in Section 10 is explicitly open — flag which ones (if any) you want folded into the core build.*