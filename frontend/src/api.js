const API_BASE_URL = 'http://localhost:8080/api';

export async function analyzeManuscript(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
        `${API_BASE_URL}/manuscripts/analyze`,
        {
            method: 'POST',
            body: formData,
        }
    );

    if (!response.ok) {
        throw new Error(
            `Analysis request failed (${response.status})`
        );
    }

    if (!response.body) {
        throw new Error('Streaming response is not supported by this browser.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let result = null;

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
            result = JSON.parse(data);

            onProgress?.({
                type: 'result',
                data: result,
            });

            return;
        }

        if (eventName === 'complete') {
            onProgress?.({
                type: 'complete',
                message: data,
            });

            return;
        }

        if (eventName === 'error') {
            onProgress?.({
                type: 'error',
                message: data,
            });

            throw new Error(data || 'Manuscript analysis failed.');
        }
    };

    while (true) {
        const { value, done } = await reader.read();

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

    if (!result) {
        throw new Error('The backend completed without returning an analysis result.');
    }

    return result;
}

export async function verifyManuscript(id, analysis) {
    const response = await fetch(
        `\({API_BASE_URL}/manuscripts/\){encodeURIComponent(id)}/verify`,
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

// Added to fetch an individual manuscript by ID directly from the backend
export async function getManuscriptById(id) {
    const response = await fetch(
        `\({API_BASE_URL}/manuscripts/\){encodeURIComponent(id)}`
    );

    if (!response.ok) {
        throw new Error(
            `Could not load manuscript details (${response.status})`
        );
    }

    return response.json();
}

export async function getPendingAnalysis(id) {
    const response = await fetch(
        `\({API_BASE_URL}/manuscripts/pending/\){encodeURIComponent(id)}`
    );

    if (!response.ok) {
        throw new Error(
            `Could not load pending analysis (${response.status})`
        );
    }

    return response.json();
}