#!/usr/bin/env node
/**
 * Archive Data Script
 *
 * Moves local data files older than a specified number of days to an archive location,
 * but ONLY after verifying the data has been indexed to both production and staging clusters.
 *
 * Usage:
 *   node scripts/archive-data.js [--dry-run] [--days N]
 *
 * Options:
 *   --dry-run   Show what would be archived without actually moving files
 *   --days N    Archive files older than N days (default: 7)
 *
 * Environment Variables:
 *   ARCHIVE_PATH  Required. The destination directory for archived files
 *                 Example: /Volumes/ExternalDrive/weather-archive
 *
 * The script will:
 * 1. Query both clusters for their latest indexed date
 * 2. Find local files whose data is older than the safe archive threshold
 * 3. Move verified files to ARCHIVE_PATH/data/{year}/{month}/
 *
 * LIMITATION: This script verifies that the cluster's latest indexed date is newer than
 * the file's data, but does NOT verify that every individual record in the file was indexed.
 * If there are gaps in the indexed data, some records may be archived without being indexed.
 * The backfill script should be run periodically to detect and fill any gaps.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createEsClient } = require('../src/dataIndexers/esClient');
const { searchDocsByDateRange } = require('../src/dataIndexers/esClientMethods');
const Logger = require('../src/logger');

const logger = new Logger('[archive-data]');

// Constants
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 7;

const DATA_DIRS = {
  imperial: 'data/ambient-weather-heiligers-imperial',
  imperialJsonl: 'data/ambient-weather-heiligers-imperial-jsonl',
  metricJsonl: 'data/ambient-weather-heiligers-metric-jsonl'
};

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysIndex = args.indexOf('--days');

let retentionDays = DEFAULT_RETENTION_DAYS;
if (daysIndex !== -1) {
  const daysValue = args[daysIndex + 1];
  const parsedDays = parseInt(daysValue, 10);

  if (!daysValue || Number.isNaN(parsedDays) || parsedDays <= 0) {
    logger.logError('Invalid value for --days. Please provide a positive integer, e.g. "--days 7".');
    process.exit(1);
  }

  retentionDays = parsedDays;
}

/**
 * Determine the archive subdirectory based on file path
 */
function getArchiveSubDir(filePath) {
  if (filePath.includes('imperial-jsonl')) {
    return 'imperial-jsonl';
  }
  if (filePath.includes('metric-jsonl')) {
    return 'metric-jsonl';
  }
  return 'imperial';
}

/**
 * Validate that required data directories exist
 */
function validateDataDirs() {
  const missingDirs = [];

  for (const [name, dirPath] of Object.entries(DATA_DIRS)) {
    if (!fs.existsSync(dirPath)) {
      missingDirs.push(`${name}: ${dirPath}`);
    }
  }

  if (missingDirs.length > 0) {
    logger.logWarning(`Some data directories do not exist:\n  - ${missingDirs.join('\n  - ')}`);
    return false;
  }

  return true;
}

async function main() {
  logger.logInfo(`Starting archive process (dry-run: ${dryRun}, retention: ${retentionDays} days)`);

  // Validate data directories exist
  if (!validateDataDirs()) {
    logger.logWarning('Continuing with available directories...');
  }

  // Check for ARCHIVE_PATH
  const archivePath = process.env.ARCHIVE_PATH;
  if (!archivePath && !dryRun) {
    logger.logError('ARCHIVE_PATH environment variable is required. Set it to the destination directory for archived files (e.g., export ARCHIVE_PATH=/Volumes/ExternalDrive/weather-archive)');
    process.exit(1);
  }

  if (!dryRun && !fs.existsSync(archivePath)) {
    logger.logError(`Archive path does not exist: ${archivePath}. Please ensure the archive destination is mounted/accessible.`);
    process.exit(1);
  }

  // Calculate cutoff date (files older than this can be archived)
  const cutoffDate = Date.now() - (retentionDays * MS_PER_DAY);
  logger.logInfo(`Cutoff date: ${new Date(cutoffDate).toISOString()} (files with all data before this may be archived)`);

  // Initialize cluster clients
  logger.logInfo('Connecting to clusters...');
  const prodClient = createEsClient('ES');
  const stagingClient = createEsClient('STAGING');

  // Get latest indexed dates from both clusters - use allSettled so one failure doesn't block the other
  const [prodResult, stagingResult] = await Promise.allSettled([
    getLatestIndexedDate(prodClient, 'PRODUCTION'),
    getLatestIndexedDate(stagingClient, 'STAGING')
  ]);

  const prodLatest = prodResult.status === 'fulfilled' ? prodResult.value : null;
  const stagingLatest = stagingResult.status === 'fulfilled' ? stagingResult.value : null;

  if (!prodLatest || !stagingLatest) {
    logger.logError('Could not determine latest indexed dates from both clusters. Aborting to prevent data loss.');
    if (!prodLatest) logger.logError('  - PRODUCTION: Failed to get latest date');
    if (!stagingLatest) logger.logError('  - STAGING: Failed to get latest date');
    process.exit(1);
  }

  // Only archive data that's been indexed in BOTH clusters
  const safeArchiveDate = Math.min(prodLatest, stagingLatest);
  logger.logInfo(`Safe archive date (data confirmed in both clusters): ${new Date(safeArchiveDate).toISOString()}`);

  // Find files eligible for archiving
  const filesToArchive = await findFilesToArchive(cutoffDate, safeArchiveDate);

  if (filesToArchive.length === 0) {
    logger.logInfo('No files eligible for archiving');
    return;
  }

  logger.logInfo(`Found ${filesToArchive.length} file sets eligible for archiving`);

  // Archive each file set
  let archivedCount = 0;
  let errorCount = 0;

  for (const fileSet of filesToArchive) {
    try {
      if (dryRun) {
        logger.logInfo(`[DRY-RUN] Would archive: ${fileSet.baseName}`);
        logger.logInfo(`  - ${fileSet.files.join(', ')}`);
      } else {
        await archiveFileSet(fileSet, archivePath);
        archivedCount++;
      }
    } catch (err) {
      logger.logError(`Failed to archive ${fileSet.baseName}:`, err.message);
      errorCount++;
    }
  }

  // Summary
  logger.logInfo('=== Archive Summary ===');
  if (dryRun) {
    logger.logInfo(`Would archive: ${filesToArchive.length} file sets`);
  } else {
    logger.logInfo(`Archived: ${archivedCount} file sets`);
    logger.logInfo(`Errors: ${errorCount}`);
  }
}

/**
 * Get the latest indexed date from a cluster
 */
async function getLatestIndexedDate(client, clusterName) {
  try {
    const result = await searchDocsByDateRange(
      client,
      'ambient_weather_heiligers_imperial_*',
      0,
      Date.now(),
      {
        size: 1,
        sort: ['dateutc:desc'],
        _source: ['dateutc'],
        expandWildcards: 'all'
      }
    );

    if (result && result.length > 0 && result[0]._source) {
      const latestDate = result[0]._source.dateutc;
      logger.logInfo(`[${clusterName}] Latest indexed: ${new Date(latestDate).toISOString()}`);
      return latestDate;
    }
  } catch (err) {
    logger.logError(`[${clusterName}] Error getting latest date:`, err.message);
  }
  return null;
}

/**
 * Find files eligible for archiving
 * Files must have ALL data older than both cutoffDate AND safeArchiveDate
 *
 * Note: Uses synchronous fs methods which is acceptable for a CLI script
 * that processes a limited number of files sequentially.
 */
async function findFilesToArchive(cutoffDate, safeArchiveDate) {
  const effectiveCutoff = Math.min(cutoffDate, safeArchiveDate);
  const eligibleFiles = [];

  // Check imperial JSON files
  const imperialDir = DATA_DIRS.imperial;
  if (!fs.existsSync(imperialDir)) {
    logger.logWarning(`Imperial data directory not found: ${imperialDir}`);
    return eligibleFiles;
  }

  const files = fs.readdirSync(imperialDir).filter(f => f.endsWith('.json') && f !== '.DS_Store');

  for (const file of files) {
    const baseName = file.replace('.json', '');

    // Parse epoch timestamps from filename (format: fromEpoch_toEpoch.json)
    const parts = baseName.split('_');
    if (parts.length !== 2) {
      logger.logWarning(`Skipping file with unexpected name format: ${file}`);
      continue;
    }

    const [fromEpoch, toEpoch] = parts.map(Number);

    if (isNaN(fromEpoch) || isNaN(toEpoch)) {
      logger.logWarning(`Skipping file with non-numeric epochs: ${file}`);
      continue;
    }

    // File is eligible if its LATEST data (toEpoch) is older than the cutoff
    if (toEpoch < effectiveCutoff) {
      const fileSet = {
        baseName,
        toEpoch,
        files: []
      };

      // Collect all related files
      const imperialPath = path.join(imperialDir, file);
      if (fs.existsSync(imperialPath)) {
        fileSet.files.push(imperialPath);
      }

      const jsonlPath = path.join(DATA_DIRS.imperialJsonl, `${baseName}.jsonl`);
      if (fs.existsSync(jsonlPath)) {
        fileSet.files.push(jsonlPath);
      }

      const metricPath = path.join(DATA_DIRS.metricJsonl, `${baseName}.jsonl`);
      if (fs.existsSync(metricPath)) {
        fileSet.files.push(metricPath);
      }

      if (fileSet.files.length > 0) {
        eligibleFiles.push(fileSet);
      }
    }
  }

  // Sort by date (oldest first)
  eligibleFiles.sort((a, b) => a.toEpoch - b.toEpoch);

  return eligibleFiles;
}

/**
 * Archive a file set to the destination
 */
async function archiveFileSet(fileSet, archivePath) {
  // Determine archive subdirectory based on date
  const fileDate = new Date(fileSet.toEpoch);
  const year = fileDate.getUTCFullYear();
  const month = String(fileDate.getUTCMonth() + 1).padStart(2, '0');

  for (const filePath of fileSet.files) {
    const fileName = path.basename(filePath);
    const subDir = getArchiveSubDir(filePath);

    const destDir = path.join(archivePath, 'data', subDir, `${year}`, month);
    const destPath = path.join(destDir, fileName);

    // Create destination directory if needed
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
      logger.logInfo(`Created archive directory: ${destDir}`);
    }

    // Move file
    fs.renameSync(filePath, destPath);
    logger.logInfo(`Archived: ${filePath} -> ${destPath}`);
  }
}

// Run
main().catch(err => {
  logger.logError('Archive script failed:', err);
  process.exit(1);
});
