const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { runBackfill } = require('./src/backfill/backfill');

module.exports = (async () => {
  try {
    // Parse CLI arguments
    const argv = yargs(hideBin(process.argv))
      .option('prod', {
        type: 'boolean',
        description: 'Target production cluster',
        conflicts: 'staging'
      })
      .option('staging', {
        type: 'boolean',
        description: 'Target staging cluster',
        conflicts: 'prod'
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
        // Validate exactly one of prod/staging
        if (!argv.prod && !argv.staging) {
          throw new Error('Must specify either --prod or --staging');
        }
        return true;
      })
      .example('$0 --staging --from 2025-12-29 --to 2026-01-01', 'Backfill staging cluster for specified date range')
      .example('$0 --prod --from 2025-12-29 --to 2026-01-01', 'Backfill production cluster for specified date range')
      .help()
      .argv;

    const result = await runBackfill(argv);
    console.log('[runBackfill] [RESULT]:', result);
  } catch (err) {
    console.error('[runBackfill] [ERROR]', err);
    throw err;
  }
})();
