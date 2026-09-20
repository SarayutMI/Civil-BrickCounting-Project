# CIVIL — AI Brick Construction Monitoring

Node/Express server + React client (`client/`) + Postgres + a Python YOLO service (`README_YOLO.md`).
**Everything is stored in Postgres** (tasks, cameras, users, sessions, per-minute history, logs, settings) and
snapshot images on the server disk (`snapshots/`, path recorded in the DB). Nothing is seeded from source code.

## Setup

```bash
npm install && (cd client && npm install && npm run build)
export PGHOST=... PGDATABASE=civil PGUSER=civil_app PGPASSWORD=...   # or DATABASE_URL
npm run migrate                      # also runs automatically on every server start
cp seed-users.example.json seed-users.local.json   # edit names / e-mails / passwords (git-ignored)
npm run seed-users seed-users.local.json           # bcrypt-hashes the passwords into table users
npm start
```

`seed-users.local.json` is the only place a password is ever written down; it is git-ignored. Re-running the
seed script updates an existing username instead of duplicating it.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DATABASE_URL` / `PG*` | localhost / `civil` / `civil_app` | Postgres connection |
| `YOLO_SERVICE_URL` | `http://127.0.0.1:8000` | Python detection service |
| `APP_TIMEZONE` | `Asia/Bangkok` | Timezone for the working-hours schedule |
| `NO_IMAGE_SECONDS` | 15 | "Loss data" fires when no image arrives for `snapshotInterval + this` seconds |
| `TIMELAPSE_FPS` | 10 | Frame rate of generated MP4 time-lapse |
| `BACKUP_KEEP` | 14 | Daily `pg_dump` files kept in `backups/` |

Needs `ffmpeg`/`ffprobe` and `pg_dump` (postgresql-client) on the server's PATH. Run behind HTTPS (nginx/Caddy) —
the session cookie is `Secure` automatically when `X-Forwarded-Proto: https` is present.

## Behaviour worth knowing

- **Auth:** HttpOnly session cookie, server-side sessions in table `sessions`, role permissions enforced on the
  API (not just hidden in the UI), 5 wrong logins = 5-minute lock.
- **Working hours:** each task's `schedule` (start / break start / break end / end) switches it running ↔ paused
  automatically at those times. A manual pause/start inside a phase is kept until the next boundary. `finished` is
  never set automatically.
- **Image view:** rotate / flip / zoom is set once per camera (Task Detail) and applied to the display, to the image
  sent to YOLO and to the stored snapshots. Changing it invalidates drawn ROIs — redraw them.
- **Loss data:** a running task with a camera and ROI that receives no image for too long shows *Loss data*, is logged,
  optionally sent to Discord, and clears itself when images resume.
- **Backup:** `POST /api/storage/backup` (and daily) = `pg_dump -Fc`. Restore: `pg_restore -d civil --clean --if-exists file.dump`.
  Snapshot images are not in the dump — back up `snapshots/` separately (rsync).

## Tests

`npm test` (schedule logic and image-view transforms; the latter needs ffmpeg).
