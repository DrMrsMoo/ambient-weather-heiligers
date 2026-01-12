const { Client } = require('@elastic/elasticsearch');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Check Gap Details

Usage:
  npm run check-gap-details

Description:
  Performs detailed analysis of a specific data gap in the staging cluster.
  This script examines the boundaries around a gap to understand exactly
  what data is missing and where the gap starts and ends.

  The script will:
  - Check Period 1: a boundary period immediately before the suspected gap
  - Check Period 2: the primary gap period under investigation
  - Calculate expected vs actual record counts
  - Show the last document before the gap
  - Show the first document after the gap
  - Report status for each period (HAS DATA / MISSING DATA)

  Expected data frequency: 5-minute intervals (12 records per hour)

Output:
  - Document count for Period 1 with expected records
  - Document count for Period 2 with expected records
  - Status indicators for each period
  - Timestamp of last document before the gap
  - Timestamp of first document after the gap

Options:
  -h, --help     Show this help menu

Examples:
  npm run check-gap-details

Related Commands:
  npm run check-staging-gaps           Check staging cluster gaps
  npm run check-prod-gaps              Check production cluster gaps
  npm run compare-clusters             Compare production vs staging
  npm run verify-backfill              Verify backfilled data
`);
  process.exit(0);
}

async function checkGapDetails() {
  const client = new Client({
    cloud: { id: process.env.STAGING_CLOUD_ID },
    auth: {
      username: process.env.STAGING_ES_USERNAME,
      password: process.env.STAGING_ES_PASSWORD
    }
  });

  // Check data around the gap
  console.log('=== DETAILED GAP ANALYSIS ===\n');

  // Period 1: Dec 31 17:00 to Jan 1 00:00 (should be in file 3)
  const period1Start = new Date('2025-12-31T17:00:00.000Z').getTime();
  const period1End = new Date('2026-01-01T00:00:00.000Z').getTime();

  const period1Result = await client.count({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        range: {
          dateutc: {
            gt: period1Start,
            lte: period1End
          }
        }
      }
    }
  });

  console.log('Period 1: Dec 31 17:00 - Jan 1 00:00');
  console.log('  Expected from file 3: 84 records');
  console.log(`  Actually in cluster: ${period1Result.body.count} records`);
  console.log(`  Status: ${period1Result.body.count > 0 ? '✓ HAS DATA' : '✗ MISSING'}`);
  console.log();

  // Period 2: Jan 1 00:00 to Jan 2 01:30 (the real gap)
  const period2Start = new Date('2026-01-01T00:00:00.000Z').getTime();
  const period2End = new Date('2026-01-02T01:30:00.000Z').getTime();

  const period2Result = await client.count({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        range: {
          dateutc: {
            gt: period2Start,
            lt: period2End
          }
        }
      }
    }
  });

  const period2Hours = (period2End - period2Start) / (1000 * 60 * 60);
  const period2Expected = Math.floor(period2Hours * 12);

  console.log('Period 2: Jan 1 00:00 - Jan 2 01:30 (THE REAL GAP)');
  console.log(`  Expected: ~${period2Expected} records (${period2Hours} hours)`);
  console.log(`  Actually in cluster: ${period2Result.body.count} records`);
  console.log(`  Status: ${period2Result.body.count > 100 ? '✓ HAS DATA' : '✗ MISSING DATA'}`);
  console.log();

  // Check what's the last doc before the gap and first after
  console.log('Boundary Documents:\n');

  const lastBefore = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        range: {
          dateutc: {
            lte: period2Start
          }
        }
      },
      sort: [{ dateutc: 'desc' }],
      size: 1,
      _source: ['dateutc', 'date']
    }
  });

  const firstAfter = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        range: {
          dateutc: {
            gte: period2End
          }
        }
      },
      sort: [{ dateutc: 'asc' }],
      size: 1,
      _source: ['dateutc', 'date']
    }
  });

  if (lastBefore.body.hits.hits.length > 0) {
    console.log(`  Last doc before gap: ${lastBefore.body.hits.hits[0]._source.date}`);
  }
  if (firstAfter.body.hits.hits.length > 0) {
    console.log(`  First doc after gap: ${firstAfter.body.hits.hits[0]._source.date}`);
  }

  await client.close();
  console.log('\n=== ANALYSIS COMPLETE ===');
}

checkGapDetails().catch(err => {
  console.error('Analysis failed:', err.message);
  process.exit(1);
});
