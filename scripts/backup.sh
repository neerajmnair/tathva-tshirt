#!/usr/bin/env bash
# Event-day backup: dumps the whole database plus a plain CSV of students.
set -euo pipefail
cd "$(dirname "$0")/.."
# An externally-set DATABASE_URL wins over .env (useful for testing).
_ENV_URL="${DATABASE_URL:-}"
set -a; [ -f .env ] && . ./.env; set +a
[ -n "$_ENV_URL" ] && DATABASE_URL="$_ENV_URL"
: "${DATABASE_URL:=postgresql://localhost:5432/tathva_tshirt}"

mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
pg_dump "$DATABASE_URL" > "backups/tathva_tshirt_${STAMP}.sql"
psql "$DATABASE_URL" -c "\copy (SELECT roll_no AS \"RollNo\", name AS \"Name\", tshirt_size AS \"TshirtSize\", collected AS \"Collected\", collected_at AS \"CollectedAt\", collected_by AS \"CollectedBy\" FROM students ORDER BY roll_no) TO 'backups/tathva_tshirt_${STAMP}.csv' CSV HEADER"

echo "Backup written:"
echo "  backups/tathva_tshirt_${STAMP}.sql"
echo "  backups/tathva_tshirt_${STAMP}.csv"
echo
echo "Restore with:  psql \"\$DATABASE_URL\" < backups/tathva_tshirt_${STAMP}.sql"
