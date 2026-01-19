import { chromium } from 'playwright';

/**
 * Wildberries API Client
 * Uses Playwright for browser automation to bypass antibot protection
 */
class WBClient {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isInitialized = false;
    this.dest = '-1255987'; // Default destination (Moscow)
  }

  /**
   * Initialize browser instance
   */
  async init() {
    if (this.isInitialized) return;

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ]
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow'
    });

    this.page = await this.context.newPage();

    // Remove webdriver detection
    await this.page.addInitScript(() => {
      delete navigator.__proto__.webdriver;
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Load main page to get cookies
    await this.page.goto('https://www.wildberries.ru', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await new Promise(r => setTimeout(r, 5000));

    this.isInitialized = true;
    console.log('[WB Client] Initialized successfully');
  }

  /**
   * Close browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      this.isInitialized = false;
    }
  }

  /**
   * Make API request through browser context
   */
  async apiRequest(url) {
    await this.init();

    try {
      const response = await this.page.evaluate(async (apiUrl) => {
        const resp = await fetch(apiUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      }, url);
      return response;
    } catch (error) {
      console.error(`[WB Client] API request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search products
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} options.sort - Sort order: popular, rate, priceup, pricedown, newly
   * @param {number} options.page - Page number
   * @param {number} options.priceMin - Minimum price in rubles
   * @param {number} options.priceMax - Maximum price in rubles
   * @param {number} options.limit - Max results to return
   */
  async search(query, options = {}) {
    await this.init();

    const {
      sort = 'popular',
      page = 1,
      priceMin = null,
      priceMax = null,
      limit = 20
    } = options;

    // Build search URL
    let url = `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}&sort=${sort}&page=${page}`;

    if (priceMin || priceMax) {
      const min = (priceMin || 0) * 100;
      const max = (priceMax || 999999999) * 100;
      url += `&priceU=${min}%3B${max}`;
    }

    console.log(`[WB Client] Searching: ${query}`);

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for products to load
    try {
      await this.page.waitForSelector('.product-card', { timeout: 30000 });
    } catch (e) {
      console.log('[WB Client] No products found or timeout');
      return [];
    }

    await new Promise(r => setTimeout(r, 3000));

    // Extract products from DOM
    const products = await this.page.evaluate((maxResults) => {
      const cards = document.querySelectorAll('.product-card');
      return Array.from(cards).slice(0, maxResults).map(card => {
        const id = card.getAttribute('data-nm-id');
        const link = card.querySelector('a')?.href;
        const nameEl = card.querySelector('[class*="product-card__name"]');
        const brandEl = card.querySelector('[class*="product-card__brand"]');
        const imgEl = card.querySelector('img');

        // Try multiple price selectors
        let priceNum = null;
        let priceText = '';

        // Try wallet price first (actual price)
        const walletPrice = card.querySelector('[class*="price-block__wallet-price"]');
        const finalPrice = card.querySelector('[class*="price-block__final-price"]');
        const anyPrice = card.querySelector('[class*="price"]');

        const priceEl = walletPrice || finalPrice || anyPrice;
        if (priceEl) {
          priceText = priceEl.textContent?.trim() || '';
          // Extract number from price text
          const matches = priceText.match(/(\d[\d\s]*)/g);
          if (matches) {
            for (const match of matches) {
              const num = parseInt(match.replace(/\s/g, ''));
              if (num > 0 && num < 100000000) {
                priceNum = num;
                break;
              }
            }
          }
        }

        return {
          id,
          url: link,
          name: nameEl?.textContent?.trim(),
          brand: brandEl?.textContent?.trim()?.replace(/\s*\/.*/, ''),
          price: priceNum,
          priceFormatted: priceNum ? `${priceNum.toLocaleString('ru-RU')} ₽` : null,
          image: imgEl?.src
        };
      });
    }, limit);

    // Fetch prices via API for products without price
    const productsWithoutPrice = products.filter(p => !p.price && p.id);
    if (productsWithoutPrice.length > 0) {
      console.log(`[WB Client] Fetching prices for ${productsWithoutPrice.length} products via API`);
      try {
        const ids = productsWithoutPrice.map(p => p.id).join(';');
        const apiUrl = `https://www.wildberries.ru/__internal/u-card/cards/v4/list?appType=1&curr=rub&dest=${this.dest}&spp=30&lang=ru&nm=${ids}`;
        const apiData = await this.apiRequest(apiUrl);

        if (apiData?.products) {
          const priceMap = {};
          for (const p of apiData.products) {
            const price = p.sizes?.[0]?.price?.product;
            if (price) {
              priceMap[p.id] = price / 100;
            }
          }

          // Update products with API prices
          for (const product of products) {
            if (!product.price && priceMap[product.id]) {
              product.price = priceMap[product.id];
              product.priceFormatted = `${product.price.toLocaleString('ru-RU')} ₽`;
            }
          }
        }
      } catch (e) {
        console.error('[WB Client] Failed to fetch prices via API:', e.message);
      }
    }

    console.log(`[WB Client] Found ${products.length} products`);
    return products;
  }

  /**
   * Get product details by ID
   * @param {string|number} productId - Product ID (nm_id)
   */
  async getProductDetails(productId) {
    await this.init();

    console.log(`[WB Client] Getting details for product ${productId}`);

    // Get basic product data from API
    const detailUrl = `https://www.wildberries.ru/__internal/u-card/cards/v4/detail?appType=1&curr=rub&dest=${this.dest}&spp=30&lang=ru&nm=${productId}`;

    let detailData = null;
    try {
      detailData = await this.apiRequest(detailUrl);
    } catch (e) {
      console.error('[WB Client] Failed to get detail data');
    }

    // Get full card info from basket CDN
    const vol = Math.floor(productId / 100000);
    const part = Math.floor(productId / 1000);

    let cardData = null;
    // Try different basket numbers
    for (let b = 1; b <= 36; b++) {
      try {
        const bn = b.toString().padStart(2, '0');
        const cardUrl = `https://basket-${bn}.wbbasket.ru/vol${vol}/part${part}/${productId}/info/ru/card.json`;
        cardData = await this.apiRequest(cardUrl);
        if (cardData) break;
      } catch (e) {
        // Try next basket
      }
    }

    const product = detailData?.products?.[0];
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    const result = {
      id: productId,
      name: product.name,
      brand: product.brand,
      brandId: product.brandId,
      supplier: product.supplier,
      supplierId: product.supplierId,
      supplierRating: product.supplierRating,
      rating: product.rating,
      feedbacks: product.feedbacks,
      feedbackPoints: product.feedbackPoints,
      colors: product.colors,
      pics: product.pics,

      // Prices (convert from kopeks)
      priceBasic: product.sizes?.[0]?.price?.basic ? product.sizes[0].price.basic / 100 : null,
      priceFinal: product.sizes?.[0]?.price?.product ? product.sizes[0].price.product / 100 : null,
      discount: null,

      // Stock info
      inStock: product.totalQuantity,
      sizes: product.sizes?.map(s => ({
        name: s.name || 'One size',
        optionId: s.optionId,
        price: s.price?.product ? s.price.product / 100 : null,
        stocks: s.stocks?.map(st => ({
          warehouse: st.wh,
          qty: st.qty,
          deliveryTime: `${st.time1}-${st.time2} часов`
        }))
      })),

      // Delivery
      deliveryTime: product.time1 && product.time2 ? `${product.time1}-${product.time2} часов` : null,

      // From card.json
      description: cardData?.description || null,
      characteristics: cardData?.options?.map(o => ({
        name: o.name,
        value: o.value
      })) || [],

      url: `https://www.wildberries.ru/catalog/${productId}/detail.aspx`
    };

    // Calculate discount
    if (result.priceBasic && result.priceFinal) {
      result.discount = Math.round((1 - result.priceFinal / result.priceBasic) * 100);
    }

    return result;
  }

  /**
   * Get multiple products by IDs
   * @param {Array<string|number>} productIds - Array of product IDs
   */
  async getProductsList(productIds) {
    await this.init();

    const idsString = productIds.join(';');
    const url = `https://www.wildberries.ru/__internal/u-card/cards/v4/list?appType=1&curr=rub&dest=${this.dest}&spp=30&lang=ru&nm=${idsString}`;

    const data = await this.apiRequest(url);

    return data.products?.map(p => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      supplier: p.supplier,
      supplierRating: p.supplierRating,
      rating: p.rating,
      feedbacks: p.feedbacks,
      priceBasic: p.sizes?.[0]?.price?.basic ? p.sizes[0].price.basic / 100 : null,
      priceFinal: p.sizes?.[0]?.price?.product ? p.sizes[0].price.product / 100 : null,
      inStock: p.totalQuantity,
      deliveryTime: p.time1 && p.time2 ? `${p.time1}-${p.time2} часов` : null,
      url: `https://www.wildberries.ru/catalog/${p.id}/detail.aspx`
    })) || [];
  }

  /**
   * Set delivery destination
   * @param {string} address - Address or city name
   */
  async setDestination(address) {
    await this.init();

    // Get geo info for address
    const geoUrl = `https://www.wildberries.ru/__internal/user-geo-data/get-geo-info?currency=RUB&locale=ru&address=${encodeURIComponent(address)}&dt=0&currentLocale=ru&b2bMode=false&newClient=true`;

    try {
      const geoData = await this.apiRequest(geoUrl);
      if (geoData.destinations && geoData.destinations.length > 0) {
        this.dest = geoData.destinations[geoData.destinations.length - 1].toString();
        console.log(`[WB Client] Destination set to ${geoData.address} (dest=${this.dest})`);
        return {
          success: true,
          address: geoData.address,
          dest: this.dest,
          destinations: geoData.destinations
        };
      }
    } catch (e) {
      console.error('[WB Client] Failed to set destination:', e.message);
    }

    return { success: false, error: 'Could not find destination' };
  }

  /**
   * Get available filters for a search query
   * @param {string} query - Search query
   */
  async getFilters(query) {
    await this.init();

    // Load search page
    await this.page.goto(`https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    try {
      await this.page.waitForSelector('.product-card', { timeout: 30000 });
    } catch (e) {
      return { filters: [] };
    }

    await new Promise(r => setTimeout(r, 2000));

    // Extract filter names from page
    const filters = await this.page.evaluate(() => {
      const filterBtns = document.querySelectorAll('[class*="dropdown-filter"] button');
      return Array.from(filterBtns).map(btn => btn.textContent?.trim()).filter(Boolean);
    });

    return {
      query,
      availableFilters: [...new Set(filters)],
      sortOptions: [
        { value: 'popular', name: 'По популярности' },
        { value: 'rate', name: 'По рейтингу' },
        { value: 'priceup', name: 'По возрастанию цены' },
        { value: 'pricedown', name: 'По убыванию цены' },
        { value: 'newly', name: 'По новинкам' }
      ],
      urlParams: {
        'priceU': 'Цена (в копейках, формат: min;max)',
        'frating': 'С рейтингом от 4.7 (значение: 1)',
        'xsubject': 'Категории (ID через точку с запятой)',
        'sort': 'Сортировка',
        'page': 'Номер страницы'
      }
    };
  }
}

export default WBClient;
