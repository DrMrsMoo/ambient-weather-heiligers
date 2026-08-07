const { Client } = require('@elastic/elasticsearch');

// Show help menu if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Compare Clusters

Usage:
  npm run compare-clusters
  npm run compare-clusters -- --days 7
  npm run compare-clusters -- --from 2026-01-01 --to 2026-01-02
  npm run compare-clusters -- --days 7 --index 'ambient_weather_heiligers_imperial_*'

Description:
  Compares document counts between the production and staging Elasticsearch
  clusters over a time window. Use it to spot data gaps, and to verify a
  cutover did not disturb ingest.

  The script will:
  - Query both production and staging clusters for data in the window
  - Display document counts for each cluster
  - Report the difference and whether the clusters agree
  - Display sample documents from production if data exists

Options:
  --days <n>       Window = the last <n> days, ending now. Default: 7
  --from <date>    Explicit window start (ISO date or datetime)
  --to <date>      Explicit window end. Defaults to now when --from is given
  --index <pat>    Index or alias to query.
                   Default: all-ambient-weather-heiligers-imperial
  -h, --help       Show this help menu

  --from/--to take precedence over --days.

Notes:
  - Defaults to the ALIAS, not a raw index glob, so it follows the write index
    across a rollover or cutover. Pass --index for a specific index pattern.
  - Counts are broken down BY INDEX. Read that breakdown before reacting to a
    difference in totals.
  - Differing totals are often NOT a fault. Two common causes:
      1. An alias spanning a cutover holds the old write index as a read
         member, so their date ranges overlap and documents count twice.
         Measured 2026-08-07: over the same 7 days staging's alias reported
         3,782 against production's 2,233 -- yet BOTH clusters' live write
         index held exactly 2,229. Ingest was healthy; the extra 1,545 sat in
         ambient_weather_heiligers_imperial_2021_12_30_v2, the pre-cutover
         write index.
      2. The known historical eras (2020 metric gap, 2022-23 imperial dup),
         plus staging's 2020-2021 range now inflated by retained duplicates.
    When the largest index on each side agrees, live ingest matches.

Examples:
  npm run compare-clusters                                    Last 7 days
  npm run compare-clusters -- --days 1                        Last 24 hours
  npm run compare-clusters -- --from 2026-01-01 --to 2026-01-02
  npm run compare-clusters -- --days 30 --index 'ambient_weather_heiligers_metric_*'

Related Commands:
  npm run check-prod-gaps              Check production cluster gaps
  npm run check-staging-gaps           Check staging cluster gaps
  npm run copy-prod-to-staging         Copy production data to staging
  npm run verify-backfill              Verify backfilled data
`);
  process.exit(0);
}

const DEFAULT_DAYS = 7;
const DEFAULT_INDEX = 'all-ambient-weather-heiligers-imperial';

// Read a `--flag value` pair from argv. Returns undefined when absent.
function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  // Guard against `--days --index foo`, where the value slot holds the next flag
  if (value === undefined || value.startsWith('-')) {
    console.error(`Error: ${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

// Parse a date the way a human types it on a CLI:
// - bare `YYYY-MM-DD` is treated as UTC midnight, not local (avoids silent TZ drift)
// - anything else defers to Date parsing
function parseDate(input, flag) {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00.000Z` : input;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    console.error(`Error: ${flag} is not a valid date: "${input}"`);
    console.error('Expected YYYY-MM-DD or a full ISO datetime.');
    process.exit(1);
  }
  return ms;
}

// Resolve the comparison window. --from/--to wins over --days.
function resolveWindow() {
  const fromArg = getArgValue('--from');
  const toArg = getArgValue('--to');
  const daysArg = getArgValue('--days');

  if (fromArg) {
    const start = parseDate(fromArg, '--from');
    const end = toArg ? parseDate(toArg, '--to') : Date.now();
    if (end <= start) {
      console.error('Error: --to must be after --from.');
      process.exit(1);
    }
    return { start, end, label: toArg ? `${fromArg} → ${toArg}` : `${fromArg} → now` };
  }

  if (toArg) {
    console.error('Error: --to requires --from.');
    process.exit(1);
  }

  const days = daysArg === undefined ? DEFAULT_DAYS : Number(daysArg);
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`Error: --days must be a positive number, got "${daysArg}".`);
    process.exit(1);
  }
  const end = Date.now();
  return {
    start: end - days * 24 * 60 * 60 * 1000,
    end,
    label: `last ${days} day${days === 1 ? '' : 's'}`
  };
}

function formatDuration(ms) {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

async function compareClusters() {
  const { start, end, label } = resolveWindow();
  const index = getArgValue('--index') || DEFAULT_INDEX;

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

  console.log('=== COMPARING PRODUCTION VS STAGING ===\n');
  console.log(`Window: ${label}`);
  console.log(`        ${new Date(start).toISOString()} → ${new Date(end).toISOString()}`);
  console.log(`        (${formatDuration(end - start)})`);
  console.log(`Index:  ${index}\n`);

  const range = { range: { dateutc: { gt: start, lt: end } } };

  // Break the count down BY INDEX, not just in total. An alias spanning a
  // cutover holds the old write index as a read member, so its date range
  // overlaps the new one and documents are counted under both. A bare total
  // reports that overlap as a cluster MISMATCH when ingest is in fact healthy.
  async function countByIndex(client, name) {
    const result = await client.search({
      index,
      query: range,
      size: 0,
      track_total_hits: true,
      aggs: { by_index: { terms: { field: '_index', size: 50 } } }
    });
    const total = result.hits.total.value;
    const buckets = result.aggregations.by_index.buckets;

    console.log(`${name}:`);
    console.log(`   Documents: ${total}`);
    console.log(`   Status: ${total > 0 ? '✓ HAS DATA' : '✗ NO DATA'}`);
    buckets.forEach(b => console.log(`     ${b.key}: ${b.doc_count}`));
    console.log();

    return { total, buckets };
  }

  // v8: search params are top-level (no nested `body`); responses are flattened (no `.body`).
  const prod = await countByIndex(prodClient, 'PRODUCTION');
  const staging = await countByIndex(stagingClient, 'STAGING');

  // The comparison itself — the reason the script exists
  console.log('COMPARISON:');
  const diff = prod.total - staging.total;
  if (diff === 0) {
    console.log(`   ✓ MATCH — both clusters report ${prod.total} documents`);
  } else {
    const ahead = diff > 0 ? 'PRODUCTION' : 'STAGING';
    console.log(`   ⚠️  TOTALS DIFFER — ${ahead} has ${Math.abs(diff)} more document(s)`);

    // Compare the LARGEST index on each side. Where an alias spans a cutover,
    // that is the current write index — so matching leaders means live ingest
    // agrees and the difference sits in overlapping historical members.
    const topOf = c => c.buckets.reduce((a, b) => (b.doc_count > (a ? a.doc_count : -1) ? b : a), null);
    const prodTop = topOf(prod);
    const stagingTop = topOf(staging);

    if (prodTop && stagingTop && prodTop.doc_count === stagingTop.doc_count) {
      console.log(`   ✓ but the largest index on each side AGREES at ${prodTop.doc_count} documents`);
      console.log(`     prod:    ${prodTop.key}`);
      console.log(`     staging: ${stagingTop.key}`);
      console.log('     → live ingest matches; the difference is in other alias members');
      console.log('       (typically an old write index still attached as a read member).');
    } else {
      console.log('   Check the per-index breakdown above before treating this as data loss —');
      console.log('   overlapping alias members and the known historical eras both show up here.');
    }
  }
  console.log();

  // If production has data, show sample
  if (prod.total > 0) {
    console.log('Sample documents from PRODUCTION:\n');

    const sampleResult = await prodClient.search({
      index,
      query: range,
      sort: [{ dateutc: 'asc' }],
      size: 5,
      _source: ['dateutc', 'date', 'tempf']
    });

    sampleResult.hits.hits.forEach((hit, idx) => {
      console.log(`   [${idx + 1}] ${hit._source.date} - Temp: ${hit._source.tempf}°F`);
    });
    console.log();
  }

  await prodClient.close();
  await stagingClient.close();

  console.log('=== COMPARISON COMPLETE ===');
}

compareClusters().catch(err => {
  console.error('Comparison failed:', err.message);
  process.exit(1);
});
