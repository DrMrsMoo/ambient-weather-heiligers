const IndexData = require('../src/dataIndexers');
const Logger = require('../src/logger');
const { createEsClient } = require('../src/dataIndexers/esClient');
const { prepareDataForBulkIndexing } = require('../main_utils');
const fs = require('fs');
const path = require('path');

const manualLogger = new Logger('[manual-index]');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Manual Index

Usage:
  npm run manual-index
  npm run manual-index -- [number_of_files]

Description:
  Manually indexes weather data from local JSONL files to both production
  and staging Elasticsearch clusters. This is useful for backfilling data
  or reindexing specific files.

  The script will:
  - Scan the data/ambient-weather-heiligers-imperial-jsonl directory
  - Find all .jsonl files (or the N most recent if specified)
  - Prepare both imperial and metric data for indexing
  - Index data to production cluster
  - Index data to staging cluster
  - Report indexing results and error counts

  Data is read from:
  - data/ambient-weather-heiligers-imperial-jsonl/*.jsonl
  - data/ambient-weather-heiligers-metric-jsonl/*.jsonl

Arguments:
  [number_of_files]    Optional. Number of most recent files to index.
                       If omitted, all files are indexed.
                       Files are sorted by filename (timestamp-based).

Output:
  For each cluster (Production and Staging):
  - Connection status
  - Current latest imperial and metric timestamps
  - Imperial data preparation status
  - Imperial indexing results (total docs, errors)
  - Metric data preparation status
  - Metric indexing results (total docs, errors)
  - Completion status

Options:
  -h, --help     Show this help menu

Examples:
  npm run manual-index              # Index all JSONL files
  npm run manual-index -- 5         # Index 5 most recent files
  npm run manual-index -- 1         # Index only the most recent file

Related Commands:
  npm run verify-indexing              Verify indexing status
  npm run copy-prod-to-staging         Copy production data to staging
  npm run check-staging-gaps           Check staging cluster gaps
  npm run check-prod-gaps              Check production cluster gaps
`);
  process.exit(0);
}

/**
 * Get all JSONL files from the data directory
 * @param {number} limit - Number of most recent files to return (0 = all files)
 * @returns {string[]} Array of filenames without .jsonl extension
 */
function getLatestDataFiles(limit = 0) {
  const dataDir = path.join(__dirname, '../data/ambient-weather-heiligers-imperial-jsonl');

  if (!fs.existsSync(dataDir)) {
    manualLogger.logWarning(`Data directory not found: ${dataDir}`);
    return [];
  }

  // Read all .jsonl files
  const files = fs.readdirSync(dataDir)
    .filter(file => file.endsWith('.jsonl'))
    .map(file => file.replace('.jsonl', ''))
    .sort(); // Sort by filename (timestamps are sortable)

  if (limit > 0 && files.length > limit) {
    // Return the most recent files (last N in sorted order)
    return files.slice(-limit);
  }

  return files;
}

/**
 * Manual indexing script - indexes data files to clusters
 * Usage:
 *   source .env && node scripts/manual-index.js [number_of_recent_files]
 *
 * Examples:
 *   node scripts/manual-index.js       # Index all files
 *   node scripts/manual-index.js 5     # Index 5 most recent files
 */
async function manualIndex() {
  try {
    // Get number of files to index from command line (default: all files)
    const limitArg = process.argv[2];
    const limit = limitArg ? parseInt(limitArg, 10) : 0;

    // Get files to index from data directory
    const filesToIndex = getLatestDataFiles(limit);

    if (filesToIndex.length === 0) {
      manualLogger.logWarning('No JSONL files found to index!');
      return;
    }

    manualLogger.logInfo('=== MANUAL INDEXING SCRIPT ===');
    manualLogger.logInfo(`Found ${filesToIndex.length} file(s) to index`);
    if (limit > 0) {
      manualLogger.logInfo(`(Limited to ${limit} most recent files)`);
    }
    manualLogger.logInfo(`Files: ${filesToIndex.join(', ')}\n`);

    // Create clients
    const prodClient = createEsClient('ES');
    const stagingClient = createEsClient('STAGING');

    // Create indexers
    const prodIndexer = new IndexData(prodClient);
    const stagingIndexer = new IndexData(stagingClient);

    // Index to both clusters
    await indexToCluster(prodIndexer, 'PRODUCTION', filesToIndex);
    await indexToCluster(stagingIndexer, 'STAGING', filesToIndex);

    manualLogger.logInfo('\n=== MANUAL INDEXING COMPLETE ===');
  } catch (err) {
    manualLogger.logError('Manual indexing failed:', err);
    process.exit(1);
  }
}

async function indexToCluster(indexer, clusterName, fileNames) {
  try {
    manualLogger.logInfo(`\n--- ${clusterName} CLUSTER ---`);

    // Initialize
    const initResult = await indexer.initialize();
    if (!initResult || initResult.outcome !== 'success') {
      manualLogger.logError(`[${clusterName}] Failed to initialize`);
      return;
    }

    manualLogger.logInfo(`[${clusterName}] Connected`);
    manualLogger.logInfo(`[${clusterName}] Current latest imperial: ${new Date(initResult.latestImperialDoc[0]._source.dateutc).toISOString()}`);
    manualLogger.logInfo(`[${clusterName}] Current latest metric: ${new Date(initResult.latestMetricDoc[0]._source.dateutc).toISOString()}`);

    // Index imperial data
    manualLogger.logInfo(`[${clusterName}] Preparing imperial data...`);
    const imperialData = prepareDataForBulkIndexing({ fileNamesArray: fileNames, dataType: 'imperial' });
    manualLogger.logInfo(`[${clusterName}] Imperial payload size: ${imperialData.length} items`);

    if (imperialData.length > 0) {
      manualLogger.logInfo(`[${clusterName}] Indexing imperial data...`);
      const imperialResult = await indexer.bulkIndexDocuments(imperialData, 'imperial');
      manualLogger.logInfo(`[${clusterName}] Imperial indexed! Total docs in index: ${imperialResult.indexCounts.count}`);
      if (imperialResult.erroredDocuments.length > 0) {
        manualLogger.logWarning(`[${clusterName}] Imperial errors: ${imperialResult.erroredDocuments.length}`);
      }
    }

    // Index metric data
    manualLogger.logInfo(`[${clusterName}] Preparing metric data...`);
    const metricData = prepareDataForBulkIndexing({ fileNamesArray: fileNames, dataType: 'metric' });
    manualLogger.logInfo(`[${clusterName}] Metric payload size: ${metricData.length} items`);

    if (metricData.length > 0) {
      manualLogger.logInfo(`[${clusterName}] Indexing metric data...`);
      const metricResult = await indexer.bulkIndexDocuments(metricData, 'metric');
      manualLogger.logInfo(`[${clusterName}] Metric indexed! Total docs in index: ${metricResult.indexCounts.count}`);
      if (metricResult.erroredDocuments.length > 0) {
        manualLogger.logWarning(`[${clusterName}] Metric errors: ${metricResult.erroredDocuments.length}`);
      }
    }

    manualLogger.logInfo(`[${clusterName}] ✓ Complete`);
  } catch (err) {
    manualLogger.logError(`[${clusterName}] Error:`, err);
  }
}

// Run the manual indexing
manualIndex();

module.exports = manualIndex;
