## Warning
Use at your own risk!
This project is in progress and by no means do I declare it to be 'prod-ready'.

## Documentation

**For complete documentation, see the [docs/](docs/) folder:**
- [CLAUDE.md](docs/CLAUDE.md) - Project constitution and development guide
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment procedures and production safety
- [REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) - Modernization roadmap
- [CHANGELOG.md](docs/CHANGELOG.md) - Release history

## Ambient Weather Heiligers (weather station data)
The data is will be indexed into ambient_weather_heiligers_imperial and ambient_weather_heiligers_metric indices with index patterns of the same name. The templates and aliases are versioned in the config folder.
The data comes from my own weather station, mounted on my patio roof, just outside my office.

## Duplicate data
There's a high chance of duplicate entries because of the way the Ambient Weather REST API works (counting records backwards in time). Any duplicate data entries are removed with Logstash during a reindexing operation.

## Scripts:
Install:
`$npm install`

To fetch and convert data:
1. Fetch new data:
`$node bin/runFetchRawData.js`

2. Convert imperial data to jsonl:
`$node bin/runConvertImperialToJsonl.js`

3. Handle metric and json -> jsonl conversion
`$node bin/runConvertImperialToMetric.js`

Or use npm scripts:
`$npm start`

Test:
`$npm test`

## Backfill Missing Data

The backfill feature allows you to fill gaps in your Elasticsearch clusters by fetching missing weather data for specific date ranges.

### Basic Usage

```bash
# Backfill staging cluster
./backfill.sh --staging --from 2025-12-29 --to 2026-01-01

# Backfill production cluster
./backfill.sh --prod --from 2025-12-29 --to 2026-01-01

# Backfill BOTH clusters (with independent gap detection)
./backfill.sh --both --from 2025-12-29 --to 2026-01-01

# Automated mode (skip confirmation prompts)
./backfill.sh --staging --from 2025-12-29 --to 2026-01-01 --yes

# Using npm script
npm run backfill -- --staging --from 2025-12-29 --to 2026-01-01 --yes
```

### How It Works

1. **Gap Detection**: Queries the target cluster(s) to find exact boundaries of missing data
2. **Smart Data Sourcing**:
   - First attempts to load data from local files in `data/ambient-weather-heiligers-imperial/`
   - Automatically converts local files to JSONL (imperial + metric) if needed
   - Falls back to Ambient Weather API if no local data exists
3. **Data Processing**:
   - Filters records to exact gap boundaries (exclusive of endpoints to avoid duplicates)
   - Indexes both imperial and metric data to the target cluster(s)
4. **Cleanup**: Removes temporary files after successful indexing (preserves local data)

### Features

- **Flexible cluster targeting** via `--prod`, `--staging`, or `--both` flags
- **Automatic gap boundary discovery** using ES range queries
- **Local-first approach**: uses existing files before calling API
- **Auto-conversion**: converts raw JSON to JSONL formats as needed
- **Rate limit bypass** for historical data fetches
- **User confirmation** before backfilling (or `--yes` flag for automation)
- **Independent cluster processing** when using `--both` flag

### Verification & Gap Analysis Scripts

Check for gaps and verify data integrity using these npm scripts:

```bash
# Check for gaps in staging cluster (last 7 days)
npm run check-staging-gaps

# Check for gaps in production cluster (last 7 days)
npm run check-prod-gaps

# Verify backfill operation succeeded
npm run verify-backfill

# Compare data between production and staging
npm run compare-clusters

# Analyze data distribution
npm run analyze-data
```

For full script documentation, see [scripts/README.md](scripts/README.md).

### Copying Data Between Clusters

If production has data that staging is missing (e.g., from a failed cron job):

```bash
# Copy missing data from production to staging
npm run copy-prod-to-staging
```

**Note:** Edit the script to change date ranges before running.

### Important Notes

- Backfill operates on **past data** and bypasses normal rate limiting
- The Ambient Weather API counts **backwards in time** - backfill handles this automatically
- Local files are **preserved** (not deleted) for audit trail
- When using `--both`, each cluster gets independent gap detection
- Boundary filtering uses strict inequality (`>` and `<`) to prevent duplicate indexing

### Where the code lives:
 - runFetchNewData.js (class)
 - runConvertImperialToJsonl.js

 **Not currently in use**
 - convert_imperial_to_metric.js
 - metric-data-to_jsonl.js

## ELasticsearch info

### Reindexing and Aliases:
Updating mappings for fields that already exist can only be done by reindexing with the new, updated mapping.
There's a great desciption given in [a blog post describing the process](https://www.objectrocket.com/blog/elasticsearch/elasticsearch-aliases/):
>After reindexing, you still have to manage the cutover from the old index to the new index. Aliases allow you to make this cutover without downtime.<br></br> Here’s how:<br></br>_Let’s assume I have an index called oldIndex and I want to reindex it into newIndex._
<br></br>1. The first thing I want to do is create an alias (myalias) and add it to oldIndex.
<br></br>2. Next, make sure that your application is pointing to myalias rather than oldIndex.
<br></br>3. Now create your new index, newIndex, and begin reindexing the data from oldIndex into it.
<br></br>4. Add newIndex to ‘myalias’ and remove oldIndex. You can do this in a single command and the change is atomic, so there will be no issues during the transition.
```
POST /_aliases
{
    "actions" : [
        { "remove" : { "index" : "oldIndex", "alias" : "myalias" } },
        { "add" : { "index" : "newIndex", "alias" : "myalias" } }
    ]
}
```
<br></br>5. Verify that you’re getting the results you expect with the alias and then you can remove *oldIndex* when you’re ready.
<br></br>Note: It’s good practice to use an alias for reads/queries from your application anyway, so if you did that from the get-go, you’d have been able to skip the first three steps in that reindexing process.

## TODO:
1. Code:
- Implement using es client to index without filebeat: in progress
- Automate de-duping entries: https://www.elastic.co/blog/how-to-find-and-remove-duplicate-documents-in-elasticsearch Old solution was to use logstash but it's very manual
- Set up ILM to automatically rollover the indices (metric, imperial & deduped entries)
- Set up monitoring for the pi
- Set up CI -> eventually, not needed right now
    - Automate test runs before pushing to Github -> not doing with husky, something went wrong and I don't feel like figuring it out.
- Convert to typescript
- Add jsdocs: in progress

2. Kibana:
- index pattern to match the aliases
## Known bugs:
 - If the last saved data file is an empty array, the rawDataFatcher doesn't fetch new data.
 - If there aren't any files in the `ambient-weather-heiligers-data` folder, `getLastRecordedDataDate` throws an error.
 - If not enough time's passed since fetching data, we end up with files names "Infinity_-Infinity"
## Current aliases:
| alias | index | filter | routing.index | routing.search | is_write_index (if blank, defaults to true) |
| ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| all-ambient-weather-heiligers-imperial | ambient_weather_heiligers_imperial_2020_08_03 | - | - | - | false
| all-ambient-weather-heiligers-imperial | ambient_weather_heiligers_imperial_2021_06_12 | - | - | - | true
| all-ambient-weather-heiligers-imperial | ambient_weather_heiligers_imperial_2020_06_30 | - | - | - | false
| all-deduped-ambient-weather-heiligers-imperial | deduped_ambient_weather_heiligers_imperial_2020_07_25 | - | -  | - | - |
all-ambient-weather-heiligers-metric | ambient_weather_heiligers_metric_2021_06_12 | - | - | - | true |
