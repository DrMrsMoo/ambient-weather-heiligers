const AmbientWeatherApi = require('ambient-weather-api');
const fs = require('file-system');
const Logger = require('../logger');
const { createEsClient } = require('../dataIndexers/esClient');
const { searchDocsByDateRange } = require('../dataIndexers/esClientMethods');
const IndexData = require('../dataIndexers');
const FetchRawData = require('../dataFetchers');
const { prepareDataForBulkIndexing } = require('../../main_utils');
const { convertToMetric } = require('../utils');
const readlineSync = require('readline-sync');
const moment = require('moment-timezone');

const backfillLogger = new Logger('[backfill]');

/**
 * Main backfill orchestration function
 * @param {object} cliArgs - Parsed CLI arguments from yargs
 * @returns {object} - Result of backfill operation
 */
async function runBackfill(cliArgs) {
  try {
    backfillLogger.logInfo(`[${new Date().toISOString()}] Starting backfill operation...`);

    // Step 1: Validate arguments
    const validation = validateArgs(cliArgs);
    if (!validation.valid) {
      backfillLogger.logError('[validateArgs] Validation failed:', validation.error);
      return { status: 'error', error: validation.error };
    }

    const { clusters, fromDate, toDate } = validation;

    // If --both flag, run backfill for each cluster independently
    if (clusters.length > 1) {
      backfillLogger.logInfo(`[DUAL-CLUSTER MODE] Will backfill both clusters with independent gap detection`);

      // Process clusters sequentially for better UX when confirmation is needed
      const results = [];
      for (let i = 0; i < clusters.length; i++) {
        const { cluster, clusterName } = clusters[i];
        const result = await backfillSingleCluster(
          cluster,
          clusterName,
          fromDate,
          toDate,
          cliArgs.yes,
          { clusterIndex: i + 1, totalClusters: clusters.length }
        );
        results.push({ status: 'fulfilled', value: result });
      }

      // Convert to Promise.allSettled format for compatibility with existing code
      const allSettledResults = results;

      // Log final results
      backfillLogger.logInfo(`[${new Date().toISOString()}] === DUAL-CLUSTER BACKFILL RESULTS ===`);
      allSettledResults.forEach((result, idx) => {
        const clusterName = clusters[idx].clusterName;
        if (result.status === 'fulfilled') {
          backfillLogger.logInfo(`[${clusterName}] Result:`, result.value);
        } else {
          backfillLogger.logError(`[${clusterName}] Failed:`, result.reason);
        }
      });

      return {
        status: 'success',
        mode: 'dual-cluster',
        results: allSettledResults.map((r, idx) => ({
          cluster: clusters[idx].clusterName,
          result: r.status === 'fulfilled' ? r.value : { status: 'error', error: r.reason }
        }))
      };
    }

    // Single cluster mode
    const { cluster, clusterName } = clusters[0];
    const result = await backfillSingleCluster(cluster, clusterName, fromDate, toDate, cliArgs.yes, {});
    return result;

  } catch (err) {
    backfillLogger.logError('[runBackfill] [ERROR]', err);
    return { status: 'error', error: err.message };
  }
}

/**
 * Backfill a single cluster
 * @param {string} cluster - Cluster key ('ES' or 'STAGING')
 * @param {string} clusterName - Display name for cluster
 * @param {number} fromDate - Start date in epoch ms
 * @param {number} toDate - End date in epoch ms
 * @param {boolean} skipConfirmation - Skip user confirmation
 * @param {object} context - Optional context (clusterIndex, totalClusters for dual-cluster mode)
 * @returns {object} - Backfill result
 */
async function backfillSingleCluster(cluster, clusterName, fromDate, toDate, skipConfirmation, context = {}) {
  try {
    // Step 1: Create ES client
    const client = createEsClient(cluster);
    backfillLogger.logInfo(`[${clusterName}] Created ES client`);

    // Step 2: Find gap boundaries for this specific cluster
    backfillLogger.logInfo(`[${clusterName}] Searching for data gap boundaries...`);
    const boundaries = await findDataGapBoundaries(client, fromDate, toDate, clusterName);

    if (!boundaries.gapFound) {
      backfillLogger.logInfo(`[${clusterName}] No gap found - data already complete`);
      return { status: 'success', cluster: clusterName, message: 'No gap found - data already complete' };
    }

    // Step 3: Display boundaries and get confirmation
    const confirmed = confirmBackfill(boundaries, clusterName, skipConfirmation, context);

    if (!confirmed) {
      backfillLogger.logInfo(`[${clusterName}] User cancelled backfill operation`);
      return { status: 'cancelled', cluster: clusterName, message: 'Backfill cancelled by user' };
    }

    // Step 4: Perform backfill
    backfillLogger.logInfo(`[${new Date().toISOString()}] [${clusterName}] Starting backfill...`);
    const result = await performBackfill(client, clusterName, boundaries.startEpoch, boundaries.endEpoch);

    backfillLogger.logInfo(`[${new Date().toISOString()}] [${clusterName}] Backfill complete!`);
    return result;

  } catch (err) {
    backfillLogger.logError(`[${clusterName}] [backfillSingleCluster] ERROR:`, err);
    return { status: 'error', cluster: clusterName, error: err.message };
  }
}

/**
 * Validate CLI arguments
 * @param {object} args - CLI arguments from yargs
 * @returns {object} - Validation result with parsed values
 */
function validateArgs(args) {
  try {
    // Validate cluster selection (prod XOR staging XOR both)
    if (!args.prod && !args.staging && !args.both) {
      return { valid: false, error: 'Must specify --prod, --staging, or --both' };
    }

    // Build clusters array
    const clusters = [];
    if (args.both) {
      clusters.push(
        { cluster: 'ES', clusterName: 'PRODUCTION' },
        { cluster: 'STAGING', clusterName: 'STAGING' }
      );
    } else if (args.prod) {
      clusters.push({ cluster: 'ES', clusterName: 'PRODUCTION' });
    } else if (args.staging) {
      clusters.push({ cluster: 'STAGING', clusterName: 'STAGING' });
    }

    // Validate and parse dates
    if (!args.from || !args.to) {
      return { valid: false, error: 'Must specify both --from and --to dates' };
    }

    const fromDate = parseDate(args.from);
    const toDate = parseDate(args.to);

    if (!fromDate.isValid || !toDate.isValid) {
      return {
        valid: false,
        error: `Invalid date format. Use YYYY-MM-DD. From: ${args.from}, To: ${args.to}`
      };
    }

    // Validate from < to
    if (fromDate.epoch >= toDate.epoch) {
      return {
        valid: false,
        error: `Start date must be before end date. From: ${args.from}, To: ${args.to}`
      };
    }

    backfillLogger.logInfo('[validateArgs] Validation successful');
    backfillLogger.logInfo(`[validateArgs] Target clusters: ${clusters.map(c => c.clusterName).join(', ')}`);

    return {
      valid: true,
      clusters,
      fromDate: fromDate.epoch,
      toDate: toDate.epoch
    };

  } catch (err) {
    return { valid: false, error: `Validation error: ${err.message}` };
  }
}

/**
 * Parse date string to epoch milliseconds
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {object} - Parsed date with epoch and validity
 */
function parseDate(dateString) {
  const parsed = moment.tz(dateString, 'YYYY-MM-DD', 'UTC');

  return {
    isValid: parsed.isValid(),
    epoch: parsed.valueOf(),
    formatted: parsed.format('YYYY-MM-DD HH:mm:ss [UTC]')
  };
}

/**
 * Find exact time boundaries of data gap
 * @param {object} client - ES client
 * @param {number} fromDate - Start date in epoch ms
 * @param {number} toDate - End date in epoch ms
 * @param {string} clusterName - Cluster name for logging
 * @returns {object} - Gap boundary information
 */
async function findDataGapBoundaries(client, fromDate, toDate, clusterName) {
  try {
    const imperialIndex = 'ambient_weather_heiligers_imperial_*';

    // Query for last document BEFORE fromDate
    backfillLogger.logInfo(`[${clusterName}] Querying for last document before ${moment(fromDate).format('YYYY-MM-DD')}...`);
    const lastDocBefore = await searchDocsByDateRange(
      client,
      imperialIndex,
      0,
      fromDate,
      {
        size: 1,
        sort: ['dateutc:desc'],
        _source: ['date', 'dateutc', '@timestamp'],
        expandWildcards: 'all'
      }
    );

    // Query for first document AFTER toDate
    backfillLogger.logInfo(`[${clusterName}] Querying for first document after ${moment(toDate).format('YYYY-MM-DD')}...`);
    const firstDocAfter = await searchDocsByDateRange(
      client,
      imperialIndex,
      toDate,
      Date.now(),
      {
        size: 1,
        sort: ['dateutc:asc'],
        _source: ['date', 'dateutc', '@timestamp'],
        expandWildcards: 'all'
      }
    );

    // Analyze results
    let startEpoch = fromDate;
    let endEpoch = toDate;
    let gapFound = true;

    if (lastDocBefore && lastDocBefore.length > 0) {
      const lastDoc = lastDocBefore[0];
      if (lastDoc._source && lastDoc._source.dateutc) {
        startEpoch = lastDoc._source.dateutc;
        backfillLogger.logInfo(`[${clusterName}] Last document before gap: ${moment(startEpoch).format('YYYY-MM-DD HH:mm:ss [UTC]')}`);
      }
    }

    if (firstDocAfter && firstDocAfter.length > 0) {
      const firstDoc = firstDocAfter[0];
      if (firstDoc._source && firstDoc._source.dateutc) {
        endEpoch = firstDoc._source.dateutc;
        backfillLogger.logInfo(`[${clusterName}] First document after gap: ${moment(endEpoch).format('YYYY-MM-DD HH:mm:ss [UTC]')}`);
      }
    }

    // Check if gap exists
    const gapDuration = moment.duration(endEpoch - startEpoch);

    if (gapDuration.asMinutes() < 10) {
      // Less than 10 minutes gap - likely no actual gap
      gapFound = false;
    }

    return {
      gapFound,
      startEpoch,
      endEpoch,
      startFormatted: moment(startEpoch).format('YYYY-MM-DD HH:mm:ss [UTC]'),
      endFormatted: moment(endEpoch).format('YYYY-MM-DD HH:mm:ss [UTC]'),
      durationHours: gapDuration.asHours().toFixed(2),
      durationDays: gapDuration.asDays().toFixed(2)
    };

  } catch (err) {
    backfillLogger.logError(`[${clusterName}] [findDataGapBoundaries] Error:`, err);
    throw err;
  }
}

/**
 * Display gap boundaries and get user confirmation
 * @param {object} boundaries - Gap boundary information
 * @param {string} clusterName - Cluster name for display
 * @param {boolean} skipConfirmation - Skip confirmation prompt if true
 * @param {object} context - Optional context (clusterIndex, totalClusters for dual-cluster mode)
 * @returns {boolean} - True if user confirms, false otherwise
 */
function confirmBackfill(boundaries, clusterName, skipConfirmation = false, context = {}) {
  const { clusterIndex, totalClusters } = context;
  const isMultiCluster = totalClusters && totalClusters > 1;

  console.log('\n========================================');
  if (isMultiCluster) {
    console.log(`Gap found in ${clusterName} cluster (${clusterIndex} of ${totalClusters}):`);
  } else {
    console.log(`Gap found in ${clusterName} cluster:`);
  }
  console.log('========================================');
  console.log(`Last document before gap: ${boundaries.startFormatted}`);
  console.log(`First document after gap: ${boundaries.endFormatted}`);
  console.log(`Gap duration: ${boundaries.durationHours} hours (${boundaries.durationDays} days)`);
  console.log('========================================\n');

  if (skipConfirmation) {
    console.log('Auto-confirming (--yes flag provided)...\n');
    return true;
  }

  const promptMessage = isMultiCluster
    ? `Proceed with backfill for ${clusterName}? (y/n): `
    : 'Proceed with backfill? (y/n): ';
  const answer = readlineSync.question(promptMessage);

  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * Perform the actual backfill operation
 * @param {object} client - ES client
 * @param {string} clusterName - Cluster name for logging
 * @param {number} startEpoch - Start epoch ms
 * @param {number} endEpoch - End epoch ms
 * @returns {object} - Backfill result
 */
async function performBackfill(client, clusterName, startEpoch, endEpoch) {
  try {
    const indexer = new IndexData(client);
    let dataRecords = [];
    let dataSource = 'unknown';

    // Step 1: Try to load data from existing local files first
    backfillLogger.logInfo(`[${clusterName}] Reading existing data files for date range...`);
    const { dataRecords: localRecords, filesProcessed } = await loadDataFromLocalFiles(startEpoch, endEpoch, clusterName);

    if (localRecords.length > 0) {
      backfillLogger.logInfo(`[${clusterName}] Loaded ${localRecords.length} records from ${filesProcessed} local files`);
      dataRecords = localRecords;
      dataSource = 'local';
    } else {
      // Step 1b: No local data found, try fetching from API
      backfillLogger.logInfo(`[${clusterName}] No data found in local files for specified range`);
      backfillLogger.logInfo(`[${clusterName}] Attempting to fetch data from Ambient Weather API...`);

      const awApi = new AmbientWeatherApi({
        apiKey: process.env.AMBIENT_WEATHER_API_KEY,
        applicationKey: process.env.AMBIENT_WEATHER_APPLICATION_KEY
      });
      const fetcher = new FetchRawData(awApi, fs);

      // Note: API counts backwards in time, so use endEpoch as the 'from' parameter
      // bypassRateLimit=true because backfill operates on past data and shouldn't be blocked by rate limiter
      const fetchResult = await fetcher.getDataForDateRanges(true, endEpoch, true); // skipSave=true, fromDate=endEpoch, bypassRateLimit=true

      if (fetchResult === 'too early') {
        backfillLogger.logWarning(`[${clusterName}] API returned "too early" - less than 5 minutes since last fetch`);
        return { status: 'skipped', message: 'Too early to fetch data (less than 5 minutes since last fetch)' };
      }

      if (!fetchResult || typeof fetchResult !== 'object' || !Array.isArray(fetchResult.dataFetchForDates)) {
        backfillLogger.logError(`[${clusterName}] Invalid fetch result from API`);
        return { status: 'error', error: 'Invalid data fetch result from API' };
      }

      const { dataFetchForDates } = fetchResult;

      if (dataFetchForDates.length === 0) {
        backfillLogger.logWarning(`[${clusterName}] No data returned from API for specified range`);
        return { status: 'skipped', message: 'No data available in API for specified range' };
      }

      // Flatten the fetched data and filter to our date range
      // Use < for endEpoch because endEpoch is the "first document after gap" which is already in the cluster
      dataRecords = dataFetchForDates.flat().filter(record => {
        const recordTime = record.dateutc;
        return recordTime > startEpoch && recordTime < endEpoch;
      });

      backfillLogger.logInfo(`[${clusterName}] Fetched ${dataRecords.length} records from API`);
      dataSource = 'api';
    }

    if (dataRecords.length === 0) {
      backfillLogger.logWarning(`[${clusterName}] No data available for specified range`);
      return { status: 'skipped', message: 'No data available for specified range' };
    }

    // Step 2: Write filtered data directly as JSONL (skip JSON -> JSONL conversion)
    const tempFileBaseName = `backfill_${startEpoch}_${endEpoch}`;
    const imperialJsonlPath = `./data/ambient-weather-heiligers-imperial-jsonl/${tempFileBaseName}.jsonl`;
    const metricJsonlPath = `./data/ambient-weather-heiligers-metric-jsonl/${tempFileBaseName}.jsonl`;

    backfillLogger.logInfo(`[${clusterName}] Writing ${dataRecords.length} imperial records to JSONL...`);
    const imperialJsonlContent = dataRecords.map(record => JSON.stringify(record)).join('\n');
    fs.writeFileSync(imperialJsonlPath, imperialJsonlContent);

    // Step 3: Convert imperial to metric and write metric JSONL
    backfillLogger.logInfo(`[${clusterName}] Converting ${dataRecords.length} records to metric and writing JSONL...`);
    const metricRecords = dataRecords.map(record => convertToMetric(record));
    const metricJsonlContent = metricRecords.map(record => JSON.stringify(record)).join('\n');
    fs.writeFileSync(metricJsonlPath, metricJsonlContent);

    // Step 4: Initialize indexer
    backfillLogger.logInfo(`[${clusterName}] Initializing indexer...`);
    const initResult = await indexer.initialize();
    if (initResult.outcome !== 'success') {
      backfillLogger.logError(`[${clusterName}] Indexer initialization failed:`, initResult);
      return { status: 'error', error: 'Indexer initialization failed' };
    }

    // Step 5: Index imperial data
    backfillLogger.logInfo(`[${clusterName}] Indexing imperial data...`);
    const imperialPayload = prepareDataForBulkIndexing([tempFileBaseName], 'imperial', backfillLogger);
    const imperialResult = await indexer.bulkIndexDocuments(imperialPayload, 'imperial');
    backfillLogger.logInfo(`[${clusterName}] Imperial indexing complete. Total docs: ${imperialResult.indexCounts.count}`);

    // Step 6: Index metric data
    backfillLogger.logInfo(`[${clusterName}] Indexing metric data...`);
    const metricPayload = prepareDataForBulkIndexing([tempFileBaseName], 'metric', backfillLogger);
    const metricResult = await indexer.bulkIndexDocuments(metricPayload, 'metric');
    backfillLogger.logInfo(`[${clusterName}] Metric indexing complete. Total docs: ${metricResult.indexCounts.count}`);

    // Step 7: Clean up temporary files
    backfillLogger.logInfo(`[${clusterName}] Cleaning up temporary files...`);
    if (fs.existsSync(imperialJsonlPath)) fs.unlinkSync(imperialJsonlPath);
    if (fs.existsSync(metricJsonlPath)) fs.unlinkSync(metricJsonlPath);

    return {
      status: 'success',
      cluster: clusterName,
      dataSource,
      recordsFound: dataRecords.length,
      imperialIndexed: imperialResult.indexCounts.count,
      metricIndexed: metricResult.indexCounts.count,
      imperialErrors: imperialResult.erroredDocuments.length,
      metricErrors: metricResult.erroredDocuments.length
    };

  } catch (err) {
    backfillLogger.logError(`[${clusterName}] [performBackfill] Error:`, err);
    return { status: 'error', cluster: clusterName, error: err.message };
  }
}

/**
 * Load data from existing local files within the specified date range
 * @param {number} startEpoch - Start epoch ms
 * @param {number} endEpoch - End epoch ms
 * @param {string} clusterName - Cluster name for logging
 * @returns {object} - { dataRecords: Array, filesProcessed: number }
 */
async function loadDataFromLocalFiles(startEpoch, endEpoch, clusterName) {
  const dataDir = './data/ambient-weather-heiligers-imperial';
  const allRecords = [];
  let filesProcessed = 0;

  try {
    // Read all files in the imperial data directory
    const files = fs.readdirSync(dataDir);
    backfillLogger.logInfo(`[${clusterName}] Found ${files.length} files in ${dataDir}`);

    // Process each JSON file
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = `${dataDir}/${file}`;

      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const records = JSON.parse(fileContent);

        if (!Array.isArray(records)) {
          backfillLogger.logWarning(`[${clusterName}] Skipping ${file} - not an array`);
          continue;
        }

        // Filter records within the date range
        // Use < for endEpoch because endEpoch is the "first document after gap" which is already in the cluster
        const filteredRecords = records.filter(record => {
          const recordTime = record.dateutc;
          return recordTime > startEpoch && recordTime < endEpoch;
        });

        if (filteredRecords.length > 0) {
          backfillLogger.logInfo(`[${clusterName}] Found ${filteredRecords.length} records in ${file}`);
          allRecords.push(...filteredRecords);
          filesProcessed++;
        }

      } catch (err) {
        backfillLogger.logWarning(`[${clusterName}] Error reading ${file}:`, err.message);
      }
    }

    // Sort records by dateutc (ascending)
    allRecords.sort((a, b) => a.dateutc - b.dateutc);

    return {
      dataRecords: allRecords,
      filesProcessed
    };

  } catch (err) {
    backfillLogger.logError(`[${clusterName}] Error loading local files:`, err);
    return { dataRecords: [], filesProcessed: 0 };
  }
}

module.exports = { runBackfill };
