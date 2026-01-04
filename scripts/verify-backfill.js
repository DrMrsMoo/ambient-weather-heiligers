const { Client } = require('@elastic/elasticsearch');

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
  const aliases = await client.cat.aliases({ format: 'json' });
  const writeIndices = aliases.body.filter(a =>
    a.alias.includes('ambient-weather-heiligers') && a['is_write_index'] === 'true'
  );
  writeIndices.forEach(idx => {
    console.log(`   - ${idx.index} (alias: ${idx.alias})`);
  });

  // 2. Query imperial data in backfilled range
  const startEpoch = new Date('2025-12-28T17:00:00.000Z').getTime();
  const endEpoch = new Date('2025-12-31T17:00:00.000Z').getTime();

  console.log(`\n2. Imperial Data in Range (${new Date(startEpoch).toISOString()} to ${new Date(endEpoch).toISOString()}):`);

  const imperialQuery = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
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
    }
  });

  const imperialCount = imperialQuery.body.hits.total.value;
  const imperialMin = new Date(imperialQuery.body.aggregations.min_date.value).toISOString();
  const imperialMax = new Date(imperialQuery.body.aggregations.max_date.value).toISOString();

  console.log(`   - Total documents: ${imperialCount}`);
  console.log(`   - Earliest timestamp: ${imperialMin}`);
  console.log(`   - Latest timestamp: ${imperialMax}`);

  // 3. Query metric data in backfilled range
  console.log(`\n3. Metric Data in Range (${new Date(startEpoch).toISOString()} to ${new Date(endEpoch).toISOString()}):`);

  const metricQuery = await client.search({
    index: 'ambient_weather_heiligers_metric_*',
    body: {
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
    }
  });

  const metricCount = metricQuery.body.hits.total.value;
  const metricMin = new Date(metricQuery.body.aggregations.min_date.value).toISOString();
  const metricMax = new Date(metricQuery.body.aggregations.max_date.value).toISOString();

  console.log(`   - Total documents: ${metricCount}`);
  console.log(`   - Earliest timestamp: ${metricMin}`);
  console.log(`   - Latest timestamp: ${metricMax}`);

  // 4. Sample a few documents to verify content
  console.log('\n4. Sample Documents (first 3 from imperial):');

  const sampleQuery = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
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
    }
  });

  sampleQuery.body.hits.hits.forEach((hit, idx) => {
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
