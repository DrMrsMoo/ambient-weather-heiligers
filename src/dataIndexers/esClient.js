const { Client } = require('@elastic/elasticsearch');
const assert = require('assert');

/**
 * Creates an Elasticsearch client for the specified environment
 * @param {string} envPrefix - Environment prefix ('ES' for production, 'STAGING' for staging)
 * @returns {Client} Elasticsearch client instance
 */
function createEsClient(envPrefix = 'ES') {
  // Determine environment variable names based on prefix
  const cloudIdKey = envPrefix === 'ES' ? 'ES_CLOUD_ID' : `${envPrefix}_CLOUD_ID`;
  const usernameKey = envPrefix === 'ES' ? 'ES_USERNAME' : `${envPrefix}_ES_USERNAME`;
  const passwordKey = envPrefix === 'ES' ? 'ES_PASSWORD' : `${envPrefix}_ES_PASSWORD`;

  const envConfig = {
    cloud_id: process.env[cloudIdKey],
    username: process.env[usernameKey],
    password: process.env[passwordKey],
  }

  let missingEnvEntries = [];
  if (!envConfig.cloud_id) missingEnvEntries.push(cloudIdKey)
  if (!envConfig.username) missingEnvEntries.push(usernameKey)
  if (!envConfig.password) missingEnvEntries.push(passwordKey);

  assert.ok(envConfig.cloud_id, `${cloudIdKey} needs to be configured`);
  assert.ok(envConfig.username, `${usernameKey} needs to be configured`);
  assert.ok(envConfig.password, `${passwordKey} needs to be configured`);

  const client = new Client({
    cloud: {
      id: envConfig.cloud_id,
    },
    auth: {
      username: envConfig.username,
      password: envConfig.password
    }
  });
  return client;
}

module.exports = { createEsClient };
