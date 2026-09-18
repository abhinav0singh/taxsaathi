// Handler for POST /explain — DynamoDB keyword lookup (unchanged), now
// calling Bedrock via Converse instead of raw InvokeModel with an
// Anthropic-specific body. Same model swap rationale as parseIncome.
// Fallback to the raw snippet on any Bedrock failure is UNCHANGED.

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const dynamoClient = new DynamoDBClient({});
const bedrockClient = new BedrockRuntimeClient({});
const TABLE_NAME = process.env.TABLE_NAME;
const MODEL_ID = process.env.BEDROCK_MODEL_ID;
const BEDROCK_TIMEOUT_MS = 8000;

function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

function buildExplainPrompt(explanation, question, calculatedResult) {
  let prompt = `Here is a factual explainer snippet about Indian income tax:\n"${explanation}"\n\nAnswer the user's question using ONLY the information in this snippet and, if given below, their own calculated numbers. Do not invent any numbers or facts not present in what's given here. Keep the answer conversational and under 100 words.\n\nUser's question: "${question}"`;

  if (calculatedResult) {
    prompt += `\n\nThe user's own calculated result (use these exact numbers if relevant, never substitute different ones): ${JSON.stringify(calculatedResult)}`;
  }

  return prompt;
}

/** Real Bedrock call via Converse. */
async function defaultInvokeModel(prompt) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [
      { role: 'user', content: [{ text: prompt }] },
    ],
    inferenceConfig: { maxTokens: 300, temperature: 0.2 },
  });
  const response = await bedrockClient.send(command);
  const content = response.output && response.output.message && response.output.message.content;
  const textBlock = (content || []).find((b) => typeof b.text === 'string');
  if (!textBlock) throw new Error('No text content in Converse response');
  return textBlock.text;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('BEDROCK_TIMEOUT')), ms)),
  ]);
}

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
    console.error('Bedrock call failed or timed out, falling back to raw snippet:', err.name || '(no error name)', '-', err.message);
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
