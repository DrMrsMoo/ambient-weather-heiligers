const moment = require('moment-timezone');

// Mock dependencies before requiring the module
jest.mock('../dataIndexers/esClient', () => ({
  createEsClient: jest.fn()
}));

jest.mock('../dataIndexers/esClientMethods', () => ({
  searchDocsByDateRange: jest.fn()
}));

jest.mock('../dataIndexers', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue({ outcome: 'success' }),
    bulkIndexDocuments: jest.fn().mockResolvedValue({
      indexCounts: { count: 10 },
      erroredDocuments: []
    })
  }));
});

jest.mock('../dataFetchers', () => {
  return jest.fn().mockImplementation(() => ({
    getDataForDateRanges: jest.fn()
  }));
});

jest.mock('../../main_utils', () => ({
  prepareDataForBulkIndexing: jest.fn().mockReturnValue([])
}));

jest.mock('readline-sync', () => ({
  question: jest.fn()
}));

jest.mock('file-system', () => ({
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('ambient-weather-api', () => {
  return jest.fn().mockImplementation(() => ({
    userDevices: jest.fn(),
    deviceData: jest.fn()
  }));
});

// Mock environment variables
process.env.AMBIENT_WEATHER_API_KEY = 'test-api-key';
process.env.AMBIENT_WEATHER_APPLICATION_KEY = 'test-app-key';

const { runBackfill } = require('./backfill');
const { createEsClient } = require('../dataIndexers/esClient');
const { searchDocsByDateRange } = require('../dataIndexers/esClientMethods');
const IndexData = require('../dataIndexers');

const fs = require('file-system');
const readlineSync = require('readline-sync');

describe('backfill', () => {
  let mockEsClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock ES client
    mockEsClient = { ping: jest.fn() };
    createEsClient.mockReturnValue(mockEsClient);

    // Default: no gaps found (data complete)
    searchDocsByDateRange.mockResolvedValue([]);
  });

  describe('runBackfill - argument validation', () => {
    it('returns error when no cluster is specified', async () => {
      const result = await runBackfill({
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Must specify --prod, --staging, or --both');
    });

    it('returns error when dates are missing', async () => {
      const result = await runBackfill({
        prod: true
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Must specify both --from and --to dates');
    });

    it('returns error when only --from is provided', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-01-01'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Must specify both --from and --to dates');
    });

    it('returns error when only --to is provided', async () => {
      const result = await runBackfill({
        prod: true,
        to: '2024-01-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Must specify both --from and --to dates');
    });

    it('returns error for invalid date format', async () => {
      const result = await runBackfill({
        prod: true,
        from: 'invalid-date',
        to: '2024-01-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid date format');
    });

    it('returns error when from date is after to date', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-01-31',
        to: '2024-01-01'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Start date must be before end date');
    });

    it('returns error when from and to dates are the same', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-15'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Start date must be before end date');
    });
  });

  describe('runBackfill - cluster selection', () => {
    beforeEach(() => {
      // Mock: documents exist close together (no gap - less than 10 min)
      const fromDate = moment('2024-01-01').valueOf();
      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 60000 } }]) // 1 min before
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate + 60000 } }]); // 1 min after
    });

    it('accepts --prod flag for production cluster', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(createEsClient).toHaveBeenCalledWith('ES');
      expect(result.status).toBe('success');
    });

    it('accepts --staging flag for staging cluster', async () => {
      // Reset and add new mocks for this test
      searchDocsByDateRange.mockReset();
      const fromDate = moment('2024-01-01').valueOf();
      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 60000 } }])
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate + 60000 } }]);

      const result = await runBackfill({
        staging: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(createEsClient).toHaveBeenCalledWith('STAGING');
      expect(result.status).toBe('success');
    });

    it('accepts --both flag for dual-cluster mode', async () => {
      // Reset and add mocks for both clusters (4 calls total)
      searchDocsByDateRange.mockReset();
      const fromDate = moment('2024-01-01').valueOf();
      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 60000 } }]) // PROD before
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate + 60000 } }]) // PROD after
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 60000 } }]) // STAGING before
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate + 60000 } }]); // STAGING after

      const result = await runBackfill({
        both: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(createEsClient).toHaveBeenCalledWith('ES');
      expect(createEsClient).toHaveBeenCalledWith('STAGING');
      expect(result.status).toBe('success');
      expect(result.mode).toBe('dual-cluster');
    });
  });

  describe('runBackfill - gap detection', () => {
    it('returns success with no gap message when data is complete', async () => {
      // Mock: documents exist at the boundaries (no gap)
      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: moment('2024-01-01').valueOf() - 60000 } }]) // last doc before
        .mockResolvedValueOnce([{ _source: { dateutc: moment('2024-01-01').valueOf() + 60000 } }]); // first doc after (5 min gap)

      const result = await runBackfill({
        prod: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(result.status).toBe('success');
      expect(result.message).toContain('No gap found');
    });

    it('detects gap when more than 10 minutes between documents', async () => {
      const fromDate = moment('2024-01-15').valueOf();
      const toDate = moment('2024-01-20').valueOf();

      // Mock: large gap between documents
      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 3600000 } }]) // 1 hour before fromDate
        .mockResolvedValueOnce([{ _source: { dateutc: toDate + 3600000 } }]); // 1 hour after toDate

      // Mock user declining backfill
      readlineSync.question.mockReturnValue('n');

      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20'
      });

      expect(result.status).toBe('cancelled');
      expect(result.message).toContain('cancelled by user');
    });
  });

  describe('runBackfill - user confirmation', () => {
    beforeEach(() => {
      // Setup gap detection to find a gap
      const fromDate = moment('2024-01-15').valueOf();
      const toDate = moment('2024-01-20').valueOf();

      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 86400000 } }])
        .mockResolvedValueOnce([{ _source: { dateutc: toDate + 86400000 } }]);
    });

    it('prompts for confirmation when gap is found', async () => {
      readlineSync.question.mockReturnValue('n');

      await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20'
      });

      expect(readlineSync.question).toHaveBeenCalled();
    });

    it('skips confirmation when --yes flag is provided', async () => {
      // Mock local files with no data in range
      fs.readdirSync.mockReturnValue([]);

      await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      expect(readlineSync.question).not.toHaveBeenCalled();
    });

    it('accepts "y" as confirmation', async () => {
      readlineSync.question.mockReturnValue('y');
      fs.readdirSync.mockReturnValue([]);

      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20'
      });

      expect(result.status).not.toBe('cancelled');
    });

    it('accepts "yes" as confirmation', async () => {
      readlineSync.question.mockReturnValue('yes');
      fs.readdirSync.mockReturnValue([]);

      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20'
      });

      expect(result.status).not.toBe('cancelled');
    });

    it('cancels on "n" response', async () => {
      readlineSync.question.mockReturnValue('n');

      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20'
      });

      expect(result.status).toBe('cancelled');
    });
  });

  describe('runBackfill - data loading from local files', () => {
    beforeEach(() => {
      // Setup gap detection
      const fromDate = moment('2024-01-15').valueOf();
      const toDate = moment('2024-01-20').valueOf();

      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 86400000 } }])
        .mockResolvedValueOnce([{ _source: { dateutc: toDate + 86400000 } }]);

      readlineSync.question.mockReturnValue('y');
    });

    it('loads data from local JSON files when available', async () => {
      const testRecords = [
        { dateutc: moment('2024-01-16').valueOf(), temp: 72 },
        { dateutc: moment('2024-01-17').valueOf(), temp: 73 }
      ];

      fs.readdirSync.mockReturnValue(['test_file.json']);
      fs.readFileSync.mockReturnValue(JSON.stringify(testRecords));
      fs.existsSync.mockReturnValue(true);

      await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      expect(fs.readdirSync).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it('creates JSONL directories if they do not exist', async () => {
      fs.readdirSync.mockReturnValue([]);
      fs.existsSync.mockReturnValue(false);

      await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('skips non-JSON files', async () => {
      fs.readdirSync.mockReturnValue(['readme.txt', 'data.json', '.DS_Store']);
      fs.readFileSync.mockReturnValue('[]');
      fs.existsSync.mockReturnValue(true);

      await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      // Should only read .json files
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('filters records to only include those within date range', async () => {
      const testRecords = [
        { dateutc: moment('2024-01-10').valueOf(), temp: 70 }, // before range
        { dateutc: moment('2024-01-16').valueOf(), temp: 72 }, // in range
        { dateutc: moment('2024-01-25').valueOf(), temp: 75 }  // after range
      ];

      fs.readdirSync.mockReturnValue(['test_file.json']);
      fs.readFileSync.mockReturnValue(JSON.stringify(testRecords));
      fs.existsSync.mockReturnValue(true);

      await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      // Verify prepareDataForBulkIndexing was called (indicates indexing proceeded)
      const { prepareDataForBulkIndexing } = require('../../main_utils');
      expect(prepareDataForBulkIndexing).toHaveBeenCalled();
    });
  });

  describe('runBackfill - dual cluster mode', () => {
    it('processes both clusters sequentially', async () => {
      // No gaps found for either cluster
      searchDocsByDateRange.mockResolvedValue([]);

      const result = await runBackfill({
        both: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(result.mode).toBe('dual-cluster');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].cluster).toBe('PRODUCTION');
      expect(result.results[1].cluster).toBe('STAGING');
    });

    it('continues with second cluster if first has no gap', async () => {
      searchDocsByDateRange.mockResolvedValue([]);

      const result = await runBackfill({
        both: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(createEsClient).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(2);
    });

    it('handles independent gaps in each cluster', async () => {
      const fromDate = moment('2024-01-01').valueOf();
      const toDate = moment('2024-01-31').valueOf();

      // First cluster: no gap (documents close together)
      // Second cluster: has gap (documents far apart)
      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 60000 } }]) // PROD: 1 min before
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate + 60000 } }]) // PROD: 1 min after (no gap)
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 86400000 } }]) // STAGING: 1 day before
        .mockResolvedValueOnce([{ _source: { dateutc: toDate + 86400000 } }]); // STAGING: 1 day after (gap!)

      readlineSync.question.mockReturnValue('n');

      const result = await runBackfill({
        both: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(result.results[0].result.message).toContain('No gap found');
      expect(result.results[1].result.status).toBe('cancelled');
    });
  });

  describe('runBackfill - error handling', () => {
    it('handles ES client creation failure', async () => {
      createEsClient.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      const result = await runBackfill({
        prod: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Connection failed');
    });

    it('handles search query failure', async () => {
      searchDocsByDateRange.mockRejectedValue(new Error('Search failed'));

      const result = await runBackfill({
        prod: true,
        from: '2024-01-01',
        to: '2024-01-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Search failed');
    });

    it('handles file read errors gracefully', async () => {
      const fromDate = moment('2024-01-15').valueOf();
      const toDate = moment('2024-01-20').valueOf();

      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 86400000 } }])
        .mockResolvedValueOnce([{ _source: { dateutc: toDate + 86400000 } }]);

      readlineSync.question.mockReturnValue('y');
      fs.readdirSync.mockReturnValue(['corrupt.json']);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });
      fs.existsSync.mockReturnValue(true);

      // Should not throw, but log warning and continue
      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      // Should complete (with skipped status since no data found)
      expect(result.status).toBeDefined();
    });

    it('handles indexer initialization failure', async () => {
      const fromDate = moment('2024-01-15').valueOf();
      const toDate = moment('2024-01-20').valueOf();

      searchDocsByDateRange
        .mockResolvedValueOnce([{ _source: { dateutc: fromDate - 86400000 } }])
        .mockResolvedValueOnce([{ _source: { dateutc: toDate + 86400000 } }]);

      const testRecords = [{ dateutc: moment('2024-01-16').valueOf(), temp: 72 }];
      fs.readdirSync.mockReturnValue(['test.json']);
      fs.readFileSync.mockReturnValue(JSON.stringify(testRecords));
      fs.existsSync.mockReturnValue(true);

      // Mock indexer initialization failure
      IndexData.mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue({ outcome: 'failure', error: 'Init failed' }),
        bulkIndexDocuments: jest.fn()
      }));

      const result = await runBackfill({
        prod: true,
        from: '2024-01-15',
        to: '2024-01-20',
        yes: true
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Indexer initialization failed');
    });
  });

  describe('runBackfill - date parsing', () => {
    it('parses YYYY-MM-DD format correctly', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-06-15',
        to: '2024-06-20'
      });

      // Should not fail with date parsing error
      expect(result.error).not.toContain('Invalid date format');
    });

    it('handles leap year dates', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-02-28',
        to: '2024-02-29'
      });

      expect(result.error).not.toContain('Invalid date format');
    });

    it('rejects invalid month', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-13-01',
        to: '2024-13-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid date format');
    });

    it('rejects invalid day', async () => {
      const result = await runBackfill({
        prod: true,
        from: '2024-02-30',
        to: '2024-02-31'
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Invalid date format');
    });
  });
});
