const AmbientWeatherApi = require('ambient-weather-api');
const fs = require('file-system');
const Logger = require('../logger');
const { createEsClient } = require('../dataIndexers/esClient');
const { searchDocsByDateRange, getMostRecentDoc } = require('../dataIndexers/esClientMethods');
const IndexData = require('../dataIndexers');
const FetchRawData = require('../dataFetchers');
const { ConvertImperialToJsonl, ConvertImperialToMetric } = require('../converters');
const { prepareDataForBulkIndexing } = require('../../main_utils');
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

    const { cluster, clusterName, fromDate, toDate } = validation;

    // Step 2: Create ES client
    const client = createEsClient(cluster);
    backfillLogger.logInfo(`[${clusterName}] Created ES client`);

    // Step 3: Find gap boundaries
    backfillLogger.logInfo(`[${clusterName}] Searching for data gap boundaries...`);
    const boundaries = await findDataGapBoundaries(client, fromDate, toDate, clusterName);

    if (!boundaries.gapFound) {
      backfillLogger.logInfo(`[${clusterName}] No gap found - data already complete`);
      return { status: 'success', message: 'No gap found - data already complete' };
    }

    // Step 4: Display boundaries and get confirmation
    const confirmed = confirmBackfill(boundaries, clusterName);

    if (!confirmed) {
      backfillLogger.logInfo(`[${clusterName}] User cancelled backfill operation`);
      return { status: 'cancelled', message: 'Backfill cancelled by user' };
    }

    // Step 5: Perform backfill
    backfillLogger.logInfo(`[${new Date().toISOString()}] [${clusterName}] Starting backfill...`);
    const result = await performBackfill(client, clusterName, boundaries.startEpoch, boundaries.endEpoch);

    backfillLogger.logInfo(`[${new Date().toISOString()}] [${clusterName}] Backfill complete!`);
    return result;

  } catch (err) {
    backfillLogger.logError('[runBackfill] [ERROR]', err);
    return { status: 'error', error: err.message };
  }
}

/**
 * Validate CLI arguments
 * @param {object} args - CLI arguments from yargs
 * @returns {object} - Validation result with parsed values
 */
function validateArgs(args) {
  try {
    // Validate cluster selection (prod XOR staging)
    if (!args.prod && !args.staging) {
      return { valid: false, error: 'Must specify either --prod or --staging' };
    }
    if (args.prod && args.staging) {
      return { valid: false, error: 'Cannot specify both --prod and --staging' };
    }

    const cluster = args.prod ? 'ES' : 'STAGING';
    const clusterName = args.prod ? 'PRODUCTION' : 'STAGING';

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
    return {
      valid: true,
      cluster,
      clusterName,
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
    const lastDocBefore = await getMostRecentDoc(
      client,
      imperialIndex,
      {
        size: 1,
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
 * @returns {boolean} - True if user confirms, false otherwise
 */
function confirmBackfill(boundaries, clusterName) {
  console.log('\n========================================');
  console.log(`Gap found in ${clusterName} cluster:`);
  console.log('========================================');
  console.log(`Last document before gap: ${boundaries.startFormatted}`);
  console.log(`First document after gap: ${boundaries.endFormatted}`);
  console.log(`Gap duration: ${boundaries.durationHours} hours (${boundaries.durationDays} days)`);
  console.log('========================================\n');

  const answer = readlineSync.question('Proceed with backfill? (y/n): ');

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
    // Initialize components (following main.js pattern)
    const awApi = new AmbientWeatherApi({
      apiKey: process.env.AMBIENT_WEATHER_API_KEY,
      applicationKey: process.env.AMBIENT_WEATHER_APPLICATION_KEY
    });

    const fetcher = new FetchRawData(awApi, fs);
    const imperialToJsonlConverter = new ConvertImperialToJsonl(fs);
    const imperialToMetricJsonlConverter = new ConvertImperialToMetric(fs);
    const indexer = new IndexData(client);

    // Step 1: Fetch data from Ambient Weather API
    backfillLogger.logInfo(`[${clusterName}] Fetching data from Ambient Weather API...`);
    // Note: API counts backwards in time, so use endEpoch as the 'from' parameter
    const fetchResult = await fetcher.getDataForDateRanges(false, endEpoch);

    if (fetchResult === 'too early') {
      backfillLogger.logWarning(`[${clusterName}] API returned "too early" - less than 5 minutes since last fetch`);
      return { status: 'skipped', message: 'Too early to fetch data (less than 5 minutes since last fetch)' };
    }

    const { dataFetchForDates, dataFileNames } = fetchResult;
    backfillLogger.logInfo(`[${clusterName}] Fetched ${dataFetchForDates.length} data batches`);

    // Step 2: Convert to JSONL
    backfillLogger.logInfo(`[${clusterName}] Converting to JSONL...`);
    const imperialJSONLFileNames = imperialToJsonlConverter.convertRawImperialDataToJsonl();
    backfillLogger.logInfo(`[${clusterName}] Converted ${imperialJSONLFileNames.length} imperial files to JSONL`);

    // Step 3: Convert to metric
    backfillLogger.logInfo(`[${clusterName}] Converting to metric...`);
    const metricJSONLFileNames = imperialToMetricJsonlConverter.convertImperialDataToMetricJsonl();
    backfillLogger.logInfo(`[${clusterName}] Converted ${metricJSONLFileNames.length} metric files to JSONL`);

    // Step 4: Initialize indexer
    backfillLogger.logInfo(`[${clusterName}] Initializing indexer...`);
    const initResult = await indexer.initialize();
    if (initResult.outcome !== 'success') {
      backfillLogger.logError(`[${clusterName}] Indexer initialization failed:`, initResult);
      return { status: 'error', error: 'Indexer initialization failed' };
    }

    // Step 5: Index imperial data
    backfillLogger.logInfo(`[${clusterName}] Indexing imperial data...`);
    const imperialPayload = prepareDataForBulkIndexing(dataFileNames, 'imperial', backfillLogger);
    const imperialResult = await indexer.bulkIndexDocuments(imperialPayload, 'imperial');
    backfillLogger.logInfo(`[${clusterName}] Imperial indexing complete. Total docs: ${imperialResult.indexCounts.count}`);

    // Step 6: Index metric data
    backfillLogger.logInfo(`[${clusterName}] Indexing metric data...`);
    const metricPayload = prepareDataForBulkIndexing(dataFileNames, 'metric', backfillLogger);
    const metricResult = await indexer.bulkIndexDocuments(metricPayload, 'metric');
    backfillLogger.logInfo(`[${clusterName}] Metric indexing complete. Total docs: ${metricResult.indexCounts.count}`);

    return {
      status: 'success',
      cluster: clusterName,
      dataFetched: dataFetchForDates.length,
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

module.exports = { runBackfill };
