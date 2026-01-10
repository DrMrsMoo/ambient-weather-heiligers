const {
  pingCluster,
  getAmbientWeatherAliases,
  createIndex,
  getMostRecentDoc,
  searchDocsByDateRange,
  deleteIndex,
  bulkIndexDocuments
} = require('./esClientMethods');

describe('esClientMethods', () => {
  let mockClient;

  beforeEach(() => {
    // Create a fresh mock client for each test
    mockClient = {
      ping: jest.fn(),
      info: jest.fn(),
      search: jest.fn(),
      bulk: jest.fn(),
      count: jest.fn(),
      cat: {
        indices: jest.fn(),
        aliases: jest.fn()
      },
      indices: {
        create: jest.fn(),
        delete: jest.fn()
      }
    };
  });

  describe('pingCluster', () => {
    it('returns true when cluster is reachable', async () => {
      mockClient.ping.mockResolvedValue({ body: true });

      const result = await pingCluster(mockClient);

      expect(result).toBe(true);
      expect(mockClient.ping).toHaveBeenCalledTimes(1);
    });

    it('returns false when cluster is not reachable', async () => {
      mockClient.ping.mockResolvedValue({ body: false });

      const result = await pingCluster(mockClient);

      expect(result).toBe(false);
    });

    it('throws when ping fails (pingResult is undefined)', async () => {
      mockClient.ping.mockRejectedValue(new Error('Connection refused'));

      // Note: Current implementation has a bug - tries to access body on undefined
      // This test documents the current behavior
      await expect(pingCluster(mockClient)).rejects.toThrow();
    });
  });

  describe('getAmbientWeatherAliases', () => {
    it('returns aliases when successful', async () => {
      const mockAliases = [
        { alias: 'all-ambient-weather-heiligers-imperial', index: 'ambient_weather_heiligers_imperial_2024_01', is_write_index: 'true' },
        { alias: 'all-ambient-weather-heiligers-metric', index: 'ambient_weather_heiligers_metric_2024_01', is_write_index: 'true' }
      ];

      mockClient.cat.aliases.mockResolvedValue({
        body: mockAliases,
        statusCode: 200
      });

      const result = await getAmbientWeatherAliases(mockClient);

      expect(result).toEqual(mockAliases);
      expect(mockClient.cat.aliases).toHaveBeenCalledWith({
        name: '*ambient-weather-heiligers-*',
        format: 'json',
        h: ['alias', 'index', 'is_write_index'],
        v: true,
        expand_wildcards: 'all'
      });
    });

    it('returns undefined on non-200 status code', async () => {
      mockClient.cat.aliases.mockResolvedValue({
        body: [],
        statusCode: 404
      });

      const result = await getAmbientWeatherAliases(mockClient);

      expect(result).toBeUndefined();
    });

    it('handles errors gracefully', async () => {
      mockClient.cat.aliases.mockRejectedValue(new Error('Network error'));

      const result = await getAmbientWeatherAliases(mockClient);

      expect(result).toBeUndefined();
    });
  });

  describe('createIndex', () => {
    const testIndexName = 'test_index';
    const testMappings = {
      properties: {
        dateutc: { type: 'long' },
        temp: { type: 'float' }
      }
    };

    it('creates index successfully', async () => {
      const mockResponse = {
        body: { acknowledged: true, shards_acknowledged: true, index: testIndexName },
        statusCode: 200
      };
      mockClient.indices.create.mockResolvedValue(mockResponse);

      const result = await createIndex(mockClient, testIndexName, testMappings);

      expect(result).toEqual(mockResponse);
      expect(mockClient.indices.create).toHaveBeenCalledWith(
        {
          index: testIndexName,
          body: { mappings: testMappings }
        },
        { ignore: [400] }
      );
    });

    it('handles index already exists error gracefully', async () => {
      // The indexExistsError function requires a ResponseError with specific properties
      const { errors } = require('@elastic/elasticsearch');
      const existsError = new errors.ResponseError({
        body: { status: 400 },
        statusCode: 400,
        headers: {},
        meta: { body: { status: 400 } }
      });
      existsError.message = '[resource_already_exists_exception] index already exists';
      existsError.meta = { body: { status: 400 } };

      mockClient.indices.create.mockRejectedValue(existsError);

      // Should not throw for "already exists" error
      const result = await createIndex(mockClient, testIndexName, testMappings);

      expect(result).toBeUndefined();
    });

    it('throws on unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected error');
      unexpectedError.meta = { body: { error: { type: 'unknown_error' } } };
      mockClient.indices.create.mockRejectedValue(unexpectedError);

      await expect(createIndex(mockClient, testIndexName, testMappings)).rejects.toThrow('Unexpected error');
    });
  });

  describe('deleteIndex', () => {
    it('deletes index successfully', async () => {
      mockClient.indices.delete.mockResolvedValue({
        body: { acknowledged: true }
      });

      const result = await deleteIndex(mockClient, 'test_index');

      expect(result).toEqual({ acknowledged: true });
      expect(mockClient.indices.delete).toHaveBeenCalledWith(expect.objectContaining({
        index: 'test_index',
        timeout: '30s',
        master_timeout: '30s'
      }));
    });

    it('throws when index does not exist (bug: tries to access body on undefined)', async () => {
      // The indexDoesNotExist function requires a ResponseError with specific properties
      const { errors } = require('@elastic/elasticsearch');
      const notFoundError = new errors.ResponseError({
        body: { status: 404 },
        statusCode: 404,
        headers: {},
        meta: { body: { status: 404 } }
      });
      notFoundError.message = '[index_not_found_exception] no such index';
      notFoundError.meta = { body: { status: 404 } };

      mockClient.indices.delete.mockRejectedValue(notFoundError);

      // Note: Current implementation has a bug - catches the error but then
      // tries to access deleteResult.body when deleteResult is undefined
      // This test documents the current behavior
      await expect(deleteIndex(mockClient, 'nonexistent_index')).rejects.toThrow();
    });

    it('throws on unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected error');
      unexpectedError.meta = { body: { error: { type: 'unknown_error' } } };
      mockClient.indices.delete.mockRejectedValue(unexpectedError);

      await expect(deleteIndex(mockClient, 'test_index')).rejects.toThrow();
    });
  });

  describe('getMostRecentDoc', () => {
    it('returns most recent documents with default options', async () => {
      const mockHits = [
        { _source: { dateutc: 1704067200000, temp: 72 } },
        { _source: { dateutc: 1704063600000, temp: 71 } }
      ];

      mockClient.search.mockResolvedValue({
        body: { hits: { hits: mockHits } }
      });

      const result = await getMostRecentDoc(mockClient, 'test_index', {});

      expect(result).toEqual(mockHits);
      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        index: 'test_index',
        sort: ['dateutc:desc'],
        size: 10
      }));
    });

    it('respects custom size option', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] } }
      });

      await getMostRecentDoc(mockClient, 'test_index', { size: 5 });

      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        size: 5
      }));
    });

    it('respects custom _source option', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] } }
      });

      await getMostRecentDoc(mockClient, 'test_index', { _source: ['dateutc', 'temp'] });

      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        _source: ['dateutc', 'temp']
      }));
    });

    it('handles search errors gracefully', async () => {
      mockClient.search.mockRejectedValue(new Error('Search failed'));

      const result = await getMostRecentDoc(mockClient, 'test_index', {});

      expect(result).toBeUndefined();
    });
  });

  describe('searchDocsByDateRange', () => {
    const startDate = 1704067200000; // 2024-01-01
    const endDate = 1704153600000;   // 2024-01-02

    it('searches for documents within date range', async () => {
      const mockHits = [
        { _source: { dateutc: 1704100000000, date: '2024-01-01T12:00:00Z' } }
      ];

      mockClient.search.mockResolvedValue({
        body: { hits: { hits: mockHits } }
      });

      const result = await searchDocsByDateRange(mockClient, 'test_index', startDate, endDate);

      expect(result).toEqual(mockHits);
      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        index: 'test_index',
        body: {
          query: {
            range: {
              dateutc: {
                gte: startDate,
                lte: endDate
              }
            }
          }
        }
      }));
    });

    it('uses default options when not specified', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] } }
      });

      await searchDocsByDateRange(mockClient, 'test_index', startDate, endDate);

      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        expand_wildcards: 'all',
        sort: ['dateutc:asc'],
        size: 1,
        _source: ['date', 'dateutc', '@timestamp']
      }));
    });

    it('respects custom options', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] } }
      });

      const opts = {
        size: 100,
        sort: ['dateutc:desc'],
        _source: ['dateutc', 'temp', 'humidity'],
        expandWildcards: 'open'
      };

      await searchDocsByDateRange(mockClient, 'test_index', startDate, endDate, opts);

      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        expand_wildcards: 'open',
        sort: ['dateutc:desc'],
        size: 100,
        _source: ['dateutc', 'temp', 'humidity']
      }));
    });

    it('returns empty array when no documents found', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] } }
      });

      const result = await searchDocsByDateRange(mockClient, 'test_index', startDate, endDate);

      expect(result).toEqual([]);
    });

    it('handles search errors gracefully', async () => {
      mockClient.search.mockRejectedValue(new Error('Search failed'));

      const result = await searchDocsByDateRange(mockClient, 'test_index', startDate, endDate);

      expect(result).toBeUndefined();
    });

    it('supports wildcard index patterns', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] } }
      });

      await searchDocsByDateRange(mockClient, 'ambient_weather_*', startDate, endDate);

      expect(mockClient.search).toHaveBeenCalledWith(expect.objectContaining({
        index: 'ambient_weather_*'
      }));
    });
  });

  describe('bulkIndexDocuments', () => {
    const testPayload = [
      { index: { _index: 'test_index' } },
      { dateutc: 1704067200000, temp: 72 },
      { index: { _index: 'test_index' } },
      { dateutc: 1704070800000, temp: 73 }
    ];

    it('indexes documents successfully', async () => {
      mockClient.bulk.mockResolvedValue({
        body: { errors: false, items: [] }
      });
      mockClient.count.mockResolvedValue({
        body: { count: 2 }
      });

      const result = await bulkIndexDocuments(mockClient, 'test_index', testPayload);

      expect(result.indexCounts).toEqual({ count: 2 });
      expect(result.erroredDocuments).toEqual([]);
      expect(mockClient.bulk).toHaveBeenCalledWith({
        refresh: 'true',
        body: testPayload
      });
    });

    it('captures errored documents', async () => {
      const bulkResponse = {
        errors: true,
        items: [
          { index: { status: 201 } },
          { index: { status: 400, error: { type: 'mapper_parsing_exception' } } }
        ]
      };

      mockClient.bulk.mockResolvedValue({ body: bulkResponse });
      mockClient.count.mockResolvedValue({ body: { count: 1 } });

      const result = await bulkIndexDocuments(mockClient, 'test_index', testPayload);

      expect(result.erroredDocuments).toHaveLength(1);
      expect(result.erroredDocuments[0].status).toBe(400);
      expect(result.erroredDocuments[0].error.type).toBe('mapper_parsing_exception');
    });

    it('returns index count after bulk operation', async () => {
      mockClient.bulk.mockResolvedValue({
        body: { errors: false, items: [] }
      });
      mockClient.count.mockResolvedValue({
        body: { count: 1000 }
      });

      const result = await bulkIndexDocuments(mockClient, 'test_index', testPayload);

      expect(mockClient.count).toHaveBeenCalledWith({ index: 'test_index' });
      expect(result.indexCounts.count).toBe(1000);
    });

    it('handles empty payload', async () => {
      mockClient.bulk.mockResolvedValue({
        body: { errors: false, items: [] }
      });
      mockClient.count.mockResolvedValue({
        body: { count: 0 }
      });

      const result = await bulkIndexDocuments(mockClient, 'test_index', []);

      expect(result.indexCounts.count).toBe(0);
      expect(result.erroredDocuments).toEqual([]);
    });
  });
});
