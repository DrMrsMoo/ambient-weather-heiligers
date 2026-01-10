# Data and Log Archiving

This document describes the archiving system for managing data files and logs in the ambient-weather-heiligers project.

## Overview

The project includes automated archiving to move old data files and rotated logs to external storage after verifying they've been indexed to both production and staging clusters. This helps manage disk space on the Pi and Mac while preserving historical data.

## Prerequisites

- External storage mounted (e.g., NAS, external drive)
- `ARCHIVE_PATH` environment variable set
- Both production and staging Elasticsearch clusters accessible

## Setup

### 1. Configure Archive Destination

Add `ARCHIVE_PATH` to your `.env` file in the project directory:

```bash
# Mac example
export ARCHIVE_PATH=/Users/tina/Archives/weather-archive

# Pi example
export ARCHIVE_PATH=/mnt/nas/weather-archive
```

### 2. Test Archive Scripts

Before running actual archives, use dry-run mode:

```bash
# Test data archiving (dry-run)
npm run archive-data:dry-run

# Test log archiving (dry-run)
npm run archive-logs:dry-run
```

### 3. Schedule Archiving

#### Mac (launchd)

Install the launchd plists:

```bash
# Copy plists to LaunchAgents
cp com.heiligers.ambient-weather-archive-data.plist ~/Library/LaunchAgents/
cp com.heiligers.ambient-weather-archive-logs.plist ~/Library/LaunchAgents/

# Load the jobs
launchctl load ~/Library/LaunchAgents/com.heiligers.ambient-weather-archive-data.plist
launchctl load ~/Library/LaunchAgents/com.heiligers.ambient-weather-archive-logs.plist

# Verify they're loaded
launchctl list | grep ambient-weather
```

Schedule:
- **Data archiving**: Monthly on the 1st at 2:00 AM
- **Log archiving**: Weekly on Sunday at 3:00 AM

#### Pi (cron)

Add to your crontab (`crontab -e`):

```bash
# Archive data monthly (1st of month at 2am)
0 2 1 * * cd /home/pi/Projects/ambient-weather-heiligers && npm run archive-data >> logs/archive-data.log 2>&1

# Archive logs weekly (Sunday at 3am, after log rotation)
0 3 * * 0 cd /home/pi/Projects/ambient-weather-heiligers && npm run archive-logs >> logs/archive-logs.log 2>&1
```

## Data Archiving

### Usage

```bash
# Archive with defaults (7 day retention)
npm run archive-data

# Dry-run (show what would be archived)
npm run archive-data:dry-run

# Custom retention period
npm run archive-data -- --days 14
```

### How It Works

1. Queries both production and staging clusters for their latest indexed date
2. Finds local files whose data is older than the retention period
3. Verifies the data has been indexed to BOTH clusters
4. Moves files to `$ARCHIVE_PATH/data/{type}/{year}/{month}/`

### Archive Structure

```
$ARCHIVE_PATH/
  data/
    imperial/
      2024/
        01/
          1704067200000_1704153600000.json
    imperial-jsonl/
      2024/
        01/
          1704067200000_1704153600000.jsonl
    metric-jsonl/
      2024/
        01/
          1704067200000_1704153600000.jsonl
```

### Safety Features

- **Dual-cluster verification**: Only archives data confirmed in both prod and staging
- **Dry-run mode**: Test before actually moving files
- **Validation**: Checks archive path exists before proceeding

### Limitations

The archive script verifies that the cluster's latest indexed date is newer than the file's data, but does NOT verify that every individual record in the file was indexed. If there are gaps in the indexed data, some records may be archived without being indexed.

**Mitigation**: Run the backfill script periodically to detect and fill any gaps before archiving.

## Log Archiving

### Usage

```bash
# Archive with defaults (7 day retention)
npm run archive-logs

# Dry-run (show what would be archived)
npm run archive-logs:dry-run

# Custom retention period
npm run archive-logs -- --days 14
```

### How It Works

1. Finds rotated/compressed logs older than the retention period
2. Matches patterns: `*.log.[0-9]*`, `*.log-*`, `*.bz2`, `*.gz`
3. Moves files to `$ARCHIVE_PATH/logs/{year}/{month}/`

### Archive Structure

```
$ARCHIVE_PATH/
  logs/
    2024/
      01/
        cron.log.1.bz2
        launchd.log-20240115.bz2
```

## Log Rotation Setup

Log rotation must be configured separately for each platform. See the configuration files in `config/`.

### Mac (newsyslog)

1. **Install the configuration:**
   ```bash
   sudo cp config/newsyslog.d/ambient-weather.conf /etc/newsyslog.d/
   ```

2. **Test the configuration:**
   ```bash
   sudo newsyslog -nv  # dry-run to verify config is valid
   ```

3. **Configuration details:**
   - Main logs (cron.log, launchd.log, launchd-error.log): rotate weekly on Sunday (`$W0`)
   - Archive logs (archive-data.log, archive-logs.log + error logs): rotate monthly (`$M1`)
   - Keeps 4 weeks of compressed logs (`.bz2`)
   - newsyslog runs daily via system launchd

### Pi (logrotate)

1. **Install the configuration:**
   ```bash
   sudo cp config/logrotate.d/ambient-weather /etc/logrotate.d/
   ```

2. **Test the configuration:**
   ```bash
   sudo logrotate -d /etc/logrotate.d/ambient-weather  # dry-run
   sudo logrotate -f /etc/logrotate.d/ambient-weather  # force rotation
   ```

3. **Configuration details:**
   - Path: `/home/pi/Projects/ambient-weather-heiligers/logs/*.log`
   - Logs rotate weekly
   - Keeps 4 weeks of compressed logs
   - Uses gzip compression with date extension
   - Runs automatically via `/etc/cron.daily/logrotate`

## Troubleshooting

### Archive path doesn't exist

```
Error: Archive path does not exist: /Volumes/ExternalDrive/weather-archive
```

Ensure the external storage is mounted and the path exists.

### Cluster connection failed

```
Could not determine latest indexed dates from both clusters
```

Check that both Elasticsearch clusters are accessible and the environment variables are configured correctly.

### No files to archive

If no files are found for archiving:
- Files may not be old enough (check `--days` value)
- Data may not be indexed to both clusters yet
- Log rotation may not be running

### Restoring archived data

If you need to re-index archived data:

1. Copy files back from archive to original location
2. Run the backfill script to re-index the data

```bash
# Example: restore and re-index
cp $ARCHIVE_PATH/data/imperial/2024/01/*.json data/ambient-weather-heiligers-imperial/
npm run backfill -- --start 2024-01-01 --end 2024-01-31
```
