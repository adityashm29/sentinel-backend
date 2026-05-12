// TypeScript (Node.js: ts-node or tsc). npm i @types/node
const BEARER_TOKEN: string = 'YOUR_BEARER_TOKEN';

interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
  };
}

interface XTweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
  };
  author_id: string;
}

interface XPostResponse {
  data: XTweet[];
  includes?: {
    users: XUser[];
  };
}

interface ParsedUrl {
  username: string;
  postId: string;
}

function parsePostUrl(url: string): ParsedUrl {
  const match = url.match(/https:\/\/x\.com\/([^\/]+)\/status\/(\d+)/i);
  if (!match) throw new Error('Invalid X post URL');
  //@ts-ignore
  return { username: match[1], postId: match[2] };
}

async function getPostAndProfile(postUrl: string): Promise<{ post: XTweet; author: XUser } | undefined> {
  try {
    const { username, postId } = parsePostUrl(postUrl);
    console.log(`Fetching @${username} post ${postId}...`);

    const response = await fetch(
      `https://api.x.com/2/tweets?ids=${postId}&expansions=author_id&user.fields=description,profile_image_url,public_metrics&tweet.fields=text,created_at,public_metrics,author_id`,
      { 
        headers: { 
          Authorization: `Bearer ${BEARER_TOKEN}`,
          'User-Agent': 'v2PostProfileTS'
        } 
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data: XPostResponse = await response.json();
    const post = data.data[0];
    const author = data.includes?.users?.[0];

    if (!post || !author) throw new Error('Post or author not found');

    console.log('Post:');
    console.log(`Text: ${post.text}`);
    console.log(`Likes: ${post.public_metrics.like_count}`);

    console.log('\nAuthor Profile:');
    console.log(`Bio: ${author.description || 'None'}`);
    console.log(`Followers: ${author.public_metrics?.followers_count || 0}`);

    return { post, author };
  } catch (error) {
    console.error('Error:', (error as Error).message);
  }
}

// Usage
getPostAndProfile('https://x.com/elonmusk/status/2047830790114033779');