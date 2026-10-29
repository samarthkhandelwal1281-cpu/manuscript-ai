package com.manuscript.backend.config;

import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import org.springframework.ai.model.google.genai.autoconfigure.chat.GoogleGenAiConnectionProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Supplies the Gemini HTTP client with a hard request timeout.
 *
 * <p>The client auto-configured by Spring AI builds OkHttp with
 * connect/read/write timeouts of 0 (unlimited) and no overall call
 * timeout, so a single slow or stalled Gemini request blocks the
 * analysis worker indefinitely and outlives the SSE streaming window.
 *
 * <p>Bounding one call with {@link HttpOptions#timeout}:
 * <ul>
 *   <li>caps the whole HTTP call, including the Google client's own
 *       retry interceptor,</li>
 *   <li>sends Google an {@code X-Server-Timeout} so the server bounds
 *       generation too,</li>
 *   <li>lets a timed-out request fail while the SSE response is still
 *       open, so the browser gets a clear error instead of a dead
 *       stream.</li>
 * </ul>
 *
 * <p>This bean is only declared for API-key mode; when
 * {@code spring.ai.google.genai.vertex-ai=true} it backs off and
 * Spring's auto-configured client is used unchanged.
 */
@Configuration
public class GeminiClientConfig {

    @Bean
    @ConditionalOnProperty(
            name = "spring.ai.google.genai.vertex-ai",
            havingValue = "false",
            matchIfMissing = true
    )
    public Client geminiClient(
            GoogleGenAiConnectionProperties connectionProperties,
            @Value("${app.analysis.gemini-timeout-ms:100000}")
            int geminiTimeoutMs
    ) {
        return Client.builder()
                .apiKey(connectionProperties.getApiKey())
                .httpOptions(
                        HttpOptions.builder()
                                .timeout(geminiTimeoutMs)
                                .build()
                )
                .build();
    }
}
