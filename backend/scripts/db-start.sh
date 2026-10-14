#!/usr/bin/env bash
#
# db-start.sh — bring up the local PostgreSQL/PostGIS databases.
#
# Creates the 'foodbridge' role and both databases (development and test),
# enables PostGIS in each, and applies backend/migrations/*.sql. Safe to re-run:
# every step is guarded, and the migration runner skips files it has applied.
#
#   bash scripts/db-start.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."   # -> backend/

DB_USER="${DB_USER:-foodbridge}"
DB_PASS="${DB_PASS:-foodbridge}"
DB_NAME="${DB_NAME:-foodbridge}"
TEST_DB="${TEST_DB:-foodbridge_test}"

# Homebrew keeps postgresql's binaries off the default PATH for versioned formulae.
for d in /opt/homebrew/opt/postgresql@*/bin /opt/homebrew/bin /usr/local/bin; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
export PATH

command -v psql >/dev/null || { echo "[db] psql not found. Install with: brew install postgis"; exit 1; }

if ! pg_isready -q 2>/dev/null; then
  echo "[db] starting PostgreSQL"
  brew services start postgresql@17 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do pg_isready -q 2>/dev/null && break; sleep 1; done
fi
pg_isready -q || { echo "[db] PostgreSQL did not come up"; exit 1; }

# Connect as the superuser that Homebrew's install creates (the current user).
SU="${PGSUPERUSER:-$(whoami)}"

psql -U "$SU" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || {
  echo "[db] creating role $DB_USER"
  psql -U "$SU" -d postgres -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' SUPERUSER;"
}

for db in "$DB_NAME" "$TEST_DB"; do
  psql -U "$SU" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || {
    echo "[db] creating database $db"
    psql -U "$SU" -d postgres -c "CREATE DATABASE $db OWNER $DB_USER;"
  }
  # PostGIS must exist before the migration's spatial columns are created.
  psql -U "$SU" -d "$db" -c "CREATE EXTENSION IF NOT EXISTS postgis;" >/dev/null
done

echo "[db] applying migrations"
DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME" npm run migrate
DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:5432/$TEST_DB" npm run migrate

echo "[db] ready:"
echo "     dev  postgres://$DB_USER:***@localhost:5432/$DB_NAME"
echo "     test postgres://$DB_USER:***@localhost:5432/$TEST_DB"
