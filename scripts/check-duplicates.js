const { Client } = require('@elastic/elasticsearch');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Check Duplicates

Usage:
  npm run check-duplicates

Description:
  Checks the staging Elasticsearch cluster for duplicate weather data records.
  Duplicates occur when multiple documents have the same timestamp (dateutc field).
  This can happen during manual indexing or backfill operations.

  The script will:
  - Check a sample timestamp for duplicate documents
  - Display all documents found for that timestamp
  - Run aggregate statistics to find all duplicated timestamps in a date range
  - Show the top 5 most duplicated timestamps
  - Report total unique timestamps and how many have duplicates

  Sample timestamp checked: Example UTC timestamp (e.g., a recent hourly reading)
  Date range for aggregation: 24-hour window around the sample timestamp

Output:
  - Number of documents found for the sample timestamp
  - Details of duplicate documents (ID, temperature, date)
  - Total unique timestamps in the date range
  - Count of timestamps with duplicates
  - Top 5 most duplicated timestamps with duplicate counts

Options:
  -h, --help     Show this help menu

Examples:
  npm run check-duplicates

Related Commands:
  npm run verify-backfill              Verify backfilled data
  npm run check-staging-gaps           Check staging cluster gaps
  npm run analyze-data                 Analyze data coverage
  npm run verify-indexing              Verify indexing status
`);
  process.exit(0);
}

async function checkDuplicates() {
  const client = new Client({
    cloud: { id: process.env.STAGING_CLOUD_ID },
    auth: {
      username: process.env.STAGING_ES_USERNAME,
      password: process.env.STAGING_ES_PASSWORD
    }
  });

  console.log('=== DUPLICATE DETECTION ===\n');

  // Sample a specific timestamp and count how many docs exist
  const sampleTimestamp = new Date('2025-12-29T12:00:00.000Z').getTime();

  console.log(`Checking for duplicates at timestamp: ${new Date(sampleTimestamp).toISOString()}\n`);

  const result = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        term: {
          dateutc: sampleTimestamp
        }
      },
      size: 10,
      _source: ['dateutc', 'date', 'tempf', '_id']
    }
  });

  console.log(`Documents found for this exact timestamp: ${result.body.hits.total.value}`);

  if (result.body.hits.total.value > 1) {
    console.log('\n⚠️  DUPLICATES DETECTED! Multiple documents with same timestamp:\n');
    result.body.hits.hits.forEach((hit, idx) => {
      console.log(`   [${idx + 1}] ID: ${hit._id} | Temp: ${hit._source.tempf}°F | Date: ${hit._source.date}`);
    });
  } else if (result.body.hits.total.value === 1) {
    console.log('✓ No duplicates for this timestamp');
  } else {
    console.log('No documents found for this timestamp');
  }

  // Check aggregate duplication stats
  console.log('\n\nChecking duplication statistics across date range...\n');

  const aggResult = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        range: {
          dateutc: {
            gte: new Date('2025-12-29T00:00:00.000Z').getTime(),
            lt: new Date('2025-12-30T00:00:00.000Z').getTime()
          }
        }
      },
      size: 0,
      aggs: {
        by_timestamp: {
          terms: {
            field: 'dateutc',
            size: 300,
            order: { _count: 'desc' }
          }
        }
      }
    }
  });

  const buckets = aggResult.body.aggregations.by_timestamp.buckets;
  const duplicatedBuckets = buckets.filter(b => b.doc_count > 1);

  console.log(`Total unique timestamps: ${buckets.length}`);
  console.log(`Timestamps with duplicates: ${duplicatedBuckets.length}`);

  if (duplicatedBuckets.length > 0) {
    console.log('\nTop 5 most duplicated timestamps:\n');
    duplicatedBuckets.slice(0, 5).forEach((bucket, idx) => {
      console.log(`   [${idx + 1}] ${new Date(bucket.key).toISOString()} - ${bucket.doc_count} copies`);
    });
  }

  await client.close();
  console.log('\n=== DETECTION COMPLETE ===');
}

checkDuplicates().catch(err => {
  console.error('Duplicate check failed:', err.message);
  process.exit(1);
});
