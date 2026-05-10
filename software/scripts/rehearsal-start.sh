#!/usr/bin/env bash
set -euo pipefail

export SEEKR_DATA_DIR="${SEEKR_DATA_DIR:-.tmp/rehearsal-data}"
export SEEKR_EXPECTED_SOURCES="${SEEKR_EXPECTED_SOURCES:-mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception}"

echo "Preparing SEEKR local setup..."
npm run setup:local

echo "Refreshing SEEKR source-control handoff..."
npm run audit:source-control

echo "Running SEEKR plug-and-play doctor..."
npm run doctor

echo "Starting SEEKR rehearsal with SEEKR_DATA_DIR=$SEEKR_DATA_DIR"
echo "Expected sources: $SEEKR_EXPECTED_SOURCES"
exec npm run dev
