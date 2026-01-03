const AmbientWeatherApi = require('ambient-weather-api');
const fs = require('file-system');
const FetchRawData = require('./src/dataFetchers');
const { ConvertImperialToJsonl, ConvertImperialToMetric } = require('./src/converters');
const IndexData = require('./src/dataIndexers');
const Logger = require('./src/logger');
const { minDateFromDateObjects } = require('./src/utils');
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

const toEarlyForNewData = (promiseResult) => {
  const promiseResultType = typeof promiseResult;
  const promiseResultKeysLength = Object.keys(promiseResult).length;
  const promiseResultContentsExpected = "too early";
  console.log(`promiseResultType:${promiseResultType}`);
  console.log(`promiseResultKeysLength:${promiseResultKeysLength}`);
  console.log(`promiseResultContentsExpected:${promiseResultContentsExpected}`);
  if (promiseResultKeysLength == 0 && promiseResultType == String && promiseResult == promiseResultContentsExpected) {
    return true;
  }
  return false;
}


const convertDataToJsonl = () => {
  imperial = imperialToJsonlConverter.convertRawImperialDataToJsonl();
  metric = imperialToMetricJsonlConverter.convertImperialDataToMetricJsonl();
  return {
    imperialJSONLFileNames: imperial,
    metricJSONLFileNames: metric,
  }
}

/**
 *
 * @param {string} dataType: imperial | metric
 * @param {string[]} dataFileNames: file names of the files containing new data that has to be indexed
 * @param {Object} stepsStates: state of progress through algorithm
 * @param {string} stage: current algorithm stage
 * @param {Logger} mainLogger
 * @param {boolean} indexDocsNeeded: does data need to be indexed
 */
async function prepAndBulkIndexNewData(dataType, dataFileNames, stepsStates, lastIndexedDataDate, indexDocsNeeded) {
  const datesFromFileNames = [...dataFileNames.map(name => name.split('_'))];
  const maxDateOnFile = Math.max(...datesFromFileNames.map((entry => entry * 1))); // will return NaN for non-integer entries

  if ((maxDateOnFile - lastIndexedDataDate) > 0) indexDocsNeeded = true // flip the switch in case we didn't get new data
  const dataReadyForBulkCall = prepareDataForBulkIndexing(dataFileNames, dataType);
  if (!stepsStates.clusterError) {
    await dataIndexer.bulkIndexDocuments(dataReadyForBulkCall, dataType)
  }
}

async function main() {
  let datesForNewData;

  let imperialJSONLFileNames;
  let metricJSONLFileNames;
  let indexImperialDocsNeeded = false;
  let indexMetricDocsNeeded = false;
  let lastIndexedImperialDataDate;
  let lastIndexedMetricDataDate;

  // logging stuff
  let stage;
  let stepsStates = { ...states };

  stage = step[1];
  stepsStates = updateProgressState({ fetchNewData: true }, { info: `starting main function at ${new Date()}` }, mainLogger)
  logProgress(mainLogger, stage, stepsStates);

  // step 1: fetch new data & convert it to JSONl
  try {
    const getNewDataPromiseResult = await fetchRawDataTester.getDataForDateRanges(false);
    console.log('getNewDataPromiseResult', getNewDataPromiseResult)
    if (toEarlyForNewData(getNewDataPromiseResult)) {
      // advance steps and log
      stepsStates = updateProgressState({ newDataSkipped: true }, { warn: 'too early' }, mainLogger, { ...stepsStates })
      // When too early, set filenames to empty arrays
      imperialJSONLFileNames = [];
      metricJSONLFileNames = [];
    } else if (Object.keys(getNewDataPromiseResult).includes('dataFetchForDates') && Object.keys(getNewDataPromiseResult).includes('dataFileNames')) {
      datesForNewData = getNewDataPromiseResult.dataFetchForDates;
      // Use the fetched filenames for indexing (whether newly converted or not)
      const fetchedFileNames = getNewDataPromiseResult.dataFileNames;
      stepsStates = updateProgressState({ newDataFetched: true }, { info: `converting data to metric and JSONL` }, mainLogger, { ...stepsStates })
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

    stepsStates = updateProgressState({ dataConvertedToJsonl: true }, { info: `imperialJSONLFileNames ${imperialJSONLFileNames}\n metricJSONLFileNames ${metricJSONLFileNames}` }, mainLogger, { ...stepsStates })
    logProgress(mainLogger, stage, stepsStates)
  } catch (err) {
    stage = step[0];
    stepsStates = updateProgressState({ fatalError: true }, { error: `error in step ${step[1]} or ${step[2]}`, errorInfo: err }, mainLogger, { ...stepsStates })
    logProgress(mainLogger, stage, stepsStates)
    throw err;
  }

  // Helper function to index data to a specific cluster
  async function indexToCluster(indexer, clusterName) {
    try {
      mainLogger.logInfo(`[${clusterName}] Initializing cluster connection...`);
      const initResult = await indexer.initialize();

      if (!!initResult === true && initResult.outcome === 'success') {
        mainLogger.logInfo(`[${clusterName}] Cluster ready! Latest imperial: ${initResult.latestImperialDoc[0]._source.dateutc}, Latest metric: ${initResult.latestMetricDoc[0]._source.dateutc}`);

        // Debug: Check what we have
        mainLogger.logInfo(`[${clusterName}] DEBUG: imperialJSONLFileNames =`, imperialJSONLFileNames);
        mainLogger.logInfo(`[${clusterName}] DEBUG: metricJSONLFileNames =`, metricJSONLFileNames);

        // Index imperial data if available
        if (imperialJSONLFileNames.length > 0) {
          const imperialData = prepareDataForBulkIndexing(imperialJSONLFileNames, 'imperial');
          mainLogger.logInfo(`[${clusterName}] Indexing imperial data...`);
          await indexer.bulkIndexDocuments(imperialData, 'imperial');
          mainLogger.logInfo(`[${clusterName}] Imperial data indexed successfully`);
        }

        // Index metric data if available
        if (metricJSONLFileNames.length > 0) {
          const metricData = prepareDataForBulkIndexing(metricJSONLFileNames, 'metric');
          mainLogger.logInfo(`[${clusterName}] Indexing metric data...`);
          await indexer.bulkIndexDocuments(metricData, 'metric');
          mainLogger.logInfo(`[${clusterName}] Metric data indexed successfully`);
        }

        return { cluster: clusterName, status: 'success' };
      } else {
        mainLogger.logError(`[${clusterName}] Cluster not ready: ${initResult.outcome}`);
        return { cluster: clusterName, status: 'failed', reason: initResult.outcome };
      }
    } catch (err) {
      mainLogger.logError(`[${clusterName}] Indexing failed:`, err);
      return { cluster: clusterName, status: 'error', error: err.message };
    }
  }

  // Index to both clusters independently - failures in one don't affect the other
  mainLogger.logInfo('Starting dual-cluster indexing...');
  const results = await Promise.allSettled([
    indexToCluster(prodIndexer, 'PRODUCTION'),
    indexToCluster(stagingIndexer, 'STAGING')
  ]);

  // Log final results
  mainLogger.logInfo('=== FINAL RESULTS ===');
  results.forEach((result, idx) => {
    const clusterName = idx === 0 ? 'PRODUCTION' : 'STAGING';
    if (result.status === 'fulfilled') {
      mainLogger.logInfo(`[${clusterName}] Result:`, result.value);
    } else {
      mainLogger.logError(`[${clusterName}] Failed:`, result.reason);
    }
  });

  return 'STOP NOW - Legacy code below';
  if (!stepsStates.fatalError === true) {
    mainLogger.logInfo('DONE', stepsStates)
    return 'DONE'
  } else {
    mainLogger.logError('[ERROR] [STEPSSTATE]:', stepsStates)
    console.log()
    mainLogger.logError('[ERROR] [STAGE]:', stage)
    console.log()
  }
};

module.exports = main;
