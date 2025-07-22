const fetch = require('node-fetch');
require('dotenv').config();

// Configuration - Update these with your details
const SERVICES = {
  radarr: {
    baseUrl: process.env.RADARR_BASE_URL,
    apiKey: process.env.RADARR_API_KEY 
  },
  sonarr: {
    baseUrl: process.env.SONARR_BASE_URL,
    apiKey: process.env.SONARR_API_KEY
  }
};

// Helper function to log requests
const logRequest = (target, url, method, status, responseData) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    target,
    url,
    method,
    status,
    responseData: responseData ? JSON.stringify(responseData).substring(0, 500) : null
  }));
};

exports.handler = async (event, context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ 
        success: false,
        error: 'Method Not Allowed',
        allowedMethods: ['POST']
      }) 
    };
  }

  try {
    const requestBody = JSON.parse(event.body);
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
    const { target, path = '', method = 'GET', body = null } = requestBody;
    
    // Validate target
    if (!target || !SERVICES[target]) {
      const error = `Invalid service target: ${target}. Valid targets are: ${Object.keys(SERVICES).join(', ')}`;
      console.error(error);
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: error
        })
      };
    }

    const service = SERVICES[target];
    const url = new URL(path, service.baseUrl).toString();
    
    console.log(`Making ${method} ${target} request to:`, url);
    
    const requestOptions = {
      method: method,
      headers: {
        'X-Api-Key': service.apiKey,
        'Accept': 'application/json'
      }
    };

    // Only include Content-Type and body for non-GET requests with body
    if (method !== 'GET' && body) {
      requestOptions.headers['Content-Type'] = 'application/json';
      // Check if body is already a JSON string
      if (typeof body === 'string' && (body.startsWith('{') || body.startsWith('['))) {
        // Already JSON string, use as is
        requestOptions.body = body;
        console.log('Using pre-formatted JSON body');
      } else {
        // Convert to JSON string
        requestOptions.body = JSON.stringify(body);
        console.log('Converting body to JSON');
      }
    }
    
    console.log('Request options:', JSON.stringify(requestOptions, null, 2));
    const response = await fetch(url, requestOptions);

    let responseData;
    const textResponse = await response.text();
    
    try {
      responseData = textResponse ? JSON.parse(textResponse) : null;
    } catch (e) {
      console.error(`Failed to parse JSON response from ${target}:`, textResponse);
      return {
        statusCode: 502,
        body: JSON.stringify({
          success: false,
          error: `Invalid JSON response from ${target}`,
          response: textResponse
        })
      };
    }
    
    logRequest(target, url, 'POST', response.status, responseData);
    
    return {
      statusCode: response.status,
      body: JSON.stringify({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: responseData
      }, null, 2)
    };
    
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }, null, 2)
    };
  }
};
