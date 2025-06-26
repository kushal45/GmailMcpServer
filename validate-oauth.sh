#!/bin/bash

# OAuth Validation Helper Script
# 
# This script provides easy commands to validate OAuth flow with different options.
# 
# Usage:
#   ./validate-oauth.sh [option]
#
# Options:
#   basic    - Run basic OAuth validation (headless)
#   debug    - Run with visible browser for debugging
#   mock     - Run with mock OAuth (no real authentication)
#   setup    - Setup test environment
#   help     - Show this help message

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if .env.test exists
check_env_file() {
    if [ ! -f "tests/integration/mcp/.env.test" ]; then
        print_warning ".env.test file not found"
        print_status "Creating .env.test from template..."
        npm run test:mcp:setup
        print_warning "Please edit tests/integration/mcp/.env.test with your credentials before running OAuth validation"
        exit 1
    fi
}

# Function to check if build exists
check_build() {
    if [ ! -f "build/index.js" ]; then
        print_warning "Build not found. Building project..."
        npm run build
    fi
}

# Function to show help
show_help() {
    echo "OAuth Validation Helper Script"
    echo ""
    echo "Usage: $0 [option]"
    echo ""
    echo "Options:"
    echo "  basic    - Run basic OAuth validation (headless browser)"
    echo "  debug    - Run with visible browser for debugging OAuth flow"
    echo "  mock     - Run with mock OAuth (bypasses real authentication)"
    echo "  setup    - Setup test environment and show configuration"
    echo "  timeout  - Check timeout configuration"
    echo "  help     - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 basic           # Quick OAuth validation"
    echo "  $0 debug           # Debug OAuth issues visually"
    echo "  $0 mock            # Test without real OAuth"
    echo "  $0 setup           # First-time setup"
    echo ""
    echo "Environment file: tests/integration/mcp/.env.test"
    echo "Documentation: docs/OAUTH_TROUBLESHOOTING.md"
}

# Main script logic
case "${1:-basic}" in
    "basic")
        print_status "Running basic OAuth validation..."
        check_env_file
        check_build
        npm run test:oauth:validate
        ;;
    
    "debug")
        print_status "Running OAuth validation with visible browser..."
        check_env_file
        check_build
        npm run test:oauth:validate:debug
        ;;
    
    "mock")
        print_status "Running OAuth validation with mock authentication..."
        check_env_file
        check_build
        npm run test:oauth:validate:mock
        ;;
    
    "setup")
        print_status "Setting up OAuth validation environment..."
        
        # Create .env.test if it doesn't exist
        if [ ! -f "tests/integration/mcp/.env.test" ]; then
            npm run test:mcp:setup
        fi
        
        # Check build
        check_build
        
        # Run timeout check
        print_status "Checking timeout configuration..."
        npm run test:timeout
        
        print_success "Setup complete!"
        print_status "Next steps:"
        echo "1. Edit tests/integration/mcp/.env.test with your Gmail credentials"
        echo "2. Run: $0 debug (to see OAuth flow visually)"
        echo "3. Run: $0 basic (for automated validation)"
        ;;
    
    "timeout")
        print_status "Checking timeout configuration..."
        npm run test:timeout
        ;;
    
    "help"|"-h"|"--help")
        show_help
        ;;
    
    *)
        print_error "Unknown option: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
