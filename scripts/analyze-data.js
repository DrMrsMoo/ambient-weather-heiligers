const { Client } = require('@elastic/elasticsearch');
const fs = require('fs');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Analyze Data

Usage:
  npm run analyze-data

Description:
  Performs detailed analysis of weather data in the staging cluster and
  compares it against local data files. This script helps verify data
  integrity and coverage across different time periods.

  The script will:
  - Query staging cluster for documents in specific date periods
  - Calculate expected record counts based on 5-minute intervals
  - Display coverage percentage for each period
  - List all local JSON data files
  - Show record counts and timestamp ranges for each file
  - Calculate total records across all local files

  Analysis periods:
  - Dec 28 (partial, 17:00-00:00)
  - Dec 29 (full day)
  - Dec 30 (full day)
  - Dec 31 (partial, 00:00-17:00)

Output:
  - Document counts per period in staging cluster
  - Expected vs actual record counts
  - Coverage percentage for each period
  - List of local JSON files with metadata
  - Timestamp ranges for each file
  - Total records across all files

Options:
  -h, --help     Show this help menu

Examples:
  npm run analyze-data

Related Commands:
  npm run verify-backfill              Verify backfilled data
  npm run check-staging-gaps           Check staging cluster gaps
  npm run check-duplicates             Check for duplicate records
  npm run check-gap-details            Detailed gap analysis
`);
  process.exit(0);
}

async function analyzeData() {
  const client = new Client({
    cloud: { id: process.env.STAGING_CLOUD_ID },
    auth: {
      username: process.env.STAGING_ES_USERNAME,
      password: process.env.STAGING_ES_PASSWORD
    }
  });

  console.log('=== DETAILED DATA ANALYSIS ===\n');

  // Check data by day
  const dates = [
    { label: 'Dec 28 (partial, 17:00-00:00)', start: '2025-12-28T17:00:00.000Z', end: '2025-12-29T00:00:00.000Z' },
    { label: 'Dec 29 (full day)', start: '2025-12-29T00:00:00.000Z', end: '2025-12-30T00:00:00.000Z' },
    { label: 'Dec 30 (full day)', start: '2025-12-30T00:00:00.000Z', end: '2025-12-31T00:00:00.000Z' },
    { label: 'Dec 31 (partial, 00:00-17:00)', start: '2025-12-31T00:00:00.000Z', end: '2025-12-31T17:00:00.000Z' }
  ];

  console.log('1. Documents per Period in Staging Cluster:\n');

  for (const period of dates) {
    const startEpoch = new Date(period.start).getTime();
    const endEpoch = new Date(period.end).getTime();

    const result = await client.count({
      index: 'ambient_weather_heiligers_imperial_*',
      body: {
        query: {
          range: {
            dateutc: {
              gte: startEpoch,
              lt: endEpoch
            }
          }
        }
      }
    });

    const hours = (endEpoch - startEpoch) / (1000 * 60 * 60);
    const expected = Math.floor(hours * 12); // 12 records per hour at 5-min intervals

    console.log(`   ${period.label}`);
    console.log(`     - Actual: ${result.body.count} records`);
    console.log(`     - Expected: ~${expected} records (${hours} hrs × 12/hr)`);
    console.log(`     - Coverage: ${((result.body.count / expected) * 100).toFixed(1)}%\n`);
  }

  // Check local data files
  console.log('2. Local Data Files:\n');
  const files = fs.readdirSync('./data/ambient-weather-heiligers-imperial/').filter(f => f.endsWith('.json'));
  console.log(`   Total JSON files: ${files.length}\n`);

  let totalRecords = 0;
  files.forEach(filename => {
    const data = JSON.parse(fs.readFileSync(`./data/ambient-weather-heiligers-imperial/${filename}`, 'utf8'));
    const timestamps = data.map(r => r.dateutc).sort((a,b) => a-b);
    totalRecords += data.length;

    console.log(`   ${filename}`);
    console.log(`     - Records: ${data.length}`);
    console.log(`     - Range: ${new Date(timestamps[0]).toISOString()} to ${new Date(timestamps[timestamps.length-1]).toISOString()}`);
  });

  console.log(`\n   Total records across all files: ${totalRecords}`);

  await client.close();
  console.log('\n=== ANALYSIS COMPLETE ===');
}

analyzeData().catch(err => {
  console.error('Analysis failed:', err.message);
  process.exit(1);
});
