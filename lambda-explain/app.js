// Handler for POST /explain — DynamoDB keyword lookup (unchanged, already
// tested), now with a Bedrock call on top to phrase a grounded, personalized
// answer using the snippet + the user's own calculated numbers. On ANY
// Bedrock failure, falls back to the raw snippet text -- which is exactly
// this Lambda's PREVIOUS entire behavior, so the fallback path is provably
// solid: it's not new code, it's the old code with nothing removed.

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const dynamoClient = new DynamoDBClient({});
const bedrockClient = new BedrockRuntimeClient({});
const TABLE_NAME = process.env.TABLE_NAME;
const MODEL_ID = process.env.BEDROCK_MODEL_ID;
const BEDROCK_TIMEOUT_MS = 8000;

/** Lowercase + strip everything but letters/digits, so "80 C" and "80c" compare equal. */
function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Retrieval-lite keyword match — unchanged from the DynamoDB-only stage. */
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

/**
 * Pure function -- testable without AWS. Grounds the model strictly in the
 * snippet + the user's own numbers, explicitly forbidding invented figures,
 * per TEST_PLAN.md section 5's "response is grounded... doesn't invent
 * numbers not in the user's result" requirement.
 */
function buildExplainPrompt(explanation, question, calculatedResult) {
  let prompt = `Here is a factual explainer snippet about Indian income tax:\n"${explanation}"\n\nAnswer the user's question using ONLY the information in this snippet and, if given below, their own calculated numbers. Do not invent any numbers or facts not present in what's given here. Keep the answer conversational and under 100 words.\n\nUser's question: "${question}"`;

  if (calculatedResult) {
    prompt += `\n\nThe user's own calculated result (use these exact numbers if relevant, never substitute different ones): ${JSON.stringify(calculatedResult)}`;
  }

  return prompt;
}

/** Real Bedrock call -- the one piece that can't be tested without live AWS access. */
async function defaultInvokeModel(prompt) {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31', // verify against current Bedrock/Anthropic docs
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const textBlock = (responseBody.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text content in model response');
  return textBlock.text;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('BEDROCK_TIMEOUT')), ms)),
  ]);
}

/**
 * invokeModel and scanTable are both injectable, defaulting to the real
 * AWS calls -- lets tests exercise the Bedrock-success path, the
 * Bedrock-failure fallback path, and the no-match path, all for real,
 * without touching AWS. See test_explain.js.
 */
async function handler(event, { invokeModel = defaultInvokeModel, scanTable } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
  }

  const { question, calculatedResult } = input;
  if (typeof question !== 'string' || question.trim() === '') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'question is required and must be a non-empty string.' }),
    };
  }

  let items;
  try {
    if (scanTable) {
      items = await scanTable();
    } else {
      const result = await dynamoClient.send(new ScanCommand({ TableName: TABLE_NAME }));
      items = (result.Items || []).map(unmarshall);
    }
  } catch (err) {
    console.error('DynamoDB scan failed:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error looking up explainer data.' }) };
  }

  const match = findBestMatch(question, items);
  if (!match) {
    return { statusCode: 200, headers, body: JSON.stringify({ matched: false, topic: null, explanation: null }) };
  }

  const prompt = buildExplainPrompt(match.explanation, question, calculatedResult);

  let phrasedAnswer;
  try {
    phrasedAnswer = await withTimeout(invokeModel(prompt), BEDROCK_TIMEOUT_MS);
  } catch (err) {
    console.error('Bedrock call failed or timed out, falling back to raw snippet:', err.message);
    // SSD.md section 5, explicitly: raw snippet text, unphrased, not a
    // crash or empty response. This is literally the pre-Bedrock behavior.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ matched: true, topic: match.topic, explanation: match.explanation, phrased: false }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ matched: true, topic: match.topic, explanation: phrasedAnswer, phrased: true }),
  };
}

module.exports = { handler, findBestMatch, normalize, buildExplainPrompt };
