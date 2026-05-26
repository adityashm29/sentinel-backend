import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod/v4';
import 'dotenv/config';

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const firecrawl = new Firecrawl({ apiKey: process.env.firecrawlKey! });


const AgentResultSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  cautionFlags: z.array(z.string()),
  positiveSignals: z.array(z.string()),
});
type AgentResult = z.infer<typeof AgentResultSchema>;

const FinalReportSchema = z.object({
  trustScore: z.number().min(0).max(100),
  verdict: z.enum(['SAFE', 'CAUTION', 'LIKELY_SCAM']),
  verdictLabel: z.string(),
  aiSummary: z.string(),
  cautionFlags: z.array(z.string()),
  positiveSignals: z.array(z.string()),
  agents: z.object({
    profileConsistency: AgentResultSchema,
    historicalBehavior: AgentResultSchema,
    linguisticPattern: AgentResultSchema,
    organizationVerification: AgentResultSchema,
    reputationNetwork: AgentResultSchema,
  }),
});


interface XUser {
  id: string;
  name: string;
  username: string;
  description: string;
  public_metrics: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  created_at: string;
  verified: boolean;
  profile_image_url?: string;
  entities?: { urls?: { expanded_url: string }[] };
}

interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    impression_count?: number;
  };
}

async function fetchXUser(username: string): Promise<XUser | null> {
  try {
    const fields = [
      'description', 'public_metrics', 'created_at', 'verified',
      'profile_image_url', 'entities',
    ].join(',');
    const res = await fetch(
      `https://api.twitter.com/2/users/by/username/${username}?user.fields=${fields}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.X_API_BEARER}`,
        },
      }
    );
    if (!res.ok) return null;
    const json = await res.json() as { data?: XUser; errors?: any[] };
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function fetchXTweets(userId: string, max: number = 20): Promise<XTweet[]> {
  try {
    const fields = ['created_at', 'public_metrics'].join(',');
    const res = await fetch(
      `https://api.twitter.com/2/users/${userId}/tweets?max_results=${max}&tweet.fields=${fields}&exclude=retweets,replies`,
      {
        headers: {
          Authorization: `Bearer ${process.env.X_API_BEARER}`,
        },
      }
    );
    if (!res.ok) return [];
    const json = await res.json() as { data?: XTweet[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

// ─── URL parser: extract X username from URL ──────────────────────────────────

function extractXUsername(url: string): string | null {
  // Support: https://x.com/username, https://twitter.com/username/status/..., etc.
  const match = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/);
  if (!match) return null;
  const reserved = ['home', 'explore', 'notifications', 'messages', 'i', 'search'];
//@ts-ignore

  if (reserved.includes(match[1].toLowerCase())) return null;
//@ts-ignore

  return match[1];
}

// ─── Gemini helper ────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<AgentResult> {
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const result = await model.generateContent(prompt);
  let raw = result.response.text().trim();
  console.log('[Gemini raw response]:', raw.substring(0, 200));
  // Strip markdown code fences
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(raw);
  return AgentResultSchema.parse(parsed);
}

// ─── AGENT 1: Profile Consistency ────────

async function profileConsistencyAgent(
  user: XUser | null,
  tweets: XTweet[],
  postText: string
): Promise<AgentResult> {
  const profile = user
    ? `Name: ${user.name}\nUsername: @${user.username}\nBio: ${user.description}\nFollowers: ${user.public_metrics.followers_count}\nFollowing: ${user.public_metrics.following_count}\nTweets: ${user.public_metrics.tweet_count}\nListed: ${user.public_metrics.listed_count}\nCreated At: ${user.created_at}\nVerified: ${user.verified}`
    : 'Profile data unavailable (private or invalid URL).';

  const tweetSample = tweets
    .slice(0, 10)
    .map((t) => `- ${t.text}`)
    .join('\n') || 'No tweets available.';

  const prompt = `You are the Profile Consistency Agent in a job-post scam detection system.
Analyze the recruiter's X (Twitter) profile against their job post to detect inconsistencies, exaggerated hiring authority, misleading professional claims, or mismatches.

Profile Data:
${profile}

Recent Tweets Sample:
${tweetSample}

Job Post Content:
${postText}

Return ONLY a raw JSON object (no markdown). Schema:
{
  "score": <number 0-100, higher = more trustworthy>,
  "summary": "<2-3 sentence analysis>",
  "cautionFlags": ["<flag1>", ...],
  "positiveSignals": ["<signal1>", ...]
}`;

  try {
    console.log('[Agent 1: Profile Consistency] Starting...');
    const result = await callGemini(prompt);
    console.log('[Agent 1: Profile Consistency] Score:', result.score);
    return result;
  } catch (err) {
    console.error('[Agent 1: Profile Consistency] FAILED:', err);
    return { score: 50, summary: 'Profile consistency analysis unavailable.', cautionFlags: [], positiveSignals: [] };
  }
}

// ─── AGENT 2: Historical Behavior ─────────────────────────────────────────────

async function historicalBehaviorAgent(
  user: XUser | null,
  tweets: XTweet[]
): Promise<AgentResult> {
  const profile = user
    ? `Account age: ${user.created_at}\nTotal tweets: ${user.public_metrics.tweet_count}`
    : 'Profile data unavailable.';

  const tweetDump = tweets
    .map((t) => {
      const m = t.public_metrics;
      return `[${t.created_at ?? 'unknown date'}] Likes:${m?.like_count ?? 0} RTs:${m?.retweet_count ?? 0} | ${t.text}`;
    })
    .join('\n') || 'No tweets available.';

  const prompt = `You are the Historical Behavior Agent in a job-post scam detection system.
Analyze the account's post history for spam-like recruitment patterns, repetitive hiring posts, engagement farming, and suspicious posting frequency.

Profile Meta:
${profile}

Tweet History (most recent first):
${tweetDump}

Return ONLY a raw JSON object (no markdown). Schema:
{
  "score": <number 0-100, higher = more trustworthy>,
  "summary": "<2-3 sentence analysis>",
  "cautionFlags": ["<flag1>", ...],
  "positiveSignals": ["<signal1>", ...]
}`;

  try {
    console.log('[Agent 2: Historical Behavior] Starting...');
    const result = await callGemini(prompt);
    console.log('[Agent 2: Historical Behavior] Score:', result.score);
    return result;
  } catch (err) {
    console.error('[Agent 2: Historical Behavior] FAILED:', err);
    return { score: 50, summary: 'Historical behavior analysis unavailable.', cautionFlags: [], positiveSignals: [] };
  }
}

// ─── AGENT 3: Linguistic & Pattern ────────────────────────────────────────────

async function linguisticPatternAgent(postText: string): Promise<AgentResult> {
  const prompt = `You are the Linguistic & Pattern Agent in a job-post scam detection system.
Use NLP analysis to evaluate the language, tone, urgency, and phrasing of this job post.
Detect scam indicators: unrealistic salaries, external redirection, urgency tactics, vague company references, "work from home" overemphasis, unsolicited contact requests, etc.

Job Post:
${postText}

Return ONLY a raw JSON object (no markdown). Schema:
{
  "score": <number 0-100, higher = more trustworthy>,
  "summary": "<2-3 sentence analysis>",
  "cautionFlags": ["<flag1>", ...],
  "positiveSignals": ["<signal1>", ...]
}`;

  try {
    console.log('[Agent 3: Linguistic & Pattern] Starting...');
    const result = await callGemini(prompt);
    console.log('[Agent 3: Linguistic & Pattern] Score:', result.score);
    return result;
  } catch (err) {
    console.error('[Agent 3: Linguistic & Pattern] FAILED:', err);
    return { score: 50, summary: 'Linguistic analysis unavailable.', cautionFlags: [], positiveSignals: [] };
  }
}

// ─── AGENT 4: Organization Verification ───────────────────────────────────────

async function organizationVerificationAgent(postText: string): Promise<AgentResult> {
  // Extract company name from post text using Gemini first
  let companyName = '';
  try {
    console.log('[Agent 4: Org Verification] Extracting company name...');
    const extractModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const extractResult = await extractModel.generateContent(
      `Extract only the company/organization name from this job post. Return ONLY the company name, nothing else. If no clear company is mentioned, return "Unknown".\n\nJob Post:\n${postText}`
    );
    companyName = extractResult.response.text().trim().replace(/^["']|["']$/g, '');
    console.log('[Agent 4: Org Verification] Company extracted:', companyName);
  } catch (err) {
    console.error('[Agent 4: Org Verification] Company extraction FAILED:', err);
    companyName = 'Unknown';
  }

  // Firecrawl search for company verification
  let firecrawlData = '';
  if (companyName && companyName !== 'Unknown') {
    try {
      console.log('[Agent 4: Org Verification] Searching Firecrawl for:', companyName);
      const searchResults = await firecrawl.search(`${companyName} careers jobs official site`, { limit: 3 });
      //@ts-ignore
      if (searchResults.data && searchResults.data.length > 0) {
        //@ts-ignore
        firecrawlData = searchResults.data
          .map((r: any) => `Title: ${r.title ?? ''}\nURL: ${r.url ?? ''}\nSnippet: ${(r.description ?? r.markdown ?? '').substring(0, 300)}`)
          .join('\n\n');
          //@ts-ignore
        console.log('[Agent 4: Org Verification] Firecrawl returned', searchResults.data.length, 'results');
      } else {
        console.log('[Agent 4: Org Verification] Firecrawl returned no results');
      }
    } catch (err) {
      console.error('[Agent 4: Org Verification] Firecrawl FAILED:', err);
      firecrawlData = 'Web search unavailable.';
    }
  }

  const prompt = `You are the Organization Verification Agent in a job-post scam detection system.
Verify the legitimacy of the company referenced in this job post using the web search results provided.
Check for: official website evidence, real hiring pages, legitimate company presence, domain authenticity.

Extracted Company Name: ${companyName}

Job Post:
${postText}

Web Search Results:
${firecrawlData || 'No search results available.'}

Return ONLY a raw JSON object (no markdown). Schema:
{
  "score": <number 0-100, higher = more trustworthy>,
  "summary": "<2-3 sentence analysis>",
  "cautionFlags": ["<flag1>", ...],
  "positiveSignals": ["<signal1>", ...]
}`;

  try {
    console.log('[Agent 4: Org Verification] Running Gemini analysis...');
    const result = await callGemini(prompt);
    console.log('[Agent 4: Org Verification] Score:', result.score);
    return result;
  } catch (err) {
    console.error('[Agent 4: Org Verification] FAILED:', err);
    return { score: 50, summary: 'Organization verification unavailable.', cautionFlags: [], positiveSignals: [] };
  }
}

// ─── AGENT 5: Reputation & Network ────────────────────────────────────────────

async function reputationNetworkAgent(
  user: XUser | null,
  tweets: XTweet[]
): Promise<AgentResult> {
  if (!user) {
    return {
      score: 30,
      summary: 'Could not retrieve profile data for reputation analysis.',
      cautionFlags: ['Profile is private or invalid URL provided'],
      positiveSignals: [],
    };
  }

  // Calculate engagement rate from available tweets
  const totalEngagement = tweets.reduce((sum, t) => {
    const m = t.public_metrics;
    return sum + (m?.like_count ?? 0) + (m?.retweet_count ?? 0) + (m?.reply_count ?? 0);
  }, 0);
  const avgEngagement = tweets.length > 0 ? (totalEngagement / tweets.length).toFixed(2) : '0';
  const followerRatio = user.public_metrics.followers_count > 0
    ? (user.public_metrics.following_count / user.public_metrics.followers_count).toFixed(2)
    : 'N/A';

  const prompt = `You are the Reputation & Network Agent in a job-post scam detection system.
Evaluate this X (Twitter) account's credibility based on follower quality, engagement patterns, account age, and network trust indicators.

Account Metrics:
- Followers: ${user.public_metrics.followers_count}
- Following: ${user.public_metrics.following_count}
- Following/Follower Ratio: ${followerRatio}
- Total Tweets: ${user.public_metrics.tweet_count}
- Listed Count: ${user.public_metrics.listed_count}
- Verified: ${user.verified}
- Account Created: ${user.created_at}
- Avg Engagement Per Post (sample): ${avgEngagement}
- Total Tweets Analyzed: ${tweets.length}

Return ONLY a raw JSON object (no markdown). Schema:
{
  "score": <number 0-100, higher = more trustworthy>,
  "summary": "<2-3 sentence analysis>",
  "cautionFlags": ["<flag1>", ...],
  "positiveSignals": ["<signal1>", ...]
}`;

  try {
    console.log('[Agent 5: Reputation & Network] Starting...');
    const result = await callGemini(prompt);
    console.log('[Agent 5: Reputation & Network] Score:', result.score);
    return result;
  } catch (err) {
    console.error('[Agent 5: Reputation & Network] FAILED:', err);
    return { score: 50, summary: 'Reputation analysis unavailable.', cautionFlags: [], positiveSignals: [] };
  }
}

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────

function computeWeightedScore(agents: {
  profileConsistency: AgentResult;
  historicalBehavior: AgentResult;
  linguisticPattern: AgentResult;
  organizationVerification: AgentResult;
  reputationNetwork: AgentResult;
}): number {
  // Weights: linguistic 30%, org verification 25%, profile 20%, reputation 15%, history 10%
  const weights = {
    linguisticPattern: 0.30,
    organizationVerification: 0.25,
    profileConsistency: 0.20,
    reputationNetwork: 0.15,
    historicalBehavior: 0.10,
  };
  const score = Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + agents[key as keyof typeof agents].score * weight;
  }, 0);
  return Math.round(score);
}

function getVerdict(score: number): { verdict: 'SAFE' | 'CAUTION' | 'LIKELY_SCAM'; verdictLabel: string } {
  if (score >= 70) return { verdict: 'SAFE', verdictLabel: 'This post appears legitimate' };
  if (score >= 40) return { verdict: 'CAUTION', verdictLabel: 'Proceed with caution' };
  return { verdict: 'LIKELY_SCAM', verdictLabel: 'High risk — likely a scam' };
}

// ─── ROUTE ─────────────

router.post('/analyze', async (req, res) => {
  try {
    const { url, postText } = req.body;

    if (!url && !postText) {
      return res.status(400).json({ error: 'Provide either a post URL or post text.' });
    }

    // Extract username from X/Twitter URL
    const username = url ? extractXUsername(url) : null;
    console.log('[Orchestrator] Input URL:', url, '| Extracted username:', username);
    console.log('[Orchestrator] Post text length:', (postText || '').length, 'chars');

    // Fetch X data in parallel
    let user: XUser | null = null;
    let tweets: XTweet[] = [];

    if (username) {
      console.log('[Orchestrator] Fetching X profile for @' + username);
      user = await fetchXUser(username);
      console.log('[Orchestrator] X user fetched:', user ? `@${user.username} (${user.public_metrics.followers_count} followers)` : 'NOT FOUND');
      if (user) {
        tweets = await fetchXTweets(user.id, 20);
        console.log('[Orchestrator] Tweets fetched:', tweets.length);
      }
    }

    // The text to analyze — use postText if provided, otherwise use URL
    const content = postText || url || '';

    console.log('[Orchestrator] Running all 5 agents in parallel...');
    // Run agents in parallel (all receive their needed data)
    const [profileConsistency, historicalBehavior, linguisticPattern, organizationVerification, reputationNetwork] =
      await Promise.all([
        profileConsistencyAgent(user, tweets, content),
        historicalBehaviorAgent(user, tweets),
        linguisticPatternAgent(content),
        organizationVerificationAgent(content),
        reputationNetworkAgent(user, tweets),
      ]);

    console.log('[Orchestrator] All agents done. Scores — Profile:', profileConsistency.score, '| History:', historicalBehavior.score, '| Linguistic:', linguisticPattern.score, '| OrgVerify:', organizationVerification.score, '| Reputation:', reputationNetwork.score);

    const agentResults = {
      profileConsistency,
      historicalBehavior,
      linguisticPattern,
      organizationVerification,
      reputationNetwork,
    };

    const trustScore = computeWeightedScore(agentResults);
    const { verdict, verdictLabel } = getVerdict(trustScore);
    console.log('[Orchestrator] Final trust score:', trustScore, '| Verdict:', verdict);

    // Aggregate all flags and signals, deduplicate
    const allCautionFlags = [
      ...new Set([
        ...profileConsistency.cautionFlags,
        ...historicalBehavior.cautionFlags,
        ...linguisticPattern.cautionFlags,
        ...organizationVerification.cautionFlags,
        ...reputationNetwork.cautionFlags,
      ]),
    ];

    const allPositiveSignals = [
      ...new Set([
        ...profileConsistency.positiveSignals,
        ...historicalBehavior.positiveSignals,
        ...linguisticPattern.positiveSignals,
        ...organizationVerification.positiveSignals,
        ...reputationNetwork.positiveSignals,
      ]),
    ];

    // AI summary from Gemini
    let aiSummary = '';
    try {
      console.log('[Orchestrator] Generating AI summary...');
      const summaryModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const summaryResult = await summaryModel.generateContent(
        `Summarize this job post scam analysis in 2-3 sentences for a job seeker. Trust score: ${trustScore}/100. Verdict: ${verdictLabel}. Key caution flags: ${allCautionFlags.slice(0, 3).join('; ')}. Key positive signals: ${allPositiveSignals.slice(0, 3).join('; ')}. Be direct and helpful.`
      );
      aiSummary = summaryResult.response.text().trim();
      console.log('[Orchestrator] Summary generated.');
    } catch (err) {
      console.error('[Orchestrator] Summary generation FAILED:', err);
      aiSummary = `This post received a trust score of ${trustScore}/100. ${verdictLabel}.`;
    }

    const report = FinalReportSchema.parse({
      trustScore,
      verdict,
      verdictLabel,
      aiSummary,
      cautionFlags: allCautionFlags,
      positiveSignals: allPositiveSignals,
      agents: agentResults,
    });

    return res.json(report);
  } catch (err: any) {
    console.error('[jobpost] Error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

export default router;
