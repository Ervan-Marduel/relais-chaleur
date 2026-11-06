#!/usr/bin/env bash
# Démarre un PostgreSQL LOCAL et JETABLE pour le développement et les tests.
# Ne touche à aucune base existante : données dans ./.local-pg, port 54329.
# Usage : npm run db:local            (démarre)
#         npm run db:local -- stop    (arrête)
#         npm run db:local -- reset   (efface et recrée)
set -euo pipefail
cd "$(dirname "$0")/.."
PGDIR="$(pwd)/.local-pg"
PORT="${LOCAL_PG_PORT:-54329}"
BIN="$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"

run() {
  if [ "$(id -u)" = "0" ]; then
    # initdb refuse de tourner en root : on délègue à l'utilisateur système "postgres".
    chown -R postgres "$PGDIR" 2>/dev/null || true
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

cmd="${1:-start}"
if [ "$cmd" = "stop" ]; then
  run "$BIN/pg_ctl -D '$PGDIR/data' stop -m fast" || true
  exit 0
fi
if [ "$cmd" = "reset" ]; then
  run "$BIN/pg_ctl -D '$PGDIR/data' stop -m fast" 2>/dev/null || true
  rm -rf "$PGDIR"
fi

mkdir -p "$PGDIR"
if [ ! -f "$PGDIR/data/PG_VERSION" ]; then
  run "$BIN/initdb -D '$PGDIR/data' -U rc -A trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null"
fi
if ! run "$BIN/pg_ctl -D '$PGDIR/data' status" >/dev/null 2>&1; then
  run "$BIN/pg_ctl -D '$PGDIR/data' -l '$PGDIR/server.log' -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1' -w start >/dev/null"
fi
for db in rc_dev rc_test rc_e2e; do
  psql -h 127.0.0.1 -p "$PORT" -U rc -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || psql -h 127.0.0.1 -p "$PORT" -U rc -d postgres -qc "CREATE DATABASE $db"
done
echo "PostgreSQL local prêt sur 127.0.0.1:$PORT (bases rc_dev, rc_test, rc_e2e)"
echo "DATABASE_URL=postgres://rc@127.0.0.1:$PORT/rc_dev"
