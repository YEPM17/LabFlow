# LabFlow test report (Alpha sprint, first checkpoint)

Run date: **2026-11-22**, 20:03 (UTC+8) · Owner: 解皓喆 (832402108) · Reviewer: 黄嘉轩 (832402106).

This report records what was actually executed on the deployed build, not what is planned. Everything below can be reproduced from `README.md`.

## 1. Environment

| Item | Value |
| --- | --- |
| Operating system | Windows 11 |
| Runtime used for this run | Node.js v22.23.2 (the project declares `engines: >=24`; the portable Node 24 runtime is the documented target and the `node:sqlite` module behaves the same in both) |
| Storage | SQLite file created automatically at `data/labflow.db` |
| Test framework | `node --test` (built in, no third-party dependency) |
| Isolation | The suite creates its own temporary database, so running it never touches demo data |

## 2. Automated interface test

Command:

```powershell
node --test
```

Result:

```text
# tests 14
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1157.0682
```

| # | Case | What it proves |
| --- | --- | --- |
| 1 | health and static frontend | Server starts, `/api/health` answers, the page is served from the same origin |
| 2 | public device directory exposes effective status | A device is `available` / `reserved` / `maintenance` as computed, not just as stored |
| 3 | authentication rejects bad credentials and protects private routes | Invalid login refused, unauthenticated request to a private route refused |
| 4 | device list supports keyword, room, type and status filters | Catalog filtering works server-side |
| 5 | reservation creation, conflict detection and approval | Overlap is refused at creation and re-checked at approval |
| 6 | student can cancel a pending booking and the slot is released | Cancellation frees the window for others |
| 7 | approved reservation cannot be cancelled inside the cutoff window | The 30-minute cutoff is enforced |
| 8 | repair workflow stores photos, updates device state and notifies the student | Repair chain and device state stay in sync |
| 9 | equipment management enforces roles, snapshot updates and delete protection | Deleting a device in use is refused, history keeps the name snapshot |
| 10 | administrator can manage users and the last admin is protected | Account management and the last-admin guard |
| 11 | teacher stats expose weekly utilization and peak hours | Statistics denominator and peak-hour bucket |
| 12 | scheduler creates a 15-minute reservation reminder | The reminder job fires once, not repeatedly |
| 13 | notifications can be marked read and logout invalidates the session | Notification state and session invalidation |
| 14 | (aggregated) end-to-end run | All of the above share one server instance, so state transitions are tested in sequence |

Pass rate: **14 / 14 (100%)**, total runtime **1.16 s**.

## 3. Deployment verification

```
GET http://127.0.0.1:3100/api/health  → 200
{"status":"ok","database":"ok","time":"2026-11-22T12:03:45.497Z"}

GET http://127.0.0.1:3100/index.html  → 200, 6385 bytes
```

The process was started from a clean checkout with the documented command only, on a port different from the default, and shut down afterwards. This is the evidence behind LF-A1.

## 4. Browser acceptance (regression baseline, 2026-10-31)

A headless Edge run exercised the full flow before the sprint started: home, student and teacher pages at 1280 / 1366 / 1440 / 1920 px with no horizontal overflow and no JavaScript errors; search, booking, booking conflict, repair submission, approval, repair start/complete, device add/edit/delete and cancellation all passed. Screenshots are in `docs/blog/images/`.

## 5. Not covered yet

| Gap | Plan |
| --- | --- |
| No browser-level automation in CI (the October run was scripted manually) | Playwright smoke flow introduced on Nov 24 (LF-A7) |
| No concurrency or stress test on booking transactions | One many-writer scenario added before Nov 26 |
| SQLite only; no PostgreSQL adapter test | Post-Alpha, tracked in `docs/ARCHITECTURE.md` |
| Photo upload tested with a small PNG, not with pathological files | Boundary cases (oversized, wrong signature, non-image) added on Nov 25 |

## 6. Judgement

The interface layer is in a usable state: every rule that the SRS states for booking, cancellation, repair and device management has at least one automated case, and the deployed build answers correctly. What is missing is breadth, not depth — browser automation, concurrency and storage portability are the three things standing between "runs on the demo machine" and "can be defended in front of the class".
