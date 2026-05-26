// npm install @mendable/firecrawl-js
import "dotenv/config";
// firecrawlKey=fc-3d43f2164347464db5aef806d8b989cb 

import Firecrawl from '@mendable/firecrawl-js';

const firecrawl = new Firecrawl({ apiKey: "fc-3d43f2164347464db5aef806d8b989cb " });

const results = await firecrawl.search('jpmc careers or jobs', {
  limit: 3,
  
});
console.log(results);