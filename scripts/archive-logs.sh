#!/bin/bash
#
# Archive rotated logs to external storage
#
# Usage:
#   ./scripts/archive-logs.sh [--dry-run]
#
# Environment Variables:
#   ARCHIVE_PATH  Required. The destination directory for archived logs
#
# This script moves compressed/rotated logs older than 7 days to ARCHIVE_PATH/logs/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
fi

# Check ARCHIVE_PATH
if [[ -z "$ARCHIVE_PATH" ]]; then
    echo "Error: ARCHIVE_PATH environment variable is required"
    echo "Example: export ARCHIVE_PATH=/Volumes/ExternalDrive/weather-archive"
    exit 1
fi

if [[ ! -d "$ARCHIVE_PATH" ]] && [[ "$DRY_RUN" == "false" ]]; then
    echo "Error: Archive path does not exist: $ARCHIVE_PATH"
    exit 1
fi

ARCHIVE_LOG_DIR="$ARCHIVE_PATH/logs"
YEAR=$(date +%Y)
MONTH=$(date +%m)
DEST_DIR="$ARCHIVE_LOG_DIR/$YEAR/$MONTH"

echo "=== Log Archive Script ==="
echo "Log directory: $LOG_DIR"
echo "Archive destination: $DEST_DIR"
echo "Dry run: $DRY_RUN"
echo ""

# Find rotated/compressed logs older than 7 days
# Patterns: *.log.0, *.log.1.bz2, *.log-20241225.bz2, etc.
LOGS_TO_ARCHIVE=$(find "$LOG_DIR" -type f \( -name "*.log.[0-9]*" -o -name "*.log-*" -o -name "*.bz2" -o -name "*.gz" \) -mtime +7 2>/dev/null || true)

if [[ -z "$LOGS_TO_ARCHIVE" ]]; then
    echo "No rotated logs older than 7 days found"
    exit 0
fi

# Count files
FILE_COUNT=$(echo "$LOGS_TO_ARCHIVE" | wc -l | tr -d ' ')
echo "Found $FILE_COUNT log file(s) to archive"
echo ""

# Process each file
for LOG_FILE in $LOGS_TO_ARCHIVE; do
    FILENAME=$(basename "$LOG_FILE")

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "[DRY-RUN] Would archive: $LOG_FILE -> $DEST_DIR/$FILENAME"
    else
        # Create destination directory if needed
        mkdir -p "$DEST_DIR"

        # Move file
        mv "$LOG_FILE" "$DEST_DIR/$FILENAME"
        echo "Archived: $LOG_FILE -> $DEST_DIR/$FILENAME"
    fi
done

echo ""
echo "=== Archive Complete ==="
