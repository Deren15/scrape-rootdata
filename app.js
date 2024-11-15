const cron = require('node-cron');
const { scrapeRootData } = require('./src/scraper');

// Schedule task to run every day at 00:00 (midnight)
// cron.schedule('0 0 * * *', async () => {
// // cron.schedule('*/30 * * * * *', async () => {
//   console.log('Starting daily scrape at:', new Date().toISOString());
//   try {
//     await scrapeRootData();
//     console.log('Daily scrape completed successfully');
//   } catch (error) {
//     console.error('Error during scheduled scrape:', error);
//   }
// });

scrapeRootData()

// Keep the process running
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});
