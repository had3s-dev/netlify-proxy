const fetch = require('node-fetch');

// Configuration - Environment variables are set in Netlify dashboard
const SERVICES = {
  radarr: {
    baseUrl: process.env.RADARR_URL,
    apiKey: process.env.RADARR_API_KEY 
  },
  sonarr: {
    baseUrl: process.env.SONARR_URL,
    apiKey: process.env.SONARR_API_KEY
  }
};

// Log environment setup
console.log('Environment check:', {
  radarrUrl: process.env.RADARR_URL ? 'Set' : 'Missing',
  radarrKey: process.env.RADARR_API_KEY ? 'Set' : 'Missing',
  sonarrUrl: process.env.SONARR_URL ? 'Set' : 'Missing', 
  sonarrKey: process.env.SONARR_API_KEY ? 'Set' : 'Missing'
});

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
  console.log('=== PROXY FUNCTION CALLED ===');
  console.log('Event httpMethod:', event.httpMethod);
  console.log('Event path:', event.path);
  console.log('Event body:', event.body);
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  // Log current environment variables
  console.log('Current environment variables:', {
    RADARR_URL: process.env.RADARR_URL ? 'Set' : 'Missing',
    RADARR_API_KEY: process.env.RADARR_API_KEY ? 'Set' : 'Missing',
    SONARR_URL: process.env.SONARR_URL ? 'Set' : 'Missing',
    SONARR_API_KEY: process.env.SONARR_API_KEY ? 'Set' : 'Missing'
  });
  
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
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
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: false,
          error: error
        })
      };
    }

    const service = SERVICES[target];
    
    console.log('Service config for', target, ':', {
      baseUrl: service.baseUrl,
      hasApiKey: !!service.apiKey
    });
    
    if (!service.baseUrl) {
      const error = `Missing base URL for service ${target}. Check environment variables.`;
      console.error(error);
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: false,
          error: error,
          debug: {
            target,
            envVars: {
              RADARR_URL: process.env.RADARR_URL ? 'Set' : 'Missing',
              SONARR_URL: process.env.SONARR_URL ? 'Set' : 'Missing'
            }
          }
        })
      };
    }
    
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
    console.log('Final URL being called:', url);
    console.log('Request body being sent:', requestOptions.body);
    
    const response = await fetch(url, requestOptions);

    let responseData;
    const textResponse = await response.text();
    
    try {
      responseData = textResponse ? JSON.parse(textResponse) : null;
    } catch (e) {
      console.error(`Failed to parse JSON response from ${target}:`, textResponse.substring(0, 500));
      
      // Check if this is an HTML error page (like 404)
      if (textResponse.includes('<!DOCTYPE html>')) {
        console.error(`${target} API returned HTML error page, likely 404 or server error`);
        return {
          statusCode: 502,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type'
          },
          body: JSON.stringify({
            success: false,
            error: `Invalid JSON response`,
            raw: textResponse.substring(0, 1000)
          })
        };
      }
      
      return {
        statusCode: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({
          success: false,
          error: `Invalid JSON response from ${target}`,
          raw: textResponse.substring(0, 500)
        })
      };
    }
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(responseData, null, 2));
    
    logRequest(target, url, method, response.status, responseData);
    
    return {
      statusCode: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }, null, 2)
    };
  }
};
