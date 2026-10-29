package com.manuscript.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.google.genai.errors.ApiException;
import com.google.genai.errors.GenAiIOException;
import com.manuscript.backend.dto.ManuscriptAnalysis;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.stereotype.Service;
import org.springframework.util.MimeType;
import org.springframework.util.MimeTypeUtils;

@Service
public class ManuscriptAnalysisService {

    private static final Logger log =
            LoggerFactory.getLogger(ManuscriptAnalysisService.class);

    private final ChatClient chatClient;

    public ManuscriptAnalysisService(ChatClient.Builder chatClientBuilder) {
        this.chatClient = chatClientBuilder.build();
    }

    public ManuscriptAnalysis analyzeManuscript(
            byte[] imageBytes,
            String mimeType
    ) {

        String systemPrompt = """
                You are an expert historical manuscript scholar and paleographer
                specializing in historical Indian texts and manuscripts.

                Your expertise includes manuscripts from the Indian subcontinent
                written in languages such as Persian, Urdu, Arabic, Sanskrit,
                Hindi, Braj, Awadhi, Marathi, Bengali, Punjabi, Gujarati,
                Tamil, Telugu, Malayalam, Prakrit, and related historical
                languages.

                Your task is to examine the supplied manuscript image and
                produce a careful, evidence-based scholarly analysis.

                IMPORTANT PRINCIPLES:

                1. Identify the historical language or languages as accurately
                   as possible.

                2. Identify the writing script as accurately as possible.
                   Examples include Devanagari, Perso-Arabic, Nastaliq, Naskh,
                   Modi, Bengali, Gurmukhi, Sharada, Grantha, Tamil, Telugu,
                   Malayalam, and other historically appropriate scripts.

                3. Transcribe the visible manuscript text faithfully.
                   Preserve historical wording, spellings, names, terminology,
                   and punctuation where visible.

                4. Do not modernize historical names, vocabulary, grammar,
                   spelling, or transliteration unless clearly necessary for
                   the English translation.

                5. Separate black-ink manuscript text from red-ink material.

                6. Put text written in red ink, including rubrication, headings,
                   annotations, corrections, or other red markings, into
                   redInk.

                7. Do not place ordinary black-ink text into redInk.

                8. Provide an English translation that preserves historical,
                   literary, cultural, religious, political, and geographic
                   meaning.

                9. Recognize historical Indian names, rulers, dynasties,
                   poets, scholars, religious figures, places, administrative
                   titles, dates, and cultural references when the manuscript
                   provides enough evidence.

                10. Do not invent missing or unreadable text.

                11. If a character, word, name, date, place, or phrase is
                    unclear, damaged, faded, obscured, or ambiguous, identify
                    it in flaggedWords.

                12. Use the image itself as the primary evidence. Historical
                    context may help interpretation, but must never override
                    what is actually visible.

                13. Distinguish clearly between visible evidence and inference.

                14. Set confidence to an integer from 0 to 100 representing
                    your confidence in the overall analysis.

                15. If the title or author cannot be established reliably,
                    return "Unknown" rather than guessing.

                16. If multiple languages or scripts occur on the page,
                    identify them in the corresponding fields.

                Be conservative and scholarly. Accuracy is more important
                than filling every field with a guess.
                """;

        String userPrompt = """
                Analyze this historical Indian manuscript page.

                Determine:
                - title
                - author
                - language
                - script
                - confidence
                - main black-ink manuscript text
                - red-ink text or rubrication
                - English translation
                - uncertain or ambiguous words

                Pay particular attention to historical Indian names, places,
                rulers, literary references, religious terminology, dates,
                titles, and manuscript conventions.

                Return the analysis as the ManuscriptAnalysis structure.
                """;

        MimeType mediaType = MimeTypeUtils.parseMimeType(mimeType);

        long startedAt = System.currentTimeMillis();

        /*
         * Elapsed-time instrumentation for the Gemini request. Only
         * sizes and durations are logged - never the API key, the
         * image bytes, or the manuscript content.
         */
        log.info(
                "Gemini analysis request started " +
                        "[stage=gemini-request, imageBytes={}, " +
                        "mimeType={}]",
                imageBytes.length,
                mimeType
        );

        ManuscriptAnalysis result;

        try {
            /*
             * This single timed block covers the Gemini HTTP request
             * and the structured-output conversion that runs right
             * after it; the failure category logged below is what
             * tells the two apart when an exception occurs.
             */
            result = chatClient
                    .prompt()
                    .system(systemPrompt)
                    .user(user -> user
                            .text(userPrompt)
                            .media(
                                    mediaType,
                                    new ByteArrayResource(imageBytes)
                            )
                    )
                    .call()
                    .entity(
                            ManuscriptAnalysis.class,
                            spec -> spec.useProviderStructuredOutput()
                    );
        } catch (RuntimeException ex) {
            log.error(
                    "Gemini analysis request failed " +
                            "[stage={}, durationMs={}, category={}]",
                    "gemini-request + structured-output-parsing",
                    elapsedSince(startedAt),
                    failureCategory(ex),
                    ex
            );
            throw ex;
        }

        long durationMs = elapsedSince(startedAt);

        if (result == null) {
            log.error(
                    "Gemini analysis returned no result " +
                            "[stage=structured-output-parsing, " +
                            "durationMs={}]",
                    durationMs
            );
            throw new IllegalStateException(
                    "Gemini returned an empty manuscript analysis."
            );
        }

        log.info(
                "Gemini analysis request finished " +
                        "[durationMs={}, extractedTextChars={}, " +
                        "translationChars={}, flaggedWords={}]",
                durationMs,
                lengthOf(result.extractedText()),
                lengthOf(result.translation()),
                result.flaggedWords() == null
                        ? 0
                        : result.flaggedWords().size()
        );

        return result;
    }

    private long elapsedSince(long startedAt) {
        return System.currentTimeMillis() - startedAt;
    }

    private int lengthOf(String text) {
        return text == null ? 0 : text.length();
    }

    /**
     * Server-side-only failure classification for the elapsed-time
     * log line. Never forwarded to the browser.
     */
    private String failureCategory(Throwable throwable) {
        if (findCause(throwable, ApiException.class) != null) {
            return "gemini-api";
        }

        if (findCause(throwable, GenAiIOException.class) != null
                || findCause(
                        throwable,
                        java.io.InterruptedIOException.class
                ) != null
                || findCause(
                        throwable,
                        java.net.UnknownHostException.class
                ) != null) {
            return "gemini-network-or-timeout";
        }

        if (findCause(throwable, JsonProcessingException.class) != null) {
            return "structured-output-parsing";
        }

        return "unexpected";
    }

    private <T extends Throwable> T findCause(
            Throwable throwable,
            Class<T> type
    ) {
        Throwable current = throwable;

        while (current != null) {
            if (type.isInstance(current)) {
                return type.cast(current);
            }

            current = current.getCause() == current
                    ? null
                    : current.getCause();
        }

        return null;
    }
}