const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const sharp = require('sharp'); 
const SESSION_FILE="./ranky-session.json";

const app = express();

// 5mb: /ahrefs-serp-data accepts a saved page as `html` for offline dry-runs
app.use(express.json({ limit: "5mb" }));


let browser = null;
let context = null;
let page = null;

// =====================================
// WATERMARK DETECTION
// =====================================
const Tesseract = require('tesseract.js');

// Hosts that always serve watermarked stock photos
const WATERMARKED_HOSTS = [
  'gettyimages.com', 'media.gettyimages.com',
  'istockphoto.com', 'shutterstock.com', 'alamy.com',
  'dreamstime.com', 'depositphotos.com', '123rf.com',
  'stock.adobe.com', 'adobe.stock', 'vectorstock.com',
  'canstockphoto.com', 'bigstockphoto.com', 'pond5.com',
  'agefotostock.com', 'stockfresh.com', 'visualchina.com',
  'superstock.com', 'stocktrekimages.com'
];

// URL path shapes that are stock CDNs
const STOCK_URL_PATTERNS = [
  /gettyimages\.com\/id\//i,
  /gettyimages\.com\/.*\/photo\//i,
  /shutterstock\.com\/image-photo\//i,
  /shutterstock\.com\/.*\/stock-photo/i,
  /alamy\.com\/.*\/stock-photo/i,
  /istockphoto\.com\/photo\//i,
  /adobe\.com\/.*\/stock/i,
  /depositphotos\.com\/\d+/i,
  /dreamstime\.com\/.*stock-photo/i,
  /123rf\.com\/.*photo_/i
];

// Text patterns found in watermarks (via OCR)
const WATERMARK_TEXT_PATTERNS = [
  /getty\s*images?/i,
  /shutterstock/i,
  /\balamy\b/i,
  /\bistock\b/i,
  /\bdreamstime\b/i,
  /\bdepositphotos\b/i,
  /\b123rf\b/i,
  /\bstockphoto\b/i,
  /\badobe\s*stock\b/i,
  /\bvector\s*stock\b/i,
  /\bcredit[:\s]/i,
  /\ball rights reserved\b/i,
  /\bsample\s*only\b/i,
  /©/,
  /watermark/i
];

let ocrWorker = null;
async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  console.log('[ocr] initializing tesseract worker...');
  ocrWorker = await Tesseract.createWorker('eng');
  console.log('[ocr] worker ready');
  return ocrWorker;
}

// Layer 1: cheap URL/host check
function looksLikeStockUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (WATERMARKED_HOSTS.some(h => lower.includes(h))) return true;
  if (STOCK_URL_PATTERNS.some(p => p.test(url))) return true;
  return false;
}

// Layer 2: OCR for actual watermark text
async function containsWatermarkText(url) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://duckduckgo.com/'
      },
      redirect: 'follow'
    });
    if (!r.ok) return { watermarked: false, error: `HTTP ${r.status}` };

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2048) return { watermarked: false, error: 'too small' };

    const small = await sharp(buf)
      .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .normalize()
      .toBuffer();

    const worker = await getOcrWorker();
    const { data } = await worker.recognize(small);
    const text = String(data.text || '').replace(/\s+/g, ' ').trim();

    for (const p of WATERMARK_TEXT_PATTERNS) {
      const m = text.match(p);
      if (m) return { watermarked: true, matched: m[0], ocrText: text.slice(0, 200) };
    }
    return { watermarked: false, ocrText: text.slice(0, 200) };
  } catch (e) {
    console.log(`[ocr] error on ${url.slice(0, 60)}: ${e.message}`);
    return { watermarked: false, error: e.message };
  }
}


// =====================================
// HEALTH CHECK
// =====================================

app.get("/health",(req,res)=>{

res.json({

success:true,
service:"playwright",
status:"running",
browserSession:!!page

});

});




// =====================================
// LOGIN RANKYTOOLS
// =====================================

app.post("/login",async(req,res)=>{


try{


const {
loginUrl
}=req.body;


const username = process.env.RANKYTOOLS_USERNAME;
const password = process.env.RANKYTOOLS_PASSWORD;



if(!username){

return res.status(500).json({

success:false,
error:"RANKYTOOLS_USERNAME missing"

});

}


if(!password){

return res.status(500).json({

success:false,
error:"RANKYTOOLS_PASSWORD missing"

});

}


if(!loginUrl){

return res.status(400).json({

success:false,
error:"loginUrl required"

});

}



// close old session

if(browser){

await browser.close().catch(()=>{});

}



browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--window-size=1366,900"
  ]
});

context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  viewport: { width: 1366, height: 900 },
  locale: "en-US",
  timezoneId: "America/New_York",
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"'
  }
});

page = await context.newPage();

await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  window.chrome = { runtime: {} };
});



// open login page

await page.goto(loginUrl,{
waitUntil:"domcontentloaded",
timeout:60000
});




// username

const usernameField =
page.locator(
'input[type="text"],input[type="email"],input[name="username"],input[name="email"]'
).first();


await usernameField.waitFor({

state:"visible",
timeout:30000

});


await usernameField.fill(username);




// password

const passwordField =
page.locator(
'input[type="password"]'
).first();



await passwordField.waitFor({

state:"visible",
timeout:30000

});


await passwordField.fill(password);




// click login


const loginButton =
page.locator(
'button[type="submit"],input[type="submit"],button:has-text("Login")'
).first();



await loginButton.click();
await page.waitForTimeout(5000);



if(page.url().includes("/login")){

await page.goto(
"https://member.rankytools.com/member",
{
waitUntil:"domcontentloaded",
timeout:60000
}
);

}



await page.waitForTimeout(5000);


// wait until member dashboard appears

try {

await page.waitForURL(
 url => !url.toString().includes("/login"),
 {
 timeout:30000
 }
);

}
catch(e){

// ignore

}
await context.storageState({
 path:SESSION_FILE
});



// verify login properly


const passwordVisible =
await page.locator(
'input[type="password"]'
)
.isVisible()
.catch(()=>false);



const loginText =
await page.locator("body")
.innerText()
.catch(()=>"");



const failedLogin =
passwordVisible ||
loginText.includes("Invalid") ||
loginText.includes("incorrect");



const currentUrl = page.url();

const loggedIn =
!currentUrl.includes("/login")
&&
!loginText.includes("Invalid")
&&
!loginText.includes("incorrect");


// screenshot debug

await page.screenshot({

path:"/tmp/rankytolls-login.png",

fullPage:true

}).catch(()=>{});



res.json({

success:loggedIn,

loggedIn,

browserSession:true,

title:await page.title(),

url:page.url(),

message:
loggedIn
?
"Login successful"
:
"Login failed"

});



}

catch(error){


res.status(500).json({

success:false,

loggedIn:false,

error:error.message

});


}


});







// =====================================
// SESSION STATUS
// =====================================


app.get("/status",async(req,res)=>{


try{


if(!page){


return res.json({

success:true,

loggedIn:false,

browserSession:false

});


}



res.json({

success:true,

loggedIn:true,

browserSession:true,

url:page.url(),

title:await page.title()

});



}

catch(error){


res.status(500).json({

success:false,

error:error.message

});


}



});


app.get("/tools", async(req,res)=>{

try{

if(!page){

return res.status(400).json({
success:false,
error:"No active session"
});

}


// make sure dashboard loaded

await page.waitForTimeout(5000);


// extract everything clickable

const tools = await page.evaluate(()=>{


let results=[];


// links

document.querySelectorAll("a").forEach(el=>{

const text =
(el.innerText || el.textContent || "")
.trim();

const url =
el.href;


if(text){

results.push({

text,
url

});

}

});


// buttons

document.querySelectorAll("button").forEach(el=>{

const text =
(el.innerText || el.textContent || "")
.trim();


if(text){

results.push({

text,
url:null

});

}

});



// remove duplicates

return results.filter(
(item,index,self)=>

index === self.findIndex(
(x)=>
x.text===item.text &&
x.url===item.url
)

);


});



res.json({

success:true,

url:page.url(),

count:tools.length,

tools

});


}


catch(error){


res.status(500).json({

success:false,

error:error.message

});


}


});

app.post("/click-tool", async(req,res)=>{

try{


const {name}=req.body;


if(!page){

return res.json({
success:false,
error:"Browser not initialized"
});

}



console.log("Opening tool:",name);



const selector =
`a[title="${name}"]`;



const tool =
page.locator(selector).first();



await tool.waitFor({
state:"attached",
timeout:30000
});



const href =
await tool.getAttribute("href");



console.log("Tool href:",href);



if(!href){

return res.json({

success:false,

error:"Tool href missing"

});

}



// IMPORTANT
// do not wait for DOM

try{

await page.goto(
href,
{
waitUntil:"commit",
timeout:60000
}
);


}catch(e){

console.log(
"Navigation warning:",
e.message
);

}



await page.waitForTimeout(30000);



return res.json({

success:true,

tool:name,

finalUrl:page.url(),

title:await page.title(),

message:"Tool opened"

});



}
catch(error){


console.log(error);


res.status(500).json({

success:false,

error:error.message

});


}


});
app.post("/search-semrush", async (req, res) => {

  try {

    const keyword = req.body.keyword;


    if (!keyword) {

      return res.json({
        success:false,
        error:"Keyword missing"
      });

    }


    // use current active playwright page
    if (!page) {

      return res.json({
        success:false,
        error:"No active browser session"
      });

    }


    await page.bringToFront();


    console.log("Current URL:", page.url());


    // Wait for Semrush search input

    const searchInput = page.locator(
      'input[placeholder="Enter website or keyword"]'
    ).first();



    await searchInput.waitFor({
      state:"visible",
      timeout:30000
    });



    await searchInput.fill(keyword);



    const analyzeButton = page.locator(
      'button[data-test="searchbar_search_submit"]'
    ).first();



    await analyzeButton.waitFor({
      state:"visible",
      timeout:30000
    });



    await analyzeButton.click();



    await page.waitForTimeout(10000);



    res.json({

      success:true,

      keyword,

      url:page.url(),

      title:await page.title(),

      message:"Semrush search completed"

    });


  } catch(error){


    console.log("SEM Rush Error:",error);


    res.json({

      success:false,

      error:error.message,

      url: page ? page.url() : null

    });


  }


});
app.post("/click",async(req,res)=>{


try{


const {text}=req.body;


if(!page){

return res.status(400).json({

success:false,

error:"No session"

});

}


await page
.getByText(text,{exact:true})
.first()
.click();



await page.waitForTimeout(5000);



res.json({

success:true,

title:await page.title(),

url:page.url()

});


}
catch(error){

res.status(500).json({

success:false,

error:error.message

});

}


});
// =====================================
// KEYWORD DATA (RankyTools Keyword Magic)
// Fails soft when the keyword has no data — returns count:0 so the workflow
// can fall through to the Gemini keyword fallback.
// =====================================
// =====================================
// KEYWORD DATA (RankyTools Keyword Magic)
// Fails soft when the keyword has no data — returns count:0 so the workflow
// can fall through to the Gemini keyword fallback.
// =====================================
app.post("/keyword-data", async (req, res) => {
  const startedAt = Date.now();
  try {
    if (!page) {
      return res.json({ success: false, error: "No active session", phase_status: "NO_SESSION" });
    }

    const keyword = req.body?.keyword;
    if (!keyword) {
      return res.json({ success: false, error: "Keyword missing", phase_status: "NO_KEYWORD" });
    }

    // ---- Filters from n8n ----
    const minVolume = Number(req.body?.minVolume) || 0;
    const maxKd = Number(req.body?.maxKd) || 30;
    const intent = req.body?.intent || "Informational";
    const maxRows = Number(req.body?.maxRows) || 1000;

    // ---- Cache ----
    const cacheDir = "./kw-cache";
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const cacheKey = `${keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_v${minVolume}_kd${maxKd}_${intent.toLowerCase()}`;
    const cacheFile = `${cacheDir}/${cacheKey}.json`;
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    if (fs.existsSync(cacheFile)) {
      try {
        const stat = fs.statSync(cacheFile);
        if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
          const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
          console.log(`[kw] cache HIT for "${keyword}" (${cached.count} keywords)`);
          return res.json({ ...cached, fromCache: true });
        }
      } catch (e) {
        console.log("[kw] cache read failed:", e.message);
      }
    }

    console.log(
      `[kw] searching "${keyword}" | minVol=${minVolume} maxKd=${maxKd} intent=${intent}`
    );

    // ---- Build URL ----
    const targetUrl = `https://sr.rankytools.com/analytics/keywordmagic/?q=${encodeURIComponent(keyword)}&db=us&type=all&mode=1`;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });

    // ---- Wait for EITHER a data table, a "no results" message, or a 20s timeout ----
    // Do NOT wait for the next_page_button specifically — it doesn't render on empty pages.
    try {
      await page.waitForFunction(() => {
        const nextBtn = document.querySelector('[data-path="report.table.next_page_button"]');
        if (nextBtn) return true;

        const rows = document.querySelectorAll('[data-testid="table-row"]');
        if (rows.length > 0) return true;

        const body = (document.body?.innerText || "").toLowerCase();
        if (/no results|no data|nothing found|no keywords|try another|no matching/i.test(body)) return true;

        return false;
      }, { timeout: 20000, polling: 500 });
    } catch (e) {
      console.log("[kw] wait timed out — treating as empty/no-data page");
    }

    // ---- Inspect page state ----
    const pageState = await page.evaluate(() => {
      const nextBtn = document.querySelector('[data-path="report.table.next_page_button"]');
      const rows = document.querySelectorAll('[data-testid="table-row"]');
      const bodyText = (document.body?.innerText || "").toLowerCase();
      return {
        hasNextBtn: !!nextBtn,
        rowCount: rows.length,
        emptyMessage: /no results|no data|nothing found|no keywords|try another|no matching/i.test(bodyText),
        url: location.href
      };
    });

    console.log(
      `[kw] state: rows=${pageState.rowCount} nextBtn=${pageState.hasNextBtn} empty=${pageState.emptyMessage}`
    );

    // ---- Empty page → return success:true with count:0 (soft fail) ----
    if (!pageState.hasNextBtn && pageState.rowCount === 0) {
      const emptyResponse = {
        success: true,
        count: 0,
        expected: 0,
        totalPages: 0,
        keywords: [],
        url: pageState.url,
        scrapedAt: new Date().toISOString(),
        note: "No keywords found in RankyTools for this term"
      };
      try { fs.writeFileSync(cacheFile, JSON.stringify(emptyResponse, null, 2)); } catch (e) {}
      return res.json(emptyResponse);
    }

    // ==========================================
    // APPLY FILTERS BY CLICKING
    // ==========================================

    // --- KD Filter ---
    try {
      const kdButton = page.locator('button:has-text("KD %")').first();
      if (await kdButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await kdButton.click();
        await page.waitForTimeout(1000);
        await page.locator('text="Custom range"').click();
        await page.waitForTimeout(500);
        const inputs = page.locator('input[type="number"]');
        await inputs.nth(0).fill("0");
        await inputs.nth(1).fill(String(maxKd));
        await page.locator('button:has-text("Apply")').click();
        await page.waitForTimeout(5000);
        console.log(`[kw] applied KD filter 0-${maxKd}`);
      }
    } catch (e) {
      console.log("[kw] KD filter skipped:", e.message);
    }

    // --- Intent Filter ---
    if (intent) {
      try {
        const intentButton = page.locator('button:has-text("Intent")').first();
        if (await intentButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await intentButton.click();
          await page.waitForTimeout(1000);
          await page.locator(`text="${intent}"`).click();
          await page.locator('button:has-text("Apply")').click();
          await page.waitForTimeout(5000);
          console.log(`[kw] applied intent filter: ${intent}`);
        }
      } catch (e) {
        console.log("[kw] intent filter skipped:", e.message);
      }
    }

    // --- Volume Filter ---
    if (minVolume > 0) {
      try {
        const volButton = page.locator('button:has-text("Volume")').first();
        if (await volButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await volButton.click();
          await page.waitForTimeout(1000);
          const volInput = page.locator('input[placeholder="From"]').first();
          if (await volInput.isVisible().catch(() => false)) {
            await volInput.fill(String(minVolume));
            await page.locator('button:has-text("Apply")').click();
            await page.waitForTimeout(5000);
            console.log(`[kw] applied volume filter > ${minVolume}`);
          }
        }
      } catch (e) {
        console.log("[kw] volume filter skipped:", e.message);
      }
    }

    // ==========================================
    // DETECT TOTALS AND SCRAPE
    // ==========================================
    let totalPages = 1;
    let totalExpected = 0;

    try {
      const lastPageAria = await page
        .locator('[data-path="report.table.last_page_button"]')
        .getAttribute("aria-label")
        .catch(() => "");
      const pageMatch = String(lastPageAria || "").match(/#(\d+)/);
      if (pageMatch) totalPages = Number(pageMatch[1]);

      totalExpected = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="all-keywords"]');
        if (!el) return 0;
        const m = String(el.innerText || "").match(/[\d,.]+[KM]?/i);
        if (!m) return 0;
        let raw = m[0].replace(/,/g, "").toUpperCase();
        if (raw.endsWith("K")) return Math.round(parseFloat(raw) * 1000);
        if (raw.endsWith("M")) return Math.round(parseFloat(raw) * 1000000);
        return Number(raw);
      });
    } catch (e) {
      /* use defaults */
    }

    console.log(`[kw] totals: ${totalPages} pages, ~${totalExpected} keywords`);

    const allKeywords = new Map();
    const HARD_LIMIT = 1000;
    const effectiveMaxRows = maxRows > 0 ? maxRows : HARD_LIMIT;

    for (let p = 1; p <= totalPages; p++) {
      const batch = await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-testid="table-row"]');
        const out = [];
        rows.forEach(row => {
          try {
            const kwEl = row.querySelector('[data-testid="table-cell-keyword"] a span') || row.querySelector('[data-testid="table-cell-keyword"] a');
            const kw = kwEl ? kwEl.innerText.trim() : "";
            if (!kw) return;

            const intents = Array.from(
              row.querySelectorAll('[data-testid="table-cell-intent"] button')
            ).map(b => (b.innerText || "").trim()).join(",");

            out.push({
              keyword: kw,
              intent: intents,
              relevance: (row.querySelector('[data-testid="table-cell-similarity-score"] span')?.innerText || "").trim(),
              volume: (row.querySelector('[data-testid="table-cell-volume"]')?.innerText || "").trim(),
              kd: (row.querySelector('[data-testid="table-cell-kd"] .sm-cell-kd__data')?.innerText || "").trim(),
              cpc: (row.querySelector('[data-testid="table-cell-cpc"]')?.innerText || "").trim(),
              serpFeatures: (() => {
                const btn = row.querySelector('[data-testid="table-cell-serp-features"] button');
                return btn ? (btn.getAttribute("aria-label") || btn.innerText || "").trim() : "";
              })(),
              results: (row.querySelector('[data-testid="table-cell-results"] .sm-results-cell')?.innerText || "").trim(),
              updated: (row.querySelector('[data-testid="table-cell-updated"] .sm-last-changes-cell__text')?.innerText || "").trim()
            });
          } catch (e) {}
        });
        return out;
      });

      let added = 0;
      for (const row of batch) {
        const key = row.keyword.toLowerCase().trim();
        if (key && !allKeywords.has(key)) {
          allKeywords.set(key, row);
          added++;
        }
      }

      console.log(`[kw] page ${p}/${totalPages}: ${batch.length} rows (${added} new), total: ${allKeywords.size}`);

      if (allKeywords.size >= effectiveMaxRows) {
        console.log(`[kw] hit max rows (${effectiveMaxRows}), stopping`);
        break;
      }

      if (p === totalPages) break;

      const nextBtn = page.locator('[data-path="report.table.next_page_button"]').first();
      if (await nextBtn.isDisabled().catch(() => false)) break;

      await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300 + Math.random() * 400);
      await nextBtn.click();

      try {
        await page.waitForFunction(
          (expected) => {
            const input = document.querySelector('[data-path="report.table.page_input"]');
            return input && input.value === String(expected);
          },
          p + 1,
          { timeout: 20000 }
        );
      } catch (e) {
        await page.waitForTimeout(3000);
      }

      await page.waitForTimeout(1500 + Math.random() * 1500);
    }

    const keywords = Array.from(allKeywords.values());
    const response = {
      success: true,
      count: keywords.length,
      expected: totalExpected || null,
      totalPages,
      keywords,
      url: page.url(),
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    };

    try { fs.writeFileSync(cacheFile, JSON.stringify(response, null, 2)); } catch (e) {}

    return res.json(response);
  } catch (error) {
    console.log("[kw] fatal:", error);
    return res.json({
      success: false,
      error: error.message,
      phase_status: "KEYWORD_SCRAPE_FAILED"
    });
  }
});
app.post("/serp-data", async (req, res) => {
  try {
    // =====================================================
    // 1. NORMALIZE KEYWORD
    // =====================================================
    let keyword = req.body?.keyword;
    if (typeof keyword !== "string") keyword = String(keyword || "");
    keyword = keyword.trim();
    keyword = keyword.replace(/^=+/, "").trim();

    if (!keyword) {
      return res.status(400).json({ success: false, error: "Keyword missing" });
    }

    // =====================================================
    // 2. BUILD CORRECT RANKYTOOLS URL
    // =====================================================
    const targetUrl = `https://sr.rankytools.com/analytics/keywordoverview/?q=${encodeURIComponent(keyword)}&db=us`;

    console.log("\n====================================");
    console.log("RANKYTOOLS SERP RESEARCH");
    console.log("KEYWORD:", keyword);
    console.log("URL:", targetUrl);
    console.log("====================================\n");

    // =====================================================
    // 3. LOAD PAGE
    // =====================================================
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    console.log("Page loaded");
    await page.waitForTimeout(5000);

    // =====================================================
    // 4. PROGRESSIVE SCROLL — UPDATED SELECTORS
    // =====================================================
    console.log("Starting progressive scroll...");

    // Primary + fallback selectors for the SERP container
    const CONTAINER_SELECTORS = [
      '.kwo-serp-table',                          // NEW: actual container class
      '[data-testid="serp-analysis"]',            // possible testid
      '#serp-analysis',                           // legacy fallback
      'div[role="table"]'                         // structural fallback
    ];

    // Row selector — matches the current DOM
    const ROW_SELECTOR = 'div[data-testid="serp-analysis-row"][role="row"]';

    let serpFound = false;
    let workingContainerSelector = null;

    for (let i = 0; i < 18; i++) {
      await page.evaluate((step) => {
        const viewport = window.innerHeight || 900;
        const target = step * viewport * 0.85;
        window.scrollTo({ top: target, behavior: "instant" });
      }, i);

      await page.waitForTimeout(1500);

      // Try each container selector
      for (const sel of CONTAINER_SELECTORS) {
        const count = await page.locator(sel).count();
        if (count > 0) {
          // Also verify a real data row is present
          const rowCount = await page.locator(ROW_SELECTOR).count();
          console.log(`Scroll ${i + 1}/18 | ${sel}: ${count} | rows: ${rowCount}`);
          if (rowCount > 0) {
            serpFound = true;
            workingContainerSelector = sel;
            break;
          }
        }
      }

      if (serpFound) break;
    }

    console.log("SERP container found:", serpFound, "| selector:", workingContainerSelector);

    // =====================================================
    // 5. EXTRA WAIT AFTER SERP MOUNTS
    // =====================================================
    if (serpFound) {
      await page.locator(workingContainerSelector)
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(5000);
    }

    // =====================================================
    // 6. EXTRACT SERP — UPDATED SELECTORS
    // =====================================================
    const result = await page.evaluate(({ containerSelectors, rowSelector }) => {
      // Find container (first one that exists)
      let serp = null;
      for (const sel of containerSelectors) {
        serp = document.querySelector(sel);
        if (serp) break;
      }

      if (!serp) {
        return {
          containerFound: false,
          rowsFound: 0,
          resultsFound: 0,
          results: [],
          structure: {}
        };
      }

      // =================================================
      // FIND ROWS — try multiple selectors
      // =================================================
      let rows = Array.from(serp.querySelectorAll(rowSelector));

      if (!rows.length) {
        rows = Array.from(serp.querySelectorAll('[data-testid="serp-analysis-row"]'));
      }
      if (!rows.length) {
        rows = Array.from(serp.querySelectorAll('.kwo-serp-row-layout[role="row"]'));
      }

      // Filter out the header row (it has role="columnheader" inside)
      rows = rows.filter(r => !r.querySelector('[role="columnheader"]'));

      const results = [];

      for (const row of rows) {
        const rawText = (row.innerText || "").replace(/\s+/g, " ").trim();

        // ---------------------------------------------
        // FIND EXTERNAL ORGANIC URL
        // ---------------------------------------------
        const links = Array.from(row.querySelectorAll("a[href]"));
        let resultLink = null;

        for (const link of links) {
          const href = link.href || "";
          if (!href) continue;
          if (!href.startsWith("http://") && !href.startsWith("https://")) continue;

          // Skip RankyTools internal links (analytics reports etc.)
          if (href.includes("rankytools.com")) continue;
          if (href.includes("semrush.com")) continue;

          // Real organic result — preferred selector
          if (link.matches('a[data-testid="serp-table-url"], .kwo-link-url__link')) {
            resultLink = link;
            break;
          }

          if (!resultLink) resultLink = link;
        }

        if (!resultLink) continue;

        // ---------------------------------------------
        // URL
        // ---------------------------------------------
        const url = resultLink.href;

        // ---------------------------------------------
        // TITLE / LINK TEXT
        // ---------------------------------------------
        const title = (resultLink.innerText || "").replace(/\s+/g, " ").trim();

        // ---------------------------------------------
        // DOMAIN
        // ---------------------------------------------
        let domain = "";
        try {
          domain = new URL(url).hostname.replace(/^www\./, "");
        } catch (e) {
          domain = "";
        }

        // ---------------------------------------------
        // POSITION — use role="cell" siblings
        // ---------------------------------------------
        let position = null;
        const cells = Array.from(row.querySelectorAll('[role="cell"]'));
        for (const cell of cells) {
          const text = (cell.innerText || "").replace(/\s+/g, " ").trim();
          if (/^\d+$/.test(text)) {
            const n = Number(text);
            if (n >= 1 && n <= 100) { position = n; break; }
          }
        }
        if (position === null) {
          const match = rawText.match(/^\s*(\d{1,3})\b/);
          if (match) position = Number(match[1]);
        }

        // ---------------------------------------------
        // METRICS — by data-testid
        // ---------------------------------------------
        const getTestIdValue = (testid) => {
          const el = row.querySelector(`[data-testid="${testid}"]`);
          return el?.innerText?.replace(/\s+/g, " ")?.trim() || "";
        };

        const pageAS = getTestIdValue("serp-table-page-score");   // Domain AS
        const backlinks = getTestIdValue("serp-table-backlinks");
        const traffic = getTestIdValue("serp-table-traffic");
        const refDomains = getTestIdValue("serp-table-ref-domains");
        const keywords = getTestIdValue("serp-table-url-keywords");

        results.push({
          position,
          domain,
          title,
          url,
          pageAS,
          refDomains,
          backlinks,
          traffic,
          keywords,
          rawText
        });
      }

      // =================================================
      // DEDUPE BY URL
      // =================================================
      const unique = [];
      const seen = new Set();
      for (const item of results) {
        const key = item.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
      }

      // =================================================
      // SORT BY POSITION
      // =================================================
      unique.sort((a, b) => {
        if (a.position === null && b.position === null) return 0;
        if (a.position === null) return 1;
        if (b.position === null) return -1;
        return a.position - b.position;
      });

      // =================================================
      // STRUCTURE DEBUG
      // =================================================
      const structure = {
        containerTag: serp.tagName,
        containerClass: serp.className,
        rowCount: rows.length,
        externalLinks: Array.from(serp.querySelectorAll('a[href^="http"]')).filter(a => {
          const href = a.href || "";
          return !href.includes("rankytools.com") && !href.includes("semrush.com");
        }).length,
        testIds: Array.from(serp.querySelectorAll("[data-testid]"))
          .map(el => el.getAttribute("data-testid"))
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i),
        firstRowText: rows[0]?.innerText?.replace(/\s+/g, " ")?.trim() || ""
      };

      return {
        containerFound: true,
        rowsFound: rows.length,
        resultsFound: unique.length,
        results: unique.slice(0, 10),
        structure
      };
    }, { containerSelectors: CONTAINER_SELECTORS, rowSelector: ROW_SELECTOR });

    // =====================================================
    // 7. RESPONSE
    // =====================================================
    return res.json({
      success: true,
      keyword,
      source: "RankyTools SERP Analysis",
      url: targetUrl,
      serp: {
        containerFound: result.containerFound,
        rowsFound: result.rowsFound,
        resultsFound: result.resultsFound,
        results: result.results
      },
      structure: result.structure || {},
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("SERP ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
// =====================================
// AHREFS KEYWORDS EXPLORER
// =====================================
app.post("/ahrefs-search", async (req, res) => {
  try {
    const keyword = String(req.body?.keyword || "").trim();
    if (!keyword) return res.json({ success: false, error: "Keyword missing" });
    if (!page) return res.json({ success: false, error: "No active browser session" });

    console.log(`[Ahrefs] Searching for: ${keyword}`);

    // Generated CSS classes change frequently. The placeholder and accessible
    // button names are stable in the supplied Ahrefs DOM captures.
    let searchInput = page.locator('textarea[placeholder*="Enter keywords"]').first();
    if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
      // The first load after login can be slow, so retry once before failing.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await page.goto("https://arx.rankytools.com/keywords-explorer", {
            waitUntil: "domcontentloaded",
            timeout: 60000
          });
          break;
        } catch (navErr) {
          if (attempt === 2) throw navErr;
          console.log("[Ahrefs] keywords-explorer load timed out, retrying once");
        }
      }
      searchInput = page.locator('textarea[placeholder*="Enter keywords"]').first();
    }
    await searchInput.waitFor({ state: "visible", timeout: 30000 });
    await searchInput.fill(keyword);

    const searchButton = page.getByRole("button", { name: /^Search$/ }).first();
    await searchButton.waitFor({ state: "visible", timeout: 10000 });
    await searchButton.click();

    await page.waitForURL(/\/keywords-explorer\/google\/[^/]+\/overview\?keyword=/, {
      timeout: 60000
    }).catch(() => {});

    // The overview page has several "View all" links. Select the matching
    // terms report explicitly so questions/related terms are never scraped.
    const matchingTermsLink = page.locator(
      'a[href*="/keywords-explorer/google/"][href*="/ideas/matchingTerms"][href*="matchingTermsMode=termsMatch"]'
    ).first();
    if (await matchingTermsLink.isVisible({ timeout: 15000 }).catch(() => false)) {
      await matchingTermsLink.click();
    } else {
      const overviewUrl = page.url();
      const parsed = new URL(overviewUrl);
      const overviewKeyword = parsed.searchParams.get("keyword") || keyword;
      await page.goto(
        `https://arx.rankytools.com/keywords-explorer/google/us/ideas/matchingTerms?keyword=${encodeURIComponent(overviewKeyword)}&matchingTermsMode=termsMatch`,
        { waitUntil: "domcontentloaded", timeout: 60000 }
      );
    }

    await page.waitForURL(/\/keywords-explorer\/google\/[^/]+\/ideas\/matchingTerms/, {
      timeout: 60000
    }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll("tbody tr, [role=row]").length > 0 || /no keywords|no results|no data/i.test(document.body?.innerText || ""),
      { timeout: 30000, polling: 500 }
    ).catch(() => {});

    res.json({
      success: true,
      keyword,
      url: page.url(),
      title: await page.title(),
      phase: "matching_terms",
      message: "Ahrefs search opened the matching terms report"
    });

  } catch (error) {
    console.log("Ahrefs Search Error:", error);
    res.json({ success: false, error: error.message, url: page ? page.url() : null });
  }
});
// =====================================
// AHREFS KEYWORD DATA
// =====================================
app.post("/ahrefs-keyword-data", async (req, res) => {
  const startedAt = Date.now();
  try {
    if (!page) return res.json({ success: false, error: "No active session" });
    const keyword = String(req.body?.keyword || "").trim();
    if (!keyword) return res.json({ success: false, error: "Keyword missing" });

    const maxKd = Number.isFinite(Number(req.body?.maxKd)) ? Number(req.body.maxKd) : 30;
    const minVolume = Number.isFinite(Number(req.body?.minVolume)) ? Number(req.body.minVolume) : 0;
    const maxRows = Math.max(20, Math.min(Number(req.body?.maxRows) || 500, 2000));
    // "I" = keep informational keywords only (rows with no intent label are kept).
    const intentOnly = String(req.body?.intent || "").trim().toUpperCase().charAt(0) === "I";
    // Extra Ahrefs reports to read when the matching-terms report is too thin.
    // Each report is one more page load (credits), so they are only used on demand.
    const extraReports = (Array.isArray(req.body?.reports) ? req.body.reports : ["relatedTerms", "searchSuggestions"])
      .filter((r) => r === "relatedTerms" || r === "searchSuggestions");
    const minNeeded = Math.max(1, Number(req.body?.minNeeded) || 20);
    console.log(`[Ahrefs] Reading matching terms for "${keyword}" (KD <= ${maxKd}, volume >= ${minVolume}, intent=${intentOnly ? "I" : "any"})`);

    // If a caller invokes this endpoint directly, put the session on the same
    // matching-terms page that /ahrefs-search produces.
    if (!/\/ideas\/matchingTerms/.test(page.url())) {
      await page.goto(
        `https://arx.rankytools.com/keywords-explorer/google/us/ideas/matchingTerms?keyword=${encodeURIComponent(keyword)}&matchingTermsMode=termsMatch`,
        { waitUntil: "domcontentloaded", timeout: 60000 }
      );
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr, [role=row]").length > 0 || /no keywords|no results|no data/i.test(document.body?.innerText || ""),
        { timeout: 30000, polling: 500 }
      ).catch(() => {});
    }

    // Apply filters when the UI exposes them. Client-side filtering below is
    // retained because Ahrefs renders the controls and rows lazily.
    try {
      const kdFilterBtn = page.getByRole("button", { name: /^KD(?:[: ]|$)/i }).first();
      if (await kdFilterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await kdFilterBtn.click();
        const customRange = page.getByText("Custom range", { exact: true }).first();
        if (await customRange.isVisible({ timeout: 1500 }).catch(() => false)) await customRange.click();
        const toInput = page.locator('input[placeholder="To"], input[aria-label*="to" i]').first();
        if (await toInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await toInput.fill(String(maxKd));
          const apply = page.getByRole("button", { name: /Show results|Apply/i }).first();
          if (await apply.isVisible({ timeout: 1000 }).catch(() => false)) await apply.click();
          else await toInput.press("Enter");
          await page.waitForTimeout(2000);
        }
      }
    } catch (e) {
      console.log("[Ahrefs] UI KD filter unavailable; using client-side filter:", e.message);
    }

    if (minVolume > 0) {
      try {
        const volumeBtn = page.getByRole("button", { name: /^Volume:/i }).first();
        if (await volumeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await volumeBtn.click();
          const fromInput = page.locator('input[placeholder="From"], input[aria-label*="from" i]').first();
          if (await fromInput.isVisible({ timeout: 1500 }).catch(() => false)) {
            await fromInput.fill(String(minVolume));
            const apply = page.getByRole("button", { name: /Show results|Apply/i }).first();
            if (await apply.isVisible({ timeout: 1000 }).catch(() => false)) await apply.click();
            else await fromInput.press("Enter");
            await page.waitForTimeout(2000);
          }
        }
      } catch (e) {
        console.log("[Ahrefs] UI volume filter unavailable; using client-side filter:", e.message);
      }
    }

    // Wait until real data rows (with a keyword link) are rendered and the row
    // count stops changing. A bare "tbody tr" can be a loading skeleton, which
    // made the scrape run on an empty table.
    const waitForKeywordRows = async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('tbody tr a[href*="/overview"]').length > 0 || /no keywords|no results|no data/i.test(document.body?.innerText || ""),
        { timeout: 45000, polling: 500 }
      ).catch(() => {});
      let last = -1;
      let stable = 0;
      for (let i = 0; i < 16 && stable < 3; i++) {
        const count = await page.evaluate(() => document.querySelectorAll('tbody tr a[href*="/overview"]').length).catch(() => 0);
        stable = count > 0 && count === last ? stable + 1 : 0;
        last = count;
        await page.waitForTimeout(500);
      }
    };
    await waitForKeywordRows();

    const scrapeKeywords = () => page.evaluate(({ limitKd, minimumVolume, rowLimit, onlyInformational }) => {
      const text = (el) => String(el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
      // Ahrefs includes a blank side-gap <td> and a checkbox <th> before the
      // data columns. Read every direct header cell so header and row indexes
      // stay aligned (Keyword is index 2 and KD is index 5 in the supplied DOM).
      const headerNodes = [...document.querySelectorAll("thead tr:first-child > th, thead tr:first-child > td, [role=columnheader]")];
      const headers = headerNodes.map(text).map((v) => v.toLowerCase());
      const indexOf = (patterns) => headers.findIndex((h) => patterns.some((p) => p.test(h)));
      const keywordIndex = indexOf([/keyword/]);
      const kdIndex = indexOf([/^kd$/, /keyword difficulty/, /difficulty/]);
      const volumeIndex = indexOf([/search volume/, /volume/, /^sv$/]);
      const intentIndex = indexOf([/intent/]);
      const parseMetric = (raw) => {
        const s = String(raw || "").replace(/,/g, "").trim().toUpperCase();
        const m = s.match(/-?\d+(?:\.\d+)?/);
        if (!m) return null;
        const n = Number(m[0]);
        if (/B\b/.test(s)) return Math.round(n * 1e9);
        if (/M\b/.test(s)) return Math.round(n * 1e6);
        if (/K\b/.test(s)) return Math.round(n * 1e3);
        return n;
      };
      const rowNodes = [...document.querySelectorAll("tbody tr, [role=row]")];
      const seen = new Set();
      const out = [];
      for (const row of rowNodes) {
        const cells = [...row.querySelectorAll(":scope > td, :scope > [role=cell]")];
        const values = cells.map(text);
        const link = row.querySelector('a[href*="/keywords-explorer/google/"][href*="/overview"], a[href*="/overview?keyword="]');
        const kw = text(link) || (keywordIndex >= 0 ? values[keywordIndex] : values.find((v) => /\s/.test(v) && v.length > 2));
        if (!kw || /^keyword$/i.test(kw)) continue;
        const kdRaw = kdIndex >= 0 ? values[kdIndex] : values.find((v) => /^\d{1,3}(?:\.\d+)?\s*%?$/.test(v));
        const kd = parseMetric(kdRaw);
        // KD "N/A" means Ahrefs has no difficulty score yet, not that the keyword
        // is bad. Keep it (volume still applies) and only drop a known KD above the limit.
        if (kd != null && kd > limitKd) continue;
        const volumeRaw = volumeIndex >= 0 ? values[volumeIndex] : "";
        const volume = parseMetric(volumeRaw);
        if (minimumVolume > 0 && (volume == null || volume < minimumVolume)) continue;
        const intentLabel = intentIndex >= 0 ? values[intentIndex] || "" : "";
        if (onlyInformational && intentLabel && !/I/.test(intentLabel)) continue;
        const key = kw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          keyword: kw,
          kd: kd == null ? "N/A" : String(kd),
          volume: volumeRaw,
          intent: intentLabel,
          cpc: "",
          serpFeatures: "",
          parentTopic: "",
          source: "ahrefs"
        });
        if (out.length >= rowLimit) break;
      }
      return out;
    }, { limitKd: maxKd, minimumVolume: minVolume, rowLimit: maxRows, onlyInformational: intentOnly });

    // The seed Ahrefs actually searched (used for the extra report URLs)
    let reportSeed = keyword;
    try { reportSeed = new URL(page.url()).searchParams.get("keyword") || keyword; } catch (e) {}

    let keywords = await scrapeKeywords();
    if (keywords.length === 0) {
      console.log("[Ahrefs] First scrape empty, waiting for the table and retrying once");
      await page.waitForTimeout(4000);
      await waitForKeywordRows();
      keywords = await scrapeKeywords();
    }

    // Too few keywords? Read more Ahrefs reports for the same seed and merge them.
    const reportsUsed = ["matchingTerms"];
    for (const report of extraReports) {
      if (keywords.length >= minNeeded) break;
      try {
        console.log(`[Ahrefs] Only ${keywords.length}/${minNeeded} keywords, reading ${report}`);
        await page.goto(
          `https://arx.rankytools.com/keywords-explorer/google/us/ideas/${report}?keyword=${encodeURIComponent(reportSeed)}`,
          { waitUntil: "domcontentloaded", timeout: 60000 }
        );
        await waitForKeywordRows();
        const extra = await scrapeKeywords();
        const have = new Set(keywords.map((k) => k.keyword.toLowerCase()));
        for (const row of extra) {
          if (!have.has(row.keyword.toLowerCase())) { have.add(row.keyword.toLowerCase()); keywords.push({ ...row, report }); }
        }
        reportsUsed.push(report);
      } catch (e) {
        console.log(`[Ahrefs] ${report} skipped: ${e.message}`);
      }
    }
    const volumeNumber = (v) => { const m = String(v || "").replace(/,/g, "").toUpperCase().match(/-?\d+(?:\.\d+)?/); if (!m) return 0; const n = Number(m[0]); return /K\b/.test(String(v).toUpperCase()) ? n * 1e3 : /M\b/.test(String(v).toUpperCase()) ? n * 1e6 : n; };
    keywords.sort((a, b) => volumeNumber(b.volume) - volumeNumber(a.volume));
    keywords = keywords.slice(0, maxRows);

    console.log(`[Ahrefs] Scraped ${keywords.length} rows`);

    // Soft fail if no keywords found (so n8n can fallback to Gemini)
    if (keywords.length === 0) {
      return res.json({
        success: true,
        count: 0,
        keywords: [],
        note: "No keywords found or table was empty",
        url: page.url(),
        source: "ahrefs"
      });
    }

    const response = {
      success: true,
      count: keywords.length,
      keywords,
      url: page.url(),
      source: "ahrefs",
      reportsUsed,
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    };

    res.json(response);

  } catch (error) {
    console.log("[Ahrefs] Fatal error:", error);
    res.json({
      success: false,
      error: error.message,
      phase_status: "AHREFS_SCRAPE_FAILED"
    });
  }
});

// =====================================
// AHREFS SERP OVERVIEW  (separate from the SEMrush /serp-data endpoint)
//
// Reads the "SERP overview" table of the Ahrefs Keywords Explorer overview page:
//   https://arx.rankytools.com/keywords-explorer/google/<country>/overview?keyword=<kw>
// Cells are mapped by their column header text (Search result, Page type, Words, DR, UR,
// Backlinks, Domains, Traffic, Value, Keywords, Top keyword, Volume), never by the generated
// css-xxxx class names. Rows that are SERP features (Top stories, AI Overview, Sitelinks)
// are reported in `features`, and Google redirect links (google.com/goto?url=...) are skipped
// because they hide the real address.
//
// Body: { keyword, country = "us", maxResults = 10, includeRedirects = false, html }
//   html  = optional saved page. Parses it offline: no Ahrefs request, no credits.
// The response mirrors /serp-data: { serp: { containerFound, rowsFound, resultsFound, results } }
// =====================================
function ahrefsSerpExtract({ wantRedirects }) {
  const txt = (el) => String((el && (el.innerText != null ? el.innerText : el.textContent)) || "").replace(/\s+/g, " ").trim();
  const num = (raw) => {
    const s = String(raw || "").replace(/[$,\s]/g, "").toUpperCase();
    const m = s.match(/^-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    if (/B$/.test(s)) return Math.round(n * 1e9);
    if (/M$/.test(s)) return Math.round(n * 1e6);
    if (/K$/.test(s)) return Math.round(n * 1e3);
    return n;
  };
  const isNA = (v) => !v || /^n\/?a$/i.test(v);
  const leafTexts = (td) => {
    const out = [];
    td.querySelectorAll("*").forEach((e) => { if (!e.children.length) { const t = txt(e); if (t && !out.includes(t)) out.push(t); } });
    return out;
  };

  const table = [...document.querySelectorAll("table")].find((t) => /search result/i.test(txt(t.querySelector("thead"))));
  if (!table) return { containerFound: false, rowsFound: 0, results: [], features: [], headers: [], title: "" };

  // Column map. A header with colspan=3 ("Search result") covers checkbox, position and result.
  const cols = [];
  table.querySelectorAll("thead tr:first-child > th").forEach((th) => {
    const label = txt(th).toLowerCase();
    const span = Number(th.getAttribute("colspan") || 1);
    for (let i = 0; i < span; i++) cols.push(i === span - 1 ? label : "");
  });
  // tolerant: Ahrefs shows "Traffic" on some pages and "Est. traffic" on others (and "Est. value")
  const at = (name) => cols.findIndex((l) => l === name || l.endsWith(" " + name));
  const idx = {
    result: at("search result"), type: at("page type"), words: at("words"), dr: at("dr"), ur: at("ur"),
    backlinks: at("backlinks"), domains: at("domains"), traffic: at("traffic"), value: at("value"),
    keywords: at("keywords"), topKeyword: at("top keyword"), volume: at("volume")
  };
  idx.position = idx.result - 1;

  const results = [];
  const features = [];
  let lastPosition = null;
  const seen = new Set();
  const rows = [...table.querySelectorAll("tbody > tr")];

  for (const row of rows) {
    const tds = [...row.children].filter((c) => c.tagName === "TD");
    const resultCell = tds[idx.result];
    const firstLink = resultCell ? resultCell.querySelector("a[href]") : null;
    const isOrganic = tds.length >= cols.length - 1 && !!firstLink;

    if (!isOrganic) {
      // SERP feature row (Top stories, AI Overview, Sitelinks ...)
      const label = txt(row.querySelector("button")) || txt(tds[tds.length - 1]).slice(0, 40);
      const posText = tds.length >= 2 ? txt(tds[idx.position]) : "";
      const position = /^\d+$/.test(posText) ? Number(posText) : lastPosition;
      if (label) features.push({ type: label, position, linkCount: row.querySelectorAll("a[href]").length });
      continue;
    }

    const position = num(txt(tds[idx.position]));
    lastPosition = position;
    const href = firstLink.href;
    const isRedirect = /^https?:\/\/(www\.)?google\.[a-z.]+\/(goto|url)\b/i.test(href);
    const title = txt(firstLink);
    const cell = (i) => (i >= 0 && tds[i] ? txt(tds[i]) : "");
    const raw = {
      words: cell(idx.words), dr: cell(idx.dr), ur: cell(idx.ur), backlinks: cell(idx.backlinks),
      domains: cell(idx.domains), traffic: cell(idx.traffic), value: cell(idx.value),
      keywords: cell(idx.keywords), topKeyword: cell(idx.topKeyword), volume: cell(idx.volume)
    };
    let domain = "";
    if (!isRedirect) { try { domain = new URL(href).hostname.replace(/^www\./, ""); } catch (e) {} }

    if (isRedirect && !wantRedirects) {
      features.push({ type: "Google redirect link (skipped)", position, linkCount: 1, title });
      continue;
    }
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const clean = (v) => (isNA(v) ? "" : v);
    results.push({
      position,
      domain,
      title,
      url: href,
      isRedirect,
      pageType: idx.type >= 0 && tds[idx.type] ? leafTexts(tds[idx.type]) : [],
      words: num(raw.words),
      dr: num(raw.dr),
      ur: num(raw.ur),
      // same field names the SEMrush /serp-data endpoint returns, so the n8n nodes keep working
      pageAS: clean(raw.dr),
      refDomains: clean(raw.domains),
      backlinks: clean(raw.backlinks),
      traffic: clean(raw.traffic),
      keywords: clean(raw.keywords),
      trafficValue: clean(raw.value),
      topKeyword: clean(raw.topKeyword),
      topKeywordVolume: clean(raw.volume),
      metrics: {
        backlinks: num(raw.backlinks), refDomains: num(raw.domains), traffic: num(raw.traffic),
        trafficValue: num(raw.value), keywords: num(raw.keywords), topKeywordVolume: num(raw.volume)
      }
    });
  }

  const heading = [...document.querySelectorAll("span, div")].map((e) => (e.children.length ? "" : txt(e))).find((t) => /^SERP overview for/i.test(t)) || "";
  const kwMatch = heading.match(/SERP overview for\s+["“]?(.*?)["”]?$/i);
  return {
    containerFound: true,
    rowsFound: rows.length,
    results,
    features,
    headers: cols.filter(Boolean),
    title: heading,
    keywordOnPage: kwMatch ? kwMatch[1] : ""
  };
}

// Presses the "Update" button next to "SERP not found. Try updating. It will cost you one credit."
// The message and the button can be separate elements, so the smallest element that holds the message
// is found first, then its ancestors are searched for a button / link whose text is exactly "Update".
async function ahrefsPressUpdate(target) {
  return target.evaluate(() => {
    const txt = (e) => String(e.textContent || "").replace(/\s+/g, " ").trim();
    const holders = [...document.querySelectorAll("*")].filter((e) => /SERP not found/i.test(txt(e)));
    if (!holders.length) return false;
    const marker = holders[holders.length - 1]; // document order puts the deepest holder last
    for (let el = marker; el && el !== document.documentElement; el = el.parentElement) {
      const btn = [...el.querySelectorAll("button, [role=button], a, span")].find((b) => /^update$/i.test(txt(b)));
      if (btn) { (btn.closest("button, [role=button], a") || btn).click(); return true; }
    }
    return false;
  }).catch(() => false);
}

app.post("/ahrefs-serp-data", async (req, res) => {
  const startedAt = Date.now();
  let tempBrowser = null;
  try {
    const keyword = String(req.body?.keyword || "").replace(/^=+/, "").trim();
    const html = typeof req.body?.html === "string" ? req.body.html : "";
    const country = /^[a-z]{2}$/i.test(String(req.body?.country || "")) ? String(req.body.country).toLowerCase() : "us";
    const maxResults = Math.max(1, Math.min(Number(req.body?.maxResults) || 10, 30));
    const wantRedirects = req.body?.includeRedirects === true;

    let target;
    let sourceUrl = "";
    let loadedPage = false;

    if (html) {
      // Offline dry-run: parse a saved copy of the Ahrefs page. No Ahrefs request, no credits.
      tempBrowser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      target = await tempBrowser.newPage();
      await target.setContent(html, { waitUntil: "domcontentloaded" });
      sourceUrl = "html-input";
    } else {
      if (!keyword) return res.status(400).json({ success: false, error: "Keyword missing" });
      if (!page) return res.json({ success: false, error: "No active browser session. Call /login first.", phase_status: "NO_SESSION" });
      target = page;

      // Reuse the page when it already shows this keyword's overview (saves a page load and credits).
      let alreadyThere = false;
      try {
        const u = new URL(page.url());
        alreadyThere = u.pathname === `/keywords-explorer/google/${country}/overview`
          && (u.searchParams.get("keyword") || "").toLowerCase() === keyword.toLowerCase();
      } catch (e) {}

      if (!alreadyThere) {
        const wanted = `https://arx.rankytools.com/keywords-explorer/google/${country}/overview?keyword=${encodeURIComponent(keyword)}`;
        console.log(`[Ahrefs SERP] opening overview for "${keyword}"`);
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await page.goto(wanted, { waitUntil: "domcontentloaded", timeout: 60000 });
            break;
          } catch (navErr) {
            if (attempt === 2) throw navErr;
            console.log("[Ahrefs SERP] overview load timed out, retrying once");
          }
        }
        loadedPage = true;
      } else {
        console.log(`[Ahrefs SERP] already on the overview for "${keyword}", reading it`);
      }
      sourceUrl = page.url();

      if (/limit-over/i.test(sourceUrl)) {
        return res.json({ success: false, error: "RANKYTOOLS_LIMIT_OVER", message: "RankyTools daily credits are finished", url: sourceUrl, phase_status: "CREDITS_FINISHED" });
      }
      if (/\/login/i.test(sourceUrl)) {
        return res.json({ success: false, error: "Session expired, call /login again", url: sourceUrl, phase_status: "SESSION_EXPIRED" });
      }
    }

    // What the SERP widget shows right now:
    //   "table"   = the SERP table is rendered
    //   "missing" = Ahrefs says "SERP not found. Try updating. It will cost you one credit."
    //   "loading" = neither yet
    const serpState = () => target.evaluate(() => {
      const hasTable = [...document.querySelectorAll("table")].some((t) => {
        const head = String((t.querySelector("thead") || {}).textContent || "");
        return /search result/i.test(head) && t.querySelectorAll("tbody tr").length > 0;
      });
      if (hasTable) return "table";
      return /SERP not found/i.test(String(document.body ? document.body.innerText : "")) ? "missing" : "loading";
    }).catch(() => "loading");

    // The Ahrefs page scrolls inside an inner container, not the window, so scroll every scrollable element.
    const scrollAll = (step) => target.evaluate((s) => {
      window.scrollTo({ top: s * 700, behavior: "instant" });
      [...document.querySelectorAll("*")]
        .filter((e) => e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
        .forEach((e) => e.scrollTo({ top: s * 700, behavior: "instant" }));
    }, step).catch(() => {});

    // keepWaitingOnMissing: right after pressing Update the old "SERP not found" text can stay on screen
    // until the new SERP is built, so in that case "missing" must not end the wait.
    const waitForSerp = async (rounds, keepWaitingOnMissing = false) => {
      let state = await serpState();
      for (let i = 0; i < rounds && (state === "loading" || (keepWaitingOnMissing && state === "missing")); i++) {
        await scrollAll(i);
        await target.waitForTimeout(1500);
        state = await serpState();
      }
      return state;
    };

    let state = await waitForSerp(12);
    let refreshed = false;

    let updateButtonFound = null;
    if (state === "missing" && req.body?.refresh === true) {
      // Costs ONE RankyTools/Ahrefs credit, so it only runs when the caller passes refresh: true.
      // (In `html` mode the click only happens inside the saved page: no request, no credit.)
      console.log(`[Ahrefs SERP] SERP not found for "${keyword}", pressing Update (1 credit)`);
      updateButtonFound = await ahrefsPressUpdate(target);
      if (updateButtonFound) {
        refreshed = true;
        await target.waitForTimeout(html ? 300 : 3000);
        // generating a fresh SERP can take a while: wait up to ~60 seconds
        state = await waitForSerp(html ? 6 : 40, true);
      }
    }

    if (state === "missing") {
      return res.json({
        success: false,
        error: "AHREFS_SERP_NOT_AVAILABLE",
        message: "Ahrefs has no stored SERP for this keyword (\"SERP not found. Try updating. It will cost you one credit.\"). Send refresh:true to press Update (1 credit), or use another keyword spelling.",
        canRefresh: true,
        refreshed,
        updateButtonFound,
        keyword,
        url: sourceUrl,
        phase_status: "AHREFS_SERP_MISSING"
      });
    }
    if (state === "table") await target.waitForTimeout(loadedPage ? 1500 : 300); // let the last rows finish rendering

    const serp = await target.evaluate(ahrefsSerpExtract, { wantRedirects });
    const results = serp.results.slice(0, maxResults);

    const keywordMismatch = !html && serp.keywordOnPage && serp.keywordOnPage.toLowerCase() !== keyword.toLowerCase();
    if (keywordMismatch) console.log(`[Ahrefs SERP] warning: page shows "${serp.keywordOnPage}" but "${keyword}" was requested`);

    return res.json({
      success: true,
      keyword: keyword || serp.keywordOnPage,
      source: "Ahrefs SERP overview",
      url: sourceUrl,
      serp: {
        containerFound: serp.containerFound,
        rowsFound: serp.rowsFound,
        resultsFound: results.length,
        results
      },
      features: serp.features,
      headers: serp.headers,
      pageTitle: serp.title,
      keywordOnPage: serp.keywordOnPage,
      keywordMismatch: !!keywordMismatch,
      refreshed,
      updateButtonFound,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[Ahrefs SERP] error:", error);
    return res.json({ success: false, error: error.message, phase_status: "AHREFS_SERP_FAILED", timestamp: new Date().toISOString() });
  } finally {
    if (tempBrowser) await tempBrowser.close().catch(() => {});
  }
});

app.post("/navigate",async(req,res)=>{

try{


const {url}=req.body;


if(!page){

return res.status(400).json({
success:false,
error:"No active browser session"
});

}



try{

await page.goto(url,{
waitUntil:"commit",
timeout:60000
});


}catch(error){

console.log(
"Navigation ignored:",
error.message
);

}



await page.waitForTimeout(10000);



res.json({

success:true,

title:await page.title(),

url:page.url(),

browserSession:true

});


}

catch(error){

res.status(500).json({

success:false,

error:error.message

});

}


});


// =====================================
// OPEN TOOL
// =====================================

app.post("/open-tool", async(req,res)=>{

try{

const {url}=req.body;


if(!page){

return res.status(400).json({
success:false,
error:"No active session"
});

}


if(!url){

return res.status(400).json({
success:false,
error:"URL required"
});

}


// listen for popup/new tab

let newPage = null;


context.once("page", async(p)=>{

newPage = p;

await p.waitForLoadState("domcontentloaded").catch(()=>{});

});



// navigate

if(!url || !url.startsWith("http")){
    return res.status(400).json({
        success:false,
        error:"Invalid URL",
        received:url
    });
}


await page.goto(url,{
    waitUntil:"commit",
    timeout:60000
}).catch(err=>{
console.log(
"navigation:",
err.message
);
});


await page.waitForTimeout(8000);


// if popup opened

if(newPage){

page = newPage;

await page.waitForTimeout(5000);

}



res.json({

success:true,

title:await page.title(),

url:page.url(),

text:(await page.locator("body").innerText().catch(()=>"" )).substring(0,5000)

});


}

catch(error){

res.status(500).json({

success:false,

error:error.message

});

}

});






// =====================================
// PAGE INFO
// =====================================


app.get("/page-info",async(req,res)=>{


try{


if(!page){

return res.status(400).json({

success:false,

error:"No active session"

});

}



const text =
await page.locator("body").innerText();



res.json({

success:true,

title:await page.title(),

url:page.url(),

text:text.substring(0,30000)

});


}

catch(error){


res.status(500).json({

success:false,

error:error.message

});


}



});








// =====================================
// EXTRACT DATA
// =====================================


// =====================================
// EXTRACT USING EXISTING SESSION
// =====================================
// =====================================
// CROP IMAGE
// Smart crop that keeps the top of the head in frame for portraits.
//
// Headers (all optional):
//   x-target-width    (default 1600)
//   x-target-height   (default 900)
//   x-jpeg-quality    (default 85)
//   x-crop-strategy   auto | face | center | attention   (default "auto")
//
// Strategy behaviour:
//   auto      → picks "top" for tall portrait sources, "attention" otherwise
//   face      → always "top" (best for head-shots & people)
//   center    → plain center crop
//   attention → sharp's saliency (good for landscapes / products)
// =====================================
app.post('/crop',
  express.raw({ type: 'image/*', limit: '20mb' }),
  async (req, res) => {
    try {
      const w = parseInt(req.headers['x-target-width'] || '1600', 10);
      const h = parseInt(req.headers['x-target-height'] || '900', 10);
      const q = parseInt(req.headers['x-jpeg-quality'] || '85', 10);
      const strategy = String(req.headers['x-crop-strategy'] || 'auto').toLowerCase();

      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: 'empty body' });
      }

      // Read source dimensions
      const meta = await sharp(req.body).metadata();
      const srcW = meta.width || 0;
      const srcH = meta.height || 0;

      // SMART strategy (default): a picture whose shape is close to the target is cropped a little.
      // Any other shape (portrait, square, panorama) is NEVER cut: it is placed whole on a blurred copy of itself,
      // so no face or subject is lost.
      const srcRatio = srcW && srcH ? srcW / srcH : 1.78;
      const dstRatio = w / h;
      const loss = srcRatio > dstRatio ? 1 - dstRatio / srcRatio : 1 - srcRatio / dstRatio; // share of the picture that cover-crop removes
      if (strategy === 'smart' || strategy === 'auto') {
        if (loss > 0.2) {
          const bg = await sharp(req.body).rotate()
            .resize(w, h, { fit: 'cover', position: 'center' })
            .blur(28).modulate({ brightness: 0.8 }).toBuffer();
          const fg = await sharp(req.body).rotate()
            .resize(w, h, { fit: 'inside', withoutEnlargement: false }).toBuffer();
          const outFit = await sharp(bg)
            .composite([{ input: fg, gravity: 'centre' }])
            .sharpen({ sigma: 0.6 })
            .jpeg({ quality: q, mozjpeg: true })
            .toBuffer();
          console.log(`[crop] src=${srcW}x${srcH} -> ${w}x${h} | smart: blur-fit (cover would lose ${Math.round(loss * 100)}%)`);
          return res.set('Content-Type', 'image/jpeg').send(outFit);
        }
      }

      // Pick position
      let position = 'attention';
      if (strategy === 'center') position = 'center';
      else if (strategy === 'face') position = 'top';

      console.log(
        `[crop] src=${srcW}x${srcH} → ${w}x${h} | strategy=${strategy} position=${position} loss=${Math.round(loss * 100)}%`
      );

      const out = await sharp(req.body)
        .rotate()                                     // honour EXIF orientation
        .resize(w, h, {
          fit: 'cover',
          position,                                   // 'top' | 'center' | 'attention'
          withoutEnlargement: false                   // allow upscale for small thumbs
        })
        .sharpen({ sigma: 0.8 })                      // subtle sharpen after resize
        .jpeg({ quality: q, mozjpeg: true })          // better JPEG compression
        .toBuffer();

      res.set('Content-Type', 'image/jpeg').send(out);
    } catch (e) {
      console.error('[crop] error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

app.post("/extract",async(req,res)=>{


try{


const {
selector
}=req.body;



if(!page){

return res.status(400).json({

success:false,

error:"No active browser session"

});

}



// verify current session first

const currentUrl = page.url();

console.log(currentUrl);


if(currentUrl.includes("protect")){

return res.json({

success:false,

error:"Session expired - login required",

url:currentUrl

});

}



if(
currentUrl.includes("/login")
){

return res.status(401).json({

success:false,

error:"Session expired"

});

}



const targetSelector = selector || "body";



await page.waitForTimeout(2000);



const data =
await page
.locator(targetSelector)
.allTextContents();



res.json({

success:true,

title:await page.title(),

url:page.url(),

selector:targetSelector,

data

});


}

catch(error){


res.status(500).json({

success:false,

error:error.message

});


}


});







// =====================================
// SCREENSHOT
// =====================================


app.get("/screenshot",async(req,res)=>{


try{


if(!page){

return res.status(400).json({

success:false,

error:"No active session"

});

}



await page.screenshot({

path:"/tmp/rankytolls.png",

fullPage:true

});



res.json({

success:true

});


}

catch(error){


res.status(500).json({

success:false,

error:error.message

});


}


});








// =====================================
// DEBUG BROWSER SESSION
// =====================================


app.get("/browser-session",async(req,res)=>{


res.json({

browserExists:!!browser,

contextExists:!!context,

pageExists:!!page,

url:page ? page.url() : null

});


});








// =====================================
// EXECUTE JAVASCRIPT
// =====================================


app.post("/evaluate",async(req,res)=>{


try{


const {
script
}=req.body;



if(!page){

return res.status(400).json({

success:false,

error:"No active session"

});

}



const result =
await page.evaluate(script);



res.json({

success:true,

result

});


}

catch(error){


res.status(500).json({

success:false,

error:error.message

});


}


});








// =====================================
// LOGOUT
// =====================================


app.post("/logout",async(req,res)=>{


try{


if(browser){

await browser.close().catch(()=>{});

}


browser=null;

context=null;

page=null;



res.json({

success:true,

loggedOut:true

});


}

catch(error){


res.status(500).json({

success:false,

error:error.message

});


}


});

// =====================================
// FETCH EXTERNAL URL — for competitor HTML
// Uses a SEPARATE page in the SAME context
// so it never clobbers the RankyTools session.
// =====================================

app.post("/fetch", async (req, res) => {

  let fetchPage = null;

  try {

    const {
      url,
      waitUntil = "domcontentloaded",
      timeout = 30000
    } = req.body || {};

    // ---- Validate ----
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({
        success: false,
        error: "Valid URL required (http:// or https://)",
        received: url || null
      });
    }

    // ---- Need an active context ----
    if (!context) {
      return res.status(400).json({
        success: false,
        error: "No active browser context. Call /login first."
      });
    }

    // ---- New isolated page (never touch `page`) ----
    fetchPage = await context.newPage();

    await fetchPage.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // ---- Block heavy resources to speed up fetch ----
    await fetchPage.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // ---- Navigate ----
    const started = Date.now();
    let response = null;

    try {
      response = await fetchPage.goto(url, {
        waitUntil,
        timeout: Math.min(Number(timeout) || 30000, 60000)
      });
    } catch (navErr) {
      console.log("Fetch nav warning:", navErr.message);
    }

    await fetchPage.waitForTimeout(1500);

    const html = await fetchPage.content();
    const finalUrl = fetchPage.url();
    const statusCode = response ? response.status() : 0;

    return res.json({
      success: true,
      url,
      finalUrl,
      statusCode,
      bytes: html.length,
      durationMs: Date.now() - started,
      data: html
    });

  } catch (error) {

    console.log("Fetch error:", error);

    return res.json({
      success: false,
      url: req.body?.url || null,
      error: error.message,
      data: ""
    });

  } finally {

    if (fetchPage) {
      await fetchPage.close().catch(() => {});
    }

  }

});


// POST /google-image
// Body: { "query": "imran khan portrait", "count": 5, "provider": "auto" | "ddg" | "bing" }
// Image search without an API key. DuckDuckGo is tried first (3 attempts, because its
// i.js endpoint intermittently answers 403 to bots), then Bing Images as the fallback.
// Stock-photo CDNs (watermarked) are filtered out.
const IMG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const imgSleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastDdgAt = 0;
let ddgBlockedUntil = 0;

async function ddgImageSearch(query) {
  // keep a gap between DuckDuckGo requests: the workflow sends 4 queries back to back
  const gap = 1500 - (Date.now() - lastDdgAt);
  if (gap > 0) await imgSleep(gap);
  lastDdgAt = Date.now();

  const initRes = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    { headers: { 'User-Agent': IMG_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } }
  );
  if (!initRes.ok) throw new Error(`DDG init ${initRes.status}`);
  const initHtml = await initRes.text();

  let rawCookies = [];
  try {
    if (typeof initRes.headers.getSetCookie === 'function') rawCookies = initRes.headers.getSetCookie();
  } catch (e) { /* ignore */ }
  const cookieHeader = rawCookies.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');

  let vqd = null;
  for (const p of [/vqd=["']?([\d-]+)["']?/, /vqd=4-([\d-]+)/, /"vqd":\s*"([\d-]+)"/, /vqd%3D([\d-]+)/]) {
    const m = initHtml.match(p);
    if (m) { vqd = m[1]; break; }
  }
  if (!vqd) throw new Error('DDG_VQD_MISSING');

  const headers = {
    'User-Agent': IMG_UA,
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://duckduckgo.com/',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const imgRes = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`,
    { headers }
  );
  if (!imgRes.ok) throw new Error(`DDG i.js ${imgRes.status}`);
  const data = await imgRes.json();
  return (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r && r.image)
    .map((r) => ({
      url: r.image,
      thumbnail: r.thumbnail || r.image,
      downloadUrl: r.image,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      title: r.title || '',
      source: r.source || 'duckduckgo',
      sourceUrl: r.url || '',
      originalUrl: r.image,
      alt: r.title || '',
      description: r.title || ''
    }));
}

/* Wikipedia / Wikimedia: free-licence pictures used in the matching Wikipedia articles (commons.wikimedia.org itself is blocked on some networks, en.wikipedia.org is not) */
async function commonsImageSearch(query) {
  const H = { headers: { 'User-Agent': 'BlogAutomationImageBot/1.0 (image search)', 'Accept': 'application/json' } };
  const sres = await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=2&srsearch=' + encodeURIComponent(query), H);
  if (!sres.ok) throw new Error('Wikipedia search ' + sres.status);
  const titles = (((await sres.json()).query || {}).search || []).map((x) => x.title).slice(0, 1);
  let pages = [];
  for (const t of titles) {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&generator=images&gimlimit=40&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600&titles=' + encodeURIComponent(t), H);
    if (!res.ok) continue;
    const data = await res.json();
    pages = pages.concat(Object.values((data.query && data.query.pages) || {}).map((p) => ({ ...p, pageTitle: t })));
  }
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return pages.map((p) => {
    const ii = (p.imageinfo || [])[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || '')) return null;
    const em = ii.extmetadata || {};
    const license = strip(em.LicenseShortName && em.LicenseShortName.value);
    if (!license || /non.?commercial|\bNC\b|fair use|non.?free|no.?derivs?|\bND\b/i.test(license)) return null; // not allowed on a monetised blog
    const pd = /public domain|cc0|pd\b/i.test(license);
    const author = strip(em.Artist && em.Artist.value).slice(0, 80);
    const title = String(p.title || '').replace(/^File:/i, '').replace(/\.[a-z]{3,4}$/i, '').replace(/_/g, ' ');
    const desc = strip(em.ImageDescription && em.ImageDescription.value).slice(0, 200);
    return {
      url: ii.thumburl || ii.url,
      thumbnail: ii.thumburl || ii.url,
      downloadUrl: ii.thumburl || ii.url,
      width: Number(ii.thumbwidth || ii.width) || 0,
      height: Number(ii.thumbheight || ii.height) || 0,
      title: (p.pageTitle ? p.pageTitle + ': ' : '') + title + (desc ? ' ' + desc : ''),
      source: 'wikimedia-commons',
      sourceUrl: ii.descriptionurl || '',
      originalUrl: ii.url,
      alt: title,
      description: desc || title,
      license: license,
      freeLicense: true,
      publicDomain: pd,
      attribution: pd ? '' : ('Image: ' + (author || 'Wikimedia Commons') + (license ? ', ' + license : ''))
    };
  }).filter(Boolean).filter((c) => c.width >= 900 && !/logo|icon|flag|map|symbol|signature|commons-|wiki|button|banner|poster/i.test(c.alt));
}

async function bingImageSearch(query) {
  const res = await fetch(
    `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC3&first=1`,
    { headers: { 'User-Agent': IMG_UA, 'Accept-Language': 'en-US,en;q=0.9' } }
  );
  if (!res.ok) throw new Error(`Bing ${res.status}`);
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/<a[^>]*class="[^"]*\biusc\b[^"]*"[^>]*\sm="([^"]+)"/g)) {
    try {
      const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"));
      if (!j.murl) continue;
      const title = String(j.t || '').replace(/[]/g, '').trim();
      out.push({
        url: j.murl,
        thumbnail: j.turl || j.murl,
        downloadUrl: j.murl,
        width: 0,
        height: 0,
        title,
        source: 'Bing',
        sourceUrl: j.purl || '',
        originalUrl: j.murl,
        alt: title,
        description: title
      });
    } catch (e) { /* skip one bad entry */ }
  }
  return out;
}

app.post('/google-image', async (req, res) => {
  const { query, count = 8, provider = 'auto', subject = '' } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const order = provider === 'bing' ? ['bing'] : provider === 'ddg' ? ['ddg'] : ['ddg', 'bing'];
    const attemptLog = [];
    let candidates = [];
    let usedProvider = '';

    for (const p of order) {
      // After DuckDuckGo exhausted its attempts, skip it for 10 minutes and go straight to Bing
      if (p === 'ddg' && provider === 'auto' && Date.now() < ddgBlockedUntil) {
        attemptLog.push('ddg: skipped (cooling down after 403)');
        continue;
      }
      const attempts = p === 'ddg' ? 2 : 2;
      for (let a = 1; a <= attempts && !candidates.length; a++) {
        try {
          candidates = p === 'ddg' ? await ddgImageSearch(query) : await bingImageSearch(query);
          if (candidates.length) usedProvider = p;
          else attemptLog.push(`${p}#${a}: 0 results`);
        } catch (e) {
          attemptLog.push(`${p}#${a}: ${e.message}`);
          if (a < attempts) await imgSleep(1500 * a);
        }
      }
      if (candidates.length) break;
      if (p === 'ddg' && provider === 'auto') ddgBlockedUntil = Date.now() + 10 * 60 * 1000;
    }

    if (!candidates.length) {
      console.error(`[image-search] no images for "${query}": ${attemptLog.join(' | ')}`);
      try {
        const onlyCommons = await commonsImageSearch(String(subject || query));
        if (onlyCommons.length) return res.json({ success: true, query, commons: onlyCommons.length, provider: 'commons', count: onlyCommons.length, images: onlyCommons.slice(0, count), meta: { retries: attemptLog } });
      } catch (e) { attemptLog.push('commons: ' + e.message); }
      return res.json({ success: false, query, count: 0, images: [], error: attemptLog.join(' | ') });
    }
    if (attemptLog.length) console.log(`[image-search] "${query}" ok via ${usedProvider} after: ${attemptLog.join(' | ')}`);

    // Layer 1: reject stock CDNs (always watermarked)
    const stockHosts = [
      'gettyimages.com', 'istockphoto.com', 'shutterstock.com',
      'alamy.com', 'dreamstime.com', 'depositphotos.com',
      '123rf.com', 'stock.adobe.com', 'adobe.com/stock',
      'vectorstock.com', 'bigstockphoto.com', 'canstockphoto.com'
    ];
    const layer1Clean = candidates.filter((c) => {
      const u = (c.url || '').toLowerCase();
      return !stockHosts.some((h) => u.includes(h));
    });
    // Wikimedia Commons candidates come first (free licence); the workflow scores everything and picks the best
    let commons = [];
    try {
      const generic = /\b(official|photo|photos|picture|recent|editorial|illustration|concept|tutorial|step by step|product|closeup|in use|box|speech)\b/gi;
      const cq = String(query).replace(generic, ' ').replace(/\s+/g, ' ').trim();
      commons = await commonsImageSearch(cq || query);
      if (commons.length < 3 && subject && subject.toLowerCase() !== (cq || '').toLowerCase()) commons = commons.concat(await commonsImageSearch(subject));
    } catch (e) { attemptLog.push('commons: ' + e.message); }
    const seenUrls = new Set();
    const finalImages = commons.concat(layer1Clean).filter((c) => { if (seenUrls.has(c.url)) return false; seenUrls.add(c.url); return true; }).slice(0, count + commons.length);

    return res.json({
      success: true,
      query,
      commons: commons.length,
      provider: usedProvider,
      count: finalImages.length,
      images: finalImages,
      meta: { candidates: candidates.length, layer1Clean: layer1Clean.length, retries: attemptLog }
    });
  } catch (e) {
    console.error('[image-search] FATAL:', e);
    return res.status(500).json({ success: false, query, count: 0, images: [], error: e.message });
  }
});


app.listen(3000,"0.0.0.0",()=>{


console.log(
"Playwright server running on port 3000"
);


});
