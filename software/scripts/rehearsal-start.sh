#!/usr/bin/env bash
set -euo pipefail

export SEEKR_DATA_DIR="${SEEKR_DATA_DIR:-.tmp/rehearsal-data}"
export SEEKR_EXPECTED_SOURCES="${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}"

select_free_port() {
  node - <<'NODE'
const net = require("node:net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : undefined;
  server.close(() => {
    if (!port) process.exit(1);
    console.log(port);
  });
});
NODE
}

port_is_busy() {
  node - "$1" <<'NODE'
const net = require("node:net");
const port = Number(process.argv[2]);
const server = net.createServer();
server.once("error", (error) => process.exit(error && error.code === "EADDRINUSE" ? 0 : 1));
server.listen(port, "127.0.0.1", () => server.close(() => process.exit(1)));
NODE
}

api_port_explicit=0
client_port_explicit=0
if [[ -n "${PORT:-}" || -n "${SEEKR_API_PORT:-}" ]]; then
  api_port_explicit=1
fi
if [[ -n "${SEEKR_CLIENT_PORT:-}" ]]; then
  client_port_explicit=1
fi

if [[ -n "${PORT:-}" && -n "${SEEKR_API_PORT:-}" && "$PORT" != "$SEEKR_API_PORT" ]]; then
  echo "PORT and SEEKR_API_PORT disagree; set only one API port or set both to the same value before running npm run rehearsal:start." >&2
  exit 1
fi

if [[ -z "${PORT:-}" && -n "${SEEKR_API_PORT:-}" ]]; then
  export PORT="$SEEKR_API_PORT"
fi
if [[ -n "${PORT:-}" && -z "${SEEKR_API_PORT:-}" ]]; then
  export SEEKR_API_PORT="$PORT"
fi
export PORT="${PORT:-8787}"
export SEEKR_API_PORT="${SEEKR_API_PORT:-$PORT}"
export SEEKR_CLIENT_PORT="${SEEKR_CLIENT_PORT:-5173}"

if [[ "$api_port_explicit" -eq 0 ]] && port_is_busy "$PORT"; then
  selected_api_port="$(select_free_port)"
  export PORT="$selected_api_port"
  export SEEKR_API_PORT="$selected_api_port"
  echo "Default SEEKR API port 8787 is busy; auto-selected free local API port $SEEKR_API_PORT."
fi

if [[ "$client_port_explicit" -eq 0 ]] && port_is_busy "$SEEKR_CLIENT_PORT"; then
  selected_client_port="$(select_free_port)"
  while [[ "$selected_client_port" == "$SEEKR_API_PORT" ]]; do
    selected_client_port="$(select_free_port)"
  done
  export SEEKR_CLIENT_PORT="$selected_client_port"
  echo "Default SEEKR client port 5173 is busy; auto-selected free local client port $SEEKR_CLIENT_PORT."
fi

echo "Preparing SEEKR local setup..."
npm run setup:local

echo "Refreshing SEEKR source-control handoff..."
npm run audit:source-control

echo "Running SEEKR plug-and-play doctor..."
npm run doctor

echo "Starting SEEKR rehearsal with SEEKR_DATA_DIR=$SEEKR_DATA_DIR"
echo "API: http://127.0.0.1:$SEEKR_API_PORT"
echo "Client: http://127.0.0.1:$SEEKR_CLIENT_PORT"
echo "Expected sources: $SEEKR_EXPECTED_SOURCES"
exec npm run dev
