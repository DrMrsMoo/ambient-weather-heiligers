const IndexData = require('./Indexer');

// Mock the esClientMethods
jest.mock('./esClientMethods', () => ({
  pingCluster: jest.fn(),
  getAmbientWeatherAliases: jest.fn(),
  getMostRecentDoc: jest.fn(),
  createIndex: jest.fn(),
  deleteIndex: jest.fn(),
  bulkIndexDocuments: jest.fn()
}));

const {
  pingCluster,
  getAmbientWeatherAliases,
  getMostRecentDoc,
  bulkIndexDocuments
} = require('./esClientMethods');

describe('IndexData', () => {
  let mockClient;
  let indexer;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      ping: jest.fn(),
      search: jest.fn(),
      bulk: jest.fn()
    };

    indexer = new IndexData(mockClient);
  });

  describe('constructor', () => {
    it('initializes with ES client', () => {
      expect(indexer.client).toBe(mockClient);
    });

    it('initializes with empty dataToIndex', () => {
      expect(indexer.dataToIndex).toEqual([]);
    });

    it('initializes with empty currentWriteIndices', () => {
      expect(indexer.currentWriteIndices).toEqual([]);
    });
  });

  describe('getters and setters', () => {
    describe('dataToIndex', () => {
      it('sets and gets data array', () => {
        const testData = [{ temp: 72 }, { temp: 73 }];
        indexer.dataToIndex = testData;
        expect(indexer.dataToIndex).toEqual(testData);
      });

      it('wraps single item in array', () => {
        indexer.dataToIndex = { temp: 72 };
        expect(indexer.dataToIndex).toEqual([{ temp: 72 }]);
      });
    });

    describe('currentWriteIndices', () => {
      it('sets and gets indices array', () => {
        const indices = ['index_imperial_2024', 'index_metric_2024'];
        indexer.currentWriteIndices = indices;
        expect(indexer.currentWriteIndices).toEqual(indices);
      });

      it('wraps single index in array', () => {
        indexer.currentWriteIndices = 'single_index';
        expect(indexer.currentWriteIndices).toEqual(['single_index']);
      });
    });

    describe('dateOflatestIndexedMetricDoc', () => {
      it('sets and gets metric date', () => {
        indexer.dateOflatestIndexedMetricDoc = '2024-01-15';
        expect(indexer.dateOflatestIndexedMetricDoc).toBe('2024-01-15');
      });
    });

    describe('dateOflatestIndexedImperialDoc', () => {
      it('sets and gets imperial date', () => {
        indexer.dateOflatestIndexedImperialDoc = '2024-01-15';
        expect(indexer.dateOflatestIndexedImperialDoc).toBe('2024-01-15');
      });
    });
  });

  describe('ensureConnection', () => {
    it('returns true when cluster is reachable', async () => {
      pingCluster.mockResolvedValue(true);

      const result = await indexer.ensureConnection();

      expect(result).toBe(true);
      expect(pingCluster).toHaveBeenCalledWith(mockClient);
    });

    it('returns false when cluster is not reachable', async () => {
      pingCluster.mockResolvedValue(false);

      const result = await indexer.ensureConnection();

      expect(result).toBe(false);
    });
  });

  describe('getActiveWriteIndices', () => {
    it('returns and stores write indices', async () => {
      const mockAliases = [
        { alias: 'all-imperial', index: 'ambient_weather_heiligers_imperial_2024_01', is_write_index: 'true' },
        { alias: 'all-imperial', index: 'ambient_weather_heiligers_imperial_2023_12', is_write_index: 'false' },
        { alias: 'all-metric', index: 'ambient_weather_heiligers_metric_2024_01', is_write_index: 'true' }
      ];

      getAmbientWeatherAliases.mockResolvedValue(mockAliases);

      const result = await indexer.getActiveWriteIndices();

      expect(result).toEqual([
        'ambient_weather_heiligers_imperial_2024_01',
        'ambient_weather_heiligers_metric_2024_01'
      ]);
      expect(indexer.currentWriteIndices).toEqual([
        'ambient_weather_heiligers_imperial_2024_01',
        'ambient_weather_heiligers_metric_2024_01'
      ]);
    });

    it('returns undefined when no write indices found', async () => {
      const mockAliases = [
        { alias: 'all-imperial', index: 'old_index', is_write_index: 'false' }
      ];

      getAmbientWeatherAliases.mockResolvedValue(mockAliases);

      const result = await indexer.getActiveWriteIndices();

      expect(result).toBeUndefined();
    });

    it('handles empty aliases response', async () => {
      getAmbientWeatherAliases.mockResolvedValue([]);

      const result = await indexer.getActiveWriteIndices();

      expect(result).toBeUndefined();
    });
  });

  describe('getMostRecentIndexedDocuments', () => {
    beforeEach(() => {
      indexer.currentWriteIndices = [
        'ambient_weather_heiligers_imperial_2024_01',
        'ambient_weather_heiligers_metric_2024_01'
      ];
    });

    it('returns most recent documents for both indices', async () => {
      const mockImperialDoc = [{
        _index: 'ambient_weather_heiligers_imperial_2024_01',
        _source: { dateutc: 1704067200000, date: '2024-01-01T00:00:00Z' }
      }];
      const mockMetricDoc = [{
        _index: 'ambient_weather_heiligers_metric_2024_01',
        _source: { dateutc: 1704067200000, date: '2024-01-01T00:00:00Z' }
      }];

      getMostRecentDoc
        .mockResolvedValueOnce(mockMetricDoc)
        .mockResolvedValueOnce(mockImperialDoc);

      const result = await indexer.getMostRecentIndexedDocuments();

      expect(result.latestImperialDoc).toEqual(mockImperialDoc);
      expect(result.latestMetricDoc).toEqual(mockMetricDoc);
      expect(indexer.dateOflatestIndexedMetricDoc).toBe(1704067200000);
      expect(indexer.dateOflatestIndexedImperialDoc).toBe(1704067200000);
    });

    it('calls getMostRecentDoc with correct parameters', async () => {
      const mockDoc = [{ _source: { dateutc: 1704067200000 } }];
      getMostRecentDoc.mockResolvedValue(mockDoc);

      await indexer.getMostRecentIndexedDocuments();

      expect(getMostRecentDoc).toHaveBeenCalledWith(
        mockClient,
        'ambient_weather_heiligers_metric_2024_01',
        expect.objectContaining({
          size: 1,
          _source: ['date', 'dateutc', '@timestamp'],
          expandWildcards: 'all'
        })
      );
    });
  });

  describe('bulkIndexDocuments', () => {
    beforeEach(() => {
      indexer.currentWriteIndices = [
        'ambient_weather_heiligers_imperial_2024_01',
        'ambient_weather_heiligers_metric_2024_01'
      ];
    });

    it('indexes imperial data to imperial index', async () => {
      const payload = [
        { index: {} },
        { dateutc: 1704067200000, temp: 72 }
      ];
      const mockResult = { indexCounts: { count: 100 }, erroredDocuments: [] };

      bulkIndexDocuments.mockResolvedValue(mockResult);

      const result = await indexer.bulkIndexDocuments(payload, 'imperial');

      expect(result).toEqual(mockResult);
      expect(bulkIndexDocuments).toHaveBeenCalledWith(
        mockClient,
        'ambient_weather_heiligers_imperial_2024_01',
        payload
      );
    });

    it('indexes metric data to metric index', async () => {
      const payload = [
        { index: {} },
        { dateutc: 1704067200000, tempC: 22 }
      ];
      const mockResult = { indexCounts: { count: 100 }, erroredDocuments: [] };

      bulkIndexDocuments.mockResolvedValue(mockResult);

      const result = await indexer.bulkIndexDocuments(payload, 'metric');

      expect(result).toEqual(mockResult);
      expect(bulkIndexDocuments).toHaveBeenCalledWith(
        mockClient,
        'ambient_weather_heiligers_metric_2024_01',
        payload
      );
    });

    it('returns errored documents when bulk has errors', async () => {
      const mockResult = {
        indexCounts: { count: 99 },
        erroredDocuments: [{ status: 400, error: { type: 'mapper_parsing_exception' } }]
      };

      bulkIndexDocuments.mockResolvedValue(mockResult);

      const result = await indexer.bulkIndexDocuments([], 'imperial');

      expect(result.erroredDocuments).toHaveLength(1);
    });
  });

  describe('initialize', () => {
    it('returns success when cluster is reachable and has write indices', async () => {
      pingCluster.mockResolvedValue(true);
      getAmbientWeatherAliases.mockResolvedValue([
        { alias: 'all-imperial', index: 'imperial_2024', is_write_index: 'true' },
        { alias: 'all-metric', index: 'metric_2024', is_write_index: 'true' }
      ]);
      getMostRecentDoc.mockResolvedValue([{
        _source: { dateutc: 1704067200000, date: '2024-01-01' }
      }]);

      const result = await indexer.initialize();

      expect(result.outcome).toBe('success');
      expect(result.latestImperialDoc).toBeDefined();
      expect(result.latestMetricDoc).toBeDefined();
    });

    it('returns no connection when cluster ping fails', async () => {
      pingCluster.mockResolvedValue(false);

      const result = await indexer.initialize();

      expect(result).toBe('no connection');
      expect(getAmbientWeatherAliases).not.toHaveBeenCalled();
    });

    it('returns error when no write indices found', async () => {
      pingCluster.mockResolvedValue(true);
      getAmbientWeatherAliases.mockResolvedValue([]);

      const result = await indexer.initialize();

      expect(result.outcome).toContain('error');
      expect(result.latestImperialDoc).toBeNull();
      expect(result.latestMetricDoc).toBeNull();
    });

    it('calls methods in correct order', async () => {
      pingCluster.mockResolvedValue(true);
      getAmbientWeatherAliases.mockResolvedValue([
        { alias: 'all-imperial', index: 'imperial_2024', is_write_index: 'true' },
        { alias: 'all-metric', index: 'metric_2024', is_write_index: 'true' }
      ]);
      getMostRecentDoc.mockResolvedValue([{
        _source: { dateutc: 1704067200000 }
      }]);

      await indexer.initialize();

      // Verify call order
      const pingOrder = pingCluster.mock.invocationCallOrder[0];
      const aliasOrder = getAmbientWeatherAliases.mock.invocationCallOrder[0];
      const docOrder = getMostRecentDoc.mock.invocationCallOrder[0];

      expect(pingOrder).toBeLessThan(aliasOrder);
      expect(aliasOrder).toBeLessThan(docOrder);
    });
  });
});
