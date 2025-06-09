# Delete Email Integration Testing Documentation

## Overview

The delete email integration tests provide comprehensive coverage for the `DeleteManager` module, ensuring safe and reliable email deletion functionality. These tests verify various deletion scenarios, safety features, error handling, and performance characteristics.

## Table of Contents

- [Test Structure](#test-structure)
- [Running the Tests](#running-the-tests)
- [Test Scenarios](#test-scenarios)
- [Mock Strategy](#mock-strategy)
- [Adding New Tests](#adding-new-tests)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Test Structure

The delete email integration tests are organized into the following structure:

```
tests/integration/delete/
├── DeleteManager.integration.test.ts    # Main test suite
├── fixtures/
│   └── mockEmails.ts                    # Mock email data and statistics
└── helpers/
    └── testHelpers.ts                   # Test utilities and mock setup
```

### Key Components

1. **Main Test Suite** ([`DeleteManager.integration.test.ts`](../tests/integration/delete/DeleteManager.integration.test.ts))
   - Contains all test cases organized by functionality
   - Uses Jest as the testing framework
   - Implements comprehensive mocking for external dependencies

2. **Mock Fixtures** ([`mockEmails.ts`](../tests/integration/delete/fixtures/mockEmails.ts))
   - Provides realistic email data for testing
   - Includes various email categories, years, and sizes
   - Contains special test cases for batch processing and error scenarios

3. **Test Helpers** ([`testHelpers.ts`](../tests/integration/delete/helpers/testHelpers.ts))
   - Factory functions for creating test instances
   - Mock setup utilities for Gmail API and database
   - Verification helpers for asserting correct behavior

## Running the Tests

### Using the Test Runner Script

The easiest way to run the delete integration tests is using the dedicated test runner:

```bash
# Run all delete integration tests
node scripts/test-delete-integration.js

# Run with coverage report
node scripts/test-delete-integration.js --coverage

# Run in watch mode
node scripts/test-delete-integration.js --watch

# Run specific tests by pattern
node scripts/test-delete-integration.js --filter "delete low priority"

# Run with multiple options
node scripts/test-delete-integration.js --coverage --verbose --bail
```

### Available Options

| Option | Description |
|--------|-------------|
| `--coverage` | Generate code coverage report |
| `--watch` | Run tests in watch mode for development |
| `--verbose` | Show detailed test output |
| `--filter <pattern>` | Run only tests matching the pattern |
| `--bail` | Stop after first test failure |
| `--silent` | Suppress console output during tests |
| `--help` | Show usage information |

### Using Jest Directly

You can also run the tests directly with Jest:

```bash
# Run all delete integration tests
npx jest tests/integration/delete/DeleteManager.integration.test.ts

# Run with coverage
npx jest tests/integration/delete/DeleteManager.integration.test.ts --coverage

# Run specific test suite
npx jest tests/integration/delete/DeleteManager.integration.test.ts -t "Delete by Category"
```

### Coverage Reports

When running with `--coverage`, reports are generated in multiple formats:

- **HTML Report**: `coverage/lcov-report/index.html` (open in browser)
- **Text Summary**: Displayed in terminal
- **LCOV Data**: `coverage/lcov.info` (for CI integration)

## Test Scenarios

The integration tests cover the following scenarios:

### 1. Normal Delete Scenarios

#### Delete by Category
- Low priority emails deletion
- Medium priority emails deletion
- High priority emails (only when explicitly specified)
- Protection of high priority emails by default

#### Delete by Year
- Emails from specific years
- Multiple year deletions
- Year-based filtering with category protection

#### Delete by Size Threshold
- Large emails (>1MB)
- Custom size thresholds
- Size-based filtering combined with other criteria

#### Delete with Search Criteria
- Label-based deletion (e.g., NEWSLETTER)
- Sender-based deletion
- Complex search criteria combinations

### 2. Bulk Delete Operations
- Batch processing for large email sets
- Respecting Gmail API batch limits (50 emails)
- Rate limiting between batches
- Performance optimization for thousands of emails

### 3. Safety Features

#### Dry Run Mode
- Preview deletions without executing
- Detailed reporting of what would be deleted
- Works with all filter combinations

#### High Priority Protection
- Default protection of high priority emails
- Explicit override requirement
- Verification of protection logic

#### Archived Email Handling
- Skip archived emails by default
- Optional inclusion of archived emails
- Proper filtering in database queries

### 4. Error Handling
- Authentication failures
- Network timeouts
- Rate limit errors
- Database connection issues
- Permission denied scenarios
- Partial batch failures

### 5. Edge Cases
- Empty result sets
- Already deleted emails
- Invalid parameters
- Concurrent operations
- Very large email sets (1000+ emails)

### 6. Additional Methods
- `getDeleteStatistics()` - Deletion statistics by category, year, and size
- `emptyTrash()` - Permanent deletion of trashed emails
- `scheduleAutoDeletion()` - Auto-deletion rule configuration (placeholder)

## Mock Strategy

The tests use a comprehensive mocking strategy to isolate the `DeleteManager` from external dependencies:

### 1. Gmail API Client Mock
```typescript
const mockGmailClient = {
  users: {
    messages: {
      batchModify: jest.fn(),
      list: jest.fn(),
      delete: jest.fn()
    }
  }
};
```

### 2. Database Manager Mock
```typescript
const mockDbManager = {
  searchEmails: jest.fn(),
  markAsDeleted: jest.fn(),
  updateEmailStatus: jest.fn()
};
```

### 3. Auth Manager Mock
```typescript
const mockAuthManager = {
  getGmailClient: jest.fn(() => Promise.resolve(mockGmailClient))
};
```

### Mock Data Characteristics
- Realistic email structures with all required fields
- Various categories, years, and sizes
- Special test cases for edge scenarios
- Consistent data for predictable testing

## Adding New Tests

To add new test cases:

### 1. Create a New Test Suite
```typescript
describe('Your New Feature', () => {
  // Setup specific to your feature
  beforeEach(() => {
    // Additional setup if needed
  });

  it('should handle your specific scenario', async () => {
    // Arrange: Set up test data and mocks
    const testEmails = getEmailsByCriteria({ /* your criteria */ });
    setupDatabaseSearchResults(mockDbManager, testEmails);
    setupSuccessfulBatchModify(mockGmailClient);

    // Act: Execute the operation
    const options = createDeleteOptions({ /* your options */ });
    const result = await deleteManager.deleteEmails(options);

    // Assert: Verify the results
    expect(result.deleted).toBe(testEmails.length);
    expect(result.errors).toHaveLength(0);
    
    // Verify mock calls
    verifyDatabaseSearchCalls(mockDbManager, [{ /* expected criteria */ }]);
    verifyBatchModifyCalls(mockGmailClient, [{ ids: testEmails.map(e => e.id) }]);
  });
});
```

### 2. Add Mock Data if Needed
In [`fixtures/mockEmails.ts`](../tests/integration/delete/fixtures/mockEmails.ts):
```typescript
export const yourSpecialEmails = [
  {
    id: 'special-1',
    threadId: 'thread-special-1',
    category: 'medium',
    subject: 'Special Test Email',
    // ... other required fields
  }
];
```

### 3. Add Helper Functions if Needed
In [`helpers/testHelpers.ts`](../tests/integration/delete/helpers/testHelpers.ts):
```typescript
export function setupYourSpecialScenario(mockGmailClient: any) {
  mockGmailClient.users.messages.yourMethod.mockImplementation(/* ... */);
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Test Timeout Errors
**Problem**: Tests fail with timeout errors
**Solution**: 
- Increase test timeout in [`jest.config.js`](../jest.config.js)
- Check for unresolved promises in your test
- Ensure all async operations are properly awaited

#### 2. Mock Not Working
**Problem**: Real API calls are being made
**Solution**:
- Verify mock setup in `beforeEach`
- Check that [`resetAllMocks()`](../tests/integration/delete/helpers/testHelpers.ts:27) is called in `afterEach`
- Ensure mocks are properly imported

#### 3. Flaky Tests
**Problem**: Tests pass/fail inconsistently
**Solution**:
- Remove time-dependent logic
- Use fixed mock data instead of random
- Ensure proper test isolation
- Check for race conditions in async code

#### 4. Coverage Gaps
**Problem**: Coverage report shows untested lines
**Solution**:
- Add tests for error scenarios
- Test edge cases and boundary conditions
- Cover all conditional branches
- Test error handling paths

### Debug Tips

1. **Use Console Capture**:
   ```typescript
   const consoleCapture = captureConsoleLogs();
   // ... run test
   console.log(consoleCapture.logs); // See captured logs
   ```

2. **Verbose Output**:
   ```bash
   node scripts/test-delete-integration.js --verbose
   ```

3. **Focus on Single Test**:
   ```typescript
   it.only('should test this specific case', async () => {
     // Your test
   });
   ```

4. **Check Mock Calls**:
   ```typescript
   console.log(mockGmailClient.users.messages.batchModify.mock.calls);
   ```

## Best Practices

### 1. Test Organization
- Group related tests in `describe` blocks
- Use descriptive test names that explain the scenario
- Follow the Arrange-Act-Assert pattern
- Keep tests focused on single behaviors

### 2. Mock Management
- Reset all mocks in `afterEach`
- Use helper functions for complex mock setups
- Keep mock data realistic and consistent
- Document any special mock behaviors

### 3. Assertions
- Test both success and failure paths
- Verify mock function calls and parameters
- Check for proper error messages
- Assert on all relevant output fields

### 4. Performance
- Use [`captureConsoleLogs()`](../tests/integration/delete/helpers/testHelpers.ts:26) to suppress output
- Minimize database setup/teardown
- Reuse mock data where appropriate
- Keep test execution time under 30 seconds

### 5. Maintenance
- Update tests when implementation changes
- Keep mock data synchronized with real data structures
- Document any non-obvious test logic
- Regular review of test coverage

## Integration with CI/CD

The delete integration tests can be integrated into your CI/CD pipeline:

```yaml
# Example GitHub Actions configuration
- name: Run Delete Integration Tests
  run: node scripts/test-delete-integration.js --coverage --bail

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    file: ./coverage/lcov.info
    flags: integration
```

## Related Documentation

- [Main README](../README.md) - Project overview and setup
- [Architecture](../ARCHITECTURE.md) - System design and components
- [Tools System](./TOOLS_MODULAR_SYSTEM.md) - MCP tools implementation

---

For questions or issues with the delete email integration tests, please refer to the troubleshooting section or create an issue in the project repository.