// Handler for POST /explain — looks up a plain-language explainer snippet
// from DynamoDB by keyword match, no Bedrock call yet. Per SSD.md section 5,
// "return the raw snippet, unphrased" IS the documented Bedrock-failure
// fallback path — so this stage happens to build that fallback path first;
// LLM phrasing is additive on top of this in a later stage, not a
// replacement for it.

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;

/** Lowercase + strip everything but letters/digits, so "80 C" and "80c" compare equal. */
function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Retrieval-lite keyword match (SSD.md section 10 names this explicitly as
 * a hackathon shortcut vs. real vector search — this is that shortcut).
 *
 * A pure function, decoupled from DynamoDB, so it's testable without AWS
 * at all — same pattern as calculator.js. Returns the first item whose
 * topic or any keyword appears as a substring of the normalized question.
 */
function findBestMatch(question, items) {
  const normalizedQuestion = normalize(question);
  if (!normalizedQuestion) return null;

  for (const item of items) {
    const candidates = [item.topic, ...(item.keywords || [])];
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (normalizedCandidate && normalizedQuestion.includes(normalizedCandidate)) {
        return item;
      }
    }
  }
  return null;
}

async function handler(event) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
  }

  const { question } = input;
  if (typeof question !== 'string' || question.trim() === '') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'question is required and must be a non-empty string.' }),
    };
  }

  let items;
  try {
    // Scan, not Query: only 4 rows total, so a full scan every request is
    // fine here (and is exactly what SAM's DynamoDBReadPolicy permits) --
    // this does NOT scale, which is precisely why SSD.md section 10 lists
    // "real vector search" as the production replacement for this table.
    const result = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
    items = (result.Items || []).map(unmarshall);
  } catch (err) {
    console.error('DynamoDB scan failed:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error looking up explainer data.' }) };
  }

  const match = findBestMatch(question, items);
  if (!match) {
    return { statusCode: 200, headers, body: JSON.stringify({ matched: false, topic: null, explanation: null }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ matched: true, topic: match.topic, explanation: match.explanation }),
  };
}

module.exports = { handler, findBestMatch, normalize };
