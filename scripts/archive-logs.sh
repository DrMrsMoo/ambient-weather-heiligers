#!/bin/bash
#
# Archive rotated logs to external storage
#
# Usage:
#   ./scripts/archive-logs.sh [--dry-run] [--days N]
#
# Options:
#   --dry-run   Show what would be archived without actually moving files
#   --days N    Archive logs older than N days (default: 7)
#
# Environment Variables:
#   ARCHIVE_PATH  Required. The destination directory for archived logs
#
# This script moves compressed/rotated logs older than N days to ARCHIVE_PATH/logs/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

# Default values
DRY_RUN=false
RETENTION_DAYS=7

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --days)
            if [[ -z "$2" ]] || ! [[ "$2" =~ ^[0-9]+$ ]] || [[ "$2" -le 0 ]]; then
                echo "Error: --days requires a positive integer value"
                echo "Example: ./scripts/archive-logs.sh --days 14"
                exit 1
            fi
            RETENTION_DAYS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./scripts/archive-logs.sh [--dry-run] [--days N]"
            exit 1
            ;;
    esac
done

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
echo "Retention days: $RETENTION_DAYS"
echo "Dry run: $DRY_RUN"
echo ""

# Check if log directory exists
if [[ ! -d "$LOG_DIR" ]]; then
    echo "Log directory does not exist: $LOG_DIR"
    exit 0
fi

# Find rotated/compressed logs older than N days using null-delimited output
# Patterns: *.log.0, *.log.1.bz2, *.log-20241225.bz2, etc.
# Using mapfile with null delimiter to handle filenames with spaces safely
mapfile -d '' LOGS_TO_ARCHIVE < <(find "$LOG_DIR" -type f \( -name "*.log.[0-9]*" -o -name "*.log-*" -o -name "*.bz2" -o -name "*.gz" \) -mtime +"$RETENTION_DAYS" -print0 2>/dev/null || true)

if [[ "${#LOGS_TO_ARCHIVE[@]}" -eq 0 ]]; then
    echo "No rotated logs older than $RETENTION_DAYS days found"
    exit 0
fi

# Count files
FILE_COUNT="${#LOGS_TO_ARCHIVE[@]}"
echo "Found $FILE_COUNT log file(s) to archive"
echo ""

# Process each file
for LOG_FILE in "${LOGS_TO_ARCHIVE[@]}"; do
    # Skip empty entries
    [[ -z "$LOG_FILE" ]] && continue

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
