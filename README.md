# Wildberries MCP Server

MCP (Model Context Protocol) server for Wildberries marketplace. Allows AI assistants to search products, get detailed information, check prices, and calculate delivery times.

## Features

- **Product Search** - Search products with filters (price, sort, etc.)
- **Product Details** - Get full product info including specs, prices, stock
- **Multi-product Fetch** - Get info for multiple products at once
- **Delivery Calculation** - Set destination city for accurate delivery times
- **Filter Discovery** - Get available filters for any search query

## Available Tools

| Tool | Description |
|------|-------------|
| `wb_search` | Search products with query, sort, price filters |
| `wb_product_details` | Get detailed product info by ID |
| `wb_products_list` | Get multiple products by IDs |
| `wb_set_destination` | Set delivery city for accurate times |
| `wb_get_filters` | Get available filters for search |

## Quick Start

### Docker (Recommended)

```bash
# Clone repository
git clone https://github.com/eduard256/wb-mcp-server.git
cd wb-mcp-server

# Build and run
docker-compose up -d

# Check status
curl http://localhost:3000/health
```

### Manual Installation

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Start HTTP server (for remote access)
npm start

# Or start stdio server (for local MCP clients)
node src/index.js
```

## Configuration

### Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wildberries": {
      "url": "http://YOUR_SERVER_IP:3000/mcp"
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `NODE_ENV` | production | Environment mode |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC requests |
| `/mcp` | GET | SSE stream for server messages |
| `/mcp` | DELETE | Terminate session |
| `/health` | GET | Health check |
| `/` | GET | Server info |

## Usage Examples

### Search Products

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "wb_search",
    "arguments": {
      "query": "iPhone 15",
      "sort": "priceup",
      "limit": 10
    }
  }
}
```

### Get Product Details

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "wb_product_details",
    "arguments": {
      "productId": "472014502"
    }
  }
}
```

### Set Delivery City

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "wb_set_destination",
    "arguments": {
      "address": "Саки, Крым"
    }
  }
}
```

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   AI Client     │◄────►│  MCP HTTP Server │◄────►│   Playwright    │
│ (Claude, etc.)  │      │   (Express.js)   │      │    Browser      │
└─────────────────┘      └──────────────────┘      └────────┬────────┘
                                                            │
                                                   ┌────────▼────────┐
                                                   │   Wildberries   │
                                                   │      APIs       │
                                                   └─────────────────┘
```

## License

MIT
