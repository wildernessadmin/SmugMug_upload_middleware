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
    const fileName = req.file.originalname;

    // TODO: You will need to map the public 'galleryUrl' to SmugMug's internal AlbumUri.
    // E.g., if galleryUrl is "smugmug.com/gallery/XYZ", the AlbumUri is "/api/v2/album/XYZ"
    // For now, we will use a placeholder or extract the ID from the end of the URL.
    const albumId = galleryUrl.split('/').pop(); 
    const albumUri = `/api/v2/album/${albumId}`;

    const request_data = {
      url: 'https://upload.smugmug.com/',
      method: 'POST',
    };

    // Generate the cryptographic signature
    const headers = oauth.toHeader(oauth.authorize(request_data, { key: TOKEN, secret: TOKEN_SECRET }));
    
    // Add SmugMug's mandatory upload headers
    headers['Accept'] = 'application/json';
    headers['X-Smug-Version'] = 'v2';
    headers['X-Smug-ResponseType'] = 'JSON';
    headers['X-Smug-AlbumUri'] = albumUri;
    headers['X-Smug-FileName'] = fileName;
    headers['Content-Length'] = req.file.size;
    
    // Fire it to SmugMug
    const smugResponse = await axios.post(request_data.url, req.file.buffer, {
      headers: headers,
      maxBodyLength: Infinity, // Tells the server to allow massive files!
    });

    res.status(200).json({ success: true, message: 'Photo securely uploaded to SmugMug!' });

  } catch (error) {
    console.error("SmugMug Upload Error:", error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Failed to upload to SmugMug' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy vault running on port ${PORT}`));
