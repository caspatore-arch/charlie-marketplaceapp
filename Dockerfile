# syntax=docker/dockerfile:1

# Builds and runs the BACKEND ONLY (Hono + tRPC API). This does not build or
# serve the Expo app — see docs/DEPLOY.md for how the phone app is pointed at
# whatever host runs this container (EXPO_PUBLIC_RORK_API_BASE_URL).
#
# The backend has no separate compile step: it runs directly from TypeScript
# source via `tsx` (see package.json "backend" / "backend:once" scripts), so
# there is nothing to transpile here. This Dockerfile is still multi-stage to
# keep the build context/layer used for `npm ci` separate from the minimal
# runtime image, and so `npm ci` layers cache independently of source changes.

# ---------------------------------------------------------------- deps stage
FROM node:24-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# Full install (incl. devDependencies): `tsx`, which runs the backend at
# runtime with no separate build/transpile step, is a devDependency.
RUN npm ci

# ------------------------------------------------------------- runtime stage
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user to run the server as.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs backend

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY backend ./backend

# backend/data is where LocalDiskStorage writes when S3_BUCKET is unset. It's
# gitignored, so create it and hand ownership to the non-root user — without
# this, an S3-less container would fail on first upload with EACCES.
RUN mkdir -p backend/data/uploads backend/data/pg \
  && chown -R backend:nodejs /app

USER backend

# Informational only — the container's actual bound port is controlled by the
# PORT env var (backend/env.ts, default 3000) and must match whatever the
# host maps/forwards. See docs/DEPLOY.md.
EXPOSE 3000

# Runs database migrations on every start (backend/server.ts -> runMigrations()
# from backend/db/migrate.ts), then serves the API. This works against either
# driver: PGlite on local disk (dev only — do NOT use in a deployed container,
# see docs/DEPLOY.md) or a real Postgres via DATABASE_URL. Migrations are
# idempotent (drizzle tracks which have already run), so re-running them on
# every restart/redeploy is safe.
CMD ["node_modules/.bin/tsx", "backend/server.ts"]
