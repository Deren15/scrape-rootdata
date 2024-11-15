require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs').promises;
const Airtable = require('airtable');

async function appendProjectsToJson(projects) {
  try {
    let existingData = { projects: [] };
    
    // Try to read existing file
    try {
      const fileData = await fs.readFile('rootdata_projects.json', 'utf8');
      existingData = JSON.parse(fileData);
    } catch (error) {
      // File doesn't exist yet, use empty array
    }
    
    // Append new projects
    existingData.projects.push(...projects);
    
    // Write back to file
    await fs.writeFile(
      'rootdata_projects.json',
      JSON.stringify(existingData, null, 2)
    );
  } catch (error) {
    console.error('Error appending to JSON:', error);
  }
}

async function pushProjectsToAirtable(projects) {
  try {
    const base = new Airtable({
      apiKey: process.env.AIRTABLE_API_KEY
    }).base(process.env.AIRTABLE_BASE_ID);

    // Get existing project names from Airtable
    const existingProjects = await base('Projects').select({
      fields: ['project_name']
    }).all();
    
    const existingProjectNames = new Set(
      existingProjects.map(record => record.fields.project_name)
    );

    // Check if any project exists - if so, return false to stop scraping
    if (projects.some(project => existingProjectNames.has(project.project_name))) {
      console.log('Found existing project - stopping scrape');
      return false;
    }

    // Continue with batching logic since all projects are new
    for (let i = 0; i < projects.length; i += 10) {
      const batch = projects.slice(i, i + 10);
      let retries = 3;
      
      while (retries > 0) {
        try {
          const records = batch.map(project => ({
            fields: {
              project_name: project.project_name,
              project_logo: project.project_logo,
              project_link: project.project_link,
              project_round: project.project_round,
              project_amount: project.project_amount,
              project_valuation: project.project_valuation,
              project_date: project.project_date,
              investors: JSON.stringify(project.project_investors)
            }
          }));

          await base('Projects').create(records);
          console.log(`Pushed ${records.length} new projects to Airtable`);
          break;
        } catch (error) {
          retries--;
          if (error.statusCode === 429) {
            const waitTime = 30000;
            console.log(`Rate limit hit, waiting ${waitTime/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else if (retries === 0) {
            throw new Error(`Failed to push batch to Airtable after 3 retries: ${error.message}`);
          } else {
            console.log(`Retry attempt ${3-retries} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return true;
  } catch (error) {
    console.error('Error in pushProjectsToAirtable:', error);
    await fs.appendFile(
      'failed_pushes.json', 
      JSON.stringify({ timestamp: new Date(), projects }, null, 2)
    );
    return false;
  }
}

async function scrapeRootData() {
  const browser = await chromium.launch({
    headless: false // set to false for debugging
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Store all projects
  const allProjects = [];
  
  try {
    // First go to login page
    await page.goto('https://www.rootdata.com/login', {
      waitUntil: 'networkidle'
    });
    
    // Handle the popup if it appears
    try {
      await page.waitForSelector('button:has-text("Experience it now")', { timeout: 5000 });
      await page.click('button:has-text("Experience it now")');
      await page.waitForTimeout(1000);
    } catch (error) {
      console.log('No popup found or already closed');
    }

    // Login process
    await page.fill('input[placeholder="Please enter your Email"]', 'testassetacc@gmail.com');
    await page.fill('input[placeholder="Please enter your password"]', 'RBgUb323LG2Ucx');
    await page.click('button:has-text("Sign in")');
    
    // Wait for login to complete
    await page.waitForTimeout(2000);
    
    // Navigate to fundraising page
    await page.goto('https://www.rootdata.com/Fundraising', {
      waitUntil: 'networkidle'
    });
    
    // Handle the popup by clicking "Experience it now" button
    try {
      await page.waitForSelector('button:has-text("Experience it now")', { timeout: 5000 });
      await page.click('button:has-text("Experience it now")');
      await page.waitForTimeout(1000); // Wait for popup to close
    } catch (error) {
      console.log('No popup found or already closed');
    }
    
    // Get total pages using a more reliable selector
    const totalPagesText = await page.locator('text=/Total [0-9]+/').first().textContent();
    const totalItems = parseInt(totalPagesText.match(/\d+/)[0]);
    const totalPages = Math.ceil(totalItems / 30); // 30 items per page
    
    console.log(`Total items to scrape: ${totalItems} (${totalPages} pages)`);
    
    // Iterate through pages
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      console.log(`Scraping page ${currentPage}/${totalPages}`);
      
      // Wait for the table to load
      await page.waitForSelector('table');
      
      // Extract projects from current page
      const projects = await page.evaluate(async () => {
        const rows = document.querySelectorAll('table tbody tr');
        const results = [];
        
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 6) continue;
          
          // Get project details from first cell
          const nameCell = cells[0];
          const projectLogo = nameCell.querySelector('img')?.src || null;
          const nameElement = nameCell.querySelector('.list_name');
          const projectLink = nameCell.querySelector('a')?.href || null;
          const projectName = nameElement ? nameElement.textContent.trim() : '';

          // Handle investors cell
          const investorsCell = cells[5];
          let investors = [];
          
          // Check if there's a "+N" button and click it
          const moreButton = investorsCell.querySelector('.more_btn');
          if (moreButton) {
            moreButton.click();
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const dialog = document.querySelector('.v-dialog');
            if (dialog) {
              investors = Array.from(dialog.querySelectorAll('.item'))
                .map(item => {
                  const img = item.querySelector('img');
                  const nameSpan = item.querySelector('span');
                  const link = item.closest('a')?.href || null;
                  return {
                    investor_name: nameSpan?.textContent.trim() || null,
                    investor_logo: img?.src || null,
                    investor_link: link
                  };
                })
                .filter(investor => investor.investor_name);
                
              const closeButton = dialog.querySelector('.dialog_close');
              if (closeButton) closeButton.click();
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          } else {
            investors = Array.from(investorsCell.querySelectorAll('a'))
              .map(a => ({
                investor_name: a.querySelector('.animation_underline')?.textContent.trim() || 
                              a.textContent.trim(),
                investor_logo: a.querySelector('img')?.src || null,
                investor_link: a.href || null
              }))
              .filter(investor => investor.investor_name && investor.investor_name !== '--');
          }

          results.push({
            project_name: projectName,
            project_logo: projectLogo,
            project_link: projectLink,
            project_round: cells[1].textContent.trim() || null,
            project_amount: cells[2].textContent.trim().replace('--', null),
            project_valuation: cells[3].textContent.trim().replace('--', null),
            project_date: cells[4].textContent.trim() || null,
            project_investors: investors
          });
        }
        return results;
      });
      
      // Append projects from current page to JSON
      await appendProjectsToJson(projects);
      await pushProjectsToAirtable(projects);
    //   if (!shouldContinue) {
    //     console.log('Stopping scrape as existing projects found');
    //     break;
    //   }
      console.log(`CURRENT PAGE: ${currentPage} (Added ${projects.length} projects)`);
      
      // Go to next page if not last
      if (currentPage < totalPages) {
        // Wait for pagination container and click next page
        await page.waitForSelector('.el-pagination .el-pager');
        await page.click(`.el-pagination .el-pager li.number:text("${currentPage + 1}")`);
        
        // Wait for table data to update
        await page.waitForTimeout(1000);
        await page.waitForSelector('table tbody tr');
      }
    }
    
    console.log(`Successfully scraped ${allProjects.length} projects`);
    
  } catch (error) {
    console.error('Error during scraping:', error);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeRootData }; 