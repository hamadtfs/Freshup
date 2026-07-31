#!/bin/bash
# Script to push Supabase migrations with automatic password handling
# This script automatically uses SUPABASE_DB_PASSWORD from environment, .env, or .env.local

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Pushing Supabase migrations...${NC}"
echo ""

# Function to check if password is set
check_password() {
    if [ -z "$SUPABASE_DB_PASSWORD" ]; then
        return 1
    fi
    return 0
}

# Function to extract password from env file
# Handles: unquoted, single-quoted, double-quoted values
# Skips commented lines (starting with #)
extract_password_from_file() {
    local file="$1"
    # Get the line, skip comments, extract value after =
    # Use awk to handle special characters properly
    local line=$(grep "^[^#]*SUPABASE_DB_PASSWORD=" "$file" | head -n1)
    if [ -z "$line" ]; then
        return 1
    fi
    
    # Extract value after = sign, handling quotes
    local value=$(echo "$line" | sed 's/^[^=]*=//' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
    
    # Remove surrounding quotes if present
    if [[ "$value" =~ ^\".*\"$ ]] || [[ "$value" =~ ^\'.*\'$ ]]; then
        value="${value:1:-1}"
    fi
    
    echo "$value"
    return 0
}

# Try to load password from .env file first (if it exists)
if [ -f ".env" ]; then
    echo -e "${YELLOW}📄 Found .env, checking for SUPABASE_DB_PASSWORD...${NC}"
    EXTRACTED_PASSWORD=$(extract_password_from_file ".env" 2>/dev/null || echo "")
    
    if [ -n "$EXTRACTED_PASSWORD" ]; then
        export SUPABASE_DB_PASSWORD="$EXTRACTED_PASSWORD"
        echo -e "${GREEN}✓ Password loaded from .env${NC}"
    else
        echo -e "${YELLOW}⚠ SUPABASE_DB_PASSWORD not found in .env (or line is commented)${NC}"
    fi
    echo ""
fi

# Try to load password from .env.local if not already set
if [ -z "$SUPABASE_DB_PASSWORD" ] && [ -f ".env.local" ]; then
    echo -e "${YELLOW}📄 Found .env.local, checking for SUPABASE_DB_PASSWORD...${NC}"
    EXTRACTED_PASSWORD=$(extract_password_from_file ".env.local" 2>/dev/null || echo "")
    
    if [ -n "$EXTRACTED_PASSWORD" ]; then
        export SUPABASE_DB_PASSWORD="$EXTRACTED_PASSWORD"
        echo -e "${GREEN}✓ Password loaded from .env.local${NC}"
    else
        echo -e "${YELLOW}⚠ SUPABASE_DB_PASSWORD not found in .env.local${NC}"
    fi
    echo ""
fi

# Check if password is set
if ! check_password; then
    echo -e "${RED}❌ Error: SUPABASE_DB_PASSWORD is not set${NC}"
    echo ""
    echo "Please either:"
    echo "  1. Export it: export SUPABASE_DB_PASSWORD='your-password'"
    echo "  2. Add it to .env or .env.local: SUPABASE_DB_PASSWORD=your-password"
    echo ""
    exit 1
fi

# Verify Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}❌ Error: Supabase CLI is not installed${NC}"
    echo ""
    echo "Install it with: npm install -g supabase"
    echo "Or visit: https://supabase.com/docs/guides/cli"
    echo ""
    exit 1
fi

# Check if project is linked
if ! supabase status &> /dev/null; then
    echo -e "${YELLOW}⚠ Warning: Project may not be linked. Attempting to push anyway...${NC}"
    echo ""
fi

# Push migrations
echo -e "${GREEN}📤 Pushing migrations to linked Supabase project...${NC}"
echo ""

if supabase db push --linked; then
    echo ""
    echo -e "${GREEN}✅ Migrations pushed successfully!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Failed to push migrations${NC}"
    echo ""
    echo "Common issues:"
    echo "  - Incorrect database password"
    echo "  - Project not linked (run: supabase link)"
    echo "  - Network connectivity issues"
    echo "  - Migration conflicts"
    echo ""
    exit 1
fi
