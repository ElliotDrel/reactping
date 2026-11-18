/* global fetch, console, process */
// Submits every sitemap URL to IndexNow (Bing, Yandex, and other participating engines).
// Run after a production deploy: node scripts/submit-indexnow.mjs
// Mirrors elliotdrel.com's submitter. 200/202 means received, not indexed.
const host = "reactping.com";
const key = "a434cd7144def4667bb0bbbdbe99750e";
const keyLocation = `https://${host}/${key}.txt`;

const sitemap = await fetch(`https://${host}/sitemap.xml`);
if (!sitemap.ok) throw new Error(`sitemap.xml returned ${sitemap.status}`);
const urlList = [...new Set([...(await sitemap.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]))];
if (!urlList.length) throw new Error("sitemap.xml has no <loc> URLs");
const offHost = urlList.find((url) => !url.startsWith(`https://${host}/`));
if (offHost) throw new Error(`sitemap.xml has a non-canonical URL: ${offHost}`);

const hosted = await fetch(keyLocation);
if (!hosted.ok || (await hosted.text()).trim() !== key) throw new Error(`${keyLocation} does not return the key`);

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation, urlList }),
});
console.log(`IndexNow: submitted ${urlList.length} URLs, HTTP ${response.status}`);
if (response.status !== 200 && response.status !== 202) process.exitCode = 1;
