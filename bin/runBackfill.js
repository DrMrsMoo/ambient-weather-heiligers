const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { runBackfill } = require('../src/backfill/backfill');

module.exports = (async () => {
  try {
    // Parse CLI arguments
    const argv = yargs(hideBin(process.argv))
      .scriptName('npm run backfill --')
      .usage('Usage: $0 [options]')
      .version(false)
      .option('prod', {
        type: 'boolean',
        description: 'Target production cluster only',
        conflicts: ['staging', 'both']
      })
      .option('staging', {
        type: 'boolean',
        description: 'Target staging cluster only',
        conflicts: ['prod', 'both']
      })
      .option('both', {
        type: 'boolean',
        description: 'Target both production and staging clusters (independent gap detection for each)',
        conflicts: ['prod', 'staging']
      })
      .option('from', {
        type: 'string',
        description: 'Start date (YYYY-MM-DD)',
        demandOption: true
      })
      .option('to', {
        type: 'string',
        description: 'End date (YYYY-MM-DD)',
        demandOption: true
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        description: 'Skip confirmation prompt and proceed automatically',
        default: false
      })
      .check((argv) => {
        // Validate exactly one of prod/staging/both
        const clusterFlags = [argv.prod, argv.staging, argv.both].filter(Boolean);
        if (clusterFlags.length === 0) {
          throw new Error('Must specify --prod, --staging, or --both');
        }
        if (clusterFlags.length > 1) {
          throw new Error('Cannot specify multiple cluster flags');
        }
        return true;
      })
      .example('$0 --staging --from 2025-12-29 --to 2026-01-01', 'Backfill staging cluster only')
      .example('$0 --prod --from 2025-12-29 --to 2026-01-01', 'Backfill production cluster only')
      .example('$0 --both --from 2025-12-29 --to 2026-01-01', 'Backfill both clusters with independent gap detection')
      .example('$0 --both --from 2025-12-29 --to 2026-01-01 --yes', 'Backfill both clusters without confirmation prompts')
      .epilogue(`
Description:
  Backfills missing weather data into Elasticsearch clusters. The script will:
  1. Detect data gaps in the specified date range
  2. Try to load data from local files first
  3. Fall back to fetching from Ambient Weather API if needed
  4. Index both imperial and metric versions of the data

Notes:
  - Use --yes flag in automated environments (CI/CD, scripts)
  - The script will show gap details before proceeding
  - Data is sourced from local files when available to avoid API limits
      `)
      .help()
      .alias('help', 'h')
      .argv;

    const result = await runBackfill(argv);
    console.log('[runBackfill] [RESULT]:', result);
  } catch (err) {
    console.error('[runBackfill] [ERROR]', err);
    throw err;
  }
})();
