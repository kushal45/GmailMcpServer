#!/usr/bin/env node

/**
 * Test Runner for Delete Email Integration Tests
 * 
 * This script provides a convenient way to run the delete email integration tests
 * with various options including coverage reporting and test filtering.
 * 
 * Usage:
 *   node scripts/test-delete-integration.js [options]
 * 
 * Options:
 *   --coverage    Generate coverage report
 *   --watch       Run tests in watch mode
 *   --verbose     Show detailed test output
 *   --filter      Filter tests by name pattern
 *   --bail        Stop after first test failure
 *   --silent      Suppress console output during tests
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const __dirname = path.resolve();
console.log("Current directory:", __dirname);

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  coverage: args.includes('--coverage'),
  watch: args.includes('--watch'),
  verbose: args.includes('--verbose'),
  bail: args.includes('--bail'),
  silent: args.includes('--silent'),
  filter: ''
};

// Extract filter pattern if provided
const filterIndex = args.indexOf('--filter');
if (filterIndex !== -1 && args[filterIndex + 1]) {
  options.filter = args[filterIndex + 1];
}

// Build Jest command
const jestArgs = [
  'jest',
  'tests/integration/delete/DeleteManager.integration.test.ts',
  '--config', 'jest.config.cjs'
];

// Add options
if (options.coverage) {
  jestArgs.push('--coverage');
  jestArgs.push('--coveragePathIgnorePatterns=tests/');
}

if (options.watch) {
  jestArgs.push('--watch');
}

if (options.verbose) {
  jestArgs.push('--verbose');
}

if (options.bail) {
  jestArgs.push('--bail');
}

if (options.silent) {
  jestArgs.push('--silent');
}

if (options.filter) {
  jestArgs.push('-t', options.filter);
}

// Console output helpers
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function printHeader() {
  console.log('\n' + colors.bright + colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
  console.log(colors.bright + colors.cyan + '  📧 Delete Email Integration Tests Runner' + colors.reset);
  console.log(colors.bright + colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset + '\n');
}

function printOptions() {
  console.log(colors.bright + 'Test Configuration:' + colors.reset);
  console.log(colors.dim + '├─' + colors.reset + ' Coverage: ' + (options.coverage ? colors.green + '✓' : colors.red + '✗') + colors.reset);
  console.log(colors.dim + '├─' + colors.reset + ' Watch Mode: ' + (options.watch ? colors.green + '✓' : colors.red + '✗') + colors.reset);
  console.log(colors.dim + '├─' + colors.reset + ' Verbose: ' + (options.verbose ? colors.green + '✓' : colors.red + '✗') + colors.reset);
  console.log(colors.dim + '├─' + colors.reset + ' Bail on Error: ' + (options.bail ? colors.green + '✓' : colors.red + '✗') + colors.reset);
  console.log(colors.dim + '├─' + colors.reset + ' Silent Mode: ' + (options.silent ? colors.green + '✓' : colors.red + '✗') + colors.reset);
  console.log(colors.dim + '└─' + colors.reset + ' Filter: ' + (options.filter ? colors.yellow + options.filter : colors.dim + 'none') + colors.reset);
  console.log('');
}

function printUsage() {
  console.log(colors.bright + 'Usage:' + colors.reset);
  console.log('  node scripts/test-delete-integration.js [options]\n');
  console.log(colors.bright + 'Options:' + colors.reset);
  console.log('  --coverage    Generate coverage report');
  console.log('  --watch       Run tests in watch mode');
  console.log('  --verbose     Show detailed test output');
  console.log('  --filter      Filter tests by name pattern');
  console.log('  --bail        Stop after first test failure');
  console.log('  --silent      Suppress console output during tests\n');
  console.log(colors.bright + 'Examples:' + colors.reset);
  console.log('  ' + colors.dim + '# Run all delete integration tests' + colors.reset);
  console.log('  node scripts/test-delete-integration.js\n');
  console.log('  ' + colors.dim + '# Run with coverage report' + colors.reset);
  console.log('  node scripts/test-delete-integration.js --coverage\n');
  console.log('  ' + colors.dim + '# Run specific test by pattern' + colors.reset);
  console.log('  node scripts/test-delete-integration.js --filter "delete low priority"\n');
  console.log('  ' + colors.dim + '# Run in watch mode with verbose output' + colors.reset);
  console.log('  node scripts/test-delete-integration.js --watch --verbose\n');
}

// Check if help is requested
if (args.includes('--help') || args.includes('-h')) {
  printHeader();
  printUsage();
  process.exit(0);
}

// Setup test environment
async function setupTestEnvironment() {
  console.log(colors.yellow + '⚙️  Setting up test environment...' + colors.reset);
  
  // Note: Test database will be created in temp directory by the tests themselves
  console.log(colors.dim + '   Test database will be created in temp directory during test execution' + colors.reset);
  
  // Ensure test fixtures are available
  const fixturesPath = path.join(__dirname, 'tests', 'integration', 'delete', 'fixtures');
  console.log(colors.dim + '   Checking test fixtures directory: ' + colors.cyan + fixturesPath + colors.reset);
  if (!fs.existsSync(fixturesPath)) {
    console.error(colors.red + '❌ Test fixtures directory not found!' + colors.reset);
    process.exit(1);
  }
  
  console.log(colors.green + '✓ Test environment ready' + colors.reset + '\n');
}

// Cleanup test environment
async function cleanupTestEnvironment() {
  console.log('\n' + colors.yellow + '🧹 Cleaning up test environment...' + colors.reset);
  
  // Note: Test databases are created in temp directories and cleaned up by the tests
  console.log(colors.dim + '   Test databases are automatically cleaned up by the test suite' + colors.reset);
  console.log(colors.green + '✓ Cleanup complete' + colors.reset);
}

// Run the tests
async function runTests() {
  printHeader();
  printOptions();
  
  await setupTestEnvironment();
  
  console.log(colors.bright + colors.magenta + '🚀 Running Delete Integration Tests...' + colors.reset + '\n');
  console.log(colors.dim + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset + '\n');
  
  // Use npx to run jest
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const jest = spawn(npx, jestArgs, {
    stdio: 'inherit',
    shell: true
  });
  
  jest.on('close', async (code) => {
    console.log('\n' + colors.dim + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
    
    if (code === 0) {
      console.log('\n' + colors.bright + colors.green + '✅ All tests passed!' + colors.reset);
    } else {
      console.log('\n' + colors.bright + colors.red + '❌ Tests failed with exit code: ' + code + colors.reset);
    }
    
    // Cleanup unless in watch mode
    if (!options.watch) {
      await cleanupTestEnvironment();
    }
    
    // Show coverage report location if coverage was generated
    if (options.coverage && code === 0) {
      console.log('\n' + colors.bright + colors.blue + '📊 Coverage Report:' + colors.reset);
      console.log('   HTML: ' + colors.cyan + 'coverage/lcov-report/index.html' + colors.reset);
      console.log('   Text: ' + colors.cyan + 'coverage/lcov.info' + colors.reset);
    }
    
    console.log('\n' + colors.bright + colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset + '\n');
    
    process.exit(code);
  });
  
  jest.on('error', (error) => {
    console.error(colors.red + '❌ Failed to start test runner:' + colors.reset, error);
    process.exit(1);
  });
}

// Handle interruption
process.on('SIGINT', async () => {
  console.log('\n' + colors.yellow + '⚠️  Test run interrupted' + colors.reset);
  await cleanupTestEnvironment();
  process.exit(130);
});

// Run the tests
runTests().catch((error) => {
  console.error(colors.red + '❌ Unexpected error:' + colors.reset, error);
  process.exit(1);
});