// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Copy Production to Staging

Usage:
  npm run copy-prod-to-staging

Description:
  Copies data from the production Elasticsearch cluster to the staging cluster
  for a specific time period. This is useful for filling gaps in staging with
  verified production data.

  The script will:
  - Export data from production cluster for a specified date range
  - Save the data to local JSON and JSONL files
  - Convert imperial data to metric format
  - Initialize the staging cluster indexer
  - Index both imperial and metric data to staging
  - Verify that the gap has been filled

  Data is saved to the following locations:
  - data/ambient-weather-heiligers-imperial/{fromEpoch}_{toEpoch}.json
  - data/ambient-weather-heiligers-imperial-jsonl/{fromEpoch}_{toEpoch}.jsonl
  - data/ambient-weather-heiligers-metric-jsonl/{fromEpoch}_{toEpoch}.jsonl

Output:
  - Export status and document count from production
  - Local file save confirmation
  - Staging indexer initialization status
  - Imperial indexing results (document count, errors)
  - Metric indexing results (document count, errors)
  - Verification status showing gap is filled
  - Summary of the entire operation

Options:
  -h, --help     Show this help menu

Examples:
  npm run copy-prod-to-staging

Related Commands:
  npm run compare-clusters             Compare production vs staging
  npm run verify-backfill              Verify backfilled data
  npm run check-staging-gaps           Check staging cluster gaps
  npm run manual-index -- [files]      Manually index specific files
`);
  process.exit(0);
}

const { Client } = require('@elastic/elasticsearch');
const fs = require('file-system');
const { convertToMetric } = require('./src/utils');
const IndexData = require('./src/dataIndexers');
const { prepareDataForBulkIndexing } = require('./main_utils');
const Logger = require('./src/logger');

const logger = new Logger('[copy-prod-to-staging]');

async function copyProductionToStaging() {
  logger.logInfo('=== COPYING PRODUCTION DATA TO STAGING ===\n');

  // Create clients
  const prodClient = new Client({
    cloud: { id: process.env.ES_CLOUD_ID },
    auth: {
      username: process.env.ES_USERNAME,
      password: process.env.ES_PASSWORD
    }
  });

  const stagingClient = new Client({
    cloud: { id: process.env.STAGING_CLOUD_ID },
    auth: {
      username: process.env.STAGING_ES_USERNAME,
      password: process.env.STAGING_ES_PASSWORD
    }
  });

  try {
    // Step 1: Export data from production
    const gapStart = new Date('2026-01-01T00:00:00.000Z').getTime();
    const gapEnd = new Date('2026-01-02T01:30:00.000Z').getTime();

    logger.logInfo('Step 1: Exporting data from PRODUCTION cluster...');
    logger.logInfo(`  Date range: ${new Date(gapStart).toISOString()} to ${new Date(gapEnd).toISOString()}`);

    const result = await prodClient.search({
      index: 'ambient_weather_heiligers_imperial_*',
      body: {
        query: {
          range: {
            dateutc: {
              gt: gapStart,
              lt: gapEnd
            }
          }
        },
        sort: [{ dateutc: 'asc' }],
        size: 1000, // Should be enough for 305 records
        _source: { excludes: ['_id'] } // Exclude internal ES fields
      }
    });

    const documents = result.body.hits.hits.map(hit => hit._source);
    logger.logInfo(`  ✓ Exported ${documents.length} documents from production`);

    if (documents.length === 0) {
      logger.logWarning('No documents found in production for this period');
      await prodClient.close();
      await stagingClient.close();
      return;
    }

    // Step 2: Save to local file
    const filename = `${gapStart}_${gapEnd}`;
    const imperialPath = `./data/ambient-weather-heiligers-imperial/${filename}.json`;
    const imperialJsonlPath = `./data/ambient-weather-heiligers-imperial-jsonl/${filename}.jsonl`;
    const metricJsonlPath = `./data/ambient-weather-heiligers-metric-jsonl/${filename}.jsonl`;

    logger.logInfo('\nStep 2: Saving to local files...');

    // Save imperial JSON
    fs.writeFileSync(imperialPath, JSON.stringify(documents, null, 2));
    logger.logInfo(`  ✓ Saved imperial JSON: ${imperialPath}`);

    // Convert and save imperial JSONL
    const imperialJsonlContent = documents.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(imperialJsonlPath, imperialJsonlContent);
    logger.logInfo(`  ✓ Saved imperial JSONL: ${imperialJsonlPath}`);

    // Convert to metric and save JSONL
    const metricDocuments = documents.map(doc => convertToMetric(doc));
    const metricJsonlContent = metricDocuments.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(metricJsonlPath, metricJsonlContent);
    logger.logInfo(`  ✓ Saved metric JSONL: ${metricJsonlPath}`);

    // Step 3: Initialize staging indexer
    logger.logInfo('\nStep 3: Initializing STAGING indexer...');
    const indexer = new IndexData(stagingClient);
    const initResult = await indexer.initialize();

    if (initResult.outcome !== 'success') {
      logger.logError('Staging indexer initialization failed:', initResult);
      throw new Error('Indexer initialization failed');
    }
    logger.logInfo('  ✓ Staging indexer ready');

    // Step 4: Index imperial data to staging
    logger.logInfo('\nStep 4: Indexing imperial data to STAGING...');
    const imperialPayload = prepareDataForBulkIndexing({ fileNamesArray: [filename], dataType: 'imperial', logger });
    const imperialResult = await indexer.bulkIndexDocuments(imperialPayload, 'imperial');
    logger.logInfo(`  ✓ Imperial indexing complete. Docs: ${imperialResult.indexCounts.count}, Errors: ${imperialResult.erroredDocuments.length}`);

    // Step 5: Index metric data to staging
    logger.logInfo('\nStep 5: Indexing metric data to STAGING...');
    const metricPayload = prepareDataForBulkIndexing({ fileNamesArray: [filename], dataType: 'metric', logger });
    const metricResult = await indexer.bulkIndexDocuments(metricPayload, 'metric');
    logger.logInfo(`  ✓ Metric indexing complete. Docs: ${metricResult.indexCounts.count}, Errors: ${metricResult.erroredDocuments.length}`);

    // Step 6: Verify the gap is filled
    logger.logInfo('\nStep 6: Verifying gap is filled in STAGING...');
    const verifyResult = await stagingClient.count({
      index: 'ambient_weather_heiligers_imperial_*',
      body: {
        query: {
          range: {
            dateutc: {
              gt: gapStart,
              lt: gapEnd
            }
          }
        }
      }
    });

    logger.logInfo(`  Documents in staging for this period: ${verifyResult.body.count}`);
    logger.logInfo(`  Status: ${verifyResult.body.count > 0 ? '✓ GAP FILLED' : '✗ STILL MISSING'}`);

    // Summary
    logger.logInfo('\n=== COPY COMPLETE ===');
    logger.logInfo('Summary:');
    logger.logInfo(`  - Exported from production: ${documents.length} documents`);
    logger.logInfo(`  - Saved to local files: ${filename}.json, .jsonl (imperial + metric)`);
    logger.logInfo(`  - Indexed to staging: ${imperialResult.indexCounts.count} imperial, ${metricResult.indexCounts.count} metric`);
    logger.logInfo(`  - Verification: ${verifyResult.body.count} documents now in staging`);

  } catch (err) {
    logger.logError('Copy operation failed:', err.message);
    throw err;
  } finally {
    await prodClient.close();
    await stagingClient.close();
  }
}

copyProductionToStaging().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
