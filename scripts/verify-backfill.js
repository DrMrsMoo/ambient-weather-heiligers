const { Client } = require('@elastic/elasticsearch');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Verify Backfill

Usage:
  npm run verify-backfill

Description:
  Verifies that backfilled data has been properly indexed to the staging
  Elasticsearch cluster. This script checks data in a specific date range
  to confirm the backfill operation was successful.

  The script will:
  - Display active write indices in the staging cluster
  - Query imperial and metric data within the backfilled date range
  - Show document counts and timestamp ranges
  - Display sample documents to verify content
  - Calculate data coverage and compare against expected records
  - Verify data matches the manually created files

Output:
  - Active write indices information
  - Document counts for imperial and metric data
  - Earliest and latest timestamps in the range
  - Sample documents with temperature and humidity data
  - Gap analysis with coverage percentage
  - Manual file range verification

Options:
  -h, --help     Show this help menu

Examples:
  npm run verify-backfill

Related Commands:
  npm run backfill -- [options]        Backfill missing data
  npm run check-staging-gaps           Check staging cluster gaps
  npm run check-prod-gaps              Check production cluster gaps
  npm run compare-clusters             Compare production vs staging data
`);
  process.exit(0);
}

async function verifyBackfill() {
  // Create staging client
  const client = new Client({
    cloud: { id: process.env.STAGING_CLOUD_ID },
    auth: {
      username: process.env.STAGING_ES_USERNAME,
      password: process.env.STAGING_ES_PASSWORD
    }
  });

  console.log('=== STAGING CLUSTER VERIFICATION ===\n');

  // 1. Check active write indices
  console.log('1. Active Write Indices:');
  // v8: cat.aliases() returns the array directly (no `.body` wrapper).
  // NOTE: this diagnostic script intentionally uses the _cat API, which is text-based
  // and returns `is_write_index` as the STRING 'true'/'false' — hence the `=== 'true'`
  // comparison below. Do NOT "fix" this to `=== true`: unlike the production path
  // (Indexer.js / getAmbientWeatherAliases, which uses indices.getAlias and gets a real
  // boolean), cat.aliases returns strings. Changing it to a boolean check would make this
  // silently report zero write indices.
  const aliases = await client.cat.aliases({ format: 'json' });
  const writeIndices = aliases.filter(a =>
    a.alias.includes('ambient-weather-heiligers') && a['is_write_index'] === 'true'
  );
  writeIndices.forEach(idx => {
    console.log(`   - ${idx.index} (alias: ${idx.alias})`);
  });

  // 2. Query imperial data in backfilled range
  const startEpoch = new Date('2025-12-28T17:00:00.000Z').getTime();
  const endEpoch = new Date('2025-12-31T17:00:00.000Z').getTime();

  console.log(`\n2. Imperial Data in Range (${new Date(startEpoch).toISOString()} to ${new Date(endEpoch).toISOString()}):`);

  // v8: search params are top-level (no nested `body`); responses are flattened (no `.body`).
  const imperialQuery = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    query: {
      range: {
        dateutc: {
          gt: startEpoch,
          lt: endEpoch
        }
      }
    },
    size: 0,
    aggs: {
      doc_count: { value_count: { field: 'dateutc' } },
      min_date: { min: { field: 'dateutc' } },
      max_date: { max: { field: 'dateutc' } }
    }
  });

  const imperialCount = imperialQuery.hits.total.value;
  const imperialMin = new Date(imperialQuery.aggregations.min_date.value).toISOString();
  const imperialMax = new Date(imperialQuery.aggregations.max_date.value).toISOString();

  console.log(`   - Total documents: ${imperialCount}`);
  console.log(`   - Earliest timestamp: ${imperialMin}`);
  console.log(`   - Latest timestamp: ${imperialMax}`);

  // 3. Query metric data in backfilled range
  console.log(`\n3. Metric Data in Range (${new Date(startEpoch).toISOString()} to ${new Date(endEpoch).toISOString()}):`);

  const metricQuery = await client.search({
    index: 'ambient_weather_heiligers_metric_*',
    query: {
      range: {
        dateutc: {
          gt: startEpoch,
          lt: endEpoch
        }
      }
    },
    size: 0,
    aggs: {
      doc_count: { value_count: { field: 'dateutc' } },
      min_date: { min: { field: 'dateutc' } },
      max_date: { max: { field: 'dateutc' } }
    }
  });

  const metricCount = metricQuery.hits.total.value;
  const metricMin = new Date(metricQuery.aggregations.min_date.value).toISOString();
  const metricMax = new Date(metricQuery.aggregations.max_date.value).toISOString();

  console.log(`   - Total documents: ${metricCount}`);
  console.log(`   - Earliest timestamp: ${metricMin}`);
  console.log(`   - Latest timestamp: ${metricMax}`);

  // 4. Sample a few documents to verify content
  console.log('\n4. Sample Documents (first 3 from imperial):');

  const sampleQuery = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    query: {
      range: {
        dateutc: {
          gt: startEpoch,
          lt: endEpoch
        }
      }
    },
    sort: [{ dateutc: 'asc' }],
    size: 3,
    _source: ['dateutc', 'date', 'tempf', 'humidity']
  });

  sampleQuery.hits.hits.forEach((hit, idx) => {
    const src = hit._source;
    console.log(`   [${idx + 1}] ${src.date} - Temp: ${src.tempf}°F, Humidity: ${src.humidity}%`);
  });

  // 5. Check for gaps in the data
  console.log('\n5. Gap Analysis (5-minute intervals):');
  const expectedRecords = Math.floor((endEpoch - startEpoch) / (5 * 60 * 1000));
  console.log(`   - Expected records (5-min intervals): ~${expectedRecords}`);
  console.log(`   - Actual imperial records: ${imperialCount}`);
  console.log(`   - Actual metric records: ${metricCount}`);
  console.log(`   - Coverage: ${((imperialCount / expectedRecords) * 100).toFixed(1)}%`);

  // 6. Verify data matches our manual files
  console.log('\n6. Manual File Range Verification:');
  console.log('   - File 1 range: Dec 29 00:05 - Dec 30 00:00 (288 records expected)');
  console.log('   - File 2 range: Dec 30 00:05 - Dec 31 00:00 (288 records expected)');
  console.log('   - File 3 range: Dec 31 00:05 - Jan 1 00:00 (288 records expected)');
  console.log(`   - Total expected from files: ~864 records`);
  console.log(`   - Actual in cluster (within gap): ${imperialCount} records`);

  await client.close();
  console.log('\n=== VERIFICATION COMPLETE ===');
}

verifyBackfill().catch(err => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
