// Live rates for the Debt Management Calculator.
// 30-yr: Freddie Mac PMMS weekly average (FRED series MORTGAGE30US), fallback freddiemac.com/pmms.
// Savings yield: 10-yr Treasury (FRED series DGS10).
// Open /.netlify/functions/rates?debug to see exactly what was fetched.

const FRED = id => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
const SIX_HOURS = 6 * 60 * 60 * 1000;
let cache = null, cachedAt = 0;

export function lastValue(csv) {
  const rows = csv.trim().split(/\r?\n/).slice(1);
  for (let i = rows.length - 1; i >= 0; i--) {
    const [date, v] = rows[i].split(",");
    const n = parseFloat(v);
    if (date && isFinite(n)) return { date: date.trim(), value: n };
  }
  return null;
}

export function shortDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export function parsePmms(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const rate = text.match(/30-Year(?: Fixed[- ]Rate Mortgage| FRM)?[^%]{0,120}?(\d{1,2}\.\d{2})\s*%/i);
  const date = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!rate) return null;
  return {
    value: parseFloat(rate[1]),
    date: date ? `${date[1].padStart(2, "0")}/${date[2].padStart(2, "0")}/${date[3].slice(2)}` : ""
  };
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "debt-management-calculator (Netlify Function)" } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }
  });
}

export default async (req) => {
  const debug = new URL(req.url).searchParams.has("debug");
  if (!debug && cache && Date.now() - cachedAt < SIX_HOURS) return json(cache);

  const out = {}, log = {};

  try {
    const csv = await getText(FRED("MORTGAGE30US"));
    log.fredMortgageLastRows = csv.trim().split(/\r?\n/).slice(-3);
    const lv = lastValue(csv);
    if (lv) { out.mortgage30 = lv.value; out.mortgageDate = shortDate(lv.date); out.mortgageSource = "FRED MORTGAGE30US"; }
  } catch (e) { log.fredMortgageError = String(e); }

  if (!out.mortgage30) {
    try {
      const p = parsePmms(await getText("https://www.freddiemac.com/pmms"));
      log.pmmsParsed = p;
      if (p) { out.mortgage30 = p.value; out.mortgageDate = p.date; out.mortgageSource = "freddiemac.com/pmms"; }
    } catch (e) { log.pmmsError = String(e); }
  }

  try {
    const csv = await getText(FRED("DGS10"));
    log.fredTreasuryLastRows = csv.trim().split(/\r?\n/).slice(-3);
    const lv = lastValue(csv);
    if (lv) { out.treasury10 = lv.value; out.treasuryDate = shortDate(lv.date); }
  } catch (e) { log.fredTreasuryError = String(e); }

  if (out.mortgage30) { cache = out; cachedAt = Date.now(); }
  return json(debug ? { ...out, debug: log } : out, out.mortgage30 ? 200 : 502);
};
