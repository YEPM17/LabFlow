# LabFlow backend architecture

## Runtime

- Node.js 24 built-in HTTP server and `node:sqlite`; no third-party runtime dependencies.
- Same-origin static hosting for the existing frontend and `/api` JSON API.
- SQLite database at `data/labflow.db`; uploaded repair photos at `data/uploads`.
- A lightweight scheduler runs every 30 seconds to create 15-minute reservation reminders.

## Layers

```text
public/                 browser UI (HTML/CSS/JS)
src/server.js           process startup, graceful shutdown, scheduler
src/app.js              request pipeline, auth guard, CSRF and error mapping
src/router.js           small path/method router
src/routes/*.js         HTTP handlers and role requirements
src/services/*.js       business rules and transactions
src/db.js               connection, schema bootstrap and seed data
src/schema.sql          relational schema and indexes
src/session.js          opaque session cookies and sliding expiry
src/security.js         scrypt password hashing and token hashing
test/api.test.js        end-to-end API tests against an isolated temp database
```

## Data model

```text
users 1 ─── n sessions
users 1 ─── n reservations n ─── 1 devices (nullable after device deletion)
users 1 ─── n repairs      n ─── 1 devices (nullable after device deletion)
repairs 1 ─── n repair_photos
users 1 ─── n notifications
```

Important intentional choices:

- Reservation and repair rows store a `device_name_snapshot`, so historical records remain readable after a device is deleted.
- `device_id` uses `ON DELETE SET NULL`; active records are protected by the service layer before deletion.
- Session tokens are random 256-bit values. Only SHA-256 hashes are stored in the database.
- Passwords use Node's `scrypt` with a random 16-byte salt and timing-safe comparison.

## Equipment effective status

The database stores the configured state `available | maintenance`. The API derives a third display state:

```text
maintenance                         -> maintenance
approved reservation covering now   -> reserved
otherwise                           -> available
```

This means a device becomes `reserved` only while an approved booking is actually in progress. Future approved bookings do not hide the device from the catalog.

## Reservation state machine

```text
pending ──approve──> approved ──cancel before cutoff──> cancelled
   │
   ├──reject──> rejected
   └──cancel──> cancelled
```

Creation and approval run inside `BEGIN IMMEDIATE` transactions. Overlap checks use `start < other.end AND end > other.start`; creation blocks pending and approved rows, while approval re-checks approved rows.

## Repair state machine

```text
pending ──start──> processing ──complete──> completed
```

`start` sets the device to maintenance. `complete` restores `available` only when no other repair for that device remains in processing.

## Notifications

- New reservation / repair: staff notification.
- Reservation approved/rejected: student notification.
- Repair processing/completed: student notification.
- Approved reservation within 15 minutes: student reminder.
- Notifications are read through the API and rendered in the frontend notification center.

Email delivery is intentionally not implemented in this local prototype; the `notifications` table and scheduler are the replacement/in-app channel required by the current UI.

## Security controls

- HttpOnly, SameSite=Lax session cookie; 30-minute sliding idle timeout.
- Origin/Host comparison and `Sec-Fetch-Site` check on unsafe methods.
- Login rate limit: 10 failed attempts per IP per 15 minutes.
- scrypt password hashes; no plaintext password storage.
- Role checks at the route layer and ownership checks in services.
- Upload MIME signature validation, 2 MB per photo, 3 photos per repair, random filenames.
- Repair photos are served only after an ownership/role check.
- CSP, `X-Content-Type-Options`, `X-Frame-Options`, referrer policy and permissions policy on every response.
- Request bodies capped at 10 MB by default.
- No cross-origin API access is enabled; frontend and API are served from the same origin.

## Production notes

The SRS names PostgreSQL and campus SSO. This deliverable targets a local, runnable course demo with Node 24 + SQLite because no PostgreSQL service is available in the target environment. The service and route layers are separated from storage so the database adapter can be replaced. Before a real campus deployment:

1. Replace `src/db.js` with a PostgreSQL adapter and convert `src/schema.sql`.
2. Replace local login with the campus SSO callback and remove demo accounts.
3. Serve behind HTTPS and set `COOKIE_SECURE=true`.
4. Move photo storage to object storage and add malware scanning.
5. Add email/push notification delivery and an admin user-management UI.
6. Add data-retention, audit-log and backup policies.
