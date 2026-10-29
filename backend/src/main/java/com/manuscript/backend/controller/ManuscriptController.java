package com.manuscript.backend.controller;

import com.manuscript.backend.dto.ManuscriptAnalysis;
import com.manuscript.backend.entity.Manuscript;
import com.manuscript.backend.entity.ManuscriptStatus;
import com.manuscript.backend.repository.ManuscriptRepository;
import com.manuscript.backend.service.ManuscriptAnalysisService;
import com.manuscript.backend.service.PendingManuscriptStore;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.google.genai.errors.ApiException;
import com.google.genai.errors.GenAiIOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.UnknownHostException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@RestController
@RequestMapping("/api/manuscripts")
@CrossOrigin(origins = "http://localhost:5173")
public class ManuscriptController {

    private final ManuscriptAnalysisService analysisService;
    private final ManuscriptRepository manuscriptRepository;
    private final PendingManuscriptStore pendingManuscriptStore;

    private static final Logger log =
            LoggerFactory.getLogger(ManuscriptController.class);

    private final ExecutorService executorService =
            Executors.newCachedThreadPool();

    /**
     * Overall SSE streaming window for POST /api/manuscripts/analyze.
     * Must stay larger than the Gemini request timeout
     * (app.analysis.gemini-timeout-ms) so a timed-out Gemini call can
     * still report a clear error while the response is alive.
     */
    @Value("${app.analysis.sse-timeout-ms:120000}")
    private long sseTimeoutMs;

    public ManuscriptController(
            ManuscriptAnalysisService analysisService,
            ManuscriptRepository manuscriptRepository,
            PendingManuscriptStore pendingManuscriptStore
    ) {
        this.analysisService = analysisService;
        this.manuscriptRepository = manuscriptRepository;
        this.pendingManuscriptStore = pendingManuscriptStore;
    }

    // ============================================================
    // ANALYZE MANUSCRIPT
    // ============================================================

    @PostMapping(
            value = "/analyze",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE
    )
    public SseEmitter analyzeManuscript(
            @RequestParam("file") MultipartFile file
    ) {

        SseEmitter emitter = new SseEmitter(sseTimeoutMs);
        AnalysisStream stream = new AnalysisStream();

        // The worker reads its own state; store the future so the
        // lifecycle callbacks below can signal it for cancellation.
        Future<?> worker = executorService.submit(
                () -> performAnalysis(emitter, stream, file)
        );
        stream.worker.set(worker);

        emitter.onCompletion(
                () -> log.debug(
                        "SSE analysis request completed (reason={}).",
                        stream.closeReason()
                )
        );

        emitter.onTimeout(() -> {
            boolean owned = stream.close("timed-out");

            if (owned) {
                log.warn(
                        "SSE analysis request timed out after {} ms; " +
                                "signalling the worker. Any late result " +
                                "will be discarded.",
                        sseTimeoutMs
                );

                cancelWorker(stream);
            } else {
                log.debug(
                        "SSE timeout fired after the response had already " +
                                "closed (reason={}).",
                        stream.closeReason()
                );
            }

            /*
             * The response has timed out but is not yet completed, so one
             * final terminal event can still be delivered. The send itself
             * is guarded: if the emitter is already unusable this is
             * swallowed, never raised as a secondary failure.
             */
            deliverError(emitter, stream, timeoutMessage(), true);
        });

        emitter.onError(error -> {
            boolean owned = stream.close("client-disconnected");

            if (owned) {
                log.warn(
                        "SSE analysis request aborted: {}",
                        error.getMessage()
                );

                cancelWorker(stream);
            }
        });

        return emitter;
    }

    // ============================================================
    // ANALYSIS WORKER (BACKGROUND)
    // ============================================================

    /**
     * Runs the analysis pipeline for one upload. All SSE writes go
     * through {@link #sendEvent}, which consults the shared
     * {@link AnalysisStream} state, so the worker can never write to
     * an emitter that has timed out, errored, or completed.
     */
    private void performAnalysis(
            SseEmitter emitter,
            AnalysisStream stream,
            MultipartFile file
    ) {

        // Tracks the analysis stage for failure diagnostics.
        String stage = "file validation";
        long startedAt = System.currentTimeMillis();

        try {

            if (file == null || file.isEmpty()) {
                log.warn(
                        "Manuscript analysis rejected: " +
                                "no file was uploaded."
                );

                deliverError(
                        emitter,
                        stream,
                        "No manuscript file was uploaded.",
                        false
                );
                return;
            }

            stage = "image preparation";

            // ------------------------------------------------
            // Step 1: Image preparation
            // ------------------------------------------------

            sendProgress(
                    emitter,
                    stream,
                    "Enhancing Image",
                    "Preparing manuscript image..."
            );

            if (!pause(stream, 500)) {
                return;
            }

            // ------------------------------------------------
            // Step 2: Script isolation
            // ------------------------------------------------

            sendProgress(
                    emitter,
                    stream,
                    "Isolating Script",
                    "Preparing manuscript for paleographic analysis..."
            );

            if (!pause(stream, 500)) {
                return;
            }

            // ------------------------------------------------
            // Step 3: Red ink detection
            // ------------------------------------------------

            sendProgress(
                    emitter,
                    stream,
                    "Detecting Red Ink",
                    "Analyzing ink colors and rubrication..."
            );

            if (!pause(stream, 500)) {
                return;
            }

            // ------------------------------------------------
            // Step 4: Gemini analysis
            // ------------------------------------------------

            sendProgress(
                    emitter,
                    stream,
                    "AI Text Extraction",
                    "Sending manuscript to Gemini..."
            );

            stage = "image reading";

            if (!ensureOpen(stream, stage)) {
                return;
            }

            byte[] imageBytes = file.getBytes();

            String contentType = file.getContentType();

            if (contentType == null || contentType.isBlank()) {
                contentType = "image/jpeg";
            }

            stage = "Gemini analysis";

            ManuscriptAnalysis aiResult =
                    analysisService.analyzeManuscript(
                            imageBytes,
                            contentType
                    );

            /*
             * The response may have timed out or been cancelled while
             * Gemini was still working. A result computed after the
             * response closed must not be stored or displayed: nobody
             * can reach it any more, and showing it later would be
             * stale data from a cancelled request.
             */
            if (!ensureOpen(stream, stage)) {
                log.info(
                        "Gemini analysis finished after the response " +
                                "closed [reason={}, elapsedMs={}]: " +
                                "discarding the result without storing it.",
                        stream.closeReason(),
                        elapsedSince(startedAt)
                );
                return;
            }

            // ------------------------------------------------
            // Generate ID on the backend
            // ------------------------------------------------

            String manuscriptId =
                    UUID.randomUUID().toString();

            ManuscriptAnalysis result =
                    new ManuscriptAnalysis(
                            manuscriptId,
                            aiResult.title(),
                            aiResult.author(),
                            aiResult.language(),
                            aiResult.script(),
                            aiResult.confidence(),
                            aiResult.extractedText(),
                            aiResult.redInk(),
                            aiResult.translation(),
                            aiResult.flaggedWords()
                    );

            // ------------------------------------------------
            // Store AI result temporarily
            // ------------------------------------------------

            stage = "result storage";

            pendingManuscriptStore.save(result);

            stage = "SSE delivery";

            // ------------------------------------------------
            // Step 5: Translation
            // ------------------------------------------------

            sendProgress(
                    emitter,
                    stream,
                    "Neural Translation",
                    "Generating translation and historical analysis..."
            );

            if (!pause(stream, 300)) {
                return;
            }

            // ------------------------------------------------
            // Send final AI result
            // ------------------------------------------------

            if (!sendEvent(emitter, stream, "result", result)) {
                log.debug(
                        "Final result event was not delivered " +
                                "(reason={}): dropping this request's " +
                                "stored analysis.",
                        stream.closeReason()
                );
                return;
            }

            // ------------------------------------------------
            // Complete
            // ------------------------------------------------

            sendEvent(
                    emitter,
                    stream,
                    "complete",
                    "Analysis completed successfully. " +
                            "Human verification required before archival."
            );

            stream.close("delivered");
            completeQuietly(emitter);

            log.info(
                    "Analysis delivered successfully [elapsedMs={}]",
                    elapsedSince(startedAt)
            );

        } catch (Exception e) {

            /*
             * An exception that is only the consequence of an already
             * closed response (timeout, disconnect, a send racing the
             * completion) is NOT a Gemini or pipeline failure. It must
             * not be logged as one, and no further event may be sent.
             */
            if (!stream.isOpen() || isEmitterClosedFailure(e)) {
                stream.close("emitter-completed");

                log.warn(
                        "Analysis worker hit an exception after the SSE " +
                                "response had already closed " +
                                "[stage={}, reason={}]: {} - consequence " +
                                "of the closed response, not an analysis " +
                                "failure; nothing will be sent.",
                        stage,
                        stream.closeReason(),
                        e.toString()
                );

                log.debug(
                        "Post-close exception detail [stage={}]",
                        stage,
                        e
                );

                return;
            }

            /*
             * Log the full failure server-side (stage, category,
             * elapsed time, complete stack trace), then send only a
             * safe, sanitized single-line message to the browser.
             */
            String userMessage =
                    describeFailure(stage, e, elapsedSince(startedAt));

            deliverError(emitter, stream, userMessage, false);
        }
    }

    // ============================================================
    // SSE LIFECYCLE HELPERS
    // ============================================================

    /**
     * Per-request SSE state shared between the async response
     * callbacks (onTimeout/onError/onCompletion) and the background
     * worker. The first close reason wins; every send is gated on
     * this state and every send failure re-closes it, so the race
     * between "check state" and "send" is resolved by the catch
     * blocks rather than by an exception escaping to the worker.
     */
    private static final class AnalysisStream {

        private final AtomicReference<String> closeReason =
                new AtomicReference<>();

        private final AtomicBoolean terminalErrorSent =
                new AtomicBoolean(false);

        private final AtomicReference<Future<?>> worker =
                new AtomicReference<>();

        boolean isOpen() {
            return closeReason.get() == null;
        }

        boolean close(String reason) {
            return closeReason.compareAndSet(null, reason);
        }

        String closeReason() {
            return closeReason.get();
        }
    }

    /**
     * Sends a named SSE event if, and only if, the response is still
     * usable. Returns true when the event was handed to the emitter.
     *
     * <p>Handles the race where the response becomes unusable between
     * the state check and the send: {@code IllegalStateException}
     * ("ResponseBodyEmitter has already completed") and
     * {@code IOException} both close the stream and are swallowed
     * here, so the worker never sees them as analysis failures and
     * never retries the send.
     */
    private boolean sendEvent(
            SseEmitter emitter,
            AnalysisStream stream,
            String eventName,
            Object payload
    ) {

        if (!stream.isOpen()) {
            log.debug(
                    "SSE '{}' skipped: response already closed (reason={}).",
                    eventName,
                    stream.closeReason()
            );
            return false;
        }

        try {
            emitter.send(
                    SseEmitter.event()
                            .name(eventName)
                            .data(payload)
            );
            return true;
        } catch (IllegalStateException ex) {
            // Completed between the check and the send.
            stream.close("emitter-completed");
            log.debug(
                    "SSE '{}' skipped: emitter already completed " +
                            "(consequence of a closed response): {}",
                    eventName,
                    ex.getMessage()
            );
            return false;
        } catch (IOException ex) {
            stream.close("send-failed");
            log.debug(
                    "SSE '{}' could not be delivered: {}",
                    eventName,
                    ex.getMessage()
            );
            return false;
        }
    }

    private void sendProgress(
            SseEmitter emitter,
            AnalysisStream stream,
            String step,
            String message
    ) {
        sendEvent(
                emitter,
                stream,
                "progress",
                new ProgressMessage(step, message)
        );
    }

    /**
     * Delivers the single terminal {@code error} event and completes
     * the response.
     *
     * @param force when true (timeout callback), attempt the send even
     *              though the stream is already marked closed, because
     *              the response is completed only after the timeout
     *              callback returns
     */
    private void deliverError(
            SseEmitter emitter,
            AnalysisStream stream,
            String message,
            boolean force
    ) {

        if (!stream.terminalErrorSent.compareAndSet(false, true)) {
            log.debug(
                    "Terminal error event skipped: one was already sent " +
                            "or delivery already failed."
            );
            completeQuietly(emitter);
            return;
        }

        if (!force && !stream.isOpen()) {
            log.debug(
                    "Terminal error event not delivered: response " +
                            "already closed (reason={}).",
                    stream.closeReason()
            );
            completeQuietly(emitter);
            return;
        }

        try {
            emitter.send(
                    SseEmitter.event()
                            .name("error")
                            .data(message)
            );
        } catch (IllegalStateException | IOException ex) {
            // The response vanished mid-send: one attempt, no retry.
            stream.close("terminal-send-failed");
            log.debug(
                    "Terminal error event could not be delivered " +
                            "(response no longer usable): {}",
                    ex.getMessage()
            );
        }

        /*
         * Complete normally so Spring does not start an error dispatch
         * against an already-committed SSE response.
         */
        completeQuietly(emitter);
    }

    private void completeQuietly(SseEmitter emitter) {
        try {
            emitter.complete();
        } catch (IllegalStateException ex) {
            log.debug("Emitter already completed: {}", ex.getMessage());
        }
    }

    /**
     * Signals the worker for cancellation.
     *
     * <p>The interrupt aborts the worker's sleeps and is observed at
     * the next state check, but it does <strong>not</strong> cancel an
     * in-flight Gemini HTTP call: the OkHttp request runs to its own
     * call timeout, and its eventual result is discarded by the state
     * check in the worker.
     */
    private void cancelWorker(AnalysisStream stream) {
        Future<?> task = stream.worker.get();

        if (task != null && task.cancel(true)) {
            log.info(
                    "Analysis worker signalled for cancellation. An " +
                            "in-flight Gemini HTTP call is not cancelled " +
                            "by the interrupt; its result will be " +
                            "discarded when it returns."
            );
        }
    }

    /** Returns false when the response closed or the worker was interrupted. */
    private boolean ensureOpen(AnalysisStream stream, String stage) {
        if (stream.isOpen()) {
            return true;
        }

        log.info(
                "Analysis stopped before completing [stage={}, " +
                        "reason={}]: the SSE response is no longer " +
                        "usable; nothing further will be sent or stored.",
                stage,
                stream.closeReason()
        );

        return false;
    }

    /** Sleeps between progress steps, aborting on close or interrupt. */
    private boolean pause(AnalysisStream stream, long millis) {
        if (!stream.isOpen()) {
            return ensureOpen(stream, "progress delivery");
        }

        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ensureOpen(stream, "progress delivery");
        }

        return ensureOpen(stream, "progress delivery");
    }

    /**
     * True when any exception in the chain is the emitter-completed
     * race itself, so it can be classified as a consequence of a
     * closed response instead of a fresh pipeline failure.
     */
    private boolean isEmitterClosedFailure(Throwable throwable) {
        Throwable current = throwable;

        while (current != null) {
            String message = current.getMessage();

            if (message != null && message.contains("has already completed")) {
                return true;
            }

            current = current.getCause() == current
                    ? null
                    : current.getCause();
        }

        return false;
    }

    private long elapsedSince(long startedAt) {
        return System.currentTimeMillis() - startedAt;
    }

    private String timeoutMessage() {
        long seconds = Math.max(1, sseTimeoutMs / 1000);

        return "The analysis did not finish within " + seconds +
                " seconds and was stopped. Please try the upload again.";
    }

    // ============================================================
    // GET PENDING ANALYSIS
    // ============================================================

    @GetMapping("/pending/{id}")
    public ResponseEntity<ManuscriptAnalysis> getPendingAnalysis(
            @PathVariable String id
    ) {

        ManuscriptAnalysis analysis =
                pendingManuscriptStore.find(id);

        if (analysis == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(analysis);
    }

    // ============================================================
    // HUMAN VERIFICATION + ARCHIVAL
    // ============================================================

    @PostMapping("/{id}/verify")
    public ResponseEntity<Manuscript> verifyAndSave(
            @PathVariable String id,
            @RequestBody ManuscriptAnalysis reviewedAnalysis
    ) {

        // --------------------------------------------------------
        // Validate request body
        // --------------------------------------------------------

        if (reviewedAnalysis == null) {
            return ResponseEntity.badRequest().build();
        }

        // --------------------------------------------------------
        // Retrieve original AI analysis
        // --------------------------------------------------------

        ManuscriptAnalysis pending =
                pendingManuscriptStore.find(id);

        /*
         * The manuscript must have been analyzed by this backend
         * before it can be verified.
         */
        if (pending == null) {
            return ResponseEntity.notFound().build();
        }

        // --------------------------------------------------------
        // Validate human-reviewed transcription
        // --------------------------------------------------------

        if (reviewedAnalysis.extractedText() == null
                || reviewedAnalysis.extractedText().isBlank()) {

            return ResponseEntity.badRequest().build();
        }

        // --------------------------------------------------------
        // Validate confidence
        // --------------------------------------------------------

        if (reviewedAnalysis.confidence() == null
                || reviewedAnalysis.confidence() < 0
                || reviewedAnalysis.confidence() > 100) {

            return ResponseEntity.badRequest().build();
        }

        // --------------------------------------------------------
        // Create archival manuscript
        // --------------------------------------------------------

        Manuscript manuscript = new Manuscript();

        // ========================================================
        // COMMON METADATA
        // ========================================================

        manuscript.setId(id);

        manuscript.setTitle(
                reviewedAnalysis.title() != null
                        ? reviewedAnalysis.title()
                        : pending.title()
        );

        manuscript.setAuthor(
                reviewedAnalysis.author() != null
                        ? reviewedAnalysis.author()
                        : pending.author()
        );

        manuscript.setLanguage(
                reviewedAnalysis.language() != null
                        ? reviewedAnalysis.language()
                        : pending.language()
        );

        manuscript.setScript(
                reviewedAnalysis.script() != null
                        ? reviewedAnalysis.script()
                        : pending.script()
        );

        manuscript.setConfidence(
                reviewedAnalysis.confidence()
        );

        // ========================================================
        // ORIGINAL AI RESULT
        // ========================================================

        manuscript.setAiExtractedText(
                pending.extractedText()
        );

        manuscript.setAiRedInk(
                pending.redInk()
        );

        manuscript.setAiTranslation(
                pending.translation()
        );

        manuscript.setAiFlaggedWords(
                pending.flaggedWords()
        );

        // ========================================================
        // HUMAN VERIFIED RESULT
        // ========================================================

        manuscript.setVerifiedExtractedText(
                reviewedAnalysis.extractedText()
        );

        manuscript.setVerifiedRedInk(
                reviewedAnalysis.redInk()
        );

        manuscript.setVerifiedTranslation(
                reviewedAnalysis.translation()
        );

        manuscript.setVerifiedFlaggedWords(
                reviewedAnalysis.flaggedWords()
        );

        // ========================================================
        // VERIFICATION METADATA
        // ========================================================

        manuscript.setStatus(
                ManuscriptStatus.VERIFIED
        );

        manuscript.setVerifiedAt(
                LocalDateTime.now()
        );

        manuscript.setVerifiedBy(
                "human-reviewer"
        );

        // ========================================================
        // SAVE ARCHIVAL RECORD
        // ========================================================

        Manuscript saved =
                manuscriptRepository.save(manuscript);

        // --------------------------------------------------------
        // Remove temporary AI result
        // --------------------------------------------------------

        pendingManuscriptStore.remove(id);

        return ResponseEntity.ok(saved);
    }

    // ============================================================
    // GET ALL ARCHIVED MANUSCRIPTS
    // ============================================================

    @GetMapping
    public ResponseEntity<List<Manuscript>> getAllManuscripts() {

        return ResponseEntity.ok(
                manuscriptRepository.findAll()
        );
    }

    // ============================================================
    // GET SINGLE ARCHIVED MANUSCRIPT
    // ============================================================

    @GetMapping("/{id}")
    public ResponseEntity<Manuscript> getManuscriptById(
            @PathVariable String id
    ) {

        return manuscriptRepository
                .findById(id)
                .map(ResponseEntity::ok)
                .orElseGet(
                        () -> ResponseEntity.notFound().build()
                );
    }

    // ============================================================
    // FAILURE DIAGNOSTICS HELPER
    // ============================================================

    /**
     * Logs the complete failure (stage, category, elapsed time, HTTP
     * status and full stack trace) using Spring Boot's logging
     * framework and returns a safe, sanitized, single-line message
     * that is safe to send to the browser.
     */
    private String describeFailure(
            String stage,
            Exception exception,
            long elapsedMs
    ) {
        String category;
        String userMessage;
        int status = -1;

        ApiException apiException =
                findCause(exception, ApiException.class);

        if (apiException != null) {
            status = apiException.code();
            String detail = sanitizeForUser(apiException.message());

            if (status == 401 || status == 403) {
                category = "gemini-authentication";
                userMessage =
                        "The Gemini API rejected the configured " +
                                "credentials (HTTP " + status +
                                "): " + detail;
            } else if (status == 429) {
                category = "gemini-quota";
                userMessage =
                        "The Gemini API rate limit or quota was " +
                                "exceeded (HTTP 429): " + detail;
            } else if (status >= 400 && status < 500) {
                category = "gemini-invalid-request";
                userMessage =
                        "The Gemini API rejected the analysis " +
                                "request (HTTP " + status +
                                "): " + detail;
            } else {
                category = "gemini-server";
                userMessage =
                        "The Gemini API is currently unavailable " +
                                "(HTTP " + status +
                                "). Please try again later.";
            }
        } else if (findCause(exception, GenAiIOException.class) != null
                || findCause(
                        exception,
                        InterruptedIOException.class
                ) != null
                || findCause(
                        exception,
                        UnknownHostException.class
                ) != null) {
            category = "gemini-network";
            userMessage =
                    "Could not reach the Gemini API (network error " +
                            "or timeout). Please try again.";
        } else if (findCause(
                        exception,
                        JsonProcessingException.class
                ) != null
                || isAnalysisEmptyResponse(exception)
                || hasParsingHint(exception)) {
            category = "structured-output-parsing";
            userMessage =
                    "Gemini returned a response that could not be " +
                            "parsed into the expected analysis " +
                            "structure: " +
                            sanitizeForUser(parsingDetail(exception));
        } else if (exception instanceof IOException) {
            category = "sse-delivery";
            userMessage =
                    "The analysis stream could not be delivered to " +
                            "the browser. Please retry the upload.";
        } else {
            category = "unexpected";
            userMessage =
                    "Unexpected server error while " + stage + ".";
        }

        if ("gemini-authentication".equals(category)
                || "gemini-quota".equals(category)
                || "gemini-invalid-request".equals(category)) {
            log.warn(
                    "Manuscript analysis failed " +
                            "[stage={}, category={}, httpStatus={}, " +
                            "elapsedMs={}]",
                    stage,
                    category,
                    status,
                    elapsedMs,
                    exception
            );
        } else {
            log.error(
                    "Manuscript analysis failed " +
                            "[stage={}, category={}, httpStatus={}, " +
                            "elapsedMs={}]",
                    stage,
                    category,
                    status,
                    elapsedMs,
                    exception
            );
        }

        return userMessage;
    }

    /**
     * The analysis service throws this when Gemini returned no usable
     * result at all.
     */
    private boolean isAnalysisEmptyResponse(Exception exception) {
        if (!(exception instanceof IllegalStateException)) {
            return false;
        }

        String message = exception.getMessage();

        return message != null
                && message.toLowerCase().contains("analysis");
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

    private boolean hasParsingHint(Throwable throwable) {
        Throwable current = throwable;

        while (current != null) {
            String message = current.getMessage();

            if (message != null) {
                String lower = message.toLowerCase();

                if (lower.contains("json")
                        || lower.contains("parse")
                        || lower.contains("deserializ")) {
                    return true;
                }
            }

            current = current.getCause() == current
                    ? null
                    : current.getCause();
        }

        return false;
    }

    private String parsingDetail(Throwable exception) {
        JsonProcessingException parseException =
                findCause(exception, JsonProcessingException.class);

        if (parseException != null
                && parseException.getMessage() != null) {
            return parseException.getMessage();
        }

        return exception.getMessage() != null
                ? exception.getMessage()
                : "no details available";
    }

    /**
     * Removes anything credential-shaped and collapses the text to a
     * safe single line of bounded length before it can reach the
     * logs or the browser.
     */
    private String sanitizeForUser(String text) {
        if (text == null || text.isBlank()) {
            return "no details available";
        }

        String cleaned = text
                .replaceAll("\\bAIza[0-9A-Za-z_-]{16,}", "[redacted]")
                .replaceAll(
                        "(?i)(api[-_]?key\\s*[=:]\\s*)\\S+",
                        "$1[redacted]"
                )
                .replaceAll("\\s+", " ")
                .trim();

        if (cleaned.length() > 400) {
            cleaned = cleaned.substring(0, 400) + "...";
        }

        return cleaned;
    }

    // ============================================================
    // SSE PROGRESS DTO
    // ============================================================

    private record ProgressMessage(
            String step,
            String message
    ) {
    }
}
