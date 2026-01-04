const { Client } = require('@elastic/elasticsearch');

async function checkProductionGaps() {
  const client = new Client({
    cloud: { id: process.env.ES_CLOUD_ID },
    auth: {
      username: process.env.ES_USERNAME,
      password: process.env.ES_PASSWORD
    }
  });

  console.log('=== CHECKING FOR GAPS IN LAST 7 DAYS (PRODUCTION) ===\n');

  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

  // Get all documents in the last 7 days, sorted by timestamp
  const result = await client.search({
    index: 'ambient_weather_heiligers_imperial_*',
    body: {
      query: {
        range: {
          dateutc: {
            gte: sevenDaysAgo
          }
        }
      },
      sort: [{ dateutc: 'asc' }],
      size: 10000, // Max 10000 docs
      _source: ['dateutc', 'date']
    }
  });

  const docs = result.body.hits.hits.map(h => ({
    timestamp: h._source.dateutc,
    date: h._source.date
  }));

  console.log(`Total documents found: ${docs.length}`);
  console.log(`Date range: ${new Date(sevenDaysAgo).toISOString()} to ${new Date(now).toISOString()}\n`);

  if (docs.length === 0) {
    console.log('⚠️  NO DATA FOUND in last 7 days!');
    await client.close();
    return;
  }

  console.log(`First document: ${docs[0].date} (${docs[0].timestamp})`);
  console.log(`Last document: ${docs[docs.length - 1].date} (${docs[docs.length - 1].timestamp})\n`);

  // Find gaps (more than 5 minutes between consecutive documents)
  const gaps = [];
  const expectedInterval = 5 * 60 * 1000; // 5 minutes in ms
  const gapThreshold = 10 * 60 * 1000; // Consider it a gap if more than 10 minutes

  for (let i = 1; i < docs.length; i++) {
    const timeDiff = docs[i].timestamp - docs[i - 1].timestamp;

    if (timeDiff > gapThreshold) {
      const gapMinutes = Math.floor(timeDiff / (60 * 1000));
      const gapHours = (timeDiff / (60 * 60 * 1000)).toFixed(2);
      const missingRecords = Math.floor(timeDiff / expectedInterval) - 1;

      gaps.push({
        from: docs[i - 1].date,
        to: docs[i].date,
        fromTimestamp: docs[i - 1].timestamp,
        toTimestamp: docs[i].timestamp,
        durationMinutes: gapMinutes,
        durationHours: gapHours,
        missingRecords: missingRecords
      });
    }
  }

  if (gaps.length === 0) {
    console.log('✓ No gaps detected (all intervals <= 10 minutes)');
  } else {
    console.log(`⚠️  Found ${gaps.length} gap(s):\n`);

    gaps.forEach((gap, idx) => {
      console.log(`Gap ${idx + 1}:`);
      console.log(`   From: ${gap.from}`);
      console.log(`   To:   ${gap.to}`);
      console.log(`   Duration: ${gap.durationHours} hours (${gap.durationMinutes} minutes)`);
      console.log(`   Missing records: ~${gap.missingRecords}`);
      console.log();
    });

    // Summary
    const totalMissingRecords = gaps.reduce((sum, gap) => sum + gap.missingRecords, 0);
    const totalGapHours = gaps.reduce((sum, gap) => sum + parseFloat(gap.durationHours), 0);

    console.log('Summary:');
    console.log(`   Total gaps: ${gaps.length}`);
    console.log(`   Total gap duration: ${totalGapHours.toFixed(2)} hours`);
    console.log(`   Total missing records: ~${totalMissingRecords}`);
  }

  // Check expected vs actual record count
  const timeSpan = docs[docs.length - 1].timestamp - docs[0].timestamp;
  const expectedRecords = Math.floor(timeSpan / expectedInterval);
  const actualRecords = docs.length;
  const coverage = ((actualRecords / expectedRecords) * 100).toFixed(1);

  console.log(`\nCoverage Analysis:`);
  console.log(`   Time span: ${(timeSpan / (1000 * 60 * 60)).toFixed(2)} hours`);
  console.log(`   Expected records: ${expectedRecords}`);
  console.log(`   Actual records: ${actualRecords}`);
  console.log(`   Coverage: ${coverage}%`);

  await client.close();
  console.log('\n=== GAP CHECK COMPLETE ===');
}

checkProductionGaps().catch(err => {
  console.error('Gap check failed:', err.message);
  process.exit(1);
});
