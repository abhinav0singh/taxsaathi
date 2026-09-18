// Handler for POST /parseIncome — free text -> Bedrock -> structured fields
// matching what the `calculate` Lambda expects as input.
//
// UPDATED: now calls Bedrock via the Converse API (ConverseCommand) instead
// of raw InvokeModel with an Anthropic-specific request body. Converse is a
// stable, model-agnostic shape -- switching models (this change: Claude ->
// Nova Lite, to route around pending Bedrock model-access approval) means
// changing BEDROCK_MODEL_ID only, not rewriting request/response parsing.
//
// Fallback behavior (SSD.md section 5, PRD.md v2 goal 5) is UNCHANGED: on
// ANY Bedrock failure or timeout, returns a clear "couldn't parse" response
// rather than crashing.

const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const MODEL_ID = process.env.BEDROCK_MODEL_ID;
const BEDROCK_TIMEOUT_MS = 8000;

const client = new BedrockRuntimeClient({});

/** Builds the extraction prompt. Pure function -- unchanged from the Claude version. */
function buildPrompt(text) {
  return `Extract structured income information from the following free-text description written by an Indian taxpayer. Respond with ONLY a single JSON object, no other text, no markdown code fences, matching exactly this shape:

{"grossIncome": <number, annual gross income in rupees>, "isSalaried": <true if salaried employee, false if freelance/self-employed/business income>, "deductions80c": <number, Section 80C investments mentioned, 0 if none mentioned>, "deductions80d": <number, Section 80D health insurance premium mentioned, 0 if none mentioned>}

If the income amount is genuinely not determinable from the text, respond with exactly: {"error": "unable to determine income"}

Text: "${text}"`;
}

/** Validates and coerces the model's raw text output into structured fields. Unchanged. */
function parseModelOutput(rawText) {
  let parsed;
  try {
    const cleaned = String(rawText)
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '');
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, reason: 'MODEL_OUTPUT_NOT_JSON' };
  }

  if (parsed && parsed.error) {
    return { ok: false, reason: 'MODEL_COULD_NOT_DETERMINE_INCOME' };
  }

  const { grossIncome, isSalaried, deductions80c, deductions80d } = parsed || {};

  if (typeof grossIncome !== 'number' || !isFinite(grossIncome) || grossIncome < 0) {
    return { ok: false, reason: 'INVALID_GROSS_INCOME_FIELD' };
  }
  if (typeof isSalaried !== 'boolean') {
    return { ok: false, reason: 'INVALID_IS_SALARIED_FIELD' };
  }

  return {
    ok: true,
    fields: {
      grossIncome,
      isSalaried,
      deductions80c: typeof deductions80c === 'number' && deductions80c >= 0 ? deductions80c : 0,
      deductions80d: typeof deductions80d === 'number' && deductions80d >= 0 ? deductions80d : 0,
    },
  };
}

/**
 * Real Bedrock call via Converse -- the one piece that can't be tested
 * without live AWS access. Request/response shape here is the stable
 * Converse contract (messages[].content[].text in, output.message.content
 * in the array), not a model-specific schema.
 */
async function defaultInvokeModel(prompt) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [
      { role: 'user', content: [{ text: prompt }] },
    ],
    inferenceConfig: { maxTokens: 300, temperature: 0.2 },
  });
  const response = await client.send(command);
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

async function handler(event, { invokeModel = defaultInvokeModel } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
  }

  const { text } = input;
  if (typeof text !== 'string' || text.trim() === '') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'text is required and must be a non-empty string.' }) };
  }

  const prompt = buildPrompt(text);

  let rawOutput;
  try {
    rawOutput = await withTimeout(invokeModel(prompt), BEDROCK_TIMEOUT_MS);
  } catch (err) {
    console.error('Bedrock call failed or timed out:', err.name || '(no error name)', '-', err.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        parsed: false,
        reason: 'BEDROCK_UNAVAILABLE',
        message: "Couldn't understand that automatically — please use the manual form instead.",
      }),
    };
  }

  const result = parseModelOutput(rawOutput);
  if (!result.ok) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        parsed: false,
        reason: result.reason,
        message: "Couldn't understand that automatically — please use the manual form instead.",
      }),
    };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ parsed: true, fields: result.fields }) };
}

module.exports = { handler, buildPrompt, parseModelOutput };
