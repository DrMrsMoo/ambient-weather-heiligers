const IndexData = require('../src/dataIndexers');
const Logger = require('../src/logger');
const { createEsClient } = require('../src/dataIndexers/esClient');

const verifyLogger = new Logger('[verify-indexing]');

/**
 * Verification script to check indexing status across clusters
 * Usage: source .env && node scripts/verify-indexing.js
 */
async function verifyIndexing() {
  try {
    verifyLogger.logInfo('=== ELASTICSEARCH INDEXING VERIFICATION ===');
    verifyLogger.logInfo(`Timestamp: ${new Date().toISOString()}\n`);

    // Create clients for both clusters
    const prodClient = createEsClient('ES');
    const stagingClient = createEsClient('STAGING');

    // Create indexers
    const prodIndexer = new IndexData(prodClient);
    const stagingIndexer = new IndexData(stagingClient);

    // Verify Production Cluster
    verifyLogger.logInfo('--- PRODUCTION CLUSTER ---');
    await verifyCluster(prodIndexer, 'PRODUCTION');

    verifyLogger.logInfo('\n--- STAGING CLUSTER ---');
    await verifyCluster(stagingIndexer, 'STAGING');

    verifyLogger.logInfo('\n=== VERIFICATION COMPLETE ===');
  } catch (err) {
    verifyLogger.logError('Verification failed:', err);
    process.exit(1);
  }
}

async function verifyCluster(indexer, clusterName) {
  try {
    // Initialize connection
    const initResult = await indexer.initialize();

    if (!initResult || initResult.outcome !== 'success') {
      verifyLogger.logError(`[${clusterName}] Failed to connect: ${initResult?.outcome || 'unknown'}`);
      return;
    }

    verifyLogger.logInfo(`[${clusterName}] Connection: ✓ Connected`);

    // Get latest documents
    const latestDocs = initResult;

    if (latestDocs.latestImperialDoc && latestDocs.latestImperialDoc.length > 0) {
      const imperialDoc = latestDocs.latestImperialDoc[0];
      const imperialDate = new Date(imperialDoc._source.dateutc);
      verifyLogger.logInfo(`[${clusterName}] Latest Imperial Document:`);
      verifyLogger.logInfo(`  - Index: ${imperialDoc._index}`);
      verifyLogger.logInfo(`  - Timestamp: ${imperialDoc._source.dateutc} (${imperialDate.toISOString()})`);
      verifyLogger.logInfo(`  - Date field: ${imperialDoc._source.date}`);
    } else {
      verifyLogger.logWarning(`[${clusterName}] No imperial documents found`);
    }

    if (latestDocs.latestMetricDoc && latestDocs.latestMetricDoc.length > 0) {
      const metricDoc = latestDocs.latestMetricDoc[0];
      const metricDate = new Date(metricDoc._source.dateutc);
      verifyLogger.logInfo(`[${clusterName}] Latest Metric Document:`);
      verifyLogger.logInfo(`  - Index: ${metricDoc._index}`);
      verifyLogger.logInfo(`  - Timestamp: ${metricDoc._source.dateutc} (${metricDate.toISOString()})`);
      verifyLogger.logInfo(`  - Date field: ${metricDoc._source.date}`);
    } else {
      verifyLogger.logWarning(`[${clusterName}] No metric documents found`);
    }

    // Get document counts (requires esClientMethods)
    const esClient = indexer.esClient;
    const imperialIndices = 'ambient_weather_heiligers_imperial_*';
    const metricIndices = 'ambient_weather_heiligers_metric_*';

    const { body: imperialCount } = await esClient.count({ index: imperialIndices });
    const { body: metricCount } = await esClient.count({ index: metricIndices });

    verifyLogger.logInfo(`[${clusterName}] Total Document Counts:`);
    verifyLogger.logInfo(`  - Imperial: ${imperialCount.count} documents`);
    verifyLogger.logInfo(`  - Metric: ${metricCount.count} documents`);

  } catch (err) {
    verifyLogger.logError(`[${clusterName}] Verification error:`, err);
  }
}

// Run the verification
verifyIndexing();

module.exports = verifyIndexing;
