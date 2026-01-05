const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { runBackfill } = require('./src/backfill/backfill');

module.exports = (async () => {
  try {
    // Parse CLI arguments
    const argv = yargs(hideBin(process.argv))
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
      .help()
      .argv;

    const result = await runBackfill(argv);
    console.log('[runBackfill] [RESULT]:', result);
  } catch (err) {
    console.error('[runBackfill] [ERROR]', err);
    throw err;
  }
})();
