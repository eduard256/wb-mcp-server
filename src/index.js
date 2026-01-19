import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import WBClient from './wb-client.js';

// Initialize WB Client
const wbClient = new WBClient();

// Create MCP Server
const server = new Server(
  {
    name: 'wb-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const TOOLS = [
  {
    name: 'wb_search',
    description: 'Search for products on Wildberries marketplace. Returns list of products with prices, ratings, and links.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "iPhone 15", "материнская плата AM4")',
        },
        sort: {
          type: 'string',
          enum: ['popular', 'rate', 'priceup', 'pricedown', 'newly'],
          description: 'Sort order: popular (default), rate (by rating), priceup (price ascending), pricedown (price descending), newly (newest first)',
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
        },
        priceMin: {
          type: 'number',
          description: 'Minimum price in rubles',
        },
        priceMax: {
          type: 'number',
          description: 'Maximum price in rubles',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 20, max: 100)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'wb_product_details',
    description: 'Get detailed information about a specific product by its ID. Returns full description, characteristics, prices, stock info, and delivery time.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: {
          type: 'string',
          description: 'Product ID (nm_id) from Wildberries',
        },
      },
      required: ['productId'],
    },
  },
  {
    name: 'wb_products_list',
    description: 'Get information about multiple products by their IDs. Useful for comparing products.',
    inputSchema: {
      type: 'object',
      properties: {
        productIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of product IDs to fetch',
        },
      },
      required: ['productIds'],
    },
  },
  {
    name: 'wb_set_destination',
    description: 'Set delivery destination city/address. This affects delivery times and available stock in search results.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'City or address for delivery (e.g., "Москва", "Саки, Крым", "Санкт-Петербург")',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'wb_get_filters',
    description: 'Get available filters and sort options for a search query. Useful for understanding what filters can be applied.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to get filters for',
        },
      },
      required: ['query'],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'wb_search': {
        const results = await wbClient.search(args.query, {
          sort: args.sort || 'popular',
          page: args.page || 1,
          priceMin: args.priceMin,
          priceMax: args.priceMax,
          limit: Math.min(args.limit || 20, 100),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                query: args.query,
                count: results.length,
                products: results,
              }, null, 2),
            },
          ],
        };
      }

      case 'wb_product_details': {
        const product = await wbClient.getProductDetails(args.productId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                product,
              }, null, 2),
            },
          ],
        };
      }

      case 'wb_products_list': {
        const products = await wbClient.getProductsList(args.productIds);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: products.length,
                products,
              }, null, 2),
            },
          ],
        };
      }

      case 'wb_set_destination': {
        const result = await wbClient.setDestination(args.address);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'wb_get_filters': {
        const filters = await wbClient.getFilters(args.query);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(filters, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('[MCP Server] Shutting down...');
  await wbClient.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[MCP Server] Shutting down...');
  await wbClient.close();
  process.exit(0);
});

// Start server
async function main() {
  console.log('[MCP Server] Starting Wildberries MCP Server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log('[MCP Server] Server started and listening on stdio');
}

main().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
