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

Set the `ARCHIVE_PATH` environment variable to your archive location:

```bash
# Mac
export ARCHIVE_PATH=/Volumes/ExternalDrive/weather-archive

# Pi
export ARCHIVE_PATH=/mnt/nas/weather-archive
```

Add this to your `.bashrc` or environment file for persistence.

### 2. Test Archive Scripts

Before running actual archives, use dry-run mode:

```bash
# Test data archiving (dry-run)
npm run archive-data:dry-run

# Test log archiving (dry-run)
npm run archive-logs:dry-run
```

### 3. Schedule via Cron

Add to your crontab (`crontab -e`):

```bash
# Archive data monthly (1st of month at 2am)
0 2 1 * * cd /path/to/ambient-weather-heiligers && npm run archive-data >> logs/archive.log 2>&1

# Archive logs weekly (Sunday at 3am, after log rotation)
0 3 * * 0 cd /path/to/ambient-weather-heiligers && npm run archive-logs >> logs/archive.log 2>&1
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

1. **Update paths in the config file:**

   Edit `config/newsyslog.d/ambient-weather.conf` and update the log paths to match your installation:
   ```
   /Users/YOUR_USERNAME/Projects/ambient-weather-heiligers/logs/cron.log      644  4  1000  $W0  JGN
   /Users/YOUR_USERNAME/Projects/ambient-weather-heiligers/logs/launchd.log   644  4  500   $W0  JGN
   ```

2. **Install the configuration:**
   ```bash
   sudo cp config/newsyslog.d/ambient-weather.conf /etc/newsyslog.d/
   ```

3. **Test the configuration:**
   ```bash
   sudo newsyslog -nv  # dry-run to verify config is valid
   ```

4. **Configuration details:**
   - Logs rotate weekly on Sunday (`$W0`)
   - Keeps 4 weeks of compressed logs (`.bz2`)
   - Size limits: 1000KB for cron.log, 500KB for launchd.log
   - newsyslog runs daily via system launchd

### Pi (logrotate)

1. **Update the log path in the config file:**

   Edit `config/logrotate.d/ambient-weather` and update line 10 to match your installation:
   ```
   /home/YOUR_USERNAME/ambient-weather-heiligers/logs/*.log {
   ```

2. **Install the configuration:**
   ```bash
   sudo cp config/logrotate.d/ambient-weather /etc/logrotate.d/
   ```

3. **Test the configuration:**
   ```bash
   sudo logrotate -d /etc/logrotate.d/ambient-weather  # dry-run
   sudo logrotate -f /etc/logrotate.d/ambient-weather  # force rotation
   ```

4. **Configuration details:**
   - Logs rotate weekly
   - Keeps 4 weeks of compressed logs
   - Uses bzip2 compression
   - Runs via `/etc/cron.daily/logrotate`

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
