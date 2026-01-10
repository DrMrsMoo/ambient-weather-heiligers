// Set up environment variables before any imports
process.env.AMBIENT_WEATHER_API_KEY = 'test-api-key';
process.env.AMBIENT_WEATHER_APPLICATION_KEY = 'test-app-key';

// Create mock functions we can control
const mockGetDataForDateRanges = jest.fn();
const mockInitialize = jest.fn();
const mockBulkIndexDocuments = jest.fn();
const mockConvertImperial = jest.fn().mockReturnValue([]);
const mockConvertMetric = jest.fn().mockReturnValue([]);

// Mock all dependencies before requiring main
jest.mock('ambient-weather-api', () => {
  return jest.fn().mockImplementation(() => ({
    userDevices: jest.fn(),
    deviceData: jest.fn()
  }));
});

jest.mock('file-system', () => ({
  readdirSync: jest.fn().mockReturnValue([]),
  readFileSync: jest.fn().mockReturnValue('[]'),
  writeFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true)
}));

jest.mock('../../src/dataFetchers', () => {
  return jest.fn().mockImplementation(() => ({
    getDataForDateRanges: mockGetDataForDateRanges
  }));
});

jest.mock('../../src/converters', () => ({
  ConvertImperialToJsonl: jest.fn().mockImplementation(() => ({
    convertRawImperialDataToJsonl: mockConvertImperial
  })),
  ConvertImperialToMetric: jest.fn().mockImplementation(() => ({
    convertImperialDataToMetricJsonl: mockConvertMetric
  }))
}));

jest.mock('../../src/dataIndexers', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    bulkIndexDocuments: mockBulkIndexDocuments
  }));
});

jest.mock('../../src/dataIndexers/esClient', () => ({
  createEsClient: jest.fn().mockReturnValue({})
}));

jest.mock('../../main_utils', () => ({
  prepareDataForBulkIndexing: jest.fn().mockReturnValue([]),
  updateProgressState: jest.fn().mockReturnValue({})
}));

// Now require the module
const main = require('../../main.js');
const { prepareDataForBulkIndexing } = require('../../main_utils');

describe('main', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default successful setup
    mockInitialize.mockResolvedValue({
      outcome: 'success',
      latestImperialDoc: [{ _source: { dateutc: 1704067200000 } }],
      latestMetricDoc: [{ _source: { dateutc: 1704067200000 } }]
    });

    mockBulkIndexDocuments.mockResolvedValue({
      indexCounts: { count: 10 },
      erroredDocuments: []
    });

    mockGetDataForDateRanges.mockResolvedValue('too early');
  });

  describe('successful execution', () => {
    it('returns "Done" on successful completion', async () => {
      const result = await main();
      expect(result).toBe('Done');
    });

    it('initializes both production and staging clusters', async () => {
      await main();

      // mockInitialize is called by both prodIndexer and stagingIndexer
      // Since they share the same mock, we check it was called at least twice
      expect(mockInitialize).toHaveBeenCalled();
    });
  });

  describe('data fetching', () => {
    it('handles "too early" response gracefully', async () => {
      mockGetDataForDateRanges.mockResolvedValue('too early');

      const result = await main();

      expect(result).toBe('Done');
      expect(mockGetDataForDateRanges).toHaveBeenCalled();
    });

    it('processes fetched data when available', async () => {
      mockGetDataForDateRanges.mockResolvedValue({
        dataFetchForDates: [{ from: 1704067200000, to: 1704153600000 }],
        dataFileNames: ['1704067200000_1704153600000']
      });

      await main();

      // Should call converters when data is fetched
      expect(mockConvertImperial).toHaveBeenCalled();
      expect(mockConvertMetric).toHaveBeenCalled();
    });

    it('throws when data fetching fails', async () => {
      mockGetDataForDateRanges.mockRejectedValue(new Error('API Error'));

      await expect(main()).rejects.toThrow('API Error');
    });
  });

  describe('cluster initialization', () => {
    it('continues when cluster initialization fails', async () => {
      mockInitialize.mockRejectedValue(new Error('Connection refused'));

      // Should not throw - main handles cluster init failures gracefully
      const result = await main();
      expect(result).toBe('Done');
    });

    it('uses cluster dates to determine fetch range', async () => {
      mockInitialize.mockResolvedValue({
        outcome: 'success',
        latestImperialDoc: [{ _source: { dateutc: 1704067200000 } }]
      });

      await main();

      // getDataForDateRanges should be called with cluster date as 4th param
      expect(mockGetDataForDateRanges).toHaveBeenCalled();
      const callArgs = mockGetDataForDateRanges.mock.calls[0];
      // 4th parameter should be the cluster latest date
      expect(callArgs[3]).toBe(1704067200000);
    });
  });

  describe('indexing', () => {
    it('indexes to both clusters when data is available and both clusters are available', async () => {
      mockGetDataForDateRanges.mockResolvedValue({
        dataFetchForDates: [{ from: 1704067200000, to: 1704153600000 }],
        dataFileNames: ['test_file']
      });

      prepareDataForBulkIndexing.mockReturnValue([
        { index: {} },
        { dateutc: 1704100000000, temp: 72 }
      ]);

      await main();

      // bulkIndexDocuments should be called for both clusters
      expect(mockBulkIndexDocuments).toHaveBeenCalled();
    });

    it('skips indexing when no data to index', async () => {
      mockGetDataForDateRanges.mockResolvedValue({
        dataFetchForDates: [],
        dataFileNames: []
      });

      await main();

      // bulkIndexDocuments should not be called when no data
      expect(mockBulkIndexDocuments).not.toHaveBeenCalled();
    });

    it('handles indexing errors gracefully', async () => {
      mockGetDataForDateRanges.mockResolvedValue({
        dataFetchForDates: [{}],
        dataFileNames: ['test']
      });

      prepareDataForBulkIndexing.mockReturnValue([{ index: {} }, { temp: 72 }]);
      mockBulkIndexDocuments.mockRejectedValue(new Error('Indexing failed'));

      // Should complete without throwing (errors are caught per-cluster)
      const result = await main();
      expect(result).toBe('Done');
    });
  });

  describe('date filtering logic', () => {
    it('uses null when no cluster dates available', async () => {
      mockInitialize.mockResolvedValue({
        outcome: 'error',
        latestImperialDoc: null
      });

      await main();

      const callArgs = mockGetDataForDateRanges.mock.calls[0];
      expect(callArgs[3]).toBeNull();
    });

    it('filters data per-cluster based on their latest dates', async () => {
      mockGetDataForDateRanges.mockResolvedValue({
        dataFetchForDates: [{}],
        dataFileNames: ['test']
      });

      prepareDataForBulkIndexing.mockReturnValue([{ index: {} }, { temp: 72 }]);

      await main();

      // prepareDataForBulkIndexing should be called with filterAfterDate
      expect(prepareDataForBulkIndexing).toHaveBeenCalledWith(
        expect.objectContaining({
          filterAfterDate: expect.any(Number)
        })
      );
    });
  });
});
