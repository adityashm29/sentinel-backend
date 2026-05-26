// npm install @mendable/firecrawl-js
import "dotenv/config";
import Firecrawl from '@mendable/firecrawl-js';
const firecrawl = new Firecrawl({ apiKey: process.env.firecrawlKey });
const results = await firecrawl.search('jpmc careers or jobs', {
    limit: 3,
});
console.log(results);
