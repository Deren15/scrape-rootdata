const { scrapeRootData } = require('../src/scraper');

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      // Verify the request is from Vercel Cron
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await scrapeRootData();
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({ error: error.message });
  }
}; 