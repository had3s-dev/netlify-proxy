/**
 * Netlify Function Proxy for Radarr/Sonarr APIs
 * Simplified, clean implementation following official API patterns
 */

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    try {
        const { service, action, data } = JSON.parse(event.body);
        
        console.log(`[PROXY] ${service}/${action} request:`, data);

        let result;
        switch (service) {
            case 'radarr':
                result = await handleRadarrRequest(action, data);
                break;
            case 'sonarr':
                result = await handleSonarrRequest(action, data);
                break;
            case 'overseerr':
                result = await handleOverseerrRequest(action, data);
                break;
            default:
                throw new Error(`Unknown service: ${service}`);
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                data: result
            })
        };

    } catch (error) {
        console.error('[PROXY] Error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};

/**
 * Handle Radarr API requests
 */
async function handleRadarrRequest(action, data) {
    const baseUrl = process.env.RADARR_URL;
    const apiKey = process.env.RADARR_API_KEY;
    
    if (!baseUrl || !apiKey) {
        throw new Error('Radarr configuration missing');
    }

    switch (action) {
        case 'add_movie':
            return await addMovieToRadarr(baseUrl, apiKey, data);
        case 'get_movies':
            return await getRadarrMovies(baseUrl, apiKey);
        case 'get_quality_profiles':
            return await getRadarrQualityProfiles(baseUrl, apiKey);
        case 'get_root_folders':
            return await getRadarrRootFolders(baseUrl, apiKey);
        default:
            throw new Error(`Unknown Radarr action: ${action}`);
    }
}

/**
 * Add movie to Radarr using proper workflow
 */
async function addMovieToRadarr(baseUrl, apiKey, data) {
    const { tmdbId, qualityProfileId, rootFolderPath, monitored = true, searchOnAdd = true } = data;
    
    if (!tmdbId || !qualityProfileId || !rootFolderPath) {
        throw new Error('Missing required fields: tmdbId, qualityProfileId, rootFolderPath');
    }

    // Step 1: Lookup movie details from TMDB
    console.log(`[RADARR] Looking up movie TMDB:${tmdbId}`);
    const lookupUrl = `${baseUrl}/api/v3/movie/lookup/tmdb?apikey=${apiKey}&tmdbid=${tmdbId}`;
    
    const lookupResponse = await fetch(lookupUrl);
    if (!lookupResponse.ok) {
        throw new Error(`Movie lookup failed: ${lookupResponse.status} ${lookupResponse.statusText}`);
    }
    
    const movieDetails = await lookupResponse.json();
    if (!movieDetails) {
        throw new Error(`Movie not found in TMDB: ${tmdbId}`);
    }

    console.log(`[RADARR] Found movie: ${movieDetails.title} (${movieDetails.year})`);

    // Step 2: Add movie to Radarr
    const addPayload = {
        title: movieDetails.title,
        titleSlug: movieDetails.titleSlug,
        images: movieDetails.images || [],
        tmdbId: parseInt(tmdbId),
        year: movieDetails.year,
        qualityProfileId: parseInt(qualityProfileId),
        rootFolderPath: rootFolderPath,
        monitored: monitored,
        addOptions: {
            searchForMovie: searchOnAdd
        }
    };

    console.log('[RADARR] Adding movie with payload:', JSON.stringify(addPayload, null, 2));

    const addUrl = `${baseUrl}/api/v3/movie?apikey=${apiKey}`;
    const addResponse = await fetch(addUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(addPayload)
    });

    if (!addResponse.ok) {
        const errorText = await addResponse.text();
        throw new Error(`Failed to add movie: ${addResponse.status} ${addResponse.statusText} - ${errorText}`);
    }

    const radarrResponse = await addResponse.json();
    
    // Debug: Log the full response structure
    console.log('[RADARR] Full response from Radarr:', JSON.stringify(radarrResponse, null, 2));
    
    let addedMovie;
    let movieTitle;
    
    // Handle Radarr's response - it often returns an array of all movies instead of just the added one
    if (Array.isArray(radarrResponse)) {
        console.log('[RADARR] Radarr returned array of movies, searching for TMDB ID:', tmdbId);
        // Find the movie we just added by TMDB ID
        addedMovie = radarrResponse.find(movie => movie.tmdbId === parseInt(tmdbId));
        
        if (!addedMovie) {
            throw new Error(`Movie with TMDB ID ${tmdbId} was not found in Radarr library after addition attempt`);
        }
        
        movieTitle = addedMovie.title || addedMovie.originalTitle || 'Unknown Movie';
        console.log('[RADARR] Found added movie in response array:', movieTitle);
    } else {
        // Single movie object (ideal case)
        addedMovie = radarrResponse;
        movieTitle = addedMovie.title || addedMovie.originalTitle || 'Unknown Movie';
        console.log('[RADARR] Radarr returned single movie object:', movieTitle);
    }
    
    return {
        success: true,
        movie: addedMovie,
        message: `Successfully added "${movieTitle}" to Radarr${searchOnAdd ? ' and triggered search' : ''}`
    };
}

/**
 * Handle Sonarr API requests
 */
async function handleSonarrRequest(action, data) {
    const baseUrl = process.env.SONARR_URL;
    const apiKey = process.env.SONARR_API_KEY;
    
    if (!baseUrl || !apiKey) {
        throw new Error('Sonarr configuration missing');
    }

    switch (action) {
        case 'add_series':
            return await addSeriesToSonarr(baseUrl, apiKey, data);
        case 'get_series':
            return await getSonarrSeries(baseUrl, apiKey);
        case 'get_quality_profiles':
            return await getSonarrQualityProfiles(baseUrl, apiKey);
        case 'get_root_folders':
            return await getSonarrRootFolders(baseUrl, apiKey);
        default:
            throw new Error(`Unknown Sonarr action: ${action}`);
    }
}

/**
 * Add series to Sonarr using proper workflow
 */
async function addSeriesToSonarr(baseUrl, apiKey, data) {
    const { tvdbId, qualityProfileId, rootFolderPath, monitored = true, searchOnAdd = true } = data;
    
    if (!tvdbId || !qualityProfileId || !rootFolderPath) {
        throw new Error('Missing required fields: tvdbId, qualityProfileId, rootFolderPath');
    }

    // Step 1: Lookup series details from TVDB
    console.log(`[SONARR] Looking up series TVDB:${tvdbId}`);
    const lookupUrl = `${baseUrl}/api/v3/series/lookup?apikey=${apiKey}&term=tvdb:${tvdbId}`;
    
    const lookupResponse = await fetch(lookupUrl);
    if (!lookupResponse.ok) {
        throw new Error(`Series lookup failed: ${lookupResponse.status} ${lookupResponse.statusText}`);
    }
    
    const lookupResults = await lookupResponse.json();
    if (!lookupResults || lookupResults.length === 0) {
        throw new Error(`Series not found in TVDB: ${tvdbId}`);
    }

    const seriesDetails = lookupResults[0]; // Take first match
    console.log(`[SONARR] Found series: ${seriesDetails.title} (${seriesDetails.year})`);

    // Step 2: Add series to Sonarr
    const addPayload = {
        title: seriesDetails.title,
        titleSlug: seriesDetails.titleSlug,
        images: seriesDetails.images || [],
        tvdbId: parseInt(tvdbId),
        year: seriesDetails.year,
        qualityProfileId: parseInt(qualityProfileId),
        rootFolderPath: rootFolderPath,
        monitored: monitored,
        seasonFolder: true,
        addOptions: {
            searchForMissingEpisodes: searchOnAdd
        }
    };

    console.log('[SONARR] Adding series with payload:', JSON.stringify(addPayload, null, 2));

    const addUrl = `${baseUrl}/api/v3/series?apikey=${apiKey}`;
    const addResponse = await fetch(addUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(addPayload)
    });

    if (!addResponse.ok) {
        const errorText = await addResponse.text();
        throw new Error(`Failed to add series: ${addResponse.status} ${addResponse.statusText} - ${errorText}`);
    }

    const sonarrResponse = await addResponse.json();
    
    // Debug: Log the full response structure
    console.log('[SONARR] Full response from Sonarr:', JSON.stringify(sonarrResponse, null, 2));
    
    let addedSeries;
    let seriesTitle;
    
    // Handle Sonarr's response - it might return an array of all series instead of just the added one
    if (Array.isArray(sonarrResponse)) {
        console.log('[SONARR] Sonarr returned array of series, searching for TVDB ID:', tvdbId);
        // Find the series we just added by TVDB ID
        addedSeries = sonarrResponse.find(series => series.tvdbId === parseInt(tvdbId));
        
        if (!addedSeries) {
            throw new Error(`Series with TVDB ID ${tvdbId} was not found in Sonarr library after addition attempt`);
        }
        
        seriesTitle = addedSeries.title || addedSeries.sortTitle || 'Unknown Series';
        console.log('[SONARR] Found added series in response array:', seriesTitle);
    } else {
        // Single series object (ideal case)
        addedSeries = sonarrResponse;
        seriesTitle = addedSeries.title || addedSeries.sortTitle || 'Unknown Series';
        console.log('[SONARR] Sonarr returned single series object:', seriesTitle);
    }
    
    return {
        success: true,
        series: addedSeries,
        message: `Successfully added "${seriesTitle}" to Sonarr${searchOnAdd ? ' and triggered search' : ''}`
    };
}

/**
 * Handle Overseerr API requests
 */
async function handleOverseerrRequest(action, data) {
    const baseUrl = process.env.OVERSEERR_URL;
    const apiKey = process.env.OVERSEERR_API_KEY;
    
    if (!baseUrl || !apiKey) {
        throw new Error('Overseerr configuration missing');
    }

    switch (action) {
        case 'request_movie':
            return await requestOverseerrMovie(baseUrl, apiKey, data);
        case 'request_series':
            return await requestOverseerrSeries(baseUrl, apiKey, data);
        default:
            throw new Error(`Unknown Overseerr action: ${action}`);
    }
}

/**
 * Simple fetch wrapper for API calls
 */
async function getRadarrMovies(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v3/movie?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get movies: ${response.statusText}`);
    return await response.json();
}

async function getRadarrQualityProfiles(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v3/qualityprofile?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get quality profiles: ${response.statusText}`);
    return await response.json();
}

async function getRadarrRootFolders(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v3/rootfolder?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get root folders: ${response.statusText}`);
    return await response.json();
}

async function getSonarrSeries(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v3/series?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get series: ${response.statusText}`);
    return await response.json();
}

async function getSonarrQualityProfiles(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v3/qualityprofile?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get quality profiles: ${response.statusText}`);
    return await response.json();
}

async function getSonarrRootFolders(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v3/rootfolder?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get root folders: ${response.statusText}`);
    return await response.json();
}

async function requestOverseerrMovie(baseUrl, apiKey, data) {
    const { tmdbId } = data;
    const response = await fetch(`${baseUrl}/api/v1/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({
            mediaType: 'movie',
            mediaId: parseInt(tmdbId)
        })
    });
    
    if (!response.ok) throw new Error(`Failed to request movie: ${response.statusText}`);
    return await response.json();
}

async function requestOverseerrSeries(baseUrl, apiKey, data) {
    const { tvdbId } = data;
    const response = await fetch(`${baseUrl}/api/v1/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({
            mediaType: 'tv',
            mediaId: parseInt(tvdbId)
        })
    });
    
    if (!response.ok) throw new Error(`Failed to request series: ${response.statusText}`);
    return await response.json();
}
