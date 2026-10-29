const API_BASE_URL = 'http://localhost:8080/api';

// Reads a non-success HTTP response body defensively: JSON error
// shapes first, then stripped plain/HTML text, always bounded in
// length. Returns '' when no useful body exists.
async function readErrorDetail(response) {
    try {
        const text = (await response.text()).trim();

        if (!text) {
            return '';
        }

        const contentType =
            response.headers.get('content-type') || '';

        if (contentType.includes('json')) {
            try {
                const data = JSON.parse(text);
                const candidate =
                    data.message ||
                    data.error ||
                    (Array.isArray(data.errors) &&
                        data.errors[0]?.message);

                if (
                    typeof candidate === 'string' &&
                    candidate.trim()
                ) {
                    return candidate.trim().slice(0, 300);
                }
            } catch {
                // Fall through to the stripped raw body.
            }
        }

        return text
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
    } catch {
        // The body may already be gone; the status alone will do.
        return '';
    }
}

export async function analyzeManuscript(file, onProgress, signal) {
    const formData = new FormData();
    formData.append('file', file);

    let response;

    try {
        response = await fetch(
            `${API_BASE_URL}/manuscripts/analyze`,
            {
                method: 'POST',
                body: formData,
                signal,
            }
        );
    } catch (networkError) {
        if (networkError?.name === 'AbortError') {
            throw networkError;
        }

        const error = new Error(
            `Could not reach the analysis server at ${API_BASE_URL}. ` +
                'The backend may be down, the connection was ' +
                'interrupted, or the upload exceeded the server\u2019s ' +
                'size limit.'
        );
        error.cause = networkError;
        throw error;
    }

    if (!response.ok) {
        const detail = await readErrorDetail(response);
        const error = new Error(
            detail
                ? `${detail} (HTTP ${response.status})`
                : `Analysis request failed (${response.status})`
        );
        error.status = response.status;
        throw error;
    }

    if (!response.body) {
        throw new Error('Streaming response is not supported by this browser.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let result = null;
    let receivedProgress = false;
    let receivedComplete = false;

    const processEvent = (rawEvent) => {
        const lines = rawEvent.split('\n');

        let eventName = 'message';
        let data = '';

        for (const line of lines) {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                data += line.slice(5).trim();
            }
        }

        if (!data) {
            return;
        }

        if (eventName === 'progress') {
            receivedProgress = true;
            try {
                onProgress?.({
                    type: 'progress',
                    ...JSON.parse(data),
                });
            } catch {
                // Ignore malformed progress messages.
            }
            return;
        }

        if (eventName === 'result') {
            try {
                result = JSON.parse(data);
            } catch {
                throw new Error(
                    'The server returned a malformed analysis result.'
                );
            }

            onProgress?.({
                type: 'result',
                data: result,
            });

            return;
        }

        if (eventName === 'complete') {
            receivedComplete = true;
            onProgress?.({
                type: 'complete',
                message: data,
            });

            return;
        }

        // The SSE error event and the thrown error are the same
        // failure: report it exactly once, by throwing it to the
        // caller (never also via onProgress).
        if (eventName === 'error') {
            throw new Error(
                data || 'The analysis failed on the server.'
            );
        }
    };

    try {
        while (true) {
            let chunk;

            try {
                chunk = await reader.read();
            } catch (readError) {
                if (readError?.name === 'AbortError') {
                    throw readError;
                }

                const error = new Error(
                    'The connection was interrupted while streaming ' +
                        'the analysis. Please try again.'
                );
                error.cause = readError;
                throw error;
            }

            const { value, done } = chunk;

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            const events = buffer.split(/\r?\n\r?\n/);

            buffer = events.pop() ?? '';

            for (const event of events) {
                processEvent(event);
            }
        }

        if (buffer.trim()) {
            processEvent(buffer);
        }
    } finally {
        // Release the stream reader on completion, cancellation, or
        // parse failure so the connection is not left dangling.
        reader.cancel().catch(() => {});
    }

    if (!result) {
        if (receivedComplete) {
            throw new Error(
                'The server reported the analysis as complete but sent ' +
                    'no result data. Please try the upload again.'
            );
        }

        if (receivedProgress) {
            throw new Error(
                'The analysis stream ended before a result arrived \u2014 ' +
                    'the request most likely timed out on the server. ' +
                    'Please try the upload again.'
            );
        }

        throw new Error(
            'The analysis stream closed before any progress was ' +
                'reported. Please check that the backend is running ' +
                'and try again.'
        );
    }

    return result;
}

export async function verifyManuscript(id, analysis) {
    const response = await fetch(
        `${API_BASE_URL}/manuscripts/${encodeURIComponent(id)}/verify`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...analysis,
                id,
            }),
        }
    );

    if (!response.ok) {
        const text = await response.text();

        throw new Error(
            text || `Verification failed (${response.status})`
        );
    }

    return response.json();
}

export async function getManuscripts() {
    const response = await fetch(
        `${API_BASE_URL}/manuscripts`
    );

    if (!response.ok) {
        throw new Error(
            `Could not load manuscripts (${response.status})`
        );
    }

    return response.json();
}

export async function getManuscript(id, signal) {
    const response = await fetch(
        `${API_BASE_URL}/manuscripts/${encodeURIComponent(id)}`,
        { signal }
    );

    if (response.status === 404) {
        const error = new Error('Manuscript not found.');
        error.status = 404;
        throw error;
    }

    if (!response.ok) {
        const error = new Error(
            `Could not load manuscript (${response.status})`
        );
        error.status = response.status;
        throw error;
    }

    return response.json();
}

export async function getPendingAnalysis(id) {
    const response = await fetch(
        `${API_BASE_URL}/manuscripts/pending/${encodeURIComponent(id)}`
    );

    if (!response.ok) {
        throw new Error(
            `Could not load pending analysis (${response.status})`
        );
    }

    return response.json();
}