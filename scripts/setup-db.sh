#!/usr/bin/env bash
# Creates the PostgreSQL databases used by the distribution system.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example"; }
set -a; . ./.env; set +a

DB_NAME="${DB_NAME:-tathva_tshirt}"
TEST_DB_NAME="${TEST_DB_NAME:-tathva_tshirt_test}"

if ! pg_isready -q; then
  echo "PostgreSQL is not running."
  echo "  macOS (Homebrew): brew services start postgresql@16"
  echo "  Linux:            sudo systemctl start postgresql"
  exit 1
fi

create_db () {
  if psql -lqt 2>/dev/null | cut -d '|' -f1 | grep -qw "$1"; then
    echo "Database '$1' already exists."
  else
    createdb "$1" && echo "Created database '$1'."
  fi
}

create_db "$DB_NAME"
create_db "$TEST_DB_NAME"

node server/src/migrate.js
echo "Database setup complete."
