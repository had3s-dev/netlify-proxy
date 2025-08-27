const dotenv = require('dotenv');
dotenv.config();

/**
 * Netlify Function Proxy for Radarr/Sonarr APIs
 * Simplified, clean implementation following official API patterns
 */

exports.handler = async (event, context) => {
    // Add comprehensive logging
    console.log('[PROXY] Function invoked with method:', event.httpMethod);
    console.log('[PROXY] Event body:', event.body);
    
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
        // Parse request body with error handling
        let parsedBody;
        try {
            parsedBody = JSON.parse(event.body);
        } catch (parseError) {
            console.error('[PROXY] JSON parse error:', parseError);
            throw new Error(`Invalid JSON in request body: ${parseError.message}`);
        }
        
        const { service, action, data } = parsedBody;
        
        console.log(`[PROXY] ${service}/${action} request:`, data);

        let result;
        switch (service) {
            case 'radarr':
                result = await handleRadarrRequest(action, data);
                break;
            case 'sonarr':
                result = await handleSonarrRequest(action, data);
                break;
            case 'readarr':
                result = await handleReadarrRequest(action, data);
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
    
    console.log('[PROXY] Radarr environment check - URL exists:', !!baseUrl, 'API Key exists:', !!apiKey);
    
    if (!baseUrl || !apiKey) {
        console.error('[PROXY] Missing Radarr config - URL:', baseUrl, 'API Key:', apiKey ? '[REDACTED]' : 'MISSING');
        throw new Error('Radarr configuration missing: ' + (!baseUrl ? 'RADARR_URL' : '') + (!apiKey ? ' RADARR_API_KEY' : ''));
    }

    switch (action) {
        case 'add_movie':
            console.log('[PROXY] Calling addMovieToRadarr with data:', data);
            try {
                const result = await addMovieToRadarr(baseUrl, apiKey, data);
                console.log('[PROXY] addMovieToRadarr completed successfully');
                return result;
            } catch (error) {
                console.error('[PROXY] addMovieToRadarr failed:', error);
                throw error;
            }
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
    console.log('[RADARR] addMovieToRadarr function called with:', data);
    
    const { tmdbId, qualityProfileId, rootFolderPath, monitored = true, searchOnAdd = true } = data;
    
    console.log('[RADARR] Extracted parameters - TMDB:', tmdbId, 'Quality:', qualityProfileId, 'Root:', rootFolderPath);
    
    if (!tmdbId || !qualityProfileId || !rootFolderPath) {
        const error = `Missing required fields - tmdbId: ${tmdbId}, qualityProfileId: ${qualityProfileId}, rootFolderPath: ${rootFolderPath}`;
        console.error('[RADARR]', error);
        throw new Error(error);
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

    // Step 2: Prepare series payload with proper monitoring settings
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
        // Use provided seasons array if available, otherwise default to all seasons
        seasons: data.seasons && data.seasons.length > 0 
            ? seriesDetails.seasons.map(season => ({
                seasonNumber: season.seasonNumber,
                // Only monitor if it's in the selected seasons array
                monitored: data.seasons.some(s => 
                    parseInt(s.seasonNumber) === season.seasonNumber && 
                    s.monitored !== false
                )
            }))
            : seriesDetails.seasons?.map(season => ({
                seasonNumber: season.seasonNumber,
                monitored: season.seasonNumber > 0 // Default to monitoring all non-special seasons
            })) || [],
        addOptions: {
            searchForMissingEpisodes: searchOnAdd,
            searchForCutoffUnmetEpisodes: searchOnAdd,
            monitor: 'all',
            ignoreEpisodesWithFiles: false,
            ignoreEpisodesWithoutFiles: false
        },
        seriesType: seriesDetails.seriesType || 'standard',
        seasonCount: seriesDetails.seasonCount || 1,
        monitored: true,
        useSceneNumbering: false
    };
    
    console.log('[SONARR] Seasons monitoring configuration:', 
        addPayload.seasons.map(s => `S${s.seasonNumber}: ${s.monitored ? 'monitored' : 'not monitored'}`).join(', ')
    );

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
    
    // If searchOnAdd is true, trigger a search for the series
    if (searchOnAdd && addedSeries.id) {
        console.log(`[SONARR] Triggering search for series ID: ${addedSeries.id}`);
        const searchUrl = `${baseUrl}/api/v3/command?apikey=${apiKey}`;
        const searchPayload = {
            name: 'SeriesSearch',
            seriesId: addedSeries.id
        };
        
        try {
            const searchResponse = await fetch(searchUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(searchPayload)
            });

            if (!searchResponse.ok) {
                console.error('[SONARR] Failed to trigger search:', await searchResponse.text());
                throw new Error('Series was added, but search could not be triggered');
            }
            
            console.log('[SONARR] Search triggered successfully');
        } catch (searchError) {
            console.error('[SONARR] Error triggering search:', searchError);
            throw new Error(`Series was added, but search could not be triggered: ${searchError.message}`);
        }
    }
    
    return {
        success: true,
        series: addedSeries,
        message: `Successfully added "${seriesTitle}" to Sonarr${searchOnAdd ? ' and triggered search' : ''}`
    };
}

/**
 * Handle Readarr API requests
 */
async function handleReadarrRequest(action, data) {
    const baseUrl = process.env.READARR_URL;
    const apiKey = process.env.READARR_API_KEY;

    console.log('[PROXY] Readarr environment check - URL exists:', !!baseUrl, 'API Key exists:', !!apiKey);

    if (!baseUrl || !apiKey) {
        console.error('[PROXY] Missing Readarr config - URL:', baseUrl, 'API Key:', apiKey ? '[REDACTED]' : 'MISSING');
        throw new Error('Readarr configuration missing: ' + (!baseUrl ? 'READARR_URL' : '') + (!apiKey ? ' READARR_API_KEY' : ''));
    }

    switch (action) {
        case 'add_book':
            return await addBookToReadarr(baseUrl, apiKey, data);
        case 'add_author':
            return await addAuthorToReadarr(baseUrl, apiKey, data);
        case 'lookup_book':
            return await lookupReadarrBook(baseUrl, apiKey, data);
        case 'lookup_book_bookinfo':
            return await lookupBookInfoProBook(data.term || data.search);
        case 'lookup_author_bookinfo':
            return await lookupBookInfoProAuthor(data.term || data.search);
        case 'lookup_author':
            return await lookupReadarrAuthor(baseUrl, apiKey, data);
        case 'lookup_edition':
            return await lookupReadarrEdition(baseUrl, apiKey, data);
        case 'get_books':
            return await getReadarrBooks(baseUrl, apiKey);
        case 'get_authors':
            return await getReadarrAuthors(baseUrl, apiKey);
        case 'get_quality_profiles':
            return await getReadarrQualityProfiles(baseUrl, apiKey);
        case 'get_metadata_profiles':
            return await getReadarrMetadataProfiles(baseUrl, apiKey);
        case 'get_root_folders':
            return await getReadarrRootFolders(baseUrl, apiKey);
        default:
            throw new Error(`Unknown Readarr action: ${action}`);
    }
}

/**
 * Add book to Readarr using lookup workflow
 */
async function addBookToReadarr(baseUrl, apiKey, data) {
    const {
        term,
        book: incomingBook,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath: inputRoot,
        monitored = true,
        searchForNewBook = true,
        authorMonitor = 'all',
        authorSearchForMissingBooks = false,
        // Optional: allow caller to provide a specific edition foreign ID directly
        foreignEditionId: incomingForeignEditionId
    } = data || {};

    console.log('[READARR] addBookToReadarr called with:', data);

    // Step 1: Lookup author
    // If no explicit term provided, try to extract from book data
    let searchTerm = term;
    if (!searchTerm && incomingBook) {
        // Try to get term from book data
        searchTerm = incomingBook.authorTitle || 
                    (incomingBook.author && (incomingBook.author.name || incomingBook.author.authorName)) ||
                    incomingBook.title;
    }
    
    console.log(`[READARR] Looking up author: ${searchTerm}`);
    let lookup = await lookupReadarrAuthor(baseUrl, apiKey, { term: searchTerm });
    console.log(`[READARR] Readarr author lookup returned ${lookup?.length || 0} results`);
    
    // Fallback to BookInfo.pro if Readarr lookup fails
    if (!lookup || lookup.length === 0) {
        console.log(`[READARR] Falling back to BookInfo.pro author lookup: ${searchTerm}`);
        try {
            lookup = await lookupBookInfoProAuthor(searchTerm);
            console.log(`[READARR] BookInfo.pro author lookup returned ${lookup?.length || 0} results`);
        } catch (error) {
            console.log(`[READARR] BookInfo.pro author lookup failed: ${error.message}`);
        }
    }
    
    if (!lookup || lookup.length === 0) {
        throw new Error(`Author lookup failed for term: ${searchTerm}`);
    }
    
    const authorData = lookup[0];

    // Use incomingBook as the book data
    const book = incomingBook;
    console.log('[READARR] Using book result:', book?.title || '[no title]', 'by', book?.author?.name || '[unknown author]');

    // Comprehensive author resolution with 5-layer fallback system
    if (!book.author || !book.author.authorName) {
        console.log('[READARR] Author missing from book data, implementing comprehensive resolution...');
        
        // Layer 1: Extract author candidates from multiple sources
        const authorCandidates = extractAuthorNameCandidates(book, searchTerm);
        console.log('[READARR] Author candidates extracted:', authorCandidates);
        
        let resolvedAuthor = null;
        let usedStrategy = null;
        
        // Layer 2: Readarr author lookup with multiple name variations
        if (authorCandidates.length > 0) {
            for (const cand of authorCandidates) {
                try {
                    console.log('[READARR] Strategy 1: Readarr author lookup for:', cand);
                    const authorResults = await lookupReadarrAuthor(baseUrl, apiKey, { term: cand });
                    
                    if (authorResults && authorResults.length > 0) {
                        const best = pickBestAuthorMatch(authorResults, cand);
                        if (best && (best.authorName || best.name)) {
                            resolvedAuthor = best;
                            usedStrategy = 'Readarr author lookup';
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('[READARR] Readarr author lookup failed for:', cand, e?.message || e);
                }
            }
        }
        
        // Layer 3: BookInfo.pro author lookup fallback
        if (!resolvedAuthor && authorCandidates.length > 0) {
            console.log('[READARR] Strategy 2: BookInfo.pro author lookup');
            try {
                for (const cand of authorCandidates) {
                    const bookInfoAuthors = await lookupBookInfoProAuthor(cand);
                    if (bookInfoAuthors && bookInfoAuthors.length > 0) {
                        resolvedAuthor = bookInfoAuthors[0];
                        usedStrategy = 'BookInfo.pro';
                        break;
                    }
                }
            } catch (e) {
                console.warn('[READARR] BookInfo.pro author lookup failed:', e?.message || e);
            }
        }
        
        // Layer 4: Direct Goodreads author search using book's foreignBookId
        if (!resolvedAuthor && book.foreignBookId) {
            console.log('[READARR] Strategy 3: Direct Goodreads author search');
            try {
                // Try to get author from book metadata using the book ID
                const bookDetails = await lookupReadarrBook(baseUrl, apiKey, { 
                    term: `goodreads:${book.foreignBookId}` 
                });
                
                if (bookDetails && bookDetails.length > 0 && bookDetails[0].author) {
                    resolvedAuthor = bookDetails[0].author;
                    usedStrategy = 'Book metadata lookup';
                }
            } catch (e) {
                console.warn('[READARR] Direct book metadata lookup failed:', e?.message || e);
            }
        }
        
        // Layer 5: Enhanced name parsing from book title patterns
        if (!resolvedAuthor) {
            console.log('[READARR] Strategy 4: Enhanced name parsing from book data');
            
            // Try to extract author from book title patterns
            const title = book.title || '';
            const authorTitle = book.authorTitle || '';
            
            // Common patterns: "Title by Author", "Author - Title", etc.
            let extractedAuthor = null;
            
            // Pattern: "by Author Name" in title
            const byPattern = title.match(/\bby\s+([^(-]+)(?:\s*[-(]|$)/i);
            if (byPattern && byPattern[1]) {
                extractedAuthor = byPattern[1].trim();
            }
            
            // Pattern: Author in authorTitle field
            if (!extractedAuthor && authorTitle) {
                // Clean up authorTitle which might contain book title
                extractedAuthor = cleanupAuthorName(authorTitle, title);
            }
            
            // Pattern: Parse from series title if available
            if (!extractedAuthor && book.seriesTitle) {
                const seriesMatch = book.seriesTitle.match(/^(.+?)\s*\#/);
                if (seriesMatch && seriesMatch[1]) {
                    extractedAuthor = cleanupAuthorName(seriesMatch[1], title);
                }
            }
            
            if (extractedAuthor && extractedAuthor.length >= 2) {
                resolvedAuthor = {
                    authorName: extractedAuthor,
                    foreignAuthorId: extractedAuthor.toLowerCase().replace(/\s+/g, '-'),
                    overview: `Author of ${title}`,
                    images: [],
                    genres: book.genres || [],
                    ratings: { value: 0, votes: 0 }
                };
                usedStrategy = 'Enhanced name parsing';
            }
        }
        
        // Final fallback: Use a generic author if we have book data
        if (!resolvedAuthor && (book.title || book.foreignBookId)) {
            console.log('[READARR] Strategy 5: Generic fallback author');
            const fallbackName = book.authorTitle || 'Unknown Author';
            resolvedAuthor = {
                authorName: fallbackName,
                foreignAuthorId: fallbackName.toLowerCase().replace(/\s+/g, '-') || 'unknown',
                overview: `Author information for ${book.title || 'book'}`,
                images: [],
                genres: book.genres || [],
                ratings: { value: 0, votes: 0 }
            };
            usedStrategy = 'Generic fallback';
        }
        
        if (resolvedAuthor) {
            book.author = resolvedAuthor;
            console.log(`[READARR] Author resolved via ${usedStrategy}:`, resolvedAuthor.authorName);
        } else {
            throw new Error('Unable to resolve author for book addition. All resolution strategies failed.');
        }
    } else {
        console.log(`[READARR] Using provided author: ${book.author.name || book.author}`);
    }

    // Ensure default profiles when not provided
    let qpId = qualityProfileId;
    let mpId = metadataProfileId;
    if (!qpId || !mpId) {
        const { qualityProfileId: defQpId, metadataProfileId: defMpId } = await getReadarrDefaultProfileIds(baseUrl, apiKey);
        qpId = qpId || defQpId;
        mpId = mpId || defMpId;
    }

    // Construct payload per Readarr expectations
    if (!book.author) {
        throw new Error('Lookup did not return author information required by Readarr');
    }

    // Determine root folder path
    let rootFolderPath = inputRoot;
    if (!rootFolderPath) {
        try {
            const roots = await getReadarrRootFolders(baseUrl, apiKey);
            rootFolderPath = (Array.isArray(roots) && roots.length > 0) ? (roots[0].path || roots[0].Path || roots[0].name) : undefined;
        } catch (e) {
            console.warn('[READARR] Failed to fetch root folders for defaulting:', e?.message || e);
        }
    }
    if (!rootFolderPath) {
        throw new Error('No root folder path provided and no defaults available from Readarr');
    }

    // Build minimal add payload rather than posting the full lookup object
    let foreignAuthorId =
        book.author?.foreignAuthorId ||
        book.author?.foreignId ||
        book.author?.foreign_id || // defensive
        null;
    // If missing, attempt to resolve via author lookup by name/title
    if (!foreignAuthorId) {
        const candidateNames = [];
        if (book.author?.authorName) candidateNames.push(book.author.authorName);
        if (book.author?.name) candidateNames.push(book.author.name);
        if (book.authorTitle) candidateNames.push(book.authorTitle);
        for (const cand of candidateNames) {
            try {
                const url = `${baseUrl}/api/v1/author/lookup?apikey=${apiKey}&term=${encodeURIComponent(cand)}`;
                console.log('[READARR] Resolving foreignAuthorId via author lookup:', cand);
                const r = await fetch(url);
                if (!r.ok) continue;
                const arr = await r.json();
                const best = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
                if (best?.foreignAuthorId) {
                    foreignAuthorId = best.foreignAuthorId;
                    console.log('[READARR] Found foreignAuthorId from lookup for', cand, '->', foreignAuthorId);
                    break;
                }
            } catch (e) {
                console.warn('[READARR] Author lookup for foreignAuthorId failed:', e?.message || e);
            }
        }
    }
    if (!foreignAuthorId) {
        throw new Error('Readarr add requires author.foreignAuthorId; author lookup did not provide it');
    }

    // Normalize author name for logging / compatibility
    if (book.author && !book.author.name && book.author.authorName) {
        book.author.name = book.author.authorName;
    }

    // Ensure editions array is present; if missing, try to resolve via edition lookup
    // This avoids Readarr server error: "Value cannot be null. (Parameter 'source')" when mapping editions
    if (!Array.isArray(book.editions) || book.editions.length === 0) {
        console.warn('[READARR] Book has no editions; attempting edition lookup');
        const editionTerms = [];
        
        // Build comprehensive search terms
        if (book.foreignEditionId) editionTerms.push(`goodreads:${book.foreignEditionId}`);
        if (book.foreignBookId) editionTerms.push(`goodreads:${book.foreignBookId}`);
        if (book.isbn13) editionTerms.push(`isbn:${book.isbn13}`);
        if (book.isbn10 || book.isbn) editionTerms.push(`isbn:${book.isbn10 || book.isbn}`);
        if (book.asin) editionTerms.push(`asin:${book.asin}`);
        
        // Author + title combinations
        const aName = book.author?.authorName || book.author?.name;
        if (book.title && aName) {
            editionTerms.push(`${book.title} ${aName}`);
            editionTerms.push(`${aName} ${book.title}`);
        }
        
        // Fallback to basic title
        if (book.title) editionTerms.push(book.title);
        
        // Use original search term as last resort
        if (term && !editionTerms.includes(term)) editionTerms.push(term);
        
        let foundEdition = null;
        
        for (const et of editionTerms) {
            try {
                const url = `${baseUrl}/api/v1/edition/lookup?apikey=${apiKey}&term=${encodeURIComponent(et)}`;
                console.log('[READARR] Edition lookup with term:', et);
                const r = await fetch(url);
                if (!r.ok) continue;
                const arr = await r.json();
                if (Array.isArray(arr) && arr.length > 0) {
                    // Find the best match - prioritize exact title matches
                    const bestEdition = arr.find(e => 
                        e.title && book.title && e.title.toLowerCase() === book.title.toLowerCase()
                    ) || arr[0];
                    
                    book.editions = [bestEdition];
                    if (book.editions[0]) book.editions[0].monitored = true;
                    foundEdition = bestEdition;
                    console.log('[READARR] Edition resolved via term:', et, '->', bestEdition?.title || bestEdition?.foreignEditionId || '[unknown]');
                    break;
                }
            } catch (e) {
                console.warn('[READARR] Edition lookup error for term', et, ':', e?.message || e);
            }
        }
        
        // If still no editions found, create a synthetic edition from book data
        if (!foundEdition && book.title) {
            console.warn('[READARR] Creating synthetic edition from book data');
            book.editions = [{
                title: book.title || '',
                titleSlug: book.titleSlug || '',
                images: Array.isArray(book.images) ? book.images : [],
                foreignEditionId: book.foreignEditionId || book.foreignBookId || `synthetic-${Date.now()}`,
                monitored: true,
                manualAdd: true
            }];
        }
    }
    if (!Array.isArray(book.editions)) {
        book.editions = [];
    }

    // If editions exist but none have a foreignEditionId/foreignId, try an extra edition lookup pass
    let hasForeignEditionIdentifier = (book.editions || []).some(e => e && (e.foreignEditionId || e.foreignId || e.foreign_id || e.goodreadsId || e.editionId));
    
    if (!hasForeignEditionIdentifier) {
        console.warn('[READARR] No foreignEditionId found in existing editions, attempting enhanced lookup');
        const extraTerms = [];
        
        // Use all available identifiers
        if (book.foreignBookId) extraTerms.push(`goodreads:${book.foreignBookId}`);
        if (book.foreignEditionId) extraTerms.push(`goodreads:${book.foreignEditionId}`);
        if (book.isbn13) extraTerms.push(`isbn:${book.isbn13}`);
        if (book.isbn10 || book.isbn) extraTerms.push(`isbn:${book.isbn10 || book.isbn}`);
        if (book.asin) extraTerms.push(`asin:${book.asin}`);
        
        const aName2 = book.author?.authorName || book.author?.name;
        if (book.title && aName2) {
            extraTerms.push(`${book.title} ${aName2}`);
            extraTerms.push(`${aName2} ${book.title}`);
        }
        if (book.title) extraTerms.push(book.title);
        if (term) extraTerms.push(term);
        
        let foundEdition = false;
        
        for (const et2 of extraTerms) {
            try {
                const url2 = `${baseUrl}/api/v1/edition/lookup?apikey=${apiKey}&term=${encodeURIComponent(et2)}`;
                console.log('[READARR] Enhanced edition lookup. Term:', et2);
                const r2 = await fetch(url2);
                if (!r2.ok) continue;
                const arr2 = await r2.json();
                if (Array.isArray(arr2) && arr2.length > 0) {
                    // Find edition with proper foreign ID
                    const validEdition = arr2.find(e => 
                        e.foreignEditionId || e.foreignId || e.goodreadsId || e.editionId
                    ) || arr2[0];
                    
                    book.editions = [validEdition];
                    if (book.editions[0]) book.editions[0].monitored = true;
                    hasForeignEditionIdentifier = !!(validEdition.foreignEditionId || validEdition.foreignId || validEdition.goodreadsId);
                    foundEdition = true;
                    console.log('[READARR] Enhanced edition lookup resolved:', validEdition?.title || validEdition?.foreignEditionId || '[unknown]');
                    break;
                }
            } catch (e) {
                console.warn('[READARR] Enhanced edition lookup error:', e?.message || e);
            }
        }
        
        // If still no valid edition, use book data to create minimal edition
        if (!foundEdition) {
            console.warn('[READARR] Using fallback edition creation from book data');
            const fallbackId = book.foreignEditionId || book.foreignBookId || book.isbn13 || book.isbn10 || `fallback-${Date.now()}`;
            book.editions = [{
                title: book.title || '',
                titleSlug: book.titleSlug || '',
                images: Array.isArray(book.images) ? book.images : [],
                foreignEditionId: String(fallbackId),
                monitored: true,
                manualAdd: true
            }];
            hasForeignEditionIdentifier = true;
        }
    }

    // Debug: summarize first few edition objects to inspect keys/ids
    try {
        const summary = (book.editions || []).slice(0, 3).map(e => ({
            title: e?.title,
            id: e?.id,
            foreignEditionId: e?.foreignEditionId,
            foreignId: e?.foreignId,
            isbn13: e?.isbn13,
            asin: e?.asin
        }));
        console.log('[READARR] Edition candidates summary:', summary);
    } catch {}

    // Transform editions to AddBookEdition model
    let editionsPayload = [];
    
    // If specific foreignEditionId provided, use it
    if (incomingForeignEditionId) {
        editionsPayload = [{
            title: book.title || '',
            titleSlug: book.titleSlug || '',
            images: Array.isArray(book.images) ? book.images : [],
            foreignEditionId: String(incomingForeignEditionId),
            monitored: true,
            manualAdd: true
        }];
    } else {
        // Build editions from available data
        editionsPayload = (book.editions || [])
            .map(e => ({
                title: e.title || book.title || '',
                titleSlug: e.titleSlug || book.titleSlug || '',
                images: Array.isArray(e.images) ? e.images : Array.isArray(book.images) ? book.images : [],
                foreignEditionId: e.foreignEditionId || e.goodreadsEditionId || e.goodreadsId || e.foreignId || e.foreign_id || e.editionId || e.id || '',
                monitored: true,
                manualAdd: true
            }))
            .filter(e => !!e.foreignEditionId && e.foreignEditionId !== '');
    }
    
    // Enhanced fallback strategies
    if (editionsPayload.length === 0) {
        // Try using book identifiers directly
        const possibleIds = [
            book.foreignEditionId,
            book.foreignBookId,
            book.foreignId,
            book.isbn13,
            book.isbn10,
            book.isbn,
            book.goodreadsId,
            book.editionId
        ].filter(id => id && String(id).trim() !== '');
        
        if (possibleIds.length > 0) {
            console.warn('[READARR] Using book identifiers as edition fallback');
            editionsPayload = [{
                title: book.title || '',
                titleSlug: book.titleSlug || '',
                images: Array.isArray(book.images) ? book.images : [],
                foreignEditionId: String(possibleIds[0]),
                monitored: true,
                manualAdd: true
            }];
        }
    }
    
    if (editionsPayload.length === 0) {
        // Final fallback - create synthetic edition ID
        const syntheticId = book.foreignBookId || book.foreignEditionId || 
                          book.isbn13 || book.isbn10 || 
                          `syn-${book.title?.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`;
        
        console.warn('[READARR] Creating synthetic edition ID:', syntheticId);
        editionsPayload = [{
            title: book.title || '',
            titleSlug: book.titleSlug || '',
            images: Array.isArray(book.images) ? book.images : [],
            foreignEditionId: String(syntheticId),
            monitored: true,
            manualAdd: true
        }];
    }
    
    // Ensure we have at least one edition
    if (editionsPayload.length === 0) {
        const diag = {
            term: term || null,
            foreignBookId: book?.foreignBookId || null,
            foreignEditionId: book?.foreignEditionId || null,
            isbn13: book?.isbn13 || null,
            isbn10: book?.isbn10 || book?.isbn || null,
            title: book?.title || null,
            author: book?.author?.name || null
        };
        throw new Error('Unable to create valid edition for Readarr add. Diagnostics: ' + JSON.stringify(diag));
    }

    const addPayload = {
        monitored: !!monitored,
        addOptions: { 
            searchForNewBook: !!searchForNewBook // Only search for this specific book
        },
        author: {
            monitored: false, // Don't monitor author for automatic searches
            qualityProfileId: parseInt(qpId),
            metadataProfileId: parseInt(mpId),
            foreignAuthorId: String(foreignAuthorId),
            rootFolderPath
        },
        editions: editionsPayload
    };
    if (book.foreignBookId) {
        addPayload.foreignBookId = String(book.foreignBookId);
    }

    console.log('[READARR] Adding book with payload (trimmed):', JSON.stringify({
        title: book.title,
        foreignBookId: addPayload.foreignBookId,
        author: {
            foreignAuthorId: addPayload.author.foreignAuthorId,
            qualityProfileId: addPayload.author.qualityProfileId,
            metadataProfileId: addPayload.author.metadataProfileId,
            rootFolderPath: addPayload.author.rootFolderPath
        },
        editionsCount: addPayload.editions.length,
        monitored: addPayload.monitored,
        addOptions: addPayload.addOptions
    }, null, 2));

    const addUrl = `${baseUrl}/api/v1/book?apikey=${apiKey}`;
    const addResponse = await fetch(addUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addPayload)
    });

    if (!addResponse.ok) {
        const errorText = await addResponse.text();
        throw new Error(`Failed to add book: ${addResponse.status} ${addResponse.statusText} - ${errorText}`);
    }

    const addResult = await addResponse.json();
    console.log('[READARR] Add book response:', JSON.stringify(addResult, null, 2));

    return {
        success: true,
        book: addResult,
        message: `Successfully added book "${book.title}" to Readarr${searchForNewBook ? ' and triggered search' : ''}`
    };
}

/**
 * Add author to Readarr
 */
async function addAuthorToReadarr(baseUrl, apiKey, data) {
    const {
        term,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath,
        monitored = true,
        authorMonitor = 'none',
        authorSearchForMissingBooks = false
    } = data || {};

    console.log('[READARR] addAuthorToReadarr called with:', data);

    if (!term) {
        throw new Error('Missing required field: term (author search term)');
    }
    if (!rootFolderPath) {
        throw new Error('Missing required field: rootFolderPath');
    }

    const lookupUrl = `${baseUrl}/api/v1/author/lookup?apikey=${apiKey}&term=${encodeURIComponent(term)}`;
    console.log('[READARR] Looking up author with term:', term);
    const lookupResponse = await fetch(lookupUrl);
    if (!lookupResponse.ok) {
        throw new Error(`Author lookup failed: ${lookupResponse.status} ${lookupResponse.statusText}`);
    }
    const lookupResults = await lookupResponse.json();
    if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
        throw new Error(`No author results for term: ${term}`);
    }

    const author = lookupResults[0];
    console.log('[READARR] Using author result:', author?.authorName || author?.name || '[no name]');

    // Ensure default profiles when not provided
    let qpId = qualityProfileId;
    let mpId = metadataProfileId;
    if (!qpId || !mpId) {
        const { qualityProfileId: defQpId, metadataProfileId: defMpId } = await getReadarrDefaultProfileIds(baseUrl, apiKey);
        qpId = qpId || defQpId;
        mpId = mpId || defMpId;
    }

    author.metadataProfileId = parseInt(mpId);
    author.qualityProfileId = parseInt(qpId);
    author.rootFolderPath = rootFolderPath;
    author.addOptions = {
        monitor: authorMonitor,
        searchForMissingBooks: !!authorSearchForMissingBooks
    };
    author.monitored = !!monitored;

    console.log('[READARR] Adding author with payload (trimmed):', JSON.stringify({
        name: author?.authorName || author?.name,
        qualityProfileId: author.qualityProfileId,
        metadataProfileId: author.metadataProfileId,
        rootFolderPath: author.rootFolderPath,
        addOptions: author.addOptions,
        monitored: author.monitored
    }, null, 2));

    const addUrl = `${baseUrl}/api/v1/author?apikey=${apiKey}`;
    const addResponse = await fetch(addUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(author)
    });

    if (!addResponse.ok) {
        const errorText = await addResponse.text();
        throw new Error(`Failed to add author: ${addResponse.status} ${addResponse.statusText} - ${errorText}`);
    }

    const addResult = await addResponse.json();
    console.log('[READARR] Add author response:', JSON.stringify(addResult, null, 2));

    return {
        success: true,
        author: addResult,
        message: `Successfully added author to Readarr`
    };
}

// ---- Readarr helpers ----
async function getReadarrDefaultProfileIds(baseUrl, apiKey) {
    const [qps, mps] = await Promise.all([
        getReadarrQualityProfiles(baseUrl, apiKey),
        getReadarrMetadataProfiles(baseUrl, apiKey)
    ]);
    if (!Array.isArray(qps) || qps.length === 0) {
        throw new Error('No Readarr quality profiles available');
    }
    if (!Array.isArray(mps) || mps.length === 0) {
        throw new Error('No Readarr metadata profiles available');
    }
    return { qualityProfileId: qps[0].id, metadataProfileId: mps[0].id };
}

async function getReadarrBooks(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v1/book?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get books: ${response.statusText}`);
    return await response.json();
}

async function getReadarrAuthors(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v1/author?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get authors: ${response.statusText}`);
    return await response.json();
}

async function lookupReadarrBook(baseUrl, apiKey, data) {
    const { term } = data || {};
    if (!term) throw new Error('lookup_book requires "term"');
    const response = await fetch(`${baseUrl}/api/v1/book/lookup?apikey=${apiKey}&term=${encodeURIComponent(term)}`);
    if (!response.ok) throw new Error(`Failed to lookup book: ${response.statusText}`);
    return await response.json();
}

async function lookupReadarrAuthor(baseUrl, apiKey, data) {
    const { term } = data || {};
    if (!term) throw new Error('lookup_author requires "term"');
    const response = await fetch(`${baseUrl}/api/v1/author/lookup?apikey=${apiKey}&term=${encodeURIComponent(term)}`);
    if (!response.ok) throw new Error(`Failed to lookup author: ${response.statusText}`);
    return await response.json();
}

async function lookupReadarrEdition(baseUrl, apiKey, data) {
    const { term } = data || {};
    if (!term) throw new Error('lookup_edition requires "term"');
    const response = await fetch(`${baseUrl}/api/v1/edition/lookup?apikey=${apiKey}&term=${encodeURIComponent(term)}`);
    if (!response.ok) throw new Error(`Failed to lookup edition: ${response.statusText}`);
    return await response.json();
}

// ---- BookInfo.pro API Integration ----
async function lookupBookInfoProBook(term) {
    try {
        const response = await fetch(`https://api.bookinfo.pro/book?search=${encodeURIComponent(term)}`);
        if (!response.ok) throw new Error(`BookInfo.pro API error: ${response.statusText}`);
        
        const data = await response.json();
        if (!data || !data.results || data.results.length === 0) {
            throw new Error('No results found in BookInfo.pro');
        }
        
        // Transform BookInfo.pro format to Readarr format
        return data.results.map(book => ({
            title: book.title,
            author: {
                name: book.author
            },
            foreignBookId: book.id,
            overview: book.description,
            releaseDate: book.published_date,
            isbn13: book.isbn13,
            isbn10: book.isbn10,
            genres: book.genres || [],
            pages: book.page_count,
            publisher: book.publisher,
            language: book.language,
            cover: book.cover_url,
            ratings: {
                value: book.rating || 0,
                votes: book.rating_count || 0
            }
        }));
    } catch (error) {
        console.error('[BookInfo.pro] Error:', error);
        throw error;
    }
}

async function lookupBookInfoProAuthor(term) {
    try {
        const response = await fetch(`https://api.bookinfo.pro/author?search=${encodeURIComponent(term)}`);
        if (!response.ok) throw new Error(`BookInfo.pro API error: ${response.statusText}`);
        
        const data = await response.json();
        if (!data || !data.results || data.results.length === 0) {
            throw new Error('No results found in BookInfo.pro');
        }
        
        // Transform BookInfo.pro format to Readarr format
        return data.results.map(author => ({
            authorName: author.name,
            foreignAuthorId: author.id,
            overview: author.biography,
            images: author.image_url ? [{ coverType: 'cover', url: author.image_url }] : [],
            genres: author.genres || [],
            ratings: {
                value: author.rating || 0,
                votes: author.rating_count || 0
            }
        }));
    } catch (error) {
        console.error('[BookInfo.pro] Error:', error);
        throw error;
    }
}

// ---- Helper functions for author resolution ----
function extractAuthorNameCandidates(book, term) {
    const names = new Set();
    const title = (book?.title || '').toString();
    // From authorTitle, which may contain title suffixes
    if (book?.authorTitle) {
        const raw = cleanupAuthorName(book.authorTitle, title);
        if (raw) names.add(raw);
        // Handle comma form: "last, first"
        if (/,/.test(book.authorTitle)) {
            const parts = book.authorTitle.split(',').map(s => s.trim());
            if (parts.length >= 2) {
                const flipped = cleanupAuthorName(`${parts[1]} ${parts[0]}`, title);
                if (flipped) names.add(flipped);
            }
        }
    }
    // From title patterns like "... by Author ..."
    if (title) {
        const m = title.match(/\bby\s+([^()]+?)(?:\s*\(|$)/i);
        if (m && m[1]) {
            const n = cleanupAuthorName(m[1], title);
            if (n) names.add(n);
        }
    }
    // From incoming term if it includes "by"
    if (typeof term === 'string' && /\bby\b/i.test(term)) {
        const m2 = term.match(/\bby\s+([^()]+?)(?:\s*\(|$)/i);
        if (m2 && m2[1]) {
            const n2 = cleanupAuthorName(m2[1], title);
            if (n2) names.add(n2);
        }
    }
    // Filter out obviously wrong tokens
    return Array.from(names).filter(n => n && n.length >= 3);
}

function cleanupAuthorName(name, bookTitle) {
    if (!name) return '';
    let s = String(name);
    if (bookTitle) {
        try {
            const re = new RegExp(bookTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            s = s.replace(re, ' ');
        } catch {}
    }
    s = s.replace(/\bby\b/gi, ' ')
         .replace(/#[0-9]+.*/g, ' ')
         .replace(/\([^)]*\)/g, ' ')
         .replace(/[“”"']/g, ' ')
         .replace(/\s{2,}/g, ' ')
         .trim();
    // If comma form remains, flip it
    if (/,/.test(s)) {
        const parts = s.split(',').map(x => x.trim()).filter(Boolean);
        if (parts.length >= 2) s = `${parts[1]} ${parts[0]}`.trim();
    }
    return s;
}

function pickBestAuthorMatch(results, candidate) {
    const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const cand = norm(candidate);
    let best = null;
    for (const r of results) {
        const nm = r?.authorName || r?.name || '';
        const n = norm(nm);
        if (!n) continue;
        if (n === cand) return r;
        if (!best && (n.includes(cand) || cand.includes(n))) best = r;
    }
    return best || (Array.isArray(results) ? results[0] : null);
}

async function getReadarrQualityProfiles(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v1/qualityprofile?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get quality profiles: ${response.statusText}`);
    return await response.json();
}

async function getReadarrMetadataProfiles(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v1/metadataprofile?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get metadata profiles: ${response.statusText}`);
    return await response.json();
}

async function getReadarrRootFolders(baseUrl, apiKey) {
    const response = await fetch(`${baseUrl}/api/v1/rootfolder?apikey=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to get root folders: ${response.statusText}`);
    return await response.json();
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
