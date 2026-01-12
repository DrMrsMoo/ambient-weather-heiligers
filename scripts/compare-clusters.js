const { Client } = require('@elastic/elasticsearch');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Compare Clusters

Usage:
  npm run compare-clusters

Description:
  Compares data between production and staging Elasticsearch clusters for
  a specific time period. This is useful for identifying data gaps and
  verifying that data exists in production that could be copied to staging.

  The script will:
  - Query both production and staging clusters for data in a specified period
  - Display document counts for each cluster
  - Show whether each cluster has data for the period
  - Display sample documents from production if data exists
  - Indicate if production data could be copied to staging

Output:
  - Document count for production cluster in the time period
  - Document count for staging cluster in the same period
  - Status indicator showing which clusters have data
  - Sample documents from production (first 5)
  - Recommendation on whether production data could fill staging gaps

Options:
  -h, --help     Show this help menu

Examples:
  npm run compare-clusters

Related Commands:
  npm run check-prod-gaps              Check production cluster gaps
  npm run check-staging-gaps           Check staging cluster gaps
  npm run copy-prod-to-staging         Copy production data to staging
  npm run verify-backfill              Verify backfilled data
`);
  process.exit(0);
}

async function compareClusters() {
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

  console.log('=== COMPARING PRODUCTION VS STAGING (Jan 1-2 Gap) ===\n');

  // The gap in staging
  const gapStart = new Date('2026-01-01T00:00:00.000Z').getTime();
  const gapEnd = new Date('2026-01-02T01:30:00.000Z').getTime();

  console.log('Period: Jan 1 00:00 - Jan 2 01:30 (25.5 hours)\n');

  // Check production
  const prodResult = await prodClient.count({
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

  console.log('PRODUCTION:');
  console.log(`   Documents: ${prodResult.body.count}`);
  console.log(`   Status: ${prodResult.body.count > 0 ? '✓ HAS DATA' : '✗ NO DATA'}`);
  console.log();

  // Check staging
  const stagingResult = await stagingClient.count({
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

  console.log('STAGING:');
  console.log(`   Documents: ${stagingResult.body.count}`);
  console.log(`   Status: ${stagingResult.body.count > 0 ? '✓ HAS DATA' : '✗ NO DATA'}`);
  console.log();

  // If production has data, show sample
  if (prodResult.body.count > 0) {
    console.log('Sample documents from PRODUCTION:\n');

    const sampleResult = await prodClient.search({
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
        size: 5,
        _source: ['dateutc', 'date', 'tempf']
      }
    });

    sampleResult.body.hits.hits.forEach((hit, idx) => {
      console.log(`   [${idx + 1}] ${hit._source.date} - Temp: ${hit._source.tempf}°F`);
    });

    console.log('\n✓ Production has data for this period!');
    console.log('  → This data could potentially be copied to staging if needed');
  }

  await prodClient.close();
  await stagingClient.close();

  console.log('\n=== COMPARISON COMPLETE ===');
}

compareClusters().catch(err => {
  console.error('Comparison failed:', err.message);
  process.exit(1);
});
