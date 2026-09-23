import * as THREE from "three";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  incomeType: "salary",
  inputs: null,
  result: null,
  apiOnline: false,
};

const apiBase = () => {
  const params = new URLSearchParams(window.location.search);
  const configured = window.TAXSAATHI_CONFIG?.apiBase || window.TAXSAATHI_API_BASE || $("meta[name='taxsaathi-api-base']")?.content;
  return (configured || localStorage.getItem("taxsaathi_api_base") || params.get("api") || "").replace(/\/$/, "");
};

const apiUrl = (path) => `${apiBase()}${path}`;
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value) => `₹${Math.round(number(value)).toLocaleString("en-IN")}`;
const shortMoney = (value) => {
  const amount = number(value);
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(amount % 100000 ? 1 : 0)}L`;
  if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}K`;
  return money(amount);
};
const percent = (value) => `${number(value).toFixed(2).replace(/\.00$/, "")} %`;
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
const unwrap = (value) => value?.data || value?.result || value;

function readInputs() {
  return {
    grossIncome: Math.max(0, number($("#gross-income").value)),
    incomeType: $("#income-type").value || state.incomeType,
    section80C: Math.max(0, number($("#deduction-80c").value)),
    section80D: Math.max(0, number($("#deduction-80d").value)),
    otherDeductions: Math.max(0, number($("#other-deductions").value)),
  };
}

function calculatePayload(inputs) {
  // The flat names mirror the Lambda contract; aliases are harmless to the
  // current handler and make this client tolerant of older deployed builds.
  return {
    grossIncome: inputs.grossIncome,
    incomeType: inputs.incomeType,
    section80C: inputs.section80C,
    section80D: inputs.section80D,
    otherDeductions: inputs.otherDeductions,
    income: inputs.grossIncome,
    type: inputs.incomeType,
    deductions: {
      section80C: inputs.section80C,
      section80D: inputs.section80D,
      other: inputs.otherDeductions,
    },
  };
}

async function request(path, payload, timeout = 16000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { message: raw }; }
    if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status})`);
    return body;
  } finally {
    window.clearTimeout(timer);
  }
}

function progressiveTax(taxable, slabs) {
  let tax = 0;
  let previous = 0;
  for (const [limit, rate] of slabs) {
    if (taxable <= previous) break;
    tax += (Math.min(taxable, limit) - previous) * rate;
    previous = limit;
    if (!Number.isFinite(limit)) break;
  }
  return tax;
}

function offlineRegime(taxable, regime, incomeType) {
  const slabs = regime === "new"
    ? [[400000, 0], [800000, .05], [1200000, .10], [1600000, .15], [2000000, .20], [2400000, .25], [Infinity, .30]]
    : [[250000, 0], [500000, .05], [1000000, .20], [Infinity, .30]];
  let baseTax = progressiveTax(taxable, slabs);
  if (regime === "new" && taxable <= 1200000) baseTax = 0;
  if (regime === "new" && taxable > 1200000 && taxable <= 1270000) baseTax = Math.min(baseTax, taxable - 1200000);
  if (regime === "old" && taxable <= 500000) baseTax = 0;
  const surcharge = taxable > 5000000 ? baseTax * .1 : 0;
  const totalTax = (baseTax + surcharge) * 1.04;
  return { taxableIncome: taxable, tax: totalTax, totalTax, effectiveRate: taxable ? totalTax / taxable : 0, marginalRate: slabs.find(([, rate], index) => taxable <= slabs[index][0])?.[1] || .3 };
}

function offlineCalculate(inputs) {
  const salaryDeduction = inputs.incomeType === "salary" ? 50000 : 0;
  const oldTaxable = Math.max(0, inputs.grossIncome - salaryDeduction - Math.min(inputs.section80C, 150000) - Math.min(inputs.section80D, 25000) - inputs.otherDeductions);
  const newTaxable = Math.max(0, inputs.grossIncome - salaryDeduction);
  const oldRegime = offlineRegime(oldTaxable, "old", inputs.incomeType);
  const newRegime = offlineRegime(newTaxable, "new", inputs.incomeType);
  const winner = newRegime.totalTax <= oldRegime.totalTax ? "new" : "old";
  const wall = newTaxable <= 1200000 ? { status: "below", distance: 1200000 - newTaxable } : newTaxable <= 1270000 ? { status: "inside", distance: newTaxable - 1200000 } : { status: "past", distance: newTaxable - 1270000 };
  const nextLimit = [400000, 800000, 1200000, 1600000, 2000000, 2400000].find((limit) => limit > newTaxable) || null;
  return {
    oldRegime,
    newRegime,
    recommendedRegime: winner,
    regime: winner,
    taxDifference: Math.abs(oldRegime.totalTax - newRegime.totalTax),
    rebateWall: wall,
    rebateCliffProximity: wall,
    deductionHeadroom: { section80C: Math.max(0, 150000 - Math.min(inputs.section80C, 150000)), used80C: Math.min(inputs.section80C, 150000), max80C: 150000 },
    slabBoundary: { amountToNextSlab: nextLimit ? nextLimit - newTaxable : 0, nextBoundary: nextLimit },
    compareAcrossYears: { previousTax: offlineRegime(Math.max(0, inputs.grossIncome - salaryDeduction - Math.min(inputs.section80C, 150000) - Math.min(inputs.section80D, 25000) - inputs.otherDeductions), "old", inputs.incomeType).totalTax },
    offline: true,
  };
}

function normalizeRegime(raw, fallback) {
  const item = raw || {};
  const tax = number(first(item.totalTax, item.taxPayable, item.finalTax, item.tax, item.total, fallback));
  const taxable = number(first(item.taxableIncome, item.taxable, item.incomeAfterDeductions, item.taxBase, 0));
  return { tax, totalTax: tax, taxableIncome: taxable, effectiveRate: number(first(item.effectiveRate, item.effectiveTaxRate, taxable ? tax / taxable : 0)), marginalRate: number(first(item.marginalRate, item.marginalTaxRate, 0)) };
}

function normalizeResult(payload, inputs) {
  const data = unwrap(payload) || {};
  const old = normalizeRegime(first(data.oldRegime, data.old, data.oldRegimeResult, data.comparison?.oldRegime), 0);
  const modern = normalizeRegime(first(data.newRegime, data.new, data.newRegimeResult, data.comparison?.newRegime), 0);
  const recommended = String(first(data.recommendedRegime, data.regime, data.bestRegime, modern.tax <= old.tax ? "new" : "old")).toLowerCase().includes("old") ? "old" : "new";
  const wall = first(data.rebateWall, data.rebateCliffProximity, data.cliffProximity, data.signals?.rebateWall) || {};
  const headroom = first(data.deductionHeadroom, data.analyzeDeductionHeadroom, data.signals?.deductionHeadroom) || {};
  const boundary = first(data.slabBoundary, data.analyzeSlabBoundary, data.signals?.slabBoundary) || {};
  const previous = first(data.compareAcrossYears?.previousTax, data.compareAcrossYears?.oldTax, data.historicalComparison?.previousTax, data.thenVsNow?.previousTax, data.previousYearTax);
  return {
    raw: data,
    oldRegime: old,
    newRegime: modern,
    recommendedRegime: recommended,
    taxDifference: number(first(data.taxDifference, data.difference, Math.abs(old.tax - modern.tax))),
    wall,
    headroom,
    boundary,
    previousTax: number(previous),
    offline: Boolean(data.offline),
    inputs,
  };
}

function setConnection(online, label = online ? "api connected" : "offline estimate") {
  state.apiOnline = online;
  $("#connection-label").textContent = label;
  $(".status-dot").style.background = online ? "#83d7aa" : "#f0ba68";
  $(".status-dot").style.boxShadow = online ? "0 0 0 4px rgba(131,215,170,.18)" : "0 0 0 4px rgba(240,186,104,.16)";
}

function regimeView(result, key) {
  const regime = result[key];
  $(key === "newRegime" ? "#new-tax" : "#old-tax").textContent = money(regime.tax);
  const effectiveRate = number(regime.effectiveRate);
  $(key === "newRegime" ? "#new-effective-rate" : "#old-effective-rate").textContent = percent(effectiveRate <= 1 ? effectiveRate * 100 : effectiveRate);
  $(key === "newRegime" ? "#new-taxable-income" : "#old-taxable-income").textContent = money(regime.taxableIncome);
}

function renderResult(result) {
  state.result = result;
  regimeView(result, "newRegime");
  regimeView(result, "oldRegime");
  const winnerText = result.recommendedRegime === "new" ? "new regime leads" : "old regime leads";
  $("#result-badge").textContent = winnerText;
  $("#result-caption").textContent = result.offline ? "Offline estimate — reconnect to verify against the backend" : "Calculated from your current inputs";
  $("#tax-difference").textContent = `${money(result.taxDifference)} / year`;
  const maxTax = Math.max(result.oldRegime.tax, result.newRegime.tax, 1);
  $("#comparison-fill").style.width = `${Math.max(7, Math.min(93, (result.taxDifference / maxTax) * 100))}%`;
  $("#comparison-note").textContent = result.taxDifference ? `${result.recommendedRegime === "new" ? "New" : "Old"} Regime leaves approximately ${money(result.taxDifference)} more in your pocket under these inputs.` : "The two estimates are currently the same — your inputs sit on a crossover point.";

  const wall = result.wall || {};
  const wallStatus = String(first(wall.status, wall.zone, wall.label, "")).toLowerCase();
  if (wallStatus.includes("inside") || wallStatus.includes("wall") || wallStatus.includes("near")) {
    $("#wall-message").textContent = "You are inside the high-friction marginal-relief zone. Each extra rupee here can feel unusually expensive.";
    $("#wall-stat").textContent = `${shortMoney(first(wall.distance, wall.amountAboveThreshold, 0))} into the zone`;
  } else if (wallStatus.includes("past")) {
    $("#wall-message").textContent = "You are past the rebate wall zone. Your next useful signal is the distance to the next slab boundary.";
    $("#wall-stat").textContent = "wall cleared";
  } else {
    const distance = number(first(wall.distance, wall.amountToThreshold, 1200000 - result.newRegime.taxableIncome));
    $("#wall-message").textContent = distance > 0 ? "You are below the wall today. We show the distance so the threshold is never a surprise." : "The wall signal is not active for this income.";
    $("#wall-stat").textContent = distance > 0 ? `${shortMoney(distance)} from wall` : "not active";
  }

  const headroom = result.headroom || {};
  const remaining = Math.max(0, number(first(headroom.section80C, headroom.remaining80C, headroom.headroom80C, headroom.remaining, 150000 - Math.min(result.inputs.section80C, 150000))));
  const used = Math.min(150000, number(first(headroom.used80C, result.inputs.section80C)));
  $("#headroom-stat").innerHTML = `${shortMoney(remaining)} <small>available in 80C</small>`;
  $("#headroom-message").textContent = remaining ? `You still have ${money(remaining)} of 80C room available under this estimate.` : "Your modeled 80C allowance is fully used. Nice — no headroom left to chase.";
  $("#headroom-meter-fill").style.width = `${(used / 150000) * 100}%`;

  const boundary = result.boundary || {};
  const amountToBoundary = number(first(boundary.amountToNextSlab, boundary.distance, boundary.amount, boundary.remaining, 0));
  $("#boundary-stat").textContent = amountToBoundary > 0 ? `${shortMoney(amountToBoundary)} to go` : "next edge unknown";
  $("#boundary-message").textContent = amountToBoundary > 0 ? `You can earn another ${money(amountToBoundary)} before the next modeled slab boundary.` : "The backend did not return a slab boundary for this result.";

  $("#historical-tax").textContent = result.previousTax ? money(result.previousTax) : "₹—";
  $("#current-year-tax").textContent = money(result.newRegime.tax);
  $("#results").classList.add("has-result");
  $("#results").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

function localParse(text) {
  const lower = text.toLowerCase();
  const lakh = lower.match(/([\d,.]+)\s*(?:lakh|lac|l)/);
  const raw = lower.match(/(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(?:per year|annual|yearly)?/);
  const income = lakh ? number(lakh[1].replace(/,/g, "")) * 100000 : raw ? number(raw[1].replace(/,/g, "")) : 0;
  return { grossIncome: income, incomeType: /freelance|business|consult/i.test(lower) ? "freelance" : "salary" };
}

function fillInputs(parsed) {
  const data = unwrap(parsed) || {};
  const income = first(data.grossIncome, data.annualIncome, data.income, data.salary, data.amount);
  const type = first(data.incomeType, data.type, data.source);
  if (income !== undefined) $("#gross-income").value = number(income) > 10000 ? number(income) : number(income) * 100000;
  if (type) setIncomeType(String(type).toLowerCase().includes("free") || String(type).toLowerCase().includes("business") ? "freelance" : "salary");
  if (first(data.section80C, data.deduction80C, data.deductions?.section80C) !== undefined) $("#deduction-80c").value = number(first(data.section80C, data.deduction80C, data.deductions?.section80C));
  if (first(data.section80D, data.deduction80D, data.deductions?.section80D) !== undefined) $("#deduction-80d").value = number(first(data.section80D, data.deduction80D, data.deductions?.section80D));
  if (first(data.otherDeductions, data.deductions?.other, data.other) !== undefined) $("#other-deductions").value = number(first(data.otherDeductions, data.deductions?.other, data.other));
}

function setIncomeType(type) {
  state.incomeType = type;
  $("#income-type").value = type;
  $$(".segment").forEach((button) => button.classList.toggle("active", button.dataset.incomeType === type));
}

async function calculate(event) {
  event?.preventDefault();
  const inputs = readInputs();
  $("#form-error").textContent = "";
  if (!inputs.grossIncome) { $("#form-error").textContent = "Add your annual income to continue."; $("#gross-income").focus(); return; }
  $("#tax-form").classList.add("is-busy");
  try {
    const live = await request("/calculate", calculatePayload(inputs));
    setConnection(true);
    renderResult(normalizeResult(live, inputs));
  } catch (error) {
    console.warn("TaxSaathi API unavailable; showing a local estimate.", error);
    setConnection(false);
    renderResult(normalizeResult(offlineCalculate(inputs), inputs));
  } finally {
    $("#tax-form").classList.remove("is-busy");
  }
}

async function parseIncome() {
  const text = $("#free-text").value.trim();
  if (!text) { $("#free-text").focus(); return; }
  $("#parse-button").classList.add("is-busy");
  try {
    const parsed = await request("/parseIncome", { text, input: text, description: text });
    fillInputs(parsed);
    setConnection(true);
    $("#free-text").value = "";
  } catch (error) {
    console.warn("TaxSaathi parser unavailable; using local extraction.", error);
    fillInputs(localParse(text));
    setConnection(false);
  } finally {
    $("#parse-button").classList.remove("is-busy");
  }
}

async function askQuestion() {
  const question = $("#question-input").value.trim();
  if (!question) { $("#question-input").focus(); return; }
  const box = $("#answer-box");
  box.innerHTML = '<p class="answer-content">Saathi is checking the reference…</p>';
  $("#ask-button").classList.add("is-busy");
  try {
    const answer = await request("/explain", { question, query: question, context: state.result?.raw || {}, calculation: state.result?.raw || {} });
    const data = unwrap(answer) || {};
    const text = first(data.answer, data.explanation, data.response, data.text, data.message, "I couldn't find a reference answer for that yet.");
    box.innerHTML = `<p class="answer-content"></p>`;
    $(".answer-content", box).textContent = text;
    $("#answer-source").textContent = data.fallback || data.usedFallback || data.source ? "Reference answer / fallback-safe" : "Grounded answer from TaxSaathi";
    setConnection(true);
  } catch (error) {
    const text = localAnswer(question);
    box.innerHTML = '<p class="answer-content"></p>';
    $(".answer-content", box).textContent = text;
    $("#answer-source").textContent = "Local reference fallback — AI layer unavailable";
    setConnection(false);
  } finally {
    $("#ask-button").classList.remove("is-busy");
  }
}

function localAnswer(question) {
  const lower = question.toLowerCase();
  if (lower.includes("80c")) return "Section 80C covers common investments such as EPF, PPF, ELSS, life insurance premiums and home-loan principal. This estimate models a combined annual cap of ₹1,50,000 under the Old Regime.";
  if (lower.includes("rebate") || lower.includes("12 lakh") || lower.includes("12l")) return "Under the New Regime, taxable income up to ₹12,00,000 can qualify for the rebate. Just above that, marginal relief limits the tax increase to the amount above ₹12,00,000, creating the rebate wall zone.";
  if (lower.includes("old") || lower.includes("new") || lower.includes("regime")) return "For most earners without large Old Regime deductions, the New Regime tends to be ahead — but your own income and deductions are what decide it. Run the comparison above for your numbers.";
  return "TaxSaathi can answer questions about 80C, 80D, the ₹12L rebate wall and the Old vs New Regime comparison. Try asking about one of those topics.";
}

function initScene() {
  const canvas = $("#scene-canvas");
  if (!canvas) return;
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
    camera.position.set(0, 4.4, 15.5);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x101714, 1);
    scene.add(new THREE.AmbientLight(0xd5f6e1, 1.35));
    const key = new THREE.DirectionalLight(0xf5d2a4, 2.5); key.position.set(-5, 8, 8); scene.add(key);
    const fill = new THREE.PointLight(0x85d9ad, 12, 18); fill.position.set(5, 1, 4); scene.add(fill);
    const group = new THREE.Group(); group.rotation.x = -.13; scene.add(group);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), new THREE.MeshStandardMaterial({ color: 0x15221b, roughness: .85, metalness: .05 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -2.05; group.add(floor);
    const grid = new THREE.GridHelper(18, 18, 0x355244, 0x20362a); grid.position.y = -2.01; grid.material.transparent = true; grid.material.opacity = .42; group.add(grid);
    const slabs = [1.05, 1.35, 1.85, 2.35, 3.05, 3.8, 4.28];
    slabs.forEach((height, index) => {
      const width = index === 4 ? 1.4 : 1.1;
      const wall = index === 4;
      const geometry = new THREE.BoxGeometry(width, height, 1.22);
      const material = new THREE.MeshStandardMaterial({ color: wall ? 0xf39a6e : index % 2 ? 0x8bd9ad : 0x567e69, roughness: .38, metalness: .12 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((index - 3) * 1.45, height / 2 - 2, 0);
      mesh.rotation.y = wall ? -.08 : (index - 3) * .015;
      group.add(mesh);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(width * .98, .045, 1.25), new THREE.MeshBasicMaterial({ color: wall ? 0xffc2a1 : 0xd0f5dc, transparent: true, opacity: .7 }));
      cap.position.set(mesh.position.x, mesh.position.y + height / 2 + .025, mesh.position.z); group.add(cap);
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.9, .012, 8, 96), new THREE.MeshBasicMaterial({ color: 0x6ca887, transparent: true, opacity: .34 })); ring.rotation.x = Math.PI / 2; ring.position.y = .4; ring.rotation.z = -.13; group.add(ring);
    const particles = new THREE.Group();
    for (let index = 0; index < 50; index += 1) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(.018 + Math.random() * .027, 6, 6), new THREE.MeshBasicMaterial({ color: index % 5 === 0 ? 0xf39a6e : 0xb8f0cf, transparent: true, opacity: .6 }));
      dot.position.set((Math.random() - .5) * 14, Math.random() * 6 - 1.5, (Math.random() - .5) * 3); particles.add(dot);
    }
    scene.add(particles);
    const pointer = { x: 0, y: 0 };
    canvas.addEventListener("pointermove", (event) => { const rect = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width - .5) * 2; pointer.y = ((event.clientY - rect.top) / rect.height - .5) * 2; });
    canvas.addEventListener("pointerleave", () => { pointer.x = 0; pointer.y = 0; });
    const resize = () => { const rect = canvas.getBoundingClientRect(); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false); };
    window.addEventListener("resize", resize); resize();
    const animate = (time) => { group.rotation.y += (pointer.x * .08 - group.rotation.y) * .025; group.rotation.x += (-.13 + pointer.y * .035 - group.rotation.x) * .025; particles.rotation.y = time * .000025; if (!reduceMotion) ring.rotation.z += .0008; renderer.render(scene, camera); window.requestAnimationFrame(animate); };
    window.requestAnimationFrame(animate);
  } catch (error) { console.warn("Three.js scene unavailable; continuing with the accessible UI.", error); canvas.style.display = "none"; }
}

function initMotion() {
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); } }), { threshold: .08 });
  $$(".reveal").forEach((element) => observer.observe(element));
  const glow = $(".cursor-glow");
  window.addEventListener("pointermove", (event) => { glow.style.left = `${event.clientX}px`; glow.style.top = `${event.clientY}px`; });
}

function initDialog() {
  const dialog = $("#connection-dialog");
  $("#connection-pill").addEventListener("click", () => { $("#api-base-input").value = apiBase(); dialog.showModal(); });
  $("#dialog-close").addEventListener("click", () => dialog.close());
  $("#save-api-button").addEventListener("click", () => { const value = $("#api-base-input").value.trim().replace(/\/$/, ""); if (value) localStorage.setItem("taxsaathi_api_base", value); else localStorage.removeItem("taxsaathi_api_base"); $("#dialog-note").textContent = value ? "Connection saved. Your next request will use this API." : "Using the same origin."; setConnection(false, value ? "connection saved" : "same origin"); });
  $("#clear-api-button").addEventListener("click", () => { localStorage.removeItem("taxsaathi_api_base"); $("#api-base-input").value = ""; $("#dialog-note").textContent = "Cleared. Using the same origin."; setConnection(false, "same origin"); });
}

function init() {
  $$(".segment").forEach((button) => button.addEventListener("click", () => setIncomeType(button.dataset.incomeType)));
  $("#tax-form").addEventListener("submit", calculate);
  $("#parse-button").addEventListener("click", parseIncome);
  $("#free-text").addEventListener("keydown", (event) => { if (event.key === "Enter") parseIncome(); });
  $("#ask-button").addEventListener("click", askQuestion);
  $("#question-input").addEventListener("keydown", (event) => { if (event.key === "Enter") askQuestion(); });
  initScene(); initMotion(); initDialog(); setConnection(false, apiBase() ? "api configured" : "ready to calculate");
}

init();
