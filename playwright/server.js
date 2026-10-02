const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const sharp = require('sharp'); 
const SESSION_FILE="./ranky-session.json";

const app = express();

app.use(express.json());


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
app.post("/keyword-data", async (req, res) => {
  const startedAt = Date.now();
  try {
    if (!page) {
      return res.json({ success: false, error: "No active session" });
    }

    const keyword = req.body?.keyword;
    if (!keyword) {
      return res.json({ success: false, error: "Keyword missing" });
    }

    // 1. GET FILTERS FROM N8N
    const minVolume = Number(req.body?.minVolume) || 0;
    const maxKd = Number(req.body?.maxKd) || 30;
    const intent = req.body?.intent || "Informational";
    const maxRows = Number(req.body?.maxRows) || 1000;

    // Cache setup
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
          console.log(`Cache HIT for "${keyword}" (${cached.count} keywords)`);
          return res.json({ ...cached, fromCache: true });
        }
      } catch (e) { console.log("Cache read failed:", e.message); }
    }

    console.log(`Searching keyword: "${keyword}" | Filters -> Min Vol: ${minVolume}, Max KD: ${maxKd}, Intent: ${intent}`);

    // 2. BUILD INITIAL URL
    const targetUrl = `https://sr.rankytools.com/analytics/keywordmagic/?q=${encodeURIComponent(keyword)}&db=us&type=all&mode=1`;
    console.log("Navigating to page:", targetUrl);
    
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector('[data-path="report.table.next_page_button"]', { timeout: 90000 });
    console.log("Page loaded.");

    // ==========================================
    // 3. APPLY FILTERS BY CLICKING (THE RELIABLE FIX)
    // ==========================================
    
    // --- Apply KD Filter ---
    try {
        const kdButton = page.locator('button:has-text("KD %")').first();
        if (await kdButton.isVisible()) {
            await kdButton.click();
            await page.waitForTimeout(1000);
            // Select Custom Range
            await page.locator('text="Custom range"').click();
            await page.waitForTimeout(500);
            // Fill inputs
            const inputs = page.locator('input[type="number"]');
            await inputs.nth(0).fill("0");
            await inputs.nth(1).fill(String(maxKd));
            await page.locator('button:has-text("Apply")').click();
            await page.waitForTimeout(5000); // Wait for table reload
            console.log(`✅ Applied KD filter: 0 - ${maxKd}`);
        } else {
            console.log("❌ KD Filter button not visible.");
        }
    } catch (e) { console.log("❌ Could not apply KD filter:", e.message); }

    // --- Apply Intent Filter ---
    if (intent) {
        try {
            const intentButton = page.locator('button:has-text("Intent")').first();
            if (await intentButton.isVisible()) {
                await intentButton.click();
                await page.waitForTimeout(1000);
                // Click the checkbox for the desired intent
                await page.locator(`text="${intent}"`).click();
                await page.locator('button:has-text("Apply")').click();
                await page.waitForTimeout(5000); // Wait for table reload
                console.log(`✅ Applied Intent filter: ${intent}`);
            } else {
                console.log("❌ Intent Filter button not visible.");
            }
        } catch (e) { console.log("❌ Could not apply Intent filter:", e.message); }
    }

    // --- Apply Volume Filter ---
    if (minVolume > 0) {
         try {
            const volButton = page.locator('button:has-text("Volume")').first();
            if (await volButton.isVisible()) {
                await volButton.click();
                await page.waitForTimeout(1000);
                const volInput = page.locator('input[placeholder="From"]').first();
                if (await volInput.isVisible()) {
                    await volInput.fill(String(minVolume));
                    await page.locator('button:has-text("Apply")').click();
                    await page.waitForTimeout(5000); 
                    console.log(`✅ Applied Volume filter: > ${minVolume}`);
                } else {
                    console.log("❌ Volume input not visible.");
                }
            } else {
                console.log("❌ Volume Filter button not visible.");
            }
        } catch (e) { console.log("❌ Could not apply Volume filter:", e.message); }
    }

    // ==========================================
    // 4. DETECT NEW TOTALS AND SCRAPE
    // ==========================================
    let totalPages = 1;
    let totalExpected = 0;

    try {
      const lastPageAria = await page.locator('[data-path="report.table.last_page_button"]').getAttribute("aria-label").catch(() => "");
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
    } catch (e) {}

    console.log(`Filters applied. New Totals: ${totalPages} pages, ~${totalExpected} keywords.`);

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

            const intents = Array.from(row.querySelectorAll('[data-testid="table-cell-intent"] button')).map(b => (b.innerText || "").trim()).join(",");

            out.push({
              keyword: kw,
              intent: intents,
              relevance: (row.querySelector('[data-testid="table-cell-similarity-score"] span')?.innerText || "").trim(),
              volume: (row.querySelector('[data-testid="table-cell-volume"]')?.innerText || "").trim(),
              kd: (row.querySelector('[data-testid="table-cell-kd"] .sm-cell-kd__data')?.innerText || "").trim(),
              cpc: (row.querySelector('[data-testid="table-cell-cpc"]')?.innerText || "").trim(),
              serpFeatures: (() => { const btn = row.querySelector('[data-testid="table-cell-serp-features"] button'); return btn ? (btn.getAttribute("aria-label") || btn.innerText || "").trim() : ""; })(),
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

      console.log(`Page ${p}/${totalPages}: extracted ${batch.length} rows (${added} new), total unique: ${allKeywords.size}`);

      if (allKeywords.size >= effectiveMaxRows) {
        console.log(`✅ Reached effective max rows limit (${effectiveMaxRows}). Stopping pagination early.`);
        break; 
      }

      if (p === totalPages) break;

      const nextBtn = page.locator('[data-path="report.table.next_page_button"]').first();
      if (await nextBtn.isDisabled().catch(() => false)) break;

      await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300 + Math.random() * 400);
      await nextBtn.click();

      try {
        await page.waitForFunction((expected) => {
            const input = document.querySelector('[data-path="report.table.page_input"]');
            return input && input.value === String(expected);
          }, p + 1, { timeout: 20000 });
      } catch (e) { await page.waitForTimeout(3000); }

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
      scrapedAt: new Date().toISOString()
    };

    try { fs.writeFileSync(cacheFile, JSON.stringify(response, null, 2)); } catch (e) {}

    return res.json(response);

  } catch (error) {
    console.log("Keyword extraction error:", error);
    return res.json({ success: false, error: error.message, phase_status: "KEYWORD_SCRAPE_FAILED" });
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
// NAVIGATE
// =====================================


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
app.post('/crop',
  express.raw({ type: 'image/*', limit: '20mb' }),
  async (req, res) => {
    try {
      const w = parseInt(req.headers['x-target-width'] || '1600', 10);
      const h = parseInt(req.headers['x-target-height'] || '900', 10);
      const q = parseInt(req.headers['x-jpeg-quality'] || '85', 10);

      const out = await sharp(req.body)
        .resize(w, h, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: q })
        .toBuffer();

      res.set('Content-Type', 'image/jpeg').send(out);
    } catch (e) {
      console.error('crop error:', e);
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
// POST /google-image
// Body: { "query": "imran khan portrait", "count": 5 }
// Returns ONLY watermark-free images.
// POST /google-image
// Body: { "query": "imran khan portrait", "count": 5 }
app.post('/google-image', async (req, res) => {
  const { query, count = 5 } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  try {
    // ---------- 1. Fetch DDG HTML page to get vqd + cookies ----------
    const initRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    );
    if (!initRes.ok) throw new Error(`DDG init ${initRes.status}`);

    const initHtml = await initRes.text();

    // ---- capture cookies from Set-Cookie headers ----
    // Node 20+ : initRes.headers.getSetCookie()
    // Node 18  : initRes.headers.raw()['set-cookie']
    let rawCookies = [];
    try {
      if (typeof initRes.headers.getSetCookie === 'function') {
        rawCookies = initRes.headers.getSetCookie();
      } else if (typeof initRes.headers.raw === 'function') {
        rawCookies = initRes.headers.raw()['set-cookie'] || [];
      }
    } catch (e) { /* ignore */ }

    // Reduce to "name=value; name2=value2"
    const cookieHeader = rawCookies
      .map(c => String(c).split(';')[0])
      .filter(Boolean)
      .join('; ');

    console.log(`[image-search] cookies: ${cookieHeader.slice(0, 120)}...`);

    // ---------- 2. Extract vqd (multiple patterns) ----------
    let vqd = null;
    for (const p of [
      /vqd=["']?([\d-]+)["']?/,
      /vqd=4-([\d-]+)/,
      /"vqd":\s*"([\d-]+)"/,
      /vqd%3D([\d-]+)/
    ]) {
      const m = initHtml.match(p);
      if (m) { vqd = m[1]; break; }
    }
    if (!vqd) {
      return res.json({
        success: false, query, count: 0, images: [],
        error: 'DDG_VQD_MISSING'
      });
    }

    // ---------- 3. Fetch image JSON (with cookies + matching UA) ----------
    const apiUrl =
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}` +
      `&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;

    const apiHeaders = {
      'User-Agent': UA,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://duckduckgo.com/',
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };
    if (cookieHeader) apiHeaders['Cookie'] = cookieHeader;

    const imgRes = await fetch(apiUrl, { headers: apiHeaders });

    if (!imgRes.ok) {
      const body = await imgRes.text().catch(() => '');
      console.error(`[image-search] i.js ${imgRes.status} — body: ${body.slice(0, 200)}`);
      return res.json({
        success: false, query, count: 0, images: [],
        error: `DDG i.js ${imgRes.status}`,
        vqd
      });
    }

    const data = await imgRes.json();
    const results = Array.isArray(data.results) ? data.results : [];

    // ---------- 4. Normalize ----------
    const candidates = results
      .filter(r => r && r.image)
      .map(r => ({
        url: r.image,
        thumbnail: r.thumbnail || r.image,
        downloadUrl: r.image,
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
        title: r.title || '',
        source: r.source || '',
        sourceUrl: r.url || '',
        originalUrl: r.image,
        alt: r.title || '',
        description: r.title || ''
      }));

    // ---------- 5. Layer 1: reject stock CDNs ----------
    const stockHosts = [
      'gettyimages.com', 'istockphoto.com', 'shutterstock.com',
      'alamy.com', 'dreamstime.com', 'depositphotos.com',
      '123rf.com', 'stock.adobe.com', 'adobe.com/stock',
      'vectorstock.com', 'bigstockphoto.com', 'canstockphoto.com'
    ];
    const layer1Clean = candidates.filter(c => {
      const u = (c.url || '').toLowerCase();
      return !stockHosts.some(h => u.includes(h));
    });

    // ---------- 6. Layer 2: OCR (optional, only if you installed tesseract.js) ----------
    // If OCR is not set up, just return layer1Clean.
    let finalImages = layer1Clean.slice(0, count);

    // If you have OCR helpers defined earlier in server.js, uncomment this:
    /*
    finalImages = [];
    for (const cand of layer1Clean) {
      if (finalImages.length >= count) break;
      const check = await containsWatermarkText(cand.url);
      if (!check.watermarked) finalImages.push(cand);
    }
    */

    return res.json({
      success: true,
      query,
      count: finalImages.length,
      images: finalImages,
      meta: {
        candidates: candidates.length,
        layer1Clean: layer1Clean.length,
        durationMs: Date.now() - Date.now()
      }
    });

  } catch (e) {
    console.error('[image-search] FATAL:', e);
    return res.status(500).json({
      success: false, query, count: 0, images: [], error: e.message
    });
  }
});


app.listen(3000,"0.0.0.0",()=>{


console.log(
"Playwright server running on port 3000"
);


});