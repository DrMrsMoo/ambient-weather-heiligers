const AmbientWeatherApi = require('ambient-weather-api');
const fs = require('file-system');
const FetchRawData = require('./src/dataFetchers');
const { ConvertImperialToJsonl, ConvertImperialToMetric } = require('./src/converters');
const IndexData = require('./src/dataIndexers');
const Logger = require('./src/logger');
const { prepareDataForBulkIndexing, updateProgressState } = require('./main_utils');
const { createEsClient } = require('./src/dataIndexers/esClient');

// initialize the classes;
const awApi = new AmbientWeatherApi({
  apiKey: process.env.AMBIENT_WEATHER_API_KEY,
  applicationKey: process.env.AMBIENT_WEATHER_APPLICATION_KEY
});
const mainLogger = new Logger('[main]');
const fetchRawDataTester = new FetchRawData(awApi, fs);
const imperialToJsonlConverter = new ConvertImperialToJsonl(fs);
const imperialToMetricJsonlConverter = new ConvertImperialToMetric(fs);

// Create ES clients for both production and staging
const prodClient = createEsClient('ES');
const stagingClient = createEsClient('STAGING');

// Create indexers for both clusters
const prodIndexer = new IndexData(prodClient);
const stagingIndexer = new IndexData(stagingClient);

/**
 * @param {class} logger : mainLogger instance
 * @param {*} stage : stage to advance the step
 * @param {*} stepsStates : current state within progress flow
 * @returns {void}: logs to console
 */
const logProgress = (logger = mainLogger, stage, stepsStates) => {
  logger.logInfo('[STAGE]:', stage + `\n`);
  logger.logInfo('[STEPS STATE]:', stepsStates);
}

const step = {
  0: 'error',
  1: 'fetchData',
  2: 'convertToJsonl',
  3: 'getRecentIndexedDocs',
  4: 'checkNewDataAgainstLastIndexedDoc',
  5: 'getExistingDataFromFile'
}

const states = {
  fatalError: false,
  clusterError: false,
  fetchNewData: false,
  newDataFetched: false,
  newDataSkipped: false,
  clusterReady: false,
  dataConvertedToJsonl: false,
  backfillDataFromFile: false,
}

const convertDataToJsonl = () => {
  imperial = imperialToJsonlConverter.convertRawImperialDataToJsonl();
  metric = imperialToMetricJsonlConverter.convertImperialDataToMetricJsonl();
  return {
    imperialJSONLFileNames: imperial,
    metricJSONLFileNames: metric,
  }
}

async function main() {
  let imperialJSONLFileNames;
  let metricJSONLFileNames;

  // logging stuff
  let stage;
  let stepsStates = { ...states };

  stage = step[1];
  stepsStates = updateProgressState({ fetchNewData: true }, { info: 'starting main function', includeTimestamp: true }, mainLogger)
  logProgress(mainLogger, stage, stepsStates);

  // STEP 0: Query both clusters FIRST to get their latest indexed dates
  // This prevents duplicate data when multiple machines (Pi, Mac) run the cron job
  mainLogger.logInfo(`[${new Date().toISOString()}] Querying clusters for latest indexed dates...`);

  let prodLatestDate = null;
  let stagingLatestDate = null;

  try {
    // Initialize both clusters to get their latest dates
    const [prodInitResult, stagingInitResult] = await Promise.allSettled([
      prodIndexer.initialize(),
      stagingIndexer.initialize()
    ]);

    if (prodInitResult.status === 'fulfilled' && prodInitResult.value.outcome === 'success') {
      const latestDocs = prodInitResult.value.latestImperialDoc;
      if (Array.isArray(latestDocs) && latestDocs.length > 0 && latestDocs[0]?._source?.dateutc) {
        prodLatestDate = latestDocs[0]._source.dateutc;
        mainLogger.logInfo(`[PRODUCTION] Latest indexed date: ${new Date(prodLatestDate).toISOString()}`);
      } else {
        mainLogger.logWarning(`[PRODUCTION] No documents found in cluster, will use local files as fallback`);
      }
    } else {
      mainLogger.logWarning(`[PRODUCTION] Could not get latest date, will use local files as fallback`);
    }

    if (stagingInitResult.status === 'fulfilled' && stagingInitResult.value.outcome === 'success') {
      const latestDocs = stagingInitResult.value.latestImperialDoc;
      if (Array.isArray(latestDocs) && latestDocs.length > 0 && latestDocs[0]?._source?.dateutc) {
        stagingLatestDate = latestDocs[0]._source.dateutc;
        mainLogger.logInfo(`[STAGING] Latest indexed date: ${new Date(stagingLatestDate).toISOString()}`);
      } else {
        mainLogger.logWarning(`[STAGING] No documents found in cluster, will use local files as fallback`);
      }
    } else {
      mainLogger.logWarning(`[STAGING] Could not get latest date, will use local files as fallback`);
    }
  } catch (err) {
    mainLogger.logWarning(`[CLUSTER QUERY] Error querying clusters for latest dates:`, err.message);
  }

  // Determine the fetch start date - use the OLDER of the two cluster dates
  // This ensures we fetch all data that either cluster might need
  let fetchFromDate = null;
  // Use != null to handle both null and undefined while still allowing epoch 0
  if (prodLatestDate != null && stagingLatestDate != null) {
    fetchFromDate = Math.min(prodLatestDate, stagingLatestDate);
    mainLogger.logInfo(`[FETCH] Will fetch data newer than: ${new Date(fetchFromDate).toISOString()} (older of both clusters)`);
  } else if (prodLatestDate != null) {
    fetchFromDate = prodLatestDate;
    mainLogger.logInfo(`[FETCH] Will fetch data newer than: ${new Date(fetchFromDate).toISOString()} (production only)`);
  } else if (stagingLatestDate != null) {
    fetchFromDate = stagingLatestDate;
    mainLogger.logInfo(`[FETCH] Will fetch data newer than: ${new Date(fetchFromDate).toISOString()} (staging only)`);
  } else {
    mainLogger.logInfo(`[FETCH] No cluster dates available, will use local files to determine fetch range`);
  }

  // step 1: fetch new data & convert it to JSONl
  try {
    // Pass the cluster-based date to FetchRawData if available
    // 4th param (fetchFromDate): cluster-based reference date to prevent duplicates
    // when multiple machines run cron jobs. Falls back to local files if null.
    const getNewDataPromiseResult = await fetchRawDataTester.getDataForDateRanges(false, undefined, false, fetchFromDate);
    // Check if result is the "too early" string
    if (getNewDataPromiseResult === 'too early') {
      // advance steps and log
      stepsStates = updateProgressState({ newDataSkipped: true }, { warn: 'too early' }, mainLogger, { ...stepsStates })
      // When too early, set filenames to empty arrays
      imperialJSONLFileNames = [];
      metricJSONLFileNames = [];
    } else if (Object.keys(getNewDataPromiseResult).includes('dataFetchForDates') && Object.keys(getNewDataPromiseResult).includes('dataFileNames')) {
      // Use the fetched filenames for indexing (whether newly converted or not)
      const fetchedFileNames = getNewDataPromiseResult.dataFileNames;
      stepsStates = updateProgressState({ newDataFetched: true }, { info: 'converting data to metric and JSONL', includeTimestamp: true }, mainLogger, { ...stepsStates })
      // Convert the data (will skip if already converted)
      convertDataToJsonl();
      // Use the fetched filenames for indexing, not converter results
      imperialJSONLFileNames = fetchedFileNames;
      metricJSONLFileNames = fetchedFileNames;
    } else {
      // No data fetched
      imperialJSONLFileNames = [];
      metricJSONLFileNames = [];
    }

    stepsStates = updateProgressState({ dataConvertedToJsonl: true }, { info: `imperialJSONLFileNames ${imperialJSONLFileNames}\n metricJSONLFileNames ${metricJSONLFileNames}`, includeTimestamp: true }, mainLogger, { ...stepsStates })
    logProgress(mainLogger, stage, stepsStates)
  } catch (err) {
    stage = step[0];
    stepsStates = updateProgressState({ fatalError: true }, { error: `error in step ${step[1]} or ${step[2]}`, errorInfo: err }, mainLogger, { ...stepsStates })
    logProgress(mainLogger, stage, stepsStates)
    throw err;
  }

  // Helper function to index data to a specific cluster
  // Each cluster filters to only include records newer than its own latest date
  async function indexToCluster(indexer, clusterName, clusterLatestDate) {
    try {
      mainLogger.logInfo(`[${clusterName}] Preparing to index (filtering records newer than ${clusterLatestDate ? new Date(clusterLatestDate).toISOString() : 'none'})...`);

      // Index imperial data if available
      if (imperialJSONLFileNames.length > 0) {
        const imperialData = prepareDataForBulkIndexing({
            fileNamesArray: imperialJSONLFileNames,
            dataType: 'imperial',
            logger: mainLogger,
            filterAfterDate: clusterLatestDate
          });
        if (imperialData.length > 0) {
          mainLogger.logInfo(`[${clusterName}] Indexing ${imperialData.length / 2} imperial documents...`);
          await indexer.bulkIndexDocuments(imperialData, 'imperial');
          mainLogger.logInfo(`[${clusterName}] Imperial data indexed successfully`);
        } else {
          mainLogger.logInfo(`[${clusterName}] No new imperial data to index (all records already indexed)`);
        }
      }

      // Index metric data if available
      if (metricJSONLFileNames.length > 0) {
        const metricData = prepareDataForBulkIndexing({
            fileNamesArray: metricJSONLFileNames,
            dataType: 'metric',
            logger: mainLogger,
            filterAfterDate: clusterLatestDate
          });
        if (metricData.length > 0) {
          mainLogger.logInfo(`[${clusterName}] Indexing ${metricData.length / 2} metric documents...`);
          await indexer.bulkIndexDocuments(metricData, 'metric');
          mainLogger.logInfo(`[${clusterName}] Metric data indexed successfully`);
        } else {
          mainLogger.logInfo(`[${clusterName}] No new metric data to index (all records already indexed)`);
        }
      }

      mainLogger.logInfo(`[${new Date().toISOString()}] [${clusterName}] Indexing complete`);
      return { cluster: clusterName, status: 'success' };
    } catch (err) {
      mainLogger.logError(`[${clusterName}] Indexing failed:`, err);
      return { cluster: clusterName, status: 'error', error: err.message };
    }
  }

  // Index to both clusters independently - each with its own filter date
  // This prevents duplicates: each cluster only gets records it doesn't already have
  mainLogger.logInfo(`[${new Date().toISOString()}] Starting dual-cluster indexing...`);
  const results = await Promise.allSettled([
    indexToCluster(prodIndexer, 'PRODUCTION', prodLatestDate),
    indexToCluster(stagingIndexer, 'STAGING', stagingLatestDate)
  ]);

  // Log final results
  mainLogger.logInfo(`[${new Date().toISOString()}] === FINAL RESULTS ===`);
  results.forEach((result, idx) => {
    const clusterName = idx === 0 ? 'PRODUCTION' : 'STAGING';
    if (result.status === 'fulfilled') {
      mainLogger.logInfo(`[${clusterName}] Result:`, result.value);
    } else {
      mainLogger.logError(`[${clusterName}] Failed:`, result.reason);
    }
  });

  return 'Done';
};

module.exports = main;
