import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chromium} from 'playwright';
import express from 'express';
import {fileURLToPath} from 'node:url';

test('download page handles entitlement denial, empty list, safe title and actual browser download on mobile', async () => {
  const app=express();app.use(express.static(fileURLToPath(new URL('../../public',import.meta.url))));const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.WQT_BROWSER_CHANNEL ? {channel:process.env.WQT_BROWSER_CHANNEL}: {})});
    const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.addInitScript(()=>localStorage.setItem('WQT_AUTH_TOKEN','test-only'));
    let mode='denied',requestHeaders;
    await page.route('**/api/downloads',async route=>{
      requestHeaders=route.request().headers();
      await route.fulfill({status:mode==='denied'?403:200,contentType:'application/json',body:JSON.stringify(mode==='denied'?{error:'下载资料需要有效的付费权益'}:{releases:mode==='empty'?[]:[{id:'current',title:'<script>资料</script>',version:'2026.10',size:3,filename:'rules.zip',created_at:1}]})});
    });
    await page.route('**/api/downloads/current/file',route=>route.fulfill({status:200,contentType:'application/octet-stream',body:'zip'}));
    await page.goto(`${origin}/downloads.html`);
    await page.getByText('下载资料需要有效的付费权益',{exact:true}).waitFor();
    assert.equal(await page.locator('#files button').count(),0);
    mode='empty';await page.getByRole('button',{name:'重新加载'}).click();
    await page.getByText('暂时没有发布资料。',{exact:true}).waitFor();
    mode='paid';await page.reload();
    await page.getByRole('heading',{name:'<script>资料</script>'}).waitFor();
    assert.equal(requestHeaders.authorization,'Bearer test-only');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'↓ 下载资料'}).click();
    const download=await downloaded;assert.equal(download.suggestedFilename(),'rules.zip');assert.equal(await download.failure(),null);
    await page.getByText('资料已接收，请查看浏览器下载列表。',{exact:true}).waitFor();
    if(process.env.WQT_DOWNLOAD_PREVIEW_DIR) await page.screenshot({path:`${process.env.WQT_DOWNLOAD_PREVIEW_DIR}/download-center-mobile.png`,fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    if(process.env.WQT_DOWNLOAD_PREVIEW_DIR) await page.screenshot({path:`${process.env.WQT_DOWNLOAD_PREVIEW_DIR}/download-center-desktop.png`,fullPage:true});
  } finally {await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});}
});
