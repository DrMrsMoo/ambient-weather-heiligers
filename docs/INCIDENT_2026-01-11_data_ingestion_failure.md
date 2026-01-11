# Incident Report: Data Ingestion Failure (2026-01-11)

## Summary

Production and staging Elasticsearch clusters stopped receiving new data after 2026-01-10 @ 17:55:00 MST (2026-01-11 00:55:00 UTC). The root cause was a log file permission issue introduced by the `newsyslog` log rotation system, not a problem with the recently implemented cluster-based fetch logic.

## Timeline

- **2026-01-10 18:00 MST**: Last successful cron job run
- **2026-01-11 00:42 MST**: `newsyslog` rotates `logs/cron.log`, creates new file owned by `root:admin`
- **2026-01-11 05:20 MST**: Cron job fails silently - cannot write to root-owned log file
- **2026-01-11 14:31 MST**: Issue discovered and investigated
- **2026-01-11 14:49 MST**: Fix deployed, data ingestion resumed

## Root Cause

The `newsyslog` configuration in `/etc/newsyslog.d/ambient-weather.conf` did not specify ownership for rotated log files. When `newsyslog` rotated `logs/cron.log` on 2026-01-11 at 00:42, it created a new log file owned by `root:admin` (default ownership).

The cron job runs as user `tina`, and when the script tried to append to the root-owned log file on line 19 of `fetchAndIndex-production.sh`:

```bash
/Users/tina/.nvm/versions/node/v23.5.0/bin/node runMainIIFE.js >> logs/cron.log 2>&1
```

It failed with:
```
fetchAndIndex-production.sh: line 19: logs/cron.log: Permission denied
```

This caused the script to exit before any data fetching or indexing could occur.

## Investigation Process

### Initial Hypothesis
Initially suspected the cluster-based fetch date logic introduced in PR #10 might be causing issues, since this was the most recent significant change to the data pipeline.

### Discovery Steps

1. **Examined git history** to understand recent changes
   - Reviewed commits around PR #10 (cluster-based fetch dates)
   - Verified bug fixes in commit `828c978` were included

2. **Checked production-current tag**
   - Confirmed tag existed and pointed to `7475c5a` (merge of PR #10)
   - Tag included the `!= null` fix for epoch 0 edge case

3. **Analyzed cron logs**
   - Found `logs/cron.log` was rotated on Jan 11 at 00:42
   - Last successful run logged at Jan 10 18:00 (01:00 UTC)
   - Logs showed successful indexing up to timestamp `1768092900000` (2026-01-11T00:55:00.000Z)

4. **Checked data files**
   - Most recent file: `1768092900000_1768092900000.jsonl` (Jan 10 18:00)
   - Confirmed data gap from Jan 10 18:00 to present

5. **Attempted manual script execution**
   - Ran `bash fetchAndIndex-production.sh`
   - Immediately failed with "Permission denied" on `logs/cron.log`

6. **Identified permission mismatch**
   ```bash
   $ ls -lah logs/cron.log
   -rw-r--r--  1 root  admin    75B Jan 11 00:42 logs/cron.log

   $ whoami
   tina
   ```

## Technical Details

### Affected Components
- **Cron jobs**: Both Mac and Raspberry Pi cronjobs
- **Log files**: All files managed by newsyslog/logrotate
- **Data pipeline**: Fetch and indexing stopped completely

### Cron Schedule
- **Mac**: `*20 5,17 * * *` (05:20 and 17:20 daily)
- **Raspberry Pi**: `20 11,23 * * *` (11:20 and 23:20 daily)

### Missing Data Window
- **Start**: 2026-01-11 01:00:00 UTC (Jan 10 18:00 MST)
- **End**: 2026-01-11 21:45:00 UTC (Jan 11 14:45 MST)
- **Duration**: ~20 hours, 45 minutes
- **Records**: 250 measurements (5-minute intervals)

## Resolution

### Code Changes

#### 1. Updated newsyslog Configuration
**File**: `config/newsyslog.d/ambient-weather.conf`

**Change**: Added `tina:admin` ownership specification to all log file entries

```diff
-# Format: logfile mode count size(KB) when flags pidfile signal
+# Format: logfile owner:group mode count size(KB) when flags pidfile signal

-/Users/tina/Projects/ambient-weather-heiligers/logs/cron.log              644  4    1000  $W0   JGN
+/Users/tina/Projects/ambient-weather-heiligers/logs/cron.log              tina:admin 644  4    1000  $W0   JGN
```

**Commit**: `8db600b` - "Fix newsyslog ownership to prevent permission errors"

#### 2. Updated production-current Tag
Moved `production-current` tag from `7475c5a` to `8db600b` to include the newsyslog fix.

```bash
git tag -f production-current HEAD
git push origin production-current --force
```

### Manual Steps Performed

1. **Fixed immediate log file ownership**:
   ```bash
   sudo chown tina:admin logs/cron.log
   ```

2. **Installed updated newsyslog configuration**:
   ```bash
   sudo cp config/newsyslog.d/ambient-weather.conf /etc/newsyslog.d/
   ```

3. **Verified configuration**:
   ```bash
   sudo newsyslog -nv
   ```

4. **Tested fix**:
   ```bash
   bash fetchAndIndex-production.sh
   ```
   - Successfully fetched 250 records
   - Indexed to both production and staging clusters
   - Data range: 2026-01-11 01:00:00 UTC to 21:45:00 UTC

## Verification

### Test Results
```
[main]: [PRODUCTION] Latest indexed date: 2026-01-11T00:55:00.000Z
[main]: [STAGING] Latest indexed date: 2026-01-11T00:55:00.000Z
[main]: [FETCH] Will fetch data newer than: 2026-01-11T00:55:00.000Z (older of both clusters)

[main]: [PRODUCTION] Indexing 250 imperial documents...
[main]: [PRODUCTION] Imperial data indexed successfully
[main]: [PRODUCTION] Indexing 250 metric documents...
[main]: [PRODUCTION] Metric data indexed successfully

[main]: [STAGING] Indexing 250 imperial documents...
[main]: [STAGING] Imperial data indexed successfully
[main]: [STAGING] Indexing 250 metric documents...
[main]: [STAGING] Metric data indexed successfully

[main]: [PRODUCTION] Result: { cluster: 'PRODUCTION', status: 'success' }
[main]: [STAGING] Result: { cluster: 'STAGING', status: 'success' }
```

### Data Files Created
```bash
$ ls -lht data/ambient-weather-heiligers-imperial-jsonl/ | head -3
-rw-r--r--@ 1 tina  staff   121K Jan 11 14:49 1768093200000_1768167900000.jsonl
-rw-r--r--@ 1 tina  staff   497B Jan 10 18:00 1768092900000_1768092900000.jsonl
```

## Prevention Measures

### Immediate
1. ✅ Updated newsyslog config to specify ownership
2. ✅ Updated production-current tag
3. ✅ Fixed existing log file permissions

### Future Prevention
1. **Raspberry Pi**: Update logrotate configuration to include ownership specification
   - File: `config/logrotate.d/ambient-weather`
   - Add `create 644 pi pi` directive

2. **Monitoring**: Consider adding alerting for:
   - Cron job failures
   - Data ingestion gaps > 1 hour
   - Log file permission mismatches

3. **Testing**: Add pre-deployment testing that includes:
   - Log rotation simulation
   - Permission verification
   - Cron job execution as target user

## Lessons Learned

### What Went Well
1. The cluster-based fetch logic worked correctly
2. System automatically caught up on missing data once fixed
3. No data loss - all weather measurements preserved
4. Comprehensive logging made debugging straightforward

### What Could Be Improved
1. Log rotation configuration should have been tested with actual rotation
2. Cron jobs failed silently - need better error notification
3. Manual intervention required - automation could fix some issues automatically

### Documentation Gaps
1. Newsyslog configuration lacked ownership specification
2. No documented procedure for troubleshooting "no data" scenarios
3. Missing runbook for common permission issues

## Action Items

- [x] Fix newsyslog configuration on Mac
- [ ] Fix logrotate configuration on Raspberry Pi
- [ ] Install updated configs on both systems
- [ ] Add monitoring/alerting for cron job failures
- [ ] Document troubleshooting procedures for data ingestion issues
- [ ] Consider adding automated permission checks to cron scripts

## References

- **Affected commits**:
  - `fbd84e8` - Initial cluster-based fetch implementation
  - `828c978` - Bug fixes for cluster date handling
  - `8db600b` - Newsyslog ownership fix

- **Pull Requests**:
  - PR #10 - Cluster-based fetch dates
  - PR #11 - Archiving setup
  - PR #12 - Cross-platform compatibility

- **Configuration files**:
  - `config/newsyslog.d/ambient-weather.conf` (macOS)
  - `config/logrotate.d/ambient-weather` (Raspberry Pi)
  - `fetchAndIndex-production.sh`

## Appendix: Newsyslog Format Reference

### Before (Incorrect)
```
# Format: logfile mode count size(KB) when flags pidfile signal
/path/to/log.log    644  4    1000  $W0   JGN
```

### After (Correct)
```
# Format: logfile owner:group mode count size(KB) when flags pidfile signal
/path/to/log.log    tina:admin 644  4    1000  $W0   JGN
```

### Key Parameters
- `owner:group`: User and group ownership (e.g., `tina:admin`)
- `mode`: File permissions (e.g., `644`)
- `count`: Number of rotated logs to keep
- `size(KB)`: Rotate when file exceeds this size
- `when`: Rotation schedule (`$W0` = weekly on Sunday, `$M1` = monthly on 1st)
- `flags`: `J` = bzip2 compression, `G` = always rotate, `N` = no signal needed

---

**Incident resolved**: 2026-01-11 14:49 MST
**Total downtime**: ~20 hours 45 minutes
**Data recovery**: 100% (all missing data fetched and indexed)
