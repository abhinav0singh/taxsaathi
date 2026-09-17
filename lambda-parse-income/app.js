// Handler for POST /parseIncome — free text -> Bedrock -> structured fields
// matching what the `calculate` Lambda expects as input. Per SSD.md section
// 5 (PRD.md v2 goal 5: not optional), on ANY Bedrock failure or timeout,
// this returns a clear "couldn't parse" response rather than crashing —
// the frontend is expected to fall back to the manual structured form.

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const MODEL_ID = process.env.BEDROCK_MODEL_ID;
const BEDROCK_TIMEOUT_MS = 8000;

const client = new BedrockRuntimeClient({});

/**
 * Builds the extraction prompt. Pure function -- testable without AWS.
 * Asks for JSON only, gives an explicit schema, and gives the model an
 * explicit escape hatch ({"error": ...}) for genuinely unparseable text,
 * so "I can't tell" produces a clean signal instead of a hallucinated guess.
 */
function buildPrompt(text) {
  return `Extract structured income information from the following free-text description written by an Indian taxpayer. Respond with ONLY a single JSON object, no other text, no markdown code fences, matching exactly this shape:

{"grossIncome": <number, annual gross income in rupees>, "isSalaried": <true if salaried employee, false if freelance/self-employed/business income>, "deductions80c": <number, Section 80C investments mentioned, 0 if none mentioned>, "deductions80d": <number, Section 80D health insurance premium mentioned, 0 if none mentioned>}

If the income amount is genuinely not determinable from the text, respond with exactly: {"error": "unable to determine income"}

Text: "${text}"`;
}

/**
 * Validates and coerces the model's raw text output into structured fields.
 * Pure function -- testable with fake model outputs, no AWS needed. This is
 * the layer that keeps a slightly-malformed or creatively-formatted model
 * response from silently becoming bad data downstream.
 */
function parseModelOutput(rawText) {
  let parsed;
  try {
    // Models sometimes wrap JSON in markdown fences despite instructions
    // not to -- strip defensively rather than fail on a cosmetic deviation.
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

/** Real Bedrock call -- the one piece that genuinely can't be tested without live AWS access. */
async function defaultInvokeModel(prompt) {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31', // verify against current Bedrock/Anthropic docs -- not independently verifiable from here
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const response = await client.send(command);
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
 * invokeModel is injectable (defaults to the real Bedrock call) specifically
 * so the fallback path can be tested for real with a fake success/failure,
 * without needing live AWS credentials -- see test_parse_income.js.
 */
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
    console.error('Bedrock call failed or timed out:', err.message);
    // 200, not 500: an unavailable/slow model is an ANTICIPATED, handled
    // state (SSD.md section 5), not a server error. The frontend reads
    // parsed:false and switches to the manual form -- this is app-level
    // routing, not an HTTP failure.
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
