const esClient = require('./esClient');
const { indexDoesNotExist, indexExistsError } = require('./errors');
const { errors } = require('@elastic/elasticsearch');
const Logger = require('../logger');

const esClientLogger = new Logger('esClientLogger');

// gets the current cluster info
/**
 *
 * @param {Class} client configured elasticsearch client
 * @returns cluster information
 */
async function getClusterInfo(client = esClient) {
  let result;
  try {
    result = await client.info();
  } catch (err) {
    esClientLogger.logError('[getClusterInfo] [ERROR]', err);
  }
  esClientLogger.logInfo('[getClusterInfo] [SUCCESS]', result)
  return result;
}

/**
 *
 * @param {Class} client: configured elasticsearch client
 * @returns boolean: true if there is a connection, false otherwise
 */
async function pingCluster(client = esClient) {
  let pingResult;
  try {
    pingResult = await client.ping();
  } catch (err) {
    esClientLogger.logError('[pingCluster] [ERROR]', err);
    throw err;
  }
  // v8: ping() returns the boolean directly (no { body } wrapper).
  return pingResult;
}

/**
 *
 * @param {Class} client: configured Elasticsearch client
 * @returns array of ambient_weather_heiligers_* indices (see getAllAmbientWeatherIndicesResult in ./exampleAPICallResponses)
 */

async function getAllAmbientWeatherIndices(client = require('./esClient')) {
  let clusterIndices;
  try {
    clusterIndices = await client.cat.indices({
      index: 'ambient_weather_heiligers_*',
      'format': 'json',
      bytes: 'kb',
      v: true,
      expand_wildcards: 'all',
    });
  } catch (err) {
    esClientLogger.logError('[getAllAmbientWeatherIndices] [ERROR]', err)
  }
  // v8: cat.indices() returns the array directly (no { body } wrapper).
  esClientLogger.logInfo('[getAllAmbientWeatherIndices] [SUCCESS]', clusterIndices);
  return clusterIndices;
}
/**
 * Discovers the ambient-weather aliases via the STRUCTURED alias API
 * (indices.getAlias) rather than the string-parsing _cat API.
 *
 * The structured response is keyed by index name, e.g.
 * {
 *   ambient_weather_heiligers_imperial_2021_06_12: {
 *     aliases: {
 *       'all-ambient-weather-heiligers-imperial': { is_write_index: true }
 *     }
 *   }
 * }
 * We flatten it back into the row array the callers expect so the return
 * contract is unchanged EXCEPT that `is_write_index` is now a real BOOLEAN
 * (the _cat API returned the string 'true'/'false'). When an alias entry
 * omits `is_write_index`, the structured API means "not the write index",
 * so we default it to `false`.
 *
 * @param {class} client: configured elasticsearch client
 * @returns array of objects containing { alias <string>, index <string>, is_write_index: <boolean> }
 * @example
 * [{
*   alias: 'all-ambient-weather-heiligers-imperial',
*   index: 'ambient_weather_heiligers_imperial_2021_06_12',
*   is_write_index: true
*  }]
 */
async function getAmbientWeatherAliases(client = require('./esClient')) {
  // Initialize to [] (not undefined) so a thrown getAlias call or a non-200
  // statusCode still returns an array. The consumer (Indexer.getActiveWriteIndices)
  // calls .filter() on this result with no guard; returning undefined on a transient
  // failure would throw a TypeError and silently kill the unattended cron run.
  let clusterAliasesResult = [];
  try {
    // v8: response is flattened. Request { meta: true } to keep the statusCode gate.
    const { body, statusCode } = await client.indices.getAlias({
      name: '*ambient-weather-heiligers-*',
      expand_wildcards: 'all'
    }, { meta: true });
    if (statusCode === 200) {
      clusterAliasesResult = [];
      // body is keyed by index name; each has an `aliases` map.
      for (const [index, indexEntry] of Object.entries(body)) {
        const aliases = (indexEntry && indexEntry.aliases) || {};
        for (const [alias, aliasMeta] of Object.entries(aliases)) {
          clusterAliasesResult.push({
            alias,
            index,
            // structured API returns a real boolean; omitted => not the write index
            is_write_index: (aliasMeta && aliasMeta.is_write_index) === true
          });
        }
      }
    }
  } catch (err) {
    esClientLogger.logError('[getAmbientWeatherAliases] [ERROR]', err)
  }
  esClientLogger.logInfo('[getAmbientWeatherAliases] [SUCCESS]', clusterAliasesResult)
  return clusterAliasesResult;
}
/* params:
* esClient = elastisearch client already configured
* indexName <string>, name of the index to create
* indexMappings <Object> mappings for the index
* returns:
*/
/**
 *
 * @param {Class} client elastisearch client already configured
 * @param {string} indexName
 * @param {object} indexMappings
 * @returns {object} { body, statusCode, headers, meta } where body is { acknowledged: <boolean>, shards_acknowledged: <boolean>, index: <string> }
 * @example see ./exampleAPICallResponses.js for more info
    body: { acknowledged: true, shards_acknowledged: true, index: 'tweets' },
    statusCode: 200,
    headers: {..., date: 'Tue, 04 Jan 2022 21:23:29 GMT'},
    meta: {...}
 */
async function createIndex(client = require('./esClient'), indexName, indexMappings) {
  let createIndexResult;
  try {
    // v8: request params are top-level (no nested `body`); `mappings` moves up.
    // `{ ignore: [400] }` remains a valid TransportRequestOptions second arg.
    createIndexResult = await client.indices.create({
      index: indexName,
      mappings: indexMappings
    }, { ignore: [400] }); // explicitly ignore 400, not 404. see https://github.com/elastic/elasticsearch-js/pull/927/files
  } catch (err) {
    if (!indexExistsError(err)) {
      esClientLogger.logError(`[createIndex] [ERROR] cannot create the index: ${indexName}`, err)
      throw err;
    } else {
      esClientLogger.logWarning(`[createIndex] [WARNING] index ${indexName} already exists`, err)
    }
  }
  esClientLogger.logInfo('[createIndex] [SUCCESS]', createIndexResult);
  return createIndexResult;
}

// params: esClient = elasticsearch client preconfigured, indexName <string>: name of the index to delete
/**
 *
 * @param {Class} client configured elasticsearch client
 * @param {string} indexName
 * @returns {object} body of es response
 * @example { acknowledged: true }
 */
async function deleteIndex(client = require('./esClient'), indexName) {
  let deleteResult;
  const deleteIndexDefaultArgs = {
    timeout: '30s',
    master_timeout: '30s',
    ignore_unavailable: false,
    allow_no_indices: false,
    expand_wildcards: 'open,closed'
  }
  try {
    deleteResult = await client.indices.delete({
      index: indexName,
      ...deleteIndexDefaultArgs,
    })
  } catch (err) {
    if (indexDoesNotExist(err)) {
      esClientLogger.logInfo('[deleteIndex] [INFO] index does not exist', err)
      return undefined;
    } else {
      esClientLogger.logError('[deleteIndex] [ERROR]', err)
      throw new Error('unhandled exception error from deleteIndex', err)
    }
  }
  // v8: indices.delete() returns the response directly (no { body } wrapper).
  esClientLogger.logInfo('[deleteIndex] [SUCCESS]', deleteResult)
  return deleteResult;
}

async function getMostRecentDoc(client = require('./esClient'), indexName, opts) {
  // esClientLogger.logInfo('indexName', indexName)
  if (opts && opts.sort && opts.sort.length > 0) {
    opts.sortReq = opts.sortBy.map((entry) => `${entry.field}:${entry.direction ?? 'asc'}`).join(',')
  }

  const searchConfig = {
    expand_wildcards: opts.expandWildcards ?? 'all', // for using wildcard expressions
    sort: opts.sortReq ?? ["dateutc:desc"], // default sort order is descending with the most recent doc first
    size: opts.size || 10,
    _source: opts._source ?? []
  };

  let searchResultBody;
  try {
    // v8: response is flattened (no { body }) and `query` is top-level (no nested `body`).
    const response = await client.search({
      ...searchConfig,
      index: indexName,
      query: {
        match_all: {}
      }
    });
    searchResultBody = response.hits.hits;
    // esClientLogger.logInfo('result of search request:', searchResultBody)
  } catch (err) {
    esClientLogger.logError('search request error:', err)
  }
  return searchResultBody;
  //implement me using esClient.search with decending order and retrieving only 1 doc.
}

/**
 * Search for documents within a date range
 * @param {Class} client configured elasticsearch client
 * @param {string} indexName index to search
 * @param {number} startDate start date in epoch milliseconds
 * @param {number} endDate end date in epoch milliseconds
 * @param {object} opts optional search configuration
 * @returns {array} search hits matching the date range
 */
async function searchDocsByDateRange(client = require('./esClient'), indexName, startDate, endDate, opts = {}) {
  const searchConfig = {
    expand_wildcards: opts.expandWildcards ?? 'all',
    sort: opts.sort ?? ["dateutc:asc"],
    size: opts.size || 1,
    _source: opts._source ?? ['date', 'dateutc', '@timestamp']
  };

  let searchResultBody;
  try {
    // v8: response is flattened (no { body }) and `query` is top-level (no nested `body`).
    const response = await client.search({
      ...searchConfig,
      index: indexName,
      query: {
        range: {
          dateutc: {
            gte: startDate,
            lte: endDate
          }
        }
      }
    });
    searchResultBody = response.hits.hits;
    esClientLogger.logInfo('[searchDocsByDateRange] found', searchResultBody.length, 'documents');
  } catch (err) {
    esClientLogger.logError('[searchDocsByDateRange] search request error:', err);
  }
  return searchResultBody;
}
/**
 *
 * @param {elasticsearch client} client
 * @param {string} indexName index to target and return counts from after bulk request is issued.
 * @param {array} payload preconfigured bulk payload
 * @param {obj} opts option bulk request options to pass to ES
 * @returns { obj } { indexCounts: <number> total number of documents in the target index, erroredDocuments: <array> documents that had an error with bulk operation}
 */

async function bulkIndexDocuments(client = require('./esClient'), indexName, payload, opts = {}) {
  let indexedDocs;
  let erroredDocuments = [];
  // add more configuration if needed later. See https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/8.0/api-reference.html#_bulk
  const bulkConfig = {
    ...opts,
    refresh: 'true',
  }
  const body = payload;
  // console.log('---------------->>>esClientMethods, bulkIndexDocuments, body(payload)', body)
  // v8: bulk operations are passed via top-level `operations`; response is flattened (no { body }).
  const bulkResponse = await client.bulk({ refresh: bulkConfig.refresh, operations: body });

  if (bulkResponse.errors) {
    // The items array has the same order of the dataset we just indexed.
    // The presence of the `error` key indicates that the operation
    // that we did for the document has failed.
    bulkResponse.items.forEach((action, i) => {
      const operation = Object.keys(action)[0]
      if (action[operation].error) {
        erroredDocuments.push({
          // If the status is 429 it means that you can retry the document,
          // otherwise it's very likely a mapping error, and you should
          // fix the document before to try it again.
          status: action[operation].status,
          error: action[operation].error,
          operation: body[i * 2],
          document: body[i * 2 + 1]
        })
      }
    })
  }
  // v8: count() returns the response directly (no { body } wrapper).
  const count = await client.count({ index: indexName })
  return { indexCounts: count, erroredDocuments }
}

const clientMethods = {
  getClusterInfo,
  pingCluster,
  getAllAmbientWeatherIndices,
  getAmbientWeatherAliases,
  createIndex,
  deleteIndex,
  getMostRecentDoc,
  bulkIndexDocuments
}
// clientMethods.getClusterInfo();
// clientMethods.pingCluster();
// clientMethods.getAllAmbientWeatherIndices();
// clientMethods.getClusterIndices();
// clientMethods.getAmbientWeatherAliases();
// clientMethods.getAmbientWeatherAliases();
// clientMethods.getMostRecentDoc(require('./esClient'), ['ambient_weather_heiligers_imperial_*', 'ambient_weather_heiligers_metric_*'], opts = { size: 4, _source: ['date', 'dateutc', '@timestamp'] })
// const testMappings = {
//   properties: {
//     id: { type: 'integer' },
//     text: { type: 'text' },
//     user: { type: 'keyword' },
//     time: { type: 'date' }
//   }
// }
// clientMethods.createIndex(require('./esClient'), 'tweets', testMappings)
// clientMethods.deleteIndex(require('./esClient'), 'tweets')
module.exports = { pingCluster, getAmbientWeatherAliases, createIndex, getMostRecentDoc, searchDocsByDateRange, deleteIndex, bulkIndexDocuments };


