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

app.post('/weather', async (req, res) => {
    console.log("🌦️ [WEATHER API] Incoming request received!");
    console.log("🌦️ [WEATHER API] Raw Payload:", JSON.stringify(req.body, null, 2));

    try {
        const { locations } = req.body;
        const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

        if (!WEATHER_API_KEY) {
            console.error("🌦️ [WEATHER API] ERROR: No API Key found in env variables!");
            return res.status(500).json({ error: "Weather API key not configured on server" });
        }

        if (!locations || !Array.isArray(locations)) {
            console.error("🌦️ [WEATHER API] ERROR: Locations payload is invalid or empty!");
            return res.status(400).json({ error: "Invalid locations payload" });
        }

        let forecastResults = [];

        const getIcon = (code) => {
            const rainCodes = [1063, 1180, 1183, 1186, 1189, 1192, 1195, 1198, 1201, 1240, 1243, 1246];
            const cloudCodes = [1006, 1009];
            const partlyCloudyCodes = [1003];
            const snowCodes = [1066, 1114, 1213, 1219, 1222, 1225];
            const thunderCodes = [1087, 1273, 1276, 1279, 1282];
            
            if (rainCodes.includes(code)) return 'rainy-outline';
            if (cloudCodes.includes(code)) return 'cloudy-outline';
            if (partlyCloudyCodes.includes(code)) return 'partly-sunny-outline';
            if (snowCodes.includes(code)) return 'snow-outline';
            if (thunderCodes.includes(code)) return 'thunderstorm-outline';
            return 'sunny-outline';
        };

        // Process each day safely
        for (let item of locations) {
            if (!item.locationQuery) continue;

            console.log(`🌦️ [WEATHER API] Querying WeatherAPI for: "${item.locationQuery}" on Date: ${item.date}`);

            try {
                const url = `http://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(item.locationQuery)}&dt=${item.date}`;
                const apiRes = await axios.get(url);
                const data = apiRes.data;

                console.log(`🌦️ [WEATHER API] Success for "${item.locationQuery}". Returned Location: ${data.location?.name}`);

                if (data && data.forecast && data.forecast.forecastday && data.forecast.forecastday.length > 0) {
                    const dayData = data.forecast.forecastday[0];
                    const dateObj = new Date(dayData.date);
                    const dayStr = dateObj.toLocaleDateString('en-GB', { weekday: 'short' });
                    const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

                    forecastResults.push({
                        id: item.date,
                        day: dayStr,
                        date: dateStr,
                        temp: `${Math.round(dayData.day.maxtemp_c)}°C`,
                        icon: getIcon(dayData.day.condition.code),
                        location: data.location.name
                    });
                }
            } catch (dayError) {
                console.error(`🌦️ [WEATHER API] ERROR fetching precise location "${item.locationQuery}":`, dayError.message);
                
                try {
                    console.log(`🌦️ [WEATHER API] Attempting fallback for ${item.date}...`);
                    const fallbackUrl = `http://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=London,UK&dt=${item.date}`;
                    const fallbackRes = await axios.get(fallbackUrl);
                    const fallbackData = fallbackRes.data;
                    
                    if (fallbackData && fallbackData.forecast && fallbackData.forecast.forecastday && fallbackData.forecast.forecastday.length > 0) {
                        const dayData = fallbackData.forecast.forecastday[0];
                        const dateObj = new Date(dayData.date);
                        
                        forecastResults.push({
                            id: item.date,
                            day: dateObj.toLocaleDateString('en-GB', { weekday: 'short' }),
                            date: dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                            temp: `${Math.round(dayData.day.maxtemp_c)}°C`,
                            icon: getIcon(dayData.day.condition.code),
                            location: 'TBC Location'
                        });
                    }
                } catch (fallbackError) {
                    console.error("🌦️ [WEATHER API] FATAL: Fallback also failed.", fallbackError.message);
                }
            }
        }

        console.log("🌦️ [WEATHER API] Sending payload back to app:", JSON.stringify(forecastResults));
        res.json(forecastResults);
    } catch (error) {
        console.error("🌦️ [WEATHER API] GLOBAL SERVER ERROR:", error.message);
        res.status(500).json({ error: "Failed to fetch weather completely" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy vault running on port ${PORT}`));
