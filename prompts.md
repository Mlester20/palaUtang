I am building a lightweight mobile lending management app designed for local daily micro-lending operations (e.g., 5-6 style daily collections). I need your help as a full-stack developer/architect to build this step-by-step.

### 1. Core Problem & Concept
Lenders need an automated way to track daily collections, handle missed payments ("balda"), automatically adjust schedules, and easily track total principal vs. interest collected.

### 2. Key Features & Data Model

#### A. Borrower & Loan Management
- Borrower profile: Name, contact details, total active loans.
- Loan setup:
  - Principal Amount (e.g., ₱10,000)
  - Daily Payment Amount (e.g., ₱100)
  - Loan Duration / Term (e.g., 20 days)
  - Total Interest & Expected Return breakdown.
  - Payment Type: Daily Installments or Lump Sum (Isahang Bayad).

#### B. Auto-Filled Calendar & Daily Tracker
- Auto-generate a calendar/schedule matrix for each loan based on start date and term duration.
- Visual status indicators for each day (Paid, Pending, Missed/Balda, Double Payment).

#### C. Smart "Balda" (Missed Payment) & Reversal Logic
- Auto-Skip / Balda: If no payment is logged for a specific date, automatically tag that day as "Balda" and push/extend the remaining schedule by +1 day (or accumulate overdue status).
- Double Payment & Reversal Option: 
  - If a borrower pays double on a single day (e.g., pays ₱200 instead of ₱100), allow the lender to manually reverse a previous "Balda" day or skip a future scheduled day.
  - Flexibility to retroactively adjust calendar entries.

#### D. Profit & Interest Analytics
- Real-time calculation showing how much of the collected amount goes to Principal vs. Interest.
- Dashboard summary showing total daily expected collection vs. actual collection.

---

### Tech Stack Strategy
- Architecture: Modular, clean UI, optimized for fast offline/local-first data handling or low-latency API operations.

### Immediate Task:
Please acknowledge this scope and break down the initial project architecture, database schema (JSON/SQL tables for Borrowers, Loans, Schedules, and Payments), and proposed UI component hierarchy to kickstart development.