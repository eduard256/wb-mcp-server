import express from 'express';
import WBClient from './wb-client.js';

/**
 * HTTP Server for Wildberries MCP
 * Provides Streamable HTTP transport for remote MCP connections
 */

const app = express();
app.use(express.json());

// Initialize WB Client
const wbClient = new WBClient();

// Session storage
const sessions = new Map();

// CORS headers for cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Generate session ID
function generateSessionId() {
  return 'mcp-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Tool definitions
const TOOLS = [
  {
    name: 'wb_search',
    description: 'Search for products on Wildberries marketplace',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        sort: { type: 'string', enum: ['popular', 'rate', 'priceup', 'pricedown', 'newly'] },
        page: { type: 'number' },
        priceMin: { type: 'number' },
        priceMax: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'wb_product_details',
    description: 'Get detailed product information by ID',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID' },
      },
      required: ['productId'],
    },
  },
  {
    name: 'wb_products_list',
    description: 'Get multiple products by IDs',
    inputSchema: {
      type: 'object',
      properties: {
        productIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['productIds'],
    },
  },
  {
    name: 'wb_set_destination',
    description: 'Set delivery destination city',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'City or address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'wb_get_filters',
    description: 'Get available filters for search',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
];

// Handle JSON-RPC request
async function handleJsonRpcRequest(request) {
  const { method, params, id } = request;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'wb-mcp-server',
              version: '1.0.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        };

      case 'tools/call':
        const { name, arguments: args } = params;
        let result;

        switch (name) {
          case 'wb_search':
            result = await wbClient.search(args.query, {
              sort: args.sort || 'popular',
              page: args.page || 1,
              priceMin: args.priceMin,
              priceMax: args.priceMax,
              limit: Math.min(args.limit || 20, 100),
            });
            break;

          case 'wb_product_details':
            result = await wbClient.getProductDetails(args.productId);
            break;

          case 'wb_products_list':
            result = await wbClient.getProductsList(args.productIds);
            break;

          case 'wb_set_destination':
            result = await wbClient.setDestination(args.address);
            break;

          case 'wb_get_filters':
            result = await wbClient.getFilters(args.query);
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        };

      case 'notifications/initialized':
        // Client notification, no response needed
        return null;

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error.message,
      },
    };
  }
}

// MCP Endpoint - POST (Streamable HTTP)
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const accept = req.headers['accept'] || '';

  console.log(`[HTTP] POST /mcp - Session: ${sessionId || 'new'}`);

  // Handle batch or single request
  const requests = Array.isArray(req.body) ? req.body : [req.body];
  const responses = [];

  for (const request of requests) {
    const response = await handleJsonRpcRequest(request);
    if (response) {
      responses.push(response);
    }
  }

  // Set session ID on initialize
  if (requests.some(r => r.method === 'initialize') && !sessionId) {
    const newSessionId = generateSessionId();
    sessions.set(newSessionId, { created: Date.now() });
    res.set('Mcp-Session-Id', newSessionId);
  }

  // Return response
  if (responses.length === 0) {
    res.status(202).send();
  } else if (responses.length === 1) {
    res.json(responses[0]);
  } else {
    res.json(responses);
  }
});

// MCP Endpoint - GET (SSE stream for server-initiated messages)
app.get('/mcp', (req, res) => {
  const accept = req.headers['accept'] || '';

  if (!accept.includes('text/event-stream')) {
    return res.status(406).json({ error: 'Accept header must include text/event-stream' });
  }

  console.log('[HTTP] GET /mcp - Opening SSE stream');

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send keepalive
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepalive);
    console.log('[HTTP] SSE stream closed');
  });
});

// MCP Endpoint - DELETE (terminate session)
app.delete('/mcp', (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
    console.log(`[HTTP] Session ${sessionId} terminated`);
    res.status(200).json({ success: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'wb-mcp-server',
    version: '1.0.0',
    sessions: sessions.size,
  });
});

// API info endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Wildberries MCP Server',
    version: '1.0.0',
    description: 'MCP Server for Wildberries marketplace - search products, get details, prices and delivery info',
    endpoints: {
      '/mcp': 'MCP Streamable HTTP endpoint (POST/GET/DELETE)',
      '/health': 'Health check',
    },
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
  });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP Server] Wildberries MCP Server running on http://0.0.0.0:${PORT}`);
  console.log(`[HTTP Server] MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[HTTP Server] Shutting down...');
  await wbClient.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[HTTP Server] Shutting down...');
  await wbClient.close();
  process.exit(0);
});
