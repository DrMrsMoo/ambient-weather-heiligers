const fs = require('file-system');
const { prepareDataForBulkIndexing, updateProgressState } = require('../../main_utils');

// Mock the file-system module
jest.mock('file-system', () => ({
  readFileSync: jest.fn(),
  readdirSync: jest.fn()
}));

// Mock the logger
jest.mock('../logger', () => {
  return jest.fn().mockImplementation(() => ({
    logInfo: jest.fn(),
    logWarning: jest.fn(),
    logError: jest.fn()
  }));
});

describe('main_utils', () => {
  describe('prepareDataForBulkIndexing', () => {
    const mockLogger = {
      logInfo: jest.fn(),
      logWarning: jest.fn(),
      logError: jest.fn()
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    const createMockJsonlData = (records) => {
      return records.map(r => JSON.stringify(r)).join('\n');
    };

    describe('filterAfterDate parameter', () => {
      it('includes all records when filterAfterDate is null', () => {
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 },
          { dateutc: 1700000300000, tempf: 71 },
          { dateutc: 1700000600000, tempf: 72 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: null
        });

        // Each record produces 2 entries (action + doc)
        expect(result.length).toBe(6);
        expect(result[1].dateutc).toBe(1700000000000);
        expect(result[3].dateutc).toBe(1700000300000);
        expect(result[5].dateutc).toBe(1700000600000);
      });

      it('filters out records with dateutc <= filterAfterDate', () => {
        const filterDate = 1700000300000;
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 }, // Should be filtered (older)
          { dateutc: 1700000300000, tempf: 71 }, // Should be filtered (equal)
          { dateutc: 1700000600000, tempf: 72 }  // Should be included (newer)
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: mockLogger,
          filterAfterDate: filterDate
        });

        // Only 1 record should remain (2 entries: action + doc)
        expect(result.length).toBe(2);
        expect(result[1].dateutc).toBe(1700000600000);
      });

      it('includes all records when all are newer than filterAfterDate', () => {
        const filterDate = 1699999999999; // Before all records
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 },
          { dateutc: 1700000300000, tempf: 71 },
          { dateutc: 1700000600000, tempf: 72 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: filterDate
        });

        expect(result.length).toBe(6);
      });

      it('filters out all records when all are older than or equal to filterAfterDate', () => {
        const filterDate = 1700000600000; // Equal to newest record
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 },
          { dateutc: 1700000300000, tempf: 71 },
          { dateutc: 1700000600000, tempf: 72 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: filterDate
        });

        expect(result.length).toBe(0);
      });

      it('handles filterAfterDate of 0 (epoch) correctly', () => {
        const filterDate = 0; // Epoch 0
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 },
          { dateutc: 1700000300000, tempf: 71 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: filterDate
        });

        // All records should be included since they're after epoch 0
        expect(result.length).toBe(4);
      });

      it('handles undefined filterAfterDate same as null', () => {
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 },
          { dateutc: 1700000300000, tempf: 71 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: undefined
        });

        // All records should be included
        expect(result.length).toBe(4);
      });

      it('logs filtered record count when logger is provided', () => {
        const filterDate = 1700000300000;
        const mockRecords = [
          { dateutc: 1700000000000, tempf: 70 },
          { dateutc: 1700000600000, tempf: 72 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: mockLogger,
          filterAfterDate: filterDate
        });

        expect(mockLogger.logInfo).toHaveBeenCalledWith(
          expect.stringContaining('Filtered to 1 imperial records newer than')
        );
      });

      it('does not log when logger is null', () => {
        const filterDate = 1700000300000;
        const mockRecords = [
          { dateutc: 1700000600000, tempf: 72 }
        ];

        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        // Should not throw even without logger
        expect(() => {
          prepareDataForBulkIndexing({
            fileNamesArray: ['test_file'],
            dataType: 'imperial',
            logger: null,
            filterAfterDate: filterDate
          });
        }).not.toThrow();
      });
    });

    describe('data type handling', () => {
      it('sets correct index alias for imperial data', () => {
        const mockRecords = [{ dateutc: 1700000000000, tempf: 70 }];
        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: null
        });

        expect(result[0].index._index).toBe('all-ambient-weather-heiligers-imperial');
      });

      it('sets correct index alias for metric data', () => {
        const mockRecords = [{ dateutc: 1700000000000, tempc: 21 }];
        fs.readFileSync.mockReturnValueOnce(createMockJsonlData(mockRecords));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['test_file'],
          dataType: 'metric',
          logger: null,
          filterAfterDate: null
        });

        expect(result[0].index._index).toBe('all-ambient-weather-heiligers-metric');
      });
    });

    describe('multiple files', () => {
      it('processes multiple files and combines results', () => {
        const mockRecords1 = [{ dateutc: 1700000000000, tempf: 70 }];
        const mockRecords2 = [{ dateutc: 1700000600000, tempf: 72 }];

        fs.readFileSync
          .mockReturnValueOnce(createMockJsonlData(mockRecords1))
          .mockReturnValueOnce(createMockJsonlData(mockRecords2));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['file1', 'file2'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: null
        });

        expect(result.length).toBe(4); // 2 records * 2 entries each
      });

      it('applies filter consistently across multiple files', () => {
        const filterDate = 1700000300000;
        const mockRecords1 = [
          { dateutc: 1700000000000, tempf: 70 }, // Filtered
          { dateutc: 1700000600000, tempf: 72 }  // Included
        ];
        const mockRecords2 = [
          { dateutc: 1700000200000, tempf: 71 }, // Filtered
          { dateutc: 1700000900000, tempf: 73 }  // Included
        ];

        fs.readFileSync
          .mockReturnValueOnce(createMockJsonlData(mockRecords1))
          .mockReturnValueOnce(createMockJsonlData(mockRecords2));

        const result = prepareDataForBulkIndexing({
          fileNamesArray: ['file1', 'file2'],
          dataType: 'imperial',
          logger: null,
          filterAfterDate: filterDate
        });

        expect(result.length).toBe(4); // 2 records included * 2 entries each
        expect(result[1].dateutc).toBe(1700000600000);
        expect(result[3].dateutc).toBe(1700000900000);
      });
    });
  });

  describe('updateProgressState', () => {
    const mockLogger = {
      logInfo: jest.fn(),
      logWarning: jest.fn(),
      logError: jest.fn()
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('updates state correctly with new step', () => {
      const result = updateProgressState(
        { fetchNewData: true },
        { info: 'test message' },
        mockLogger
      );

      expect(result.fetchNewData).toBe(true);
      expect(result.fatalError).toBe(false);
    });

    it('preserves old state when updating', () => {
      const oldState = { fetchNewData: true, newDataFetched: false };
      const result = updateProgressState(
        { newDataFetched: true },
        { info: 'test' },
        mockLogger,
        oldState
      );

      expect(result.fetchNewData).toBe(true);
      expect(result.newDataFetched).toBe(true);
    });

    it('logs info messages correctly', () => {
      updateProgressState(
        { fetchNewData: true },
        { info: 'test info message' },
        mockLogger
      );

      expect(mockLogger.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('test info message')
      );
    });

    it('logs warning messages correctly', () => {
      updateProgressState(
        { fetchNewData: true },
        { warn: 'test warning' },
        mockLogger
      );

      expect(mockLogger.logWarning).toHaveBeenCalledWith('test warning');
    });

    it('logs error messages correctly', () => {
      const errorInfo = new Error('test error');
      updateProgressState(
        { fatalError: true },
        { error: 'error occurred', errorInfo },
        mockLogger
      );

      expect(mockLogger.logError).toHaveBeenCalledWith('error occurred', errorInfo);
    });

    it('includes timestamp when requested', () => {
      updateProgressState(
        { fetchNewData: true },
        { info: 'test message', includeTimestamp: true },
        mockLogger
      );

      expect(mockLogger.logInfo).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      );
    });
  });
});
