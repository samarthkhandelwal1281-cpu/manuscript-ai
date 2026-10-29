import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowLeft,
    CheckCircle,
    FileText,
    RefreshCw,
    Type,
} from 'lucide-react';

import { getManuscript } from '../api';
import { InfoCard } from './AnalysisPage';

function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function formatDateTime(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

export default function ManuscriptDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    // Remounting the body resets it to a clean loading state, so a
    // retry never needs to set state synchronously inside an effect.
    const [attempt, setAttempt] = useState(0);

    function handleBack() {
        navigate('/dashboard');
    }

    if (!id) {
        return (
            <DetailShell onBack={handleBack}>
                <ErrorPanel
                    notFound
                    message="No manuscript ID was provided."
                    onBack={handleBack}
                />
            </DetailShell>
        );
    }

    return (
        <ManuscriptDetailBody
            key={`${id}:${attempt}`}
            id={id}
            onBack={handleBack}
            onRetry={() => setAttempt((current) => current + 1)}
        />
    );
}

function DetailShell({ children, onBack }) {
    return (
        <div className="pt-32 px-8 max-w-[1100px] mx-auto pb-20">
            <div className="mb-8">
                <BackBar onBack={onBack} />
            </div>

            {children}
        </div>
    );
}

function BackBar({ onBack }) {
    return (
        <button
            onClick={onBack}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50 hover:text-gold transition-colors"
        >
            <ArrowLeft size={14} />
            Back to Archive
        </button>
    );
}

function ErrorPanel({ notFound, message, onBack, onRetry }) {
    return (
        <div className="bg-secondary border border-redInk/20 rounded-2xl p-10 text-center">
            <AlertTriangle
                size={30}
                className="mx-auto mb-4 text-redInk"
            />

            <p className="text-gold text-xs uppercase tracking-[0.3em] font-bold mb-3">
                {notFound ? 'Manuscript Not Found' : 'Request Failed'}
            </p>

            <h1 className="text-3xl font-serif text-white mb-4">
                {notFound
                    ? 'This manuscript is not in the archive.'
                    : 'The manuscript could not be loaded.'}
            </h1>

            <p className="text-white/40 text-sm mb-8 max-w-xl mx-auto">
                {notFound
                    ? 'It may have been removed, or the link is incorrect.'
                    : message}
            </p>

            <div className="flex flex-wrap gap-4 justify-center">
                {!notFound && (
                    <button
                        onClick={onRetry}
                        className="px-8 py-3 bg-gold text-background font-black rounded-full text-xs uppercase tracking-widest hover:bg-goldLight flex items-center gap-2 justify-center"
                    >
                        <RefreshCw size={14} />
                        Retry
                    </button>
                )}

                <button
                    onClick={onBack}
                    className="px-8 py-3 bg-white/5 border border-white/10 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all"
                >
                    Back to Archive
                </button>
            </div>
        </div>
    );
}

function ManuscriptDetailBody({ id, onBack, onRetry }) {
    const [manuscript, setManuscript] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const controller = new AbortController();

        getManuscript(id, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) {
                    return;
                }

                setManuscript(data);
            })
            .catch((err) => {
                // An aborted request is intentional (navigating away);
                // it must not surface as an error state.
                if (controller.signal.aborted) {
                    return;
                }

                setError({
                    status: err.status,
                    message:
                        err.message ||
                        'The manuscript could not be loaded.',
                });
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            });

        return () => controller.abort();
    }, [id]);

    if (loading) {
        return (
            <DetailShell onBack={onBack}>
                <div className="bg-secondary border border-white/5 rounded-2xl p-10 text-white/40 text-sm">
                    Loading manuscript...
                </div>
            </DetailShell>
        );
    }

    if (error) {
        return (
            <DetailShell onBack={onBack}>
                <ErrorPanel
                    notFound={error.status === 404}
                    message={error.message}
                    onBack={onBack}
                    onRetry={onRetry}
                />
            </DetailShell>
        );
    }

    if (!manuscript) {
        return null;
    }

    const verifiedAt = formatDateTime(manuscript.verifiedAt);

    const aiAvailable =
        hasText(manuscript.aiExtractedText) ||
        hasText(manuscript.aiRedInk) ||
        hasText(manuscript.aiTranslation) ||
        (manuscript.aiFlaggedWords?.length ?? 0) > 0;

    const verifiedAvailable =
        hasText(manuscript.verifiedExtractedText) ||
        hasText(manuscript.verifiedRedInk) ||
        hasText(manuscript.verifiedTranslation) ||
        (manuscript.verifiedFlaggedWords?.length ?? 0) > 0;

    return (
        <div className="pt-32 px-8 max-w-[1100px] mx-auto pb-20">
            <div className="mb-8">
                <BackBar onBack={onBack} />
            </div>

            {/* Header */}
            <div className="mb-8">
                <div className="flex flex-wrap gap-2 mb-3">
                    <span className="text-[10px] bg-gold/10 text-gold px-2 py-1 rounded font-bold uppercase tracking-wider border border-gold/20">
                        {manuscript.status || 'ARCHIVED'}
                    </span>

                    <span className="text-[10px] bg-white/5 text-white/50 px-2 py-1 rounded font-bold uppercase tracking-wider border border-white/10">
                        {manuscript.language || 'Unknown'}
                    </span>

                    <span className="text-[10px] bg-white/5 text-white/50 px-2 py-1 rounded font-bold uppercase tracking-wider border border-white/10">
                        {manuscript.script || 'Unknown'}
                    </span>
                </div>

                <h1 className="text-4xl font-serif text-white">
                    {manuscript.title || 'Untitled Manuscript'}
                </h1>

                <p className="text-white/40 italic">
                    {manuscript.author || 'Author unknown'}
                </p>

                <p className="text-[10px] text-white/20 mt-2 font-mono">
                    ID: {manuscript.id}
                </p>

                {verifiedAt && (
                    <p className="text-[10px] text-white/30 mt-1">
                        Archived {verifiedAt}
                        {manuscript.verifiedBy
                            ? ` by ${manuscript.verifiedBy}`
                            : ''}
                    </p>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <InfoCard
                    label="Confidence"
                    value={
                        manuscript.confidence != null
                            ? `${manuscript.confidence}%`
                            : '—'
                    }
                    gold
                />

                <InfoCard
                    label="Language"
                    value={manuscript.language || 'Unknown'}
                />

                <InfoCard
                    label="Script"
                    value={manuscript.script || 'Unknown'}
                />

                <InfoCard
                    label="Status"
                    value={manuscript.status || 'ARCHIVED'}
                />
            </div>

            {!aiAvailable && !verifiedAvailable && (
                <div className="bg-secondary border border-white/5 rounded-2xl p-10 text-center mb-8">
                    <FileText
                        size={30}
                        className="mx-auto mb-3 text-white/30"
                    />

                    <p className="text-white/40 text-sm">
                        No saved analysis results are stored for this
                        manuscript.
                    </p>
                </div>
            )}

            {/* Human verified results */}
            {verifiedAvailable && (
                <section className="mb-8">
                    <h3 className="text-xs font-bold text-white/20 uppercase tracking-[0.4em] mb-4">
                        Verified Results
                    </h3>

                    <div className="space-y-6">
                        <TextBlock
                            icon={<CheckCircle size={14} />}
                            title="Verified Transcription"
                            value={manuscript.verifiedExtractedText}
                            tone="gold"
                        />

                        <TextBlock
                            icon={<FileText size={14} />}
                            title="Verified Red Ink"
                            value={manuscript.verifiedRedInk}
                            tone="red"
                        />

                        <TextBlock
                            icon={<Type size={14} />}
                            title="Verified Translation"
                            value={manuscript.verifiedTranslation}
                        />

                        <FlaggedWords
                            words={manuscript.verifiedFlaggedWords}
                            label="Verified Flagged Words"
                        />
                    </div>
                </section>
            )}

            {/* Original AI output */}
            {aiAvailable && (
                <section className="mb-8">
                    <h3 className="text-xs font-bold text-white/20 uppercase tracking-[0.4em] mb-4">
                        Original AI Analysis
                    </h3>

                    <div className="space-y-6">
                        <TextBlock
                            icon={<Type size={14} />}
                            title="AI Transcription"
                            value={manuscript.aiExtractedText}
                        />

                        <TextBlock
                            icon={<FileText size={14} />}
                            title="AI Red Ink"
                            value={manuscript.aiRedInk}
                            tone="red"
                        />

                        <TextBlock
                            icon={<Type size={14} />}
                            title="AI Translation"
                            value={manuscript.aiTranslation}
                        />

                        <FlaggedWords
                            words={manuscript.aiFlaggedWords}
                            label="Flagged Words"
                        />
                    </div>
                </section>
            )}

            <div className="flex justify-center mt-10">
                <button
                    onClick={onBack}
                    className="px-10 py-4 bg-white/5 border border-white/10 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all"
                >
                    Back to Archive
                </button>
            </div>
        </div>
    );
}

function TextBlock({ icon, title, value, tone = 'default' }) {
    const hasValue = hasText(value);

    const toneClasses =
        tone === 'red'
            ? 'bg-redInk/5 border-redInk/20'
            : 'bg-secondary border-white/10';

    const titleClasses =
        tone === 'red' ? 'text-redInk' : 'text-gold';

    const valueClasses =
        tone === 'red' ? 'text-redInk' : 'text-parchment/90';

    return (
        <div className={`border rounded-2xl p-6 ${toneClasses}`}>
            <div className="flex items-center gap-2 mb-3">
                <span className={titleClasses}>{icon}</span>

                <h3
                    className={`text-[10px] font-black uppercase tracking-widest ${titleClasses}`}
                >
                    {title}
                </h3>
            </div>

            {hasValue ? (
                <p
                    className={`font-serif text-lg leading-relaxed whitespace-pre-wrap ${valueClasses}`}
                >
                    {value}
                </p>
            ) : (
                <p className="text-xs text-white/30 italic">
                    Not available for this manuscript.
                </p>
            )}
        </div>
    );
}

function FlaggedWords({ words, label }) {
    const list = Array.isArray(words) ? words : [];

    if (list.length === 0) {
        return null;
    }

    return (
        <div className="bg-amber-500/5 p-6 rounded-2xl border border-amber-500/20">
            <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                    <AlertTriangle size={20} />
                </div>

                <div className="min-w-0">
                    <p className="text-sm font-bold text-amber-500">
                        {label}
                    </p>

                    <div className="flex flex-wrap gap-2 mt-3">
                        {list.map((word, index) => (
                            <span
                                key={`${word}-${index}`}
                                className="text-xs px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400"
                            >
                                {word}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}