const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const axios = require('axios');

const app = express();
// Keep the file in temporary memory to process it instantly
const upload = multer({ storage: multer.memoryStorage() });

// Pulls your secure keys from the server environment (NEVER hardcode these!)
const CONSUMER_KEY = process.env.SMUGMUG_API_KEY;
const CONSUMER_SECRET = process.env.SMUGMUG_API_SECRET;
const TOKEN = process.env.SMUGMUG_OAUTH_TOKEN;
const TOKEN_SECRET = process.env.SMUGMUG_OAUTH_TOKEN_SECRET;

// --- HEALTH CHECK: ARE THE KEYS LOADED? ---
console.log("Vault Status:", {
  hasApiKey: !!CONSUMER_KEY,
  hasApiSecret: !!CONSUMER_SECRET,
  hasOAuthToken: !!TOKEN,
  hasOAuthSecret: !!TOKEN_SECRET
});

// Configure SmugMug OAuth 1.0a Math
const oauth = OAuth({
  consumer: { key: CONSUMER_KEY, secret: CONSUMER_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto.createHmac('sha1', key).update(base_string).digest('base64');
  },
});

app.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No photo attached.');

    const { tripId, galleryUrl } = req.body;
    
    if (!galleryUrl) {
      throw new Error("The Gallery URL was blank or didn't make it to the server!");
    }

    let albumId = "";
    if (galleryUrl.includes('/upload/')) {
      const parts = galleryUrl.split('/');
      const uploadIndex = parts.indexOf('upload');
      albumId = parts[uploadIndex + 1]; 
    } else {
      albumId = galleryUrl.split('/').pop();
    }
    
    const albumUri = `/api/v2/album/${albumId}`;
    console.log("Calculated SmugMug AlbumUri:", albumUri);

    const request_data = {
      url: 'https://upload.smugmug.com/',
      method: 'POST',
    };

    const headers = oauth.toHeader(oauth.authorize(request_data, { key: TOKEN, secret: TOKEN_SECRET }));
    
    // --- THE CRITICAL FIX: EXPLICIT HEADERS ---
    headers['Accept'] = 'application/json';
    headers['Content-Type'] = req.file.mimetype || 'image/jpeg'; // Stops the 401 Signature crash
    headers['Content-MD5'] = crypto.createHash('md5').update(req.file.buffer).digest('base64'); // SmugMug required
    headers['X-Smug-Version'] = 'v2';
    headers['X-Smug-ResponseType'] = 'JSON';
    headers['X-Smug-AlbumUri'] = albumUri;
    headers['X-Smug-FileName'] = req.file.originalname;
    headers['Content-Length'] = req.file.size;
    headers['User-Agent'] = 'WildernessGuideProxy/1.0';
    // ------------------------------------------
    
    const smugResponse = await axios.post(request_data.url, req.file.buffer, {
      headers: headers,
      maxBodyLength: Infinity, 
    });

    console.log("✅ Success! SmugMug Response:", smugResponse.data);
    res.status(200).json({ success: true, message: 'Photo securely uploaded to SmugMug!' });

  } catch (error) {
    console.error("❌ === FULL SMUGMUG CRASH LOG ===");
    if (error.response) {
      console.error("Status Code:", error.response.status);
      const errData = error.response.data;
      // Forces Render to print the error even if it's a raw Buffer
      console.error("SmugMug Rejection Data:", errData instanceof Buffer ? errData.toString() : errData); 
    } else {
      console.error("Server Error Message:", error.message);
    }
    res.status(500).json({ success: false, error: 'Failed to upload to SmugMug' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy vault running on port ${PORT}`));
