// Set NODE_ENV to test
process.env.NODE_ENV = 'test';

// Mock the Logger class to suppress console output during tests
jest.mock('./src/logger/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    logMessage: jest.fn(),
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarning: jest.fn()
  }));
});
