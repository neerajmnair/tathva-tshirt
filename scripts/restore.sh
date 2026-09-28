#!/usr/bin/env bash
# Restore a pg_dump file into the distribution database.
set -euo pipefail
cd "$(dirname "$0")/.."
# An externally-set DATABASE_URL wins over .env (useful for testing).
_ENV_URL="${DATABASE_URL:-}"
set -a; [ -f .env ] && . ./.env; set +a
[ -n "$_ENV_URL" ] && DATABASE_URL="$_ENV_URL"
: "${DATABASE_URL:=postgresql://localhost:5432/tathva_tshirt}"

FILE="${1:-}"
[ -n "$FILE" ] || { echo "Usage: bash scripts/restore.sh backups/tathva_tshirt_YYYYmmdd-HHMMSS.sql"; exit 1; }
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 1; }

read -r -p "This OVERWRITES the current database. Type RESTORE to continue: " ans
[ "$ans" = "RESTORE" ] || { echo "Aborted."; exit 1; }

psql "$DATABASE_URL" -c 'DROP TABLE IF EXISTS students CASCADE; DROP TABLE IF EXISTS collection_log CASCADE;'
psql "$DATABASE_URL" < "$FILE"
echo "Restored from $FILE"
